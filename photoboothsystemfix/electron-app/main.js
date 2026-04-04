const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
// Electron modules - these will only work in the Electron context
let app, BrowserWindow, ipcMain, session;

try {
  const electron = require('electron');
  // Check if we got the actual module or just the path
  if (typeof electron === 'object' && electron.app) {
    app = electron.app;
    BrowserWindow = electron.BrowserWindow;
    ipcMain = electron.ipcMain;
    session = electron.session;
  } else {
    throw new Error('Electron module not properly loaded');
  }
} catch (e) {
  console.error('Failed to load Electron:', e.message);
  console.error('This file must be run with the Electron runtime.');
  console.error('Try: npx electron .');
  process.exit(1);
}

let mainWindow;

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// Enable touch events for touchscreen displays
app.commandLine.appendSwitch('enable-touch-events');
app.commandLine.appendSwitch('touch-events', 'enabled');

// ============================================================
// Capture Card — settings persistence
// DSLR is connected via HDMI to a capture card (e.g. Elgato, generic USB grabber)
// The capture card appears as a standard webcam / video input device in the OS
// Preview and capture are handled entirely in the renderer via getUserMedia
// ============================================================

const settingsPath = path.join(__dirname, 'captures', 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.warn('[Settings] Failed to load settings:', e.message);
  }
  return {};
}

function saveSettings(data) {
  try {
    const captureDir = path.join(__dirname, 'captures');
    if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir, { recursive: true });
    const current = loadSettings();
    const merged = Object.assign({}, current, data);
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[Settings] Failed to save settings:', e.message);
    return false;
  }
}

// ─── Java Camera Server Management ──────────────────────────────────────────
let javaProcess;
let cameraServerPort = 9999;

function getJarPath() {
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    return path.join(__dirname, '..', 'camera-server', 'target', 'canon-driver.jar');
  } else {
    return path.join(process.resourcesPath, 'java-server', 'canon-driver.jar');
  }
}

function getJavaExecutable() {
  const bundledProdPath = path.join(process.resourcesPath || '', 'java-server', 'jre', 'bin', 'java.exe');
  if (fs.existsSync(bundledProdPath)) return bundledProdPath;

  const bundledDevPath = path.join(__dirname, '..', 'buildResources', 'java-server', 'jre', 'bin', 'java.exe');
  if (fs.existsSync(bundledDevPath)) {
    if (process.platform === 'win32') return bundledDevPath;
  }

  if (process.platform !== 'win32') return 'java'; 

  const x86JavaPaths = [
    'C:\\Program Files (x86)\\Java\\jre1.8.0_latest\\bin\\java.exe',
    'C:\\Program Files (x86)\\Eclipse Adoptium\\jre-11\\bin\\java.exe',
    'C:\\Program Files (x86)\\Microsoft\\jdk-11\\bin\\java.exe',
  ];

  try {
    const x86Dir = 'C:\\Program Files (x86)\\Java';
    if (fs.existsSync(x86Dir)) {
      const entries = fs.readdirSync(x86Dir);
      for (const entry of entries) {
        const candidate = path.join(x86Dir, entry, 'bin', 'java.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (e) {}

  for (const p of x86JavaPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'java';
}

function startJavaServer() {
  return new Promise((resolve, reject) => {
    const jarPath = getJarPath();
    const javaExe = getJavaExecutable();
    console.log(`[Main] Starting Java camera server: ${jarPath}`);
    console.log(`[Main] Using Java: ${javaExe}`);

    javaProcess = spawn(javaExe, ['-jar', jarPath, String(cameraServerPort)], {
      cwd: path.dirname(jarPath),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let startTimeout = setTimeout(() => {
      reject(new Error('Java server start timeout (30s)'));
    }, 30000);

    javaProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[Java] ${output}`);
      if (output.includes('CAMERA_SERVER_READY')) {
        clearTimeout(startTimeout);
        const match = output.match(/CAMERA_SERVER_READY:(\d+)/);
        if (match) cameraServerPort = parseInt(match[1]);
        console.log(`[Main] Camera server ready on port ${cameraServerPort}`);
        resolve(cameraServerPort);
      }
    });

    javaProcess.stderr.on('data', (data) => {
      console.error(`[Java:ERR] ${data.toString().trim()}`);
    });

    javaProcess.on('error', (err) => {
      clearTimeout(startTimeout);
      console.error('[Main] Failed to start Java process:', err);
      reject(err);
    });

    javaProcess.on('exit', (code, signal) => {
      console.log(`[Main] Java process exited with code ${code}, signal ${signal}`);
      javaProcess = null;
    });
  });
}

function stopJavaServer() {
  return new Promise((resolve) => {
    if (!javaProcess) {
      resolve(); return;
    }
    console.log('[Main] Sending shutdown request to Java server...');
    const req = http.request({
      hostname: '127.0.0.1', port: cameraServerPort, path: '/shutdown', method: 'POST', timeout: 3000
    }, (res) => {
      setTimeout(() => { if (javaProcess) javaProcess.kill('SIGTERM'); resolve(); }, 2000);
    });
    req.on('error', () => {
      if (javaProcess) {
        javaProcess.kill('SIGTERM');
        setTimeout(() => { if (javaProcess) javaProcess.kill('SIGKILL'); resolve(); }, 2000);
      } else resolve();
    });
    req.on('timeout', () => { req.destroy(); if (javaProcess) javaProcess.kill('SIGTERM'); resolve(); });
    req.end();
  });
}

function createWindow() {
  const isDev = process.argv.includes('--dev');

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    frame: isDev,             // Native frame in dev, frameless in production
    fullscreen: !isDev,       // Fullscreen in production, windowed in dev
    fullscreenable: true,
    resizable: true,
    movable: isDev,
    minimizable: true,        // Always allow minimize
    backgroundColor: '#0a0a1a',
    titleBarStyle: isDev ? 'default' : (isMac ? 'hidden' : 'hidden'),
    titleBarOverlay: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('src/index.html');

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Prevent accidental close via Alt+F4 / Cmd+Q in production
  mainWindow.on('close', (e) => {
    if (!isDev && !mainWindow._forceClose) {
      e.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Grant camera/microphone permissions automatically (needed for getUserMedia capture card)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'camera' || permission === 'microphone') {
      callback(true);
    } else {
      callback(false);
    }
  });
  createWindow();

  // Camera server will be started on-demand by the renderer
  // when entering the frame selection screen.
  console.log('[Main] App ready. Waiting for renderer to request camera start.');
});

app.on('window-all-closed', async () => {
  await stopJavaServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  if (javaProcess) {
    e.preventDefault();
    await stopJavaServer();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow.close());
ipcMain.handle('window:fullscreen', () => mainWindow.setFullScreen(!mainWindow.isFullScreen()));
ipcMain.handle('window:quit', async () => {
  if (mainWindow) { mainWindow._forceClose = true; mainWindow.close(); }
  await stopJavaServer();
  app.quit();
});

ipcMain.handle('get-camera-port', () => {
  return cameraServerPort;
});

ipcMain.handle('camera:startServer', async () => {
  if (!javaProcess) {
    try {
      await startJavaServer();
    } catch (e) {
      console.error('[Main] Failed to start Java server on demand:', e);
    }
  }
  return cameraServerPort;
});

ipcMain.handle('camera:stopServer', async () => {
  await stopJavaServer();
  return true;
});

// ============================================================
// Capture Card IPC Handlers
// DSLR → HDMI → Capture Card → appears as getUserMedia video device
// Preview and capture are handled in the renderer; main process only
// manages device enumeration (via renderer executeJavaScript) and settings.
// ============================================================

// --- capturecard:getDevices ---
// Enumerate video input devices by executing in the renderer context
ipcMain.handle('capturecard:getDevices', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Window not available', devices: [] };
    }
    const devices = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        try {
          // Request permission first (needed on some platforms)
          await navigator.mediaDevices.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
          const all = await navigator.mediaDevices.enumerateDevices();
          return all
            .filter(d => d.kind === 'videoinput')
            .map(d => ({ deviceId: d.deviceId, label: d.label || ('Camera ' + d.deviceId.slice(0, 8)) }));
        } catch(e) {
          return [];
        }
      })()
    `);
    console.log('[CaptureCard] Devices found:', devices.length);
    return { success: true, devices };
  } catch (e) {
    console.error('[CaptureCard] getDevices error:', e.message);
    return { success: false, error: e.message, devices: [] };
  }
});

// --- capturecard:saveDevice ---
ipcMain.handle('capturecard:saveDevice', async (event, deviceId, label) => {
  const ok = saveSettings({ capturecard_device_id: deviceId, capturecard_device_label: label || '' });
  console.log(`[CaptureCard] Saved device: "${label}" (${deviceId})`);
  return { success: ok };
});

// --- capturecard:loadDevice ---
ipcMain.handle('capturecard:loadDevice', async () => {
  const settings = loadSettings();
  return {
    success: true,
    deviceId: settings.capturecard_device_id || null,
    label: settings.capturecard_device_label || null
  };
});

const VideoProcessor = require('./video-processor');

ipcMain.handle('video:generate-slideshow', async (event, photosBase64, framePath, slotConfig, outputPath, durationPerPhoto, targetW, targetH) => {
  try {
    const out = await VideoProcessor.generateSlideshow(photosBase64, framePath, slotConfig, outputPath, durationPerPhoto, targetW, targetH);
    const dataBase64 = fs.readFileSync(out).toString('base64');
    return { success: true, path: out, base64: dataBase64 };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('video:generate-layout', async (event, videoClipsBase64, framePath, slotConfigs, outputPath, targetDuration, targetW, targetH) => {
  try {
    const out = await VideoProcessor.generateLayout(videoClipsBase64, framePath, slotConfigs, outputPath, targetDuration, targetW, targetH);
    const dataBase64 = fs.readFileSync(out).toString('base64');
    return { success: true, path: out, base64: dataBase64 };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file:read', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return { success: true, data: data.toString('base64') };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:write', async (event, filePath, data) => {
  try {
    // Auto-create parent directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:readDir', async (event, dirPath) => {
  try {
    return { success: true, files: fs.readdirSync(dirPath) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- file:saveCapture ---
// Save a photo/gif backup to userData/captures/YYYY-MM-DD/ after each session
ipcMain.handle('file:saveCapture', async (event, base64Data, extension) => {
  try {
    const userDataPath = app.getPath('userData');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const captureDir = path.join(userDataPath, 'captures', today);
    if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir, { recursive: true });

    const timestamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-'); // HH-MM-SS
    const filename = `photo_${timestamp}.${extension || 'jpg'}`;
    const filePath = path.join(captureDir, filename);

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    console.log(`[Backup] Saved: ${filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return { success: true, path: filePath };
  } catch (e) {
    console.error('[Backup] Failed to save capture:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('app:getPath', async (event, name) => app.getPath(name));
ipcMain.handle('app:getAppPath', async () => __dirname);

ipcMain.handle('print:photo', async (event, imagePath) => {
  return new Promise((resolve) => {
    const cmd = isWin
      ? `powershell -Command "Start-Process -FilePath '${imagePath}' -Verb Print"`
      : `lpr "${imagePath}"`;
    exec(cmd, (error, stdout, stderr) => {
      resolve(error ? { success: false, error: stderr || error.message } : { success: true });
    });
  });
});

ipcMain.handle('print:silentPrint', async (event, imagePath, options) => {
  return new Promise((resolve) => {
    const copies = (options && options.copies) ? parseInt(options.copies) : 1;
    const printerName = (options && options.printer) || '';
    const printMethod = (options && options.printMethod) || 'auto';

    if (isWin) {
      // =====================================================================
      // DNP DS-RX1 Windows Borderless Printing
      // =====================================================================
      // PRIMARY:  PowerShell + System.Drawing.Printing.PrintDocument
      //   - Writes image directly to PageBounds (the full physical paper area)
      //   - OriginAtMargins = false → renders from paper edge, not margin edge
      //   - Zero margins → no white border added by .NET
      //   - This is the ONLY Windows approach that achieves true borderless
      //
      // FALLBACK: mspaint /pt  (used if PowerShell fails)
      //   - mspaint always rescales to fit within the non-printable margin area
      //   - Produces white borders even with borderless enabled in driver
      // =====================================================================

      const dnpFill = (options && options.dnpFill) || 'yes';
      console.log(`[DNP Print] Printer: "${printerName || 'default'}", Copies: ${copies}`);
      console.log(`[DNP Print] Image: ${imagePath}`);

      // Build a PowerShell script that prints with zero margins to PageBounds
      const buildPS1Script = (imgPath, printer) => {
        const safeImg  = imgPath.replace(/\\/g, '\\\\').replace(/'/g, "''");
        const safePrt  = (printer || '').replace(/'/g, "''");
        return [
          'Add-Type -AssemblyName System.Drawing',
          `$img = [System.Drawing.Image]::FromFile('${safeImg}')`,
          '$pd  = New-Object System.Drawing.Printing.PrintDocument',
          safePrt ? `$pd.PrinterSettings.PrinterName = '${safePrt}'` : '',
          '$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)',
          '$pd.OriginAtMargins = $false',
          '$pd.add_PrintPage({',
          '    param($s, $e)',
          '    $b = $e.PageBounds',
          '    $e.Graphics.DrawImage($img, $b.X, $b.Y, $b.Width, $b.Height)',
          '    $e.HasMorePages = $false',
          '})',
          '$pd.Print()',
          'Start-Sleep -Milliseconds 4000',
          '$img.Dispose()',
          '$pd.Dispose()',
        ].filter(Boolean).join('\r\n');
      };

      const printOneCopy = async (method) => {
        return new Promise((res) => {
          let cmd;

          if (method === 'ps_drawing' || method === 'auto') {
            // Write PS1 to temp file (avoids all shell-escaping issues)
            const ps1Path = path.join(app.getPath('temp'), `dnp_print_${Date.now()}.ps1`);
            try {
              fs.writeFileSync(ps1Path, buildPS1Script(imagePath, printerName), 'utf8');
            } catch (e) {
              console.error('[DNP Print] Failed to write PS1 script:', e.message);
              res({ success: false, error: e.message });
              return;
            }
            cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}"`;
            console.log(`[DNP Print] PS1 borderless print: ${ps1Path}`);
            exec(cmd, { timeout: 45000 }, (error, stdout, stderr) => {
              // Clean up temp file
              try { fs.unlinkSync(ps1Path); } catch (_) {}
              if (error) {
                console.warn('[DNP Print] PS1 failed:', stderr || error.message);
                res({ success: false, error: stderr || error.message });
              } else {
                console.log('[DNP Print] ✅ PS1 print completed');
                res({ success: true });
              }
            });

          } else if (method === 'mspaint') {
            // mspaint /pt: fallback — adds margins, not truly borderless
            cmd = printerName
              ? `mspaint /pt "${imagePath}" "${printerName}"`
              : `mspaint /pt "${imagePath}"`;
            console.log(`[DNP Print] mspaint fallback: ${cmd}`);
            exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
              res({ success: !error, error: error ? (stderr || error.message) : null });
            });

          } else if (method === 'rundll32') {
            cmd = printerName
              ? `rundll32 shimgvw.dll,ImageView_PrintTo /pt "${imagePath}" "${printerName}"`
              : `rundll32 shimgvw.dll,ImageView_PrintTo "${imagePath}"`;
            exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
              res({ success: !error, error: error ? (stderr || error.message) : null });
            });

          } else {
            // powershell Start-Process fallback
            const safeImg = imagePath.replace(/'/g, "''");
            cmd = printerName
              ? `powershell -Command "Start-Process '${safeImg}' -Verb Print -WindowStyle Hidden"`
              : `powershell -Command "Start-Process '${safeImg}' -Verb Print -WindowStyle Hidden"`;
            exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
              res({ success: !error, error: error ? (stderr || error.message) : null });
            });
          }
        });
      };

      // Print all copies sequentially
      (async () => {
        let lastResult = { success: false };
        for (let i = 0; i < copies; i++) {
          // Primary: PowerShell System.Drawing (true borderless)
          lastResult = await printOneCopy('auto');
          if (!lastResult.success) {
            console.warn(`[DNP Print] Copy ${i + 1}/${copies} PS1 failed, trying mspaint fallback...`);
            lastResult = await printOneCopy('mspaint');
          }
          if (!lastResult.success) {
            console.error(`[DNP Print] Copy ${i + 1}/${copies} all methods failed:`, lastResult.error);
            break;
          } else {
            console.log(`[DNP Print] Copy ${i + 1}/${copies} sent OK`);
          }
          if (i < copies - 1) await new Promise(r => setTimeout(r, 3000));
        }
        resolve(lastResult);
      })();
    } else {
      // macOS / Linux: use lpr with DNP DS-RX1 CUPS driver options
      // DNP PageSize names (from lpoptions -l):
      //   200dnp5x3.5, dnp5x5, 210dnp5x7, 300dnp6x4, dnp6x6, 310dnp6x8
      // Cutter: Normal, NoWaste, 2Inch
      // Finish: Glossy, Matte
      const dnpPageSize = (options && options.dnpPageSize) || '300dnp6x4';
      const dnpCutter = (options && options.dnpCutter) || 'Normal';
      const dnpFinish = (options && options.dnpFinish) || 'Glossy';

      let cmd = 'lpr';
      if (printerName) cmd += ` -P "${printerName}"`;
      if (copies > 1) cmd += ` -# ${copies}`;
      cmd += ` -o PageSize=${dnpPageSize}`;
      cmd += ` -o Cutter=${dnpCutter}`;
      cmd += ` -o Finish=${dnpFinish}`;
      cmd += ' -o fill';
      cmd += ` "${imagePath}"`;

      console.log(`[DNP Print macOS] Printer: ${printerName || 'default'}, PageSize: ${dnpPageSize}, Cutter: ${dnpCutter}, Finish: ${dnpFinish}, Fill: yes, Copies: ${copies}`);
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error('[DNP Print macOS] Error:', stderr || error.message);
          resolve({ success: false, error: stderr || error.message });
        } else {
          console.log('[DNP Print macOS] Print job sent OK');
          resolve({ success: true });
        }
      });
    }
  });
});

ipcMain.handle('print:getPrinters', async () => {
  return new Promise((resolve) => {
    if (isWin) {
      const cmd = 'powershell -Command "Get-Printer | Select-Object Name, DriverName, PrinterStatus | ConvertTo-Json"';
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message, printers: [] });
          return;
        }
        try {
          let raw = JSON.parse(stdout.trim());
          if (!Array.isArray(raw)) raw = [raw];
          const printers = raw.map(p => ({
            name: p.Name,
            driver: p.DriverName || '',
            status: p.PrinterStatus === 0 ? 'ready' : (p.PrinterStatus === 1 ? 'paused' : 'offline'),
            isDNP: /dnp|ds[-\s]?rx/i.test(p.Name) || /dnp|ds[-\s]?rx/i.test(p.DriverName || '')
          }));
          const dnpPrinter = printers.find(p => p.isDNP);
          resolve({ success: true, printers, dnpDetected: dnpPrinter || null });
        } catch (e) {
          // Fallback: just get names
          exec('powershell -Command "Get-Printer | Select-Object -ExpandProperty Name"', (err2, out2) => {
            const names = (out2 || '').trim().split('\n').map(n => n.trim()).filter(n => n);
            const printers = names.map(name => ({
              name, driver: '', status: 'unknown',
              isDNP: /dnp|ds[-\s]?rx/i.test(name)
            }));
            resolve({ success: true, printers, dnpDetected: printers.find(p => p.isDNP) || null });
          });
        }
      });
    } else {
      exec('lpstat -p', (error, stdout) => {
        if (error) {
          resolve({ success: false, error: error.message, printers: [] });
          return;
        }
        const printers = [];
        const lines = (stdout || '').trim().split('\n');
        lines.forEach(line => {
          const match = line.match(/printer\s+(\S+)\s*(.*)/);
          if (match) {
            const name = match[1];
            const info = match[2] || '';
            printers.push({
              name,
              driver: '',
              status: /idle|ready/i.test(info) ? 'ready' : (/disabled/i.test(info) ? 'offline' : 'unknown'),
              isDNP: /dnp|ds[-\s]?rx/i.test(name)
            });
          }
        });
        resolve({ success: true, printers, dnpDetected: printers.find(p => p.isDNP) || null });
      });
    }
  });
});

// Query available paper sizes from a specific printer (for DNP auto-detect)
ipcMain.handle('print:getPaperSizes', async (event, printerName) => {
  return new Promise((resolve) => {
    if (!isWin) {
      resolve({ success: false, error: 'Only supported on Windows', sizes: [] });
      return;
    }
    const psScript = `
Add-Type -AssemblyName System.Drawing
$pd = New-Object System.Drawing.Printing.PrintDocument
$pd.PrinterSettings.PrinterName = '${(printerName || '').replace(/'/g, "''")}'
$sizes = @()
foreach ($ps in $pd.PrinterSettings.PaperSizes) {
  $wmm = [Math]::Round($ps.Width / 100.0 * 25.4, 1)
  $hmm = [Math]::Round($ps.Height / 100.0 * 25.4, 1)
  $sizes += "$($ps.PaperName)|$wmm|$hmm"
}
$pd.Dispose()
$sizes -join ";"
`;
    const scriptPath = path.join(app.getPath('temp'), 'dnp_sizes.ps1');
    fs.writeFileSync(scriptPath, psScript, 'utf8');
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, (error, stdout, stderr) => {
      try { fs.unlinkSync(scriptPath); } catch (e) { }
      if (error) {
        resolve({ success: false, error: stderr || error.message, sizes: [] });
        return;
      }
      const sizes = stdout.trim().split(';').filter(s => s).map(s => {
        const [name, w, h] = s.split('|');
        return { name: name.trim(), width_mm: parseFloat(w), height_mm: parseFloat(h) };
      });
      console.log(`[DNP] Paper sizes for "${printerName}":`, sizes);
      resolve({ success: true, sizes });
    });
  });
});

ipcMain.handle('print:getDefaultPrinter', async () => {
  return new Promise((resolve) => {
    const cmd = isWin
      ? 'powershell -Command "(Get-WmiObject -Query \\"SELECT * FROM Win32_Printer WHERE Default=$true\\").Name"'
      : 'lpstat -d';
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: stderr || error.message });
      } else {
        if (isWin) {
          resolve({ success: true, printer: stdout.trim() || null });
        } else {
          const match = stdout.match(/:\s*(.+)/);
          resolve({ success: true, printer: match ? match[1].trim() : null });
        }
      }
    });
  });
});

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow;
let javaProcess;
let cameraServerPort = 9999;
const isDev = process.argv.includes('--dev');

// ─── Java Camera Server Management ──────────────────────────────────────────

function getJarPath() {
  if (isDev) {
    // Development: JAR is in the camera-server build output
    return path.join(__dirname, '..', 'camera-server', 'target', 'canon-driver.jar');
  } else {
    // Production: JAR is bundled in extraResources
    return path.join(process.resourcesPath, 'java-server', 'canon-driver.jar');
  }
}

/**
 * Find the java.exe to use.
 * Our EDSDK.dll is 32-bit (x86), so we MUST use a 32-bit JRE.
 * 
 * 1. Prefer bundled Portable JRE 32-bit (Production)
 * 2. Prefer bundled Portable JRE 32-bit (Dev/Local)
 * 3. Fallback to common Windows 32-bit installations
 */
function getJavaExecutable() {
  const fs = require('fs');
  
  // 1. Check Bundled JRE in Production
  const bundledProdPath = path.join(process.resourcesPath || '', 'java-server', 'jre', 'bin', 'java.exe');
  if (fs.existsSync(bundledProdPath)) {
    console.log(`[Main] Using BUNDLED 32-bit JRE (Production): ${bundledProdPath}`);
    return bundledProdPath;
  }

  // 2. Check Bundled JRE in Development
  const bundledDevPath = path.join(__dirname, '..', 'buildResources', 'java-server', 'jre', 'bin', 'java.exe');
  if (fs.existsSync(bundledDevPath)) {
    console.log(`[Main] Using BUNDLED 32-bit JRE (Development): ${bundledDevPath}`);
    // If run on mac during dev, java.exe won't run. But we use 'java' command if mac.
    if (process.platform === 'win32') return bundledDevPath;
  }

  if (process.platform !== 'win32') {
    return 'java'; // Mac dev testing (uses system Java, but camera won't actually connect)
  }

  // 3. Fallback to System Program Files (x86)
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
        if (fs.existsSync(candidate)) {
          console.log(`[Main] Found System 32-bit JRE: ${candidate}`);
          return candidate;
        }
      }
    }
  } catch (e) {
    console.warn('[Main] Could not scan Program Files (x86):', e.message);
  }

  for (const p of x86JavaPaths) {
    if (fs.existsSync(p)) {
      console.log(`[Main] Using System 32-bit JRE: ${p}`);
      return p;
    }
  }

  console.warn('[Main] 32-bit JRE not found, using default "java" from PATH');
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

      // Detect the ready signal from Java server
      if (output.includes('CAMERA_SERVER_READY')) {
        clearTimeout(startTimeout);
        const match = output.match(/CAMERA_SERVER_READY:(\d+)/);
        if (match) {
          cameraServerPort = parseInt(match[1]);
        }
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
      resolve();
      return;
    }

    console.log('[Main] Sending shutdown request to Java server...');

    // First try graceful HTTP shutdown
    const req = http.request({
      hostname: '127.0.0.1',
      port: cameraServerPort,
      path: '/shutdown',
      method: 'POST',
      timeout: 3000
    }, (res) => {
      console.log('[Main] Shutdown request acknowledged');
      setTimeout(() => {
        if (javaProcess) {
          javaProcess.kill('SIGTERM');
        }
        resolve();
      }, 2000);
    });

    req.on('error', () => {
      // If HTTP fails, force kill
      if (javaProcess) {
        javaProcess.kill('SIGTERM');
        setTimeout(() => {
          if (javaProcess) {
            javaProcess.kill('SIGKILL');
          }
          resolve();
        }, 2000);
      } else {
        resolve();
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (javaProcess) {
        javaProcess.kill('SIGTERM');
      }
      resolve();
    });

    req.end();
  });
}

// ─── Electron Window ────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    fullscreen: !isDev,
    kiosk: !isDev,
    frame: isDev,
    resizable: isDev,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent window from closing accidentally in kiosk mode
  if (!isDev) {
    mainWindow.on('close', (e) => {
      // Only allow close if explicitly requested via IPC
      if (!app.isQuitting) {
        e.preventDefault();
      }
    });
  }
}

// ─── Prevent multiple instances (must be BEFORE ipcMain registrations) ───────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // ─── IPC Handlers ───────────────────────────────────────────────────────────

  ipcMain.handle('get-camera-port', () => {
    return cameraServerPort;
  });

  ipcMain.handle('capture-photo', async (event, filename) => {
    try {
      const response = await fetch(`http://127.0.0.1:${cameraServerPort}/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename || null })
      });
      return await response.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('save-screenshot', async (event, filename, dataUrl) => {
    try {
      if (!dataUrl) {
        throw new Error("No data URL provided");
      }
      const appDir = path.join(app.getPath('pictures'), 'PhotoboothKiosk');
      if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
      }
      
      const safeFilename = filename || `photobooth_screenshot_${Date.now()}.jpg`;
      const destPath = path.join(appDir, safeFilename);
      
      const base64Data = dataUrl.replace(/^data:image\/png;base64,|^data:image\/jpeg;base64,/, "");
      fs.writeFileSync(destPath, base64Data, 'base64');
      
      return { success: true, files: [destPath] };
    } catch (err) {
      console.error('[Main] Save screenshot failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-camera-status', async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${cameraServerPort}/status`);
      return await response.json();
    } catch (err) {
      return { initialized: false, error: err.message };
    }
  });

  ipcMain.handle('quit-app', async () => {
    app.isQuitting = true;
    await stopJavaServer();
    app.quit();
  });

  // ─── App Lifecycle ──────────────────────────────────────────────────────────

  app.whenReady().then(async () => {
    createWindow();

    // Start the Java camera server
    try {
      await startJavaServer();
      // Notify renderer that camera is ready
      if (mainWindow) {
        mainWindow.webContents.send('camera-server-ready', cameraServerPort);
      }
    } catch (err) {
      console.error('[Main] Camera server failed to start:', err);
      if (mainWindow) {
        mainWindow.webContents.send('camera-server-error', err.message);
      }
    }
  });

  app.on('window-all-closed', async () => {
    await stopJavaServer();
    app.quit();
  });

  app.on('before-quit', async (e) => {
    if (javaProcess) {
      e.preventDefault();
      await stopJavaServer();
      app.quit();
    }
  });
}

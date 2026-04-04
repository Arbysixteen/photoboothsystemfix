/**
 * Photobooth Kiosk - Renderer Process (Frontend Logic)
 * 
 * Communicates with:
 *  - Electron main process via window.cameraAPI (preload bridge)
 *  - Java camera server via HTTP (live view MJPEG + capture)
 */

// ─── State ──────────────────────────────────────────────────────────────────
let cameraPort = 9999;
let isCapturing = false;
let countdownSeconds = 3;
let lastCapturedFile = null;

// ─── DOM Elements ───────────────────────────────────────────────────────────
const screens = {
  loading:  document.getElementById('screen-loading'),
  welcome:  document.getElementById('screen-welcome'),
  preview:  document.getElementById('screen-preview'),
  result:   document.getElementById('screen-result'),
};

const loadingBarFill = document.getElementById('loadingBarFill');
const loadingStatus  = document.getElementById('loadingStatus');
const liveViewImg    = document.getElementById('liveViewImg');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber  = document.getElementById('countdownNumber');
const flashOverlay     = document.getElementById('flashOverlay');
const resultImage      = document.getElementById('resultImage');
const btnCapture       = document.getElementById('btnCapture');
const errorToast       = document.getElementById('errorToast');
const errorMessage     = document.getElementById('errorMessage');

// ─── Screen Navigation ─────────────────────────────────────────────────────
function switchScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

function goToWelcome() {
  stopLiveView();
  switchScreen('welcome');
}

function goToPreview() {
  switchScreen('preview');
  startLiveView();
}

function goToResult(imagePath) {
  stopLiveView();
  if (imagePath) {
    // Show captured image (file:// protocol for local files in Electron)
    resultImage.src = 'file://' + imagePath;
  }
  switchScreen('result');
}

// ─── Live View Stream ───────────────────────────────────────────────────────
function startLiveView() {
  // MJPEG stream via <img> src - browser natively decodes multipart/x-mixed-replace
  const streamUrl = `http://127.0.0.1:${cameraPort}/liveview?t=${Date.now()}`;
  liveViewImg.src = streamUrl;
  
  liveViewImg.onerror = () => {
    console.warn('Live view stream error, retrying in 2s...');
    setTimeout(() => {
      if (screens.preview.classList.contains('active')) {
        liveViewImg.src = `http://127.0.0.1:${cameraPort}/liveview?t=${Date.now()}`;
      }
    }, 2000);
  };
}

function stopLiveView() {
  liveViewImg.src = '';
  liveViewImg.onerror = null;
}

// ─── Capture Flow ───────────────────────────────────────────────────────────
async function startCapture() {
  if (isCapturing) return;
  isCapturing = true;
  btnCapture.disabled = true;

  try {
    // Countdown
    await runCountdown();
    
    // Flash effect
    triggerFlash();

    // Take photo via Canvas Screenshot of Live View
    const filename = `photobooth_${Date.now()}.jpg`;
    
    // Create an offscreen canvas to capture the image
    const canvas = document.createElement('canvas');
    canvas.width = liveViewImg.naturalWidth || liveViewImg.width || 1280;
    canvas.height = liveViewImg.naturalHeight || liveViewImg.height || 720;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(liveViewImg, 0, 0, canvas.width, canvas.height);
    
    // Convert to Base64 JPEG data url
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    
    // Save via Electron IPC
    const result = await window.cameraAPI.saveScreenshot(filename, dataUrl);
    
    if (result.success && result.files && result.files.length > 0) {
      lastCapturedFile = result.files[0];
      goToResult(lastCapturedFile);
    } else {
      showError(result.error || 'Gagal mengambil foto');
    }
  } catch (err) {
    console.error('Capture error:', err);
    showError('Terjadi kesalahan: ' + err.message);
  } finally {
    isCapturing = false;
    btnCapture.disabled = false;
  }
}

function runCountdown() {
  return new Promise((resolve) => {
    let count = countdownSeconds;
    countdownOverlay.classList.remove('hidden');
    countdownNumber.textContent = count;
    
    // Re-trigger animation
    countdownNumber.style.animation = 'none';
    countdownNumber.offsetHeight; // Force reflow
    countdownNumber.style.animation = '';

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        countdownOverlay.classList.add('hidden');
        resolve();
      } else {
        countdownNumber.textContent = count;
        // Re-trigger pop animation
        countdownNumber.style.animation = 'none';
        countdownNumber.offsetHeight;
        countdownNumber.style.animation = '';
      }
    }, 1000);
  });
}

function triggerFlash() {
  flashOverlay.classList.remove('flash-active');
  flashOverlay.offsetHeight; // Force reflow
  flashOverlay.classList.add('flash-active');
  setTimeout(() => {
    flashOverlay.classList.remove('flash-active');
  }, 600);
}

// ─── Print ──────────────────────────────────────────────────────────────────
function printPhoto() {
  if (!lastCapturedFile) {
    showError('Tidak ada foto untuk dicetak');
    return;
  }
  // Open print dialog via Electron
  window.print();
}

// ─── Settings ───────────────────────────────────────────────────────────────
function toggleSettings() {
  // Placeholder for future settings panel
  console.log('Settings toggled (not yet implemented)');
}

// ─── Error Toast ────────────────────────────────────────────────────────────
function showError(message) {
  errorMessage.textContent = message;
  errorToast.classList.remove('hidden');
  setTimeout(() => {
    errorToast.classList.add('hidden');
  }, 4000);
}

// ─── Particles Generator ────────────────────────────────────────────────────
function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.animationDuration = (8 + Math.random() * 12) + 's';
    particle.style.animationDelay = (Math.random() * 10) + 's';
    particle.style.width = (2 + Math.random() * 4) + 'px';
    particle.style.height = particle.style.width;
    
    // Random color from palette
    const colors = ['#7c5cfc', '#c084fc', '#f97316', '#22c55e'];
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    
    container.appendChild(particle);
  }
}

// ─── Initialization ─────────────────────────────────────────────────────────
async function init() {
  createParticles();
  
  // Update loading progress
  function updateLoading(percent, status) {
    loadingBarFill.style.width = percent + '%';
    loadingStatus.textContent = status;
  }

  updateLoading(10, 'Memulai sistem...');

  // Listen for camera server ready signal from main process
  if (window.cameraAPI) {
    window.cameraAPI.onCameraReady((port) => {
      cameraPort = port;
      updateLoading(100, 'Kamera siap!');
      setTimeout(() => {
        switchScreen('welcome');
      }, 800);
    });

    window.cameraAPI.onCameraError((error) => {
      updateLoading(50, 'Gagal menghubungkan kamera');
      showError('Kamera error: ' + error);
      // Still allow proceeding to welcome (for UI testing without camera)
      setTimeout(() => {
        switchScreen('welcome');
      }, 3000);
    });

    // Simulate loading progress while waiting for Java server
    let progress = 10;
    const loadingInterval = setInterval(() => {
      if (progress < 85) {
        progress += Math.random() * 8;
        updateLoading(Math.min(progress, 85), 'Menghubungkan kamera Canon...');
      }
    }, 500);

    // Get port (may already be set)
    try {
      const port = await window.cameraAPI.getCameraPort();
      if (port) cameraPort = port;
    } catch (e) {
      console.warn('Could not get camera port:', e);
    }

    // Cleanup interval when loaded
    window.cameraAPI.onCameraReady(() => {
      clearInterval(loadingInterval);
    });
    window.cameraAPI.onCameraError(() => {
      clearInterval(loadingInterval);
    });

  } else {
    // No cameraAPI (running outside Electron, e.g., in browser for testing)
    console.warn('cameraAPI not available, running in demo mode');
    updateLoading(50, 'Mode demo (tanpa Electron)');
    
    setTimeout(() => {
      updateLoading(100, 'Siap (mode demo)');
      setTimeout(() => switchScreen('welcome'), 600);
    }, 1500);
  }
}

// ─── Keyboard shortcuts (dev mode) ──────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // ESC to quit (dev only)
  if (e.key === 'Escape' && window.cameraAPI) {
    window.cameraAPI.quitApp();
  }
  // Space to capture (when on preview screen)
  if (e.key === ' ' && screens.preview.classList.contains('active')) {
    e.preventDefault();
    startCapture();
  }
});

// Start the app
init();

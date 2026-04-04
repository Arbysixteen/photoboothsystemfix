const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script: exposes a safe API bridge from Main process to Renderer.
 * 
 * Usage in renderer:
 *   window.cameraAPI.getCameraPort()
 *   window.cameraAPI.capturePhoto('myfile.jpg')
 *   window.cameraAPI.getCameraStatus()
 *   window.cameraAPI.quitApp()
 *   window.cameraAPI.onCameraReady(callback)
 *   window.cameraAPI.onCameraError(callback)
 */
contextBridge.exposeInMainWorld('cameraAPI', {
  getCameraPort: () => ipcRenderer.invoke('get-camera-port'),
  capturePhoto: (filename) => ipcRenderer.invoke('capture-photo', filename),
  saveScreenshot: (filename, dataUrl) => ipcRenderer.invoke('save-screenshot', filename, dataUrl),
  getCameraStatus: () => ipcRenderer.invoke('get-camera-status'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Event listeners from main process
  onCameraReady: (callback) => {
    ipcRenderer.on('camera-server-ready', (event, port) => callback(port));
  },
  onCameraError: (callback) => {
    ipcRenderer.on('camera-server-error', (event, error) => callback(error));
  }
});

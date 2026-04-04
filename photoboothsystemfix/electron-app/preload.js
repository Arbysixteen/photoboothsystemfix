const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
        quit: () => ipcRenderer.invoke('window:quit')
    },

    // Quick fullscreen toggle
    toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),

    // Canon EDSDK Camera Server connection
    camera: {
        getPort: () => ipcRenderer.invoke('get-camera-port'),
        startServer: () => ipcRenderer.invoke('camera:startServer'),
        stopServer: () => ipcRenderer.invoke('camera:stopServer'),
        onCameraReady: (callback) => ipcRenderer.on('camera-server-ready', (event, port) => callback(port)),
        onCameraError: (callback) => ipcRenderer.on('camera-server-error', (event, error) => callback(error))
    },

    // Capture Card — DSLR connected via HDMI capture card (Legacy)
    // Preview and capture are renderer-side (getUserMedia); these IPCs handle
    // device enumeration and persisting the selected device across restarts.
    capturecard: {
        getDevices: () => ipcRenderer.invoke('capturecard:getDevices'),
        saveDevice: (deviceId, label) => ipcRenderer.invoke('capturecard:saveDevice', deviceId, label),
        loadDevice: () => ipcRenderer.invoke('capturecard:loadDevice')
    },

    // File operations
    file: {
        read: (filePath) => ipcRenderer.invoke('file:read', filePath),
        write: (filePath, data) => ipcRenderer.invoke('file:write', filePath, data),
        readDir: (dirPath) => ipcRenderer.invoke('file:readDir', dirPath),
        saveCapture: (base64Data, extension) => ipcRenderer.invoke('file:saveCapture', base64Data, extension)
    },

    // Video/FFmpeg operations
    video: {
        generateSlideshow: (photosBase64, framePath, slotConfig, outputPath, durationPerPhoto, targetW, targetH) => 
            ipcRenderer.invoke('video:generate-slideshow', photosBase64, framePath, slotConfig, outputPath, durationPerPhoto, targetW, targetH),
        generateLayout: (videoClipsBase64, framePath, slotConfigs, outputPath, targetDuration, targetW, targetH) => 
            ipcRenderer.invoke('video:generate-layout', videoClipsBase64, framePath, slotConfigs, outputPath, targetDuration, targetW, targetH)
    },

    // App utilities
    app: {
        getPath: (name) => ipcRenderer.invoke('app:getPath', name),
        getAppPath: () => ipcRenderer.invoke('app:getAppPath'),
        isDev: process.argv.includes('--dev')
    },

    // Printing
    print: {
        photo: (imagePath) => ipcRenderer.invoke('print:photo', imagePath),
        silentPrint: (imagePath, options) => ipcRenderer.invoke('print:silentPrint', imagePath, options),
        getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
        getPaperSizes: (printerName) => ipcRenderer.invoke('print:getPaperSizes', printerName),
        getDefaultPrinter: () => ipcRenderer.invoke('print:getDefaultPrinter')
    }
});

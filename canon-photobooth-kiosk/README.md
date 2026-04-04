# Canon Photobooth Kiosk

Aplikasi Photobooth mandiri menggunakan **Electron.js** (UI Kiosk) + **Java Canon EDSDK** (Hardware Control) yang bisa di-package menjadi `.exe` untuk Windows.

## 🏗️ Arsitektur

```
┌─────────────────────────────────────┐
│         Electron.js (Kiosk UI)      │
│  ┌────────────────────────────────┐ │
│  │  Layar Sentuh / Touch Screen   │ │
│  │  - Welcome Screen              │ │
│  │  - Live View Preview           │ │
│  │  - Countdown & Flash           │ │
│  │  - Photo Result & Print        │ │
│  └────────────────────────────────┘ │
│            │ HTTP (localhost:9999)   │
│            ▼                        │
│  ┌────────────────────────────────┐ │
│  │  Java Camera Server (.jar)     │ │
│  │  - GET  /liveview (MJPEG)      │ │
│  │  - POST /capture  (Take Photo) │ │
│  │  - GET  /status  (JSON)        │ │
│  │  - POST /shutdown (Exit)       │ │
│  └────────────────────────────────┘ │
│            │ USB (EDSDK/JNA)        │
│            ▼                        │
│  ┌────────────────────────────────┐ │
│  │      Canon DSLR Camera         │ │
│  │      (EOS 6D, 5D, etc.)       │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## 📁 Struktur Folder

```
canon-photobooth-kiosk/
├── camera-server/           # Java Maven project (Camera Microservice)
│   ├── pom.xml
│   └── src/main/java/com/photobooth/camera/
│       ├── CameraServerApp.java    # Entry point HTTP server
│       ├── CameraService.java      # Canon EDSDK wrapper
│       ├── LiveViewHandler.java    # MJPEG live view stream
│       ├── CaptureHandler.java     # Photo capture endpoint
│       └── StatusHandler.java      # Camera status endpoint
│
├── electron-app/            # Electron.js Kiosk UI
│   ├── package.json
│   ├── main.js              # Electron main process (spawns Java)
│   ├── preload.js           # IPC bridge
│   └── src/
│       ├── index.html       # Kiosk HTML (4 screens)
│       ├── styles/main.css  # Premium dark UI design
│       └── renderer/app.js  # Frontend logic
│
└── buildResources/          # Untuk packaging .exe
    └── java-server/         # Taruh canon-driver.jar disini
```

## 🚀 Cara Menjalankan (Development)

### Prasyarat
- **Java JDK 11+** terinstal
- **Maven 3.x** terinstal
- **Node.js 18+** terinstal
- **Canon EDSDK DLL** di PATH sistem (Windows)
- Kamera Canon terhubung via USB

### Langkah 1: Build Java Camera Server

```bash
# Pertama, install canon-sdk-java ke local Maven repo
cd ../canon-sdk-java
mvn install -DskipTests -P mockLibrary

# Lalu build camera-server
cd ../canon-photobooth-kiosk/camera-server
mvn clean package -DskipTests
```

Hasil: `camera-server/target/canon-driver.jar`

### Langkah 2: Install & Jalankan Electron App

```bash
cd ../electron-app
npm install
npm run dev
```

Electron akan otomatis:
1. Membuka window kiosk (mode dev = ada frame + DevTools)
2. Menjalankan `java -jar canon-driver.jar` di background
3. Menunggu sinyal `CAMERA_SERVER_READY:9999`
4. Menampilkan UI kiosk setelah kamera siap

### Langkah 3: Test Tanpa Kamera (UI Only)

Buka `electron-app/src/index.html` langsung di browser untuk melihat UI tanpa koneksi kamera. App akan masuk "mode demo" secara otomatis.

## 📦 Build Produksi (.exe)

```bash
# 1. Build JAR
cd camera-server
mvn clean package -DskipTests

# 2. Copy JAR ke buildResources
cp target/canon-driver.jar ../buildResources/java-server/

# 3. Build .exe
cd ../electron-app
npm run build
```

Hasil installer: `electron-app/dist/Photobooth Kiosk Setup.exe`

### Requirement Mesin Target
- Windows 10/11 (x64)
- Java JRE 11+ terinstal *(atau bundle JRE portabel)*
- Canon EDSDK DLL di PATH
- Kamera Canon terhubung USB

## 🔧 API Endpoints (Java Server)

| Method | Path        | Deskripsi                          |
|--------|-------------|-------------------------------------|
| GET    | `/status`   | Status kamera (JSON)               |
| GET    | `/liveview` | MJPEG stream live view             |
| POST   | `/capture`  | Ambil foto, simpan ke disk (JSON)  |
| POST   | `/shutdown` | Matikan server dengan aman         |

### Contoh Response `/capture`
```json
{
  "success": true,
  "count": 1,
  "files": ["C:\\photobooth\\captures\\photobooth_1234567890.jpg"],
  "timestamp": 1234567890123
}
```

## ⚙️ Konfigurasi

### Mengubah Port Camera Server
```bash
# Via command line argument
java -jar canon-driver.jar 8888

# Atau di main.js Electron
let cameraServerPort = 8888;
```

### Mode Kiosk vs Development
```bash
# Development (ada frame, DevTools)
npm run dev

# Production / Kiosk (fullscreen, tanpa frame)
npm start
```

## 📝 Catatan Teknis

- **Live View** menggunakan MJPEG over HTTP (`multipart/x-mixed-replace`), didukung native oleh tag `<img>` di browser
- **Preview di-mirror** (`transform: scaleX(-1)`) agar pengguna melihat diri secara alami (seperti cermin)
- **Foto hasil** TIDAK di-mirror (orientasi asli dari kamera)
- **Capture** menyimpan ke folder `captures/` di working directory
- **Shutdown** dilakukan secara graceful: HTTP request → close session → terminate SDK → kill process

# Build Electron App menjadi .exe (Windows)

Panduan untuk build FRIPLUS Photobooth Electron app menjadi installer Windows (`.exe`).

---

## Prasyarat

- **Node.js** v18+ terinstall
- **npm** v9+
- Koneksi internet (untuk download Electron binary)

> Build `.exe` untuk Windows **bisa dilakukan dari macOS/Linux** — tidak perlu Windows.

---

## Langkah 1 — Persiapan Sebelum Build

### 1.1 Pastikan API URL sudah benar untuk production

Edit `src/js/app-web.js` baris paling atas — ubah fallback API_BASE ke URL production:

```js
const API_BASE = localStorage.getItem('photobooth_api_base') 
    || 'https://photobooth.friplus.net/api';  // ← ganti ke URL hosting kamu
```

### 1.2 Pastikan `captures/settings.json` ada

File ini menyimpan config capture card. Pastikan ada (boleh kosong):
```bash
echo "{}" > captures/settings.json
```

### 1.3 Install dependencies
```bash
cd electron-app
npm install
```

---

## Langkah 2 — Build

### Build untuk Windows (dari macOS/Linux)
```bash
npm run build:win
```

### Build untuk macOS
```bash
npm run build:mac
```

### Build untuk semua platform
```bash
npm run build:win && npm run build:mac
```

---

## Langkah 3 — Hasil Build

Output ada di folder `dist/`:

```
electron-app/dist/
├── FriPlus Photobooth Setup 1.0.0.exe   ← installer untuk Windows
├── FriPlus Photobooth Setup 1.0.0.exe.blockmap
├── builder-debug.yml
├── win-unpacked/                         ← versi portable (tanpa install)
│   └── FriPlus Photobooth.exe
└── latest.yml
```

| File | Keterangan |
|---|---|
| `...Setup 1.0.0.exe` | Installer NSIS — user double-click untuk install |
| `win-unpacked/` | Portable — bisa langsung dijalankan tanpa install |

---

## Langkah 4 — Install di PC Photobooth (Windows)

### Opsi A — Via Installer (direkomendasikan)
1. Copy `FriPlus Photobooth Setup 1.0.0.exe` ke PC Windows
2. Double-click → Next → Install
3. Shortcut akan muncul di Desktop
4. Double-click shortcut untuk jalankan

### Opsi B — Via Portable (tanpa install)
1. Copy folder `win-unpacked/` ke PC Windows (e.g. `C:\Photobooth\`)
2. Double-click `FriPlus Photobooth.exe`

---

## Langkah 5 — Setup Awal di PC Windows (setelah install)

### 5.1 Set API URL
Buka app → klik gear icon (pojok kanan bawah, hampir transparan) 5x cepat → Admin Panel

Di bagian **API Settings**:
```
API URL: https://photobooth.friplus.net/api
```
Klik **Save API URL**

### 5.2 Set Capture Card
Di Admin Panel → **Camera Settings**:
1. Klik **Detect Devices**
2. Pilih capture card dari dropdown
3. Klik **Test Preview** untuk verifikasi
4. Klik **Simpan Pilihan**

### 5.3 Set Printer
Di Admin Panel → **Printer Settings**:
1. Klik **Detect Printers**
2. Pilih **Dai Nippon Printing DS-RX1**
3. Set paper size, finish, dll.
4. Klik **Simpan Pengaturan**

---

## Konfigurasi `package.json` untuk Build

Pastikan `package.json` sudah benar:

```json
{
  "build": {
    "appId": "com.friplus.photobooth",
    "productName": "FriPlus Photobooth",
    "files": [
      "main.js",
      "preload.js",
      "src/**/*",
      "captures/settings.json",
      "node_modules/**/*"
    ],
    "win": {
      "target": ["nsis"],
      "icon": "src/assets/icon.ico"    ← tambahkan icon jika ada
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

---

## Autostart saat Windows Menyala (Kiosk Mode)

Agar app otomatis berjalan saat PC dinyalakan:

### Via Task Scheduler (direkomendasikan)
1. Buka **Task Scheduler** (cari di Start)
2. **Create Basic Task** → beri nama "FriPlus Photobooth"
3. Trigger: **When the computer starts**
4. Action: **Start a program**
5. Program: path ke `FriPlus Photobooth.exe`
6. Centang **Run with highest privileges**

### Via Startup Folder
1. Tekan `Win + R` → ketik `shell:startup` → Enter
2. Buat shortcut ke `FriPlus Photobooth.exe` di folder itu

---

## Troubleshooting Build

| Error | Solusi |
|---|---|
| `Error: Cannot find module 'electron'` | Jalankan `npm install` dulu |
| Build gagal karena wine (cross-compile) | Install wine: `brew install wine-stable` di macOS |
| `ENOENT captures/settings.json` | Buat file: `echo "{}" > captures/settings.json` |
| Antivirus Windows blokir .exe | Tambahkan exception di antivirus, atau beli code signing certificate |
| App tidak fullscreen di Windows | Cek resolusi display, pastikan bukan mode scaling 150%+ |

---

## Update Versi

Untuk update app:
1. Edit kode
2. Ubah versi di `package.json`: `"version": "1.0.1"`
3. Jalankan `npm run build:win` ulang
4. Distribute installer baru ke PC photobooth

---

*Dibuat untuk FRIPLUS Photobooth — Electron 27 + Node.js 18+*

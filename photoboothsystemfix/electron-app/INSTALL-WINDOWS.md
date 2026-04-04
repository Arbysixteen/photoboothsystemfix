# FriPlus Photobooth — Panduan Install di Windows

## Prasyarat (Install Dulu)

### 1. Node.js
- Download: https://nodejs.org/en/download (pilih **LTS**, Windows Installer .msi)
- Install dengan default settings
- Verifikasi: buka **Command Prompt** / **PowerShell**, ketik:
  ```
  node --version
  npm --version
  ```

### 2. gPhoto2 (untuk Canon 6D DSLR Capture)
- Download: https://github.com/gphoto/gphoto2/releases
- Atau install via **MSYS2**:
  ```
  pacman -S mingw-w64-x86_64-gphoto2
  ```
- Alternatif lebih mudah: gunakan **gPhoto2 Windows binary** dari:
  https://github.com/AdrianFreundworker/gphoto2-windows
- Pastikan `gphoto2.exe` ada di PATH
- Verifikasi:
  ```
  gphoto2 --version
  ```

### 3. Canon EOS Utility (OPSIONAL)
- **JANGAN** jalankan EOS Utility bersamaan dengan Photobooth
- EOS Utility akan mengunci USB dan mengganggu gPhoto2
- Tutup EOS Utility sebelum menjalankan Photobooth

---

## Cara Install & Jalankan (Development)

### Langkah 1: Copy folder project
Copy seluruh folder `electron-app` ke komputer Windows.

### Langkah 2: Install dependencies
Buka **Command Prompt** atau **PowerShell** di folder `electron-app`:
```bash
cd path\to\electron-app
npm install
```

### Langkah 3: Jalankan aplikasi
```bash
npm start
```
Atau dengan logging:
```bash
npm run dev
```

---

## Build .exe Installer

### Langkah 1: Install electron-builder
```bash
npm install --save-dev electron-builder
```

### Langkah 2: (Opsional) Siapkan icon
- Buat file icon `src/assets/icon.ico` (256x256 px, format .ico)
- Jika tidak ada icon, hapus baris `"icon"` dari `package.json` bagian `"win"`

### Langkah 3: Build
```bash
npm run build:win
```

### Hasil Build
Setelah build selesai, file installer ada di:
```
electron-app/dist/FriPlus Photobooth Setup 1.0.0.exe
```

File ini bisa langsung di-install di komputer Windows manapun.

---

## Troubleshooting

### Canon 6D tidak terdeteksi
1. Pastikan kabel USB terhubung dengan baik
2. Pastikan kamera **ON** dan dalam mode **Manual (M)**
3. Tutup **EOS Utility** jika sedang berjalan
4. Cek di Command Prompt:
   ```
   gphoto2 --auto-detect
   ```
5. Jika masih tidak terdeteksi, cabut-colok USB dan coba lagi

### Capture delay / lambat
1. Set kamera ke **Manual Focus (MF)** — autofocus menambah delay
2. Set **Image Quality** ke **JPEG Fine** (bukan RAW)
3. Set **Shutter Speed** minimal **1/125**
4. Matikan **Image Review** di LCD kamera

### Webcam tidak terdeteksi
1. Buka **Admin Settings** (ketik `/admin` di URL bar)
2. Pilih webcam yang benar dari dropdown
3. Pastikan webcam tidak dipakai aplikasi lain

### Build gagal
1. Pastikan Node.js versi LTS (18+)
2. Jalankan `npm install` ulang
3. Jika error permission: jalankan Command Prompt sebagai **Administrator**

---

## Setting Kamera Canon 6D (Rekomendasi)

| Setting | Nilai |
|---|---|
| Mode | **M (Manual)** |
| Shutter Speed | **1/125 - 1/200** |
| Aperture | **f/5.6 - f/8** |
| ISO | **400 - 800** |
| White Balance | **Manual / Flash** |
| Focus | **Manual Focus (MF)** |
| Image Quality | **JPEG Fine (L)** |
| Auto Power Off | **Disable** |
| Image Review | **Off** |

---

## Struktur File

```
electron-app/
├── main.js              # Electron main process (cross-platform)
├── preload.js           # IPC bridge
├── package.json         # Dependencies + build config
├── src/
│   ├── index.html       # Main UI
│   ├── admin.html       # Admin settings
│   ├── styles/
│   │   └── main.css     # Styles
│   ├── js/
│   │   ├── app.js       # App logic (Electron)
│   │   ├── app-web.js   # App logic (Web fallback)
│   │   └── canvas.js    # Canvas compositor
│   └── assets/          # Icons, images
├── captures/            # Captured photos (auto-created)
└── dist/                # Build output (after npm run build:win)
```

---

## Catatan Penting

- **gPhoto2 di Windows** tidak memiliki masalah `icdd` seperti di macOS
- Canon 6D **langsung terdeteksi** tanpa perlu kill process
- Untuk **kiosk mode** (fullscreen tanpa taskbar): tekan **F11** di aplikasi
- Admin settings bisa diakses via menu atau URL `/admin`

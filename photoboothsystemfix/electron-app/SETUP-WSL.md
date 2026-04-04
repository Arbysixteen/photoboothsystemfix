# Setup WSL2 + gPhoto2 untuk Photobooth (Windows)

Panduan ini menjelaskan cara setup WSL2 + gPhoto2 agar aplikasi Photobooth bisa mengontrol kamera DSLR di Windows.

## Prasyarat

- Windows 10 (build 19041+) atau Windows 11
- Virtualization (Hyper-V) harus aktif di BIOS
- Koneksi internet untuk download
- **Perlu restart komputer 1x** setelah install WSL2

---

## Step 1: Install WSL2 + Ubuntu

Buka **PowerShell sebagai Administrator**, lalu jalankan:

```powershell
wsl --install
```

Ini akan:
- Mengaktifkan fitur WSL2
- Download dan install Ubuntu (default)
- **Restart komputer diperlukan**

Setelah restart, buka Ubuntu dari Start Menu. Buat username dan password saat diminta.

---

## Step 2: Install gPhoto2 di Ubuntu (WSL)

Buka terminal Ubuntu (WSL), lalu jalankan:

```bash
sudo apt update
sudo apt install -y gphoto2 libgphoto2-dev
```

Verifikasi instalasi:

```bash
gphoto2 --version
```

---

## Step 3: Install usbipd-win (USB Passthrough)

Kembali ke **PowerShell Windows (Administrator)**, jalankan:

```powershell
winget install --exact dorssel.usbipd-win
```

Atau download installer dari: https://github.com/dorssel/usbipd-win/releases

> **Catatan**: Setelah install usbipd-win, mungkin perlu restart komputer.

---

## Step 4: Hubungkan Kamera DSLR via USB

1. Nyalakan kamera DSLR
2. Set kamera ke mode **PTP** (bukan Mass Storage)
3. Hubungkan kamera ke komputer via USB

---

## Step 5: Bind & Attach Kamera ke WSL

### 5a. Cari Bus ID kamera

Buka **PowerShell (Administrator)**:

```powershell
usbipd list
```

Output contoh:
```
Connected:
BUSID  VID:PID    DEVICE                          STATE
1-3    04a9:3218  Canon Digital Camera             Not shared
2-1    0bda:5411  USB Hub                          Not shared
```

Catat **BUSID** kamera (contoh: `1-3`).

### 5b. Bind kamera (1x saja)

```powershell
usbipd bind --busid=1-3
```

### 5c. Attach kamera ke WSL

```powershell
usbipd attach --wsl --busid=1-3
```

> **Penting**: Setiap kali kamera di-unplug/replug, perlu jalankan `usbipd attach` lagi.

---

## Step 6: Verifikasi di WSL

Buka terminal Ubuntu (WSL):

```bash
gphoto2 --auto-detect
```

Output yang diharapkan:
```
Model                          Port
----------------------------------------------------------
Canon EOS 6D                   usb:001,004
```

Jika kamera terdeteksi, setup selesai!

---

## Step 7: Jalankan Photobooth

```powershell
cd "C:\Photobooth Demo\electron-app"
npm run dev
```

Aplikasi akan otomatis:
1. Cek apakah WSL + gPhoto2 tersedia
2. Attach USB kamera ke WSL (via usbipd)
3. Detect kamera DSLR
4. Mulai live preview

---

## Auto-Start (Opsional)

Agar kamera otomatis di-attach ke WSL setiap kali komputer dinyalakan:

1. Tekan `Win+R`, ketik `shell:startup`, Enter
2. Buat file `wsl_camera.bat` dengan isi:

```batch
@echo off
wsl --exec dbus-launch true
:loop
usbipd attach --wsl --busid=1-3
timeout /t 2 >nul
goto loop
```

> Ganti `1-3` dengan Bus ID kamera kamu.

---

## Troubleshooting

### "WSL + gPhoto2 not available"
- Pastikan WSL2 sudah terinstall: `wsl --status`
- Pastikan gPhoto2 terinstall di WSL: `wsl gphoto2 --version`

### "No camera detected"
- Pastikan kamera sudah di-attach ke WSL: `usbipd list` (status harus "Attached")
- Pastikan kamera dalam mode PTP
- Coba: `wsl gphoto2 --auto-detect`

### "Could not claim the USB device"
- Kill proses yang mungkin menahan kamera:
  ```bash
  wsl killall -9 gphoto2 2>/dev/null
  ```
- Pastikan EOS Utility tidak berjalan di Windows

### "usbipd not recognized"
- Install usbipd-win: `winget install dorssel.usbipd-win`
- Restart PowerShell setelah install

### Kamera terdeteksi tapi preview tidak muncul
- Pastikan kamera support Live View
- Coba manual: `wsl gphoto2 --capture-movie --stdout > /dev/null`

# Rami — Website Storefront & Integrasi Olsera POS

Sistem pemesanan online storefront untuk **Rami Coffee & Eatery** yang dilengkapi:
1. **Input Kode Promo** (diskon % atau potongan nominal rupiah)
2. **Pembayaran QRIS Statis** dengan gambar QR Code yang diinput/diupload manual oleh kamu
3. **Database Menu & Produk Persisten** (`data/db.json`)
4. **Fitur Upload Gambar Menu** & **Pembenaran Harga Menu** langsung dari Panel Admin
5. **Integrasi Kasir Olsera POS** (sinkronisasi pesanan, rincian pembayaran, dan katalog harga)

---

## 🚀 Fitur-Fitur Utama

### 1. 🎟️ Input Kode Promo di Keranjang
- Pelanggan dapat memasukkan kode promo di drawer keranjang (contoh: `RAMI10`, `RAMI20K`).
- Diskon otomatis mengurangi total tagihan sebelum pajak.
- Kode promo dapat ditambah atau diubah langsung melalui **Panel Admin -> Tab Kode Promo**.

### 2. 📲 Pembayaran QRIS dengan Gambar QR Statis Manual
- Saat checkout dengan metode pembayaran **QRIS**, pop-up pembayaran QRIS akan muncul dengan:
  - **Gambar QR Code QRIS Statis** tokomu.
  - Tagihan nominal persis yang harus ditransfer (sudah termasuk promo & pajak).
  - Countdown timer 10 menit.
  - Tombol **"✓ Saya Sudah Bayar"** yang langsung mengonfirmasi pesanan lunas dan meneruskannya ke kasir Olsera POS.
- **Upload Gambar QRIS**: Kamu bisa mengunggah file gambar QRIS kamu sendiri secara langsung melalui **Panel Admin -> Tab Pengaturan QRIS**.

### 3. ☕ Database & Pembenaran Harga Menu
- Data tersimpan persisten di `data/db.json` (tidak hilang saat server di-restart).
- Pada **Panel Admin -> Tab Kelola Menu & Harga**:
  - Kolom input harga siap edit untuk tiap menu. Klik **"Simpan"** untuk langsung mengubah harga di web dan mengupdate ke kasir Olsera POS.
  - Tambah menu baru dengan deskripsi, kategori, dan SKU Olsera.
  - **Upload Foto Menu**: Langsung pilih file foto dari laptop/HP untuk dijadikan gambar menu.

### 4. 🔄 Integrasi Olsera POS
- Terkoneksi ke Olsera POS (`olsera-client.js`).
- Pesanan yang telah dikonfirmasi bayar (QRIS/Kasir) otomatis masuk ke antrean pesanan Olsera dengan rincian:
  - Metode pembayaran & status lunas (`paid`)
  - SKU produk, nama item, jumlah, dan harga satuan
  - Potongan diskon promo & nilai pajak
- Terdapat log sinkronisasi langsung di tab Olsera POS.

---

## 🛠️ Cara Menjalankan

### 1. Jalankan Backend (Node.js Express)
Buka terminal / PowerShell di folder proyek ini:
```bash
npm install
npm start
```
Server akan berjalan di `http://localhost:4000`.

### 2. Buka Aplikasi di Browser
- Kamu bisa langsung membuka browser dan mengakses:
  ```
  http://localhost:4000
  ```
  atau cukup buka file `index.html` dengan klik dua kali.

### 3. Konfigurasi Olsera POS Asli (Live)
Buka file `.env`:
```env
MOCK_MODE=false
OLSERA_API_BASE_URL=https://api.olsera.com/v1
OLSERA_API_KEY=masukkan_api_key_olsera_kamu
OLSERA_OUTLET_ID=masukkan_id_outlet_kamu
```
*(Catatan: Secara default `MOCK_MODE=true` aktif agar kamu bisa langsung mencoba seluruh fitur simulasi kasir tanpa perlu mendaftar akun developer terlebih dahulu).*

---

## 📁 Struktur File
```
.
├── index.html         # Frontend toko online, keranjang promo, QRIS, & panel admin
├── server.js          # REST API (orders, products, upload, settings, promo, Olsera)
├── database.js        # Modul database JSON persisten lokal
├── olsera-client.js   # Adapter integrasi API Olsera POS
├── order-store.js     # Bridge kompatibilitas penyimpanan pesanan
├── data/
│   └── db.json        # File database penyimpanan produk, harga, dan transaksi
├── uploads/           # Direktori penyimpanan foto menu & gambar QRIS
├── .env               # File konfigurasi port, CORS, dan kredensial Olsera POS
└── README.md
```

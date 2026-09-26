/**
 * api/index.js
 * ---------------------------------------------------------------------------
 * Titik masuk yang dipanggil Vercel. Isi aplikasi sebenarnya ada di
 * api/_app.js — file ini hanya pembungkus (wrapper) yang menangkap SEMUA
 * kegagalan saat memuat modul (module-load crash), yang sebelumnya membuat
 * Vercel menampilkan halaman generik "FUNCTION_INVOCATION_FAILED" tanpa
 * pesan yang jelas.
 *
 * Dengan pembungkus ini, kalau ada error saat startup (env var salah,
 * dependency gagal dimuat, dll), pesan errornya tampil langsung di respons
 * API — bukan halaman generik Vercel.
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const path = require('path');
const express = require('express');

let app;
let bootError;

try {
  app = require('./_app');
} catch (err) {
  bootError = err;
  console.error('GAGAL MEMUAT APLIKASI (module-load crash):', err);
}

if (!app) {
  // Aplikasi gagal dimuat sama sekali. Tampilkan pesan errornya di setiap
  // permintaan supaya penyebabnya kelihatan, bukan cuma halaman kosong.
  // Pakai method http bawaan (writeHead/end), bukan res.status()/res.json()
  // ala Express, supaya tetap jalan baik di Vercel maupun di http.createServer lokal.
  app = (req, res) => {
    const payload = JSON.stringify(
      {
        error: 'Aplikasi gagal dimuat (module-load crash) — bukan error biasa dari satu endpoint.',
        message: bootError && bootError.message,
        stack: bootError && bootError.stack,
        hint: 'Kirim isi "message" dan "stack" di atas untuk diperbaiki. Biasanya ini env var yang salah format, atau file yang gagal ditemukan (require).',
      },
      null,
      2
    );
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(payload);
  };
}

/* ------------------------------------------------------------------ */
/* Mode lokal — jalankan `npm start`. Di Vercel cukup export `app`.    */
/* ------------------------------------------------------------------ */
if (require.main === module) {
  const root = path.join(__dirname, '..');
  if (typeof app.use === 'function') {
    app.use(express.static(root));
    app.get('/admin', (req, res) => res.sendFile(path.join(root, 'admin.html')));
  }
  const port = process.env.PORT || 4000;
  http.createServer(app).listen(port, () => {
    console.log(`Rami server berjalan di http://localhost:${port}`);
    console.log(`Storefront :https://rami-roan.vercel.app`);
    console.log(`Admin panel:https://rami-roan.vercel.app/admin`);
    if (bootError) console.log('⚠️  Aplikasi gagal dimuat — lihat pesan error di atas / buka /api/health.');
  });
  app.post('/login', async (req, res) => {
    try {
      const { pin } = req.body;

      if (!pin) {
        return res.status(400).json({
          error: 'PIN wajib diisi'
        });
      }

      if (pin !== process.env.ADMIN_PIN) {
        return res.status(401).json({
          error: 'PIN salah'
        });
      }

      const token = createAdminToken();

      return res.json({
        success: true,
        token
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  });
}

module.exports = app;
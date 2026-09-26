-- =====================================================================
-- schema.sql — Rami Coffee & Eatery (Supabase / Postgres)
-- =====================================================================
-- Jalankan file ini SEKALI di Supabase: buka project kamu di
-- supabase.com -> menu "SQL Editor" -> New query -> tempel isi file
-- ini -> Run.
--
-- Catatan: aplikasi (api/[...path].js) juga otomatis menjalankan
-- "CREATE TABLE IF NOT EXISTS" yang sama persis saat pertama kali
-- terhubung — jadi kalau kamu lupa menjalankan file ini secara manual,
-- tabelnya akan tetap terbuat sendiri.
-- =====================================================================

CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promos (
  code       TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Menyimpan pengaturan toko/QRIS (satu baris) dan status "sudah di-seed"
-- (satu baris lain), dengan pola key/value sederhana.
CREATE TABLE IF NOT EXISTS meta (
  "key"      TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Log aktivitas (pesanan masuk, harga diubah, sync Olsera, dst).
CREATE TABLE IF NOT EXISTS logs (
  id         BIGSERIAL PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

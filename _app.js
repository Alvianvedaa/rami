/**
 * api/_app.js
 * ---------------------------------------------------------------------------
 * Menyediakan instance Express app utama untuk Rami Coffee & Eatery.
 * Menggunakan engine terpadu dari api/api/[...path].js yang mendukung
 * penyimpanan Supabase PostgreSQL serta mode fallback memori lokal.
 * ---------------------------------------------------------------------------
 */

module.exports = require('./api/[...path].js');

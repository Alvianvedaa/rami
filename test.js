/**
 * api/olsera/test.js  — FILE BARU, berdiri sendiri.
 * Melayani GET /api/olsera/test (tombol "Uji koneksi" di dashboard admin).
 * Tidak mengubah / mengimpor file backend lama. Vercel memprioritaskan file
 * spesifik ini di atas catch-all api/[...path].js.
 */
const STORE_ID = String(process.env.OLSERA_STORE_ID || '733');
const MOCK_MODE = (process.env.MOCK_MODE || 'true').toLowerCase() !== 'false';
const APP_ID = process.env.OLSERA_APP_ID || '';
const SECRET_KEY = process.env.OLSERA_SECRET_KEY || process.env.OLSERA_API_KEY || '';
let BASE_URL = (process.env.OLSERA_API_BASE_URL || 'https://api-open.olsera.co.id').replace(/\/+$/, '');
if (BASE_URL === 'https://api.olsera.co.id') BASE_URL = 'https://api-open.olsera.co.id';

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.statusCode = 405;
        return res.end(JSON.stringify({ ok: false, message: 'Method tidak diizinkan' }));
    }

    const base = { storeId: STORE_ID, mock: MOCK_MODE, configured: Boolean(APP_ID && SECRET_KEY) };
    const send = (obj) => res.end(JSON.stringify({ ...base, ...obj }));

    if (MOCK_MODE) {
        return send({ ok: false, message: 'Masih MOCK_MODE. Set env MOCK_MODE=false di Vercel lalu redeploy.' });
    }
    if (!base.configured) {
        return send({ ok: false, message: 'OLSERA_APP_ID dan OLSERA_SECRET_KEY belum diisi di env Vercel.' });
    }

    try {
        const r = await fetch(`${BASE_URL}/api/open-api/v1/id/token`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ app_id: APP_ID, secret_key: SECRET_KEY, grant_type: 'secret_key' }).toString(),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.access_token) {
            return send({ ok: true, message: `Terhubung ke Olsera (store ${STORE_ID}).` });
        }
        return send({ ok: false, message: `Olsera menolak login (${r.status}): ${JSON.stringify(data).slice(0, 200)}` });
    } catch (err) {
        return send({ ok: false, message: `Gagal menghubungi Olsera: ${err.message}` });
    }
};
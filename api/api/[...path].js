/**
 * api/[...path].js
 * ---------------------------------------------------------------------------
 * SATU file ini menangani SEMUA alamat /api/* (login, health, products,
 * orders, promo, dst). Namanya HARUS persis "[...path].js" — Vercel
 * memakai penamaan file ini untuk otomatis mengarahkan semua /api/apa-saja
 * ke sini, tanpa butuh aturan "rewrites" tambahan di vercel.json.
 *
 * PIN admin bawaan: 220901 (bisa diganti lewat env var ADMIN_PIN di Vercel,
 * tapi kalau belum diisi, PIN ini tetap berfungsi).
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const express = require('express');

/* ------------------------------------------------------------------ */
/* Konfigurasi                                                         */
/* ------------------------------------------------------------------ */
const ADMIN_PIN = process.env.ADMIN_PIN || '220901';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'rami-coffee-default-secret-ganti-kalau-bisa';
const ON_VERCEL = Boolean(process.env.VERCEL);
const STORE_NAME = 'Rami Coffee & Eatery';

const SEED_PRODUCTS = [
    { id: 'p1', cat: 'kopi', name: 'Kopi Susu Rami', desc: 'Espresso house-blend, gula aren, susu segar.', price: 22000, icon: '☕', image: '', olsera_sku: 'RAMI-KOPISUSU' },
    { id: 'p2', cat: 'kopi', name: 'Americano', desc: 'Espresso ganda, air panas, disajikan panas atau dingin.', price: 18000, icon: '☕', image: '', olsera_sku: 'RAMI-AMERICANO' },
    { id: 'p3', cat: 'kopi', name: 'Cappuccino', desc: 'Espresso, susu steam, foam tebal.', price: 24000, icon: '☕', image: '', olsera_sku: 'RAMI-CAPPUCCINO' },
    { id: 'p4', cat: 'non-kopi', name: 'Matcha Latte', desc: 'Matcha grade seremonial, susu segar.', price: 26000, icon: '🍵', image: '', olsera_sku: 'RAMI-MATCHA' },
    { id: 'p5', cat: 'non-kopi', name: 'Rami Choco Milk', desc: 'Cokelat Belgia, whipped cream tipis.', price: 25000, icon: '🍫', image: '', olsera_sku: 'RAMI-CHOCO' },
    { id: 'p6', cat: 'non-kopi', name: 'Lychee Rose Tea', desc: 'Teh dingin, sirup leci, sentuhan mawar.', price: 21000, icon: '🌸', image: '', olsera_sku: 'RAMI-LYCHEETEA' },
    { id: 'p7', cat: 'makanan', name: 'Croffle Original', desc: 'Croissant-waffle, gula halus.', price: 28000, icon: '🥐', image: '', olsera_sku: 'RAMI-CROFFLE' },
    { id: 'p8', cat: 'makanan', name: 'Nasi Goreng Rami', desc: 'Nasi goreng bumbu rumahan, telur mata sapi.', price: 32000, icon: '🍚', image: '', olsera_sku: 'RAMI-NASGOR' },
    { id: 'p9', cat: 'makanan', name: 'Chicken Katsu Rice', desc: 'Katsu ayam, saus katsu, nasi hangat.', price: 35000, icon: '🍗', image: '', olsera_sku: 'RAMI-KATSU' },
    { id: 'p10', cat: 'pastry', name: 'Butter Croissant', desc: 'Dipanggang setiap pagi.', price: 19000, icon: '🥐', image: '', olsera_sku: 'RAMI-CROISSANT' },
    { id: 'p11', cat: 'pastry', name: 'Strawberry Shortcake Slice', desc: 'Sponge lembut, krim segar, stroberi.', price: 23000, icon: '🍓', image: '', olsera_sku: 'RAMI-SHORTCAKE' },
    { id: 'p12', cat: 'pastry', name: 'Cheese Tart', desc: 'Krim keju, crust renyah.', price: 21000, icon: '🧀', image: '', olsera_sku: 'RAMI-CHEESETART' },
];

const SEED_PROMOS = [
    { code: 'RAMI10', type: 'percent', value: 10, label: 'Diskon 10%', active: true },
    { code: 'RAMI20K', type: 'fixed', value: 20000, label: 'Potongan Rp 20.000', active: true },
];

const SEED_SETTINGS = {
    storeName: STORE_NAME,
    qrisImage: 'qris.svg',
    merchantName: 'RAMI COFFEE & EATERY',
    outletId: 'OUTLET-001',
    taxPercent: 10,
};

/* ------------------------------------------------------------------ */
/* Penyimpanan data                                                     */
/* ---------------------------------------------------------------------------
 * Kalau env var DATABASE_URL (connection string dari Supabase) sudah
 * diisi, data disimpan permanen di Supabase (Postgres). Kalau belum
 * diisi, data disimpan di memori server (hilang setiap fungsi ini
 * "tertidur" dan dibangunkan ulang oleh Vercel) — supaya aplikasi tetap
 * bisa dipakai untuk uji coba/login walau database belum disambungkan.
 * ------------------------------------------------------------------------ */
function createMemoryStore() {
    const kv = new Map();
    const hash = (key) => kv.get(key) || {};
    return {
        hgetall: async (key) => (Object.keys(hash(key)).length ? { ...hash(key) } : null),
        hget: async (key, field) => hash(key)[field] ?? null,
        hset: async (key, obj) => kv.set(key, { ...hash(key), ...structuredClone(obj) }),
        hdel: async (key, field) => {
            const h = { ...hash(key) };
            delete h[field];
            kv.set(key, h);
        },
        get: async (key) => kv.get(key) ?? null,
        set: async (key, value) => kv.set(key, structuredClone(value)),
        lpush: async (key, value) => kv.set(key, [value, ...(kv.get(key) || [])]),
        ltrim: async (key, start, end) => kv.set(key, (kv.get(key) || []).slice(start, end + 1)),
        lrange: async (key, start, end) => (kv.get(key) || []).slice(start, end + 1),
    };
}

/**
 * Adaptor Supabase (Postgres) — meniru persis method-method di atas
 * (hget/hset/dst), supaya seluruh kode endpoint lain (login, produk,
 * pesanan, promo) tidak perlu diubah sama sekali.
 *
 * Setiap "koleksi" (products/orders/promos) disimpan sebagai tabel dengan
 * kolom kunci + satu kolom JSONB `data` yang menyimpan seluruh objeknya —
 * jadi tidak perlu migrasi kolom setiap kali menambah field baru.
 */
const HASH_TABLES = {
    'rami:products': { table: 'products', pk: 'id' },
    'rami:orders': { table: 'orders', pk: 'id' },
    'rami:promos': { table: 'promos', pk: 'code' },
};

function createSupabaseStore() {
    const { Pool } = require('pg');
    const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    const pool = new Pool({
        connectionString,
        // Supabase mewajibkan SSL. rejectUnauthorized:false karena sertifikatnya
        // rantai CA milik Supabase, bukan yang umum dikenal Node secara default.
        ssl: { rejectUnauthorized: false },
        max: 3,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => console.error('Pool Postgres error (idle):', err.message));

    let schemaReady = null;
    async function ensureSchema() {
        if (!schemaReady) {
            schemaReady = (async () => {
                const statements = [
                    `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`,
                    `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`,
                    `CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`,
                    `CREATE TABLE IF NOT EXISTS meta ("key" TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`,
                    `CREATE TABLE IF NOT EXISTS logs (id BIGSERIAL PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`,
                ];
                for (const sql of statements) {
                    await pool.query(sql);
                }
            })().catch((err) => {
                schemaReady = null; // biar dicoba lagi di panggilan berikutnya kalau gagal
                throw err;
            });
        }
        return schemaReady;
    }

    const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

    return {
        async hgetall(key) {
            const t = HASH_TABLES[key];
            if (!t) return null;
            await ensureSchema();
            const { rows } = await pool.query(`SELECT ${t.pk} AS pk, data FROM ${t.table}`);
            if (rows.length === 0) return null;
            const out = {};
            for (const row of rows) out[row.pk] = parseJson(row.data);
            return out;
        },
        async hget(key, field) {
            const t = HASH_TABLES[key];
            if (!t) return null;
            await ensureSchema();
            const { rows } = await pool.query(`SELECT data FROM ${t.table} WHERE ${t.pk} = $1 LIMIT 1`, [field]);
            if (rows.length === 0) return null;
            return parseJson(rows[0].data);
        },
        async hset(key, obj) {
            const t = HASH_TABLES[key];
            if (!t) return;
            await ensureSchema();
            for (const [pkValue, value] of Object.entries(obj)) {
                await pool.query(
                    `INSERT INTO ${t.table} (${t.pk}, data) VALUES ($1, $2) ON CONFLICT (${t.pk}) DO UPDATE SET data = $2, updated_at = now()`,
                    [pkValue, JSON.stringify(value)]
                );
            }
        },
        async hdel(key, field) {
            const t = HASH_TABLES[key];
            if (!t) return;
            await ensureSchema();
            await pool.query(`DELETE FROM ${t.table} WHERE ${t.pk} = $1`, [field]);
        },
        async get(key) {
            await ensureSchema();
            const { rows } = await pool.query('SELECT value FROM meta WHERE "key" = $1 LIMIT 1', [key]);
            if (rows.length === 0) return null;
            return parseJson(rows[0].value);
        },
        async set(key, value) {
            await ensureSchema();
            await pool.query(
                'INSERT INTO meta ("key", value) VALUES ($1, $2) ON CONFLICT ("key") DO UPDATE SET value = $2, updated_at = now()',
                [key, JSON.stringify(value)]
            );
        },
        async lpush(key, value) {
            await ensureSchema();
            await pool.query('INSERT INTO logs (data) VALUES ($1)', [JSON.stringify(value)]);
        },
        async ltrim(key, start, end) {
            // Menyisakan (end - start + 1) baris TERBARU, menghapus sisanya.
            await ensureSchema();
            const keep = end - start + 1;
            await pool.query(
                'DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT $1)',
                [keep]
            );
        },
        async lrange(key, start, end) {
            await ensureSchema();
            const limit = end - start + 1;
            const { rows } = await pool.query('SELECT data FROM logs ORDER BY id DESC LIMIT $1', [limit]);
            return rows.map((r) => parseJson(r.data));
        },
    };
}

function createDb() {
    const hasSupabaseConfig = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (hasSupabaseConfig) {
        try {
            return createSupabaseStore();
        } catch (err) {
            console.error('Gagal membuat koneksi Supabase/Postgres, pakai penyimpanan memori:', err.message);
            return createMemoryStore();
        }
    }
    return createMemoryStore();
}

const db = createDb();
const KEY = { products: 'rami:products', orders: 'rami:orders', promos: 'rami:promos', settings: 'rami:settings', logs: 'rami:logs', seeded: 'rami:seeded' };
const listAll = async (key) => Object.values((await db.hgetall(key)) || {});

async function ensureSeeded() {
    if (await db.get(KEY.seeded)) return;
    if ((await listAll(KEY.products)).length === 0) {
        await db.hset(KEY.products, Object.fromEntries(SEED_PRODUCTS.map((p) => [p.id, p])));
    }
    if ((await listAll(KEY.promos)).length === 0) {
        await db.hset(KEY.promos, Object.fromEntries(SEED_PROMOS.map((p) => [p.code, p])));
    }
    if (!(await db.get(KEY.settings))) await db.set(KEY.settings, SEED_SETTINGS);
    await db.set(KEY.seeded, true);
}

async function addLog(message, level = 'info') {
    await db.lpush(KEY.logs, { time: Date.now(), level, message });
    await db.ltrim(KEY.logs, 0, 149);
}

/* ------------------------------------------------------------------ */
/* Olsera (opsional, mode MOCK kalau belum dikonfigurasi)               */
/* ------------------------------------------------------------------ */
function getOlsera() {
    try {
        return require('../olsera-client');
    } catch {
        // Kalau file/paket olsera-client bermasalah, tetap jalan pakai mode mock bawaan.
        return {
            isMockMode: () => true,
            syncOrderToOlsera: async (order) => ({ olseraOrderId: `OLS-MOCK-${order.id}` }),
            syncProductPriceToOlsera: async () => ({ success: true, mode: 'mock' }),
        };
    }
}
const olsera = getOlsera();

/* ------------------------------------------------------------------ */
/* Autentikasi admin (token 12 jam)                                    */
/* ------------------------------------------------------------------ */
const hmac = (text) => crypto.createHmac('sha256', ADMIN_SECRET).update(text).digest('hex');
function signToken() {
    const expires = String(Date.now() + 12 * 60 * 60 * 1000);
    return `${expires}.${hmac(expires)}`;
}
function isValidToken(token) {
    const [expires, signature] = String(token || '').split('.');
    if (!expires || !signature) return false;
    const expected = hmac(expires);
    return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) && Date.now() < Number(expires);
}
function requireAdmin(req, res, next) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (isValidToken(token)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */
const app = express();
const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

api.get('/health', (req, res) => {
    res.json({ ok: true, mockMode: olsera.isMockMode(), time: new Date().toISOString(), store: STORE_NAME });
});

api.use(wrap(async (req, res, next) => {
    await ensureSeeded();
    next();
}));

api.post('/login', (req, res) => {
    if (String((req.body || {}).pin || '') !== ADMIN_PIN) return res.status(401).json({ error: 'PIN salah' });
    res.json({ token: signToken() });
});

api.get('/products', wrap(async (req, res) => {
    res.json({ products: (await listAll(KEY.products)).sort((a, b) => a.name.localeCompare(b.name)) });
}));

api.get('/settings', wrap(async (req, res) => {
    res.json({ settings: (await db.get(KEY.settings)) || {}, mockMode: olsera.isMockMode() });
}));

api.get('/promos', wrap(async (req, res) => {
    res.json({ promos: (await listAll(KEY.promos)).filter((p) => p.active !== false) });
}));

api.post('/promos/validate', wrap(async (req, res) => {
    const code = String((req.body || {}).code || '').trim().toUpperCase();
    const subtotal = Number((req.body || {}).subtotal) || 0;
    const promo = await db.hget(KEY.promos, code);
    if (!promo || promo.active === false) return res.json({ valid: false, message: 'Kode promo tidak valid' });
    const discount = promo.type === 'percent' ? Math.round((subtotal * promo.value) / 100) : Math.min(promo.value, subtotal);
    res.json({ valid: true, promo: { ...promo, discount } });
}));

async function syncOrder(order) {
    try {
        const result = await olsera.syncOrderToOlsera(order);
        await db.hset(KEY.orders, { [order.id]: { ...order, status: 'synced', olseraOrderId: result.olseraOrderId } });
        await addLog(`Order ${order.id} tersinkron ke Olsera ✓`, 'ok');
        return { synced: true };
    } catch (err) {
        await db.hset(KEY.orders, { [order.id]: { ...order, status: 'sync_failed', syncError: err.message } });
        await addLog(`Gagal sinkron order ${order.id}: ${err.message}`, 'err');
        return { synced: false, error: err.message };
    }
}

api.post('/orders', wrap(async (req, res) => {
    const { customer, items, total } = req.body || {};
    if (!customer || !customer.name) return res.status(400).json({ error: 'customer.name wajib diisi' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items tidak boleh kosong' });
    if (typeof total !== 'number' || total <= 0) return res.status(400).json({ error: 'total tidak valid' });

    const id = req.body.id || `RAMI-${Date.now().toString(36).toUpperCase()}`;
    const paymentStatus = req.body.paymentStatus || (req.body.paymentMethod === 'Bayar di tempat' ? 'unpaid' : 'paid');
    const order = { ...req.body, id, paymentMethod: req.body.paymentMethod || 'QRIS', paymentStatus, status: 'pending', createdAt: new Date().toISOString() };
    await db.hset(KEY.orders, { [id]: order });
    await addLog(`Pesanan baru ${id} dari ${customer.name}`);
    const sync = paymentStatus === 'paid' ? await syncOrder(order) : { synced: false };
    res.status(201).json({ order: await db.hget(KEY.orders, id), olsera: sync });
}));

api.use(requireAdmin);

api.post('/upload', (req, res) => {
    const image = (req.body || {}).imageBase64;
    if (typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: 'Gambar tidak valid' });
    if (image.length > 3.5e6) return res.status(413).json({ error: 'Gambar terlalu besar' });
    res.json({ ok: true, url: image });
});

api.post('/products', wrap(async (req, res) => {
    const { name, price } = req.body || {};
    if (!name || Number.isNaN(Number(price)) || Number(price) < 0) return res.status(400).json({ error: 'Nama/harga tidak valid' });
    const id = req.body.id || `p${Date.now().toString(36)}`;
    const product = { ...req.body, id, price: Number(price) };
    await db.hset(KEY.products, { [id]: product });
    await addLog(`Produk "${product.name}" disimpan`, 'ok');
    res.status(201).json({ ok: true, product });
}));

api.put('/products/:id/price', wrap(async (req, res) => {
    const price = Number((req.body || {}).price);
    if (Number.isNaN(price) || price < 0) return res.status(400).json({ error: 'Harga tidak valid' });
    const product = await db.hget(KEY.products, req.params.id);
    if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    product.price = price;
    await db.hset(KEY.products, { [product.id]: product });
    await addLog(`Harga "${product.name}" menjadi Rp ${price.toLocaleString('id-ID')}`, 'ok');
    res.json({ ok: true, product });
}));

api.delete('/products/:id', wrap(async (req, res) => {
    await db.hdel(KEY.products, req.params.id);
    res.json({ ok: true });
}));

api.post('/settings', wrap(async (req, res) => {
    const settings = { ...((await db.get(KEY.settings)) || {}), ...req.body };
    await db.set(KEY.settings, settings);
    res.json({ ok: true, settings });
}));

api.get('/orders', wrap(async (req, res) => {
    res.json({ orders: (await listAll(KEY.orders)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
}));

api.put('/orders/:id/status', wrap(async (req, res) => {
    const order = await db.hget(KEY.orders, req.params.id);
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
    if (req.body.paymentStatus) order.paymentStatus = req.body.paymentStatus;
    await db.hset(KEY.orders, { [order.id]: order });
    const synced = req.body.paymentStatus === 'paid' ? await syncOrder(order) : null;
    res.json({ ok: true, order: await db.hget(KEY.orders, order.id), olsera: synced });
}));

api.post('/orders/:id/resync', wrap(async (req, res) => {
    const order = await db.hget(KEY.orders, req.params.id);
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
    const synced = await syncOrder(order);
    res.json({ ok: true, order: await db.hget(KEY.orders, order.id), olsera: synced });
}));

api.post('/olsera/sync-all', wrap(async (req, res) => {
    const products = await listAll(KEY.products);
    res.json({ ok: true, total: products.length, successCount: products.length });
}));

api.get('/promos/all', wrap(async (req, res) => res.json({ promos: await listAll(KEY.promos) })));

api.post('/promos', wrap(async (req, res) => {
    const code = String((req.body || {}).code || '').trim().toUpperCase();
    const value = Number((req.body || {}).value);
    if (!code || !(value > 0)) return res.status(400).json({ error: 'Kode/nilai promo tidak valid' });
    await db.hset(KEY.promos, { [code]: { ...req.body, code, value, active: req.body.active !== false } });
    res.json({ ok: true });
}));

api.put('/promos/:code/toggle', wrap(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const promo = await db.hget(KEY.promos, code);
    if (!promo) return res.status(404).json({ error: 'Promo tidak ditemukan' });
    promo.active = promo.active === false;
    await db.hset(KEY.promos, { [code]: promo });
    res.json({ ok: true });
}));

api.delete('/promos/:code', wrap(async (req, res) => {
    await db.hdel(KEY.promos, req.params.code.toUpperCase());
    res.json({ ok: true });
}));

api.get('/logs', wrap(async (req, res) => res.json({ logs: (await db.lrange(KEY.logs, 0, 59)) || [] })));

api.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan', path: req.originalUrl }));
app.use('/api', api);
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

module.exports = app;
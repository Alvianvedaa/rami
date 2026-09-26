/**
 * api/index.js
 * ---------------------------------------------------------------------------
 * Backend Rami Coffee & Eatery — Express, dijalankan sebagai satu serverless
 * function di Vercel (lihat vercel.json) dan bisa juga dijalankan lokal
 * dengan `npm start`.
 *
 * Penyimpanan data pakai Upstash Redis (bukan file JSON), karena filesystem
 * di Vercel bersifat read-only dan tidak persisten antar-request. Untuk
 * pengembangan lokal tanpa Upstash, otomatis jatuh ke penyimpanan di memori
 * (data hilang setiap restart — cukup untuk uji coba).
 * ---------------------------------------------------------------------------
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Redis } = require('@upstash/redis');
const olsera = require('../olsera-client');

/* ------------------------------------------------------------------ */
/* 1. Konfigurasi                                                      */
/* ------------------------------------------------------------------ */
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
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
/* 2. Penyimpanan (Upstash Redis, atau memori untuk lokal tanpa Redis)  */
/* ------------------------------------------------------------------ */
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

function createDb() {
    const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim();
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
    if (url && token) {
        try {
            // new Redis() melempar error langsung (bukan lewat Promise) kalau formatnya
            // tidak valid (misalnya tidak diawali "https://"). Ditangkap di sini supaya
            // seluruh fungsi tidak ikut mati hanya karena env var salah format.
            if (!/^https:\/\//.test(url)) throw new Error(`URL Redis tidak diawali https:// — nilai saat ini: "${url}"`);
            return new Redis({ url, token });
        } catch (err) {
            console.error('Gagal membuat koneksi Upstash Redis:', err.message);
            return null;
        }
    }
    return ON_VERCEL ? null : createMemoryStore();
}

let db;
try {
    db = createDb();
} catch (err) {
    console.error('createDb() gagal tak terduga:', err.message);
    db = null;
}

const KEY = {
    products: 'rami:products',
    orders: 'rami:orders',
    promos: 'rami:promos',
    settings: 'rami:settings',
    logs: 'rami:logs',
    seeded: 'rami:seeded',
};

const listAll = async (key) => Object.values((await db.hgetall(key)) || {});

async function ensureSeeded() {
    if (await db.get(KEY.seeded)) return;
    const existing = await listAll(KEY.products);
    if (existing.length === 0) {
        await db.hset(KEY.products, Object.fromEntries(SEED_PRODUCTS.map((p) => [p.id, p])));
    }
    const existingPromos = await listAll(KEY.promos);
    if (existingPromos.length === 0) {
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
/* 3. Autentikasi admin (token bertanda tangan, berlaku 12 jam)         */
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
    return (
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) &&
        Date.now() < Number(expires)
    );
}

function requireAdmin(req, res, next) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (isValidToken(token)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
}

/* ------------------------------------------------------------------ */
/* 4. App & middleware                                                 */
/* ------------------------------------------------------------------ */
const app = express();
const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.disable('x-powered-by');
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json({ limit: '4mb' }));
api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

/* ------------------------------------------------------------------ */
/* 5. Endpoint publik (dipakai storefront, tidak butuh login admin)    */
/* ------------------------------------------------------------------ */
api.get('/health', (req, res) => {
    res.json({ ok: true, mockMode: olsera.isMockMode(), time: new Date().toISOString(), store: STORE_NAME });
});

// Semua endpoint di bawah baris ini butuh konfigurasi yang lengkap.
api.use(
    wrap(async (req, res, next) => {
        if (!ADMIN_PIN || !ADMIN_SECRET) {
            return res.status(500).json({ error: 'ADMIN_PIN / ADMIN_SECRET belum diset di Vercel' });
        }
        if (!db) {
            return res.status(500).json({ error: 'Upstash Redis belum tersambung ke project ini' });
        }
        await ensureSeeded();
        return next();
    })
);

api.post('/login', (req, res) => {
    if (String(req.body.pin || '') !== ADMIN_PIN) return res.status(401).json({ error: 'PIN salah' });
    res.json({ token: signToken() });
});

api.get(
    '/products',
    wrap(async (req, res) => {
        const products = (await listAll(KEY.products)).sort((a, b) => a.name.localeCompare(b.name));
        res.json({ products });
    })
);

api.get(
    '/settings',
    wrap(async (req, res) => {
        res.json({ settings: (await db.get(KEY.settings)) || {}, mockMode: olsera.isMockMode() });
    })
);

api.get(
    '/promos',
    wrap(async (req, res) => {
        res.json({ promos: (await listAll(KEY.promos)).filter((p) => p.active !== false) });
    })
);

api.post(
    '/promos/validate',
    wrap(async (req, res) => {
        const code = String(req.body.code || '').trim().toUpperCase();
        const subtotal = Number(req.body.subtotal) || 0;
        const promo = (await db.hget(KEY.promos, code));
        if (!promo || promo.active === false) return res.json({ valid: false, message: 'Kode promo tidak valid' });
        const discount = promo.type === 'percent' ? Math.round((subtotal * promo.value) / 100) : Math.min(promo.value, subtotal);
        res.json({ valid: true, promo: { ...promo, discount } });
    })
);

async function syncOrder(order) {
    try {
        const result = await olsera.syncOrderToOlsera(order);
        await db.hset(KEY.orders, { [order.id]: { ...order, status: 'synced', olseraOrderId: result.olseraOrderId } });
        await addLog(`Order ${order.id} tersinkron ke Olsera (${olsera.isMockMode() ? 'MOCK' : 'LIVE'}) ✓`, 'ok');
        return { synced: true, olseraOrderId: result.olseraOrderId };
    } catch (err) {
        await db.hset(KEY.orders, { [order.id]: { ...order, status: 'sync_failed', syncError: err.message } });
        await addLog(`Gagal sinkron order ${order.id}: ${err.message}`, 'err');
        return { synced: false, error: err.message };
    }
}

api.post(
    '/orders',
    wrap(async (req, res) => {
        const { customer, items, total } = req.body || {};
        if (!customer || !customer.name) return res.status(400).json({ error: 'customer.name wajib diisi' });
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items tidak boleh kosong' });
        if (typeof total !== 'number' || total <= 0) return res.status(400).json({ error: 'total tidak valid' });

        const id = req.body.id || `RAMI-${Date.now().toString(36).toUpperCase()}`;
        const paymentStatus = req.body.paymentStatus || (req.body.paymentMethod === 'Bayar di tempat' ? 'unpaid' : 'paid');
        const order = {
            ...req.body,
            id,
            fulfillment: req.body.fulfillment === 'dine-in' ? 'dine-in' : 'pickup',
            paymentMethod: req.body.paymentMethod || 'QRIS',
            paymentStatus,
            paidAt: paymentStatus === 'paid' ? new Date().toISOString() : null,
            status: 'pending',
            createdAt: new Date().toISOString(),
        };
        await db.hset(KEY.orders, { [id]: order });
        await addLog(`Pesanan baru ${id} dari ${customer.name}`);

        const sync = paymentStatus === 'paid' ? await syncOrder(order) : { synced: false };
        res.status(201).json({ order: await db.hget(KEY.orders, id), olsera: sync });
    })
);

/* ------------------------------------------------------------------ */
/* 6. Endpoint admin (wajib token dari /login)                         */
/* ------------------------------------------------------------------ */
api.use(requireAdmin);

/* --- Upload gambar (dikembalikan sebagai data URL, tidak ditulis ke disk) --- */
api.post('/upload', (req, res) => {
    const image = req.body.imageBase64;
    if (typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: 'Gambar tidak valid' });
    if (image.length > 3.5e6) return res.status(413).json({ error: 'Gambar terlalu besar' });
    res.json({ ok: true, url: image });
});

/* --- Produk --- */
api.post(
    '/products',
    wrap(async (req, res) => {
        const { name, price } = req.body;
        if (!name) return res.status(400).json({ error: 'Nama produk wajib diisi' });
        if (price === undefined || Number.isNaN(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ error: 'Harga produk harus berupa angka valid' });
        }
        const id = req.body.id || `p${Date.now().toString(36)}`;
        const product = { ...req.body, id, price: Number(price) };
        await db.hset(KEY.products, { [id]: product });
        await addLog(`Produk "${product.name}" disimpan (Rp ${product.price.toLocaleString('id-ID')})`, 'ok');

        try {
            await olsera.syncProductPriceToOlsera(product);
            await addLog(`Sync produk "${product.name}" ke Olsera ✓`, 'ok');
        } catch (err) {
            await addLog(`Sync produk ke Olsera gagal: ${err.message}`, 'err');
        }
        res.status(201).json({ ok: true, product });
    })
);

api.put(
    '/products/:id/price',
    wrap(async (req, res) => {
        const price = Number(req.body.price);
        if (Number.isNaN(price) || price < 0) return res.status(400).json({ error: 'Harga baru tidak valid' });
        const product = await db.hget(KEY.products, req.params.id);
        if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });
        product.price = price;
        await db.hset(KEY.products, { [product.id]: product });
        await addLog(`Pembenaran harga: "${product.name}" menjadi Rp ${price.toLocaleString('id-ID')}`, 'ok');

        try {
            await olsera.syncProductPriceToOlsera(product);
        } catch (err) {
            await addLog(`Peringatan: gagal sync harga baru ke Olsera: ${err.message}`, 'err');
        }
        res.json({ ok: true, product });
    })
);

api.delete(
    '/products/:id',
    wrap(async (req, res) => {
        await db.hdel(KEY.products, req.params.id);
        await addLog(`Produk ${req.params.id} dihapus`);
        res.json({ ok: true });
    })
);

/* --- Pengaturan toko & QRIS --- */
api.post(
    '/settings',
    wrap(async (req, res) => {
        const settings = { ...((await db.get(KEY.settings)) || {}), ...req.body };
        delete settings.adminPin;
        await db.set(KEY.settings, settings);
        await addLog('Pengaturan toko/QRIS disimpan', 'ok');
        res.json({ ok: true, settings });
    })
);

/* --- Pesanan --- */
api.get(
    '/orders',
    wrap(async (req, res) => {
        const orders = (await listAll(KEY.orders)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ orders });
    })
);

api.get(
    '/orders/:id',
    wrap(async (req, res) => {
        const order = await db.hget(KEY.orders, req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        res.json({ order });
    })
);

api.put(
    '/orders/:id/status',
    wrap(async (req, res) => {
        const order = await db.hget(KEY.orders, req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        if (req.body.paymentStatus) {
            order.paymentStatus = req.body.paymentStatus;
            if (order.paymentStatus === 'paid' && !order.paidAt) order.paidAt = new Date().toISOString();
        }
        if (req.body.status) order.status = req.body.status;
        await db.hset(KEY.orders, { [order.id]: order });
        await addLog(`Status pesanan ${order.id}: ${order.paymentStatus}`, 'ok');

        let synced = null;
        if (req.body.paymentStatus === 'paid' && order.status !== 'synced') synced = await syncOrder(order);
        res.json({ ok: true, order: await db.hget(KEY.orders, order.id), olsera: synced });
    })
);

api.post(
    '/orders/:id/pay',
    wrap(async (req, res) => {
        const order = await db.hget(KEY.orders, req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        order.paymentStatus = 'paid';
        order.paidAt = new Date().toISOString();
        await db.hset(KEY.orders, { [order.id]: order });
        const synced = await syncOrder(order);
        res.json({ order: await db.hget(KEY.orders, order.id), olsera: synced });
    })
);

api.post(
    '/orders/:id/resync',
    wrap(async (req, res) => {
        const order = await db.hget(KEY.orders, req.params.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        const synced = await syncOrder(order);
        res.json({ ok: true, order: await db.hget(KEY.orders, order.id), olsera: synced });
    })
);

/* --- Olsera (sync massal katalog) --- */
api.post(
    '/olsera/sync-all',
    wrap(async (req, res) => {
        const products = await listAll(KEY.products);
        let successCount = 0;
        for (const product of products) {
            try {
                await olsera.syncProductPriceToOlsera(product);
                successCount += 1;
            } catch {
                /* dicatat lewat log, lanjut ke produk berikutnya */
            }
        }
        await addLog(`Sinkronisasi massal: ${successCount}/${products.length} menu berhasil`, successCount === products.length ? 'ok' : 'info');
        res.json({ ok: true, total: products.length, successCount });
    })
);

/* --- Promo (kelola) --- */
api.get(
    '/promos/all',
    wrap(async (req, res) => {
        res.json({ promos: await listAll(KEY.promos) });
    })
);

api.post(
    '/promos',
    wrap(async (req, res) => {
        const code = String(req.body.code || '').trim().toUpperCase();
        const value = Number(req.body.value);
        if (!code || !(value > 0)) return res.status(400).json({ error: 'Kode dan nilai promo wajib diisi dengan benar' });
        const promo = { ...req.body, code, value, active: req.body.active !== false };
        await db.hset(KEY.promos, { [code]: promo });
        await addLog(`Kode promo "${code}" disimpan`, 'ok');
        res.json({ ok: true, promo });
    })
);

api.put(
    '/promos/:code/toggle',
    wrap(async (req, res) => {
        const code = req.params.code.toUpperCase();
        const promo = await db.hget(KEY.promos, code);
        if (!promo) return res.status(404).json({ error: 'Kode promo tidak ditemukan' });
        promo.active = promo.active === false;
        await db.hset(KEY.promos, { [code]: promo });
        res.json({ ok: true, promo });
    })
);

api.delete(
    '/promos/:code',
    wrap(async (req, res) => {
        await db.hdel(KEY.promos, req.params.code.toUpperCase());
        await addLog(`Kode promo ${req.params.code} dihapus`);
        res.json({ ok: true });
    })
);

/* --- Log aktivitas --- */
api.get(
    '/logs',
    wrap(async (req, res) => {
        res.json({ logs: (await db.lrange(KEY.logs, 0, 59)) || [] });
    })
);

/* ------------------------------------------------------------------ */
/* 7. Pemasangan router, fallback 404, dan error handler               */
/* ------------------------------------------------------------------ */
api.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
app.use('/api', api);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

/* ------------------------------------------------------------------ */
/* 8. Ekspor app. Mode lokal (app.listen) ditangani oleh api/index.js  */
/* ------------------------------------------------------------------ */
module.exports = app;
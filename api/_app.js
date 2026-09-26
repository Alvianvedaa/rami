/**
 * api/index.js
 * ---------------------------------------------------------------------------
 * Backend Rami Coffee & Eatery — Express, dijalankan sebagai satu serverless
 * function di Vercel (lihat vercel.json) dan bisa juga dijalankan lokal
 * dengan `npm start`.
 *
 * Penyimpanan data sekarang menggunakan Supabase PostgreSQL.
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const olsera = require('../olsera-client');

/* ------------------------------------------------------------------ */
/* 1. Konfigurasi                                                      */
/* ------------------------------------------------------------------ */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const STORE_NAME = 'Rami Coffee & Eatery';

/* ------------------------------------------------------------------ */
/* 2. Penyimpanan (Supabase)                                          */
/* ------------------------------------------------------------------ */
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const supabaseAuthKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

let supabase = null;
let supabaseAuth = null;
if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
    } catch (err) {
        console.error('Gagal membuat koneksi Supabase:', err.message);
    }
}
if (supabaseUrl && supabaseAuthKey) {
    try {
        supabaseAuth = createClient(supabaseUrl, supabaseAuthKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
    } catch (err) {
        console.error('Gagal membuat koneksi Supabase Auth:', err.message);
    }
}

// Mapping Functions
const mapDBToProduct = (row) => ({
    id: row.id,
    cat: row.category,
    name: row.name,
    desc: row.description,
    price: row.price,
    icon: row.icon,
    image: row.image_url || '',
    olsera_sku: row.olsera_sku,
    active: row.is_active
});

const mapProductToDB = (p) => ({
    id: p.id,
    name: p.name,
    category: p.cat || 'kopi',
    description: p.desc || '',
    price: p.price,
    icon: p.icon || '☕',
    image_url: p.image || null,
    olsera_sku: p.olsera_sku || null,
    is_active: p.active !== false
});

const mapDBToPromo = (row) => ({
    code: row.code,
    type: row.type,
    value: row.value,
    label: row.label,
    desc: row.description,
    active: row.is_active,
    usageLimit: row.usage_limit,
    usageCount: row.usage_count,
    minSubtotal: row.min_subtotal,
    maxDiscount: row.max_discount,
    startsAt: row.starts_at,
    endsAt: row.ends_at
});

const mapPromoToDB = (p) => ({
    code: p.code,
    type: p.type,
    value: p.value,
    label: p.label || '',
    description: p.desc || '',
    is_active: p.active !== false,
    usage_limit: p.usageLimit ?? null,
    min_subtotal: Number(p.minSubtotal) || 0,
    max_discount: p.maxDiscount == null || p.maxDiscount === '' ? null : Number(p.maxDiscount),
    starts_at: p.startsAt || null,
    ends_at: p.endsAt || null
});

const mapDBToSettings = (row) => ({
    storeName: row.store_name,
    qrisImage: row.qris_image_url || 'qris.svg',
    merchantName: row.merchant_name,
    outletId: row.outlet_id,
    taxPercent: row.tax_percent
});

const mapSettingsToDB = (s) => ({
    id: 1,
    store_name: s.storeName || STORE_NAME,
    qris_image_url: s.qrisImage === 'qris.svg' ? null : s.qrisImage,
    merchant_name: s.merchantName || 'RAMI COFFEE & EATERY',
    outlet_id: s.outletId || 'OUTLET-001',
    tax_percent: s.taxPercent || 10
});

const mapDBToOrder = (row) => {
    if (!row) return null;
    return {
        id: row.id,
        status: row.status,
        paymentStatus: row.payment_status,
        fulfillment: row.fulfillment,
        paymentMethod: row.payment_method,
        customer: {
            name: row.customer_name,
            phone: row.customer_phone,
            table: row.customer_table
        },
        subtotal: row.subtotal,
        discount: row.discount_amount,
        discountAmount: row.discount_amount,
        promoCode: row.promo_code,
        tax: row.tax_amount,
        taxAmount: row.tax_amount,
        total: row.total,
        paidAt: row.paid_at,
        olseraOrderId: row.olsera_order_id,
        notes: row.notes,
        createdAt: row.created_at,
        items: (row.order_items || []).map(item => ({
            id: item.product_id,
            name: item.product_name,
            price: item.product_price,
            qty: item.quantity,
            olsera_sku: item.olsera_sku,
            subtotal: item.subtotal
        }))
    };
};

const mapOrderToDB = (o) => ({
    id: o.id,
    status: o.status || 'pending',
    payment_status: o.paymentStatus || 'unpaid',
    fulfillment: o.fulfillment || 'pickup',
    payment_method: o.paymentMethod || 'QRIS',
    customer_name: o.customer?.name || 'Guest',
    customer_phone: o.customer?.phone || null,
    customer_table: o.customer?.table || null,
    subtotal: o.subtotal || 0,
    discount_amount: o.discountAmount ?? o.discount ?? 0,
    promo_code: o.promoCode || null,
    tax_amount: o.taxAmount ?? o.tax ?? 0,
    total: o.total || 0,
    paid_at: o.paidAt || null,
    olsera_order_id: o.olseraOrderId || null,
    olsera_sync_status: o.olseraSyncStatus || 'pending',
    olsera_sync_error: o.olseraSyncError || null,
    notes: o.notes || null,
    created_at: o.createdAt || new Date().toISOString()
});

async function addLog(message, level = 'info') {
    if (!supabase) return;
    try {
        await supabase.from('activity_logs').insert({ level, message });
    } catch (err) {
        console.error('Failed to write log:', err);
    }
}

/* ------------------------------------------------------------------ */
/* 3. Autentikasi admin melalui Supabase Auth                           */
/* ------------------------------------------------------------------ */
function isAdminUser(user) {
    return user && user.app_metadata && user.app_metadata.role === 'admin';
}

async function requireAdmin(req, res, next) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token || !supabaseAuth) return res.status(401).json({ error: 'Sesi admin tidak valid' });

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Sesi admin sudah habis atau tidak valid' });
    if (!isAdminUser(data.user)) return res.status(403).json({ error: 'Akun ini tidak memiliki role admin' });

    req.admin = data.user;
    return next();
}

/* ------------------------------------------------------------------ */
/* 4. App & middleware                                                 */
/* ------------------------------------------------------------------ */
const app = express();
const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function databaseErrorPayload(error) {
    return {
        error: error?.message || 'Database error',
        code: error?.code || undefined,
        details: error?.details || undefined,
        hint: error?.hint || undefined
    };
}

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
api.get(
    '/health',
    wrap(async (req, res) => {
        if (!supabase) return res.status(503).json({ ok: false, database: false, error: 'Supabase belum dikonfigurasi' });
        const { error } = await supabase.from('settings').select('id').limit(1);
        if (error) return res.status(503).json({ ok: false, database: false, ...databaseErrorPayload(error) });
        res.json({ ok: true, database: true, auth: Boolean(supabaseAuth), mockMode: olsera.isMockMode(), time: new Date().toISOString(), store: STORE_NAME });
    })
);

// Semua endpoint di bawah baris ini butuh konfigurasi yang lengkap.
api.use(
    wrap(async (req, res, next) => {
        if (!supabase) {
            return res.status(500).json({ error: 'Supabase belum tersambung ke project ini' });
        }
        return next();
    })
);

api.post(
    '/login',
    wrap(async (req, res) => {
        if (!supabaseAuth) return res.status(500).json({ error: 'Supabase Auth belum dikonfigurasi' });

        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });

        const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
        if (error || !data.user || !data.session) return res.status(401).json({ error: 'Email atau password salah' });
        if (!isAdminUser(data.user)) return res.status(403).json({ error: 'Akun ini tidak memiliki role admin' });

        res.json({
            token: data.session.access_token,
            expiresAt: data.session.expires_at,
            user: { id: data.user.id, email: data.user.email }
        });
    })
);

api.get(
    '/products',
    wrap(async (req, res) => {
        const { data, error } = await supabase.from('products').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
        if (error) throw error;
        res.json({ products: data.map(mapDBToProduct) });
    })
);

api.get(
    '/settings',
    wrap(async (req, res) => {
        const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
        if (error && error.code !== 'PGRST116') throw error; // ignore no rows error
        res.json({ settings: data ? mapDBToSettings(data) : {}, mockMode: olsera.isMockMode() });
    })
);

api.get(
    '/promos',
    wrap(async (req, res) => {
        const now = new Date().toISOString();
        const { data, error } = await supabase
            .from('promos')
            .select('*')
            .eq('is_active', true)
            .or(`starts_at.is.null,starts_at.lte.${now}`)
            .or(`ends_at.is.null,ends_at.gte.${now}`);
        if (error) throw error;
        res.json({ promos: data.map(mapDBToPromo) });
    })
);

function calculatePromoDiscount(promoRow, subtotal) {
    if (!promoRow || promoRow.is_active === false) return { valid: false, message: 'Kode promo tidak valid' };
    const now = Date.now();
    if (promoRow.starts_at && new Date(promoRow.starts_at).getTime() > now) return { valid: false, message: 'Promo belum dimulai' };
    if (promoRow.ends_at && new Date(promoRow.ends_at).getTime() < now) return { valid: false, message: 'Promo sudah berakhir' };
    if (promoRow.usage_limit != null && Number(promoRow.usage_count || 0) >= Number(promoRow.usage_limit)) {
        return { valid: false, message: 'Kuota promo sudah habis' };
    }
    if (subtotal < Number(promoRow.min_subtotal || 0)) {
        return { valid: false, message: `Minimum belanja promo Rp ${Number(promoRow.min_subtotal).toLocaleString('id-ID')}` };
    }

    let discount = promoRow.type === 'percent'
        ? Math.round((subtotal * Number(promoRow.value)) / 100)
        : Number(promoRow.value);
    if (promoRow.max_discount != null) discount = Math.min(discount, Number(promoRow.max_discount));
    discount = Math.max(0, Math.min(discount, subtotal));
    return { valid: true, discount };
}

api.post(
    '/promos/validate',
    wrap(async (req, res) => {
        const code = String(req.body.code || '').trim().toUpperCase();
        const subtotal = Number(req.body.subtotal) || 0;
        const { data: promoRow, error } = await supabase.from('promos').select('*').eq('code', code).single();
        
        if (error || !promoRow) return res.json({ valid: false, message: 'Kode promo tidak valid' });
        const validation = calculatePromoDiscount(promoRow, subtotal);
        if (!validation.valid) return res.json(validation);
        const promo = mapDBToPromo(promoRow);
        res.json({ valid: true, promo: { ...promo, discount: validation.discount } });
    })
);

async function syncOrder(order) {
    try {
        const result = await olsera.syncOrderToOlsera(order);
        const updateData = { olsera_order_id: result.olseraOrderId, olsera_sync_status: 'synced', olsera_sync_error: null };
        await supabase.from('orders').update(updateData).eq('id', order.id);
        await addLog(`Order ${order.id} tersinkron ke Olsera (${olsera.isMockMode() ? 'MOCK' : 'LIVE'}) ✓`, 'ok');
        return { synced: true, olseraOrderId: result.olseraOrderId };
    } catch (err) {
        const updateData = { olsera_sync_status: 'sync_failed', olsera_sync_error: err.message };
        await supabase.from('orders').update(updateData).eq('id', order.id);
        await addLog(`Gagal sinkron order ${order.id}: ${err.message}`, 'err');
        return { synced: false, error: err.message };
    }
}

api.post(
    '/orders',
    wrap(async (req, res) => {
        const { customer, items } = req.body || {};
        if (!customer || !customer.name) return res.status(400).json({ error: 'customer.name wajib diisi' });
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items tidak boleh kosong' });

        const quantities = new Map();
        for (const item of items) {
            const qty = Number(item.qty);
            if (!item.id || !Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: 'Item atau jumlah pesanan tidak valid' });
            quantities.set(String(item.id), (quantities.get(String(item.id)) || 0) + qty);
        }

        const productIds = [...quantities.keys()];
        const { data: productRows, error: productError } = await supabase
            .from('products')
            .select('id,name,price,olsera_sku,is_active')
            .in('id', productIds)
            .eq('is_active', true);
        if (productError) throw productError;
        if (!productRows || productRows.length !== productIds.length) {
            return res.status(400).json({ error: 'Salah satu produk tidak tersedia' });
        }

        const normalizedItems = productRows.map((product) => {
            const qty = quantities.get(product.id);
            return {
                id: product.id,
                name: product.name,
                price: Number(product.price),
                qty,
                olsera_sku: product.olsera_sku,
                subtotal: Number(product.price) * qty
            };
        });
        const subtotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);

        let promoRow = null;
        let discount = 0;
        const promoCode = String(req.body.promoCode || '').trim().toUpperCase() || null;
        if (promoCode) {
            const { data, error } = await supabase.from('promos').select('*').eq('code', promoCode).single();
            if (error || !data) return res.status(400).json({ error: 'Kode promo tidak valid' });
            const validation = calculatePromoDiscount(data, subtotal);
            if (!validation.valid) return res.status(400).json({ error: validation.message });
            promoRow = data;
            discount = validation.discount;
        }

        const { data: settingsRow, error: settingsError } = await supabase.from('settings').select('tax_percent').eq('id', 1).single();
        if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;
        const taxPercent = Number(settingsRow?.tax_percent || 0);
        const tax = Math.round(Math.max(0, subtotal - discount) * taxPercent / 100);
        const total = Math.max(0, subtotal - discount + tax);
        if (total <= 0) return res.status(400).json({ error: 'Total pesanan tidak valid' });

        const id = req.body.id || `RAMI-${Date.now().toString(36).toUpperCase()}`;
        const paymentStatus = req.body.paymentStatus || (req.body.paymentMethod === 'Bayar di tempat' ? 'unpaid' : 'paid');
        
        const order = {
            ...req.body,
            id,
            items: normalizedItems,
            subtotal,
            discount,
            promoCode,
            tax,
            total,
            fulfillment: req.body.fulfillment === 'dine-in' ? 'dine-in' : 'pickup',
            paymentMethod: req.body.paymentMethod || 'QRIS',
            paymentStatus,
            paidAt: paymentStatus === 'paid' ? new Date().toISOString() : null,
            status: 'pending',
            createdAt: new Date().toISOString(),
        };

        // Insert Order
        const { error: orderError } = await supabase.from('orders').insert(mapOrderToDB(order));
        if (orderError) throw orderError;

        // Insert Order Items
        const orderItems = normalizedItems.map(item => ({
            order_id: id,
            product_id: item.id,
            product_name: item.name,
            product_price: item.price,
            olsera_sku: item.olsera_sku || null,
            quantity: item.qty,
            subtotal: item.subtotal || (item.price * item.qty)
        }));
        
        const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
        if (itemsError) {
            await supabase.from('orders').delete().eq('id', id);
            throw itemsError;
        }

        if (promoRow) {
            await supabase
                .from('promos')
                .update({ usage_count: Number(promoRow.usage_count || 0) + 1 })
                .eq('code', promoRow.code);
        }

        await addLog(`Pesanan baru ${id} dari ${customer.name}`);

        const sync = paymentStatus === 'paid' ? await syncOrder(order) : { synced: false };
        
        // Fetch saved order with items
        const { data: savedOrderRow } = await supabase.from('orders').select('*, order_items(*)').eq('id', id).single();
        
        res.status(201).json({ order: mapDBToOrder(savedOrderRow), olsera: sync });
    })
);

/* ------------------------------------------------------------------ */
/* 6. Endpoint admin (wajib token dari /login)                         */
/* ------------------------------------------------------------------ */
api.use(wrap(requireAdmin));

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
        
        const { error } = await supabase.from('products').upsert(mapProductToDB(product));
        if (error) throw error;
        
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
        
        const { data: productRow, error: fetchError } = await supabase.from('products').select('*').eq('id', req.params.id).single();
        if (fetchError || !productRow) return res.status(404).json({ error: 'Produk tidak ditemukan' });
        
        const { error: updateError } = await supabase.from('products').update({ price }).eq('id', req.params.id);
        if (updateError) throw updateError;
        
        const product = mapDBToProduct({ ...productRow, price });
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
        const { error } = await supabase.from('products').delete().eq('id', req.params.id);
        if (error) throw error;
        await addLog(`Produk ${req.params.id} dihapus`);
        res.json({ ok: true });
    })
);

/* --- Pengaturan toko & QRIS --- */
api.post(
    '/settings',
    wrap(async (req, res) => {
        const { data: currentSettings } = await supabase.from('settings').select('*').eq('id', 1).single();
        const settings = { ...(currentSettings ? mapDBToSettings(currentSettings) : {}), ...req.body };
        delete settings.adminPin;
        
        const { error } = await supabase.from('settings').upsert(mapSettingsToDB(settings));
        if (error) throw error;
        
        await addLog('Pengaturan toko/QRIS disimpan', 'ok');
        res.json({ ok: true, settings });
    })
);

/* --- Pesanan --- */
api.get(
    '/orders',
    wrap(async (req, res) => {
        const { data, error } = await supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ orders: data.map(mapDBToOrder) });
    })
);

api.get(
    '/orders/:id',
    wrap(async (req, res) => {
        const { data, error } = await supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: 'Order tidak ditemukan' });
        res.json({ order: mapDBToOrder(data) });
    })
);

api.put(
    '/orders/:id/status',
    wrap(async (req, res) => {
        const { data: orderRow, error: fetchError } = await supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
        if (fetchError || !orderRow) return res.status(404).json({ error: 'Order tidak ditemukan' });
        
        const updateData = {};
        if (req.body.paymentStatus) {
            updateData.payment_status = req.body.paymentStatus;
            if (req.body.paymentStatus === 'paid' && !orderRow.paid_at) updateData.paid_at = new Date().toISOString();
        }
        if (req.body.status) updateData.status = req.body.status;
        
        const { error: updateError } = await supabase.from('orders').update(updateData).eq('id', req.params.id);
        if (updateError) throw updateError;
        
        await addLog(`Status pesanan ${req.params.id}: ${updateData.payment_status || orderRow.payment_status}`, 'ok');

        const updatedOrderRow = { ...orderRow, ...updateData };
        const order = mapDBToOrder(updatedOrderRow);

        let synced = null;
        if (updateData.payment_status === 'paid' && orderRow.olsera_sync_status !== 'synced') {
            synced = await syncOrder(order);
        }
        
        const { data: finalOrder } = await supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
        res.json({ ok: true, order: mapDBToOrder(finalOrder), olsera: synced });
    })
);

api.post(
    '/orders/:id/pay',
    wrap(async (req, res) => {
        const { data: orderRow, error: fetchError } = await supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
        if (fetchError || !orderRow) return res.status(404).json({ error: 'Order tidak ditemukan' });
        
        const updateData = { payment_status: 'paid', paid_at: new Date().toISOString() };
        await supabase.from('orders').update(updateData).eq('id', req.params.id);
        
        const order = mapDBToOrder({ ...orderRow, ...updateData });
        const synced = await syncOrder(order);
        
        const { data: finalOrder } = await supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
        res.json({ order: mapDBToOrder(finalOrder), olsera: synced });
    })
);

api.post(
    '/orders/:id/resync',
    wrap(async (req, res) => {
        const { data: orderRow, error: fetchError } = await supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
        if (fetchError || !orderRow) return res.status(404).json({ error: 'Order tidak ditemukan' });
        
        const order = mapDBToOrder(orderRow);
        const synced = await syncOrder(order);
        
        const { data: finalOrder } = await supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
        res.json({ ok: true, order: mapDBToOrder(finalOrder), olsera: synced });
    })
);

/* --- Olsera (sync massal katalog) --- */
api.post(
    '/olsera/sync-all',
    wrap(async (req, res) => {
        const { data: products } = await supabase.from('products').select('*');
        let successCount = 0;
        for (const productRow of products || []) {
            try {
                await olsera.syncProductPriceToOlsera(mapDBToProduct(productRow));
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
        const { data, error } = await supabase.from('promos').select('*');
        if (error) throw error;
        res.json({ promos: data.map(mapDBToPromo) });
    })
);

api.post(
    '/promos',
    wrap(async (req, res) => {
        const code = String(req.body.code || '').trim().toUpperCase();
        const value = Number(req.body.value);
        if (!code || !(value > 0)) return res.status(400).json({ error: 'Kode dan nilai promo wajib diisi dengan benar' });
        
        const promo = { ...req.body, code, value, active: req.body.active !== false };
        const { error } = await supabase.from('promos').upsert(mapPromoToDB(promo));
        if (error) throw error;
        
        await addLog(`Kode promo "${code}" disimpan`, 'ok');
        res.json({ ok: true, promo });
    })
);

api.put(
    '/promos/:code/toggle',
    wrap(async (req, res) => {
        const code = req.params.code.toUpperCase();
        const { data: promoRow, error: fetchError } = await supabase.from('promos').select('*').eq('code', code).single();
        if (fetchError || !promoRow) return res.status(404).json({ error: 'Kode promo tidak ditemukan' });
        
        const newActiveStatus = !promoRow.is_active;
        await supabase.from('promos').update({ is_active: newActiveStatus }).eq('code', code);
        
        res.json({ ok: true, promo: mapDBToPromo({ ...promoRow, is_active: newActiveStatus }) });
    })
);

api.delete(
    '/promos/:code',
    wrap(async (req, res) => {
        const code = req.params.code.toUpperCase();
        await supabase.from('promos').delete().eq('code', code);
        await addLog(`Kode promo ${code} dihapus`);
        res.json({ ok: true });
    })
);

/* --- Log aktivitas --- */
api.get(
    '/logs',
    wrap(async (req, res) => {
        const { data, error } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(60);
        if (error) throw error;
        
        res.json({ logs: data.map(row => ({ time: new Date(row.created_at).getTime(), level: row.level, message: row.message })) });
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
    res.status(err.status || 500).json(databaseErrorPayload(err));
});

/* ------------------------------------------------------------------ */
/* 8. Ekspor app. Mode lokal (app.listen) ditangani oleh api/index.js  */
/* ------------------------------------------------------------------ */
module.exports = app;

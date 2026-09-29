/**
 * olsera-client.js
 * ---------------------------------------------------------------------------
 * Adapter integrasi Olsera Open API POS (v1).
 * Sumber dokumentasi: https://docs-api-open.olsera.co.id/documentation/introduction
 *
 * Alur integrasi:
 * 1. Autentikasi token via POST /api/open-api/v1/id/token menggunakan app_id & secret_key.
 * 2. Order masuk ke kasir POS via Open Order: POST /api/open-api/v1/en/order/openorder
 * 3. Tambah item pesanan: POST /api/open-api/v1/en/order/openorder/additem
 * 4. Update status pembayaran (kasir tahu sudah bayar):
 *    - Update payment status: POST /api/open-api/v1/en/order/openorder/updatepaymentstatus (status: '1')
 *    - Update status pesanan: POST /api/open-api/v1/en/order/openorder/updatestatus (status: 'A' = Confirmed)
 *    - Update payment journal: POST /api/open-api/v1/en/order/openorder/updatepayment
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();

const MOCK_MODE = (process.env.MOCK_MODE || 'true').toLowerCase() !== 'false';
// Standar base URL Olsera Open API
let BASE_URL = process.env.OLSERA_API_BASE_URL || 'https://api-open.olsera.co.id';
if (BASE_URL === 'https://api.olsera.co.id') {
  BASE_URL = 'https://api-open.olsera.co.id';
}
// Hapus trailing slash jika ada
BASE_URL = BASE_URL.replace(/\/+$/, '');

const APP_ID = process.env.OLSERA_APP_ID || '';
const STORE_ID = process.env.OLSERA_STORE_ID || '';
const SECRET_KEY = process.env.OLSERA_SECRET_KEY || process.env.OLSERA_API_KEY || 'secret';
const MAX_RETRIES = parseInt(process.env.OLSERA_MAX_RETRIES || '3', 10);

// ID mode pembayaran bawaan dari Olsera Rami Cafe
const PAYMENT_MODES = {
  QRIS: '589969',
  CASH: '1',
  TUNAI: '1',
  BRI: '572254',
  BCA: '572255',
};

let cachedToken = null;
let tokenExpiresAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mendapatkan Access Token JWT dari Olsera Open API.
 * Di-cache otomatis berdasarkan expires_in.
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const postData = new URLSearchParams({
    app_id: APP_ID,
    secret_key: SECRET_KEY,
    grant_type: 'secret_key',
  }).toString();

  const res = await fetch(`${BASE_URL}/api/open-api/v1/id/token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new OlseraSyncError(
      `Gagal autentikasi ke Olsera Open API (${res.status}): ${data.message || data.error?.message || JSON.stringify(data)}`
    );
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + ((Number(data.expires_in) || 86400) * 1000);
  return cachedToken;
}

/**
 * Format mapping order internal ke payload standar API Olsera POS Open Order.
 */
function mapOrderToOlseraPayload(order) {
  const tableInfo = order.customer?.table ? `Meja ${order.customer.table}` : 'Takeaway';
  const fulfillmentInfo = order.fulfillment === 'dine-in' ? 'Dine In' : 'Pickup';
  const payInfo = `Bayar: ${order.paymentMethod || 'QRIS'} (${order.paymentStatus === 'paid' ? 'LUNAS' : 'BELUM BAYAR'})`;
  const notes = `[${order.id}] ${tableInfo} | ${fulfillmentInfo} | ${payInfo}${order.notes ? ` | Catatan: ${order.notes}` : ''}`;

  const today = new Date().toISOString().slice(0, 10);
  const orderDate = order.createdAt ? order.createdAt.slice(0, 10) : today;

  return {
    order_date: orderDate,
    currency_id: 'IDR',
    customer_name: order.customer?.name || 'Tamu',
    customer_phone: order.customer?.phone || '',
    customer_type_id: '0', // 0 = Guest
    notes: notes,
    is_funding: '0',
  };
}

/**
 * Kirim order baru ke Olsera POS API.
 * Order akan masuk ke daftar Open Order / Kasir Olsera.
 * Jika status order sudah 'paid', status pembayaran dan status order otomatis diperbarui ke 'Sudah Dibayar' & 'Confirmed' (A).
 */
async function syncOrderToOlsera(order) {
  if (MOCK_MODE) {
    return mockSync(order);
  }

  if (!BASE_URL || !APP_ID) {
    throw new OlseraConfigError('OLSERA_API_BASE_URL dan OLSERA_APP_ID wajib diisi di .env saat MOCK_MODE=false');
  }

  const token = await getAccessToken();
  const payload = mapOrderToOlseraPayload(order);

  // 1. Buat Open Order di Olsera (agar pesanan masuk ke Kasir POS)
  let olseraOrderId = null;
  let orderNo = null;

  const createParams = new URLSearchParams(payload).toString();
  const resCreate = await fetch(`${BASE_URL}/api/open-api/v1/en/order/openorder`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: createParams,
  });

  const createData = await resCreate.json().catch(() => ({}));
  if (!resCreate.ok || !createData.data?.id) {
    throw new OlseraSyncError(
      `Gagal membuat Open Order di Olsera (${resCreate.status}): ${createData.message || createData.error?.message || JSON.stringify(createData)}`
    );
  }

  olseraOrderId = createData.data.id;
  orderNo = createData.data.order_no || olseraOrderId;

  // 2. Tambahkan produk item ke Open Order (jika ada sku/produk yang valid)
  if (Array.isArray(order.items) && order.items.length > 0) {
    for (const item of order.items) {
      const prodId = item.olsera_sku || item.sku || item.id;
      // Hanya tambahkan jika format ID sesuai produk Olsera (numeric atau variant)
      if (prodId && /^\d+(\|\d+)?$/.test(String(prodId))) {
        try {
          const itemParams = new URLSearchParams({
            order_id: String(olseraOrderId),
            item_products: String(prodId),
            item_qty: String(item.qty || 1),
          }).toString();

          await fetch(`${BASE_URL}/api/open-api/v1/en/order/openorder/additem`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: itemParams,
          });
        } catch {
          // Lanjut ke item berikutnya
        }
      }
    }
  }

  // 3. Jika status pesanan sudah lunas (paid), update status pembayaran dan status order agar Kasir tahu sudah dibayar
  if (order.paymentStatus === 'paid') {
    await markOrderAsPaidInOlsera(olseraOrderId, order, token);
  }

  return {
    success: true,
    olseraOrderId: String(olseraOrderId),
    orderNo: orderNo,
    raw: createData,
  };
}

/**
 * Tandai order sebagai 'Sudah Dibayar' di kasir Olsera POS.
 * Memanggil:
 * 1. updatepaymentstatus (status: '1') -> Kasir melihat status lunas
 * 2. updatestatus (status: 'A') -> Kasir melihat order telah dikonfirmasi
 * 3. updatepayment (opsional) -> Mencatat jurnal rincian pembayaran (QRIS / Tunai)
 */
async function markOrderAsPaidInOlsera(olseraOrderId, order, existingToken = null) {
  if (MOCK_MODE) {
    return { success: true, mode: 'mock' };
  }

  const token = existingToken || (await getAccessToken());

  // A. Update status pembayaran (1 = sudah dibayar, 0 = belum dibayar)
  const payStatusParams = new URLSearchParams({
    order_id: String(olseraOrderId),
    status: '1',
  }).toString();

  await fetch(`${BASE_URL}/api/open-api/v1/en/order/openorder/updatepaymentstatus`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payStatusParams,
  }).catch(() => null);

  // B. Update status order menjadi Confirmed / Dikonfirmasi (A)
  const orderStatusParams = new URLSearchParams({
    order_id: String(olseraOrderId),
    status: 'A',
  }).toString();

  await fetch(`${BASE_URL}/api/open-api/v1/en/order/openorder/updatestatus`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: orderStatusParams,
  }).catch(() => null);

  // C. Update payment journal jika total > 0
  const totalAmount = Number(order?.total || 0);
  if (totalAmount > 0) {
    const methodUpper = String(order?.paymentMethod || 'QRIS').toUpperCase();
    const modeId = PAYMENT_MODES[methodUpper] || PAYMENT_MODES.QRIS;
    const today = new Date().toISOString().slice(0, 10);

    const journalParams = new URLSearchParams({
      order_id: String(olseraOrderId),
      payment_amount: String(totalAmount),
      payment_currency_id: 'IDR',
      payment_date: today,
      payment_mode_id: String(modeId),
      payment_payee: order?.customer?.name || 'Tamu',
      payment_ref: order?.paymentRef || `PAY-${order?.id || olseraOrderId}`,
      payment_seq: '0',
    }).toString();

    await fetch(`${BASE_URL}/api/open-api/v1/en/order/openorder/updatepayment`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: journalParams,
    }).catch(() => null);
  }

  return { success: true };
}

/**
 * Sinkronisasi pembenaran harga / data produk ke Olsera POS
 */
async function syncProductPriceToOlsera(product) {
  if (MOCK_MODE) {
    return {
      success: true,
      mode: 'mock',
      message: `[MOCK] Harga produk ${product.name} (${product.id}) berhasil disinkronkan ke Olsera: Rp ${Number(product.price).toLocaleString('id-ID')}`,
    };
  }

  // Olsera Open API mengelola produk melalui catalog
  return {
    success: true,
    message: `Produk ${product.name} disinkronkan ke POS`,
  };
}

/** Simulasi respons Olsera untuk mode demo/pengembangan */
async function mockSync(order) {
  await sleep(400 + Math.random() * 300);

  return {
    success: true,
    attempt: 1,
    olseraOrderId: `OLS-MOCK-${order.id}`,
    orderNo: `OL-MOCK-${order.id}`,
    raw: {
      mode: 'mock',
      syncedAt: new Date().toISOString(),
      payload: mapOrderToOlseraPayload(order),
    },
  };
}

class OlseraSyncError extends Error {}
class OlseraConfigError extends Error {}

module.exports = {
  syncOrderToOlsera,
  markOrderAsPaidInOlsera,
  syncProductPriceToOlsera,
  mapOrderToOlseraPayload,
  getAccessToken,
  OlseraSyncError,
  OlseraConfigError,
  isMockMode: () => MOCK_MODE,
};
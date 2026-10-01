/**
 * olsera-client.js
 * Adapter integrasi Olsera Open API POS (v1).
 * Dokumentasi: https://docs-api-open.olsera.co.id/documentation
 *
 * ALUR LENGKAP (agar order web langsung muncul & terupdate di kasir Olsera POS):
 * [1]  Auth         : POST /api/open-api/v1/id/token
 * [2]  Buat order   : POST /api/open-api/v1/en/order/openorder                    -> masuk Open Order kasir
 * [3]  Tambah item  : POST /api/open-api/v1/en/order/openorder/additem            -> isi produk ke order
 * [4a] Status bayar : POST /api/open-api/v1/en/order/openorder/updatepaymentstatus  (status=1 -> lunas)
 * [4b] Status order : POST /api/open-api/v1/en/order/openorder/updatestatus         (status=A -> konfirmasi)
 * [4c] Jurnal bayar : POST /api/open-api/v1/en/order/openorder/updatepayment        (metode + jumlah)
 */
require('dotenv').config();

const MOCK_MODE = (process.env.MOCK_MODE || 'true').toLowerCase() !== 'false';

let BASE_URL = process.env.OLSERA_API_BASE_URL || 'https://api-open.olsera.co.id';
if (BASE_URL === 'https://api.olsera.co.id') BASE_URL = 'https://api-open.olsera.co.id';
BASE_URL = BASE_URL.replace(/\/+$/, '');

const APP_ID = process.env.OLSERA_APP_ID || '';
const SECRET_KEY = process.env.OLSERA_SECRET_KEY || process.env.OLSERA_API_KEY || 'secret';

/* Endpoint */
const EP = {
  TOKEN: '/api/open-api/v1/id/token',
  CREATE_ORDER: '/api/open-api/v1/en/order/openorder',
  ADD_ITEM: '/api/open-api/v1/en/order/openorder/additem',
  UPDATE_PAY_STATUS: '/api/open-api/v1/en/order/openorder/updatepaymentstatus',
  UPDATE_STATUS: '/api/open-api/v1/en/order/openorder/updatestatus',
  UPDATE_PAYMENT: '/api/open-api/v1/en/order/openorder/updatepayment',
};

/* Mapping metode bayar -> payment_mode_id Olsera (sesuaikan dgn akun Olsera Anda) */
const PAYMENT_MODE_IDS = {
  'QRIS': '589969',
  'GOPAY': '589969',
  'BAYAR DI TEMPAT': '1',
  'CASH': '1',
  'TUNAI': '1',
  'DEBIT': '1',
  'BRI': '572254',
  'BCA': '572255',
};

let cachedToken = null;
let tokenExpiresAt = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class OlseraConfigError extends Error {
  constructor(m) { super(m); this.name = 'OlseraConfigError'; }
}
class OlseraSyncError extends Error {
  constructor(m) { super(m); this.name = 'OlseraSyncError'; }
}

/* ------------------------------------------------------------------ */
/* [1] AUTENTIKASI                                                     */
/* ------------------------------------------------------------------ */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) return cachedToken;

  const res = await fetch(`${BASE_URL}${EP.TOKEN}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      app_id: APP_ID,
      secret_key: SECRET_KEY,
      grant_type: 'secret_key',
    }).toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new OlseraSyncError(
      `[Olsera] Gagal auth (${res.status}): ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + Number(data.expires_in || 86400) * 1000;
  return cachedToken;
}

/* ------------------------------------------------------------------ */
/* HELPER: POST ke Olsera dengan retry (hanya untuk 5xx / 429 / network) */
/* ------------------------------------------------------------------ */
async function olseraPost(endpoint, params, token, stepName) {
  const url = `${BASE_URL}${endpoint}`;
  const label = `[Olsera][${stepName}]`;
  let lastErr = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
      });
    } catch (err) {
      // error jaringan -> coba ulang
      lastErr = err.message;
      if (attempt < 3) { await sleep(500 * attempt); continue; }
      throw new OlseraSyncError(`${label} gagal setelah 3 percobaan: ${lastErr}`);
    }

    const json = await res.json().catch(() => ({}));

    if (res.ok) return json;

    lastErr = `${label} (${res.status}): ${JSON.stringify(json).slice(0, 300)}`;
    const retryable = res.status >= 500 || res.status === 429;
    if (retryable && attempt < 3) { await sleep(500 * attempt); continue; }
    throw new OlseraSyncError(lastErr); // 4xx -> tidak di-retry
  }

  throw new OlseraSyncError(lastErr || `${label} gagal`);
}

/* ------------------------------------------------------------------ */
/* FORMAT PAYLOAD ORDER                                                */
/* ------------------------------------------------------------------ */
function mapOrderToOlseraPayload(order) {
  const customer = order.customer || {};
  const tableInfo = customer.table ? `Meja ${customer.table}` : 'Takeaway';
  const payTag = `${order.paymentMethod || 'QRIS'} ${order.paymentStatus === 'paid' ? '(LUNAS)' : '(BELUM BAYAR)'}`;
  const notes = [`Web Order ${order.id || ''}`.trim(), tableInfo, payTag, order.notes]
    .filter(Boolean)
    .join(' | ');

  return {
    order_date: (order.createdAt || new Date().toISOString()).slice(0, 10),
    currency_id: 'IDR',
    customer_name: customer.name || 'Tamu',
    customer_phone: customer.phone || '',
    customer_type_id: '0',
    notes,
    is_funding: '0',
  };
}

/* ------------------------------------------------------------------ */
/* [2]+[3]+[4] SYNC ORDER BARU                                         */
/* ------------------------------------------------------------------ */
async function syncOrderToOlsera(order) {
  if (MOCK_MODE) return mockSync(order);
  if (!BASE_URL || !APP_ID) {
    throw new OlseraConfigError('OLSERA_API_BASE_URL dan OLSERA_APP_ID wajib diisi di .env');
  }

  const token = await getAccessToken();

  /* [2] Buat Open Order -> langsung masuk kasir POS */
  const createData = await olseraPost(EP.CREATE_ORDER, mapOrderToOlseraPayload(order), token, 'CreateOrder');
  if (!createData.data || !createData.data.id) {
    throw new OlseraSyncError(
      `[Olsera][CreateOrder] Tidak ada order id: ${JSON.stringify(createData).slice(0, 300)}`
    );
  }
  const olseraOrderId = String(createData.data.id);
  const orderNo = createData.data.order_no || olseraOrderId;
  console.log(`[Olsera] Order dibuat: olseraOrderId=${olseraOrderId}, orderNo=${orderNo}`);

  /* [3] Tambah item produk */
  let itemResult = { added: 0, skipped: 0 };
  if (Array.isArray(order.items) && order.items.length > 0) {
    itemResult = await addItemsToOlseraOrder(olseraOrderId, order.items, token);
  }

  /* [4] Update status bayar, status order & jurnal pembayaran jika sudah lunas */
  let paymentResult = null;
  if (order.paymentStatus === 'paid') {
    paymentResult = await markOrderAsPaidInOlsera(olseraOrderId, order, token);
  }

  return {
    success: true,
    olseraOrderId,
    orderNo,
    items: itemResult,
    payment: paymentResult,
    raw: createData,
  };
}

/* ------------------------------------------------------------------ */
/* [3] TAMBAH ITEM                                                     */
/* ------------------------------------------------------------------ */
async function addItemsToOlseraOrder(olseraOrderId, items, token) {
  const authToken = token || (await getAccessToken());
  let added = 0;
  let skipped = 0;

  for (const item of items) {
    const prodId = item.olsera_sku || item.sku || item.id;

    // Format valid: "12345" atau "12345|678" (produk|varian)
    if (!prodId || !/^\d+(\|\d+)?$/.test(String(prodId))) {
      console.warn(`[Olsera][AddItem] Lewati "${item.name || prodId}" — olsera_sku tidak valid: ${prodId}`);
      skipped++;
      continue;
    }

    try {
      await olseraPost(EP.ADD_ITEM, {
        order_id: String(olseraOrderId),
        item_products: String(prodId),
        item_qty: String(item.qty || 1),
      }, authToken, `AddItem[${prodId}]`);
      added++;
      console.log(`[Olsera][AddItem] ${item.name || prodId} qty=${item.qty || 1} OK`);
    } catch (err) {
      skipped++;
      console.warn(`[Olsera][AddItem] Gagal ${item.name || prodId}: ${err.message}`);
    }
  }

  console.log(`[Olsera][AddItem] Selesai: ${added} berhasil, ${skipped} dilewati`);
  return { added, skipped };
}

/* ------------------------------------------------------------------ */
/* [4] TANDAI LUNAS DI KASIR (3 sub-endpoint)                          */
/* ------------------------------------------------------------------ */
async function markOrderAsPaidInOlsera(olseraOrderId, order, existingToken) {
  if (MOCK_MODE) {
    console.log(`[Olsera][MOCK] markOrderAsPaidInOlsera id=${olseraOrderId}`);
    return { success: true, mode: 'mock' };
  }

  const token = existingToken || (await getAccessToken());
  const errors = [];

  /* [4a] updatepaymentstatus status=1 (Lunas) */
  try {
    await olseraPost(EP.UPDATE_PAY_STATUS, {
      order_id: String(olseraOrderId),
      status: '1',
    }, token, 'UpdatePayStatus');
    console.log(`[Olsera][UpdatePayStatus] ${olseraOrderId} -> status=1 (Lunas) OK`);
  } catch (err) {
    console.error(`[Olsera][UpdatePayStatus] Gagal: ${err.message}`);
    errors.push(`updatepaymentstatus: ${err.message}`);
  }

  /* [4b] updatestatus status=A (Confirmed) */
  try {
    await olseraPost(EP.UPDATE_STATUS, {
      order_id: String(olseraOrderId),
      status: 'A',
    }, token, 'UpdateOrderStatus');
    console.log(`[Olsera][UpdateOrderStatus] ${olseraOrderId} -> status=A (Confirmed) OK`);
  } catch (err) {
    console.error(`[Olsera][UpdateOrderStatus] Gagal: ${err.message}`);
    errors.push(`updatestatus: ${err.message}`);
  }

  /* [4c] updatepayment (jurnal nominal & metode) */
  const total = Number((order && order.total) || 0);
  if (total > 0) {
    try {
      const methodUpper = String((order && order.paymentMethod) || 'QRIS').toUpperCase().trim();
      const modeId = PAYMENT_MODE_IDS[methodUpper] || PAYMENT_MODE_IDS['QRIS'];
      const payDate = ((order && order.paidAt) ? order.paidAt : new Date().toISOString()).slice(0, 10);
      const payRef = (order && order.paymentRef) || `PAY-${olseraOrderId}`;

      await olseraPost(EP.UPDATE_PAYMENT, {
        order_id: String(olseraOrderId),
        payment_amount: String(total),
        payment_currency_id: 'IDR',
        payment_date: payDate,
        payment_mode_id: String(modeId),
        payment_payee: (order && order.customer && order.customer.name) || 'Tamu',
        payment_ref: payRef,
        payment_seq: '1',
      }, token, 'UpdatePayment');
      console.log(`[Olsera][UpdatePayment] Rp${total} via ${methodUpper} modeId=${modeId} OK`);
    } catch (err) {
      console.error(`[Olsera][UpdatePayment] Gagal: ${err.message}`);
      errors.push(`updatepayment: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[Olsera] markOrderAsPaidInOlsera selesai dengan peringatan: ${errors.join(' | ')}`);
    return { success: true, warnings: errors };
  }
  return { success: true };
}

/* ------------------------------------------------------------------ */
/* SINKRON HARGA PRODUK (placeholder)                                  */
/* ------------------------------------------------------------------ */
async function syncProductPriceToOlsera(product) {
  if (MOCK_MODE) {
    return { success: true, mode: 'mock', message: `[MOCK] Produk ${product && product.name} disinkronkan` };
  }
  return { success: true, message: `Produk ${product && product.name} dicatat` };
}

/* ------------------------------------------------------------------ */
/* MOCK                                                                */
/* ------------------------------------------------------------------ */
async function mockSync(order) {
  await sleep(350 + Math.random() * 250);
  const stamp = Date.now();
  const fakeId = `OLS-MOCK-${stamp}`;
  console.log(`[Olsera][MOCK] order=${order && order.id} fakeId=${fakeId}`);
  return {
    success: true,
    olseraOrderId: fakeId,
    orderNo: `OL-MOCK-${stamp}`,
    raw: { mode: 'mock', syncedAt: new Date().toISOString() },
  };
}

module.exports = {
  syncOrderToOlsera,
  addItemsToOlseraOrder,
  markOrderAsPaidInOlsera,
  syncProductPriceToOlsera,
  mapOrderToOlseraPayload,
  getAccessToken,
  OlseraSyncError,
  OlseraConfigError,
  isMockMode: () => MOCK_MODE,
};
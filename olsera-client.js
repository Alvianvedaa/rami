/**
 * olsera-client.js
 * ---------------------------------------------------------------------------
 * Adapter integrasi Olsera POS API.
 * Mendukung sinkronisasi order/pesanan lengkap beserta rincian pembayaran (QRIS, Tunai, Bank),
 * diskon kode promo, dan pembenaran harga produk ke sistem kasir Olsera.
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();

// Perbaikan bug MOCK_MODE: default true jika belum diisi, atau sesuai nilai env
const MOCK_MODE = (process.env.MOCK_MODE || 'true').toLowerCase() !== 'false';
const BASE_URL = process.env.OLSERA_API_BASE_URL || '';
const API_KEY = process.env.OLSERA_API_KEY || '';
const OUTLET_ID = process.env.OLSERA_OUTLET_ID || '';
const MAX_RETRIES = parseInt(process.env.OLSERA_MAX_RETRIES || '3', 10);

/**
 * Format mapping order internal ke payload standar API Olsera POS.
 */
function mapOrderToOlseraPayload(order) {
  return {
    outlet_id: OUTLET_ID || 'DEFAULT-OUTLET',
    external_order_id: order.id,
    order_type: order.fulfillment === 'dine-in' ? 'dine_in' : 'take_away',
    status: order.paymentStatus === 'paid' ? 'completed' : 'pending',
    customer: {
      name: order.customer?.name || 'Tamu',
      phone: order.customer?.phone || null,
    },
    // Informasi pembayaran ke Olsera
    payment: {
      method: order.paymentMethod || 'QRIS',
      status: order.paymentStatus || 'paid',
      amount_paid: Number(order.total) || 0,
      payment_ref: order.paymentRef || (order.paymentMethod === 'QRIS' ? `QRIS-${order.id}` : null),
      paid_at: order.paymentStatus === 'paid' ? (order.paidAt || new Date().toISOString()) : null,
    },
    // Rincian promo & diskon
    discount: {
      code: order.promoCode || null,
      amount: Number(order.discount) || 0,
    },
    // Rincian item
    items: (order.items || []).map((item) => ({
      sku: item.olsera_sku || item.id,
      name: item.name,
      qty: Number(item.qty) || 1,
      unit_price: Number(item.price) || 0,
      subtotal: (Number(item.price) || 0) * (Number(item.qty) || 1),
    })),
    subtotal: Number(order.subtotal) || 0,
    tax: Number(order.tax) || 0,
    total: Number(order.total) || 0,
    note: `Pesan online Rami Storefront | Metode: ${order.paymentMethod} | Status: ${order.paymentStatus || 'paid'}`,
    created_at: order.createdAt || new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kirim order ke Olsera POS API.
 * Jika MOCK_MODE=true, mensimulasikan respons sukses dan kembalikan ID referensi Olsera.
 */
async function syncOrderToOlsera(order) {
  if (MOCK_MODE) {
    return mockSync(order);
  }

  if (!BASE_URL || !API_KEY || !OUTLET_ID) {
    throw new OlseraConfigError(
      'OLSERA_API_BASE_URL, OLSERA_API_KEY, dan OLSERA_OUTLET_ID wajib diisi di .env saat MOCK_MODE=false'
    );
  }

  const payload = mapOrderToOlseraPayload(order);
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'X-Outlet-ID': OUTLET_ID,
        },
        body: JSON.stringify(payload),
      });

      const raw = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(`Olsera membalas status ${res.status}: ${JSON.stringify(raw)}`);
      }

      return {
        success: true,
        attempt,
        olseraOrderId: raw.id || raw.order_id || `OLS-${Date.now()}`,
        raw,
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(400 * attempt); // backoff bertahap: 400ms, 800ms, ...
      }
    }
  }

  throw new OlseraSyncError(
    `Gagal sinkron order ${order.id} ke Olsera setelah ${MAX_RETRIES} percobaan: ${lastError?.message}`
  );
}

/**
 * Sinkronisasi pembenaran harga / data produk ke Olsera POS
 */
async function syncProductPriceToOlsera(product) {
  if (MOCK_MODE) {
    return {
      success: true,
      mode: 'mock',
      message: `[MOCK] Harga produk ${product.name} (${product.id}) berhasil disinkronkan ke Olsera: Rp ${product.price.toLocaleString('id-ID')}`,
    };
  }

  if (!BASE_URL || !API_KEY) {
    throw new OlseraConfigError('OLSERA_API_BASE_URL dan OLSERA_API_KEY wajib diisi');
  }

  try {
    const res = await fetch(`${BASE_URL}/products/${product.olsera_sku || product.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        price: product.price,
        name: product.name,
        description: product.desc,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data };
  } catch (err) {
    throw new OlseraSyncError(`Gagal sync harga ke Olsera: ${err.message}`);
  }
}

/** Simulasi respons Olsera untuk mode demo/pengembangan */
async function mockSync(order) {
  await sleep(400 + Math.random() * 300);

  return {
    success: true,
    attempt: 1,
    olseraOrderId: `OLS-MOCK-${order.id}`,
    raw: {
      mode: 'mock',
      syncedAt: new Date().toISOString(),
      payload: mapOrderToOlseraPayload(order),
    },
  };
}

class OlseraSyncError extends Error { }
class OlseraConfigError extends Error { }

module.exports = {
  syncOrderToOlsera,
  syncProductPriceToOlsera,
  mapOrderToOlseraPayload,
  OlseraSyncError,
  OlseraConfigError,
  isMockMode: () => MOCK_MODE,
};
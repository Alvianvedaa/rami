/**
 * Adapter Olsera Open API.
 * Autentikasi: POST /api/open-api/v1/id/token (multipart/form-data).
 */

require('dotenv').config();

const MOCK_MODE = (process.env.MOCK_MODE || 'true').toLowerCase() !== 'false';
const API_BASE_URL = (
  process.env.OLSERA_API_BASE_URL || 'https://api-open.olsera.co.id/api/open-api/v1'
).replace(/\/+$/, '');
const TOKEN_URL = `${API_BASE_URL}/id/token`;
const APP_ID = process.env.OLSERA_APP_ID || '';
const APP_SECRET = process.env.OLSERA_APP_SECRET || '';
const STORE_ID = process.env.OLSERA_STORE_ID || '';
const OUTLET_ID = process.env.OLSERA_OUTLET_ID || '';
const LEGACY_API_KEY = process.env.OLSERA_API_KEY || '';
const MAX_RETRIES = positiveInteger(process.env.OLSERA_MAX_RETRIES, 3);
const TIMEOUT_MS = positiveInteger(process.env.OLSERA_TIMEOUT_MS, 15000);
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

let cachedAccessToken = normalizeBearerToken(process.env.OLSERA_BEARER_TOKEN || LEGACY_API_KEY);
let cachedRefreshToken = process.env.OLSERA_REFRESH_TOKEN || '';
let cachedTokenExpiresAt = getJwtExpiryMs(cachedAccessToken);
let tokenRequestInFlight = null;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBearerToken(token) {
  return String(token || '').trim().replace(/^Bearer\s+/i, '');
}

function getJwtExpiryMs(token) {
  if (!token) return 0;
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return Number(decoded.exp) > 0 ? Number(decoded.exp) * 1000 : 0;
  } catch {
    return 0;
  }
}

function isCachedTokenUsable() {
  if (!cachedAccessToken) return false;
  return !cachedTokenExpiresAt || cachedTokenExpiresAt - Date.now() > TOKEN_REFRESH_SKEW_MS;
}

function createAbortSignal(timeoutMs = TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function safeApiError(status, data, fallback) {
  const message = data?.message || data?.error?.message || data?.error || fallback;
  return `${status ? `HTTP ${status}: ` : ''}${String(message || 'Olsera API error')}`;
}

async function requestToken(grantType, credential) {
  const form = new FormData();
  form.append('grant_type', grantType);
  if (grantType === 'refresh_token') {
    form.append('refresh_token', credential);
  } else {
    form.append('app_id', APP_ID);
    form.append('secret_key', APP_SECRET);
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
    signal: createAbortSignal(),
  });
  const data = await parseResponse(res);
  if (!res.ok || !data.access_token) {
    throw new OlseraAuthError(safeApiError(res.status, data, 'Gagal memperoleh token Olsera'));
  }

  cachedAccessToken = normalizeBearerToken(data.access_token);
  cachedRefreshToken = data.refresh_token || cachedRefreshToken;
  cachedTokenExpiresAt = getJwtExpiryMs(cachedAccessToken)
    || (Number(data.expires_in) > 0 ? Date.now() + Number(data.expires_in) * 1000 : 0);
  return cachedAccessToken;
}

async function obtainFreshToken() {
  if (cachedRefreshToken) {
    try {
      return await requestToken('refresh_token', cachedRefreshToken);
    } catch {
      cachedRefreshToken = '';
    }
  }
  if (!APP_ID || !APP_SECRET) {
    throw new OlseraConfigError(
      'OLSERA_APP_ID dan OLSERA_APP_SECRET wajib diisi untuk memperbarui token Olsera otomatis'
    );
  }
  return requestToken('secret_key');
}

async function getAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && isCachedTokenUsable()) return cachedAccessToken;
  if (tokenRequestInFlight) return tokenRequestInFlight;
  tokenRequestInFlight = obtainFreshToken().finally(() => {
    tokenRequestInFlight = null;
  });
  return tokenRequestInFlight;
}

async function olseraFetch(path, options = {}, allowAuthRetry = true) {
  const token = await getAccessToken();
  const headers = {
    Accept: 'application/json',
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    signal: options.signal || createAbortSignal(),
  });
  if (res.status === 401 && allowAuthRetry) {
    await getAccessToken({ forceRefresh: true });
    return olseraFetch(path, options, false);
  }
  return res;
}

function getAuthStatus() {
  return {
    mockMode: MOCK_MODE,
    configured: Boolean(APP_ID && APP_SECRET),
    hasAccessToken: Boolean(cachedAccessToken),
    hasRefreshToken: Boolean(cachedRefreshToken),
    tokenExpiresAt: cachedTokenExpiresAt ? new Date(cachedTokenExpiresAt).toISOString() : null,
    apiBaseUrl: API_BASE_URL,
    storeIdConfigured: Boolean(STORE_ID),
    outletIdConfigured: Boolean(OUTLET_ID),
  };
}

/** Payload order lama dipertahankan sementara. Kontrak Open Order Olsera harus
 * dipetakan terpisah sebelum integrasi order diubah ke mode live. */
function mapOrderToOlseraPayload(order) {
  return {
    outlet_id: OUTLET_ID || null,
    store_id: STORE_ID || null,
    external_order_id: order.id,
    order_type: order.fulfillment === 'dine-in' ? 'dine_in' : 'take_away',
    status: order.paymentStatus === 'paid' ? 'completed' : 'pending',
    customer: {
      name: order.customer?.name || 'Tamu',
      phone: order.customer?.phone || null,
    },
    payment: {
      method: order.paymentMethod || 'QRIS',
      status: order.paymentStatus || 'paid',
      amount_paid: Number(order.total) || 0,
      payment_ref: order.paymentRef || (order.paymentMethod === 'QRIS' ? `QRIS-${order.id}` : null),
      paid_at: order.paymentStatus === 'paid' ? (order.paidAt || new Date().toISOString()) : null,
    },
    discount: {
      code: order.promoCode || null,
      amount: Number(order.discount) || 0,
    },
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

async function syncOrderToOlsera(order) {
  if (MOCK_MODE) return mockSync(order);
  if (!OUTLET_ID) {
    throw new OlseraConfigError('OLSERA_OUTLET_ID wajib diverifikasi sebelum sinkronisasi order live');
  }

  const payload = mapOrderToOlseraPayload(order);
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await olseraFetch('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Outlet-ID': OUTLET_ID },
        body: JSON.stringify(payload),
      });
      const raw = await parseResponse(res);
      if (!res.ok) throw new Error(safeApiError(res.status, raw, 'Gagal mengirim order'));
      return {
        success: true,
        attempt,
        olseraOrderId: raw.id || raw.order_id || `OLS-${Date.now()}`,
        raw,
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(400 * attempt);
    }
  }
  throw new OlseraSyncError(
    `Gagal sinkron order ${order.id} ke Olsera setelah ${MAX_RETRIES} percobaan: ${lastError?.message}`
  );
}

async function syncProductPriceToOlsera(product) {
  if (MOCK_MODE) {
    return {
      success: true,
      mode: 'mock',
      message: `[MOCK] Harga produk ${product.name} (${product.id}) berhasil disinkronkan ke Olsera: Rp ${product.price.toLocaleString('id-ID')}`,
    };
  }
  try {
    const res = await olseraFetch(`/products/${encodeURIComponent(product.olsera_sku || product.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: product.price, name: product.name, description: product.desc }),
    });
    const data = await parseResponse(res);
    if (!res.ok) throw new Error(safeApiError(res.status, data, 'Gagal memperbarui produk'));
    return { success: true, data };
  } catch (err) {
    if (err instanceof OlseraConfigError) throw err;
    throw new OlseraSyncError(`Gagal sync harga ke Olsera: ${err.message}`);
  }
}

async function mockSync(order) {
  await sleep(400 + Math.random() * 300);
  return {
    success: true,
    attempt: 1,
    olseraOrderId: `OLS-MOCK-${order.id}`,
    raw: { mode: 'mock', syncedAt: new Date().toISOString(), payload: mapOrderToOlseraPayload(order) },
  };
}

class OlseraSyncError extends Error {}
class OlseraConfigError extends Error {}
class OlseraAuthError extends Error {}

module.exports = {
  syncOrderToOlsera,
  syncProductPriceToOlsera,
  mapOrderToOlseraPayload,
  getAccessToken,
  getAuthStatus,
  OlseraSyncError,
  OlseraConfigError,
  OlseraAuthError,
  isMockMode: () => MOCK_MODE,
};

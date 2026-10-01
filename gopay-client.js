/**
 * gopay-client.js
 * ---------------------------------------------------------------------------
 * Adapter integrasi GoPay Merchant / Midtrans QRIS API.
 * Mendukung:
 * 1. Pembuatan Dynamic QRIS otomatis via GoPay / Midtrans Core API.
 * 2. Cek status pembayaran otomatis (polling inquiry).
 * 3. Penanganan Webhook notifikasi pembayaran realtime dari GoPay / Midtrans.
 * 4. Fallback jika SERVER_KEY belum diisi (menggunakan static QRIS dengan status polling).
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const crypto = require('crypto');

const SERVER_KEY = process.env.GOPAY_SERVER_KEY || process.env.MIDTRANS_SERVER_KEY || '';
const CLIENT_KEY = process.env.GOPAY_CLIENT_KEY || process.env.MIDTRANS_CLIENT_KEY || '';
const IS_PRODUCTION = (process.env.GOPAY_IS_PRODUCTION || process.env.MIDTRANS_IS_PRODUCTION || 'false').toLowerCase() === 'true';

const BASE_URL = IS_PRODUCTION
  ? 'https://api.midtrans.com'
  : 'https://api.sandbox.midtrans.com';

function getAuthHeader() {
  if (!SERVER_KEY) return null;
  const encoded = Buffer.from(`${SERVER_KEY}:`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Buat transaksi QRIS GoPay Merchant.
 * Jika SERVER_KEY terpasang, meminta QR Code dinamis resmi dari GoPay/Midtrans.
 * Jika belum, mengembalikan mode statis.
 */
async function createQrisTransaction({ orderId, amount, customerName, customerPhone, items = [] }) {
  const grossAmount = Math.round(Number(amount));
  if (!grossAmount || grossAmount <= 0) {
    throw new Error('Nominal transaksi tidak valid');
  }

  // Jika belum ada SERVER_KEY GoPay/Midtrans, gunakan mode konfigurasi statis
  if (!SERVER_KEY) {
    return {
      success: true,
      mode: 'static',
      orderId,
      grossAmount,
      qrUrl: null, // Frontend akan menggunakan QRIS toko di settings
      transactionStatus: 'pending',
    };
  }

  const payload = {
    payment_type: 'qris',
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    qris: {
      acquirer: 'gopay',
    },
    customer_details: {
      first_name: customerName || 'Pelanggan Rami',
      phone: customerPhone || '',
    },
    item_details: items.slice(0, 15).map((item) => ({
      id: String(item.id || item.sku || 'item').slice(0, 50),
      price: Math.round(Number(item.price) || 0),
      quantity: Number(item.qty) || 1,
      name: String(item.name || 'Menu').slice(0, 50),
    })),
  };

  try {
    const res = await fetch(`${BASE_URL}/v2/charge`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('Midtrans/GoPay charge error:', data);
      throw new Error(`GoPay API (${res.status}): ${data.status_message || JSON.stringify(data)}`);
    }

    // Cari URL gambar QR code di actions
    const qrAction = Array.isArray(data.actions)
      ? data.actions.find((a) => a.name === 'generate-qr-code')
      : null;

    return {
      success: true,
      mode: 'dynamic',
      orderId,
      transactionId: data.transaction_id,
      grossAmount: data.gross_amount,
      transactionStatus: data.transaction_status || 'pending',
      qrUrl: qrAction ? qrAction.url : null,
      qrString: data.qr_string || null,
      raw: data,
    };
  } catch (err) {
    console.error('Gagal membuat QRIS GoPay:', err.message);
    throw err;
  }
}

/**
 * Cek status pembayaran ke server GoPay / Midtrans (Inquiry API).
 */
async function checkPaymentStatus(orderId) {
  if (!SERVER_KEY) {
    return {
      checked: false,
      mode: 'manual',
      paid: false,
      status: 'pending',
    };
  }

  try {
    const res = await fetch(`${BASE_URL}/v2/${encodeURIComponent(orderId)}/status`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': getAuthHeader(),
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 404) {
        return { checked: true, paid: false, status: 'pending' };
      }
      return { checked: false, error: data.status_message || 'Inquiry failed' };
    }

    const txStatus = (data.transaction_status || '').toLowerCase();
    const isPaid = txStatus === 'settlement' || txStatus === 'capture';
    const isExpired = txStatus === 'expire' || txStatus === 'cancel' || txStatus === 'deny';

    return {
      checked: true,
      paid: isPaid,
      status: isPaid ? 'paid' : isExpired ? 'expired' : 'pending',
      transactionStatus: txStatus,
      paidAt: isPaid ? (data.settlement_time || new Date().toISOString()) : null,
      paymentType: data.payment_type || 'qris',
      raw: data,
    };
  } catch (err) {
    console.error(`Gagal cek status transaksi ${orderId}:`, err.message);
    return { checked: false, error: err.message };
  }
}

/**
 * Verifikasi signature webhook notifikasi dari Midtrans / GoPay.
 * Rumus: SHA512(order_id + status_code + gross_amount + ServerKey)
 */
function verifyWebhookSignature(body) {
  if (!SERVER_KEY) return true; // jika server key belum diset, bypass
  const { order_id, status_code, gross_amount, signature_key } = body || {};
  if (!order_id || !status_code || !gross_amount || !signature_key) {
    return false;
  }

  const raw = `${order_id}${status_code}${gross_amount}${SERVER_KEY}`;
  const calculated = crypto.createHash('sha512').update(raw).digest('hex');
  return calculated.toLowerCase() === String(signature_key).toLowerCase();
}

module.exports = {
  createQrisTransaction,
  checkPaymentStatus,
  verifyWebhookSignature,
  hasServerKey: () => Boolean(SERVER_KEY),
  isProduction: () => IS_PRODUCTION,
};

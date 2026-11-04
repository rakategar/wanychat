// ---- lib_midtrans.js (disisipkan build.py lewat //#include; butuh `settings` & `helpers`, dipakai lewat lib_pay.js) ----
// Midtrans Snap (redirect): sekali bayar = 1 bulan, metode dipilih di Wanychat lalu Snap dibatasi ke metode itu.
// Status diambil dari Core API GET /v2/{order_id}/status (request kita sendiri dengan server key).
const mtCrypto = require('crypto');
const MT_PROD = settings.midtrans_env === 'production';
const MT_SNAP = MT_PROD ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
const MT_CORE = MT_PROD ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
// Key produksi & sandbox disimpan terpisah supaya pindah mode tidak menghapus key yang lain
const MT_SERVER_KEY = String((MT_PROD ? settings.midtrans_server_key : settings.midtrans_sb_server_key) || '');
const MT_NOTIFY_PATH = '/webhook/wany-midtrans';
const MT_READY = !!MT_SERVER_KEY;

// Tarif standar Midtrans per transaksi berhasil, belum termasuk PPN: [persen, rupiah tetap].
// Bisa ditimpa lewat setting midtrans_fees (JSON {"other_qris":[0.7,0], ...}).
const MT_FEES = {
  other_qris: [0.7, 0], gopay: [2, 0], shopeepay: [2, 0], credit_card: [2.9, 2000],
  indomaret: [0, 5000], alfamart: [0, 5000], akulaku: [1.7, 0], kredivo: [2, 0],
};
const MT_LABELS = {
  other_qris: 'QRIS (semua e-wallet & m-banking)', gopay: 'GoPay', shopeepay: 'ShopeePay', credit_card: 'Kartu kredit/debit',
  bca_va: 'Virtual Account BCA', echannel: 'Mandiri Bill Payment', bni_va: 'Virtual Account BNI', bri_va: 'Virtual Account BRI',
  permata_va: 'Virtual Account Permata', cimb_va: 'Virtual Account CIMB Niaga', other_va: 'Virtual Account bank lain',
  indomaret: 'Indomaret', alfamart: 'Alfamart / Alfamidi', akulaku: 'Akulaku PayLater', kredivo: 'Kredivo',
};
const MT_DEFAULT_METHODS = 'other_qris,gopay,shopeepay,bca_va,echannel,bni_va,bri_va,permata_va,cimb_va,other_va,alfamart,indomaret';

const mtMethods = () => String(settings.midtrans_methods || MT_DEFAULT_METHODS).split(',').map(x => x.trim()).filter(x => MT_LABELS[x]);

function mtFeeRate(method) {
  try {
    const custom = JSON.parse(settings.midtrans_fees || '{}');
    if (Array.isArray(custom[method])) return [Number(custom[method][0]) || 0, Number(custom[method][1]) || 0];
  } catch (e) { /* pakai tarif bawaan */ }
  if (MT_FEES[method]) return MT_FEES[method];
  return /_va$|^echannel$/.test(method) ? [0, 4000] : [3, 2000];
}
const mtVat = () => 1 + (settings.midtrans_ppn_pct === undefined || settings.midtrans_ppn_pct === '' ? 11 : Number(settings.midtrans_ppn_pct) || 0) / 100;
const mtFeeOf = (amount, method) => feeWith(amount, mtFeeRate(String(method || '')), mtVat());
const mtCharge = (price, method) =>
  chargeWith(price, mtFeeRate(method), mtVat(), Number(settings.midtrans_round) || 100, settings.midtrans_fee_to_customer !== 'false');

async function midtrans(method, url, payload, headers) {
  try {
    const res = await helpers.httpRequest({
      method, url, body: payload, json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
      headers: Object.assign({ Authorization: 'Basic ' + Buffer.from(MT_SERVER_KEY + ':').toString('base64'), Accept: 'application/json' }, headers || {}),
    });
    const b = res.body && typeof res.body === 'object' ? res.body : {};
    const code = Number(b.status_code) || res.statusCode;
    const err = res.statusCode >= 300 || (code >= 300 && !b.transaction_status);
    return { ok: !err, status: code, body: b, error: err ? ((b.error_messages || b.validation_messages || []).join('; ') || b.status_message || ('HTTP ' + res.statusCode)) : '' };
  } catch (e) {
    return { ok: false, status: 0, body: {}, error: e.message };
  }
}

// Buat transaksi Snap; hasil { ok, url, token, error }
async function mtCheckout({ orderId, total, items, method, customerName, base }) {
  const r = await midtrans('POST', MT_SNAP + '/snap/v1/transactions', {
    transaction_details: { order_id: orderId, gross_amount: total },
    item_details: items,
    customer_details: { first_name: customerName },
    enabled_payments: [method],
    callbacks: { finish: base + '/#/billing?paid=1' },
    expiry: { unit: 'minute', duration: 120 },
  }, { 'X-Override-Notification': base + MT_NOTIFY_PATH });
  return { ok: r.ok && !!r.body.redirect_url, url: r.body.redirect_url || '', token: r.body.token || '', error: r.error || 'tanpa URL pembayaran' };
}

// signature_key notifikasi = SHA512(order_id + status_code + gross_amount + server key)
function mtSignatureOk(n) {
  if (!n.order_id || !n.signature_key || !MT_SERVER_KEY) return false;
  const expected = mtCrypto.createHash('sha512').update(String(n.order_id) + String(n.status_code) + String(n.gross_amount) + MT_SERVER_KEY).digest('hex');
  const given = String(n.signature_key);
  return given.length === expected.length && mtCrypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Status Midtrans -> bentuk umum lib_pay (applyPayment). channel kosong: payment_type tetap id metode yang kita simpan.
function mtNormalize(st) {
  const t = String(st.transaction_status || '');
  const paid = t === 'settlement' || (t === 'capture' && (!st.fraud_status || st.fraud_status === 'accept'));
  const status = paid ? 'settlement' : t === 'refund' || t === 'partial_refund' ? 'refund'
    : t === 'expire' ? 'expire' : ['cancel', 'deny', 'failure'].includes(t) ? 'cancel' : 'pending';
  return {
    status, amount: Math.round(Number(st.gross_amount) || 0), channel: '', txid: String(st.transaction_id || ''),
    paidAt: st.settlement_time ? new Date(String(st.settlement_time).replace(' ', 'T') + '+07:00').toISOString() : '',
  };
}

const mtStatus = (orderId) => midtrans('GET', MT_CORE + '/v2/' + encodeURIComponent(orderId) + '/status');
// ---- akhir lib_midtrans.js ----

// ---- lib_doku.js (disisipkan build.py lewat //#include; butuh `settings` & `helpers`, dipakai lewat lib_pay.js) ----
// DOKU Checkout (non-SNAP): request ditandatangani HMAC-SHA256 dengan secret key, status diambil dari /orders/v1/status.
const dokuCrypto = require('crypto');
const DOKU_PROD = settings.doku_env !== 'sandbox';
const DOKU_API = DOKU_PROD ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
const DOKU_NOTIFY_PATH = '/webhook/wany-doku';
const DOKU_READY = !!(settings.doku_client_id && settings.doku_secret_key);

// Tarif standar DOKU per transaksi berhasil, belum termasuk PPN: [persen, rupiah tetap].
// Bisa ditimpa lewat setting doku_fees (JSON {"QRIS":[0.7,0], ...}) kalau DOKU memberi tarif lain.
const DOKU_FEES = {
  QRIS: [0.7, 0], CREDIT_CARD: [2.8, 2000],
  EMONEY_DANA: [1.5, 0], EMONEY_DOKU: [1.5, 0], EMONEY_OVO: [3.18, 0], EMONEY_SHOPEE_PAY: [4, 0], EMONEY_LINKAJA: [3.5, 0],
  ONLINE_TO_OFFLINE_ALFA: [0, 5000], ONLINE_TO_OFFLINE_INDOMARET: [0, 6500],
};
const DOKU_LABELS = {
  QRIS: 'QRIS (semua e-wallet & m-banking)', CREDIT_CARD: 'Kartu kredit/debit',
  VIRTUAL_ACCOUNT_BCA: 'Virtual Account BCA', VIRTUAL_ACCOUNT_BANK_MANDIRI: 'Virtual Account Mandiri',
  VIRTUAL_ACCOUNT_BRI: 'Virtual Account BRI', VIRTUAL_ACCOUNT_BNI: 'Virtual Account BNI',
  VIRTUAL_ACCOUNT_BANK_PERMATA: 'Virtual Account Permata', VIRTUAL_ACCOUNT_BANK_CIMB: 'Virtual Account CIMB Niaga',
  VIRTUAL_ACCOUNT_BANK_DANAMON: 'Virtual Account Danamon', VIRTUAL_ACCOUNT_BANK_SYARIAH_MANDIRI: 'Virtual Account BSI',
  VIRTUAL_ACCOUNT_DOKU: 'Virtual Account DOKU (bank lain)', VIRTUAL_ACCOUNT_BTN: 'Virtual Account BTN',
  EMONEY_DANA: 'DANA', EMONEY_OVO: 'OVO', EMONEY_SHOPEE_PAY: 'ShopeePay', EMONEY_LINKAJA: 'LinkAja', EMONEY_DOKU: 'DOKU e-Wallet',
  ONLINE_TO_OFFLINE_ALFA: 'Alfamart / Alfamidi', ONLINE_TO_OFFLINE_INDOMARET: 'Indomaret',
};
const DOKU_DEFAULT_METHODS = 'QRIS,VIRTUAL_ACCOUNT_BCA,VIRTUAL_ACCOUNT_BANK_MANDIRI,VIRTUAL_ACCOUNT_BRI,VIRTUAL_ACCOUNT_BNI,EMONEY_DANA,EMONEY_SHOPEE_PAY';

const dokuMethods = () => String(settings.doku_methods || DOKU_DEFAULT_METHODS).split(',').map(x => x.trim()).filter(x => DOKU_LABELS[x]);

function dokuFeeRate(method) {
  try {
    const custom = JSON.parse(settings.doku_fees || '{}');
    if (Array.isArray(custom[method])) return [Number(custom[method][0]) || 0, Number(custom[method][1]) || 0];
  } catch (e) { /* pakai tarif bawaan */ }
  if (DOKU_FEES[method]) return DOKU_FEES[method];
  return method.startsWith('VIRTUAL_ACCOUNT_') ? [0, 4000] : [3, 2000];
}
const dokuVat = () => 1 + (settings.doku_ppn_pct === undefined || settings.doku_ppn_pct === '' ? 11 : Number(settings.doku_ppn_pct) || 0) / 100;

// Perkiraan potongan DOKU (fee + PPN) atas nominal yang dibayar pelanggan; total tagihan dengan fee ditanggung pelanggan
const dokuFeeOf = (amount, method) => feeWith(amount, dokuFeeRate(String(method || '')), dokuVat());
const dokuCharge = (price, method) =>
  chargeWith(price, dokuFeeRate(method), dokuVat(), Number(settings.doku_round) || 100, settings.doku_fee_to_customer !== 'false');

function dokuSignature(clientId, requestId, timestamp, target, body) {
  let s = 'Client-Id:' + clientId + '\nRequest-Id:' + requestId + '\nRequest-Timestamp:' + timestamp + '\nRequest-Target:' + target;
  if (body !== undefined) s += '\nDigest:' + dokuCrypto.createHash('sha256').update(body, 'utf8').digest('base64');
  return 'HMACSHA256=' + dokuCrypto.createHmac('sha256', String(settings.doku_secret_key || '')).update(s).digest('base64');
}

async function doku(method, target, payload) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const id = dokuCrypto.randomUUID();
  const ts = new Date().toISOString().slice(0, 19) + 'Z';
  const clientId = String(settings.doku_client_id || '');
  try {
    const res = await helpers.httpRequest({
      method, url: DOKU_API + target, body, json: false, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
      headers: Object.assign({ 'Client-Id': clientId, 'Request-Id': id, 'Request-Timestamp': ts, Signature: dokuSignature(clientId, id, ts, target, body), Accept: 'application/json' },
        body === undefined ? {} : { 'Content-Type': 'application/json' }),
    });
    let b = res.body;
    if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = { raw: b.slice(0, 300) }; } }
    b = b || {};
    const ok = res.statusCode < 300;
    const err = ok ? '' : ((b.error && (b.error.message || b.error.code)) || (b.error_messages || b.message || []).join?.('; ') || ('HTTP ' + res.statusCode));
    return { ok, status: res.statusCode, body: b, error: String(err || '') };
  } catch (e) {
    return { ok: false, status: 0, body: {}, error: e.message };
  }
}

const dokuStatus = (invoice) => doku('GET', '/orders/v1/status/' + encodeURIComponent(invoice));

// Status DOKU -> kosakata tabel wany_payments (settlement = lunas, sama seperti data lama)
function dokuPayStatus(st) {
  const t = String((st.transaction && st.transaction.status) || '').toUpperCase();
  const o = String((st.order && st.order.status) || '').toUpperCase();
  if (t === 'SUCCESS') return 'settlement';
  if (t === 'REFUNDED') return 'refund';
  if (t === 'EXPIRED' || o === 'ORDER_EXPIRED') return 'expire';
  return 'pending'; // PENDING / FAILED (Checkout: pelanggan masih bisa coba metode lain) / belum pilih metode
}

// Status DOKU -> bentuk umum lib_pay (applyPayment)
function dokuNormalize(st) {
  return {
    status: dokuPayStatus(st), amount: Math.round(Number(st.order && st.order.amount) || 0),
    channel: String((st.channel && st.channel.id) || (st.service && st.service.id) || ''),
    txid: String((st.transaction && st.transaction.original_request_id) || ''),
    paidAt: st.transaction && st.transaction.date ? new Date(st.transaction.date).toISOString() : '',
  };
}
// ---- akhir lib_doku.js ----

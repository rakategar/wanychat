// ---- lib_doku.js (disisipkan build.py lewat //#include; butuh `settings` & `helpers`) ----
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

// Perkiraan potongan DOKU (fee + PPN) atas nominal yang dibayar pelanggan
function dokuFeeOf(amount, method) {
  const [pct, flat] = dokuFeeRate(String(method || ''));
  return Math.ceil((Number(amount || 0) * pct / 100 + flat) * dokuVat());
}

// Total yang ditagih ke pelanggan supaya yang diterima bersih = harga paket (fee + PPN-nya ditanggung pelanggan)
function dokuCharge(price, method) {
  price = Math.round(Number(price) || 0);
  if (settings.doku_fee_to_customer === 'false') return { total: price, surcharge: 0, fee: dokuFeeOf(price, method) };
  const [pct, flat] = dokuFeeRate(method);
  const vat = dokuVat();
  const step = Math.max(1, Number(settings.doku_round) || 100);
  let total = Math.ceil((price + flat * vat) / (1 - pct / 100 * vat));
  total = Math.ceil(total / step) * step;
  while (total - dokuFeeOf(total, method) < price) total += step;
  return { total, surcharge: total - price, fee: dokuFeeOf(total, method) };
}

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

// Tambah 1 bulan kalender (31 Jan -> 28/29 Feb)
function addMonth(ms) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

function billingRow(b, accountId) {
  return {
    account_id: String(accountId), plan: (b && b.plan) || 'free', status: (b && b.status) || 'free', period_end: (b && b.period_end) || null,
    subscription_id: (b && b.subscription_id) || '', subscription_name: (b && b.subscription_name) || '',
    cancel_at_period_end: !!(b && isTrue(b.cancel_at_period_end)), suspended: !!(b && isTrue(b.suspended)),
    source: (b && b.source) || '', card_hint: (b && b.card_hint) || '', last_order_id: (b && b.last_order_id) || '', note: (b && b.note) || '',
  };
}

// Terapkan hasil cek status DOKU ke satu order yang kita buat sendiri (`known`, baris wany_payments).
// Hasil: { payment, billing?, audits[] }. Hanya status dari API DOKU + nominal yang kita simpan yang dipercaya.
function applyDokuStatus(st, known, cur, plans) {
  const audits = [];
  const accountId = String(known.account_id);
  const wasPaid = ['settlement', 'capture'].includes(known.status);
  let status = dokuPayStatus(st);
  if (wasPaid && status !== 'refund') status = known.status; // lunas tidak pernah mundur ke pending/expire
  const amount = Math.round(Number(st.order && st.order.amount) || 0);
  const expect = Math.round(Number(known.amount) || 0);
  const channel = String((st.channel && st.channel.id) || (st.service && st.service.id) || known.payment_type || '');
  const pay =Object.assign({}, known, {
    status, payment_type: channel, transaction_id: String((st.transaction && st.transaction.original_request_id) || known.transaction_id || ''),
  });
  delete pay.id; delete pay.createdAt; delete pay.updatedAt;
  if (status === 'settlement') {
    pay.paid_at = known.paid_at || new Date((st.transaction && st.transaction.date) || Date.now()).toISOString();
    pay.fee = dokuFeeOf(amount, known.payment_type || channel);
  }
  if (status === 'settlement' && amount !== expect) {
    pay.status = 'amount_mismatch';
    pay.note = 'nominal ' + amount + ' != ' + expect;
    audits.push(['doku_amount_mismatch', known.order_id, pay.note]);
    return { payment: pay, audits };
  }
  const plan = plans.find(x => x.id === known.plan);
  if (status === 'settlement' && !wasPaid && plan) {
    const b = billingRow(cur, accountId);
    const now = Date.now();
    const curEnd = cur && cur.period_end ? new Date(cur.period_end).getTime() : 0;
    // Perpanjangan paket sama: lanjut dari akhir periode. Ganti paket: mulai hari ini.
    const from = (cur && cur.plan === plan.id && curEnd > now) ? curEnd : now;
    Object.assign(b, {
      plan: plan.id, status: 'active', period_end: new Date(addMonth(from)).toISOString(), source: 'doku', last_order_id: known.order_id,
      subscription_id: '', subscription_name: '', cancel_at_period_end: false, card_hint: '',
    });
    audits.push(['payment_paid', accountId, plan.id + ' ' + amount + ' ' + channel + ' ' + known.order_id]);
    return { payment: pay, billing: b, audits };
  }
  if (status === 'refund' && known.status !== 'refund') {
    audits.push(['payment_refund', accountId, known.order_id + ' (cek manual di dasbor superadmin)']);
  }
  return { payment: pay, audits };
}
// ---- akhir lib_doku.js ----

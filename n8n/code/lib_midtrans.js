// ---- lib_midtrans.js (disisipkan build.py lewat //#include; butuh `settings` & `helpers`) ----
const MT_PROD = settings.midtrans_env === 'production';
const CORE = MT_PROD ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
const MT_PAID = (st) => st.transaction_status === 'settlement' || (st.transaction_status === 'capture' && (!st.fraud_status || st.fraud_status === 'accept'));
const MT_FAILED = (st) => ['deny', 'cancel', 'expire', 'failure'].includes(st.transaction_status);

async function midtrans(method, url, payload) {
  try {
    const res = await helpers.httpRequest({
      method, url, body: payload, json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
      headers: { Authorization: 'Basic ' + Buffer.from(String(settings.midtrans_server_key || '') + ':').toString('base64'), Accept: 'application/json' },
    });
    const b = res.body || {};
    const err = res.statusCode >= 300 || (b.status_code && Number(b.status_code) >= 300 && !b.transaction_status);
    return { ok: !err, body: b, error: err ? ((b.error_messages || b.validation_messages || []).join('; ') || b.status_message || ('HTTP ' + res.statusCode)) : '' };
  } catch (e) {
    return { ok: false, body: {}, error: e.message };
  }
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

// "2026-11-30 10:00:00 +0700" untuk schedule.start_time Midtrans
function mtTime(ms) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' +0700';
}

const feeOf = (amount) => Math.round(Number(amount || 0) * (Number(settings.midtrans_fee_pct) || 0) / 100 + (Number(settings.midtrans_fee_flat) || 0));

function billingRow(b, accountId) {
  return {
    account_id: String(accountId), plan: (b && b.plan) || 'free', status: (b && b.status) || 'free', period_end: (b && b.period_end) || null,
    subscription_id: (b && b.subscription_id) || '', subscription_name: (b && b.subscription_name) || '',
    cancel_at_period_end: !!(b && isTrue(b.cancel_at_period_end)), suspended: !!(b && isTrue(b.suspended)),
    source: (b && b.source) || '', card_hint: (b && b.card_hint) || '', last_order_id: (b && b.last_order_id) || '', note: (b && b.note) || '',
  };
}

function paymentRow(st, extra) {
  return Object.assign({
    order_id: String(st.order_id || ''), account_id: '', plan: '', amount: Math.round(Number(st.gross_amount) || 0),
    status: String(st.transaction_status || ''), payment_type: String(st.payment_type || ''), kind: 'renewal',
    transaction_id: String(st.transaction_id || ''), paid_at: MT_PAID(st) ? new Date(st.settlement_time ? st.settlement_time.replace(' ', 'T') + '+07:00' : Date.now()).toISOString() : null,
    fee: MT_PAID(st) ? feeOf(st.gross_amount) : 0, note: '',
  }, extra || {});
}
// ---- akhir lib_midtrans.js ----

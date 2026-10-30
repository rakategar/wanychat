// Notifikasi pembayaran Midtrans (Snap pertama & tagihan bulanan Subscription API).
// Notifikasi hanya dipercaya setelah: tanda tangan SHA512 cocok + status diambil ulang langsung dari API Midtrans.
//#include lib_plans.js
const crypto = require('crypto');
const helpers = this.helpers;
const body = $('Webhook Midtrans').first().json.body || {};
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_midtrans.js

const out = [];
const audit = (action, target, detail) => out.push({ json: { kind: 'audit', actor: 'midtrans', action, target: String(target || ''), detail: String(detail || '').slice(0, 1000), ip: '' } });

const serverKey = String(settings.midtrans_server_key || '');
const orderId = String(body.order_id || '');
if (!serverKey || !orderId) return [];

// Tanda tangan bisa dibuat dengan server key utama atau "signature key" terpisah dari dasbor Midtrans
const given = String(body.signature_key || '');
const signedBy = (key) => {
  const expected = crypto.createHash('sha512').update(orderId + String(body.status_code || '') + String(body.gross_amount || '') + key).digest('hex');
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
};
if (![serverKey, String(settings.midtrans_signature_key || '')].filter(Boolean).some(signedBy)) {
  audit('midtrans_bad_signature', orderId, 'tanda tangan notifikasi tidak cocok, diabaikan');
  return out;
}

const stRes = await midtrans('GET', CORE + '/v2/' + encodeURIComponent(orderId) + '/status');
if (!stRes.ok) { audit('midtrans_status_error', orderId, stRes.error); return out; }
const st = stRes.body;

const plans = loadPlans(settings);
const billingBy = latestBy($('Baca Billing').all().map(i => i.json), 'account_id');
const payments = $('Baca Pembayaran').all().map(i => i.json).filter(x => x.order_id);
const known = payments.find(x => x.order_id === orderId);

// Cari akun pemilik transaksi
let accountId = known ? String(known.account_id || '') : '';
let kind = known ? known.kind || 'checkout' : 'renewal';
let planId = known ? known.plan : '';
if (!accountId) {
  const rows = Object.values(billingBy);
  let b = rows.find(x => x.subscription_id && st.subscription_id && x.subscription_id === st.subscription_id)
       || rows.find(x => x.subscription_name && orderId.startsWith(x.subscription_name));
  if (!b) {
    for (const x of rows.filter(r => r.subscription_id).slice(0, 25)) {
      const sub = await midtrans('GET', CORE + '/v1/subscriptions/' + encodeURIComponent(x.subscription_id));
      if (sub.ok && (sub.body.transaction_ids || []).includes(st.transaction_id)) { b = x; break; }
    }
  }
  if (b) { accountId = String(b.account_id); planId = b.plan; kind = 'renewal'; }
}
if (!accountId) {
  out.push({ json: { kind: 'payment', payment: paymentRow(st, { note: 'tidak cocok dengan akun mana pun' }) } });
  audit('midtrans_unmatched', orderId, st.transaction_status + ' ' + st.gross_amount);
  return out;
}

const plan = plans.find(x => x.id === planId);
const wasPaid = known && ['settlement', 'capture'].includes(known.status);
const amount = Math.round(Number(st.gross_amount) || 0);
const expectAmount = known ? Math.round(Number(known.amount) || 0) : Math.round(Number(plan && plan.price) || 0);
const pay = paymentRow(st, { account_id: accountId, plan: planId, kind });

if (MT_PAID(st) && amount !== expectAmount) {
  pay.status = 'amount_mismatch';
  pay.note = 'nominal ' + amount + ' != ' + expectAmount;
  out.push({ json: { kind: 'payment', payment: pay } });
  audit('midtrans_amount_mismatch', orderId, pay.note);
  return out;
}
out.push({ json: { kind: 'payment', payment: pay } });

const cur = billingBy[accountId];
const b = billingRow(cur, accountId);

if (MT_PAID(st) && !wasPaid && plan) {
  const now = Date.now();
  const curEnd = cur && cur.period_end ? new Date(cur.period_end).getTime() : 0;
  // Perpanjangan / bayar ulang paket sama: lanjut dari akhir periode. Ganti paket: mulai hari ini.
  const from = (cur && cur.plan === plan.id && curEnd > now) ? curEnd : now;
  const end = addMonth(from);
  Object.assign(b, { plan: plan.id, status: 'active', period_end: new Date(end).toISOString(), source: 'midtrans', last_order_id: orderId });
  if (st.masked_card) b.card_hint = String(st.masked_card).slice(-8);

  if (kind === 'checkout') {
    b.cancel_at_period_end = false;
    // Hentikan langganan lama supaya tidak tertagih dobel
    if (cur && cur.subscription_id) {
      const d = await midtrans('POST', CORE + '/v1/subscriptions/' + encodeURIComponent(cur.subscription_id) + '/disable');
      audit(d.ok ? 'subscription_disabled' : 'subscription_disable_failed', accountId, cur.subscription_id + (d.ok ? '' : ' ' + d.error));
      b.subscription_id = '';
    }
    if (st.saved_token_id) {
      const name = ('WNY-' + plan.id + '-' + accountId).slice(0, 40);
      const sub = await midtrans('POST', CORE + '/v1/subscriptions', {
        name, amount: String(Math.round(Number(plan.price))), currency: 'IDR', payment_type: 'credit_card', token: st.saved_token_id,
        schedule: { interval: 1, interval_unit: 'month', start_time: mtTime(end) },
        retry_schedule: { interval: 1, interval_unit: 'day', max_interval: 3 },
        metadata: { account_id: accountId, plan: plan.id },
        customer_details: { first_name: 'IG ' + accountId },
      });
      if (sub.ok && sub.body.id) {
        b.subscription_id = String(sub.body.id);
        b.subscription_name = name;
        audit('subscription_created', accountId, plan.id + ' ' + sub.body.id);
      } else {
        audit('subscription_create_failed', accountId, sub.error);
      }
    } else {
      audit('subscription_manual', accountId, 'kartu tidak disimpan / bukan kartu kredit: tanpa perpanjangan otomatis');
    }
  }
  out.push({ json: { kind: 'billing', billing: b } });
  audit('payment_paid', accountId, kind + ' ' + plan.id + ' ' + amount + ' ' + orderId);
} else if (MT_FAILED(st) && kind === 'renewal' && cur && cur.plan !== 'free') {
  b.status = 'past_due';
  out.push({ json: { kind: 'billing', billing: b } });
  audit('payment_failed', accountId, st.transaction_status + ' ' + orderId);
} else if (['refund', 'partial_refund', 'chargeback', 'partial_chargeback'].includes(st.transaction_status)) {
  audit('payment_refund', accountId, st.transaction_status + ' ' + orderId + ' (cek manual di dasbor superadmin)');
}
return out;

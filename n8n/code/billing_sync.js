// Harian: cocokkan langganan dengan Midtrans (cadangan kalau notifikasi terlewat), turunkan paket yang sudah lewat masa tenggang.
//#include lib_plans.js
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings Sync').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_midtrans.js

const out = [];
const audit = (action, target, detail) => out.push({ json: { kind: 'audit', actor: 'scheduler', action, target: String(target || ''), detail: String(detail || '').slice(0, 1000), ip: '' } });
const plans = loadPlans(settings);
const payments = $('Baca Pembayaran Sync').all().map(i => i.json).filter(x => x.order_id);
const knownTx = new Set(payments.map(x => x.transaction_id).filter(Boolean));
const knownOrders = new Set(payments.filter(x => ['settlement', 'capture'].includes(x.status)).map(x => x.order_id));
const now = Date.now();

for (const cur of Object.values(latestBy($('Baca Billing Sync').all().map(i => i.json), 'account_id'))) {
  if (!cur.plan || cur.plan === 'free') continue;
  const b = billingRow(cur, cur.account_id);
  let changed = false;
  let end = b.period_end ? new Date(b.period_end).getTime() : 0;

  if (b.subscription_id && settings.midtrans_server_key) {
    const sub = await midtrans('GET', CORE + '/v1/subscriptions/' + encodeURIComponent(b.subscription_id));
    if (sub.ok) {
      for (const tx of sub.body.transaction_ids || []) {
        if (knownTx.has(tx)) continue;
        const r = await midtrans('GET', CORE + '/v2/' + encodeURIComponent(tx) + '/status');
        if (!r.ok) continue;
        const st = r.body;
        const plan = plans.find(x => x.id === b.plan);
        const pay = paymentRow(st, { account_id: b.account_id, plan: b.plan, kind: 'renewal', note: 'disinkron harian' });
        out.push({ json: { kind: 'payment', payment: pay } });
        if (MT_PAID(st) && !knownOrders.has(st.order_id) && plan && Math.round(Number(st.gross_amount)) === Math.round(Number(plan.price))) {
          end = addMonth(Math.max(end, now - 7 * 24 * 3600 * 1000));
          Object.assign(b, { status: 'active', period_end: new Date(end).toISOString(), last_order_id: String(st.order_id || '') });
          changed = true;
          audit('payment_paid', b.account_id, 'renewal (sinkron) ' + b.plan + ' ' + st.gross_amount + ' ' + st.order_id);
        }
      }
      if (sub.body.status === 'inactive' && !b.cancel_at_period_end && b.status !== 'past_due' && end < now) {
        b.status = 'past_due';
        changed = true;
      }
    }
  }

  if (end && end + GRACE_MS < now) {
    if (b.subscription_id && settings.midtrans_server_key) {
      await midtrans('POST', CORE + '/v1/subscriptions/' + encodeURIComponent(b.subscription_id) + '/disable');
    }
    audit('plan_expired', b.account_id, b.plan + ' habis ' + new Date(end).toISOString().slice(0, 10) + ', turun ke Gratis');
    Object.assign(b, { plan: 'free', status: 'expired', subscription_id: '', cancel_at_period_end: false });
    changed = true;
  }
  if (changed) out.push({ json: { kind: 'billing', billing: b } });
}
return out;

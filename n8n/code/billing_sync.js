// Harian: cek ulang order DOKU/Midtrans yang masih pending (cadangan kalau notifikasi terlewat), turunkan paket yang sudah lewat masa tenggang.
//#include lib_plans.js
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings Sync').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_pay.js
//#include lib_doku.js
//#include lib_midtrans.js

const out = [];
const audit = (action, target, detail) => out.push({ json: { kind: 'audit', actor: 'scheduler', action, target: String(target || ''), detail: String(detail || '').slice(0, 1000), ip: '' } });
const plans = loadPlans(settings);
const billingBy = latestBy($('Baca Billing Sync').all().map(i => i.json), 'account_id');
const creditBy = latestBy($('Baca Kredit Sync').all().map(i => i.json), 'account_id');
const now = Date.now();
const DAY = 24 * 3600 * 1000;

// 1) Order pending dari 3 hari terakhir: tanya status ke gateway asalnya. Lebih lama dari itu: tandai kedaluwarsa.
const pending = $('Baca Pembayaran Sync').all().map(i => i.json)
  .filter(x => x.order_id && x.status === 'pending' && (x.kind === 'checkout' || x.kind === 'topup') && x.account_id);
for (const known of pending.slice(0, 40)) {
  const age = now - new Date(known.createdAt || 0).getTime();
  if (age < 10 * 60 * 1000) continue;
  if (!gatewayReady(gatewayOf(known)) || age > 3 * DAY) {
    if (age > 3 * DAY) out.push({ json: { kind: 'payment', payment: Object.assign({}, known, { status: 'expire', note: 'kedaluwarsa (sinkron harian)' }) } });
    continue;
  }
  const r = await payStatus(known);
  if (!r.ok) {
    // 404 = pelanggan tidak pernah memilih metode bayar
    if (r.notFound && age > DAY) out.push({ json: { kind: 'payment', payment: Object.assign({}, known, { status: 'expire', note: 'tidak pernah dibayar' }) } });
    continue;
  }
  const res = applyPayment(r.norm, known, billingBy[String(known.account_id)], plans, creditBy[String(known.account_id)]);
  if (res.payment.status === known.status && !res.billing && !res.credits && !res.audits.length) continue;
  res.payment.note = res.payment.note || 'disinkron harian';
  out.push({ json: { kind: 'payment', payment: res.payment } });
  if (res.billing) { out.push({ json: { kind: 'billing', billing: res.billing } }); billingBy[String(known.account_id)] = res.billing; }
  if (res.credits) { out.push({ json: { kind: 'credits', credits: res.credits } }); creditBy[String(known.account_id)] = Object.assign({}, creditBy[String(known.account_id)], res.credits); }
  for (const a of res.audits) audit(a[0], a[1], a[2] + ' (sinkron)');
}

// 2) Paket berbayar yang lewat masa aktif + tenggang turun ke Gratis
for (const cur of Object.values(billingBy)) {
  if (!cur.plan || cur.plan === 'free') continue;
  const end = cur.period_end ? new Date(cur.period_end).getTime() : 0;
  if (end && end + GRACE_MS < now) {
    const b = billingRow(cur, cur.account_id);
    audit('plan_expired', b.account_id, b.plan + ' habis ' + new Date(end).toISOString().slice(0, 10) + ', turun ke Gratis');
    Object.assign(b, { plan: 'free', status: 'expired', subscription_id: '', cancel_at_period_end: false });
    out.push({ json: { kind: 'billing', billing: b } });
  }
}
return out;

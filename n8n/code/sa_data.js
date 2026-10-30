// Data dasbor superadmin: ringkasan bisnis, pengguna, pembayaran, audit, setelan (rahasia disamarkan).
//#include lib_plans.js
const { action, params } = $('Cek Admin').first().json;
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const rows = (n) => $(n).all().map(i => i.json).filter(r => r && r.id);
const accounts = rows('Baca Akun SA');
const billingBy = latestBy(rows('Baca Billing'), 'account_id');
const usage = rows('Baca Usage SA');
const payments = rows('Baca Pembayaran SA').sort((a, b) => Number(b.id) - Number(a.id));
const rules = rows('Baca Rules SA');
const events = rows('Baca Events SA');
const auditRows = rows('Baca Audit SA');
const plans = loadPlans(settings);
const now = Date.now();
const month = monthKey();
const DAY = 86400000;
const PAID = ['settlement', 'capture'];
const num = (v) => Number(v) || 0;

const usageBy = latestBy(usage.filter(u => u.month === month), 'account_id');
const lastEvent = {};
const errors24 = {};
for (const e of events) {
  const id = String(e.account_id || '');
  const t = new Date(e.createdAt).getTime();
  if (!lastEvent[id] || t > lastEvent[id]) lastEvent[id] = t;
  if (e.status === 'error' && now - t < DAY) errors24[e.type] = (errors24[e.type] || 0) + 1;
}
const ruleCount = {};
for (const r of rules) ruleCount[r.account_id] = (ruleCount[r.account_id] || 0) + 1;

const users = accounts.map(a => {
  const id = String(a.ig_user_id);
  const b = billingBy[id] || null;
  const plan = effectivePlan(b, plans);
  const u = usageBy[id] || {};
  return {
    ig_user_id: id, username: a.username || '', name: a.name || '', avatar: a.avatar || '',
    created_at: a.createdAt, connected_at: a.connected_at || '', token_expires_at: a.token_expires_at || '',
    token_refresh_error: a.token_refresh_error || '',
    plan: plan.id, subscribed_plan: b ? b.plan || 'free' : 'free', status: b ? b.status || '' : 'free',
    period_end: b ? b.period_end || '' : '', auto_renew: !!(b && b.subscription_id && !isTrue(b.cancel_at_period_end)),
    subscription_id: b ? b.subscription_id || '' : '', source: b ? b.source || '' : '', card_hint: b ? b.card_hint || '' : '',
    suspended: !!(b && isTrue(b.suspended)), note: b ? b.note || '' : '',
    usage: { dm: num(u.dm), ai: num(u.ai), ai_tokens: num(u.ai_tokens), comments: num(u.comments) },
    limits: { dm: num(plan.dm), ai: num(plan.ai), rules: num(plan.rules) },
    rules: ruleCount[id] || 0, last_event_at: lastEvent[id] ? new Date(lastEvent[id]).toISOString() : '',
  };
});

function overview() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now + 7 * 3600 * 1000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const usdIdr = num(settings.usd_idr) || 16500;
  const fixedCost = num(settings.cost_server_idr) + num(settings.cost_other_idr);
  const aiPer1m = num(settings.cost_ai_per_1m_idr);
  const byMonth = months.map(m => {
    const paid = payments.filter(x => PAID.includes(x.status) && x.paid_at && monthKey(x.paid_at) === m);
    const revenue = paid.reduce((s, x) => s + num(x.amount), 0);
    const fees = paid.reduce((s, x) => s + num(x.fee), 0);
    const tokens = usage.filter(u => u.month === m).reduce((s, u) => s + num(u.ai_tokens), 0);
    const aiCost = Math.round(tokens / 1e6 * aiPer1m);
    return {
      month: m, revenue, fees, ai_tokens: tokens, ai_cost: aiCost, fixed_cost: fixedCost,
      profit: revenue - fees - aiCost - fixedCost, payments: paid.length,
      new_users: accounts.filter(a => monthKey(a.createdAt) === m).length,
    };
  });
  const paidUsers = users.filter(x => x.plan !== 'free');
  const mrr = users.filter(x => x.auto_renew && x.source === 'midtrans').reduce((s, x) => s + num((plans.find(p => p.id === x.plan) || {}).price), 0);
  const thisMonth = usage.filter(u => u.month === month);
  return {
    month, usd_idr: usdIdr,
    totals: {
      users: users.length, paid_users: paidUsers.length, suspended: users.filter(x => x.suspended).length,
      active_7d: users.filter(x => x.last_event_at && now - new Date(x.last_event_at).getTime() < 7 * DAY).length,
      new_this_month: accounts.filter(a => monthKey(a.createdAt) === month).length,
      mrr, auto_renew: users.filter(x => x.auto_renew).length,
      canceled: users.filter(x => x.status === 'canceled').length, past_due: users.filter(x => x.status === 'past_due').length,
      rules: rules.length,
    },
    plans: plans.map(p => ({ id: p.id, name: p.name, price: num(p.price), users: users.filter(x => x.plan === p.id).length })),
    months: byMonth,
    usage: {
      dm: thisMonth.reduce((s, u) => s + num(u.dm), 0), ai: thisMonth.reduce((s, u) => s + num(u.ai), 0),
      ai_tokens: thisMonth.reduce((s, u) => s + num(u.ai_tokens), 0), comments: thisMonth.reduce((s, u) => s + num(u.comments), 0),
      top_ai: users.filter(x => x.usage.ai).sort((a, b) => b.usage.ai - a.usage.ai).slice(0, 5)
        .map(x => ({ username: x.username, ai: x.usage.ai, ai_tokens: x.usage.ai_tokens, limit: x.limits.ai })),
    },
    health: {
      engine_enabled: settings.engine_enabled !== 'false', signup_open: settings.signup_open !== 'false',
      ai_enabled: settings.gemini_enabled !== 'false',
      midtrans: settings.midtrans_server_key ? (settings.midtrans_env === 'production' ? 'production' : 'sandbox') : '',
      meta_app: !!(settings.ig_app_id && settings.app_secret),
      errors_24h: errors24,
      token_errors: users.filter(x => x.token_refresh_error).map(x => x.username),
      token_expiring: users.filter(x => x.token_expires_at && new Date(x.token_expires_at).getTime() - now < 7 * DAY).map(x => x.username),
      last_event_at: Object.values(lastEvent).length ? new Date(Math.max(...Object.values(lastEvent))).toISOString() : '',
      over_quota: users.filter(x => x.usage.dm >= x.limits.dm).map(x => x.username),
    },
    audit: auditRows.slice(0, 8),
  };
}

const SECRET = ['app_secret', 'midtrans_server_key', 'midtrans_signature_key'];
const HIDDEN = /^sa_/;
function settingsView() {
  const values = {};
  for (const [k, v] of Object.entries(settings)) {
    if (HIDDEN.test(k) || k === 'plans') continue;
    values[k] = SECRET.includes(k) ? (v ? { set: true, hint: '••••' + String(v).slice(-4) } : { set: false }) : v;
  }
  return {
    values, plans,
    webhooks: {
      meta: 'https://kinasih.app.n8n.cloud/webhook/wany-ig',
      oauth_redirect: (settings.public_url || '') + '/webhook/wany-oauth',
      midtrans: (settings.public_url || '') + '/webhook/wany-midtrans',
    },
    totp: !!settings.sa_totp_secret,
  };
}

let response;
if (action === 'sa.overview') response = { ok: true, overview: overview() };
else if (action === 'sa.users') response = { ok: true, users: users.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), plans };
else if (action === 'sa.payments') {
  const names = Object.fromEntries(accounts.map(a => [String(a.ig_user_id), a.username]));
  response = { ok: true, payments: payments.slice(0, 500).map(x => Object.assign({}, x, { username: names[x.account_id] || '' })) };
} else if (action === 'sa.audit') response = { ok: true, audit: auditRows };
else response = { ok: true, settings: settingsView() };
return [{ json: { response } }];

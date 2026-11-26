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
const creditBy = latestBy(rows('Baca Kredit'), 'account_id');
const nameOf = Object.fromEntries(accounts.map(a => [String(a.ig_user_id), a.username || '']));
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

// Satu baris per grup langganan = satu akun Wanychat (email/Google) beserta akun Instagram & TikTok-nya.
// Grup lama (login IG, belum diklaim akun Wanychat) tetap tampil dengan email kosong.
const wanyUsers = rows('Baca Users SA');
const ttAll = rows('Baca TikTok SA').filter(a => a.access_token && a.owner_id && a.owner_id !== 'unlinked');
const userBy = {};
for (const u of wanyUsers.sort((a, b) => Number(a.id) - Number(b.id))) userBy[String(u.group_id || u.uid)] = u;
const linked = accounts.filter(a => a.access_token && a.owner_id !== 'unlinked');
const gids = [...new Set(Object.keys(userBy).concat(linked.map(groupOf)).concat(ttAll.map(a => String(a.owner_id))))];
const users = gids.map(gid => {
  const w = userBy[gid] || null;
  const b = billingBy[gid] || null;
  const plan = effectivePlan(b, plans);
  const c = creditBy[gid] || {};
  const ig = groupMembers(linked, gid);
  const tt = ttAll.filter(a => String(a.owner_id) === gid);
  const sum = (k) => ig.reduce((t, a) => t + num((usageBy[String(a.ig_user_id)] || {})[k]), 0) + num((usageBy[gid] || {})[k]);
  const last = Math.max(0, ...ig.map(a => lastEvent[String(a.ig_user_id)] || 0));
  const first = ig[0] || {};
  const exp = ig.map(a => a.token_expires_at).filter(Boolean).sort()[0] || '';
  return {
    group_id: gid, ig_user_id: gid, uid: w ? w.uid : '', email: w ? w.email || '' : '', email_verified: !!(w && isTrue(w.email_verified)),
    google: !!(w && w.google_sub), legacy: !w,
    username: first.username || (tt[0] && tt[0].username) || '', name: (w && w.name) || first.name || '', avatar: (w && w.avatar) || first.avatar || '',
    instagram: ig.map((a, i) => ({ ig_user_id: String(a.ig_user_id), username: a.username || '', active: i < Math.max(1, num(plan.accounts) || 1), token_refresh_error: a.token_refresh_error || '' })),
    tiktok: tt.map(a => ({ open_id: String(a.open_id), username: a.username || '', token_refresh_error: a.token_refresh_error || '' })),
    created_at: (w && w.createdAt) || first.createdAt || '', connected_at: first.connected_at || '', last_login_at: (w && w.last_login_at) || '',
    token_expires_at: exp, token_refresh_error: ig.concat(tt).map(a => a.token_refresh_error).filter(Boolean)[0] || '',
    plan: plan.id, subscribed_plan: b ? b.plan || 'free' : 'free', status: b ? b.status || '' : 'free',
    period_end: b ? b.period_end || '' : '', auto_renew: !!(b && b.subscription_id && !isTrue(b.cancel_at_period_end)),
    subscription_id: b ? b.subscription_id || '' : '', source: b ? b.source || '' : '', card_hint: b ? b.card_hint || '' : '',
    suspended: !!(b && isTrue(b.suspended)), note: b ? b.note || '' : '',
    usage: { dm: sum('dm'), ai: sum('ai'), ai_tokens: sum('ai_tokens'), comments: sum('comments') },
    limits: { dm: num(plan.dm), ai: num(plan.ai), rules: num(plan.rules) },
    rules: ig.reduce((t, a) => t + (ruleCount[a.ig_user_id] || 0), 0), last_event_at: last ? new Date(last).toISOString() : '',
    owner_id: '', owner_username: '', group_size: ig.length + tt.length, active: true,
    credits: creditBalance(c), credits_granted: num(c.granted), credits_used: num(c.used),
  };
});
const createdIn = (m) => users.filter(x => x.created_at && monthKey(x.created_at) === m).length;

function overview() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now + 7 * 3600 * 1000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const usdIdr = num(settings.usd_idr) || 18000;
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
      new_users: createdIn(m),
    };
  });
  const paidUsers = users.filter(x => x.plan !== 'free' && !x.owner_id);
  const mrr = users.filter(x => x.plan !== 'free' && !x.owner_id && ['doku', 'midtrans'].includes(x.source)).reduce((s, x) => s + num((plans.find(p => p.id === x.plan) || {}).price), 0);
  const thisMonth = usage.filter(u => u.month === month);
  return {
    month, usd_idr: usdIdr,
    totals: {
      users: users.length, paid_users: paidUsers.length, suspended: users.filter(x => x.suspended).length,
      active_7d: users.filter(x => x.last_event_at && now - new Date(x.last_event_at).getTime() < 7 * DAY).length,
      new_this_month: createdIn(month),
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
      doku: settings.doku_client_id && settings.doku_secret_key ? (settings.doku_env === 'sandbox' ? 'sandbox' : 'production') : '',
      // Key Midtrans produksi & sandbox disimpan terpisah; yang dipakai mengikuti midtrans_env
      midtrans: settings.midtrans_env === 'production' ? (settings.midtrans_server_key ? 'production' : '') : (settings.midtrans_sb_server_key ? 'sandbox' : ''),
      gateway: settings.payment_provider === 'midtrans' ? 'midtrans' : 'doku',
      meta_app: !!(settings.ig_app_id && settings.app_secret),
      google: !!(settings.google_client_id && settings.google_client_secret),
      tiktok: !!(settings.tiktok_app_id && settings.tiktok_secret),
      errors_24h: errors24,
      token_errors: users.filter(x => x.token_refresh_error).map(x => x.username),
      token_expiring: users.filter(x => x.token_expires_at && new Date(x.token_expires_at).getTime() - now < 7 * DAY).map(x => x.username),
      last_event_at: Object.values(lastEvent).length ? new Date(Math.max(...Object.values(lastEvent))).toISOString() : '',
      over_quota: users.filter(x => x.usage.dm >= x.limits.dm).map(x => x.username),
    },
    audit: auditRows.slice(0, 8),
  };
}

const SECRET = ['app_secret', 'google_client_secret', 'tiktok_secret', 'mail_secret', 'doku_secret_key', 'midtrans_server_key', 'midtrans_sb_server_key', 'midtrans_signature_key', 'midtrans_sb_signature_key', 's3_access_key', 's3_secret_key'];
// Setelan Midtrans versi langganan lama (tidak dipakai lagi)
const LEGACY = /^midtrans_(payments|fee_pct|fee_flat|client_key)$/;
const HIDDEN = /^sa_/;
function settingsView() {
  const values = {};
  for (const [k, v] of Object.entries(settings)) {
    if (HIDDEN.test(k) || LEGACY.test(k) || k === 'plans') continue;
    values[k] = SECRET.includes(k) ? (v ? { set: true, hint: '••••' + String(v).slice(-4) } : { set: false }) : v;
  }
  return {
    values, plans,
    webhooks: {
      meta: 'https://kinasih.app.n8n.cloud/webhook/wany-ig',
      oauth_redirect: (settings.public_url || '') + '/webhook/wany-oauth',
      google_redirect: (settings.public_url || '') + '/webhook/wany-google-cb',
      tiktok_redirect: (settings.public_url || '') + '/webhook/wany-tiktok-login',
      doku: (settings.public_url || '') + '/webhook/wany-doku',
      midtrans: (settings.public_url || '') + '/webhook/wany-midtrans',
    },
    totp: !!settings.sa_totp_secret,
  };
}

let response;
if (action === 'sa.overview') response = { ok: true, overview: overview() };
else if (action === 'sa.users') response = { ok: true, users: users.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), plans };
else if (action === 'sa.payments') {
  const names = Object.fromEntries(accounts.map(a => [String(a.ig_user_id), a.username]).concat(users.map(u => [u.group_id, u.email || u.username])));
  response = { ok: true, payments: payments.slice(0, 500).map(x => Object.assign({}, x, { username: names[x.account_id] || '' })) };
} else if (action === 'sa.audit') response = { ok: true, audit: auditRows };
else response = { ok: true, settings: settingsView() };
return [{ json: { response } }];

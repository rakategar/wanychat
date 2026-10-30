// Admin API panel: user dikenali dari cookie sesi (hasil login Instagram), semua data dibatasi ke akunnya sendiri.
//#include lib_plans.js
const helpers = this.helpers;
const req = $('Webhook API').first().json;
const body = req.body || {};
const action = String(body.action || '');
const p = body.payload || {};

const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');
const base = String(settings.public_url || '').replace(/\/$/, '');

const session = $('Cari Sesi').first().json;
const sessionValid = !!(session && session.token && (!session.expires_at || new Date(session.expires_at) > new Date()));
const acc = sessionValid ? $('Baca Akun').all().map(i => i.json).find(a => String(a.ig_user_id) === String(session.ig_user_id)) : null;

// Tolak permintaan lintas situs (CSRF): browser selalu mengirim Origin untuk POST fetch
const origin = String((req.headers || {}).origin || '');
const sameOrigin = !origin || (base && origin === base);

const plans = loadPlans(settings);
const month = monthKey();
const billing = acc ? latestBy($('Baca Billing Akun').all().map(i => i.json), 'account_id')[String(acc.ig_user_id)] || null : null;
const usageRow = acc ? latestBy($('Baca Usage Akun').all().map(i => i.json).filter(u => u.month === month), 'account_id')[String(acc.ig_user_id)] || {} : {};
const usage = { dm: Number(usageRow.dm) || 0, ai: Number(usageRow.ai) || 0 };
const plan = effectivePlan(billing, plans);
const myRules = $('Baca Rules Akun').all().map(i => i.json).filter(r => r.id && acc && String(r.account_id) === String(acc.ig_user_id));
const publicPlan = (x) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, dm: Number(x.dm) || 0, ai: Number(x.ai) || 0, rules: Number(x.rules) || 0, followup: !!x.followup, persona: !!x.persona });
const fullBilling = (fields) => Object.assign({
  account_id: String(acc.ig_user_id), plan: 'free', status: 'free', period_end: null, subscription_id: '', subscription_name: '',
  cancel_at_period_end: false, suspended: false, source: '', card_hint: '', last_order_id: '', note: '',
}, billing ? {
  plan: billing.plan || 'free', status: billing.status || '', period_end: billing.period_end || null,
  subscription_id: billing.subscription_id || '', subscription_name: billing.subscription_name || '',
  cancel_at_period_end: isTrue(billing.cancel_at_period_end), suspended: isTrue(billing.suspended), source: billing.source || '',
  card_hint: billing.card_hint || '', last_order_id: billing.last_order_id || '', note: billing.note || '',
} : {}, fields || {});
const billingView = () => ({
  plan: publicPlan(plan),
  subscribed_plan: billing && billing.plan ? billing.plan : 'free',
  status: billing ? billing.status || '' : 'free',
  period_end: billing && billing.plan !== 'free' ? billing.period_end || '' : '',
  auto_renew: !!(billing && billing.subscription_id && !isTrue(billing.cancel_at_period_end)),
  cancel_at_period_end: !!(billing && isTrue(billing.cancel_at_period_end)),
  card_hint: billing ? billing.card_hint || '' : '',
  source: billing ? billing.source || '' : '',
  usage, month, rules_used: myRules.length,
});

// Midtrans
const MT_PROD = settings.midtrans_env === 'production';
const SNAP = MT_PROD ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
const CORE = MT_PROD ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
async function midtrans(method, url, payload, headers) {
  try {
    const res = await helpers.httpRequest({
      method, url, body: payload, json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
      headers: Object.assign({ Authorization: 'Basic ' + Buffer.from(String(settings.midtrans_server_key || '') + ':').toString('base64'), Accept: 'application/json' }, headers || {}),
    });
    const b = res.body || {};
    const err = res.statusCode >= 300 || (b.status_code && Number(b.status_code) >= 300);
    return { ok: !err, body: b, error: err ? ((b.error_messages || b.validation_messages || []).join('; ') || b.status_message || ('HTTP ' + res.statusCode)) : '' };
  } catch (e) {
    return { ok: false, body: {}, error: e.message };
  }
}

const reply = (route, response, extra) => [{ json: Object.assign({ route, response, account_id: acc ? String(acc.ig_user_id) : '' }, extra || {}) }];
const fail = (error, status) => reply('direct', { ok: false, error }, { status: status || 400 });
const updateAccount = (fields, response) => reply('account_update', response, { fields: Object.assign({
  ig_user_id: acc.ig_user_id, username: acc.username, name: acc.name, avatar: acc.avatar, access_token: acc.access_token,
  token_expires_at: acc.token_expires_at || null, token_refresh_error: acc.token_refresh_error || '',
  ai_enabled: acc.ai_enabled !== false, ai_persona: acc.ai_persona || '',
}, fields) });

async function ig(method, path, qs) {
  try {
    const res = await helpers.httpRequest({
      method, url: path.startsWith('http') ? path : G + path, qs: Object.assign({}, qs || {}, { access_token: acc.access_token }),
      json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
    });
    const b = res.body || {};
    if (res.statusCode >= 400 || b.error) return { ok: false, error: (b.error && b.error.message) || ('HTTP ' + res.statusCode) };
    return { ok: true, body: b };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const publicAccount = () => ({
  ig_user_id: String(acc.ig_user_id),
  username: acc.username || '',
  name: acc.name || '',
  avatar: acc.avatar || '',
  token_expires_at: acc.token_expires_at || '',
  token_refresh_error: acc.token_refresh_error || '',
  ai_enabled: acc.ai_enabled !== false,
  ai_persona: acc.ai_persona || '',
  connected_at: acc.connected_at || '',
});

if (!sameOrigin) return reply('deny', { ok: false, error: 'Permintaan ditolak' });
if (!acc) return reply('deny', { ok: false, error: 'Silakan masuk dengan Instagram' });
if (billing && isTrue(billing.suspended)) return reply('deny', { ok: false, error: 'Akun ini dinonaktifkan. Hubungi admin Wanychat.' });

switch (action) {
  case 'auth.me':
    return reply('direct', { ok: true, account: publicAccount(), billing: billingView(), announcement: settings.announcement || '' });

  case 'billing.get':
    return reply('direct', { ok: true, billing: billingView(), plans: plans.map(publicPlan), payments_enabled: !!settings.midtrans_server_key });

  case 'billing.payments':
    return reply('payments_list', null);

  case 'billing.checkout': {
    const target = plans.find(x => x.id === String(p.plan || '') && Number(x.price) > 0);
    if (!target) return fail('Paket tidak ditemukan');
    if (!settings.midtrans_server_key) return fail('Pembayaran belum dibuka. Hubungi admin Wanychat.');
    if (!base) return fail('public_url belum disetel admin');
    if (billing && billing.plan === target.id && billing.subscription_id && !isTrue(billing.cancel_at_period_end) && plan.id === target.id) {
      return fail('Paket ' + target.name + ' sudah aktif dan diperpanjang otomatis.');
    }
    const price = Math.round(Number(target.price));
    const orderId = ('WNY-' + target.id + '-' + acc.ig_user_id + '-' + Date.now().toString(36)).slice(0, 50);
    const payments = String(settings.midtrans_payments || 'credit_card').split(',').map(x => x.trim()).filter(Boolean);
    const r = await midtrans('POST', SNAP + '/snap/v1/transactions', {
      transaction_details: { order_id: orderId, gross_amount: price },
      item_details: [{ id: target.id, price, quantity: 1, name: ('Wanychat ' + target.name + ' 1 bulan').slice(0, 50) }],
      customer_details: { first_name: String(acc.username || 'Pelanggan').slice(0, 50) },
      credit_card: { secure: true, save_card: true },
      user_id: String(acc.ig_user_id),
      enabled_payments: payments,
      callbacks: { finish: base + '/#/billing?paid=1' },
      expiry: { unit: 'hours', duration: 2 },
      custom_field1: String(acc.ig_user_id), custom_field2: target.id,
    }, { 'X-Override-Notification': base + '/webhook/wany-midtrans' });
    if (!r.ok || !r.body.redirect_url) return fail('Gagal membuat pembayaran: ' + (r.error || 'tanpa redirect_url'));
    return reply('payment_insert', { ok: true, redirect_url: r.body.redirect_url }, { payment: {
      order_id: orderId, account_id: String(acc.ig_user_id), plan: target.id, amount: price, status: 'pending',
      payment_type: '', kind: 'checkout', transaction_id: '', paid_at: null, fee: 0, note: '',
    } });
  }

  case 'billing.cancel': {
    if (!billing || !billing.subscription_id) return fail('Tidak ada perpanjangan otomatis yang aktif');
    const r = await midtrans('POST', CORE + '/v1/subscriptions/' + encodeURIComponent(billing.subscription_id) + '/disable');
    if (!r.ok) return fail('Gagal menghentikan perpanjangan: ' + r.error);
    return reply('billing_save', { ok: true }, { billing: fullBilling({ subscription_id: '', cancel_at_period_end: true, status: 'canceled' }) });
  }

  case 'auth.logout':
    return reply('logout', { ok: true }, { token: session.token });

  case 'settings.save': {
    const fields = {};
    if (typeof p.ai_enabled === 'boolean') fields.ai_enabled = p.ai_enabled;
    if (typeof p.ai_persona === 'string') {
      if (p.ai_persona.trim() && p.ai_persona.trim() !== (acc.ai_persona || '') && !plan.persona) return fail('Persona AI sendiri tersedia mulai paket Pro');
      fields.ai_persona = p.ai_persona.trim().slice(0, 2000);
    }
    if (!Object.keys(fields).length) return fail('Tidak ada yang diubah');
    return updateAccount(fields, { ok: true });
  }

  case 'ig.test': {
    const me = await ig('GET', '/me', { fields: 'user_id,username,name,profile_picture_url,followers_count,media_count' });
    if (!me.ok) return fail('Koneksi Instagram bermasalah: ' + me.error + '. Coba masuk ulang dengan Instagram.');
    const subs = await ig('GET', '/me/subscribed_apps');
    return updateAccount(
      { username: me.body.username || acc.username, name: me.body.name || acc.name, avatar: me.body.profile_picture_url || acc.avatar },
      { ok: true, profile: me.body, subscriptions: subs.ok ? subs.body.data || [] : null },
    );
  }

  case 'ig.media': {
    const r = await ig('GET', '/me/media', {
      fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count',
      limit: Math.min(Number(p.limit) || 30, 50),
    });
    if (!r.ok) return fail(r.error);
    return reply('direct', { ok: true, media: r.body.data || [] });
  }

  case 'ig.subscribe': {
    const r = await ig('POST', '/me/subscribed_apps', { subscribed_fields: 'comments,messages,messaging_postbacks' });
    if (!r.ok) return fail(r.error);
    return reply('direct', { ok: true });
  }

  case 'rules.list':
    return reply('direct', { ok: true, rules: myRules });

  case 'rules.save': {
    const r = p.rule || {};
    if (!String(r.name || '').trim()) return fail('Nama automasi wajib diisi');
    const channel = r.channel === 'dm' ? 'dm' : 'comment';
    const match = ['contains', 'exact', 'any'].includes(r.match_mode) ? r.match_mode : 'contains';
    if (match !== 'any' && !String(r.keywords || '').trim()) return fail('Isi minimal satu keyword, atau pilih "Semua"');
    const rowId = Number(r.id) > 0 ? Number(r.id) : -1;
    if (rowId > 0 && !myRules.some(x => Number(x.id) === rowId)) return fail('Automasi tidak ditemukan', 404);
    if (rowId < 0 && Number(plan.rules) > 0 && myRules.length >= Number(plan.rules)) return fail('Paket ' + plan.name + ' maksimal ' + plan.rules + ' automasi. Upgrade di menu Langganan.');
    if (r.followup_enabled && !plan.followup) return fail('Follow-up tersedia mulai paket Kreator. Matikan follow-up atau upgrade.');
    if (r.ai_fallback && !(Number(plan.ai) > 0)) return fail('Balasan AI tersedia mulai paket Kreator. Matikan Balasan AI atau upgrade.');
    return [{ json: {
      route: 'rules_save',
      account_id: String(acc.ig_user_id),
      row_id: rowId,
      name: String(r.name).trim().slice(0, 120),
      active: r.active !== false,
      channel,
      post_ids: String(r.post_ids || '*').replace(/[^0-9,*]/g, '').slice(0, 2000) || '*',
      keywords: String(r.keywords || '').trim().slice(0, 1000),
      match_mode: match,
      comment_replies: String(r.comment_replies || '').trim().slice(0, 3000),
      dm_message: String(r.dm_message || '').trim().slice(0, 1000),
      dm_button_title: String(r.dm_button_title || '').trim().slice(0, 20),
      dm_content: String(r.dm_content || '').trim().slice(0, 1000),
      followup_enabled: !!r.followup_enabled,
      followup_delay_min: Math.max(1, Math.min(1380, Number(r.followup_delay_min) || 60)),
      followup_message: String(r.followup_message || '').trim().slice(0, 1000),
      ai_fallback: !!r.ai_fallback,
      ai_context: String(r.ai_context || '').trim().slice(0, 4000),
    } }];
  }

  case 'rules.delete':
    if (!(Number(p.id) > 0)) return fail('id tidak valid');
    return reply('rules_delete', null, { row_id: Number(p.id) });

  case 'events.list':
    return reply('events_list', null, { limit: Math.min(Number(p.limit) || 200, 500) });

  case 'followups.list':
    return reply('followups_list', null);

  case 'logs.clear':
    return reply('logs_clear', null);

  default:
    return fail('Aksi tidak dikenal: ' + action);
}

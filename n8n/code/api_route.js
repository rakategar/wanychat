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
// Satu langganan bisa dipakai beberapa akun IG (grup = akun pemilik). Billing, kuota, dan kredit AI milik grup.
const gid = acc ? groupOf(acc) : '';
const members = acc ? groupMembers($('Baca Akun Grup').all().map(i => i.json).concat([acc]).filter((a, i, all) => all.findIndex(b => String(b.ig_user_id) === String(a.ig_user_id)) === i), gid) : [];
const billing = acc ? latestBy($('Baca Billing Akun').all().map(i => i.json), 'account_id')[gid] || null : null;
const usage = acc ? groupUsage($('Baca Usage Akun').all().map(i => i.json).filter(u => u.month === month), members, gid) : { dm: 0, ai: 0 };
const credit = acc ? latestBy($('Baca Kredit').all().map(i => i.json), 'account_id')[gid] || {} : {};
const credits = creditBalance(credit);
const plan = effectivePlan(billing, plans);
const topups = loadTopups(settings);
const myRules = $('Baca Rules Akun').all().map(i => i.json).filter(r => r.id && acc && String(r.account_id) === String(acc.ig_user_id));
const publicPlan = (x) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, dm: Number(x.dm) || 0, ai: Number(x.ai) || 0, rules: Number(x.rules) || 0,
  followup: !!x.followup, persona: !!x.persona, accounts: Number(x.accounts) || 1, analytics: !!x.analytics, watermark: !!x.watermark });
const owner = members.find(a => String(a.ig_user_id) === gid);
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
  credits, accounts_limit: Math.max(1, Number(plan.accounts) || 1), accounts_used: members.length,
  group_inactive: !!acc && !activeInGroup(acc, members, plan), is_owner: !!acc && String(acc.ig_user_id) === gid,
  owner_username: owner ? owner.username || '' : '',
});

//#include lib_pay.js
//#include lib_doku.js
//#include lib_midtrans.js
const fmtNum = (n) => Math.round(n).toLocaleString('id-ID');

const reply = (route, response, extra) => [{ json: Object.assign({ route, response, account_id: acc ? String(acc.ig_user_id) : '', group_id: gid }, extra || {}) }];
const fail = (error, status) => reply('direct', { ok: false, error }, { status: status || 400 });
const updateAccount = (fields, response) => reply('account_update', response, { fields: Object.assign({
  ig_user_id: acc.ig_user_id, username: acc.username, name: acc.name, avatar: acc.avatar, access_token: acc.access_token,
  token_expires_at: acc.token_expires_at || null, token_refresh_error: acc.token_refresh_error || '',
  ai_enabled: acc.ai_enabled !== false, ai_persona: acc.ai_persona || '', owner_id: acc.owner_id || '',
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
  owner_id: acc.owner_id || '',
});
const memberView = (a, i) => ({
  ig_user_id: String(a.ig_user_id), username: a.username || '', name: a.name || '', avatar: a.avatar || '',
  owner: String(a.ig_user_id) === gid, current: String(a.ig_user_id) === String(acc.ig_user_id),
  active: i < Math.max(1, Number(plan.accounts) || 1), connected_at: a.connected_at || '',
});

if (!sameOrigin) return reply('deny', { ok: false, error: 'Permintaan ditolak' });
if (!acc) return reply('deny', { ok: false, error: 'Silakan masuk dengan Instagram' });
if (billing && isTrue(billing.suspended)) return reply('deny', { ok: false, error: 'Akun ini dinonaktifkan. Hubungi admin Wanychat.' });

switch (action) {
  case 'auth.me':
    return reply('direct', { ok: true, account: publicAccount(), billing: billingView(), announcement: settings.announcement || '' });

  case 'billing.get':
    return reply('direct', {
      ok: true, billing: billingView(), plans: plans.map(publicPlan), topups, payments_enabled: payReady(), gateway: PAY_NAMES[PAY_GATEWAY],
      // Total per metode bayar per paket/top-up: fee gateway + PPN-nya sudah ditambahkan supaya diterima bersih = harga
      methods: payMethods().map(id => ({
        id, label: payLabel(id),
        totals: Object.fromEntries(plans.filter(x => Number(x.price) > 0).map(x => [x.id, payCharge(x.price, id).total])
          .concat(topups.map(t => [t.id, payCharge(t.price, id).total]))),
      })),
    });

  case 'billing.payments':
    return reply('payments_list', null);

  case 'billing.checkout': {
    // Paket langganan (p.plan) atau top-up kredit AI (p.topup); dibukukan ke akun pemilik grup
    const pack = p.topup ? topups.find(x => x.id === String(p.topup)) : null;
    if (p.topup && !pack) return fail('Paket top-up tidak ditemukan');
    const target = pack ? { id: pack.id, name: fmtNum(pack.credits) + ' kredit AI', price: pack.price }
      : plans.find(x => x.id === String(p.plan || '') && Number(x.price) > 0);
    if (!target) return fail('Paket tidak ditemukan');
    if (!payReady()) return fail('Pembayaran belum dibuka. Hubungi admin Wanychat.');
    if (!base) return fail('public_url belum disetel admin');
    const method = String(p.method || '');
    if (!payMethods().includes(method)) return fail('Pilih metode pembayaran');
    const price = Math.round(Number(target.price));
    const charge = payCharge(price, method);
    // Maks 30 karakter tanpa simbol (syarat kartu kredit & KKI di DOKU; aman juga untuk order_id Midtrans)
    const orderId = ('WNY' + Date.now().toString(36) + dokuCrypto.randomBytes(4).toString('hex')).toUpperCase().slice(0, 30);
    const items = [{ id: target.id, name: ('Wanychat ' + target.name + (pack ? '' : ' 1 bulan')).slice(0, 50), price, quantity: 1 }];
    if (charge.surcharge > 0) items.push({ id: 'fee', name: 'Biaya layanan pembayaran', price: charge.surcharge, quantity: 1 });
    const r = await payCheckout({
      orderId, total: charge.total, items, method, base,
      customerId: 'IG' + gid, customerName: String(acc.name || acc.username || 'Pelanggan').slice(0, 50),
    });
    if (!r.ok) return fail('Gagal membuat pembayaran: ' + r.error);
    return reply('payment_insert', { ok: true, redirect_url: r.url }, { payment: {
      order_id: orderId, account_id: gid, plan: target.id, amount: charge.total, status: 'pending',
      payment_type: method, kind: pack ? 'topup' : 'checkout', credits: pack ? pack.credits : 0, gateway: PAY_GATEWAY,
      transaction_id: r.session,
      paid_at: null, fee: 0, note: (charge.surcharge ? 'harga ' + price + ' + biaya ' + charge.surcharge : '') + (gid !== String(acc.ig_user_id) ? ' via @' + (acc.username || acc.ig_user_id) : ''),
    } });
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
    if (r.ai_fallback && !(Number(plan.ai) > 0) && !(credits > 0)) return fail('Balasan AI butuh paket Kreator ke atas atau kredit AI. Beli top-up di menu Langganan.');
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

  case 'accounts.list':
    return reply('direct', { ok: true, accounts: members.map(memberView), limit: Math.max(1, Number(plan.accounts) || 1), is_owner: String(acc.ig_user_id) === gid, plan: plan.name });

  case 'accounts.switch': {
    // Pindah dasbor ke akun lain dalam grup yang sama (sesi tetap, ig_user_id sesi diganti)
    const target = members.find(a => String(a.ig_user_id) === String(p.ig_user_id || ''));
    if (!target) return fail('Akun tidak ada di grup kamu', 404);
    return reply('session_switch', { ok: true }, { target: String(target.ig_user_id) });
  }

  case 'accounts.unlink': {
    // Pemilik melepas akun anggota, atau anggota keluar dari grup. Akun yang dilepas jadi akun Gratis sendiri.
    const id = String(p.ig_user_id || '');
    const target = members.find(a => String(a.ig_user_id) === id);
    if (!target || id === gid) return fail('Akun pemilik langganan tidak bisa dilepas');
    if (String(acc.ig_user_id) !== gid && id !== String(acc.ig_user_id)) return fail('Hanya pemilik langganan yang bisa melepas akun lain', 403);
    return reply('account_unlink', { ok: true, self: id === String(acc.ig_user_id) }, { target: id, back_to: gid });
  }

  case 'analytics.get': {
    if (!plan.analytics) return fail('Dasbor analitik tersedia di paket Bisnis. Upgrade di menu Langganan.', 403);
    const days = [7, 30, 90].includes(Number(p.days)) ? Number(p.days) : 30;
    return reply('analytics', null, { days });
  }

  case 'events.list':
    return reply('events_list', null, { limit: Math.min(Number(p.limit) || 200, 500) });

  case 'followups.list':
    return reply('followups_list', null);

  case 'logs.clear':
    return reply('logs_clear', null);

  default:
    return fail('Aksi tidak dikenal: ' + action);
}

// Admin API panel: user dikenali dari cookie sesi (akun Wanychat email/Google), semua data dibatasi ke grup miliknya.
// Satu akun Wanychat = satu grup langganan (users.group_id) berisi akun Instagram + TikTok. Billing, kuota, kredit AI milik grup.
//#include lib_plans.js
//#include lib_user.js
const helpers = this.helpers;
const req = $('Webhook API').first().json;
const body = req.body || {};
const action = String(body.action || '');
const p = body.payload || {};

const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');
const base = String(settings.public_url || '').replace(/\/$/, '');
//#include lib_tiktok.js

const session = $('Cari Sesi').first().json;
const sessionValid = !!(session && session.token && session.user_id && (!session.expires_at || new Date(session.expires_at) > new Date()));
const user = sessionValid ? latestRow($('Baca User').all().map(i => i.json), 'uid', session.user_id) : null;
const gid = user ? String(user.group_id || user.uid) : '';

// Tolak permintaan lintas situs (CSRF): browser selalu mengirim Origin untuk POST fetch
const origin = String((req.headers || {}).origin || '');
const sameOrigin = !origin || (base && origin === base);

// Akun Instagram grup (urutan baris tabel = urutan yang sama dengan ekspresi node "Baca Rules Akun")
const igRows = user ? $('Baca Akun Grup').all().map(i => i.json).filter(a => a && a.ig_user_id && a.access_token && groupOf(a) === gid) : [];
const acc = igRows.find(a => String(a.ig_user_id) === String(session.ig_user_id)) || igRows[0] || null;
const ttRows = user ? $('Baca TikTok Grup').all().map(i => i.json).filter(a => a && a.open_id && a.access_token && String(a.owner_id) === gid) : [];
const tt = ttRows.find(a => String(a.open_id) === String(session.tt_open_id)) || ttRows[0] || null;

const plans = loadPlans(settings);
const month = monthKey();
const members = groupMembers(igRows, gid);
const billing = user ? latestBy($('Baca Billing Akun').all().map(i => i.json), 'account_id')[gid] || null : null;
const usage = user ? groupUsage($('Baca Usage Akun').all().map(i => i.json).filter(u => u.month === month), members.concat(ttRows), gid) : { dm: 0, ai: 0 };
const credit = user ? latestBy($('Baca Kredit').all().map(i => i.json), 'account_id')[gid] || {} : {};
const credits = creditBalance(credit);
const plan = effectivePlan(billing, plans);
const topups = loadTopups(settings);
const ruleRows = $('Baca Rules Akun').all().map(i => i.json).filter(r => r && r.id);
const myRules = ruleRows.filter(r => acc && String(r.account_id) === String(acc.ig_user_id) && r.channel !== 'tiktok');
const ttRules = ruleRows.filter(r => tt && String(r.account_id) === String(tt.open_id) && r.channel === 'tiktok');
const isTt = p.type === 'tiktok';
const publicPlan = (x) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, dm: Number(x.dm) || 0, ai: Number(x.ai) || 0, rules: Number(x.rules) || 0,
  followup: !!x.followup, persona: !!x.persona, accounts: Number(x.accounts) || 1, analytics: !!x.analytics, watermark: !!x.watermark });
const accountsLimit = Math.max(1, Number(plan.accounts) || 1);
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
  credits, accounts_limit: accountsLimit, accounts_used: members.length, tt_used: ttRows.length,
  group_inactive: !!acc && !activeInGroup(acc, members, plan), is_owner: true, owner_username: '',
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
// Semua akun sosial grup (Instagram + TikTok) untuk pemilih akun & menu Akun
const listAccounts = () => members.map((a, i) => ({
  type: 'instagram', id: String(a.ig_user_id), username: a.username || '', name: a.name || '', avatar: a.avatar || '',
  current: !!acc && String(a.ig_user_id) === String(acc.ig_user_id), active: i < accountsLimit, connected_at: a.connected_at || '',
  token_refresh_error: a.token_refresh_error || '',
})).concat(ttRows.map(a => Object.assign(ttPublic(a), {
  type: 'tiktok', id: String(a.open_id), name: a.display_name || '', current: !!tt && String(a.open_id) === String(tt.open_id),
  active: ttActiveInGroup(a, members, ttRows, plan),
})));
// Sesi menunjuk akun yang sedang dibuka; disejajarkan bila akun lama sudah dilepas / belum dipilih
const sessionStale = () => user && (String(session.ig_user_id || '') !== (acc ? String(acc.ig_user_id) : '') || String(session.tt_open_id || '') !== (tt ? String(tt.open_id) : ''));
const switchSession = (response, ig, ttId) => reply('session_switch', response, { ig: ig || '', tt: ttId || '' });
const needIg = () => fail('Hubungkan akun Instagram dulu di menu Akun.', 409);
const saveUser = (fields, response) => reply('user_update', response, { user: userRow(user, fields) });

// Token TikTok 24 jam: diperbarui otomatis sebelum dipakai; baris baru disimpan lewat route tt_update
let ttUpdate = null;
async function ttToken() {
  if (!tt) return '';
  const exp = tt.token_expires_at ? new Date(tt.token_expires_at).getTime() : 0;
  if (exp > Date.now() + 5 * 60000) return tt.access_token;
  const r = await ttRefresh(tt.refresh_token);
  if (!r.ok || !r.data.access_token) {
    ttUpdate = ttRow(tt, { token_refresh_error: 'Refresh gagal: ' + r.error });
    return tt.access_token;
  }
  ttUpdate = ttRow(tt, ttTokenFields(r.data));
  return ttUpdate.access_token;
}
const ttRespond = (response) => ttUpdate ? reply('tt_update', response, { tt: ttUpdate }) : reply('direct', response);
const ttFail = (r) => ttRespond({ ok: false, error: r.code === 40105 || /token/i.test(r.error) ? 'Izin TikTok kedaluwarsa. Hubungkan ulang akun TikTok di menu Akun.' : 'TikTok: ' + r.error });

// Rule automasi komentar TikTok: keyword -> balas publik (maks 150 karakter) / sembunyikan, atau balasan AI bila tidak cocok
function saveTtRule(r) {
  if (!tt) return fail('Hubungkan akun TikTok dulu.', 409);
  if (!String(r.name || '').trim()) return fail('Nama automasi wajib diisi');
  const match = ['contains', 'exact', 'any'].includes(r.match_mode) ? r.match_mode : 'contains';
  const hide = !!r.hide_comment;
  if (hide && match === 'any') return fail('Automasi sembunyikan komentar wajib memakai keyword (supaya tidak menyembunyikan semua komentar).');
  if (match !== 'any' && !String(r.keywords || '').trim()) return fail('Isi minimal satu keyword, atau pilih "Semua"');
  const replies = hide ? '' : String(r.comment_replies || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 20);
  if (!hide && replies.some(x => x.length > 150)) return fail('Balasan TikTok maksimal 150 karakter per baris.');
  const ai = !hide && !!r.ai_fallback;
  if (!hide && !replies.length && !ai) return fail('Isi minimal satu variasi balasan, nyalakan balasan AI, atau pilih "Sembunyikan komentar".');
  const rowId = Number(r.id) > 0 ? Number(r.id) : -1;
  if (rowId > 0 && !ttRules.some(x => Number(x.id) === rowId)) return fail('Automasi tidak ditemukan', 404);
  if (rowId < 0 && Number(plan.rules) > 0 && ttRules.length >= Number(plan.rules)) return fail('Paket ' + plan.name + ' maksimal ' + plan.rules + ' automasi per akun. Upgrade di menu Langganan.');
  if (ai && !(Number(plan.ai) > 0) && !(credits > 0)) return fail('Balasan AI butuh paket Kreator ke atas atau kredit AI. Beli top-up di menu Langganan.');
  const videos = String(r.post_ids || '*').split(/[,\s]+/).filter(x => x === '*' || /^\d{5,30}$/.test(x));
  return [{ json: {
    route: 'rules_save', account_id: String(tt.open_id), row_id: rowId,
    name: String(r.name).trim().slice(0, 120), active: r.active !== false, channel: 'tiktok',
    post_ids: (videos.includes('*') || !videos.length ? '*' : videos.slice(0, 30).join(',')),
    keywords: String(r.keywords || '').trim().slice(0, 1000), match_mode: match,
    comment_replies: hide ? '' : replies.join('\n'), dm_message: '', dm_button_title: '', dm_content: '',
    followup_enabled: false, followup_delay_min: 60, followup_message: '',
    ai_fallback: ai, ai_context: ai ? String(r.ai_context || '').trim().slice(0, 4000) : '', hide_comment: hide,
  } }];
}

if (!sameOrigin) return reply('deny', { ok: false, error: 'Permintaan ditolak' });
if (!user) return reply('deny', { ok: false, error: 'Silakan masuk' });
if (billing && isTrue(billing.suspended)) return reply('deny', { ok: false, error: 'Akun ini dinonaktifkan. Hubungi admin Wanychat.' });

switch (action) {
  case 'auth.me': {
    const res = { ok: true, user: publicUser(user), account: acc ? publicAccount() : null, tiktok: tt ? ttPublic(tt) : null,
      accounts: listAccounts(), billing: billingView(), announcement: settings.announcement || '' };
    return sessionStale() ? switchSession(res, acc && acc.ig_user_id, tt && tt.open_id) : reply('direct', res);
  }

  case 'user.update': {
    const fields = {};
    if (typeof p.name === 'string') {
      const name = p.name.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) return fail('Nama wajib diisi');
      fields.name = name;
    }
    if (typeof p.marketing_opt_in === 'boolean') fields.marketing_opt_in = p.marketing_opt_in;
    if (!Object.keys(fields).length) return fail('Tidak ada yang diubah');
    return saveUser(fields, { ok: true, user: publicUser(userRow(user, fields)) });
  }

  case 'user.password': {
    if (user.password_hash && !verifyPw(String(p.current || '').slice(0, 256), user.password_hash)) return fail('Password lama salah');
    const bad = pwProblem(p.next);
    if (bad) return fail(bad);
    return saveUser({ password_hash: hashPw(String(p.next)) }, { ok: true });
  }

  case 'onboarding.save': {
    const cur = readOnboarding(user);
    const pick = (v, list) => (list.includes(String(v)) ? String(v) : undefined);
    const next = Object.assign({}, cur, {
      channel: pick(p.channel, ['instagram', 'tiktok', 'explore']) ?? cur.channel,
      for_whom: pick(p.for_whom, ['employer', 'myself', 'client']) ?? cur.for_whom,
      heard_from: Array.isArray(p.heard_from) ? p.heard_from.map(String).filter(x => /^[a-z_]{2,20}$/.test(x)).slice(0, 8) : cur.heard_from,
      step: pick(p.step, ['channel', 'about', 'source', 'plan', 'done']) ?? cur.step,
    });
    if (p.done === true) { next.done = true; next.step = 'done'; next.done_at = new Date().toISOString(); }
    const fields = { onboarding: JSON.stringify(next) };
    return saveUser(fields, { ok: true, user: publicUser(userRow(user, fields)) });
  }

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
      customerId: 'W' + gid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40), customerName: String(user.name || user.email || 'Pelanggan').slice(0, 50),
    });
    if (!r.ok) return fail('Gagal membuat pembayaran: ' + r.error);
    return reply('payment_insert', { ok: true, redirect_url: r.url }, { payment: {
      order_id: orderId, account_id: gid, plan: target.id, amount: charge.total, status: 'pending',
      payment_type: method, kind: pack ? 'topup' : 'checkout', credits: pack ? pack.credits : 0, gateway: PAY_GATEWAY,
      transaction_id: r.session, pay_url: r.url, // disimpan agar pembayaran pending bisa dilanjutkan dari riwayat
      paid_at: null, fee: 0, note: (charge.surcharge ? 'harga ' + price + ' + biaya ' + charge.surcharge : ''),
    } });
  }

  case 'auth.logout':
    return reply('logout', { ok: true }, { token: session.token });

  case 'settings.save': {
    if (!acc) return needIg();
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
    if (!acc) return needIg();
    const me = await ig('GET', '/me', { fields: 'user_id,username,name,profile_picture_url,followers_count,media_count' });
    if (!me.ok) return fail('Koneksi Instagram bermasalah: ' + me.error + '. Coba masuk ulang dengan Instagram.');
    const subs = await ig('GET', '/me/subscribed_apps');
    return updateAccount(
      { username: me.body.username || acc.username, name: me.body.name || acc.name, avatar: me.body.profile_picture_url || acc.avatar },
      { ok: true, profile: me.body, subscriptions: subs.ok ? subs.body.data || [] : null },
    );
  }

  case 'ig.media': {
    if (!acc) return needIg();
    const r = await ig('GET', '/me/media', {
      fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count',
      limit: Math.min(Number(p.limit) || 30, 50),
    });
    if (!r.ok) return fail(r.error);
    return reply('direct', { ok: true, media: r.body.data || [] });
  }

  case 'ig.subscribe': {
    if (!acc) return needIg();
    const r = await ig('POST', '/me/subscribed_apps', { subscribed_fields: 'comments,messages,messaging_postbacks' });
    if (!r.ok) return fail(r.error);
    return reply('direct', { ok: true });
  }

  case 'rules.list':
    return reply('direct', { ok: true, rules: isTt ? ttRules : myRules });

  case 'rules.save': {
    if (isTt) return saveTtRule(p.rule || {});
    if (!acc) return needIg();
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
      hide_comment: false,
    } }];
  }

  case 'rules.delete':
    if (!(Number(p.id) > 0)) return fail('id tidak valid');
    if (isTt) {
      if (!tt) return fail('Hubungkan akun TikTok dulu.', 409);
      return reply('rules_delete', null, { row_id: Number(p.id), account_id: String(tt.open_id) });
    }
    if (!acc) return needIg();
    return reply('rules_delete', null, { row_id: Number(p.id) });

  case 'accounts.list':
    return reply('direct', { ok: true, accounts: listAccounts(), limit: accountsLimit, plan: plan.name });

  case 'accounts.switch': {
    // Pindah dasbor ke akun sosial lain milik user (sesi tetap; ig_user_id / tt_open_id sesi diganti)
    const id = String(p.id || p.ig_user_id || '');
    if (p.type === 'tiktok') {
      const t = ttRows.find(a => String(a.open_id) === id);
      if (!t) return fail('Akun TikTok tidak ditemukan', 404);
      return switchSession({ ok: true }, acc && acc.ig_user_id, t.open_id);
    }
    const target = members.find(a => String(a.ig_user_id) === id);
    if (!target) return fail('Akun Instagram tidak ditemukan', 404);
    return switchSession({ ok: true }, target.ig_user_id, tt && tt.open_id);
  }

  case 'accounts.unlink': {
    // Lepas akun sosial dari akun Wanychat: token dihapus (automasi berhenti), owner_id "unlinked" = bisa ditautkan lagi
    const id = String(p.id || p.ig_user_id || '');
    if (p.type === 'tiktok') {
      const t = ttRows.find(a => String(a.open_id) === id);
      if (!t) return fail('Akun TikTok tidak ditemukan', 404);
      await ttRevoke(t.access_token); // gagal revoke tetap dilepas; izin bisa dicabut user dari aplikasi TikTok
      // Rule & log akun ini ikut dihapus: bila akun TikTok ini nanti ditautkan akun Wanychat lain, data pemilik lama tidak terbawa
      return reply('tt_unlink', { ok: true }, { tt: ttRow(t, { owner_id: 'unlinked', access_token: '', refresh_token: '', token_refresh_error: '' }) });
    }
    const target = members.find(a => String(a.ig_user_id) === id);
    if (!target) return fail('Akun Instagram tidak ditemukan', 404);
    try {
      await helpers.httpRequest({ method: 'DELETE', url: G + '/me/subscribed_apps', qs: { access_token: target.access_token }, json: true, ignoreHttpStatusErrors: true, timeout: 15000 });
    } catch (e) { /* tetap dilepas */ }
    return reply('account_unlink', { ok: true }, { target: id });
  }

  case 'tiktok.status': {
    if (!tt) return reply('direct', { ok: true, connected: false, ready: ttReady() });
    const token = await ttToken();
    const r = await ttProfile(tt.open_id, token);
    return ttRespond({ ok: true, connected: true, ready: true, account: ttPublic(ttUpdate || tt), profile: r.ok ? r.data : null, profile_error: r.ok ? '' : r.error,
      active: ttActiveInGroup(tt, members, ttRows, plan), rules_used: ttRules.length });
  }

  case 'tiktok.videos': {
    if (!tt) return fail('Hubungkan akun TikTok dulu.', 409);
    const r = await ttVideos(tt.open_id, await ttToken(), p.cursor ? String(p.cursor) : '');
    if (!r.ok) return ttFail(r);
    return ttRespond({ ok: true, videos: r.data.videos || [], cursor: r.data.cursor || '', has_more: !!r.data.has_more });
  }

  case 'tiktok.comments': {
    if (!tt) return fail('Hubungkan akun TikTok dulu.', 409);
    const vid = String(p.video_id || '');
    if (!/^\d{5,30}$/.test(vid)) return fail('video_id tidak valid');
    const r = await ttComments(tt.open_id, await ttToken(), vid, p.cursor ? String(p.cursor) : '');
    if (!r.ok) return ttFail(r);
    return ttRespond({ ok: true, comments: r.data.comments || [], cursor: r.data.cursor || '', has_more: !!r.data.has_more });
  }

  case 'tiktok.reply': {
    if (!tt) return fail('Hubungkan akun TikTok dulu.', 409);
    const text = String(p.text || '').trim().slice(0, 150);
    if (!text) return fail('Tulis balasan dulu');
    if (!/^\d{5,30}$/.test(String(p.video_id || '')) || !/^\d{5,30}$/.test(String(p.comment_id || ''))) return fail('Komentar tidak valid');
    const r = await ttReplyComment(tt.open_id, await ttToken(), String(p.video_id), String(p.comment_id), text);
    if (!r.ok) return ttFail(r);
    return ttRespond({ ok: true, reply: r.data });
  }

  case 'tiktok.hide': {
    if (!tt) return fail('Hubungkan akun TikTok dulu.', 409);
    if (!/^\d{5,30}$/.test(String(p.video_id || '')) || !/^\d{5,30}$/.test(String(p.comment_id || ''))) return fail('Komentar tidak valid');
    const r = await ttHide(tt.open_id, await ttToken(), String(p.video_id), String(p.comment_id), p.hide !== false);
    if (!r.ok) return ttFail(r);
    return ttRespond({ ok: true });
  }

  case 'analytics.get': {
    if (!acc) return needIg();
    if (!plan.analytics) return fail('Dasbor analitik tersedia di paket Bisnis. Upgrade di menu Langganan.', 403);
    const days = [7, 30, 90].includes(Number(p.days)) ? Number(p.days) : 30;
    return reply('analytics', null, { days });
  }

  case 'events.list':
    if (isTt) return tt ? reply('events_list', null, { limit: Math.min(Number(p.limit) || 200, 500), account_id: String(tt.open_id) })
      : reply('direct', { ok: true, events: [] });
    if (!acc) return reply('direct', { ok: true, events: [] });
    return reply('events_list', null, { limit: Math.min(Number(p.limit) || 200, 500) });

  case 'followups.list':
    if (!acc) return reply('direct', { ok: true, followups: [] });
    return reply('followups_list', null);

  case 'logs.clear':
    if (isTt) return tt ? reply('logs_clear', null, { account_id: String(tt.open_id) }) : reply('direct', { ok: true });
    if (!acc) return reply('direct', { ok: true });
    return reply('logs_clear', null);

  default:
    return fail('Aksi tidak dikenal: ' + action);
}

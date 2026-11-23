// Callback Instagram: tukar code -> token jangka panjang, ambil profil, langganan webhook otomatis, lalu tautkan akun
// ke akun Wanychat yang sedang login (grup langganan = users.group_id).
// Akun IG yang sudah ada di database dari sistem lama (login IG, belum punya akun Wanychat) ikut diklaim:
//  - grup user masih kosong -> user mengambil alih grup lama (rules, log, paket, kredit ikut tanpa migrasi baris)
//  - grup user sudah berisi -> akun-akun grup lama dipindah ke grup user (hanya jika grup lama tanpa paket/kredit aktif)
//#include lib_plans.js
//#include lib_user.js
const helpers = this.helpers;
const req = $('Webhook Login Callback').first().json;
const q = req.query || {};
const cookies = parseCookies((req.headers || {}).cookie);
const s = {};
for (const it of $('Baca Settings Callback').all()) if (it.json.key) s[it.json.key] = it.json.value ?? '';
const base = String(s.public_url || '').replace(/\/$/, '');
const G = 'https://graph.instagram.com/' + (s.graph_version || 'v23.0');
const onboarding = String(cookies.wany_state || q.state || '').endsWith('-ob');
const back = base + '/#/' + (onboarding ? 'onboarding' : 'settings');
const fail = (msg) => [{ json: { ok: false, location: back + '?error=' + encodeURIComponent(String(msg).slice(0, 200)) } }];

if (q.error) return fail(q.error_description || q.error_reason || 'Izin Instagram dibatalkan');
if (!q.code) return fail('Kode izin Instagram tidak ditemukan, coba lagi.');
if (!q.state || !cookies.wany_state || !safeEqual(q.state, cookies.wany_state)) return fail('Sesi menghubungkan Instagram kedaluwarsa, silakan coba lagi.');

const sess = $('Cari Sesi Callback').first().json;
const sessOk = !!(sess && sess.token && sess.user_id && (!sess.expires_at || new Date(sess.expires_at) > new Date()));
const user = sessOk ? latestRow($('Baca User Callback').all().map(i => i.json), 'uid', sess.user_id) : null;
if (!user) return fail('Masuk dulu ke akun Wanychat, lalu hubungkan Instagram.');
const gid = String(user.group_id || user.uid);

async function call(opts) {
  const res = await helpers.httpRequest(Object.assign({ ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000 }, opts));
  let b = res.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = { raw: b }; } }
  b = b || {};
  const err = res.statusCode >= 400 || b.error || b.error_message;
  return { ok: !err, body: b, error: err ? ((b.error && (b.error.message || b.error)) || b.error_message || ('HTTP ' + res.statusCode)) : '' };
}

// 1. code -> token jangka pendek
const form = {
  client_id: s.ig_app_id, client_secret: s.app_secret, grant_type: 'authorization_code',
  redirect_uri: base + '/webhook/wany-oauth', code: String(q.code).replace(/#_$/, ''),
};
const short = await call({
  method: 'POST', url: 'https://api.instagram.com/oauth/access_token',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: Object.keys(form).map(k => k + '=' + encodeURIComponent(form[k])).join('&'),
});
if (!short.ok) return fail('Gagal menukar kode: ' + short.error);
const sb = Array.isArray(short.body.data) ? short.body.data[0] : short.body;

// 2. token jangka panjang (60 hari)
const long = await call({ method: 'GET', url: 'https://graph.instagram.com/access_token', qs: { grant_type: 'ig_exchange_token', client_secret: s.app_secret, access_token: sb.access_token }, json: true });
if (!long.ok) return fail('Gagal membuat token jangka panjang: ' + long.error);
const token = long.body.access_token;

// 3. profil
const me = await call({ method: 'GET', url: G + '/me', qs: { fields: 'user_id,username,name,profile_picture_url,account_type', access_token: token }, json: true });
if (!me.ok) return fail('Gagal membaca profil: ' + me.error);
const igId = String(me.body.user_id || sb.user_id || me.body.id);
const handle = '@' + (me.body.username || igId);

// 4. klaim / tautkan
const all = $('Baca Akun Callback').all().map(i => i.json).filter(a => a.ig_user_id);
const users = $('Baca Semua User Callback').all().map(i => i.json).filter(u => u && u.uid);
const billingBy = latestBy($('Baca Billing Callback').all().map(i => i.json), 'account_id');
const creditsBy = latestBy($('Baca Kredit Callback').all().map(i => i.json), 'account_id');
const ttMine = $('Baca TikTok Callback').all().map(i => i.json).filter(a => a && a.open_id && String(a.owner_id) === gid);
const plans = loadPlans(s);
const existing = all.find(a => String(a.ig_user_id) === igId);
const groupHas = (g) => all.some(a => groupOf(a) === g && a.access_token) ;
const paid = (g) => effectivePlan(billingBy[g], plans).id !== 'free' || creditBalance(creditsBy[g]) > 0;
const userEmpty = !groupHas(gid) && !ttMine.length && !paid(gid);

let finalGroup = gid;
let ownerId = gid;
let repoint = [];
let adopt = false;
if (existing && existing.owner_id !== 'unlinked') {
  const ga = groupOf(existing);
  if (ga === gid) {
    ownerId = existing.owner_id || ''; // hubungkan ulang akun yang sudah milik user (pemilik grup lama: owner_id kosong)
  } else {
    const claimedBy = users.find(u => String(u.group_id || u.uid) === ga && String(u.uid) !== String(user.uid));
    if (claimedBy) return fail('Akun Instagram ' + handle + ' sudah terhubung ke akun Wanychat lain.');
    if (userEmpty) {
      adopt = true; finalGroup = ga; ownerId = existing.owner_id || '';
    } else {
      if (paid(ga)) return fail(handle + ' punya paket atau kredit aktif dari sistem lama. Hubungi admin Wanychat untuk menggabungkannya.');
      repoint = all.filter(a => groupOf(a) === ga && String(a.ig_user_id) !== igId).map(a => String(a.ig_user_id));
    }
  }
}

const finalBill = billingBy[finalGroup];
if (finalBill && isTrue(finalBill.suspended)) return fail('Akun ini dinonaktifkan. Hubungi admin Wanychat.');
if (!adopt && !(existing && groupOf(existing) === gid && existing.owner_id !== 'unlinked')) {
  const plan = effectivePlan(billingBy[gid], plans);
  const max = Math.max(1, Number(plan.accounts) || 1);
  const used = all.filter(a => groupOf(a) === gid && a.access_token && String(a.ig_user_id) !== igId).length + ttMine.length;
  if (used + 1 + repoint.length > max) return fail('Paket ' + plan.name + ' maksimal ' + max + ' akun sosial. Upgrade di menu Langganan.');
}

// 5. langganan webhook komentar & DM (tidak perlu disetel manual)
const sub = await call({ method: 'POST', url: G + '/me/subscribed_apps', qs: { subscribed_fields: 'comments,messages,messaging_postbacks', access_token: token }, json: true });
const warn = sub.ok ? '' : '&warn=' + encodeURIComponent('Webhook belum berlangganan: ' + sub.error);
return [{ json: {
  ok: true,
  location: back + (onboarding ? '?step=about&connected=instagram' : '?linked=instagram') + warn + (adopt ? '&claimed=1' : ''),
  user: userRow(user, { group_id: finalGroup }),
  repoint: repoint.map(id => ({ ig_user_id: id, owner_id: gid })),
  account: {
    ig_user_id: igId,
    username: me.body.username || '',
    name: me.body.name || '',
    avatar: me.body.profile_picture_url || '',
    access_token: token,
    token_expires_at: new Date(Date.now() + Number(long.body.expires_in || 5184000) * 1000).toISOString(),
    token_refresh_error: '',
    ai_enabled: existing ? existing.ai_enabled !== false : true,
    ai_persona: existing && existing.ai_persona ? existing.ai_persona : (s.gemini_persona || ''),
    connected_at: existing && existing.connected_at && existing.owner_id !== 'unlinked' ? existing.connected_at : new Date().toISOString(),
    owner_id: ownerId,
  },
} }];

// Callback login Instagram: tukar code -> token jangka panjang, ambil profil, langganan webhook otomatis
const helpers = this.helpers;
const req = $('Webhook Login Callback').first().json;
const q = req.query || {};
const cookies = {};
for (const part of String((req.headers || {}).cookie || '').split(';')) {
  const i = part.indexOf('=');
  if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
}
const s = {};
for (const it of $('Baca Settings Callback').all()) if (it.json.key) s[it.json.key] = it.json.value ?? '';
const base = String(s.public_url || '').replace(/\/$/, '');
const G = 'https://graph.instagram.com/' + (s.graph_version || 'v23.0');
const fail = (msg) => [{ json: { ok: false, location: base + '/#/login?error=' + encodeURIComponent(msg) } }];

if (q.error) return fail(q.error_description || q.error_reason || 'Login dibatalkan');
if (!q.code) return fail('Kode login tidak ditemukan, coba lagi.');
if (!q.state || q.state !== cookies.wany_state) return fail('Sesi login kedaluwarsa, silakan coba lagi.');

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

// 4. langganan webhook komentar & DM (tidak perlu disetel manual)
const sub = await call({ method: 'POST', url: G + '/me/subscribed_apps', qs: { subscribed_fields: 'comments,messages,messaging_postbacks', access_token: token }, json: true });

const existing = $('Baca Akun Callback').all().map(i => i.json).find(a => String(a.ig_user_id) === igId);
return [{ json: {
  ok: true,
  location: base + '/#/dashboard' + (sub.ok ? '' : '?warn=' + encodeURIComponent('Webhook belum berlangganan: ' + sub.error)),
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
    connected_at: new Date().toISOString(),
  },
} }];

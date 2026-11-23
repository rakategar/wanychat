// Callback Google tahap 1: cek state, tukar code -> token, baca profil (sub, email, email_verified, nama, foto)
//#include lib_user.js
const helpers = this.helpers;
const req = $('Webhook Google Callback').first().json;
const q = req.query || {};
const s = {};
for (const it of $('Baca Settings Google Callback').all()) if (it.json.key) s[it.json.key] = it.json.value ?? '';
const base = String(s.public_url || '').replace(/\/$/, '');
const fail = (msg) => [{ json: { ok: false, location: base + '/#/login?error=' + encodeURIComponent(String(msg).slice(0, 200)) } }];

if (q.error) return fail(q.error === 'access_denied' ? 'Login Google dibatalkan.' : 'Login Google gagal: ' + q.error);
const cookies = parseCookies((req.headers || {}).cookie);
if (!q.state || !cookies.wany_gstate || !safeEqual(q.state, cookies.wany_gstate)) return fail('Sesi login kedaluwarsa, silakan coba lagi.');
if (!q.code) return fail('Kode login tidak ditemukan, coba lagi.');
if (!s.google_client_id || !s.google_client_secret) return fail('Login Google belum diaktifkan admin.');

async function call(opts) {
  const res = await helpers.httpRequest(Object.assign({ ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000, json: true }, opts));
  let b = res.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = { raw: b }; } }
  b = b || {};
  return { ok: res.statusCode < 400 && !b.error, body: b, error: b.error_description || b.error || ('HTTP ' + res.statusCode) };
}
const form = { code: String(q.code), client_id: s.google_client_id, client_secret: s.google_client_secret,
  redirect_uri: base + '/webhook/wany-google-cb', grant_type: 'authorization_code' };
const tok = await call({ method: 'POST', url: 'https://oauth2.googleapis.com/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: Object.keys(form).map(k => k + '=' + encodeURIComponent(form[k])).join('&'), json: false });
if (!tok.ok || !tok.body.access_token) return fail('Gagal masuk dengan Google: ' + tok.error);
const me = await call({ method: 'GET', url: 'https://openidconnect.googleapis.com/v1/userinfo', headers: { authorization: 'Bearer ' + tok.body.access_token } });
if (!me.ok || !me.body.sub) return fail('Gagal membaca profil Google: ' + me.error);
if (me.body.email_verified !== true && me.body.email_verified !== 'true') return fail('Email Google belum terverifikasi.');
return [{ json: { ok: true, google: {
  sub: String(me.body.sub), email: normEmail(me.body.email), name: String(me.body.name || '').slice(0, 80), avatar: String(me.body.picture || '').slice(0, 500),
} } }];

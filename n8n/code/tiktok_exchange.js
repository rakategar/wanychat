// Callback TikTok tahap 1: cek state, tukar auth code -> token, baca profil akun
//#include lib_user.js
const helpers = this.helpers;
const req = $('Webhook TikTok Callback').first().json;
const q = req.query || {};
const settings = {};
for (const it of $('Baca Settings TikTok').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_tiktok.js
const base = String(settings.public_url || '').replace(/\/$/, '');
const cookies = parseCookies((req.headers || {}).cookie);
const st = String(cookies.wany_tstate || q.state || '');
const onboarding = st.endsWith('-ob');
const publish = st.endsWith('-pub');
const back = base + '/#/' + (onboarding ? 'onboarding' : publish ? 'posting' : 'tiktok');
const fail = (msg) => [{ json: { ok: false, location: back + '?error=' + encodeURIComponent(String(msg).slice(0, 200)) } }];

if (q.error) return fail(q.error === 'access_denied' ? 'Izin TikTok dibatalkan.' : 'TikTok: ' + (q.error_description || q.error));
if (!q.state || !cookies.wany_tstate || !safeEqual(q.state, cookies.wany_tstate)) return fail('Sesi menghubungkan TikTok kedaluwarsa, silakan coba lagi.');
const code = String(q.code || q.auth_code || '');
if (!code) return fail('Kode izin TikTok tidak ditemukan, coba lagi.');
if (!ttReady()) return fail('Koneksi TikTok belum diaktifkan admin.');

const tok = await ttExchange(code);
if (!tok.ok || !tok.data.access_token) return fail('Gagal menghubungkan TikTok: ' + (tok.error || 'token kosong'));
const openId = String(tok.data.open_id || '');
if (!openId) return fail('TikTok tidak mengirim ID akun.');
const prof = await ttProfile(openId, tok.data.access_token);
const pd = prof.ok ? prof.data || {} : {};
return [{ json: { ok: true, onboarding, back, open_id: openId, scope: tok.data.scope || '',
  account: ttRow(null, Object.assign({ open_id: openId, username: String(pd.username || ''), display_name: String(pd.display_name || ''),
    avatar: String(pd.profile_image || '').slice(0, 1000), scope: String(tok.data.scope || '').slice(0, 1000) }, ttTokenFields(tok.data))),
  profile_error: prof.ok ? '' : prof.error } }];

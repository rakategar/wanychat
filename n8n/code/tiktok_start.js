// Mulai hubungkan TikTok: arahkan ke halaman izin TikTok (Accounts API), simpan state anti-CSRF di cookie.
// ?from=onboarding -> state berakhiran "-ob" supaya callback kembali ke onboarding.
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings TikTok Start').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_tiktok.js
const base = String(settings.public_url || '').replace(/\/$/, '');
const from = String((($('Webhook TikTok Start').first().json.query) || {}).from || '');
const state = $input.first().json.state + (from === 'onboarding' ? '-ob' : '');
if (!ttReady()) {
  return [{ json: { location: base + '/#/' + (from === 'onboarding' ? 'onboarding' : 'tiktok') + '?error=' + encodeURIComponent('Koneksi TikTok belum diaktifkan admin.'), cookie: 'wany_tstate=; Path=/webhook; Max-Age=0' } }];
}
const params = { client_key: settings.tiktok_app_id, scope: TT_SCOPES, response_type: 'code', redirect_uri: ttRedirect(), state };
return [{ json: {
  location: 'https://www.tiktok.com/v2/auth/authorize?' + Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&'),
  cookie: 'wany_tstate=' + state + '; Path=/webhook; HttpOnly; Secure; SameSite=Lax; Max-Age=900',
} }];

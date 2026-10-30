// Mulai login Instagram: arahkan ke halaman izin Instagram, simpan state anti-CSRF di cookie
const s = {};
for (const it of $('Baca Settings Login').all()) if (it.json.key) s[it.json.key] = it.json.value ?? '';
const base = String(s.public_url || '').replace(/\/$/, '');
const state = $input.first().json.state;
if (!s.ig_app_id) {
  return [{ json: { location: base + '/#/login?error=' + encodeURIComponent('Login Instagram belum diaktifkan (Instagram App ID belum diisi admin).'), cookie: 'wany_state=; Path=/webhook; Max-Age=0' } }];
}
const params = {
  enable_fb_login: '0',
  force_authentication: '1',
  client_id: s.ig_app_id,
  redirect_uri: base + '/webhook/wany-oauth',
  response_type: 'code',
  scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
  state,
};
const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
return [{ json: {
  location: 'https://www.instagram.com/oauth/authorize?' + qs,
  cookie: 'wany_state=' + state + '; Path=/webhook; HttpOnly; Secure; SameSite=Lax; Max-Age=900',
} }];

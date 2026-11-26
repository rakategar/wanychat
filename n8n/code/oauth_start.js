// Tautkan Instagram ke akun Wanychat yang sedang login: arahkan ke halaman izin Instagram, simpan state anti-CSRF.
// ?from=onboarding -> state berakhiran "-ob" supaya callback kembali ke onboarding.
const s = {};
for (const it of $('Baca Settings Login').all()) if (it.json.key) s[it.json.key] = it.json.value ?? '';
const base = String(s.public_url || '').replace(/\/$/, '');
const q = ($('Webhook Login').first().json.query) || {};
const from = String(q.from || '');
const publish = String(q.publish || '') === '1';
// -ob = kembali ke onboarding, -pub = izin posting (kembali ke halaman Posting)
const state = $input.first().json.state + (from === 'onboarding' ? '-ob' : publish ? '-pub' : '');
if (!s.ig_app_id) {
  return [{ json: { location: base + '/#/' + (from === 'onboarding' ? 'onboarding' : publish ? 'posting' : 'settings') + '?error=' + encodeURIComponent('Koneksi Instagram belum diaktifkan admin.'), cookie: 'wany_state=; Path=/webhook; Max-Age=0' } }];
}
const params = {
  enable_fb_login: '0',
  force_authentication: '1',
  client_id: s.ig_app_id,
  redirect_uri: base + '/webhook/wany-oauth',
  response_type: 'code',
  // instagram_business_content_publish hanya diminta lewat tombol "Izinkan posting" (butuh App Review terpisah)
  scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments' + (publish ? ',instagram_business_content_publish' : ''),
  state,
};
const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
return [{ json: {
  location: 'https://www.instagram.com/oauth/authorize?' + qs,
  cookie: 'wany_state=' + state + '; Path=/webhook; HttpOnly; Secure; SameSite=Lax; Max-Age=900',
} }];

// Mulai "Lanjut dengan Google": arahkan ke halaman izin Google, simpan state anti-CSRF di cookie
const s = {};
for (const it of $('Baca Settings Google').all()) if (it.json.key) s[it.json.key] = it.json.value ?? '';
const base = String(s.public_url || '').replace(/\/$/, '');
const state = $input.first().json.state;
if (!s.google_client_id) {
  return [{ json: { location: base + '/#/login?error=' + encodeURIComponent('Login Google belum diaktifkan admin.'), cookie: 'wany_gstate=; Path=/webhook; Max-Age=0' } }];
}
const params = {
  client_id: s.google_client_id,
  redirect_uri: base + '/webhook/wany-google-cb',
  response_type: 'code',
  scope: 'openid email profile',
  state,
  prompt: 'select_account',
};
return [{ json: {
  location: 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&'),
  cookie: 'wany_gstate=' + state + '; Path=/webhook; HttpOnly; Secure; SameSite=Lax; Max-Age=900',
} }];

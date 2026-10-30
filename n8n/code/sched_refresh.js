// Perpanjang long-lived token (berlaku 60 hari) semua akun yang login, sebelum kedaluwarsa
const helpers = this.helpers;
const out = [];
for (const it of $('Baca Akun Token').all()) {
  const a = it.json;
  if (!a.ig_user_id || !a.access_token) continue;
  const exp = a.token_expires_at ? new Date(a.token_expires_at).getTime() : 0;
  if (exp && exp - Date.now() > 10 * 24 * 3600 * 1000) continue;
  const res = await helpers.httpRequest({
    method: 'GET', url: 'https://graph.instagram.com/refresh_access_token',
    qs: { grant_type: 'ig_refresh_token', access_token: a.access_token },
    json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
  });
  const b = res.body || {};
  if (res.statusCode >= 400 || !b.access_token) {
    out.push({ json: { ig_user_id: a.ig_user_id, access_token: a.access_token, token_expires_at: a.token_expires_at || null, token_refresh_error: (b.error && b.error.message) || ('HTTP ' + res.statusCode) } });
  } else {
    out.push({ json: { ig_user_id: a.ig_user_id, access_token: b.access_token, token_expires_at: new Date(Date.now() + Number(b.expires_in || 0) * 1000).toISOString(), token_refresh_error: '' } });
  }
}
return out;

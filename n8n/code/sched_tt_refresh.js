// Perpanjang token TikTok semua akun terhubung (akses 24 jam, refresh token diperbarui sekalian)
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings TikTok Token').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_tiktok.js
if (!ttReady()) return [];
const out = [];
for (const it of $input.all()) {
  const a = it.json;
  if (!a.open_id || !a.refresh_token || !a.owner_id || a.owner_id === 'unlinked') continue;
  const r = await ttRefresh(a.refresh_token);
  out.push({ json: r.ok && r.data.access_token ? ttRow(a, ttTokenFields(r.data)) : ttRow(a, { token_refresh_error: 'Refresh gagal: ' + r.error }) });
}
return out;

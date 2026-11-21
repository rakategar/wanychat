// Putar ulang event webhook Instagram yang tidak selesai diproses (n8n crash / restart di tengah eksekusi).
// Event dikirim lagi ke webhook Engine lewat jaringan lokal dengan tanda tangan asli Meta, jadi Engine
// tetap memverifikasinya seperti event biasa. Maksimal 3 kali, setelah itu ditandai gagal dan dicatat di log.
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings Inbox').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const url = settings.engine_internal_url || 'http://127.0.0.1:5678/webhook/wany-ig';
const WAIT_MS = 120000; // eksekusi normal (termasuk AI) selesai jauh di bawah ini
const out = [];

for (const it of $input.all()) {
  const r = it.json;
  if (!r.id || r.status !== 'new' || r.key === 'invalid') continue;
  if (Date.now() - new Date(r.updatedAt || r.createdAt).getTime() < WAIT_MS) continue;
  const tries = Number(r.tries) || 0;
  let account = '';
  try { account = String(((JSON.parse(r.raw).entry || [])[0] || {}).id || ''); } catch (e) { /* raw rusak */ }
  if (tries >= 3) {
    out.push({ json: { kind: 'update', key: r.key, status: 'failed', tries, error: 'gagal diproses 3x' } });
    out.push({ json: { kind: 'log', account_id: account, type: 'system', status: 'error', rule_id: '', rule_name: '', ig_user_id: '',
      username: '', ref_id: r.key.slice(0, 16), media_id: '', text: '', error: 'Event Instagram tidak bisa diproses setelah 3x percobaan ulang' } });
    continue;
  }
  let error = '';
  try {
    await helpers.httpRequest({ method: 'POST', url, body: r.raw, json: false, timeout: 15000,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': r.signature, 'x-wany-replay': '1' } });
  } catch (e) { error = String(e.message || e).slice(0, 300); }
  out.push({ json: { kind: 'update', key: r.key, status: 'new', tries: tries + 1, error } });
}
return out;

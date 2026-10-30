// Kirim jawaban AI (DeepSeek) sebagai balasan komentar, lalu catat ke log
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const accounts = {};
for (const it of $('Baca Akun').all()) if (it.json.ig_user_id) accounts[String(it.json.ig_user_id)] = it.json;
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');
const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const src = $('Rute Aksi').itemMatching(i).json;
  let answer = String($input.all()[i].json.text || '').trim().replace(/^["']|["']$/g, '');
  const base = {
    kind: 'log', account_id: src.account_id, rule_id: src.rule_id, rule_name: src.rule_name, ig_user_id: src.ig_user_id,
    username: src.username, ref_id: src.comment_id, media_id: src.media_id,
  };
  const llmError = $input.all()[i].json.error;
  if (llmError) {
    out.push({ json: Object.assign({}, base, { type: 'ai_reply', status: 'error', text: '', error: 'AI gagal: ' + String(llmError.message || llmError).slice(0, 400) }) });
    continue;
  }
  if (!answer || /^skip\b/i.test(answer)) {
    out.push({ json: Object.assign({}, base, { type: 'ai_reply', status: 'skipped', text: 'AI memilih tidak membalas', error: '' }) });
    continue;
  }
  answer = answer.slice(0, 2000);
  let ok = false;
  let error = '';
  try {
    const res = await helpers.httpRequest({
      method: 'POST', url: G + '/' + src.comment_id + '/replies',
      qs: { access_token: (accounts[src.account_id] || {}).access_token || '' }, body: { message: answer },
      json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
    });
    const b = res.body || {};
    ok = res.statusCode < 400 && !b.error;
    if (!ok) error = (b.error && b.error.message) || ('HTTP ' + res.statusCode);
  } catch (err) {
    error = err.message;
  }
  out.push({ json: Object.assign({}, base, { type: 'ai_reply', status: ok ? 'ok' : 'error', text: answer, error }) });
}
return out;

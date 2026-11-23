// Kirim jawaban AI (DeepSeek) sebagai balasan komentar TikTok (maks 150 karakter), lalu catat ke log
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_tiktok.js
// Token terbaru: hasil refresh di putaran ini (item kind "token") menang atas baris tabel
const tokens = {};
for (const it of $('Baca Akun TikTok').all()) if (it.json.open_id) tokens[String(it.json.open_id)] = it.json.access_token || '';
for (const it of $('Proses TikTok').all()) if (it.json.kind === 'token' && it.json.tt && it.json.tt.access_token) tokens[String(it.json.tt.open_id)] = it.json.tt.access_token;
const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const src = $('Rute TikTok').itemMatching(i).json;
  let answer = String($input.all()[i].json.text || '').trim().replace(/^["']|["']$/g, '');
  const base = {
    kind: 'log', account_id: src.account_id, rule_id: src.rule_id, rule_name: src.rule_name, ig_user_id: src.ig_user_id,
    username: src.username, ref_id: src.comment_id, media_id: src.video_id,
  };
  const llmError = $input.all()[i].json.error;
  if (llmError) {
    out.push({ json: Object.assign({}, base, { type: 'tt_ai_reply', status: 'error', text: '', error: 'AI gagal: ' + String(llmError.message || llmError).slice(0, 400) }) });
    continue;
  }
  if (!answer || /^skip\b/i.test(answer)) {
    out.push({ json: Object.assign({}, base, { type: 'tt_ai_reply', status: 'skipped', text: 'AI memilih tidak membalas', error: '' }) });
    continue;
  }
  // Batas komentar TikTok 150 karakter: potong di batas kata terakhir
  if (answer.length > 150) answer = answer.slice(0, 150).replace(/\s+\S*$/, '').trim() || answer.slice(0, 150);
  const r = await ttReplyComment(src.account_id, tokens[String(src.account_id)] || '', src.video_id, src.comment_id, answer);
  out.push({ json: Object.assign({}, base, { type: 'tt_ai_reply', status: r.ok ? 'ok' : 'error', text: answer, error: r.ok ? '' : r.error }) });
}
return out;

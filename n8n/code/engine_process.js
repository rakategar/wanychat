// Proses event webhook Instagram: cocokkan rule, balas komentar, kirim private reply / DM.
// Panggilan Graph API dilakukan di sini (this.helpers.httpRequest) supaya urutan & fallback mudah diatur.
const helpers = this.helpers;
const body = $('Webhook IG Event').first().json.body || {};

const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const accounts = {};
for (const it of $('Baca Akun').all()) if (it.json.ig_user_id) accounts[String(it.json.ig_user_id)] = it.json;
const everyRule = $('Baca Rules').all().map(i => i.json).filter(r => r.id);
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');
const out = [];

// Diisi per entry (setiap entry = satu akun Instagram yang login)
let token = '';
let igId = '';
let allRules = [];
let rules = [];
let account = {};

// Dedupe: Meta bisa mengirim event yang sama lebih dari sekali
const sd = $getWorkflowStaticData('global');
if (!Array.isArray(sd.seen)) sd.seen = [];
const seen = (id) => {
  if (sd.seen.includes(id)) return true;
  sd.seen.push(id);
  if (sd.seen.length > 2000) sd.seen = sd.seen.slice(-1500);
  return false;
};

const log = (e) => out.push({ json: {
  kind: 'log',
  account_id: igId,
  type: e.type,
  status: e.status || 'ok',
  rule_id: e.rule ? String(e.rule.id) : '',
  rule_name: e.rule ? String(e.rule.name || '') : '',
  ig_user_id: e.uid || '',
  username: e.username || '',
  ref_id: e.ref || '',
  media_id: e.media || '',
  text: String(e.text || '').slice(0, 1000),
  error: e.error ? String(e.error).slice(0, 500) : '',
} });

async function ig(method, path, payload, qs) {
  if (!token) return { ok: false, error: 'access_token belum diset di Pengaturan' };
  try {
    const res = await helpers.httpRequest({
      method, url: G + path, qs: Object.assign({}, qs || {}, { access_token: token }),
      body: payload, json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
    });
    const b = res.body || {};
    if (res.statusCode >= 400 || b.error) return { ok: false, error: (b.error && b.error.message) || ('HTTP ' + res.statusCode), body: b };
    return { ok: true, body: b };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
const words = (s) => String(s || '').split(/[,\n]/).map(norm).filter(Boolean);
const lines = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fill = (tpl, username) => String(tpl || '')
  .replace(/\{username\}/gi, username ? '@' + username : 'kak')
  .replace(/\{nama\}/gi, username || 'kak');

function postMatch(r, mediaId) {
  const ids = String(r.post_ids || '*').split(/[,\s]+/).filter(Boolean);
  return !ids.length || ids.includes('*') || ids.includes(String(mediaId));
}
function kwMatch(r, text) {
  const mode = r.match_mode || 'contains';
  if (mode === 'any') return true;
  const t = norm(text);
  const kws = words(r.keywords);
  if (!kws.length) return false;
  if (mode === 'exact') return kws.some(k => t === k);
  return kws.some(k => t.includes(k));
}
function buttonFor(rule) {
  if (!rule.dm_button_title || !rule.dm_content) return undefined;
  return [{ content_type: 'text', title: String(rule.dm_button_title).slice(0, 20), payload: 'RULE:' + rule.id }];
}

// Private reply = DM pertama ke orang yang komentar (tidak perlu dia DM duluan).
// Tombol quick reply membuka jendela 24 jam begitu ditekan.
async function privateReply(commentId, rule, username) {
  const text = fill(rule.dm_message, username);
  const quick = buttonFor(rule);
  const r = await ig('POST', '/' + (igId || 'me') + '/messages', {
    recipient: { comment_id: commentId },
    message: quick ? { text, quick_replies: quick } : { text },
  });
  if (r.ok || !quick) return Object.assign(r, { text });
  // Fallback tanpa tombol: kirim konten langsung dalam satu pesan
  const text2 = text + '\n\n' + fill(rule.dm_content, username);
  const r2 = await ig('POST', '/' + (igId || 'me') + '/messages', {
    recipient: { comment_id: commentId }, message: { text: text2 },
  });
  return Object.assign(r2, { text: text2, error: r2.ok ? '' : r2.error + ' (dengan tombol: ' + r.error + ')' });
}

function queueFollowup(rule, uid, username) {
  if (!(rule.followup_enabled === true || rule.followup_enabled === 'true') || !rule.followup_message || !uid) return;
  const delay = Number(rule.followup_delay_min) || 60;
  out.push({ json: {
    kind: 'followup', account_id: igId, ig_user_id: uid, username, rule_id: String(rule.id),
    due_at: new Date(Date.now() + delay * 60000).toISOString(),
    message: fill(rule.followup_message, username), status: 'pending',
  } });
}

for (const entry of body.entry || []) {
  account = accounts[String(entry.id)];
  if (!account || !account.access_token) continue; // akun belum login ke panel
  token = account.access_token;
  igId = String(account.ig_user_id);
  allRules = everyRule.filter(r => String(r.account_id) === igId);
  rules = allRules.filter(r => r.active === true || r.active === 'true');

  // ---------- Komentar ----------
  for (const ch of entry.changes || []) {
    if (ch.field !== 'comments' && ch.field !== 'live_comments') continue;
    const v = ch.value || {};
    const cid = String(v.id || '');
    const uid = String((v.from && v.from.id) || '');
    const username = (v.from && v.from.username) || '';
    const media = String((v.media && v.media.id) || '');
    const text = v.text || '';
    if (!cid || seen('c:' + cid)) continue;
    if (uid && (uid === igId || uid === String(entry.id))) continue; // komentar akun sendiri

    log({ type: 'comment_in', uid, username, ref: cid, media, text });
    const cand = rules.filter(r => (r.channel || 'comment') === 'comment' && postMatch(r, media));
    const rule = cand.find(r => kwMatch(r, text));

    if (rule) {
      const variants = lines(rule.comment_replies);
      if (variants.length) {
        const reply = fill(pick(variants), username);
        const r = await ig('POST', '/' + cid + '/replies', { message: reply });
        log({ type: 'comment_reply', status: r.ok ? 'ok' : 'error', rule, uid, username, ref: cid, media, text: reply, error: r.error });
      }
      if (rule.dm_message) {
        const r = await privateReply(cid, rule, username);
        log({ type: 'private_reply', status: r.ok ? 'ok' : 'error', rule, uid: (r.body && r.body.recipient_id) || uid, username, ref: cid, media, text: r.text, error: r.error });
        if (r.ok) queueFollowup(rule, (r.body && r.body.recipient_id) || uid, username);
      }
      continue;
    }

    const aiRule = cand.find(r => r.ai_fallback === true || r.ai_fallback === 'true');
    if (aiRule && account.ai_enabled !== false && settings.gemini_enabled !== 'false' && text.trim()) {
      out.push({ json: {
        kind: 'ai', account_id: igId, comment_id: cid, ig_user_id: uid, username, media_id: media, comment_text: text,
        rule_id: String(aiRule.id), rule_name: aiRule.name || '', ai_context: aiRule.ai_context || '',
        persona: account.ai_persona || settings.gemini_persona || '',
      } });
    }
  }

  // ---------- DM / tombol quick reply ----------
  for (const m of entry.messaging || []) {
    const msg = m.message || {};
    const pb = m.postback;
    if (msg.is_echo || msg.is_deleted) continue;
    const mid = msg.mid || (pb && pb.mid) || '';
    if (!mid || seen('m:' + mid)) continue;
    const uid = String((m.sender && m.sender.id) || '');
    if (!uid || uid === igId) continue;
    const text = msg.text || (pb && pb.title) || '';
    const payload = (msg.quick_reply && msg.quick_reply.payload) || (pb && pb.payload) || '';

    let username = '';
    const prof = await ig('GET', '/' + uid, undefined, { fields: 'username' });
    if (prof.ok) username = prof.body.username || '';

    // DM masuk = jendela 24 jam terbuka; dicatat untuk follow-up
    out.push({ json: { kind: 'contact', account_id: igId, ig_user_id: uid, username, last_user_msg_at: new Date().toISOString() } });
    log({ type: payload ? 'button_tap' : 'dm_in', uid, username, ref: mid, text });

    let rule = null;
    let reply = '';
    let quick;
    if (payload.startsWith('RULE:')) {
      rule = allRules.find(r => String(r.id) === payload.slice(5)) || null;
      reply = rule ? rule.dm_content : '';
    } else {
      rule = rules.find(r => r.channel === 'dm' && kwMatch(r, text)) || null;
      reply = rule ? rule.dm_message : '';
      quick = rule ? buttonFor(rule) : undefined;
    }
    if (!rule || !reply) continue;

    const message = quick ? { text: fill(reply, username), quick_replies: quick } : { text: fill(reply, username) };
    const r = await ig('POST', '/' + (igId || 'me') + '/messages', { recipient: { id: uid }, message });
    log({ type: 'dm_out', status: r.ok ? 'ok' : 'error', rule, uid, username, ref: mid, text: message.text, error: r.error });
    if (r.ok && !payload) queueFollowup(rule, uid, username);
  }
}

return out;

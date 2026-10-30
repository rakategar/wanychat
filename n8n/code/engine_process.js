// Proses event webhook Instagram: cocokkan rule, balas komentar, kirim private reply / DM.
// Panggilan Graph API dilakukan di sini (this.helpers.httpRequest) supaya urutan & fallback mudah diatur.
//#include lib_plans.js
const crypto = require('crypto');
const helpers = this.helpers;
const body = $('Webhook IG Event').first().json.body || {};

const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';

// Hanya terima event yang ditandatangani Meta (HMAC-SHA256 body mentah dengan App Secret)
const rawIn = $('Ambil Body Mentah').first().json;
const expected = settings.app_secret ? 'sha256=' + crypto.createHmac('sha256', settings.app_secret).update(Buffer.from(rawIn.raw || '', 'utf8')).digest('hex') : '';
const given = String(rawIn.signature || '');
if (!expected || !rawIn.raw || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
  // Dicatat maksimal sekali per 10 menit supaya tidak bisa dipakai membanjiri log
  const sdSig = $getWorkflowStaticData('global');
  if (Date.now() - Number(sdSig.badSigAt || 0) < 600000) return [];
  sdSig.badSigAt = Date.now();
  return [{ json: { kind: 'log', account_id: '', type: 'security', status: 'error', rule_id: '', rule_name: '', ig_user_id: '', username: '',
    ref_id: '', media_id: '', text: '', error: settings.app_secret ? 'Webhook ditolak: tanda tangan X-Hub-Signature-256 tidak cocok (cek App Secret)' : 'Webhook ditolak: app_secret belum disetel' } }];
}
if (settings.engine_enabled === 'false') return []; // mode perawatan dari dasbor superadmin

const plans = loadPlans(settings);
const month = monthKey();
const billingBy = latestBy($('Baca Billing').all().map(i => i.json), 'account_id');
const usageBy = latestBy($('Baca Usage').all().map(i => i.json).filter(u => u.month === month), 'account_id');
const usage = {}; // account_id -> { dm, ai, ai_tokens, comments, changed }
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
let plan = DEFAULT_PLANS[0];
let u = null;

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

// Kuota DM per bulan sesuai paket; balasan komentar publik tidak dihitung
const dmLeft = () => u.dm < Number(plan.dm || 0);
const quotaLog = (e) => log(Object.assign({ type: 'quota', status: 'skipped', text: 'Kuota ' + e.what + ' paket ' + plan.name + ' bulan ini habis (' + e.limit + '). Upgrade di menu Langganan.' }, e));

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
  if (!isTrue(rule.followup_enabled) || !plan.followup || !rule.followup_message || !uid) return;
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
  const bill = billingBy[igId];
  if (bill && isTrue(bill.suspended)) continue; // dinonaktifkan superadmin
  plan = effectivePlan(bill, plans);
  if (!usage[igId]) {
    const row = usageBy[igId] || {};
    usage[igId] = { dm: Number(row.dm) || 0, ai: Number(row.ai) || 0, ai_tokens: Number(row.ai_tokens) || 0, comments: Number(row.comments) || 0, changed: false };
  }
  u = usage[igId];
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
    u.comments++; u.changed = true;
    const cand = rules.filter(r => (r.channel || 'comment') === 'comment' && postMatch(r, media));
    const rule = cand.find(r => kwMatch(r, text));

    if (rule) {
      const variants = lines(rule.comment_replies);
      if (variants.length) {
        const reply = fill(pick(variants), username);
        const r = await ig('POST', '/' + cid + '/replies', { message: reply });
        log({ type: 'comment_reply', status: r.ok ? 'ok' : 'error', rule, uid, username, ref: cid, media, text: reply, error: r.error });
      }
      if (rule.dm_message && !dmLeft()) {
        quotaLog({ what: 'DM', limit: plan.dm, rule, uid, username, ref: cid, media });
      } else if (rule.dm_message) {
        const r = await privateReply(cid, rule, username);
        if (r.ok) { u.dm++; u.changed = true; }
        log({ type: 'private_reply', status: r.ok ? 'ok' : 'error', rule, uid: (r.body && r.body.recipient_id) || uid, username, ref: cid, media, text: r.text, error: r.error });
        if (r.ok) queueFollowup(rule, (r.body && r.body.recipient_id) || uid, username);
      }
      continue;
    }

    const aiRule = cand.find(r => r.ai_fallback === true || r.ai_fallback === 'true');
    if (aiRule && account.ai_enabled !== false && settings.gemini_enabled !== 'false' && text.trim()) {
      if (!(u.ai < Number(plan.ai || 0))) {
        if (Number(plan.ai || 0) > 0) quotaLog({ what: 'balasan AI', limit: plan.ai, rule: aiRule, uid, username, ref: cid, media });
        continue;
      }
      const persona = (plan.persona && account.ai_persona) || settings.gemini_persona || '';
      u.ai++;
      // Estimasi token (±4 karakter/token): prompt + jawaban maks ~150 token
      u.ai_tokens += Math.ceil((persona.length + String(aiRule.ai_context || '').length + text.length + 400) / 4) + 150;
      u.changed = true;
      out.push({ json: {
        kind: 'ai', account_id: igId, comment_id: cid, ig_user_id: uid, username, media_id: media, comment_text: text,
        rule_id: String(aiRule.id), rule_name: aiRule.name || '', ai_context: aiRule.ai_context || '',
        persona,
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
    if (!dmLeft()) { quotaLog({ what: 'DM', limit: plan.dm, rule, uid, username, ref: mid }); continue; }

    const message = quick ? { text: fill(reply, username), quick_replies: quick } : { text: fill(reply, username) };
    const r = await ig('POST', '/' + (igId || 'me') + '/messages', { recipient: { id: uid }, message });
    if (r.ok) { u.dm++; u.changed = true; }
    log({ type: 'dm_out', status: r.ok ? 'ok' : 'error', rule, uid, username, ref: mid, text: message.text, error: r.error });
    if (r.ok && !payload) queueFollowup(rule, uid, username);
  }
}

for (const [id, x] of Object.entries(usage)) {
  if (x.changed) out.push({ json: { kind: 'usage', account_id: id, month, dm: x.dm, ai: x.ai, ai_tokens: x.ai_tokens, comments: x.comments } });
}
return out;

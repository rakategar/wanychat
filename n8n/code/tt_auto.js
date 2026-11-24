// Automasi komentar TikTok (dipanggil Schedule tiap 5 menit). Accounts API tidak mengirim webhook komentar, jadi
// komentar baru diambil lewat polling: daftar video (jumlah komentar per video) -> hanya video yang jumlah komentarnya
// berubah yang dibaca komentarnya. Rule TikTok = baris wany_rules dengan channel "tiktok", account_id = open_id.
// Urutan per komentar: rule "sembunyikan" yang cocok -> sembunyikan; rule balasan yang cocok -> balas publik;
// tidak cocok & ada rule AI -> balasan AI (node DeepSeek di hilir). Komentar akun sendiri & balasan (anak komentar) dilewati.
//#include lib_plans.js
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_tiktok.js
if (!ttReady() || settings.engine_enabled === 'false') return [];

const NOW = Date.now();
const BUDGET_MS = 120000; // sisa waktu untuk AI & penulisan log sebelum batas eksekusi workflow
const MAX_VIDEOS = 10; // video terbaru yang dipantau untuk rule "semua video"
const MAX_PAGES = 3; // halaman komentar (30/halaman) per video per putaran
const MAX_AI = 10; // balasan AI per putaran (sisanya di putaran berikut)
const SEEN_KEEP = 600;
const freeMin = Math.max(5, Number(settings.tt_poll_free_min) || 30);
const paidMin = Math.max(5, Number(settings.tt_poll_paid_min) || 5);

const plans = loadPlans(settings);
const month = monthKey(NOW);
const igAll = $('Baca Akun IG').all().map(i => i.json).filter(a => a && a.ig_user_id);
const ttAll = $('Baca Akun TikTok').all().map(i => i.json).filter(a => a && a.open_id);
const billingBy = latestBy($('Baca Billing').all().map(i => i.json), 'account_id');
const usageRows = $('Baca Usage').all().map(i => i.json).filter(u => u && u.month === month);
const usageBy = latestBy(usageRows, 'account_id');
const creditBy = latestBy($('Baca Kredit').all().map(i => i.json), 'account_id');
const everyRule = $('Baca Rules TikTok').all().map(i => i.json).filter(r => r && r.id && r.channel === 'tiktok' && isTrue(r.active));
// Lapis kedua anti-dobel: komentar yang sudah pernah dibalas/disembunyikan menurut log (static data bisa hilang bila eksekusi gagal)
const acted = new Set($('Baca Log TikTok').all().map(i => i.json).filter(e => e && e.ref_id).map(e => String(e.account_id) + ':' + String(e.ref_id)));

const sd = $getWorkflowStaticData('global');
if (!sd.tt || typeof sd.tt !== 'object') sd.tt = {};
const out = [];
const groups = {};
const usage = {};
let aiCount = 0;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
const words = (s) => String(s || '').split(/[,\n]/).map(norm).filter(Boolean);
const lines = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fill = (tpl, username) => String(tpl || '')
  .replace(/\{username\}/gi, username ? '@' + username : 'kak')
  .replace(/\{nama\}/gi, username || 'kak');
const videoIds = (r) => String(r.post_ids || '*').split(/[,\s]+/).filter(Boolean);
const videoMatch = (r, vid) => { const ids = videoIds(r); return !ids.length || ids.includes('*') || ids.includes(String(vid)); };
function kwMatch(r, text) {
  const mode = r.match_mode || 'contains';
  if (mode === 'any') return true;
  const t = norm(text);
  const kws = words(r.keywords);
  if (!kws.length) return false;
  if (mode === 'exact') return kws.some(k => t === k);
  return kws.some(k => kwHit(t, k));
}
// "contains": keyword harus di awal kata ("harganya" cocok "harga", "gamau" tidak cocok "mau")
// dan tidak didahului kata penyangkal ("ga mau", "nggak minat") — itu dibiarkan ke AI.
const NEG = new Set(['ga', 'gak', 'gk', 'g', 'nga', 'ngga', 'nggak', 'enggak', 'engga', 'ndak', 'nda', 'tidak', 'tdk', 'tak', 'kagak', 'kaga', 'ogah', 'males', 'malas', 'jangan', 'belum', 'blm', 'gamau', 'nggamau', 'no', 'not']);
function kwHit(t, k) {
  const re = new RegExp('(^|[^\\p{L}\\p{N}])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu');
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(0, m.index + m[1].length).match(/[\p{L}\p{N}]+/gu) || [];
    if (!NEG.has(before[before.length - 1])) return true;
  }
  return false;
}
const secs = (t) => { const n = Number(t); return Number.isFinite(n) ? (n > 1e12 ? Math.floor(n / 1000) : n) : Math.floor(new Date(t).getTime() / 1000) || 0; };

// Akun yang paling lama tidak diperiksa didahulukan (batas waktu per putaran)
const queue = ttAll
  .filter(a => a.access_token && a.owner_id && a.owner_id !== 'unlinked')
  .map(a => ({ a, st: sd.tt[String(a.open_id)] }))
  .sort((x, y) => Number((x.st && x.st.last) || 0) - Number((y.st && y.st.last) || 0));

// Akun yang sudah dilepas / tidak punya rule aktif: state dibuang, supaya saat automasi dinyalakan lagi komentar lama tidak ikut dibalas
const live = new Set(queue.map(q => String(q.a.open_id)));
for (const id of Object.keys(sd.tt)) if (!live.has(id) || !everyRule.some(r => String(r.account_id) === id)) delete sd.tt[id];

for (const { a } of queue) {
  if (Date.now() - NOW > BUDGET_MS) break;
  const oid = String(a.open_id);
  const rules = everyRule.filter(r => String(r.account_id) === oid);
  if (!rules.length) continue;
  const gid = String(a.owner_id);
  const bill = billingBy[gid];
  if (bill && isTrue(bill.suspended)) continue;
  const plan = effectivePlan(bill, plans);
  if (!ttActiveInGroup(a, igAll, ttAll, plan)) continue;

  const st = sd.tt[oid] || (sd.tt[oid] = { since: Math.floor(NOW / 1000), last: 0, videos: {}, seen: [] });
  const every = (Number(plan.price) > 0 ? paidMin : freeMin) * 60000;
  if (st.last && NOW - st.last < every - 60000) continue;
  st.last = NOW;

  const logBase = { account_id: oid, ig_user_id: '', username: '', ref_id: '', media_id: '', rule_id: '', rule_name: '' };
  const log = ({ rule, ...e }) => out.push({ json: Object.assign({ kind: 'log', status: 'ok' }, logBase, e, {
    rule_id: rule ? String(rule.id) : '', rule_name: rule ? String(rule.name || '') : '',
    text: String(e.text || '').slice(0, 1000), error: e.error ? String(e.error).slice(0, 500) : '' }) });
  // Galat koneksi dicatat maksimal sekali per jam per akun
  const logErr = (error) => { if (NOW - Number(st.errAt || 0) > 3600000) { st.errAt = NOW; log({ type: 'tt_error', status: 'error', error }); } };

  // Token 24 jam: diperbarui di sini bila hampir habis (selain refresh harian Scheduler)
  let token = a.access_token;
  if (!a.token_expires_at || new Date(a.token_expires_at).getTime() < NOW + 10 * 60000) {
    const r = await ttRefresh(a.refresh_token);
    if (r.ok && r.data.access_token) {
      const row = ttRow(a, ttTokenFields(r.data));
      token = row.access_token;
      out.push({ json: { kind: 'token', tt: row } });
    } else {
      out.push({ json: { kind: 'token', tt: ttRow(a, { token_refresh_error: 'Refresh gagal: ' + r.error }) } });
      logErr('Token TikTok tidak bisa diperpanjang: ' + r.error + '. Hubungkan ulang akun TikTok.');
      continue;
    }
  }

  // Video yang dipantau: N terbaru (bila ada rule "semua video") + video yang dipilih rule
  const vr = await ttVideos(oid, token);
  if (!vr.ok) { logErr('Gagal membaca video TikTok: ' + vr.error); continue; }
  const latest = (vr.data.videos || []).filter(v => v && v.item_id);
  const anyAll = rules.some(r => videoIds(r).includes('*') || !videoIds(r).length);
  const watch = new Map();
  if (anyAll) for (const v of latest.slice(0, MAX_VIDEOS)) watch.set(String(v.item_id), Number(v.comments));
  for (const r of rules) for (const id of videoIds(r)) {
    if (id === '*' || watch.has(id) || watch.size >= MAX_VIDEOS + 10) continue;
    const v = latest.find(x => String(x.item_id) === id);
    watch.set(id, v ? Number(v.comments) : NaN); // di luar 20 video terbaru: jumlah komentar tidak diketahui, selalu dibaca
  }

  if (!groups[gid]) {
    const t = groupUsage(usageRows, igAll.concat(ttAll), gid);
    const c = creditBy[gid] || {};
    groups[gid] = { ai: t.ai, granted: Number(c.granted) || 0, used: Number(c.used) || 0, changed: false };
  }
  const g = groups[gid];
  if (!usage[oid]) {
    const row = usageBy[oid] || {};
    usage[oid] = { dm: Number(row.dm) || 0, ai: Number(row.ai) || 0, ai_tokens: Number(row.ai_tokens) || 0, comments: Number(row.comments) || 0, changed: false };
  }
  const u = usage[oid];
  const seenSet = new Set(st.seen);
  // Rule sembunyikan dicek lebih dulu supaya spam tidak terlanjur dibalas
  const ordered = rules.slice().sort((x, y) => (isTrue(y.hide_comment) ? 1 : 0) - (isTrue(x.hide_comment) ? 1 : 0) || Number(x.id) - Number(y.id));

  for (const [vid, count] of watch) {
    if (Date.now() - NOW > BUDGET_MS) break;
    const known = st.videos[vid];
    if (Number.isFinite(count) && known !== undefined && Number(known) === count) continue;
    const cand = ordered.filter(r => videoMatch(r, vid));
    if (!cand.length) { st.videos[vid] = count; continue; }

    let cursor = '';
    let okRead = true;
    const fresh = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const cr = await ttComments(oid, token, vid, cursor);
      if (!cr.ok) { okRead = false; logErr('Gagal membaca komentar TikTok: ' + cr.error); break; }
      const list = cr.data.comments || [];
      let older = false;
      for (const c of list) {
        if (secs(c.create_time) < st.since) { older = true; continue; }
        fresh.push(c);
      }
      if (older || !cr.data.has_more || !cr.data.cursor) break;
      cursor = String(cr.data.cursor);
    }
    if (!okRead) break; // token/izin bermasalah: akun ini dilewati, dicoba lagi putaran berikut
    let done = true;

    fresh.sort((x, y) => secs(x.create_time) - secs(y.create_time)); // terlama dulu
    for (const c of fresh) {
      const cid = String(c.comment_id || '');
      if (!cid || seenSet.has(cid) || acted.has(oid + ':' + cid)) continue;
      if (c.owner === true || c.parent_comment_id && String(c.parent_comment_id) !== '0' && String(c.parent_comment_id) !== cid) { seenSet.add(cid); st.seen.push(cid); continue; }
      if (String(c.status || '').toUpperCase() === 'HIDDEN') { seenSet.add(cid); st.seen.push(cid); continue; }
      const text = String(c.text || '');
      const username = String(c.username || c.display_name || '');
      const who = { ig_user_id: String(c.user_id || ''), username, ref_id: cid, media_id: vid };

      const rule = cand.find(r => kwMatch(r, text));
      if (!rule) {
        const aiRule = cand.find(r => isTrue(r.ai_fallback));
        if (aiRule && text.trim() && aiCount >= MAX_AI) { done = false; break; } // batas per putaran: sisanya putaran berikut
      }
      seenSet.add(cid); st.seen.push(cid);
      log(Object.assign({ type: 'tt_comment_in', text }, who));
      u.comments++; u.changed = true;

      if (rule) {
        if (isTrue(rule.hide_comment)) {
          const r = await ttHide(oid, token, vid, cid, true);
          log(Object.assign({ type: 'tt_hide', status: r.ok ? 'ok' : 'error', rule, text, error: r.error }, who));
          continue;
        }
        const variants = lines(rule.comment_replies);
        if (variants.length) {
          const reply = fill(pick(variants), username).slice(0, 150);
          const r = await ttReplyComment(oid, token, vid, cid, reply);
          log(Object.assign({ type: 'tt_reply', status: r.ok ? 'ok' : 'error', rule, text: reply, error: r.error }, who));
        }
        continue;
      }

      const aiRule = cand.find(r => isTrue(r.ai_fallback));
      if (!aiRule || !text.trim() || settings.gemini_enabled === 'false') continue;
      // Kuota AI paket dulu (dibagi dengan Instagram), lalu kredit top-up
      if (g.ai < Number(plan.ai || 0)) { u.ai++; g.ai++; u.changed = true; }
      else if (creditBalance(g) > 0) { g.used++; g.changed = true; }
      else {
        if (Number(plan.ai || 0) > 0 || g.granted > 0) log(Object.assign({ type: 'quota', status: 'skipped', rule: aiRule,
          text: 'Kuota balasan AI (dan kredit top-up) paket ' + plan.name + ' bulan ini habis (' + plan.ai + '). Upgrade di menu Langganan.' }, who));
        continue;
      }
      aiCount++;
      const persona = (plan.persona && a.ai_persona) || settings.gemini_persona || '';
      u.ai_tokens += Math.ceil((persona.length + String(aiRule.ai_context || '').length + text.length + 400) / 4) + 80;
      out.push({ json: { kind: 'ai', account_id: oid, comment_id: cid, video_id: vid, ig_user_id: who.ig_user_id, username,
        comment_text: text.slice(0, 500), rule_id: String(aiRule.id), rule_name: aiRule.name || '', ai_context: aiRule.ai_context || '', persona } });
    }
    // Jumlah komentar baru dicatat setelah semua komentar baru selesai; bila terpotong, video dibaca ulang putaran berikut
    if (done && Number.isFinite(count)) st.videos[vid] = count;
    else delete st.videos[vid];
  }
  if (st.seen.length > SEEN_KEEP) st.seen = st.seen.slice(-SEEN_KEEP);
  const vids = Object.keys(st.videos);
  if (vids.length > 60) for (const k of vids.slice(0, vids.length - 60)) delete st.videos[k];
}

for (const [id, x] of Object.entries(usage)) {
  if (x.changed) out.push({ json: { kind: 'usage', account_id: id, month, dm: x.dm, ai: x.ai, ai_tokens: x.ai_tokens, comments: x.comments } });
}
for (const [id, x] of Object.entries(groups)) {
  if (x.changed) out.push({ json: { kind: 'credits', account_id: id, used: x.used } });
}
return out;

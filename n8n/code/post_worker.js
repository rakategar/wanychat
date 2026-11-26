// Worker antrean posting (tiap 2 menit, batas waktu eksekusi 100 detik -> dua putaran tidak pernah tumpang tindih).
// Satu target = satu akun tujuan. Status: queued -> processing -> published | failed (canceled dari API).
// Instagram: buat container (anak carousel dulu) -> tunggu FINISHED -> media_publish. Bila putaran sebelumnya terputus
//   setelah publish, container berstatus PUBLISHED dan media dicari ulang (tidak dipublikasikan dua kali).
// TikTok: /business/video|photo/publish/ -> share_id -> /business/publish/status/ sampai PUBLISH_COMPLETE (+ post_ids).
// Tidak ada percobaan ulang otomatis untuk publish (mencegah posting ganda); user memakai tombol "Coba lagi".
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');
//#include lib_plans.js
//#include lib_tiktok.js
//#include lib_s3.js
//#include lib_post.js

const T0 = Date.now();
const BUDGET_MS = 60000;     // tidak memulai target baru setelah 60 detik
const MAX_TARGETS = 12;
const nowIso = () => new Date().toISOString();
const out = [];
const igAcc = latestBy($('Baca Akun IG').all().map(i => i.json).filter(a => a && a.ig_user_id), 'ig_user_id');
const ttAcc = latestBy($('Baca Akun TikTok').all().map(i => i.json).filter(a => a && a.open_id), 'open_id');
const active = $('Baca Target Aktif').all().map(i => i.json).filter(t => t && t.id && ACTIVE_TARGET.includes(t.status));

async function ig(method, path, token, params) {
  try {
    const res = await helpers.httpRequest({ method, url: G + path, qs: Object.assign({}, params || {}, { access_token: token }), json: true,
      ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 25000 });
    const b = res.body || {};
    if (res.statusCode >= 400 || b.error) return { ok: false, err: b.error || { message: 'HTTP ' + res.statusCode } };
    return { ok: true, body: b };
  } catch (e) { return { ok: false, err: { message: e.message, is_transient: 1 } }; }
}

const ttTokens = {};
async function ttToken(a) {
  if (ttTokens[a.open_id]) return ttTokens[a.open_id];
  const exp = a.token_expires_at ? new Date(a.token_expires_at).getTime() : 0;
  let tok = a.access_token;
  if (exp <= Date.now() + 5 * 60000) {
    const r = await ttRefresh(a.refresh_token);
    if (r.ok && r.data.access_token) {
      const row = ttRow(a, ttTokenFields(r.data));
      out.push({ json: { kind: 'tt', tt: row } });
      tok = row.access_token;
    } else out.push({ json: { kind: 'tt', tt: ttRow(a, { token_refresh_error: 'Refresh gagal: ' + r.error }) } });
  }
  ttTokens[a.open_id] = tok;
  return tok;
}

const log = (t, type, extra) => out.push({ json: Object.assign({ kind: 'log', account_id: String(t.account_id), type, status: 'ok', rule_id: '', rule_name: '',
  ig_user_id: '', username: t.username || '', ref_id: t.post_id, media_id: '', text: String(t.caption || '').slice(0, 300), error: '' }, extra || {}) });
const save = (t, fields) => out.push({ json: Object.assign({ kind: 'target' }, targetUpdate(t, fields)) });
function failT(t, e, stage) {
  save(t, { status: 'failed', error: e.error, retryable: !!e.retryable, error_stage: stage || '', done_at: nowIso() });
  log(t, 'post_failed', { status: 'error', error: e.error.slice(0, 500) });
}
function doneT(t, mediaId, permalink, note) {
  save(t, { status: 'published', media_id: mediaId || '', permalink: permalink || '', error: '', retryable: false, done_at: nowIso(), note: note || '' });
  log(t, 'post_published', { media_id: mediaId || '', text: (permalink ? permalink + ' · ' : '') + String(t.caption || '').slice(0, 250) });
}
const ageMin = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 60000 : 0;

// ---------------------------------------------------------------- Instagram
async function igPublish(t, a, containerId) {
  const r = await ig('POST', '/me/media_publish', a.access_token, { creation_id: containerId });
  if (!r.ok) return failT(t, igErrText(r.err), 'publish');
  const id = String(r.body.id || '');
  const m = await ig('GET', '/' + id, a.access_token, { fields: 'permalink' });
  const issue = r.body.config_issue ? 'Catatan Instagram: ' + r.body.config_issue : '';
  return doneT(t, id, m.ok ? m.body.permalink || '' : '', issue);
}

// Container sudah PUBLISHED tapi hasilnya belum tercatat (putaran sebelumnya terputus): cari media terbaru yang cocok
async function igRecover(t, a) {
  const r = await ig('GET', '/me/media', a.access_token, { fields: 'id,permalink,caption,timestamp', limit: 10 });
  const head = String(t.caption || '').slice(0, 40);
  const since = new Date(t.started_at || t.createdAt).getTime() - 120000;
  const m = r.ok ? (r.body.data || []).find(x => new Date(x.timestamp).getTime() >= since && String(x.caption || '').startsWith(head)) : null;
  return doneT(t, m ? m.id : '', m ? m.permalink : '', m ? '' : 'Terbit, tapi ID postingan tidak ditemukan otomatis.');
}

async function igStatus(id, token) {
  const r = await ig('GET', '/' + id, token, { fields: 'status_code,status' });
  return r.ok ? { code: String(r.body.status_code || ''), status: String(r.body.status || '') } : { code: 'API_ERROR', err: r.err };
}

async function igStep(t) {
  const a = igAcc[String(t.account_id)];
  if (!a || !a.access_token || groupOf(a) !== String(t.owner_id)) return failT(t, { error: 'Akun Instagram sudah dilepas dari Wanychat.', retryable: false }, 'account');
  const media = parseJson(t.media, []);
  const opt = parseJson(t.options, {});
  if (t.status === 'queued') {
    if (t.kind === 'carousel') {
      const kids = [];
      for (const m of media) {
        const r = await ig('POST', '/me/media', a.access_token, m.kind === 'video'
          ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true' } : { image_url: m.url, is_carousel_item: 'true' });
        if (!r.ok) return failT(t, igErrText(r.err), 'container');
        kids.push(String(r.body.id));
      }
      return save(t, { status: 'processing', children: JSON.stringify(kids), container_id: '', started_at: nowIso(), next_at: nowIso() });
    }
    const params = t.kind === 'reels'
      ? { media_type: 'REELS', video_url: media[0].url, caption: t.caption, share_to_feed: opt.share_to_feed === false ? 'false' : 'true' }
      : { image_url: media[0].url, caption: t.caption };
    const r = await ig('POST', '/me/media', a.access_token, params);
    if (!r.ok) return failT(t, igErrText(r.err), 'container');
    const cid = String(r.body.id);
    if (t.kind === 'image') {
      // Foto biasanya langsung siap: langsung terbitkan dalam putaran yang sama
      const st = await igStatus(cid, a.access_token);
      if (st.code === 'FINISHED') return igPublish(Object.assign({}, t, { container_id: cid, started_at: nowIso() }), a, cid);
    }
    return save(t, { status: 'processing', container_id: cid, started_at: nowIso(), next_at: new Date(Date.now() + 60000).toISOString() });
  }

  // processing
  if (ageMin(t.started_at) > 30) return failT(t, { error: 'Instagram terlalu lama memproses media (lebih dari 30 menit).', retryable: true }, 'timeout');
  let cid = t.container_id;
  if (t.kind === 'carousel' && !cid) {
    const kids = parseJson(t.children, []);
    for (const k of kids) {
      const st = await igStatus(k, a.access_token);
      if (st.code === 'ERROR' || st.code === 'EXPIRED') return failT(t, { error: 'Instagram menolak salah satu media carousel: ' + (st.status || st.code), retryable: false }, 'container');
      if (st.code !== 'FINISHED') return save(t, { tries: (Number(t.tries) || 0) + 1, next_at: new Date(Date.now() + 60000).toISOString() });
    }
    const r = await ig('POST', '/me/media', a.access_token, { media_type: 'CAROUSEL', children: kids.join(','), caption: t.caption });
    if (!r.ok) return failT(t, igErrText(r.err), 'container');
    cid = String(r.body.id);
    t = Object.assign({}, t, { container_id: cid });
  }
  const st = await igStatus(cid, a.access_token);
  if (st.code === 'FINISHED') return igPublish(t, a, cid);
  if (st.code === 'PUBLISHED') return igRecover(t, a);
  if (st.code === 'ERROR') return failT(t, { error: 'Instagram gagal memproses media: ' + (st.status || 'ERROR') + '. Periksa format video (MP4 H.264, AAC, 23-60 FPS).', retryable: false }, 'container');
  if (st.code === 'EXPIRED') return failT(t, { error: 'Container Instagram kedaluwarsa (lebih dari 24 jam).', retryable: true }, 'container');
  if (st.code === 'API_ERROR') {
    const e = igErrText(st.err);
    if (e.auth) return failT(t, e, 'status');
  }
  return save(t, { container_id: cid, tries: (Number(t.tries) || 0) + 1, next_at: new Date(Date.now() + 60000).toISOString() });
}

// ---------------------------------------------------------------- TikTok
const ttLink = (t, id) => 'https://www.tiktok.com/@' + encodeURIComponent(t.username || '') + '/' + (t.kind === 'photo' ? 'photo' : 'video') + '/' + id;
function ttErr(r) {
  const m = String(r.error || '');
  const known = Object.keys(TT_FAIL).find(k => m.includes(k));
  if (known) return ttFailText(known);
  if (r.code === 40105 || /access.?token|scope|unauthori/i.test(m)) return { error: 'Izin TikTok kedaluwarsa atau belum mencakup posting. Klik "Izinkan posting" untuk akun ini.', retryable: false };
  return { error: 'TikTok: ' + m.slice(0, 300), retryable: true };
}

async function ttStep(t) {
  const a = ttAcc[String(t.account_id)];
  if (!a || !a.access_token || String(a.owner_id) !== String(t.owner_id)) return failT(t, { error: 'Akun TikTok sudah dilepas dari Wanychat.', retryable: false }, 'account');
  const token = await ttToken(a);
  const media = parseJson(t.media, []);
  const opt = parseJson(t.options, {});
  if (t.status === 'queued') {
    let r;
    if (t.kind === 'video') {
      r = await ttCall('POST', '/business/video/publish/', { token, body: { business_id: a.open_id, video_url: media[0].url, post_info: {
        caption: t.caption, disable_comment: !!opt.disable_comment, disable_duet: !!opt.disable_duet, disable_stitch: !!opt.disable_stitch,
        is_brand_organic: !!opt.brand_organic, is_branded_content: !!opt.branded, is_ai_generated: !!opt.ai_generated } } });
    } else {
      const info = { caption: t.caption, privacy_level: opt.privacy || 'PUBLIC_TO_EVERYONE', disable_comment: !!opt.disable_comment,
        auto_add_music: !!opt.auto_music, is_brand_organic: !!opt.brand_organic, is_branded_content: !!opt.branded };
      if (opt.title) info.title = String(opt.title).slice(0, 90);
      r = await ttCall('POST', '/business/photo/publish/', { token, body: Object.assign({ business_id: a.open_id, photo_images: media.map(m => m.url),
        photo_cover_index: 0, post_info: info }, opt.ai_generated ? { is_ai_generated: true } : {}) });
    }
    if (!r.ok) return failT(t, ttErr(r), 'publish');
    return save(t, { status: 'processing', publish_id: String(r.data.share_id || ''), started_at: nowIso(), next_at: new Date(Date.now() + 60000).toISOString() });
  }

  // processing
  const r = await ttCall('GET', '/business/publish/status/', { token, qs: { business_id: a.open_id, publish_id: t.publish_id } });
  if (!r.ok) {
    if (ageMin(t.started_at) > 60) return failT(t, Object.assign(ttErr(r), { error: 'Status posting TikTok tidak bisa dicek lebih dari 1 jam. Cek langsung di aplikasi TikTok. ' + ttErr(r).error, retryable: false }), 'status');
    return save(t, { tries: (Number(t.tries) || 0) + 1, next_at: new Date(Date.now() + 120000).toISOString() });
  }
  const d = r.data || {};
  const status = String(d.status || '');
  if (status === 'FAILED') return failT(t, ttFailText(d.reason), 'status');
  if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') {
    const ids = Array.isArray(d.post_ids) ? d.post_ids.map(String).filter(Boolean) : [];
    if (ids.length) return doneT(t, ids[0], ttLink(t, ids[0]));
    // ID postingan baru muncul setelah moderasi (maks ~3 menit) dan hanya untuk postingan publik
    const since = /^complete:/.test(t.note || '') ? t.note.slice(9) : nowIso();
    if (ageMin(since) > 15 || (t.kind === 'photo' && opt.privacy && opt.privacy !== 'PUBLIC_TO_EVERYONE')) {
      return doneT(t, '', 'https://www.tiktok.com/@' + encodeURIComponent(t.username || ''), 'Terbit. ID postingan belum diberikan TikTok (masih moderasi atau bukan publik).');
    }
    return save(t, { note: 'complete:' + since, tries: (Number(t.tries) || 0) + 1, next_at: new Date(Date.now() + 60000).toISOString() });
  }
  if (ageMin(t.started_at) > 60) return failT(t, { error: 'TikTok belum selesai mengunduh media setelah 1 jam.', retryable: true }, 'status');
  return save(t, { tries: (Number(t.tries) || 0) + 1, next_at: new Date(Date.now() + 60000).toISOString() });
}

// ---------------------------------------------------------------- jalankan
const due = active.filter(t => {
  const at = new Date(t.status === 'queued' ? t.scheduled_at || t.next_at : t.next_at || 0).getTime();
  return !at || at <= Date.now() + 30000;
}).sort((x, y) => new Date(x.next_at || x.scheduled_at || 0) - new Date(y.next_at || y.scheduled_at || 0) || Number(x.id) - Number(y.id));
let n = 0;
for (const t of due) {
  if (n >= MAX_TARGETS || Date.now() - T0 > BUDGET_MS) break;
  n++;
  try {
    if (t.platform === 'tiktok') await ttStep(t); else await igStep(t);
  } catch (e) {
    // Galat kode tak terduga: target dibiarkan, dicoba di putaran berikut (tidak menggandakan karena status belum berubah)
    save(t, { tries: (Number(t.tries) || 0) + 1, note: 'galat worker: ' + String(e.message).slice(0, 200), next_at: new Date(Date.now() + 120000).toISOString() });
  }
}

// Hapus file media yang sudah kedaluwarsa dan tidak dipakai antrean aktif
if (s3Ready()) {
  const inUse = new Set();
  for (const t of active) for (const m of parseJson(t.media, [])) inUse.add(m.media_id);
  const expired = $('Baca Media Kedaluwarsa').all().map(i => i.json)
    .filter(m => m && m.media_id && ['uploading', 'ready', 'rejected'].includes(m.status) && m.expires_at && new Date(m.expires_at).getTime() < Date.now() && !inUse.has(m.media_id))
    .slice(0, 25);
  for (const m of expired) {
    if (Date.now() - T0 > BUDGET_MS + 15000) break;
    const r = await s3Request('DELETE', m.obj_key);
    if (r.ok || r.status === 404) out.push({ json: Object.assign({}, m, { status: 'deleted', kind: 'media' }) }); // kind terakhir: kolom media.kind tidak menimpa rute
  }
}
return out;

// API posting multi-platform (/post-api -> /webhook/wany-post). Sesi & grup sama persis dengan Admin API (api_route.js).
// Alur: post.config -> media.start (URL PUT ke R2) -> browser mengunggah -> media.finish (server memverifikasi isi file)
//       -> post.create (validasi format per platform, target masuk antrean) -> worker "Proses Antrean" menerbitkan.
//#include lib_plans.js
//#include lib_user.js
const helpers = this.helpers;
const req = $('Webhook Posting').first().json;
const body = req.body || {};
const action = String(body.action || '');
const p = body.payload || {};

const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');
const base = String(settings.public_url || '').replace(/\/$/, '');
//#include lib_tiktok.js
//#include lib_s3.js
//#include lib_mp4.js
//#include lib_post.js

const session = $('Cari Sesi').first().json;
const sessionValid = !!(session && session.token && session.user_id && (!session.expires_at || new Date(session.expires_at) > new Date()));
const user = sessionValid ? latestRow($('Baca User').all().map(i => i.json), 'uid', session.user_id) : null;
const gid = user ? String(user.group_id || user.uid) : '';
const origin = String((req.headers || {}).origin || '');
const extraOrigins = String(settings.extra_origins || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const sameOrigin = !origin || (base && origin === base) || extraOrigins.includes(origin);

const igAll = user ? $('Baca Akun Grup').all().map(i => i.json).filter(a => a && a.ig_user_id && a.access_token && groupOf(a) === gid) : [];
const members = groupMembers(igAll, gid);
const ttRows = user ? $('Baca TikTok Grup').all().map(i => i.json).filter(a => a && a.open_id && a.access_token && String(a.owner_id) === gid) : [];
const billing = user ? latestBy($('Baca Billing').all().map(i => i.json), 'account_id')[gid] || null : null;
const plan = effectivePlan(billing, loadPlans(settings));
const accountsLimit = Math.max(1, Number(plan.accounts) || 1);
const posts = $('Baca Posting').all().map(i => i.json).filter(r => r && r.post_id && String(r.owner_id) === gid);
const targets = $('Baca Target').all().map(i => i.json).filter(r => r && r.post_id && String(r.owner_id) === gid);
const mediaRows = $('Baca Media').all().map(i => i.json).filter(r => r && r.media_id && String(r.owner_id) === gid);
const month = monthKey();

const reply = (route, response, extra) => [{ json: Object.assign({ route, response }, extra || {}) }];
const ok = (response) => reply('direct', Object.assign({ ok: true }, response));
const fail = (error, status, extra) => reply('direct', Object.assign({ ok: false, error }, extra || {}), { status: status || 400 });
const nowIso = () => new Date().toISOString();
const rand = (n) => require('crypto').randomBytes(n).toString('hex');

// ---- akun tujuan + izin posting
const hasTtPublish = (a) => String(a.scope || '').split(/[,\s]+/).includes('video.publish');
let ttUpdates = [];
async function ttFreshToken(a) {
  const exp = a.token_expires_at ? new Date(a.token_expires_at).getTime() : 0;
  if (exp > Date.now() + 5 * 60000) return a.access_token;
  const r = await ttRefresh(a.refresh_token);
  if (!r.ok || !r.data.access_token) { ttUpdates.push(ttRow(a, { token_refresh_error: 'Refresh gagal: ' + r.error })); return a.access_token; }
  const row = ttRow(a, ttTokenFields(r.data));
  ttUpdates.push(row);
  return row.access_token;
}
async function igCall(method, path, token, qs) {
  try {
    const res = await helpers.httpRequest({ method, url: G + path, qs: Object.assign({}, qs || {}, { access_token: token }), json: true,
      ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 15000 });
    const b = res.body || {};
    if (res.statusCode >= 400 || b.error) return { ok: false, err: b.error || { message: 'HTTP ' + res.statusCode } };
    return { ok: true, body: b };
  } catch (e) { return { ok: false, err: { message: e.message } }; }
}
// Akun yang bisa dipilih sebagai tujuan. Cek izin Instagram langsung ke API (content_publishing_limit butuh izin posting).
async function destinations(live) {
  const igs = await Promise.all(members.map(async (a, i) => {
    const d = { type: 'instagram', id: String(a.ig_user_id), username: a.username || '', avatar: a.avatar || '', active: i < accountsLimit,
      can_publish: false, reason: '', quota: null };
    if (!d.active) { d.reason = 'Akun tidak aktif di paket ' + plan.name + '.'; return d; }
    if (!live) { d.can_publish = true; return d; }
    const r = await igCall('GET', '/me/content_publishing_limit', a.access_token, { fields: 'quota_usage,config' });
    if (r.ok) {
      const row = (r.body.data || [])[0] || {};
      d.can_publish = true;
      d.quota = { used: Number(row.quota_usage) || 0, total: Number(row.config && row.config.quota_total) || POST_RULES.ig_daily };
    } else {
      const e = igErrText(r.err);
      if (e.auth) { d.reason = e.error; d.need_auth = true; } else { d.can_publish = true; d.reason = 'Kuota harian tidak terbaca: ' + e.error; }
    }
    return d;
  }));
  const tts = await Promise.all(ttRows.map(async (a) => {
    const d = { type: 'tiktok', id: String(a.open_id), username: a.username || '', avatar: a.avatar || '', active: ttActiveInGroup(a, members, ttRows, plan),
      can_publish: false, reason: '', quota: null, limits: { privacy: [], max_sec: POST_RULES.tt_video.max_sec } };
    const day = targets.filter(t => t.platform === 'tiktok' && String(t.account_id) === d.id && t.status !== 'canceled' && !(t.status === 'failed' && !t.publish_id)
      && Date.now() - new Date(t.scheduled_at || t.createdAt).getTime() < 86400000).length;
    d.quota = { used: day, total: POST_RULES.tt_daily };
    if (!d.active) { d.reason = 'Akun tidak aktif di paket ' + plan.name + '.'; return d; }
    if (!hasTtPublish(a)) { d.reason = 'Akun belum memberi izin posting ke Wanychat.'; d.need_auth = true; return d; }
    d.can_publish = true;
    if (live) {
      const r = await ttCall('GET', '/business/video/settings/', { token: await ttFreshToken(a), qs: { business_id: a.open_id } });
      if (r.ok) {
        const v = r.data || {};
        if (Array.isArray(v.privacy_level_options)) d.limits.privacy = v.privacy_level_options.map(String);
        if (Number(v.max_video_post_duration_sec) > 0) d.limits.max_sec = Math.min(POST_RULES.tt_video.max_sec, Number(v.max_video_post_duration_sec));
        d.limits.comment_disabled = !!v.comment_disabled; d.limits.duet_disabled = !!v.duet_disabled; d.limits.stitch_disabled = !!v.stitch_disabled;
      }
    }
    return d;
  }));
  return igs.concat(tts);
}
// Kuota posting bulanan: tiap akun tujuan dihitung satu (yang dibatalkan tidak dihitung)
const monthUsed = () => targets.filter(t => monthKey(t.createdAt) === month && t.status !== 'canceled').length;

// ---- tampilan
const publicMedia = (m) => ({ media_id: m.media_id, kind: m.kind, mime: m.mime, size: Number(m.size) || 0, width: Number(m.width) || 0, height: Number(m.height) || 0,
  duration: Number(m.duration) || 0, fps: Number(m.fps) || 0, status: m.status, url: m.status === 'deleted' ? '' : s3PublicUrl(m.obj_key) });
const publicTarget = (t) => ({ id: Number(t.id), platform: t.platform, account_id: String(t.account_id), username: t.username || '', status: t.status,
  media_id: t.media_id || '', permalink: t.permalink || '', error: t.error || '', retryable: isTrue(t.retryable), scheduled_at: t.scheduled_at || '',
  done_at: t.done_at || '', note: t.note || '' });
function publicPost(pp) {
  const ts = targets.filter(t => t.post_id === pp.post_id).sort((a, b) => Number(a.id) - Number(b.id));
  const media = parseJson(pp.media, []);
  return { post_id: pp.post_id, caption: pp.caption || '', kind: pp.kind, media, scheduled_at: pp.scheduled_at || '', created_at: pp.createdAt || '',
    status: postStatus(ts), targets: ts.map(publicTarget) };
}

if (!sameOrigin) return reply('deny', { ok: false, error: 'Permintaan ditolak' });
if (!user) return reply('deny', { ok: false, error: 'Silakan masuk' });
if (billing && isTrue(billing.suspended)) return reply('deny', { ok: false, error: 'Akun ini dinonaktifkan. Hubungi admin Wanychat.' });
const withTt = (res) => ttUpdates.length ? res.concat(ttUpdates.map(tt => ({ json: { route: 'tt_update', tt } }))) : res;

switch (action) {
  case 'post.config': {
    const dests = await destinations(true);
    return withTt(ok({
      ready: s3Ready(), accounts: dests,
      plan: { name: plan.name, posts: Number(plan.posts ?? 10), used: monthUsed() },
      rules: POST_RULES, max_video_bytes: postMaxVideoBytes(), upload_mimes: UPLOAD_MIMES,
    }));
  }

  case 'media.start': {
    if (!s3Ready()) return fail('Penyimpanan media belum disiapkan admin Wanychat.', 503);
    const mime = String(p.mime || '');
    const size = Math.round(Number(p.size));
    if (!UPLOAD_MIMES.includes(mime)) return fail('Format file tidak didukung. Pakai foto JPEG (otomatis dikonversi) atau video MP4/MOV.');
    const kind = mime.startsWith('video/') ? 'video' : 'image';
    const max = kind === 'video' ? postMaxVideoBytes() : Math.max(POST_RULES.ig_image.max_bytes, POST_RULES.tt_image.max_bytes);
    if (!(size > 0)) return fail('Ukuran file tidak valid.');
    if (size > max) return fail((kind === 'video' ? 'Video' : 'Foto') + ' maksimal ' + fmtMb(max) + ' (file ini ' + fmtMb(size) + ').');
    const pending = mediaRows.filter(m => m.status === 'uploading' && Date.now() - new Date(m.createdAt).getTime() < 6 * 3600000).length;
    if (pending >= 40) return fail('Terlalu banyak unggahan yang belum selesai. Tunggu sebentar atau muat ulang halaman.', 429);
    const id = rand(16);
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'video/quicktime' ? 'mov' : 'mp4';
    const objKey = 'p/' + id + '.' + ext;
    const num = (v) => (isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 1000) / 1000 : 0);
    return reply('media_insert', { ok: true, media_id: id, upload_url: s3PresignPut(objKey, mime, size, 3600), headers: { 'content-type': mime } }, {
      media: { media_id: id, owner_id: gid, kind, mime, obj_key: objKey, size, width: num(p.width), height: num(p.height), duration: num(p.duration),
        fps: num(p.fps), video_codec: String(p.video_codec || '').slice(0, 8), audio_codec: String(p.audio_codec || '').slice(0, 8),
        status: 'uploading', verified: false, post_id: '', expires_at: new Date(Date.now() + 6 * 3600000).toISOString(), note: String(p.name || '').slice(0, 120) },
    });
  }

  case 'media.finish': {
    const m = latestRow(mediaRows, 'media_id', String(p.media_id || ''));
    if (!m) return fail('Media tidak ditemukan.', 404);
    if (m.status === 'ready') return ok({ media: publicMedia(m) });
    if (m.status !== 'uploading') return fail('Media sudah tidak bisa dipakai. Unggah ulang.', 409);
    const head = await s3Request('HEAD', m.obj_key);
    if (!head.ok) return fail(head.status === 404 ? 'File belum sampai di server media. Unggah ulang.' : 'Server media tidak bisa diperiksa (' + (head.error || head.status) + ').', head.status === 404 ? 409 : 502);
    const size = Number(head.headers['content-length']);
    const reject = async (msg) => {
      await s3Request('DELETE', m.obj_key);
      return reply('media_update', { ok: false, error: msg }, { status: 422, media: Object.assign({}, m, { status: 'rejected', note: msg.slice(0, 200) }) });
    };
    if (size !== Number(m.size)) return reject('Ukuran file di server tidak sama dengan yang diunggah. Unggah ulang.');
    const want = Math.min(size, m.kind === 'video' ? 4 * MB : 256 * 1024) - 1;
    const part = await s3Request('GET', m.obj_key, { range: 'bytes=0-' + want });
    if (!part.ok) return fail('Server media tidak bisa dibaca (' + (part.error || part.status) + ').', 502);
    const sn = sniffMedia(part.body);
    if (!sn || sn.kind !== m.kind) return reject('Isi file bukan ' + (m.kind === 'video' ? 'video MP4/MOV' : 'foto JPEG') + ' yang valid.');
    const upd = { status: 'ready', verified: false, expires_at: new Date(Date.now() + 24 * 3600000).toISOString() };
    if (sn.kind === 'image') {
      if (sn.mime !== 'image/jpeg') return reject('Foto harus JPEG.');
      const d = jpegSize(part.body);
      if (d) Object.assign(upd, { width: d.width, height: d.height, verified: true });
      const w = upd.width || Number(m.width), h = upd.height || Number(m.height);
      if (!(w > 0 && h > 0)) return reject('Ukuran foto tidak terbaca.');
      if (Math.min(w, h) < 200) return reject('Foto terlalu kecil (minimal 320 px).');
    } else {
      if (!['video/mp4', 'video/quicktime'].includes(sn.mime)) return reject('Video harus MP4 atau MOV.');
      const info = mp4Info(part.body);
      if (info.moov) {
        Object.assign(upd, { duration: Math.round(info.duration * 1000) / 1000, width: info.width, height: info.height, fps: info.fps,
          video_codec: info.video_codec, audio_codec: info.audio_codec, verified: true });
        if (!info.video_codec) return reject('File tidak berisi trek video.');
      }
      const dur = upd.duration || Number(m.duration);
      if (!(dur > 0)) return reject('Durasi video tidak terbaca. Ekspor ulang sebagai MP4 (H.264).');
      if (dur < 3) return reject('Video minimal 3 detik.');
      upd.note = info.faststart ? '' : 'moov-akhir';
    }
    const row = Object.assign({}, m, upd);
    return reply('media_update', { ok: true, media: publicMedia(row) }, { media: row });
  }

  case 'post.create': {
    if (!s3Ready()) return fail('Penyimpanan media belum disiapkan admin Wanychat.', 503);
    const ref = String(p.client_ref || '').slice(0, 64);
    if (ref) {
      const dup = posts.find(x => x.client_ref === ref);
      if (dup) return ok({ post: publicPost(dup), duplicate: true });
    }
    const ids = Array.isArray(p.media_ids) ? p.media_ids.map(String) : [];
    if (new Set(ids).size !== ids.length) return fail('Media dobel di daftar.');
    const media = ids.map(id => latestRow(mediaRows, 'media_id', id));
    if (!media.length || media.some(m => !m)) return fail('Media tidak ditemukan. Unggah ulang.', 404);
    if (media.some(m => m.status !== 'ready')) return fail('Ada media yang belum selesai diunggah atau sudah kedaluwarsa. Unggah ulang.', 409);
    if (media.some(m => m.post_id)) return fail('Media ini sudah dipakai di posting lain. Unggah ulang untuk posting baru.', 409);
    const shape = postShape(media);
    if (shape) return fail(shape);
    const caption = String(p.caption || '').replace(/\r\n/g, '\n').trim();
    const tOpt = p.tiktok || {};
    const ttOpt = {
      privacy: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(tOpt.privacy) ? tOpt.privacy : 'PUBLIC_TO_EVERYONE',
      disable_comment: !!tOpt.disable_comment, disable_duet: !!tOpt.disable_duet, disable_stitch: !!tOpt.disable_stitch,
      brand_organic: !!tOpt.brand_organic, branded: !!tOpt.branded, ai_generated: !!tOpt.ai_generated, auto_music: !!tOpt.auto_music,
      title: String(tOpt.title || '').trim().slice(0, 200),
    };
    const igOpt = { share_to_feed: (p.instagram || {}).share_to_feed !== false };
    const wanted = Array.isArray(p.targets) ? p.targets : [];
    if (!wanted.length) return fail('Pilih minimal satu akun tujuan.');
    if (wanted.length > 20) return fail('Maksimal 20 akun tujuan per posting.');
    const seen = new Set();
    const dests = await destinations(true);
    const errors = [];
    const rows = [];
    let when = p.schedule_at ? new Date(p.schedule_at) : new Date();
    if (isNaN(when.getTime())) return fail('Waktu jadwal tidak valid.');
    if (when.getTime() < Date.now() - 60000) {
      if (p.schedule_at) return fail('Waktu jadwal sudah lewat.');
      when = new Date();
    }
    if (when.getTime() > Date.now() + 30 * 86400000) return fail('Jadwal maksimal 30 hari dari sekarang.');
    for (const w of wanted) {
      const type = w && w.type === 'tiktok' ? 'tiktok' : 'instagram';
      const id = String((w && w.id) || '');
      if (seen.has(type + id)) continue;
      seen.add(type + id);
      const d = dests.find(x => x.type === type && x.id === id);
      if (!d) { errors.push((type === 'tiktok' ? 'TikTok' : 'Instagram') + ' · akun tidak ditemukan.'); continue; }
      const who = (type === 'tiktok' ? 'TikTok' : 'Instagram') + ' @' + (d.username || id);
      if (!d.can_publish) { errors.push(who + ': ' + (d.reason || 'tidak bisa posting.')); continue; }
      const cap = typeof w.caption === 'string' && w.caption.trim() ? w.caption.replace(/\r\n/g, '\n').trim() : caption;
      const errs = checkTarget(type, media, cap, ttOpt, d.limits);
      if (errs.length) { errors.push(...errs.map(e => e.replace(/^(Instagram|TikTok) · /, who + ' · '))); continue; }
      if (d.quota && d.quota.used >= d.quota.total) { errors.push(who + ': batas ' + d.quota.total + ' posting per 24 jam sudah tercapai.'); continue; }
      const isVideo = media.length === 1 && media[0].kind === 'video';
      rows.push({
        platform: type, account_id: id, username: d.username, caption: cap,
        kind: type === 'tiktok' ? (isVideo ? 'video' : 'photo') : (media.length > 1 ? 'carousel' : isVideo ? 'reels' : 'image'),
        options: JSON.stringify(type === 'tiktok' ? ttOpt : igOpt),
      });
    }
    if (errors.length) return fail('Posting belum bisa dikirim:\n• ' + errors.slice(0, 12).join('\n• '), 422, { errors });
    const limit = Number(plan.posts ?? 10);
    if (limit > 0 && monthUsed() + rows.length > limit) return fail('Kuota posting paket ' + plan.name + ' tinggal ' + Math.max(0, limit - monthUsed()) + ' dari ' + limit + ' per bulan (dihitung per akun tujuan). Upgrade di menu Langganan.', 403);
    const postId = 'pst_' + rand(10);
    const mediaJson = JSON.stringify(media.map(m => ({ media_id: m.media_id, kind: m.kind, mime: m.mime, url: s3PublicUrl(m.obj_key),
      width: Number(m.width) || 0, height: Number(m.height) || 0, duration: Number(m.duration) || 0 })));
    const at = when.toISOString();
    const post = { post_id: postId, owner_id: gid, user_id: String(user.uid), kind: media.length > 1 ? 'carousel' : media[0].kind, caption, media: mediaJson,
      options: JSON.stringify({ tiktok: ttOpt, instagram: igOpt }), scheduled_at: at, client_ref: ref };
    const targetRows = rows.map(r => Object.assign(r, {
      post_id: postId, owner_id: gid, media: mediaJson, status: 'queued', container_id: '', children: '', publish_id: '', media_id: '', permalink: '',
      error: '', error_stage: '', retryable: false, tries: 0, scheduled_at: at, next_at: at, started_at: null, done_at: null, note: '',
    }));
    // Media disimpan sampai 3 hari setelah jadwal (cukup untuk antrean, polling status, dan coba ulang)
    const keep = new Date(when.getTime() + 3 * 86400000).toISOString();
    const mediaUpd = media.map(m => Object.assign({}, m, { post_id: postId, expires_at: keep }));
    const view = { post_id: postId, caption, kind: post.kind, media: JSON.parse(mediaJson), scheduled_at: at, created_at: nowIso(),
      status: when.getTime() > Date.now() + 60000 ? 'scheduled' : 'processing',
      targets: targetRows.map(t => ({ id: 0, platform: t.platform, account_id: t.account_id, username: t.username, status: 'queued', media_id: '', permalink: '', error: '', retryable: false, scheduled_at: at, done_at: '', note: '' })) };
    return withTt(reply('post_create', { ok: true, post: view }, { post, targets: targetRows, media_rows: mediaUpd }));
  }

  case 'post.list': {
    const list = posts.slice().sort((a, b) => Number(b.id) - Number(a.id)).slice(0, Math.min(Number(p.limit) || 30, 100)).map(publicPost);
    const limit = Number(plan.posts ?? 10);
    return ok({ posts: list, plan: { name: plan.name, posts: limit, used: monthUsed() } });
  }

  case 'post.get': {
    const pp = latestRow(posts, 'post_id', String(p.post_id || ''));
    if (!pp) return fail('Posting tidak ditemukan.', 404);
    return ok({ post: publicPost(pp) });
  }

  case 'post.cancel': {
    const pp = latestRow(posts, 'post_id', String(p.post_id || ''));
    if (!pp) return fail('Posting tidak ditemukan.', 404);
    const q = targets.filter(t => t.post_id === pp.post_id && t.status === 'queued' && !t.container_id && !t.publish_id);
    if (!q.length) return fail('Tidak ada target yang masih menunggu. Posting yang sedang diproses tidak bisa dibatalkan.', 409);
    const upd = q.map(t => targetUpdate(t, { status: 'canceled', error: 'Dibatalkan', retryable: false, done_at: nowIso() }));
    return reply('targets_update', { ok: true, canceled: upd.length }, { updates: upd });
  }

  case 'post.retry': {
    const pp = latestRow(posts, 'post_id', String(p.post_id || ''));
    if (!pp) return fail('Posting tidak ditemukan.', 404);
    const want = Array.isArray(p.target_ids) ? p.target_ids.map(Number) : null;
    const media = parseJson(pp.media, []).map(x => latestRow(mediaRows, 'media_id', x.media_id));
    if (media.some(m => !m || m.status !== 'ready')) return fail('Media posting ini sudah dihapus dari server (lebih dari 3 hari). Buat posting baru.', 410);
    const q = targets.filter(t => t.post_id === pp.post_id && t.status === 'failed' && isTrue(t.retryable) && (!want || want.includes(Number(t.id))));
    if (!q.length) return fail('Tidak ada target gagal yang bisa dicoba ulang.', 409);
    const at = nowIso();
    const keep = new Date(Date.now() + 3 * 86400000).toISOString();
    const upd = q.map(t => targetUpdate(t, { status: 'queued', error: '', error_stage: '', retryable: false, tries: 0, container_id: '', children: '', publish_id: '',
      media_id: '', permalink: '', note: '', next_at: at, started_at: null, done_at: null }));
    return reply('targets_update', { ok: true, retried: upd.length }, { updates: upd, media_rows: media.map(m => Object.assign({}, m, { expires_at: keep })) });
  }

  default:
    return fail('Aksi tidak dikenal: ' + action);
}

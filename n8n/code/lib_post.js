// ---- lib_post.js (disisipkan build.py lewat //#include) ----
// Posting multi-platform: aturan format konten per platform (dari dokumentasi resmi, Nov 2026) + pemetaan galat.
// Instagram: Content Publishing API (Instagram Login, graph.instagram.com). TikTok: Accounts API /business/video|photo/publish/.
const MB = 1024 * 1024;
const POST_RULES = {
  caption_max: 2200,             // IG & video TikTok (UTF-16); foto TikTok 4000
  tt_photo_caption_max: 4000,
  tt_title_max: 90,
  ig_hashtags_max: 30,
  ig_mentions_max: 20,
  tt_mentions_max: 30,
  carousel_min: 2,
  ig_carousel_max: 10,
  tt_photo_max: 35,
  ig_image: { mimes: ['image/jpeg'], max_bytes: 8 * MB, min_ratio: 0.8, max_ratio: 1.91, min_width: 320 },
  tt_image: { mimes: ['image/jpeg', 'image/webp'], max_bytes: 20 * MB, max_long: 1920, max_short: 1080, min_side: 360 },
  ig_video: { min_sec: 3, max_sec: 900, max_bytes: 300 * MB, fps: [23, 60], max_width: 1920, codecs: ['avc1', 'avc3', 'hvc1', 'hev1'], audio: ['mp4a', ''], max_mbps: 25 },
  ig_carousel_video: { min_sec: 3, max_sec: 60 },
  tt_video: { min_sec: 3, max_sec: 600, max_bytes: 1024 * MB, fps: [23, 60], min_side: 360, max_side: 4096, codecs: ['avc1', 'avc3', 'hvc1', 'hev1', 'vp08', 'vp09'] },
  tt_daily: 15,                  // batas TikTok per akun per hari lewat API
  ig_daily: 50,                  // cadangan bila content_publishing_limit tidak terbaca
};
const UPLOAD_MIMES = ['image/jpeg', 'video/mp4', 'video/quicktime'];
const postMaxVideoBytes = () => Math.min(POST_RULES.ig_video.max_bytes, Math.max(10, Number(settings.post_max_video_mb) || 250) * MB);
const ACTIVE_TARGET = ['queued', 'processing'];
const TERMINAL_TARGET = ['published', 'failed', 'canceled'];

const countHashtags = (s) => (String(s).match(/(^|[^&\w])#[\p{L}\p{N}_]+/gu) || []).length;
const countMentions = (s) => (String(s).match(/(^|[^\w])@[\w.]{1,30}/g) || []).length;
const fmtSec = (s) => s >= 60 ? Math.floor(s / 60) + ' menit' + (s % 60 ? ' ' + Math.round(s % 60) + ' detik' : '') : Math.round(s) + ' detik';
const fmtMb = (b) => (Math.round(b / MB * 10) / 10) + ' MB';

// Jenis posting per platform dari daftar media (urut). Mengembalikan galat (string) atau null.
function postShape(media) {
  if (!media.length) return 'Pilih minimal satu foto atau video.';
  if (media.length === 1) return null;
  if (media.length < POST_RULES.carousel_min) return 'Carousel minimal 2 media.';
  return null;
}

// Validasi lengkap satu target. m = baris wany_media (sudah diverifikasi server), opt = opsi posting.
// Mengembalikan daftar galat yang bisa dibaca user (bahasa Indonesia).
function checkTarget(platform, media, caption, opt, ttLimits) {
  const errs = [];
  const label = platform === 'instagram' ? 'Instagram' : 'TikTok';
  const carousel = media.length > 1;
  const videos = media.filter(m => m.kind === 'video');
  const images = media.filter(m => m.kind === 'image');
  const cap = String(caption || '');
  const name = (m, i) => carousel ? 'Media ke-' + (i + 1) : (m.kind === 'video' ? 'Video' : 'Foto');
  if (platform === 'instagram') {
    if (cap.length > POST_RULES.caption_max) errs.push('Caption Instagram maksimal ' + POST_RULES.caption_max + ' karakter (sekarang ' + cap.length + ').');
    if (countHashtags(cap) > POST_RULES.ig_hashtags_max) errs.push('Instagram maksimal ' + POST_RULES.ig_hashtags_max + ' hashtag per postingan.');
    if (countMentions(cap) > POST_RULES.ig_mentions_max) errs.push('Instagram maksimal ' + POST_RULES.ig_mentions_max + ' @mention per postingan.');
    if (carousel && media.length > POST_RULES.ig_carousel_max) errs.push('Carousel Instagram maksimal ' + POST_RULES.ig_carousel_max + ' media.');
    media.forEach((m, i) => {
      const n = name(m, i);
      if (m.kind === 'image') {
        const r = POST_RULES.ig_image;
        if (!r.mimes.includes(m.mime)) errs.push(n + ': Instagram hanya menerima foto JPEG.');
        if (Number(m.size) > r.max_bytes) errs.push(n + ': foto Instagram maksimal ' + fmtMb(r.max_bytes) + '.');
        const ratio = Number(m.width) / Number(m.height);
        if (m.width && m.height && (ratio < r.min_ratio - 0.01 || ratio > r.max_ratio + 0.01)) errs.push(n + ': rasio foto Instagram harus antara 4:5 (potret) dan 1.91:1 (lanskap).');
        if (m.width && Number(m.width) < r.min_width) errs.push(n + ': lebar foto minimal ' + r.min_width + ' px.');
      } else {
        const r = POST_RULES.ig_video;
        const lim = carousel ? POST_RULES.ig_carousel_video : r;
        if (!['video/mp4', 'video/quicktime'].includes(m.mime)) errs.push(n + ': Instagram hanya menerima video MP4/MOV.');
        if (Number(m.size) > r.max_bytes) errs.push(n + ': video Instagram maksimal ' + fmtMb(r.max_bytes) + '.');
        if (m.duration && (m.duration < lim.min_sec - 0.05 || m.duration > lim.max_sec + 0.5)) errs.push(n + ': durasi video Instagram ' + (carousel ? 'di carousel ' : '') + 'harus ' + lim.min_sec + ' detik sampai ' + fmtSec(lim.max_sec) + ' (sekarang ' + fmtSec(m.duration) + ').');
        if (m.fps && (m.fps < r.fps[0] - 0.5 || m.fps > r.fps[1] + 0.5)) errs.push(n + ': frame rate harus ' + r.fps[0] + '-' + r.fps[1] + ' FPS (sekarang ' + Math.round(m.fps) + ').');
        if (m.width && Number(m.width) > r.max_width) errs.push(n + ': lebar video Instagram maksimal ' + r.max_width + ' px (sekarang ' + m.width + ').');
        if (m.video_codec && !r.codecs.includes(m.video_codec)) errs.push(n + ': codec video harus H.264 atau HEVC (sekarang ' + m.video_codec + ').');
        if (m.audio_codec && !r.audio.includes(m.audio_codec)) errs.push(n + ': audio video Instagram harus AAC (sekarang ' + m.audio_codec + ').');
        if (m.duration && Number(m.size) * 8 / m.duration / 1e6 > r.max_mbps * 1.05) errs.push(n + ': bitrate video Instagram maksimal ' + r.max_mbps + ' Mbps. Ekspor ulang dengan kualitas lebih rendah.');
      }
    });
  } else {
    const photo = videos.length === 0;
    const capMax = photo ? POST_RULES.tt_photo_caption_max : POST_RULES.caption_max;
    if (cap.length > capMax) errs.push('Caption TikTok maksimal ' + capMax + ' karakter (sekarang ' + cap.length + ').');
    if (countMentions(cap) > POST_RULES.tt_mentions_max) errs.push('TikTok maksimal ' + POST_RULES.tt_mentions_max + ' @mention per postingan.');
    if (photo && String((opt && opt.title) || '').length > POST_RULES.tt_title_max) errs.push('Judul foto TikTok maksimal ' + POST_RULES.tt_title_max + ' karakter.');
    if (carousel && videos.length) errs.push('TikTok tidak menerima carousel berisi video. Pakai satu video saja, atau carousel foto saja.');
    if (photo && media.length > POST_RULES.tt_photo_max) errs.push('Postingan foto TikTok maksimal ' + POST_RULES.tt_photo_max + ' foto.');
    media.forEach((m, i) => {
      const n = name(m, i);
      if (m.kind === 'image') {
        const r = POST_RULES.tt_image;
        if (!r.mimes.includes(m.mime)) errs.push(n + ': TikTok hanya menerima foto JPEG atau WebP.');
        if (Number(m.size) > r.max_bytes) errs.push(n + ': foto TikTok maksimal ' + fmtMb(r.max_bytes) + '.');
        const lo = Math.min(m.width, m.height), hi = Math.max(m.width, m.height);
        if (m.width && (hi > r.max_long || lo > r.max_short)) errs.push(n + ': resolusi foto TikTok maksimal 1080x1920 (sekarang ' + m.width + 'x' + m.height + ').');
        if (m.width && lo < r.min_side) errs.push(n + ': sisi terpendek foto TikTok minimal ' + r.min_side + ' px.');
      } else {
        const r = POST_RULES.tt_video;
        const maxSec = Math.min(r.max_sec, Number(ttLimits && ttLimits.max_sec) || r.max_sec);
        if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(m.mime)) errs.push(n + ': TikTok hanya menerima video MP4, MOV, atau WebM.');
        if (Number(m.size) > r.max_bytes) errs.push(n + ': video TikTok maksimal ' + fmtMb(r.max_bytes) + '.');
        if (m.duration && (m.duration < r.min_sec - 0.05 || m.duration > maxSec + 0.5)) errs.push(n + ': durasi video TikTok untuk akun ini harus ' + r.min_sec + ' detik sampai ' + fmtSec(maxSec) + ' (sekarang ' + fmtSec(m.duration) + ').');
        if (m.fps && (m.fps < r.fps[0] - 0.5 || m.fps > r.fps[1] + 0.5)) errs.push(n + ': frame rate harus ' + r.fps[0] + '-' + r.fps[1] + ' FPS (sekarang ' + Math.round(m.fps) + ').');
        if (m.width && (Math.min(m.width, m.height) < r.min_side || Math.max(m.width, m.height) > r.max_side)) errs.push(n + ': resolusi video TikTok harus ' + r.min_side + '-' + r.max_side + ' px per sisi (sekarang ' + m.width + 'x' + m.height + ').');
        if (m.video_codec && !r.codecs.includes(m.video_codec)) errs.push(n + ': codec video TikTok harus H.264, H.265, VP8, atau VP9 (sekarang ' + m.video_codec + ').');
      }
    });
    if (photo && opt && opt.privacy && ttLimits && Array.isArray(ttLimits.privacy) && ttLimits.privacy.length && !ttLimits.privacy.includes(opt.privacy)) {
      errs.push('Privasi "' + opt.privacy + '" tidak tersedia untuk akun TikTok ini.');
    }
  }
  return errs.map(e => label + ' · ' + e);
}

// Alasan gagal TikTok (post.publish.failed / publish/status) -> pesan user + boleh dicoba ulang?
const TT_FAIL = {
  file_format_check_failed: ['Format file ditolak TikTok. Pakai MP4 H.264 atau foto JPEG.', false],
  duration_check_failed: ['Durasi video tidak memenuhi syarat akun TikTok ini.', false],
  frame_rate_check_failed: ['Frame rate video harus 23-60 FPS.', false],
  picture_size_check_failed: ['Resolusi terlalu kecil (minimal 360 px).', false],
  internal: ['Server TikTok sedang bermasalah.', true],
  video_pull_failed: ['TikTok gagal mengunduh video dari server media.', true],
  photo_pull_failed: ['TikTok gagal mengunduh foto dari server media.', true],
  auth_removed: ['Izin Wanychat di akun TikTok ini dicabut. Hubungkan ulang akun.', false],
  spam_risk_too_many_posts: ['Akun ini sudah terlalu banyak posting lewat API dalam 24 jam. Coba lagi besok.', true],
  spam_risk_user_banned_from_posting: ['Akun TikTok ini sedang diblokir untuk posting.', false],
  spam_risk_text: ['TikTok menilai caption berisiko spam. Ubah caption lalu posting ulang.', false],
  spam_risk: ['TikTok menolak posting karena risiko spam. Coba lagi nanti dari aplikasi TikTok.', false],
  publish_cancelled: ['Posting dibatalkan.', false],
  url_ownership_unverified: ['Domain media belum diverifikasi di TikTok (admin Wanychat perlu memverifikasinya).', true],
};
const ttFailText = (reason) => {
  const r = TT_FAIL[String(reason || '')];
  return r ? { error: r[0], retryable: r[1] } : { error: 'TikTok menolak posting: ' + String(reason || 'alasan tidak diketahui'), retryable: true };
};

// Galat Graph API Instagram -> pesan user
function igErrText(e) {
  const msg = String((e && (e.error_user_msg || e.message)) || e || '');
  const code = Number(e && e.code), sub = Number(e && e.error_subcode);
  if (code === 190) return { error: 'Izin Instagram kedaluwarsa. Hubungkan ulang akun.', retryable: false, auth: true };
  if (code === 10 || code === 200 || /permission|not authorized/i.test(msg)) return { error: 'Akun belum memberi izin posting ke Wanychat (instagram_business_content_publish). Klik "Izinkan posting".', retryable: false, auth: true };
  if (code === 9 || sub === 2207042) return { error: 'Batas posting Instagram lewat API untuk 24 jam terakhir sudah habis. Coba lagi nanti.', retryable: true };
  if (code === 4 || code === 17 || code === 32 || code === 613) return { error: 'Instagram sedang membatasi permintaan. Dicoba lagi otomatis.', retryable: true };
  if (sub === 2207026 || /video format|unsupported/i.test(msg)) return { error: 'Format video ditolak Instagram: ' + msg, retryable: false };
  if (sub === 2207003 || sub === 2207020 || /download|fetch|timeout/i.test(msg)) return { error: 'Instagram gagal mengunduh media: ' + msg, retryable: true };
  return { error: 'Instagram: ' + msg.slice(0, 300), retryable: Number(e && e.is_transient) === 1 || code === 1 || code === 2 };
}

// Status agregat satu posting dari target-targetnya
function postStatus(targets) {
  if (!targets.length) return 'failed';
  const s = targets.map(t => t.status);
  if (s.some(x => ACTIVE_TARGET.includes(x))) {
    const now = Date.now();
    return targets.every(t => t.status === 'queued' && t.scheduled_at && new Date(t.scheduled_at).getTime() > now + 60000) ? 'scheduled' : 'processing';
  }
  if (s.every(x => x === 'published')) return 'published';
  if (s.every(x => x === 'canceled')) return 'canceled';
  if (s.some(x => x === 'published')) return 'partial';
  return 'failed';
}

// Kolom target yang berubah selama proses; update selalu mengirim semuanya (node Data Table menimpa kolom yang dipetakan)
const TARGET_MUTABLE = ['status', 'container_id', 'children', 'publish_id', 'media_id', 'permalink', 'error', 'error_stage', 'retryable', 'tries',
  'next_at', 'started_at', 'done_at', 'note'];
function targetUpdate(t, fields) {
  const r = { id: Number(t.id) };
  for (const k of TARGET_MUTABLE) r[k] = t[k] === undefined ? null : t[k];
  Object.assign(r, fields || {});
  for (const k of ['container_id', 'children', 'publish_id', 'media_id', 'permalink', 'error', 'error_stage', 'note']) r[k] = String(r[k] ?? '').slice(0, k === 'error' ? 500 : 2000);
  r.retryable = r.retryable === true || r.retryable === 'true';
  r.tries = Number(r.tries) || 0;
  for (const k of ['next_at', 'started_at', 'done_at']) r[k] = r[k] || null;
  return r;
}

const parseJson = (s, d) => { try { const v = JSON.parse(s || ''); return v == null ? d : v; } catch (e) { return d; } };
// ---- akhir lib_post.js ----

import { ApiError } from './api'

// Posting multi-platform: klien untuk workflow n8n "Wanychat · Posting" (/post-api), pengolahan media di browser
// (foto -> JPEG, cek MP4, "faststart"), unggah langsung ke bucket R2, dan aturan format yang sama dengan n8n/code/lib_post.js.

export type Platform = 'instagram' | 'tiktok'
export type TargetStatus = 'queued' | 'processing' | 'published' | 'failed' | 'canceled'
export type PostStatus = 'scheduled' | 'processing' | 'published' | 'partial' | 'failed' | 'canceled'

export interface Destination {
  type: Platform
  id: string
  username: string
  avatar: string
  active: boolean
  can_publish: boolean
  need_auth?: boolean
  reason: string
  quota: { used: number; total: number } | null
  limits?: { privacy: string[]; max_sec: number; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }
}

export interface Rules {
  caption_max: number
  tt_photo_caption_max: number
  tt_title_max: number
  ig_hashtags_max: number
  ig_mentions_max: number
  tt_mentions_max: number
  carousel_min: number
  ig_carousel_max: number
  tt_photo_max: number
  ig_image: { mimes: string[]; max_bytes: number; min_ratio: number; max_ratio: number; min_width: number }
  tt_image: { mimes: string[]; max_bytes: number; max_long: number; max_short: number; min_side: number }
  ig_video: { min_sec: number; max_sec: number; max_bytes: number; fps: [number, number]; max_width: number; codecs: string[]; audio: string[]; max_mbps: number }
  ig_carousel_video: { min_sec: number; max_sec: number }
  tt_video: { min_sec: number; max_sec: number; max_bytes: number; fps: [number, number]; min_side: number; max_side: number; codecs: string[] }
  tt_daily: number
}

export interface PostConfig {
  ready: boolean
  accounts: Destination[]
  plan: { name: string; posts: number; used: number }
  rules: Rules
  max_video_bytes: number
}

export interface PostMedia { media_id: string; kind: 'image' | 'video'; mime: string; url: string; width: number; height: number; duration: number }
export interface PostTarget {
  id: number
  platform: Platform
  account_id: string
  username: string
  status: TargetStatus
  media_id: string
  permalink: string
  error: string
  retryable: boolean
  scheduled_at: string
  done_at: string
  note: string
}
export interface PostView {
  post_id: string
  caption: string
  kind: string
  media: PostMedia[]
  scheduled_at: string
  created_at: string
  status: PostStatus
  targets: PostTarget[]
}

export interface TtOptions {
  privacy: string
  disable_comment: boolean
  disable_duet: boolean
  disable_stitch: boolean
  brand_organic: boolean
  branded: boolean
  ai_generated: boolean
  auto_music: boolean
  title: string
}

// Izin posting diminta terpisah dari koneksi biasa (scope baru butuh review Meta/TikTok)
export const publishAuthUrl = (t: Platform) => (t === 'tiktok' ? '/webhook/wany-tiktok-start' : '/webhook/wany-login') + '?publish=1'

export async function postApi<T = Record<string, unknown>>(action: string, payload?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch('/post-api', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action, payload }),
    })
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi internet kamu.', 0)
  }
  let data: { ok?: boolean; error?: string } & Record<string, unknown>
  try { data = await res.json() } catch { throw new ApiError(`Server sedang bermasalah (HTTP ${res.status}). Coba lagi sebentar lagi.`, res.status) }
  if (!data.ok) throw Object.assign(new ApiError(data.error || 'Permintaan gagal', res.status), { data })
  return data as T
}

// ---------------------------------------------------------------- deteksi & metadata file
export interface Mp4Info {
  brand: string; moov: boolean; faststart: boolean; duration: number; width: number; height: number
  video_codec: string; audio_codec: string; fps: number; edit_list: boolean
  moovStart: number; moovSize: number; firstMdat: number
}

async function bytes(blob: Blob, start: number, end: number) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}
const str = (b: Uint8Array, i: number, n = 4) => String.fromCharCode(...b.subarray(i, i + n))

export async function sniffFile(file: Blob): Promise<{ mime: string; kind: 'image' | 'video' } | null> {
  const b = await bytes(file, 0, 16)
  const hex = (i: number, n: number) => Array.from(b.subarray(i, i + n), (x) => x.toString(16).padStart(2, '0')).join('')
  if (hex(0, 3) === 'ffd8ff') return { mime: 'image/jpeg', kind: 'image' }
  if (hex(0, 8) === '89504e470d0a1a0a') return { mime: 'image/png', kind: 'image' }
  if (hex(0, 4) === '52494646' && hex(8, 4) === '57454250') return { mime: 'image/webp', kind: 'image' }
  if (hex(0, 6) === '474946383961' || hex(0, 6) === '474946383761') return { mime: 'image/gif', kind: 'image' }
  if (hex(0, 4) === '1a45dfa3') return { mime: 'video/webm', kind: 'video' }
  if (str(b, 4) === 'ftyp') {
    const brand = str(b, 8)
    if (/^(heic|heix|hevc|mif1|msf1|avif)/.test(brand)) return { mime: 'image/heic', kind: 'image' }
    return { mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4', kind: 'video' }
  }
  return null
}

type Box = { type: string; start: number; size: number; head: number }
function boxesIn(dv: DataView, b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = []
  let i = start
  while (i + 8 <= end) {
    let size = dv.getUint32(i)
    const type = str(b, i + 4)
    let head = 8
    if (size === 1) { size = Number(dv.getBigUint64(i + 8)); head = 16 } else if (size === 0) size = end - i
    if (size < head || i + size > end) break
    out.push({ type, start: i, size, head })
    i += size
  }
  return out
}

// Kotak tingkat atas dibaca per header (tanpa memuat seluruh video), lalu kotak moov dibaca utuh
export async function inspectMp4(file: Blob): Promise<Mp4Info> {
  const info: Mp4Info = { brand: '', moov: false, faststart: false, duration: 0, width: 0, height: 0, video_codec: '', audio_codec: '', fps: 0, edit_list: false, moovStart: -1, moovSize: 0, firstMdat: -1 }
  const top: Box[] = []
  let off = 0
  while (off + 8 <= file.size && top.length < 64) {
    const h = await bytes(file, off, off + 16)
    const dv = new DataView(h.buffer)
    let size = dv.getUint32(0)
    const type = str(h, 4)
    let head = 8
    if (size === 1) { size = Number(dv.getBigUint64(8)); head = 16 } else if (size === 0) size = file.size - off
    if (size < head) break
    top.push({ type, start: off, size, head })
    if (type === 'ftyp') info.brand = str(h, 8)
    off += size
  }
  const moov = top.find((x) => x.type === 'moov')
  const mdat = top.find((x) => x.type === 'mdat')
  info.firstMdat = mdat ? mdat.start : -1
  info.faststart = !!moov && (!mdat || moov.start < mdat.start)
  if (!moov || moov.size > 64 * 1024 * 1024 || moov.start + moov.size > file.size) return info
  info.moov = true
  info.moovStart = moov.start
  info.moovSize = moov.size
  const b = await bytes(file, moov.start, moov.start + moov.size)
  const dv = new DataView(b.buffer)
  const root: Box = { type: 'moov', start: 0, size: moov.size, head: moov.head }
  const kids = (x: Box) => boxesIn(dv, b, x.start + x.head, x.start + x.size)
  const find = (x: Box, path: string[]) => {
    let cur: Box | undefined = x
    for (const t of path) { cur = cur && kids(cur).find((k) => k.type === t); if (!cur) return null }
    return cur || null
  }
  const full = (x: Box) => ({ version: b[x.start + x.head], body: x.start + x.head + 4 })
  const timing = (x: Box) => {
    const { version, body } = full(x)
    return version === 1 ? { scale: dv.getUint32(body + 16), dur: Number(dv.getBigUint64(body + 20)) } : { scale: dv.getUint32(body + 8), dur: dv.getUint32(body + 12) }
  }
  const mvhd = find(root, ['mvhd'])
  if (mvhd) { const t = timing(mvhd); if (t.scale) info.duration = t.dur / t.scale }
  for (const trak of kids(root).filter((k) => k.type === 'trak')) {
    if (find(trak, ['edts', 'elst'])) info.edit_list = true
    const hdlr = find(trak, ['mdia', 'hdlr'])
    const handler = hdlr ? str(b, full(hdlr).body + 4) : ''
    const stsd = find(trak, ['mdia', 'minf', 'stbl', 'stsd'])
    const codec = stsd ? str(b, full(stsd).body + 8) : ''
    if (handler === 'vide') {
      info.video_codec = codec
      const tkhd = find(trak, ['tkhd'])
      if (tkhd) {
        const end = tkhd.start + tkhd.size
        info.width = Math.round(dv.getUint32(end - 8) / 65536)
        info.height = Math.round(dv.getUint32(end - 4) / 65536)
        const { version, body } = full(tkhd)
        const m = body + (version === 1 ? 32 : 20) + 16
        if (dv.getInt32(m) === 0 && Math.abs(dv.getInt32(m + 4)) === 65536) [info.width, info.height] = [info.height, info.width]
      }
      const mdhd = find(trak, ['mdia', 'mdhd'])
      const stts = find(trak, ['mdia', 'minf', 'stbl', 'stts'])
      if (mdhd && stts) {
        const t = timing(mdhd)
        const sb = full(stts).body
        const n = dv.getUint32(sb)
        let samples = 0
        for (let k = 0; k < n && sb + 8 + k * 8 <= stts.start + stts.size; k++) samples += dv.getUint32(sb + 4 + k * 8)
        if (t.scale && t.dur) info.fps = Math.round((samples / (t.dur / t.scale)) * 100) / 100
      }
    } else if (handler === 'soun') info.audio_codec = codec
  }
  return info
}

// "Faststart": pindahkan moov ke depan mdat (syarat Instagram: moov atom di depan) tanpa encode ulang.
// Offset chunk (stco/co64) yang menunjuk ke data di antara titik sisip dan posisi moov lama digeser sebesar ukuran moov.
export async function faststart(file: Blob, info: Mp4Info): Promise<Blob> {
  if (!info.moov || info.faststart || info.firstMdat < 0) return file
  const insert = info.firstMdat
  const moovEnd = info.moovStart + info.moovSize
  const moov = await bytes(file, info.moovStart, moovEnd)
  const dv = new DataView(moov.buffer)
  const shift = (o: number) => (o >= moovEnd ? o : o >= insert ? o + info.moovSize : o)
  const walk = (start: number, end: number): boolean => {
    for (const x of boxesIn(dv, moov, start, end)) {
      if (['trak', 'mdia', 'minf', 'stbl'].includes(x.type)) { if (!walk(x.start + x.head, x.start + x.size)) return false; continue }
      if (x.type === 'stco' || x.type === 'co64') {
        const body = x.start + x.head + 4
        const n = dv.getUint32(body)
        for (let k = 0; k < n; k++) {
          if (x.type === 'stco') {
            const p = body + 4 + k * 4
            const v = shift(dv.getUint32(p))
            if (v > 0xffffffff) return false
            dv.setUint32(p, v)
          } else {
            const p = body + 4 + k * 8
            dv.setBigUint64(p, BigInt(shift(Number(dv.getBigUint64(p)))))
          }
        }
      }
    }
    return true
  }
  const root = boxesIn(dv, moov, 0, moov.length)[0]
  if (!root || !walk(root.start + root.head, root.start + root.size)) return file
  return new Blob([file.slice(0, insert), moov, file.slice(insert, info.moovStart), file.slice(moovEnd)], { type: file.type || 'video/mp4' })
}

// Area potong + ukuran akhir foto (dipakai untuk validasi sebelum unggah dan saat konversi)
export function planImage(width: number, height: number, fitInstagram: boolean) {
  let sw = width, sh = height, sx = 0, sy = 0, cropped = false
  if (fitInstagram && width && height) {
    const r = sw / sh
    if (r < 0.8) { const nh = Math.round(sw / 0.8); sy = Math.round((sh - nh) / 2); sh = nh; cropped = true }
    else if (r > 1.91) { const nw = Math.round(sh * 1.91); sx = Math.round((sw - nw) / 2); sw = nw; cropped = true }
  }
  const scale = Math.min(1, 1920 / Math.max(sw, sh), 1080 / Math.min(sw, sh))
  return { sx, sy, sw, sh, w: Math.max(1, Math.round(sw * scale)), h: Math.max(1, Math.round(sh * scale)), cropped }
}

// Foto apa pun yang bisa dibuka browser -> JPEG sRGB. Rasio di luar 4:5-1.91:1 dipotong tengah bila tujuan ada Instagram.
// Ukuran disesuaikan batas TikTok (sisi panjang ≤ 1920, sisi pendek ≤ 1080) yang juga aman untuk Instagram.
export async function toJpeg(file: Blob, opts: { fitInstagram: boolean; maxBytes: number }) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    try { await img.decode() } catch { throw new Error('Foto tidak bisa dibuka browser ini (mis. HEIC). Ubah ke JPEG atau PNG dulu.') }
    const { sx, sy, sw, sh, w, h, cropped } = planImage(img.naturalWidth, img.naturalHeight, opts.fitInstagram)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff' // PNG transparan -> latar putih (JPEG tanpa alfa)
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
    let blob: Blob | null = null
    for (const q of [0.92, 0.85, 0.75, 0.6]) {
      blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q))
      if (blob && blob.size <= opts.maxBytes) break
    }
    if (!blob) throw new Error('Gagal mengonversi foto ke JPEG.')
    return { blob, width: w, height: h, cropped, original: { width: img.naturalWidth, height: img.naturalHeight } }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Unggah langsung ke bucket (URL PUT bertanda tangan dari n8n). Content-Type & ukuran harus sama dengan yang ditandatangani.
export function uploadPut(url: string, blob: Blob, contentType: string, onProgress: (frac: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Unggah gagal (HTTP ${xhr.status}). Coba lagi.`)))
    xhr.onerror = () => reject(new Error('Unggah terputus. Periksa koneksi lalu coba lagi.'))
    xhr.onabort = () => reject(new Error('Unggah dibatalkan.'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(blob)
  })
}

// ---------------------------------------------------------------- aturan format (cermin lib_post.js checkTarget)
export interface CheckItem { kind: 'image' | 'video'; mime: string; size: number; width: number; height: number; duration: number; fps: number; video_codec: string; audio_codec: string }

const countHashtags = (s: string) => (s.match(/(^|[^&\w])#[\p{L}\p{N}_]+/gu) || []).length
const countMentions = (s: string) => (s.match(/(^|[^\w])@[\w.]{1,30}/g) || []).length
export const captionStats = (s: string) => ({ chars: s.length, hashtags: countHashtags(s), mentions: countMentions(s) })
const fmtSec = (s: number) => (s >= 60 ? Math.floor(s / 60) + ' menit' + (s % 60 ? ' ' + Math.round(s % 60) + ' detik' : '') : Math.round(s) + ' detik')
export const fmtMb = (b: number) => Math.round((b / 1048576) * 10) / 10 + ' MB'

export function checkTarget(platform: Platform, media: CheckItem[], caption: string, opt: Partial<TtOptions>, limits: Destination['limits'] | undefined, R: Rules): string[] {
  const errs: string[] = []
  const carousel = media.length > 1
  const videos = media.filter((m) => m.kind === 'video')
  const name = (m: CheckItem, i: number) => (carousel ? 'Media ke-' + (i + 1) : m.kind === 'video' ? 'Video' : 'Foto')
  if (platform === 'instagram') {
    if (caption.length > R.caption_max) errs.push(`Caption maksimal ${R.caption_max} karakter (sekarang ${caption.length}).`)
    if (countHashtags(caption) > R.ig_hashtags_max) errs.push(`Maksimal ${R.ig_hashtags_max} hashtag.`)
    if (countMentions(caption) > R.ig_mentions_max) errs.push(`Maksimal ${R.ig_mentions_max} @mention.`)
    if (carousel && media.length > R.ig_carousel_max) errs.push(`Carousel maksimal ${R.ig_carousel_max} media.`)
    media.forEach((m, i) => {
      const n = name(m, i)
      if (m.kind === 'image') {
        const r = m.width / m.height
        if (m.width && (r < R.ig_image.min_ratio - 0.01 || r > R.ig_image.max_ratio + 0.01)) errs.push(`${n}: rasio harus 4:5 sampai 1.91:1.`)
        if (m.width && m.width < R.ig_image.min_width) errs.push(`${n}: lebar minimal ${R.ig_image.min_width} px.`)
      } else {
        const lim = carousel ? R.ig_carousel_video : R.ig_video
        if (m.duration && (m.duration < lim.min_sec - 0.05 || m.duration > lim.max_sec + 0.5)) errs.push(`${n}: durasi harus ${lim.min_sec} detik–${fmtSec(lim.max_sec)}${carousel ? ' di carousel' : ''} (sekarang ${fmtSec(m.duration)}).`)
        if (m.fps && (m.fps < R.ig_video.fps[0] - 0.5 || m.fps > R.ig_video.fps[1] + 0.5)) errs.push(`${n}: frame rate harus ${R.ig_video.fps[0]}-${R.ig_video.fps[1]} FPS (sekarang ${Math.round(m.fps)}).`)
        if (m.width && m.width > R.ig_video.max_width) errs.push(`${n}: lebar maksimal ${R.ig_video.max_width} px (sekarang ${m.width}).`)
        if (m.video_codec && !R.ig_video.codecs.includes(m.video_codec)) errs.push(`${n}: codec harus H.264/HEVC (sekarang ${m.video_codec}).`)
        if (m.audio_codec && !R.ig_video.audio.includes(m.audio_codec)) errs.push(`${n}: audio harus AAC (sekarang ${m.audio_codec}).`)
        if (m.size > R.ig_video.max_bytes) errs.push(`${n}: maksimal ${fmtMb(R.ig_video.max_bytes)}.`)
        if (m.duration && (m.size * 8) / m.duration / 1e6 > R.ig_video.max_mbps * 1.05) errs.push(`${n}: bitrate maksimal ${R.ig_video.max_mbps} Mbps. Ekspor ulang dengan kualitas lebih rendah.`)
      }
    })
  } else {
    const photo = videos.length === 0
    const capMax = photo ? R.tt_photo_caption_max : R.caption_max
    if (caption.length > capMax) errs.push(`Caption maksimal ${capMax} karakter (sekarang ${caption.length}).`)
    if (countMentions(caption) > R.tt_mentions_max) errs.push(`Maksimal ${R.tt_mentions_max} @mention.`)
    if (photo && (opt.title || '').length > R.tt_title_max) errs.push(`Judul foto maksimal ${R.tt_title_max} karakter.`)
    if (carousel && videos.length) errs.push('TikTok tidak menerima carousel berisi video. Pakai satu video, atau carousel foto saja.')
    if (photo && media.length > R.tt_photo_max) errs.push(`Maksimal ${R.tt_photo_max} foto.`)
    media.forEach((m, i) => {
      const n = name(m, i)
      if (m.kind === 'image') {
        const lo = Math.min(m.width, m.height)
        if (m.width && lo < R.tt_image.min_side) errs.push(`${n}: sisi terpendek minimal ${R.tt_image.min_side} px.`)
      } else {
        const maxSec = Math.min(R.tt_video.max_sec, limits?.max_sec || R.tt_video.max_sec)
        if (m.duration && (m.duration < R.tt_video.min_sec - 0.05 || m.duration > maxSec + 0.5)) errs.push(`${n}: durasi untuk akun ini harus ${R.tt_video.min_sec} detik–${fmtSec(maxSec)} (sekarang ${fmtSec(m.duration)}).`)
        if (m.fps && (m.fps < R.tt_video.fps[0] - 0.5 || m.fps > R.tt_video.fps[1] + 0.5)) errs.push(`${n}: frame rate harus ${R.tt_video.fps[0]}-${R.tt_video.fps[1]} FPS (sekarang ${Math.round(m.fps)}).`)
        if (m.width && (Math.min(m.width, m.height) < R.tt_video.min_side || Math.max(m.width, m.height) > R.tt_video.max_side)) errs.push(`${n}: resolusi harus ${R.tt_video.min_side}-${R.tt_video.max_side} px per sisi.`)
        if (m.video_codec && !R.tt_video.codecs.includes(m.video_codec)) errs.push(`${n}: codec harus H.264/H.265/VP8/VP9 (sekarang ${m.video_codec}).`)
      }
    })
    if (photo && opt.privacy && limits?.privacy?.length && !limits.privacy.includes(opt.privacy)) errs.push(`Privasi ini tidak tersedia untuk akun ini.`)
  }
  return errs
}

export const TARGET_LABEL: Record<TargetStatus, { label: string; color: string }> = {
  queued: { label: 'Mengantre', color: 'blue' },
  processing: { label: 'Memproses', color: 'yellow' },
  published: { label: 'Terbit', color: 'green' },
  failed: { label: 'Gagal', color: 'red' },
  canceled: { label: 'Dibatalkan', color: 'dark' },
}
export const POST_LABEL: Record<PostStatus, { label: string; color: string }> = {
  scheduled: { label: 'Terjadwal', color: 'purple' },
  processing: { label: 'Sedang diposting', color: 'yellow' },
  published: { label: 'Terbit semua', color: 'green' },
  partial: { label: 'Sebagian terbit', color: 'orange' },
  failed: { label: 'Gagal', color: 'red' },
  canceled: { label: 'Dibatalkan', color: 'dark' },
}

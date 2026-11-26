#!/usr/bin/env node
// Uji unit posting multi-platform: code/post_route.js (API) + code/post_worker.js (antrean) dengan Instagram, TikTok,
// dan bucket S3 tiruan, plus parser MP4/JPEG (lib_mp4.js) pada file asli buatan ffmpeg.   node dev/test_posting.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const CODE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'code')
const require = createRequire(import.meta.url)
const src = (f) => fs.readFileSync(path.join(CODE, f), 'utf8').replace(/^\/\/#include (\S+)$/gm, (_, g) => fs.readFileSync(path.join(CODE, g), 'utf8'))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let pass = 0, failN = 0
const check = (name, cond, info) => { if (cond) pass++; else failN++; console.log((cond ? '  OK   ' : '  GAGAL') + ' ' + name + (cond ? '' : '  -> ' + JSON.stringify(info).slice(0, 600))) }

// ---------------------------------------------------------------- parser MP4/JPEG
const lib = new Function('require', src('lib_mp4.js') + '; return { sniffMedia, jpegSize, mp4Info };')(require)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wany-post-'))
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: TMP })
let haveFfmpeg = true
try {
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', 'fast.mp4'])
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'slow.mp4'])
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30', '-t', '3.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'flat.mov'])
  ff(['-i', 'flat.mov', '-c', 'copy', '-metadata:s:v:0', 'rotate=90', 'rot.mov']) // matriks rotasi seperti video HP potret
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1080x1350', '-frames:v', '1', 'photo.jpg'])
  ff(['-f', 'lavfi', '-i', 'testsrc=size=800x800', '-frames:v', '1', 'photo.png'])
} catch { haveFfmpeg = false; console.log('  (ffmpeg tidak ada: uji parser dilewati)') }
if (haveFfmpeg) {
  console.log('Parser media')
  const rd = (f) => fs.readFileSync(path.join(TMP, f))
  const fast = lib.mp4Info(rd('fast.mp4'))
  check('MP4 faststart: durasi, resolusi, codec, fps', fast.moov && fast.faststart && Math.abs(fast.duration - 4) < 0.1 && fast.width === 1080 && fast.height === 1920
    && fast.video_codec === 'avc1' && fast.audio_codec === 'mp4a' && Math.round(fast.fps) === 30, fast)
  const slow = lib.mp4Info(rd('slow.mp4'))
  check('MP4 moov di akhir: tetap terbaca dari file utuh, faststart=false', slow.moov && !slow.faststart && slow.width === 1280 && Math.round(slow.fps) === 25 && !slow.audio_codec, slow)
  const head = lib.mp4Info(rd('slow.mp4').subarray(0, 4096))
  check('MP4 moov di akhir: potongan awal tidak berisi moov', !head.moov && head.brand === 'isom', head)
  const rot = lib.mp4Info(rd('rot.mov'))
  check('video diputar 90°: lebar/tinggi tampilan ditukar', rot.moov && rot.width === 1080 && rot.height === 1920, rot)
  check('sniff: mp4 / mov / jpeg / png', lib.sniffMedia(rd('fast.mp4')).mime === 'video/mp4' && lib.sniffMedia(rd('rot.mov')).mime === 'video/quicktime'
    && lib.sniffMedia(rd('photo.jpg')).mime === 'image/jpeg' && lib.sniffMedia(rd('photo.png')).mime === 'image/png', [lib.sniffMedia(rd('rot.mov'))])
  check('ukuran JPEG dari marker SOF', JSON.stringify(lib.jpegSize(rd('photo.jpg'))).includes('"height":1350,"width":1080'), lib.jpegSize(rd('photo.jpg')))
  check('sniff: teks/HTML ditolak', lib.sniffMedia(Buffer.from('<html><script>alert(1)</script>')) === null)
}

// ---------------------------------------------------------------- fixture & tiruan
const GID = 'u_' + 'a'.repeat(24)
const OTHER = 'u_' + 'b'.repeat(24)
const IG1 = '17841400000000001', IG2 = '17841400000000002'
const TT1 = '-000ttopenid1', TT2 = '-000ttopenid2'
const BASE = 'https://wanychat.remot.in'
const future = new Date(Date.now() + 30 * 86400000).toISOString()
const tokenOk = new Date(Date.now() + 20 * 3600000).toISOString()
const SETTINGS = [
  ['public_url', BASE], ['tiktok_app_id', '1'], ['tiktok_secret', 's'], ['s3_endpoint', 'https://acc.r2.cloudflarestorage.com'], ['s3_region', 'auto'],
  ['s3_bucket', 'wany-media'], ['s3_access_key', 'AKIAEXAMPLEKEY12345'], ['s3_secret_key', 'secretsecretsecretsecret'], ['media_public_base', 'https://media.remot.in'],
].map(([key, value]) => ({ key, value }))
const session = { token: 'h', user_id: 'u1', expires_at: future }
const user = { id: 1, uid: 'u1', group_id: GID, email: 'a@b.c' }
const igAcc = (id, extra = {}) => ({ id: Number(id.slice(-1)), ig_user_id: id, owner_id: id === IG1 ? '' : GID, access_token: 'igtok' + id.slice(-1), username: 'ig' + id.slice(-1), connected_at: '2026-11-0' + id.slice(-1) + 'T00:00:00Z', ...extra })
const ttAcc = (id, extra = {}) => ({ id: Number(id.slice(-1)), open_id: id, owner_id: GID, access_token: 'tttok', refresh_token: 'r', token_expires_at: tokenOk, username: 'tt' + id.slice(-1),
  scope: 'user.info.basic,video.list,comment.list,video.publish', connected_at: '2026-11-0' + id.slice(-1) + 'T00:00:00Z', ...extra })
const pro = [{ id: 1, account_id: GID, plan: 'pro', period_end: future }]
// IG1 adalah pemilik grup lama (owner_id kosong) -> grup = IG1? Tidak: grup user = GID, jadi IG1 harus owner_id GID
const igRows = () => [igAcc(IG1, { owner_id: GID }), igAcc(IG2)]

function fake() {
  const f = { calls: [], objects: {}, igPerm: true, igLimit: { quota_usage: 2, config: { quota_total: 50 } }, containers: {}, nextId: 100, published: [],
    ttPublish: [], ttStatus: {}, ttSettings: { privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], max_video_post_duration_sec: 180 }, refreshOk: true, igFail: null, ttFail: null }
  f.http = async (o) => {
    const url = o.url
    f.calls.push(o.method + ' ' + url.replace(/\?.*$/, ''))
    const json = (statusCode, body) => ({ statusCode, body, headers: {} })
    if (url.startsWith('https://acc.r2.cloudflarestorage.com/wany-media/')) {
      const key = decodeURIComponent(url.split('/wany-media/')[1])
      if (!String(o.headers.authorization || '').startsWith('AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY12345/')) return { statusCode: 403, body: Buffer.alloc(0), headers: {} }
      const obj = f.objects[key]
      if (o.method === 'DELETE') { delete f.objects[key]; return { statusCode: 204, body: Buffer.alloc(0), headers: {} } }
      if (!obj) return { statusCode: 404, body: Buffer.alloc(0), headers: {} }
      if (o.method === 'HEAD') return { statusCode: 200, body: Buffer.alloc(0), headers: { 'content-length': String(obj.length) } }
      const m = /bytes=(\d+)-(\d+)/.exec(o.headers.range || '')
      return { statusCode: m ? 206 : 200, body: m ? obj.subarray(Number(m[1]), Number(m[2]) + 1) : obj, headers: {} }
    }
    if (url.startsWith('https://graph.instagram.com/')) {
      const p = url.replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+/, '')
      const q = o.qs || {}
      if (f.igFail && f.igFail.path === p && o.method === f.igFail.method) return json(400, { error: f.igFail.error })
      if (p === '/me/content_publishing_limit') return f.igPerm ? json(200, { data: [f.igLimit] }) : json(403, { error: { message: '(#10) Application does not have permission for this action', code: 10 } })
      if (p === '/me/media' && o.method === 'POST') {
        const id = 'c' + (f.nextId++)
        f.containers[id] = { params: q, status_code: q.media_type === 'REELS' || q.media_type === 'VIDEO' ? 'IN_PROGRESS' : 'FINISHED' }
        return json(200, { id })
      }
      if (p === '/me/media' && o.method === 'GET') return json(200, { data: f.published.slice().reverse() })
      if (p === '/me/media_publish') {
        const c = f.containers[q.creation_id]
        if (!c || c.status_code !== 'FINISHED') return json(400, { error: { message: 'Media ID is not available', code: 9007, error_subcode: 2207027 } })
        c.status_code = 'PUBLISHED'
        const id = 'm' + (f.nextId++)
        f.published.push({ id, permalink: 'https://www.instagram.com/p/' + id, caption: c.params.caption || '', timestamp: new Date().toISOString() })
        return json(200, { id })
      }
      const cid = p.slice(1)
      if (f.containers[cid]) return json(200, { status_code: f.containers[cid].status_code, status: f.containers[cid].status || '' })
      const pub = f.published.find(x => x.id === cid)
      if (pub) return json(200, { permalink: pub.permalink })
      return json(404, { error: { message: 'unknown ' + p, code: 100 } })
    }
    if (url.startsWith('https://business-api.tiktok.com/open_api/v1.3')) {
      const p = url.replace(/^.*\/open_api\/v1\.3/, '')
      const ok = (data) => json(200, { code: 0, message: 'OK', data })
      if (p.startsWith('/tt_user/oauth2/refresh_token')) return f.refreshOk ? ok({ access_token: 'baru', expires_in: 86400, refresh_token: 'r2', refresh_token_expires_in: 31536000 }) : json(200, { code: 40001, message: 'invalid refresh' })
      if (p.startsWith('/business/video/settings')) return ok(f.ttSettings)
      if (p.startsWith('/business/video/publish') || p.startsWith('/business/photo/publish')) {
        if (f.ttFail) return json(200, f.ttFail)
        const id = (p.includes('video') ? 'v_pub_url~' : 'p_pub_url~') + (f.nextId++)
        f.ttPublish.push({ path: p, body: o.body, token: o.headers['Access-Token'] })
        f.ttStatus[id] = { status: 'PROCESSING_DOWNLOAD' }
        return ok({ share_id: id })
      }
      if (p.startsWith('/business/publish/status')) return ok(f.ttStatus[o.qs.publish_id] || { status: 'FAILED', reason: 'internal' })
      return json(404, { code: 404, message: 'unknown ' + p })
    }
    return json(404, { error: 'unknown host ' + url })
  }
  return f
}

async function run(file, nodes, http) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('node tidak ada di fixture: ' + name)
    const items = (Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]]).map((json) => ({ json }))
    return { first: () => items[0] || { json: {} }, all: () => items }
  }
  const fn = new AsyncFunction('$', '$input', 'require', src(file))
  return (await fn.call({ helpers: { httpRequest: http } }, $, { all: () => [], first: () => ({ json: {} }) }, require)).map((i) => i.json)
}

function apiNodes(action, payload, st) {
  return {
    'Webhook Posting': { body: { action, payload }, headers: { origin: st.origin ?? BASE } },
    'Baca Settings': SETTINGS.concat(st.settings || []), 'Cari Sesi': st.session ?? session, 'Baca User': [user],
    'Baca Akun Grup': st.ig ?? igRows(), 'Baca TikTok Grup': st.tt ?? [ttAcc(TT1), ttAcc(TT2, { scope: 'video.list' })],
    'Baca Billing': st.billing ?? pro, 'Baca Posting': st.posts || [], 'Baca Target': st.targets || [], 'Baca Media': st.media || [],
  }
}
const api = async (action, payload, st = {}, f = fake()) => {
  const out = await run('post_route.js', apiNodes(action, payload, st), f.http)
  return { out, main: out[0], res: out[0].response, f }
}
const media = (id, extra = {}) => ({ id: Number(String(id).replace(/\D/g, '')) || 1, media_id: id, owner_id: GID, kind: 'image', mime: 'image/jpeg', obj_key: 'p/' + id + '.jpg',
  size: 500000, width: 1080, height: 1350, duration: 0, fps: 0, status: 'ready', post_id: '', expires_at: future, createdAt: new Date().toISOString(), ...extra })
const vid = (id, extra = {}) => media(id, { kind: 'video', mime: 'video/mp4', obj_key: 'p/' + id + '.mp4', size: 20000000, width: 1080, height: 1920, duration: 30, fps: 30, video_codec: 'avc1', audio_codec: 'mp4a', ...extra })

// ---------------------------------------------------------------- API
console.log('API: sesi & asal')
let r = await api('post.config', {}, { origin: 'https://jahat.example' })
check('Origin asing ditolak', r.main.route === 'deny', r.main)
r = await api('post.config', {}, { origin: 'https://wanychat-git-x.vercel.app', settings: [{ key: 'extra_origins', value: 'https://wanychat-git-x.vercel.app' }] })
check('Origin preview di extra_origins diterima', r.main.route === 'direct' && r.res.ok, r.main)
r = await api('post.config', {}, { session: {} })
check('Tanpa sesi ditolak', r.main.route === 'deny', r.main)
r = await api('post.config', {}, { billing: [{ id: 1, account_id: GID, plan: 'pro', period_end: future, suspended: true }] })
check('Akun disuspend ditolak', r.main.route === 'deny', r.main)

console.log('API: post.config')
r = await api('post.config', {})
const acc = (t, id) => r.res.accounts.find(a => a.type === t && a.id === id)
check('IG dengan izin: bisa posting + kuota harian terbaca', acc('instagram', IG1).can_publish && acc('instagram', IG1).quota.total === 50, r.res.accounts)
check('TikTok dengan scope video.publish: bisa posting + batas durasi akun', acc('tiktok', TT1).can_publish && acc('tiktok', TT1).limits.max_sec === 180 && acc('tiktok', TT1).limits.privacy.includes('SELF_ONLY'), acc('tiktok', TT1))
check('TikTok tanpa scope: tidak bisa, minta izin', !acc('tiktok', TT2).can_publish && acc('tiktok', TT2).need_auth, acc('tiktok', TT2))
check('kuota paket Pro 300 posting', r.res.plan.posts === 300, r.res.plan)
let f = fake(); f.igPerm = false
r = await api('post.config', {}, {}, f)
check('IG tanpa izin posting: need_auth', !r.res.accounts[0].can_publish && r.res.accounts[0].need_auth, r.res.accounts[0])
r = await api('post.config', {}, { billing: [] })
check('Paket Gratis: akun IG ke-2 tidak aktif', !acc('instagram', IG2).can_publish && /tidak aktif/.test(acc('instagram', IG2).reason), r.res.accounts)
r = await api('post.config', {}, { settings: [{ key: 's3_bucket', value: '' }] })
check('Bucket belum disetel: ready=false', r.res.ready === false, r.res.ready)

console.log('API: media.start / media.finish')
r = await api('media.start', { mime: 'image/png', size: 1000 })
check('PNG mentah ditolak (browser wajib konversi ke JPEG)', !r.res.ok, r.res)
r = await api('media.start', { mime: 'video/mp4', size: 400 * 1024 * 1024 })
check('video > batas ditolak', !r.res.ok && /maksimal/.test(r.res.error), r.res)
r = await api('media.start', { mime: 'video/mp4', size: 12345, duration: 10, width: 1080, height: 1920 })
const up = new URL(r.res.upload_url)
check('media.start: baris media + URL PUT bertanda tangan (content-length ikut)', r.main.route === 'media_insert' && r.main.media.status === 'uploading' && r.main.media.owner_id === GID
  && up.host === 'acc.r2.cloudflarestorage.com' && up.pathname === '/wany-media/' + r.main.media.obj_key && up.searchParams.get('X-Amz-SignedHeaders') === 'content-length;content-type;host'
  && /^[a-f0-9]{64}$/.test(up.searchParams.get('X-Amz-Signature')), { main: r.main, url: r.res.upload_url })
r = await api('media.start', { mime: 'image/jpeg', size: 100 }, { media: Array.from({ length: 40 }, (_, i) => media('x' + i, { status: 'uploading' })) })
check('terlalu banyak unggahan menggantung ditolak', !r.res.ok && r.main.status === 429, r.res)

if (haveFfmpeg) {
  const rd = (fn) => fs.readFileSync(path.join(TMP, fn))
  f = fake(); f.objects['p/v1.mp4'] = rd('fast.mp4')
  r = await api('media.finish', { media_id: 'v1' }, { media: [vid('v1', { status: 'uploading', size: rd('fast.mp4').length, duration: 99, width: 1, height: 1 })] }, f)
  check('media.finish video: metadata dari server menimpa klaim browser', r.main.route === 'media_update' && r.res.ok && r.main.media.status === 'ready' && r.main.media.verified
    && Math.round(r.main.media.duration) === 4 && r.main.media.width === 1080 && r.main.media.video_codec === 'avc1', r.main)
  f = fake(); f.objects['p/v2.mp4'] = rd('fast.mp4')
  r = await api('media.finish', { media_id: 'v2' }, { media: [vid('v2', { status: 'uploading', size: 999 })] }, f)
  check('media.finish: ukuran beda -> ditolak & objek dihapus', !r.res.ok && r.main.media.status === 'rejected' && !f.objects['p/v2.mp4'], { res: r.res, objs: Object.keys(f.objects) })
  f = fake(); f.objects['p/v3.mp4'] = Buffer.from('<html>bukan video</html>'.padEnd(5000, ' '))
  r = await api('media.finish', { media_id: 'v3' }, { media: [vid('v3', { status: 'uploading', size: 5000 })] }, f)
  check('media.finish: isi bukan video -> ditolak', !r.res.ok && /bukan video/.test(r.res.error) && r.main.status === 422, r.res)
  f = fake(); f.objects['p/i1.jpg'] = rd('photo.jpg')
  r = await api('media.finish', { media_id: 'i1' }, { media: [media('i1', { status: 'uploading', size: rd('photo.jpg').length, width: 5, height: 5 })] }, f)
  check('media.finish foto: ukuran dari JPEG asli', r.res.ok && r.main.media.width === 1080 && r.main.media.height === 1350, r.main.media)
  f = fake(); f.objects['p/i2.jpg'] = rd('photo.png')
  r = await api('media.finish', { media_id: 'i2' }, { media: [media('i2', { status: 'uploading', size: rd('photo.png').length })] }, f)
  check('media.finish: PNG berlabel JPEG ditolak', !r.res.ok, r.res)
  r = await api('media.finish', { media_id: 'zz' }, { media: [media('zz', { status: 'uploading', owner_id: OTHER })] })
  check('media.finish: media milik grup lain tidak terlihat', !r.res.ok && r.main.status === 404, r.res)
  f = fake()
  r = await api('media.finish', { media_id: 'v4' }, { media: [vid('v4', { status: 'uploading' })] }, f)
  check('media.finish: file belum di bucket -> 409', !r.res.ok && r.main.status === 409, r.res)
}

console.log('API: post.create')
const T = (type, id, extra) => ({ type, id, ...extra })
r = await api('post.create', { media_ids: ['v1'], caption: 'Halo #promo', targets: [T('instagram', IG1), T('tiktok', TT1)], client_ref: 'ref1' }, { media: [vid('v1')] })
check('video ke IG (Reels) + TikTok: 1 posting, 2 target queued, media dikunci', r.main.route === 'post_create' && r.main.targets.length === 2
  && r.main.targets.find(t => t.platform === 'instagram').kind === 'reels' && r.main.targets.find(t => t.platform === 'tiktok').kind === 'video'
  && r.main.targets.every(t => t.status === 'queued' && t.owner_id === GID && t.post_id === r.main.post.post_id)
  && r.main.media_rows[0].post_id === r.main.post.post_id && JSON.parse(r.main.targets[0].media)[0].url === 'https://media.remot.in/p/v1.mp4', r.main)
const created = r.main
r = await api('post.create', { media_ids: ['v1'], caption: 'x', targets: [T('instagram', IG1)], client_ref: 'ref1' }, { media: [vid('v1')], posts: [{ id: 5, ...created.post }], targets: created.targets.map((t, i) => ({ id: 10 + i, ...t })) })
check('kirim ganda (client_ref sama) -> posting yang sama, tanpa baris baru', r.main.route === 'direct' && r.res.duplicate && r.res.post.post_id === created.post.post_id, r.main)
r = await api('post.create', { media_ids: ['v1'], caption: 'x', targets: [T('tiktok', TT2)] }, { media: [vid('v1')] })
check('TikTok tanpa izin posting ditolak', !r.res.ok && /izin posting/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['v1'], caption: 'x', targets: [T('tiktok', TT1)] }, { media: [vid('v1', { duration: 200 })] })
check('durasi melebihi batas akun TikTok (180 dtk) ditolak', !r.res.ok && /3 menit/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['v1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [vid('v1', { fps: 15 })] })
check('frame rate 15 FPS ditolak', !r.res.ok && /FPS/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['v1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [vid('v1', { video_codec: 'vp09' })] })
check('codec VP9 ditolak Instagram', !r.res.ok && /codec/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [media('i1', { width: 1080, height: 1920 })] })
check('foto 9:16 ditolak Instagram (rasio 4:5-1.91:1)', !r.res.ok && /rasio/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('tiktok', TT1)] }, { media: [media('i1', { width: 1080, height: 1920 })] })
check('foto 9:16 diterima TikTok (postingan foto)', r.main.route === 'post_create' && r.main.targets[0].kind === 'photo', r.res)
r = await api('post.create', { media_ids: ['i1', 'v1'], caption: 'x', targets: [T('tiktok', TT1)] }, { media: [media('i1'), vid('v1')] })
check('carousel berisi video ditolak TikTok', !r.res.ok && /carousel berisi video/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1', 'v1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [media('i1'), vid('v1')] })
check('carousel foto+video (video ≤60 dtk) diterima Instagram', r.main.route === 'post_create' && r.main.targets[0].kind === 'carousel', r.res)
r = await api('post.create', { media_ids: Array.from({ length: 11 }, (_, i) => 'i' + i), caption: 'x', targets: [T('instagram', IG1)] }, { media: Array.from({ length: 11 }, (_, i) => media('i' + i)) })
check('carousel 11 media ditolak Instagram', !r.res.ok && /maksimal 10/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1'], caption: Array.from({ length: 31 }, (_, i) => '#tag' + i).join(' '), targets: [T('instagram', IG1)] }, { media: [media('i1')] })
check('31 hashtag ditolak Instagram', !r.res.ok && /hashtag/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'a'.repeat(2201), targets: [T('instagram', IG1), T('tiktok', TT1)] }, { media: [media('i1')] })
check('caption 2201 karakter: IG ditolak, TikTok foto (≤4000) lolos -> tetap ditolak semua (atomik)', !r.res.ok && /Instagram @ig1/.test(r.res.error) && !/TikTok @tt1/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1, { caption: 'Khusus IG' }), T('tiktok', TT1)] }, { media: [media('i1')] })
check('caption khusus per akun', r.main.targets.find(t => t.platform === 'instagram').caption === 'Khusus IG' && r.main.targets.find(t => t.platform === 'tiktok').caption === 'x', r.main.targets)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [media('i1', { status: 'uploading' })] })
check('media belum selesai diunggah ditolak', !r.res.ok && r.main.status === 409, r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [media('i1', { post_id: 'pst_lama' })] })
check('media yang sudah dipakai ditolak', !r.res.ok && /sudah dipakai/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [media('i1', { owner_id: OTHER })] })
check('media grup lain tidak bisa dipakai', !r.res.ok && r.main.status === 404, r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', '999')] }, { media: [media('i1')] })
check('akun tujuan bukan milik user ditolak', !r.res.ok && /tidak ditemukan/.test(r.res.error), r.res)
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1)], schedule_at: new Date(Date.now() - 3600000).toISOString() }, { media: [media('i1')] })
check('jadwal yang sudah lewat ditolak', !r.res.ok && /lewat/.test(r.res.error), r.res)
const when = new Date(Date.now() + 3 * 3600000).toISOString()
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1)], schedule_at: when }, { media: [media('i1')] })
check('posting terjadwal: status scheduled, media disimpan sampai 3 hari setelah jadwal', r.res.post.status === 'scheduled' && r.main.targets[0].scheduled_at === when
  && new Date(r.main.media_rows[0].expires_at) - new Date(when) === 3 * 86400000, r.main)
const monthTargets = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, post_id: 'p' + i, owner_id: GID, platform: 'instagram', account_id: IG1, status: 'published', createdAt: new Date().toISOString() }))
r = await api('post.create', { media_ids: ['i1'], caption: 'x', targets: [T('instagram', IG1)] }, { media: [media('i1')], billing: [], targets: monthTargets })
check('kuota posting bulanan paket Gratis (10) habis -> ditolak', !r.res.ok && r.main.status === 403 && /kuota posting/i.test(r.res.error), r.res)
const ttDay = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, post_id: 'p' + i, owner_id: GID, platform: 'tiktok', account_id: TT1, status: 'published', publish_id: 'x', scheduled_at: new Date().toISOString(), createdAt: new Date().toISOString() }))
r = await api('post.create', { media_ids: ['v1'], caption: 'x', targets: [T('tiktok', TT1)] }, { media: [vid('v1')], targets: ttDay })
check('batas TikTok 15 posting/24 jam ditolak', !r.res.ok && /15 posting per 24 jam/.test(r.res.error), r.res)

console.log('API: list / get / cancel / retry')
const tRows = (status, extra = {}) => created.targets.map((t, i) => ({ id: 10 + i, createdAt: new Date().toISOString(), ...t, status, ...extra }))
r = await api('post.get', { post_id: created.post.post_id }, { posts: [{ id: 5, ...created.post }], targets: tRows('published', { permalink: 'https://x' }) })
check('post.get: status agregat published + permalink per akun', r.res.post.status === 'published' && r.res.post.targets.length === 2 && r.res.post.targets[0].permalink === 'https://x', r.res)
r = await api('post.get', { post_id: created.post.post_id }, { posts: [{ id: 5, ...created.post, owner_id: OTHER }], targets: tRows('queued') })
check('post.get: posting grup lain tidak terlihat', !r.res.ok && r.main.status === 404, r.res)
const mixed = tRows('queued'); mixed[1].status = 'failed'; mixed[1].retryable = true
r = await api('post.get', { post_id: created.post.post_id }, { posts: [{ id: 5, ...created.post }], targets: [{ ...mixed[0], status: 'published' }, mixed[1]] })
check('post.get: sebagian berhasil = partial', r.res.post.status === 'partial', r.res.post.status)
r = await api('post.cancel', { post_id: created.post.post_id }, { posts: [{ id: 5, ...created.post }], targets: tRows('queued') })
check('post.cancel: target queued dibatalkan (update lengkap semua kolom)', r.main.route === 'targets_update' && r.main.updates.length === 2 && r.main.updates.every(u => u.status === 'canceled' && 'container_id' in u && 'next_at' in u), r.main)
r = await api('post.cancel', { post_id: created.post.post_id }, { posts: [{ id: 5, ...created.post }], targets: tRows('processing') })
check('post.cancel: yang sedang diproses tidak bisa dibatalkan', !r.res.ok && r.main.status === 409, r.res)
r = await api('post.retry', { post_id: created.post.post_id }, { posts: [{ id: 5, ...created.post }], targets: [{ ...mixed[0], status: 'published' }, mixed[1]], media: [vid('v1', { post_id: created.post.post_id })] })
check('post.retry: hanya target gagal yang retryable kembali ke antrean', r.main.route === 'targets_update' && r.main.updates.length === 1 && r.main.updates[0].id === 11 && r.main.updates[0].status === 'queued' && r.main.updates[0].publish_id === '', r.main)
r = await api('post.retry', { post_id: created.post.post_id }, { posts: [{ id: 5, ...created.post }], targets: [mixed[1]], media: [vid('v1', { status: 'deleted' })] })
check('post.retry: media sudah dihapus -> 410', !r.res.ok && r.main.status === 410, r.res)

// ---------------------------------------------------------------- worker
console.log('Worker antrean')
const target = (id, platform, kind, extra = {}) => {
  const isVid = kind === 'video' || kind === 'reels'
  return { id, post_id: 'pst1', owner_id: GID, platform, account_id: platform === 'tiktok' ? TT1 : IG1, username: platform === 'tiktok' ? 'tt1' : 'ig1', kind, caption: 'Caption ' + id,
    media: JSON.stringify(kind === 'carousel' ? [{ media_id: 'a', kind: 'image', url: 'https://media.remot.in/p/a.jpg' }, { media_id: 'b', kind: 'video', url: 'https://media.remot.in/p/b.mp4' }]
      : [{ media_id: 'm' + id, kind: isVid ? 'video' : 'image', url: 'https://media.remot.in/p/m' + id + (isVid ? '.mp4' : '.jpg') }]),
    options: JSON.stringify(platform === 'tiktok' ? { privacy: 'PUBLIC_TO_EVERYONE', disable_duet: true } : { share_to_feed: true }),
    status: 'queued', container_id: '', children: '', publish_id: '', tries: 0, scheduled_at: new Date(Date.now() - 1000).toISOString(), next_at: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(), ...extra }
}
const wNodes = (targets, st = {}) => ({ 'Baca Settings': SETTINGS, 'Baca Target Aktif': targets, 'Baca Akun IG': st.ig ?? igRows(), 'Baca Akun TikTok': st.tt ?? [ttAcc(TT1)], 'Baca Media Kedaluwarsa': st.expired || [] })
const work = async (targets, f, st) => run('post_worker.js', wNodes(targets, st), f.http)
const upd = (out, id) => out.filter(x => x.kind === 'target' && x.id === id).pop()
// Hasil putaran diterapkan ke target; next_at dimundurkan supaya putaran berikut langsung memprosesnya (tanpa menunggu 1 menit)
// (kolom rute "kind" dibuang: node Data Table hanya menulis kolom TARGET_MUTABLE, kolom target.kind tidak tersentuh)
const apply = (t, out) => { const { kind, ...u } = upd(out, t.id) || {}; return Object.assign({}, t, u, { next_at: new Date(Date.now() - 1000).toISOString() }) }

f = fake()
let t1 = target(1, 'instagram', 'image')
let out = await work([t1], f)
check('IG foto: container + publish dalam satu putaran', upd(out, 1).status === 'published' && upd(out, 1).media_id && /instagram\.com\/p\//.test(upd(out, 1).permalink)
  && out.some(x => x.kind === 'log' && x.type === 'post_published' && x.account_id === IG1), out)
check('IG foto: caption dikirim di container', Object.values(f.containers)[0].params.caption === 'Caption 1', f.containers)

f = fake()
let t2 = target(2, 'instagram', 'reels')
out = await work([t2], f)
t2 = apply(t2, out)
check('IG Reels: container REELS dibuat, status processing', t2.status === 'processing' && f.containers[t2.container_id].params.media_type === 'REELS' && f.containers[t2.container_id].params.share_to_feed === 'true', t2)
out = await work([t2], f)
t2 = apply(t2, out)
check('IG Reels: masih IN_PROGRESS -> tetap processing, belum publish', t2.status === 'processing' && !f.published.length, t2)
f.containers[t2.container_id].status_code = 'FINISHED'
out = await work([t2], f)
t2 = apply(t2, out)
check('IG Reels: FINISHED -> diterbitkan', t2.status === 'published' && f.published.length === 1, t2)
// putaran terputus setelah publish: container PUBLISHED, status target masih processing
out = await work([Object.assign({}, t2, { status: 'processing' })], f)
check('IG: container sudah PUBLISHED -> tidak publish ulang, media dicari kembali', upd(out, 2).status === 'published' && f.published.length === 1 && upd(out, 2).media_id === f.published[0].id, out)

f = fake()
let t3 = target(3, 'instagram', 'carousel')
out = await work([t3], f); t3 = apply(t3, out)
const kids = JSON.parse(t3.children)
check('IG carousel: 2 container anak (is_carousel_item, video=VIDEO)', kids.length === 2 && f.containers[kids[0]].params.is_carousel_item === 'true' && f.containers[kids[1]].params.media_type === 'VIDEO' && !t3.container_id, t3)
out = await work([t3], f); t3 = apply(t3, out)
check('IG carousel: anak video belum selesai -> induk belum dibuat', !t3.container_id && t3.status === 'processing', t3)
f.containers[kids[1]].status_code = 'FINISHED'
out = await work([t3], f); t3 = apply(t3, out)
check('IG carousel: induk CAROUSEL dengan children + caption, langsung terbit', t3.status === 'published' && Object.values(f.containers).some(c => c.params.media_type === 'CAROUSEL' && c.params.children === kids.join(',') && c.params.caption === 'Caption 3'), { t3, c: f.containers })

f = fake()
let t4 = target(4, 'instagram', 'reels')
out = await work([t4], f); t4 = apply(t4, out)
f.containers[t4.container_id].status_code = 'ERROR'; f.containers[t4.container_id].status = 'ERROR: 2207026'
out = await work([t4], f)
check('IG: container ERROR -> gagal, tidak bisa dicoba ulang', upd(out, 4).status === 'failed' && !upd(out, 4).retryable && /2207026/.test(upd(out, 4).error) && out.some(x => x.type === 'post_failed'), upd(out, 4))
f = fake(); f.igFail = { method: 'POST', path: '/me/media', error: { message: 'Application does not have permission', code: 10 } }
out = await work([target(5, 'instagram', 'image')], f)
check('IG: izin posting belum ada -> gagal dengan pesan "Izinkan posting"', upd(out, 5).status === 'failed' && /Izinkan posting/.test(upd(out, 5).error), upd(out, 5))
f = fake(); f.igFail = { method: 'POST', path: '/me/media_publish', error: { message: 'limit', code: 9, error_subcode: 2207042 } }
out = await work([target(6, 'instagram', 'image')], f)
check('IG: batas harian -> gagal, boleh coba ulang', upd(out, 6).status === 'failed' && upd(out, 6).retryable && /Batas posting/.test(upd(out, 6).error), upd(out, 6))
out = await work([target(7, 'instagram', 'image', { owner_id: OTHER })], fake())
check('IG: akun sudah pindah grup/dilepas -> gagal', upd(out, 7).status === 'failed' && /dilepas/.test(upd(out, 7).error), upd(out, 7))
out = await work([target(8, 'instagram', 'reels', { status: 'processing', container_id: 'cx', started_at: new Date(Date.now() - 40 * 60000).toISOString() })], fake())
check('IG: processing > 30 menit -> gagal (retryable)', upd(out, 8).status === 'failed' && upd(out, 8).retryable, upd(out, 8))

console.log('Worker: TikTok')
f = fake()
let v = target(20, 'tiktok', 'video')
out = await work([v], f); v = apply(v, out)
check('TikTok video: publish dengan video_url + post_info lengkap', v.status === 'processing' && v.publish_id.startsWith('v_pub_url~') && f.ttPublish[0].body.video_url === 'https://media.remot.in/p/m20.mp4'
  && f.ttPublish[0].body.post_info.disable_duet === true && f.ttPublish[0].body.post_info.is_brand_organic === false && f.ttPublish[0].body.business_id === TT1, { v, p: f.ttPublish })
out = await work([v], f); v = apply(v, out)
check('TikTok: PROCESSING_DOWNLOAD -> tetap processing', v.status === 'processing', v)
f.ttStatus[v.publish_id] = { status: 'PUBLISH_COMPLETE', post_ids: ['7300000000000000001'] }
out = await work([v], f); v = apply(v, out)
check('TikTok: PUBLISH_COMPLETE + post_ids -> published dengan link video', v.status === 'published' && v.media_id === '7300000000000000001' && v.permalink === 'https://www.tiktok.com/@tt1/video/7300000000000000001', v)

f = fake()
let ph = target(21, 'tiktok', 'photo')
out = await work([ph], f); ph = apply(ph, out)
check('TikTok foto: /photo/publish/ dengan photo_images + privacy', f.ttPublish[0].path.startsWith('/business/photo/publish') && f.ttPublish[0].body.photo_images[0] === 'https://media.remot.in/p/m21.jpg'
  && f.ttPublish[0].body.post_info.privacy_level === 'PUBLIC_TO_EVERYONE' && !('title' in f.ttPublish[0].body.post_info), f.ttPublish)
f.ttStatus[ph.publish_id] = { status: 'PUBLISH_COMPLETE' }
out = await work([ph], f); ph = apply(ph, out)
check('TikTok: selesai tanpa post_ids -> tunggu dulu', ph.status === 'processing' && /^complete:/.test(ph.note), ph)
ph.note = 'complete:' + new Date(Date.now() - 20 * 60000).toISOString()
out = await work([ph], f); ph = apply(ph, out)
check('TikTok: 15 menit tanpa post_ids -> published dengan catatan', ph.status === 'published' && /ID postingan belum/.test(ph.note), ph)

f = fake()
let vf = target(22, 'tiktok', 'video')
out = await work([vf], f); vf = apply(vf, out)
f.ttStatus[vf.publish_id] = { status: 'FAILED', reason: 'frame_rate_check_failed' }
out = await work([vf], f)
check('TikTok FAILED frame_rate -> pesan Indonesia, tidak retryable', upd(out, 22).status === 'failed' && /23-60 FPS/.test(upd(out, 22).error) && !upd(out, 22).retryable, upd(out, 22))
f = fake(); f.ttFail = { code: 40001, message: 'url_ownership_unverified: video url not verified' }
out = await work([target(23, 'tiktok', 'video')], f)
check('TikTok: domain media belum diverifikasi -> pesan jelas', upd(out, 23).status === 'failed' && /diverifikasi/.test(upd(out, 23).error), upd(out, 23))
f = fake()
out = await work([target(24, 'tiktok', 'video')], f, { tt: [ttAcc(TT1, { token_expires_at: new Date(Date.now() + 60000).toISOString() })] })
check('TikTok: token hampir habis -> diperbarui dulu, token baru dipakai & disimpan', f.ttPublish[0].token === 'baru' && out.some(x => x.kind === 'tt' && x.tt.access_token === 'baru'), { out, p: f.ttPublish })

console.log('Worker: jadwal, batas, pembersihan')
f = fake()
out = await work([target(30, 'instagram', 'image', { scheduled_at: new Date(Date.now() + 3600000).toISOString(), next_at: new Date(Date.now() + 3600000).toISOString() })], f)
check('target terjadwal di masa depan dilewati', !out.length && !f.calls.length, out)
f = fake()
out = await work(Array.from({ length: 20 }, (_, i) => target(100 + i, 'instagram', 'image')), f)
check('maksimal 12 target per putaran', out.filter(x => x.kind === 'target').length === 12, out.filter(x => x.kind === 'target').length)
f = fake(); f.objects['p/old.jpg'] = Buffer.from('x'); f.objects['p/m40.jpg'] = Buffer.from('y')
out = await work([target(40, 'instagram', 'reels', { status: 'processing', container_id: 'c999', next_at: new Date(Date.now() + 600000).toISOString() })], f,
  { expired: [media('old', { obj_key: 'p/old.jpg', expires_at: new Date(Date.now() - 1000).toISOString() }), media('m40', { obj_key: 'p/m40.jpg', expires_at: new Date(Date.now() - 1000).toISOString() }),
    media('gone', { status: 'deleted', expires_at: new Date(Date.now() - 1000).toISOString() })] })
check('media kedaluwarsa dihapus dari bucket; yang dipakai antrean aktif dibiarkan', !f.objects['p/old.jpg'] && f.objects['p/m40.jpg'] && out.filter(x => x.kind === 'media').length === 1 && out.find(x => x.kind === 'media').status === 'deleted', { out, objs: Object.keys(f.objects) })

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n${pass} lulus, ${failN} gagal`)
process.exit(failN ? 1 : 0)

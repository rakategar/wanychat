#!/usr/bin/env node
// Uji unit automasi komentar TikTok: menjalankan code/tt_auto.js (+ tt_ai_send.js) dengan TikTok API tiruan
// dan static data yang bertahan antar putaran (tanpa n8n, tanpa akun TikTok asli).   node dev/test_tt_auto.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const CODE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'code')
const require = createRequire(import.meta.url)
const src = (f) => fs.readFileSync(path.join(CODE, f), 'utf8').replace(/^\/\/#include (\S+)$/gm, (_, g) => fs.readFileSync(path.join(CODE, g), 'utf8'))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// ---- TikTok tiruan: video + komentar per akun, mencatat semua panggilan
function fakeTikTok() {
  const api = { videos: [], comments: {}, calls: [], replies: [], hidden: [], failVideos: false, refreshOk: true }
  api.http = async (o) => {
    const p = o.url.replace(/^.*\/open_api\/v1\.3/, '')
    api.calls.push(p)
    const ok = (data) => ({ statusCode: 200, body: { code: 0, message: 'OK', data } })
    if (p.startsWith('/tt_user/oauth2/refresh_token')) return api.refreshOk ? ok({ access_token: 'baru', expires_in: 86400, refresh_token: 'r2', refresh_token_expires_in: 31536000 }) : { statusCode: 200, body: { code: 40001, message: 'invalid refresh' } }
    if (p.startsWith('/business/video/list')) return api.failVideos ? { statusCode: 200, body: { code: 40105, message: 'access token expired' } } : ok({ videos: api.videos, has_more: false })
    if (p.startsWith('/business/comment/list')) {
      const list = (api.comments[o.qs.video_id] || []).slice().sort((a, b) => b.create_time - a.create_time)
      const start = Number(o.qs.cursor || 0)
      return ok({ comments: list.slice(start, start + 30), cursor: start + 30, has_more: start + 30 < list.length })
    }
    if (p.startsWith('/business/comment/reply/create')) { api.replies.push(o.body); return ok({ comment_id: 'r' + api.replies.length }) }
    if (p.startsWith('/business/comment/hide')) { api.hidden.push(o.body); return ok({}) }
    return { statusCode: 404, body: { code: 404, message: 'unknown ' + p } }
  }
  return api
}

async function run(file, nodes, http, sd, input) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('node tidak ada di fixture: ' + name)
    const items = (Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]]).map((json) => ({ json }))
    return { first: () => items[0] || { json: {} }, all: () => items, itemMatching: (i) => items[i] }
  }
  const inp = (input || []).map((json) => ({ json }))
  const fn = new AsyncFunction('$', '$input', '$getWorkflowStaticData', 'require', src(file))
  return (await fn.call({ helpers: { httpRequest: http } }, $, { all: () => inp, first: () => inp[0] }, () => sd, require)).map((i) => i.json)
}

const NOW_S = () => Math.floor(Date.now() / 1000)
const future = new Date(Date.now() + 30 * 86400000).toISOString()
const tokenOk = new Date(Date.now() + 20 * 3600000).toISOString()
const GID = 'u_' + 'a'.repeat(24)
const OID = '-000tiktokopenid1'
const settings = [{ key: 'tiktok_app_id', value: '1' }, { key: 'tiktok_secret', value: 's' }]
const ttAcc = (extra = {}) => ({ id: 1, open_id: OID, owner_id: GID, access_token: 'tok', refresh_token: 'r', token_expires_at: tokenOk, username: 'toko', connected_at: '2026-11-01T00:00:00Z', ...extra })
const rule = (id, extra = {}) => ({ id, account_id: OID, channel: 'tiktok', active: true, name: 'R' + id, post_ids: '*', keywords: 'harga', match_mode: 'contains', comment_replies: 'Cek DM ya {username}', ai_fallback: false, ai_context: '', hide_comment: false, ...extra })
const comment = (id, vid, text, ago = 0, extra = {}) => ({ comment_id: id, video_id: vid, text, username: 'pembeli' + id, user_id: 'u' + id, create_time: NOW_S() - ago, owner: false, status: 'PUBLIC', ...extra })
const kreator = [{ id: 1, account_id: GID, plan: 'kreator', period_end: future }]

function fixture({ rules = [rule(1)], accounts = [ttAcc()], ig = [], billing = [], usage = [], credits = [], logs = [], extraSettings = [] } = {}) {
  return {
    'Baca Settings': settings.concat(extraSettings), 'Baca Rules TikTok': rules, 'Baca Akun TikTok': accounts, 'Baca Akun IG': ig,
    'Baca Billing': billing, 'Baca Usage': usage, 'Baca Kredit': credits, 'Baca Log TikTok': logs,
  }
}

let pass = 0, failN = 0
const check = (name, cond, info) => { if (cond) pass++; else failN++; console.log((cond ? '  OK   ' : '  GAGAL') + ' ' + name + (cond ? '' : '  -> ' + JSON.stringify(info).slice(0, 500))) }
const kinds = (out, k) => out.filter((x) => x.kind === k)
const logs = (out, t) => out.filter((x) => x.kind === 'log' && x.type === t)
// Lewati jeda polling antar putaran (interval paket) tanpa menunggu
const age = (sd, ms = 3600000) => { for (const s of Object.values(sd.tt || {})) s.last -= ms }

console.log('Polling & baseline')
let api = fakeTikTok(); let sd = {}
api.videos = [{ item_id: '7001', comments: 2 }, { item_id: '7002', comments: 0 }]
api.comments['7001'] = [comment('c1', '7001', 'harga berapa kak', 3600), comment('c2', '7001', 'mantap', 7200)]
let out = await run('tt_auto.js', fixture(), api.http, sd)
check('putaran pertama: komentar lama tidak dibalas', api.replies.length === 0 && logs(out, 'tt_comment_in').length === 0, { out, replies: api.replies })
check('putaran pertama: state baseline tersimpan', sd.tt && sd.tt[OID] && sd.tt[OID].since > 0 && sd.tt[OID].videos['7001'] === 2, sd)

api.calls = []
out = await run('tt_auto.js', fixture(), api.http, sd)
check('Gratis: putaran berikut < 30 menit dilewati (tanpa panggilan API)', api.calls.length === 0, api.calls)

age(sd); api.calls = []
out = await run('tt_auto.js', fixture(), api.http, sd)
check('jumlah komentar tidak berubah -> komentar tidak dibaca', !api.calls.some((c) => c.startsWith('/business/comment/list')), api.calls)

console.log('Balas keyword')
api.comments['7001'].push(comment('c3', '7001', 'Kak HARGA paket ini?', -5))
api.videos[0].comments = 3
age(sd); api.calls = []
out = await run('tt_auto.js', fixture(), api.http, sd)
check('komentar baru cocok keyword -> dibalas', api.replies.length === 1 && api.replies[0].comment_id === 'c3' && api.replies[0].text === 'Cek DM ya @pembelic3', api.replies)
check('log tt_comment_in + tt_reply tercatat', logs(out, 'tt_comment_in').length === 1 && logs(out, 'tt_reply')[0].status === 'ok' && logs(out, 'tt_reply')[0].rule_id === '1' && logs(out, 'tt_reply')[0].media_id === '7001', out)
check('usage komentar TikTok dicatat per open_id', kinds(out, 'usage')[0]?.account_id === OID && kinds(out, 'usage')[0]?.comments === 1, kinds(out, 'usage'))
check('item log tidak membawa objek rule', !out.some((x) => 'rule' in x), out[0])

api.videos[0].comments = 4 // jumlah berubah (balasan kita sendiri) -> dibaca ulang, tapi tidak dobel
api.comments['7001'].push(comment('r1', '7001', 'Cek DM ya @pembelic3', -6, { owner: true }))
age(sd)
out = await run('tt_auto.js', fixture(), api.http, sd)
check('tidak membalas dua kali & mengabaikan komentar akun sendiri', api.replies.length === 1 && logs(out, 'tt_comment_in').length === 0, { replies: api.replies, out })

// static data hilang (mis. eksekusi gagal) -> log jadi pengaman
const sd2 = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
const api2 = fakeTikTok(); api2.videos = api.videos; api2.comments = api.comments
out = await run('tt_auto.js', fixture({ logs: [{ account_id: OID, type: 'tt_reply', ref_id: 'c3' }] }), api2.http, sd2)
check('state hilang: komentar yang sudah dibalas menurut log tidak dibalas lagi', api2.replies.length === 0, api2.replies)

console.log('Sembunyikan spam & urutan rule')
api = fakeTikTok(); sd = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
api.videos = [{ item_id: '7001', comments: 3 }]
api.comments['7001'] = [comment('s1', '7001', 'main slot gacor di sini'), comment('s2', '7001', 'halo kak'), comment('s3', '7001', 'balasan', 0, { parent_comment_id: 's2' })]
const rules = [rule(1, { match_mode: 'any', comment_replies: 'Makasih {username}!' }), rule(2, { keywords: 'slot, judi', hide_comment: true, comment_replies: '' })]
out = await run('tt_auto.js', fixture({ rules }), api.http, sd)
check('rule sembunyikan didahulukan dari rule "semua"', api.hidden.length === 1 && api.hidden[0].comment_id === 's1' && api.hidden[0].action === 'HIDE', api.hidden)
check('spam tidak dibalas, komentar biasa dibalas', api.replies.length === 1 && api.replies[0].comment_id === 's2', api.replies)
check('balasan (anak komentar) dilewati', !api.replies.some((r) => r.comment_id === 's3') && !logs(out, 'tt_comment_in').some((l) => l.ref_id === 's3'), out)
check('log tt_hide tercatat', logs(out, 'tt_hide').length === 1 && logs(out, 'tt_hide')[0].rule_id === '2', logs(out, 'tt_hide'))

console.log('Video tertentu')
api = fakeTikTok(); sd = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
api.videos = [{ item_id: '7001', comments: 1 }, { item_id: '7002', comments: 1 }]
api.comments['7001'] = [comment('v1', '7001', 'harga?')]; api.comments['7002'] = [comment('v2', '7002', 'harga?')]
out = await run('tt_auto.js', fixture({ rules: [rule(1, { post_ids: '7002' })] }), api.http, sd)
check('rule video tertentu hanya membalas video itu', api.replies.length === 1 && api.replies[0].video_id === '7002', api.replies)
check('video lain tidak dibaca komentarnya', !api.calls.some((c) => c.startsWith('/business/comment/list')) || api.calls.filter((c) => c.startsWith('/business/comment/list')).length === 1, api.calls)

console.log('Balasan AI & kuota')
const aiRule = rule(1, { keywords: 'harga', comment_replies: 'Cek DM', ai_fallback: true, ai_context: 'Kaos 50rb' })
api = fakeTikTok(); sd = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
api.videos = [{ item_id: '7001', comments: 2 }]
api.comments['7001'] = [comment('a1', '7001', 'ada ukuran XL?'), comment('a2', '7001', 'harga?')]
out = await run('tt_auto.js', fixture({ rules: [aiRule] }), api.http, sd)
check('Gratis tanpa kredit: AI tidak dipanggil & tanpa log kuota', kinds(out, 'ai').length === 0 && logs(out, 'quota').length === 0 && api.replies.length === 1, out)

api = fakeTikTok(); sd = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
api.videos = [{ item_id: '7001', comments: 1 }]
api.comments['7001'] = [comment('a1', '7001', 'ada ukuran XL?')]
out = await run('tt_auto.js', fixture({ rules: [aiRule], billing: kreator }), api.http, sd)
const ai = kinds(out, 'ai')[0]
check('Kreator: komentar tidak cocok -> antre balasan AI', ai && ai.comment_id === 'a1' && ai.video_id === '7001' && ai.account_id === OID && ai.ai_context === 'Kaos 50rb', out)
check('Kreator: pemakaian AI dicatat', kinds(out, 'usage')[0]?.ai === 1, kinds(out, 'usage'))

api = fakeTikTok(); sd = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
api.videos = [{ item_id: '7001', comments: 1 }]
api.comments['7001'] = [comment('a1', '7001', 'ada ukuran XL?')]
// kuota AI Kreator (50) sudah habis dipakai akun Instagram grup yang sama
const igUsage = [{ id: 1, account_id: '17000000000000001', month: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7), ai: 50, dm: 0 }]
const igAcc = [{ id: 1, ig_user_id: '17000000000000001', owner_id: GID, access_token: 't', connected_at: '2026-10-01T00:00:00Z' }]
const bisnis = [{ id: 1, account_id: GID, plan: 'bisnis', period_end: future }]
out = await run('tt_auto.js', fixture({ rules: [aiRule], billing: [{ ...kreator[0], plan: 'pro' }], ig: igAcc, usage: [{ ...igUsage[0], ai: 1000 }] }), api.http, sd)
check('kuota AI dibagi dengan Instagram: habis -> log kuota, tanpa AI', kinds(out, 'ai').length === 0 && logs(out, 'quota').length === 1, out)

api = fakeTikTok(); sd = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
api.videos = [{ item_id: '7001', comments: 1 }]
api.comments['7001'] = [comment('a1', '7001', 'ada ukuran XL?')]
out = await run('tt_auto.js', fixture({ rules: [aiRule], billing: bisnis, ig: igAcc, usage: [{ ...igUsage[0], ai: 5000 }], credits: [{ id: 1, account_id: GID, granted: 5, used: 1 }] }), api.http, sd)
check('kuota habis tapi ada kredit top-up -> AI jalan, kredit terpakai', kinds(out, 'ai').length === 1 && kinds(out, 'credits')[0]?.used === 2 && kinds(out, 'credits')[0]?.account_id === GID, out)

api = fakeTikTok(); sd = { tt: { [OID]: { since: NOW_S() - 600, last: 0, videos: {}, seen: [] } } }
api.videos = [{ item_id: '7001', comments: 12 }]
api.comments['7001'] = Array.from({ length: 12 }, (_, i) => comment('m' + i, '7001', 'pertanyaan ' + i, 100 - i))
out = await run('tt_auto.js', fixture({ rules: [aiRule], billing: bisnis }), api.http, sd)
check('maks 10 balasan AI per putaran', kinds(out, 'ai').length === 10 && sd.tt[OID].videos['7001'] === undefined, { n: kinds(out, 'ai').length, st: sd.tt[OID].videos })
age(sd)
out = await run('tt_auto.js', fixture({ rules: [aiRule], billing: bisnis }), api.http, sd)
check('sisa komentar AI diproses putaran berikut tanpa dobel', kinds(out, 'ai').length === 2 && kinds(out, 'ai').every((x) => ['m10', 'm11'].includes(x.comment_id)) && sd.tt[OID].videos['7001'] === 12, kinds(out, 'ai'))

console.log('Kirim balasan AI')
const aiItems = [{ kind: 'ai', account_id: OID, comment_id: 'a1', video_id: '7001', ig_user_id: 'ua1', username: 'b', rule_id: '1', rule_name: 'R' }]
const tokenItem = { kind: 'token', tt: { open_id: OID, access_token: 'segar' } }
api = fakeTikTok()
let tokenSeen = ''
const http2 = async (o) => { tokenSeen = o.headers['Access-Token']; return api.http(o) }
let sent = await run('tt_ai_send.js', { 'Baca Settings': settings, 'Baca Akun TikTok': [ttAcc()], 'Proses TikTok': [tokenItem], 'Rute TikTok': aiItems }, http2, {},
  [{ text: '"Ada kak, ukuran XL ready! Cek keranjang kuning ya ' + 'x'.repeat(200) + '"' }])
check('balasan AI dipotong <= 150 karakter & memakai token hasil refresh', api.replies[0].text.length <= 150 && tokenSeen === 'segar' && sent[0].type === 'tt_ai_reply' && sent[0].status === 'ok', { sent, r: api.replies })
sent = await run('tt_ai_send.js', { 'Baca Settings': settings, 'Baca Akun TikTok': [ttAcc()], 'Proses TikTok': [], 'Rute TikTok': aiItems }, api.http, {}, [{ text: 'SKIP' }])
check('AI menjawab SKIP -> tidak dibalas', sent[0].status === 'skipped' && api.replies.length === 1, sent)

console.log('Akun & token')
api = fakeTikTok(); sd = {}
out = await run('tt_auto.js', fixture({ rules: [] }), api.http, sd)
check('tanpa rule aktif -> tidak memanggil TikTok', api.calls.length === 0 && out.length === 0, api.calls)
out = await run('tt_auto.js', fixture({ rules: [rule(1, { active: false })] }), api.http, sd)
check('rule nonaktif -> tidak memanggil TikTok', api.calls.length === 0, api.calls)
out = await run('tt_auto.js', fixture({ billing: [{ id: 1, account_id: GID, plan: 'free', suspended: true }] }), api.http, sd)
check('akun dinonaktifkan superadmin -> dilewati', api.calls.length === 0, api.calls)
out = await run('tt_auto.js', fixture({ ig: igAcc }), api.http, sd)
check('paket Gratis (1 akun) sudah dipakai IG -> TikTok tidak aktif', api.calls.length === 0, api.calls)
out = await run('tt_auto.js', fixture({ accounts: [ttAcc({ owner_id: 'unlinked', access_token: '' })] }), api.http, sd)
check('akun TikTok dilepas -> dilewati', api.calls.length === 0, api.calls)

api = fakeTikTok(); sd = {}
api.videos = [{ item_id: '7001', comments: 0 }]
out = await run('tt_auto.js', fixture({ accounts: [ttAcc({ token_expires_at: new Date(Date.now() + 60000).toISOString() })] }), api.http, sd)
check('token hampir habis -> diperpanjang & disimpan', kinds(out, 'token')[0]?.tt.access_token === 'baru' && api.calls[1].startsWith('/business/video/list'), out)
api = fakeTikTok(); api.refreshOk = false; sd = {}
out = await run('tt_auto.js', fixture({ accounts: [ttAcc({ token_expires_at: new Date(Date.now() - 60000).toISOString() })] }), api.http, sd)
check('refresh gagal -> error dicatat, video tidak dibaca', /Refresh gagal/.test(kinds(out, 'token')[0]?.tt.token_refresh_error) && logs(out, 'tt_error').length === 1 && api.calls.length === 1, out)
age(sd)
out = await run('tt_auto.js', fixture({ accounts: [ttAcc({ token_expires_at: new Date(Date.now() - 60000).toISOString() })] }), api.http, sd)
check('error yang sama tidak dicatat ulang dalam 1 jam', logs(out, 'tt_error').length === 0, out)

api = fakeTikTok(); api.failVideos = true; sd = {}
out = await run('tt_auto.js', fixture(), api.http, sd)
check('gagal membaca video -> log error', logs(out, 'tt_error').length === 1 && /expired/.test(logs(out, 'tt_error')[0].error), out)

sd = { tt: { [OID]: { since: 1, last: 0, videos: {}, seen: [] }, '-000lain': { since: 1 } } }
out = await run('tt_auto.js', fixture({ rules: [] }), fakeTikTok().http, sd)
check('state akun tanpa rule / sudah dilepas dibuang', Object.keys(sd.tt).length === 0, sd)

console.log(`\n${pass} lolos, ${failN} gagal`)
process.exit(failN ? 1 : 0)

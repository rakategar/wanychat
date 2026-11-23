#!/usr/bin/env node
// Uji unit logika tautan akun sosial: menjalankan code/oauth_callback.js & code/tiktok_link.js dengan data tiruan
// (tanpa n8n, tanpa OAuth asli).   node dev/test_claim.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const CODE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'code')
const require = createRequire(import.meta.url)
const src = (f) => fs.readFileSync(path.join(CODE, f), 'utf8').replace(/^\/\/#include (\S+)$/gm, (_, g) => fs.readFileSync(path.join(CODE, g), 'utf8'))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
async function run(file, nodes, http) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('node tidak ada di fixture: ' + name)
    const items = (Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]]).map((json) => ({ json }))
    return { first: () => items[0] || { json: {} }, all: () => items, item: items[0] }
  }
  const fn = new AsyncFunction('$', '$input', '$getWorkflowStaticData', 'require', src(file))
  const out = await fn.call({ helpers: { httpRequest: http || (async () => ({ statusCode: 500, body: {} })) } }, $, { first: () => ({ json: {} }) }, () => ({}), require)
  return out[0].json
}

const settings = [{ key: 'public_url', value: 'http://localhost:5180' }, { key: 'ig_app_id', value: '1' }, { key: 'app_secret', value: 's' }]
const future = new Date(Date.now() + 30 * 86400000).toISOString()
// Graph API tiruan: token -> token panjang -> profil IG id `igId`
const igHttp = (igId) => async (o) => {
  if (o.url.includes('oauth/access_token')) return { statusCode: 200, body: { access_token: 'short', user_id: igId } }
  if (o.url.endsWith('/access_token')) return { statusCode: 200, body: { access_token: 'long', expires_in: 5184000 } }
  if (o.url.endsWith('/me')) return { statusCode: 200, body: { user_id: igId, username: 'akun' + igId } }
  return { statusCode: 200, body: { success: true } }
}
const user = (uid, group) => ({ id: 1, uid, group_id: group || uid, email: uid + '@x.id', onboarding: '{}' })
function igFixture({ me, accounts = [], users = [], billing = [], credits = [], tt = [], state = 'abc', cookieState = 'abc', session = true }) {
  return {
    'Webhook Login Callback': { query: { code: 'c', state }, headers: { cookie: 'wany_state=' + cookieState } },
    'Baca Settings Callback': settings,
    'Cari Sesi Callback': session ? { token: 'h', user_id: me.uid, expires_at: future } : {},
    'Baca User Callback': session ? me : {},
    'Baca Akun Callback': accounts, 'Baca Semua User Callback': [me, ...users], 'Baca Billing Callback': billing,
    'Baca Kredit Callback': credits, 'Baca TikTok Callback': tt,
  }
}
const acc = (id, owner = '', extra = {}) => ({ id: Number(id.slice(-3)) || 1, ig_user_id: id, owner_id: owner, access_token: 'tok', username: 'a' + id, ...extra })

let pass = 0, failN = 0
const check = (name, cond, info) => { if (cond) pass++; else failN++; console.log((cond ? '  OK   ' : '  GAGAL') + ' ' + name + (cond ? '' : '  -> ' + JSON.stringify(info).slice(0, 400))) }

console.log('Instagram: tautkan & klaim')
const U = user('u_' + 'a'.repeat(24))
let r = await run('oauth_callback.js', igFixture({ me: U }), igHttp('17000000000000001'))
check('IG baru -> milik grup user', r.ok && r.account.owner_id === U.uid && r.user.group_id === U.uid && !r.repoint.length, r)

r = await run('oauth_callback.js', igFixture({ me: U, accounts: [acc('17000000000000002', 'u_' + 'b'.repeat(24))], users: [user('u_' + 'b'.repeat(24))] }), igHttp('17000000000000002'))
check('IG milik user lain -> ditolak', !r.ok && /akun Wanychat lain/.test(decodeURIComponent(r.location)), r)

r = await run('oauth_callback.js', igFixture({ me: U, accounts: [acc('17000000000000003'), acc('17000000000000004', '17000000000000003')],
  billing: [{ id: 1, account_id: '17000000000000003', plan: 'pro', period_end: future }] }), igHttp('17000000000000003'))
check('IG lama (pemilik grup), user kosong -> ambil alih grup lama', r.ok && r.user.group_id === '17000000000000003' && r.account.owner_id === '' && /claimed=1/.test(r.location), r)

r = await run('oauth_callback.js', igFixture({ me: U, accounts: [acc('17000000000000003'), acc('17000000000000004', '17000000000000003')] }), igHttp('17000000000000004'))
check('IG lama (anggota grup), user kosong -> ambil alih grup pemilik', r.ok && r.user.group_id === '17000000000000003' && r.account.owner_id === '17000000000000003', r)

const UB = user('u_' + 'c'.repeat(24))
const pro = [{ id: 1, account_id: UB.uid, plan: 'bisnis', period_end: future }]
r = await run('oauth_callback.js', igFixture({ me: UB, billing: pro, accounts: [acc('17000000000000010', UB.uid), acc('17000000000000011'), acc('17000000000000012', '17000000000000011')] }), igHttp('17000000000000011'))
check('IG lama gratis, user sudah berisi -> akun grup lama dipindah', r.ok && r.user.group_id === UB.uid && r.account.owner_id === UB.uid
  && r.repoint.length === 1 && r.repoint[0].ig_user_id === '17000000000000012' && r.repoint[0].owner_id === UB.uid, r)

r = await run('oauth_callback.js', igFixture({ me: UB, billing: pro.concat([{ id: 2, account_id: '17000000000000011', plan: 'kreator', period_end: future }]),
  accounts: [acc('17000000000000010', UB.uid), acc('17000000000000011')] }), igHttp('17000000000000011'))
check('IG lama berbayar + user sudah berisi -> ditolak (hubungi admin)', !r.ok && /paket atau kredit aktif/.test(decodeURIComponent(r.location)), r)

r = await run('oauth_callback.js', igFixture({ me: U, accounts: [acc('17000000000000020', U.uid)] }), igHttp('17000000000000021'))
check('Paket Gratis (1 akun) + IG kedua -> ditolak batas akun', !r.ok && /maksimal 1 akun/.test(decodeURIComponent(r.location)), r)

r = await run('oauth_callback.js', igFixture({ me: U, tt: [{ open_id: 'tt1', owner_id: U.uid, access_token: 't' }] }), igHttp('17000000000000022'))
check('Batas akun dihitung gabungan IG + TikTok', !r.ok && /maksimal 1 akun/.test(decodeURIComponent(r.location)), r)

r = await run('oauth_callback.js', igFixture({ me: U, accounts: [acc('17000000000000020', U.uid)] }), igHttp('17000000000000020'))
check('Hubungkan ulang IG sendiri -> boleh (tanpa cek batas)', r.ok && r.account.owner_id === U.uid, r)

r = await run('oauth_callback.js', igFixture({ me: U, accounts: [acc('17000000000000030', 'unlinked', { access_token: '' })] }), igHttp('17000000000000030'))
check('IG yang pernah dilepas -> bisa ditautkan user mana pun', r.ok && r.account.owner_id === U.uid && r.user.group_id === U.uid, r)

r = await run('oauth_callback.js', igFixture({ me: U, session: false }), igHttp('17000000000000040'))
check('Tanpa login Wanychat -> ditolak', !r.ok && /Masuk dulu/.test(decodeURIComponent(r.location)), r)

r = await run('oauth_callback.js', igFixture({ me: U, state: 'abc', cookieState: 'xyz' }), igHttp('17000000000000041'))
check('State OAuth tidak cocok -> ditolak', !r.ok && /kedaluwarsa/.test(decodeURIComponent(r.location)), r)

r = await run('oauth_callback.js', igFixture({ me: U, state: 'abc-ob', cookieState: 'abc-ob' }), igHttp('17000000000000042'))
check('Dari onboarding -> kembali ke onboarding langkah berikutnya', r.ok && /#\/onboarding\?step=about&connected=instagram/.test(r.location), r)

r = await run('oauth_callback.js', igFixture({ me: U, billing: [{ id: 1, account_id: U.uid, plan: 'free', suspended: true }] }), igHttp('17000000000000043'))
check('Akun disuspend -> ditolak', !r.ok && /dinonaktifkan/.test(decodeURIComponent(r.location)), r)

console.log('TikTok: tautkan')
const ttx = (openId, extra = {}) => ({ ok: true, open_id: openId, back: 'http://localhost:5180/#/tiktok', onboarding: false,
  account: { open_id: openId, username: 'tt' + openId, access_token: 'a', refresh_token: 'r', ...extra } })
const ttFix = ({ me = U, x, related = [], ig = [], billing = [], session = true }) => ({
  'Baca Settings TikTok': settings, 'Tukar Kode TikTok': x,
  'Cari Sesi TikTok': session ? { token: 'h', user_id: me.uid, expires_at: future } : {}, 'Baca User TikTok': session ? me : {},
  'Baca TikTok Terkait': related, 'Baca Akun Grup TikTok': ig, 'Baca Billing TikTok': billing,
})
r = await run('tiktok_link.js', ttFix({ x: ttx('7001') }))
check('TikTok baru -> milik grup user', r.ok && r.account.owner_id === U.uid && /connected=1/.test(r.location), r)
r = await run('tiktok_link.js', ttFix({ x: ttx('7002'), related: [{ id: 1, open_id: '7002', owner_id: 'u_' + 'b'.repeat(24) }] }))
check('TikTok milik user lain -> ditolak', !r.ok && /akun Wanychat lain/.test(decodeURIComponent(r.location)), r)
r = await run('tiktok_link.js', ttFix({ x: ttx('7003'), ig: [acc('17000000000000050', U.uid)] }))
check('Gratis + sudah ada IG -> TikTok ditolak batas akun', !r.ok && /maksimal 1 akun/.test(decodeURIComponent(r.location)), r)
r = await run('tiktok_link.js', ttFix({ x: ttx('7004', { username: '' }), related: [{ id: 1, open_id: '7004', owner_id: U.uid, username: 'lama', connected_at: '2026-01-01T00:00:00Z' }] }))
check('Hubungkan ulang TikTok sendiri -> data lama dipertahankan', r.ok && r.account.username === 'lama' && r.account.connected_at === '2026-01-01T00:00:00Z', r)
r = await run('tiktok_link.js', ttFix({ x: ttx('7005'), related: [{ id: 1, open_id: '7005', owner_id: 'unlinked' }] }))
check('TikTok yang pernah dilepas -> bisa ditautkan', r.ok && r.account.owner_id === U.uid, r)
r = await run('tiktok_link.js', ttFix({ x: ttx('7006'), session: false }))
check('TikTok tanpa login -> ditolak', !r.ok && /Masuk dulu/.test(decodeURIComponent(r.location)), r)

console.log(`\n${pass}/${pass + failN} uji lolos`)
process.exit(failN ? 1 : 0)

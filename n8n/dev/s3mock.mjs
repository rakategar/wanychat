#!/usr/bin/env node
// Bucket S3 tiruan untuk uji lokal posting (pengganti Cloudflare R2): menyimpan objek di memori dan MEMERIKSA tanda tangan
// SigV4 setiap permintaan (URL PUT bertanda tangan dari browser, HEAD/GET/DELETE dari n8n).
//   node dev/s3mock.mjs            -> 0.0.0.0:9000 (container n8n memanggilnya lewat http://172.17.0.1:9000)
// Kredensial uji: access key WANYTESTKEY00000001, secret wanytestsecret0000000000000000, bucket wany-media.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const CODE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'code')
const lib = new Function('require', 'settings', 'helpers', fs.readFileSync(path.join(CODE, 'lib_s3.js'), 'utf8') + '; return { s3Sign };')(require, {}, {})
const KEY = 'WANYTESTKEY00000001', SECRET = 'wanytestsecret0000000000000000', BUCKET = 'wany-media'
const PORT = Number(process.env.PORT || 9000)
const objects = new Map()
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function verify(req, url) {
  const q = Object.fromEntries(url.searchParams)
  const date = (s) => new Date(s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))
  if (q['X-Amz-Signature']) {
    const signed = q['X-Amz-SignedHeaders'].split(';')
    const headers = Object.fromEntries(signed.map((h) => [h, h === 'host' ? req.headers.host : req.headers[h] ?? '']))
    const sig = q['X-Amz-Signature']; delete q['X-Amz-Signature']
    const d = date(q['X-Amz-Date'])
    if (Date.now() > d.getTime() + Number(q['X-Amz-Expires']) * 1000) return 'kedaluwarsa'
    const s = lib.s3Sign({ method: req.method, host: req.headers.host, path: url.pathname, query: q, headers, payloadHash: 'UNSIGNED-PAYLOAD', date: d, region: 'auto', key: KEY, secret: SECRET })
    return s.signature === sig ? '' : 'tanda tangan URL salah'
  }
  const m = /Credential=([^/]+)\/[^,]+, SignedHeaders=([^,]+), Signature=([a-f0-9]+)/.exec(req.headers.authorization || '')
  if (!m || m[1] !== KEY) return 'tanpa otorisasi'
  const headers = Object.fromEntries(m[2].split(';').map((h) => [h, h === 'host' ? req.headers.host : req.headers[h] ?? '']))
  const s = lib.s3Sign({ method: req.method, host: req.headers.host, path: url.pathname, query: {}, headers, payloadHash: req.headers['x-amz-content-sha256'], date: date(req.headers['x-amz-date']), region: 'auto', key: KEY, secret: SECRET })
  return s.signature === m[3] ? '' : 'tanda tangan header salah'
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host)
  const cors = { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-methods': 'PUT, GET, HEAD', 'access-control-allow-headers': 'content-type' }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  if (url.pathname === '/_debug') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...objects.keys()])) }
  if (!url.pathname.startsWith('/' + BUCKET + '/')) { res.writeHead(404); return res.end() }
  const key = decodeURIComponent(url.pathname.slice(BUCKET.length + 2))
  const bad = verify(req, url)
  if (bad) { log(req.method, key, '403', bad); res.writeHead(403, cors); return res.end(bad) }
  if (req.method === 'PUT') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      if (String(body.length) !== String(req.headers['content-length'])) { res.writeHead(400, cors); return res.end('panjang beda') }
      objects.set(key, { body, type: req.headers['content-type'] })
      log('PUT', key, body.length)
      res.writeHead(200, Object.assign({ etag: '"x"' }, cors)); res.end()
    })
    return
  }
  const obj = objects.get(key)
  if (req.method === 'DELETE') { objects.delete(key); log('DELETE', key); res.writeHead(204); return res.end() }
  if (!obj) { res.writeHead(404); return res.end() }
  if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': obj.body.length, 'content-type': obj.type }); return res.end() }
  const r = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '')
  const part = r ? obj.body.subarray(Number(r[1]), Number(r[2]) + 1) : obj.body
  log('GET', key, r ? 'range ' + r[0] : 'utuh')
  res.writeHead(r ? 206 : 200, { 'content-length': part.length, 'content-type': obj.type }); res.end(part)
}).listen(PORT, '0.0.0.0', () => log('s3mock di :' + PORT))

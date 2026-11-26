// ---- lib_s3.js (disisipkan build.py lewat //#include) ----
// Penyimpanan media posting di object storage S3-compatible (Cloudflare R2). Butuh `settings` + `helpers`.
// Browser mengunggah langsung ke bucket lewat URL PUT bertanda tangan (SigV4, berlaku 1 jam); n8n tidak pernah memegang file.
// Instagram & TikTok menarik file dari media_public_base (domain bucket sendiri, mis. https://media.remot.in).
const s3Crypto = require('crypto');
const s3Cfg = () => ({
  endpoint: String(settings.s3_endpoint || '').replace(/\/$/, ''),
  region: String(settings.s3_region || 'auto'),
  bucket: String(settings.s3_bucket || ''),
  key: String(settings.s3_access_key || ''),
  secret: String(settings.s3_secret_key || ''),
  publicBase: String(settings.media_public_base || '').replace(/\/$/, ''),
});
const s3Ready = () => { const c = s3Cfg(); return !!(c.endpoint && c.bucket && c.key && c.secret && /^https:\/\//.test(c.publicBase)); };
const s3Hmac = (k, s) => s3Crypto.createHmac('sha256', k).update(s, 'utf8').digest();
const s3Hex = (s) => s3Crypto.createHash('sha256').update(s, 'utf8').digest('hex');
// RFC 3986 (S3: "~" tidak di-encode); "/" dibiarkan di path objek
function s3Enc(s, keepSlash) {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return keepSlash ? e.replace(/%2F/g, '/') : e;
}
const s3Stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20130524T000000Z

// Tanda tangan SigV4 untuk satu permintaan. headers: huruf kecil, minimal host. query: objek (tanpa X-Amz-Signature).
function s3Sign({ method, host, path, query, headers, payloadHash, date, region, service, key, secret }) {
  const amzDate = s3Stamp(date);
  const day = amzDate.slice(0, 8);
  const scope = day + '/' + region + '/' + (service || 's3') + '/aws4_request';
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const canonHeaders = names.map(h => h + ':' + String(headers[h]).trim().replace(/\s+/g, ' ') + '\n').join('');
  const signedHeaders = names.join(';');
  const q = Object.assign({}, query || {});
  const canonQuery = Object.keys(q).sort().map(k => s3Enc(k) + '=' + s3Enc(String(q[k]))).join('&');
  const canon = [method, s3Enc(path, true), canonQuery, canonHeaders, signedHeaders, payloadHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, s3Hex(canon)].join('\n');
  const kDate = s3Hmac('AWS4' + secret, day);
  const kSign = s3Hmac(s3Hmac(s3Hmac(kDate, region), service || 's3'), 'aws4_request');
  return { signature: s3Hmac(kSign, toSign).toString('hex'), amzDate, scope, signedHeaders, canonQuery };
}

// Sandbox Code node n8n tidak punya global URL: endpoint diurai manual (skema://host[:port][/prefix])
function s3Target(objKey) {
  const c = s3Cfg();
  const m = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(c.endpoint) || ['', 'https', c.endpoint, ''];
  const prefix = String(m[3] || '').replace(/\/$/, '');
  return { c, host: m[2], path: prefix + '/' + c.bucket + '/' + objKey, origin: m[1].toLowerCase() + '://' + m[2] };
}

// URL PUT bertanda tangan (path-style). content-type & content-length ikut ditandatangani: ukuran file terkunci
function s3PresignPut(objKey, contentType, size, expires, now) {
  const { c, host, path, origin } = s3Target(objKey);
  const date = now || new Date();
  const headers = { host, 'content-type': contentType, 'content-length': String(size) };
  const day = s3Stamp(date).slice(0, 8);
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': c.key + '/' + day + '/' + c.region + '/s3/aws4_request',
    'X-Amz-Date': s3Stamp(date), 'X-Amz-Expires': String(expires || 3600), 'X-Amz-SignedHeaders': Object.keys(headers).sort().join(';'),
  };
  const s = s3Sign({ method: 'PUT', host, path, query, headers, payloadHash: 'UNSIGNED-PAYLOAD', date, region: c.region, key: c.key, secret: c.secret });
  return origin + s3Enc(path, true) + '?' + s.canonQuery + '&X-Amz-Signature=' + s.signature;
}

// Permintaan langsung ke bucket (HEAD / GET range / DELETE) dengan header Authorization
async function s3Request(method, objKey, extraHeaders) {
  const { c, host, path, origin } = s3Target(objKey);
  const date = new Date();
  const payloadHash = s3Hex('');
  const headers = Object.assign({ host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': s3Stamp(date) }, extraHeaders || {});
  const s = s3Sign({ method, host, path, query: {}, headers, payloadHash, date, region: c.region, key: c.key, secret: c.secret });
  const send = Object.assign({}, headers, {
    authorization: 'AWS4-HMAC-SHA256 Credential=' + c.key + '/' + s.scope + ', SignedHeaders=' + s.signedHeaders + ', Signature=' + s.signature,
  });
  delete send.host;
  try {
    const res = await helpers.httpRequest({ method, url: origin + s3Enc(path, true), headers: send, encoding: 'arraybuffer',
      ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 30000 });
    const body = res.body ? Buffer.from(res.body) : Buffer.alloc(0);
    return { ok: res.statusCode < 300, status: res.statusCode, headers: res.headers || {}, body };
  } catch (err) {
    return { ok: false, status: -1, headers: {}, body: Buffer.alloc(0), error: err.message };
  }
}
const s3PublicUrl = (objKey) => s3Cfg().publicBase + '/' + s3Enc(objKey, true);
// ---- akhir lib_s3.js ----

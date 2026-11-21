// Catat event ke antrean wany_inbox sebelum diproses. Jika n8n crash di tengah eksekusi (Meta sudah
// menerima 200 dan tidak mengirim ulang), Scheduler memutar ulang event yang statusnya masih `new`.
// Hanya event bertanda tangan Meta yang disimpan; sisanya menimpa satu baris `invalid` supaya tabel tidak bisa dibanjiri.
const crypto = require('crypto');
let secret = '';
for (const it of $('Baca Settings').all()) if (it.json.key === 'app_secret') secret = it.json.value || '';
const { raw, signature } = $('Ambil Body Mentah').first().json;
const expected = secret ? 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(raw || '', 'utf8')).digest('hex') : '';
const valid = !!expected && !!raw && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
return [{ json: valid
  ? { key: crypto.createHash('sha256').update(raw).digest('hex'), raw, signature, status: 'new' }
  : { key: 'invalid', raw: '', signature: '', status: 'rejected' } }];

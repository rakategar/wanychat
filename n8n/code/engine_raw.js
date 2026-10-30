// Ambil body mentah webhook (dibutuhkan untuk cek tanda tangan X-Hub-Signature-256 dari Meta)
let raw = '';
try { raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8'); } catch (e) { raw = ''; }
const h = $input.first().json.headers || {};
return [{ json: { raw, signature: String(h['x-hub-signature-256'] || '') } }];

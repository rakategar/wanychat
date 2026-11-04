// Ambil body mentah + header notifikasi pembayaran. DOKU: tanda tangan dihitung dari byte persis yang dikirim DOKU.
// Midtrans: tanda tangan ada di body (signature_key). Kedua webhook masuk ke node ini.
let raw = '';
try { raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8'); } catch (e) { raw = ''; }
const req = $input.first().json;
const h = req.headers || {};
let body = req.body && typeof req.body === 'object' ? req.body : {};
if (raw) { try { body = JSON.parse(raw); } catch (e) { /* pakai body yang sudah diparse n8n */ } }
const gateway = body.order_id && body.transaction_status ? 'midtrans' : 'doku';
const invoice = String(gateway === 'midtrans' ? body.order_id : (body.order && body.order.invoice_number) || '');
return [{ json: {
  gateway, raw, body, invoice,
  client_id: String(h['client-id'] || ''), request_id: String(h['request-id'] || ''),
  timestamp: String(h['request-timestamp'] || ''), signature: String(h['signature'] || ''),
} }];

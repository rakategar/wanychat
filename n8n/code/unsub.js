// Berhenti langganan email marketing: GET /webhook/wany-unsub?u=<uid>&s=<hmac>. Tanpa login, link bertanda tangan.
const q = $('Webhook Unsub').first().json.query || {};
const settings = {};
for (const it of $('Baca Settings Unsub').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_mail.js
const uid = String(q.u || '');
const page = (title, msg) => '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
  + '<title>' + escHtml(title) + '</title></head><body style="font-family:Arial,sans-serif;background:#fff7e6;padding:40px 16px;text-align:center">'
  + '<h1 style="font-size:22px">' + escHtml(title) + '</h1><p>' + escHtml(msg) + '</p><p><a href="' + escHtml(mailBase()) + '/#/settings">Buka pengaturan Wanychat</a></p></body></html>';
const ok = /^u_[a-f0-9]{24}$/.test(uid) && settings.mail_secret && String(q.s || '') === unsubSig(uid);
return [{ json: {
  ok, uid: ok ? uid : 'none',
  html: ok ? page('Berhasil berhenti berlangganan', 'Kamu tidak akan menerima email promosi Wanychat lagi. Email penting (kode OTP, invoice) tetap dikirim.')
    : page('Link tidak valid', 'Link berhenti berlangganan ini tidak valid. Atur email promosi dari menu Akun di Wanychat.'),
} }];

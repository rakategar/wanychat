// ---- lib_mail.js (disisipkan build.py lewat //#include) ----
// Template email Wanychat. Hasilnya { from, to, subject, text, html, reply_to } untuk node "Kirim Email" (SMTP).
// Butuh `settings` (public_url, mail_from, mail_from_name, mail_secret) di scope pemanggil.
const mailCrypto = require('crypto');
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mailBase = () => String(settings.public_url || 'https://wanychat.remot.in').replace(/\/$/, '');
function mailFrom() {
  const name = String(settings.mail_from_name || 'Wanychat').replace(/["<>\r\n]/g, '').slice(0, 60);
  const addr = String(settings.mail_from || 'contact@remot.in').replace(/[\s<>"]/g, '');
  return '"' + name + '" <' + addr + '>';
}
const rupiah = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

function mailLayout(title, bodyHtml, footerHtml) {
  return '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<title>' + escHtml(title) + '</title></head>'
    + '<body style="margin:0;padding:24px 12px;background:#fff7e6;font-family:Arial,Helvetica,sans-serif;color:#111">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
    + '<table role="presentation" width="100%" style="max-width:520px;background:#fff;border:3px solid #111;border-radius:14px;box-shadow:5px 5px 0 #111" cellspacing="0" cellpadding="0">'
    + '<tr><td style="padding:22px 26px 6px;font-size:22px;font-weight:800">⚡ Wanychat</td></tr>'
    + '<tr><td style="padding:6px 26px 24px;font-size:15px;line-height:1.55">' + bodyHtml + '</td></tr></table>'
    + '<p style="max-width:520px;font-size:12px;color:#555;line-height:1.5;margin:16px auto 0">'
    + (footerHtml || 'Email ini dikirim otomatis oleh Wanychat (PT Remotin Cloud Infrastructure). Jangan balas jika tidak perlu.')
    + '</p></td></tr></table></body></html>';
}
const mailButton = (href, label) => '<p style="margin:22px 0"><a href="' + escHtml(href) + '" style="display:inline-block;background:#ffd84d;color:#111;'
  + 'border:3px solid #111;border-radius:10px;padding:11px 18px;font-weight:800;text-decoration:none">' + escHtml(label) + '</a></p>';

// Kode OTP: purpose verify (daftar) | reset (lupa password)
function mailOtp(to, code, purpose, name) {
  const reset = purpose === 'reset';
  const subject = (reset ? 'Kode reset password Wanychat: ' : 'Kode verifikasi Wanychat: ') + code;
  const hi = name ? 'Halo ' + name + ',' : 'Halo,';
  const what = reset ? 'Gunakan kode ini untuk membuat password baru akun Wanychat kamu.' : 'Gunakan kode ini untuk memverifikasi email akun Wanychat kamu.';
  const text = hi + '\n\n' + what + '\n\n' + code + '\n\nKode berlaku 10 menit. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari Wanychat.\n'
    + 'Kalau kamu tidak meminta kode ini, abaikan email ini.\n\n— Wanychat\n' + mailBase();
  const html = mailLayout(subject, '<p>' + escHtml(hi) + '</p><p>' + escHtml(what) + '</p>'
    + '<p style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f2f2f2;border:2px dashed #111;border-radius:10px;padding:12px 0;text-align:center;margin:20px 0">' + escHtml(code) + '</p>'
    + '<p>Kode berlaku <b>10 menit</b>. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari Wanychat.</p>'
    + '<p style="color:#555">Kalau kamu tidak meminta kode ini, abaikan email ini. Akunmu tetap aman.</p>');
  return { from: mailFrom(), to, subject, text, html, reply_to: '' };
}

// Bukti pembayaran lunas (langganan atau top-up kredit AI)
function mailInvoice(to, name, p, itemName, periodEnd) {
  const date = new Date(p.paid_at || Date.now()).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' });
  const until = periodEnd ? new Date(periodEnd).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long' }) : '';
  const subject = 'Pembayaran diterima: ' + itemName + ' (' + p.order_id + ')';
  const rows = [['No. invoice', p.order_id], ['Tanggal', date + ' WIB'], ['Item', itemName], ['Metode', p.payment_type || '-'], ['Total dibayar', rupiah(p.amount)]]
    .concat(until ? [['Aktif sampai', until]] : []);
  const text = 'Halo ' + (name || '') + ',\n\nTerima kasih, pembayaranmu sudah kami terima.\n\n'
    + rows.map(r => r[0] + ': ' + r[1]).join('\n') + '\n\nRiwayat pembayaran: ' + mailBase() + '/#/billing\n\n— Wanychat\nPT Remotin Cloud Infrastructure';
  const html = mailLayout(subject, '<p>Halo ' + escHtml(name || '') + ',</p><p>Terima kasih, pembayaranmu sudah kami terima. 🎉</p>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:14px 0">'
    + rows.map(r => '<tr><td style="padding:7px 0;border-bottom:1px solid #ddd;color:#555">' + escHtml(r[0]) + '</td><td style="padding:7px 0;border-bottom:1px solid #ddd;text-align:right;font-weight:700">' + escHtml(r[1]) + '</td></tr>').join('')
    + '</table>' + mailButton(mailBase() + '/#/billing', 'Lihat langganan'),
    'Bukti pembayaran ini sah tanpa tanda tangan. Wanychat · PT Remotin Cloud Infrastructure.');
  return { from: mailFrom(), to, subject, text, html, reply_to: '' };
}

// Link berhenti langganan email marketing: HMAC uid dengan rahasia mail_secret (tanpa perlu login)
const unsubSig = (uid) => mailCrypto.createHmac('sha256', String(settings.mail_secret || '')).update('unsub:' + uid).digest('hex').slice(0, 32);
const unsubUrl = (uid) => mailBase() + '/webhook/wany-unsub?u=' + encodeURIComponent(uid) + '&s=' + unsubSig(uid);

// Email marketing/pengumuman. body = teks biasa (baris kosong = paragraf baru, URL otomatis jadi link)
function mailBroadcast(to, name, uid, subject, body) {
  const greet = 'Halo ' + (name || 'kak') + ',';
  const linkify = (s) => escHtml(s).replace(/https?:\/\/[^\s<]+/g, (u) => '<a href="' + u + '" style="color:#111;font-weight:700">' + u + '</a>');
  const paras = String(body).split(/\n{2,}/).map(p => '<p>' + linkify(p).replace(/\n/g, '<br>') + '</p>').join('');
  const unsub = unsubUrl(uid);
  const text = greet + '\n\n' + body + '\n\n— Wanychat\n\nBerhenti menerima email seperti ini: ' + unsub;
  const html = mailLayout(subject, '<p>' + escHtml(greet) + '</p>' + paras,
    'Kamu menerima email ini karena terdaftar di Wanychat dan setuju menerima kabar terbaru. '
    + '<a href="' + escHtml(unsub) + '" style="color:#555">Berhenti berlangganan</a>.');
  return { from: mailFrom(), to, subject: String(subject).slice(0, 150), text, html, reply_to: '' };
}
// ---- akhir lib_mail.js ----

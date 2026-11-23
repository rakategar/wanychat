// ---- lib_user.js (disisipkan build.py lewat //#include) ----
// Akun Wanychat (email/password atau Google), terpisah dari akun sosial (Instagram, TikTok).
// Token sesi & kode OTP hanya disimpan sebagai hash SHA-256; password memakai scrypt.
const userCrypto = require('crypto');
const sha256 = (s) => userCrypto.createHash('sha256').update(String(s)).digest('hex');
const USER_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPw(pw) {
  const salt = userCrypto.randomBytes(16);
  const h = userCrypto.scryptSync(String(pw), salt, 64, USER_SCRYPT);
  return ['scrypt', USER_SCRYPT.N, USER_SCRYPT.r, USER_SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}
// Selalu menjalankan scrypt (hash palsu bila user tidak ada) supaya waktu respons tidak membocorkan email terdaftar
function verifyPw(pw, stored) {
  const parts = String(stored || '').split('$');
  const dummy = parts[0] !== 'scrypt' || parts.length !== 6;
  const [, N, r, pp, salt, hash] = dummy ? ['scrypt', 16384, 8, 1, 'AAAAAAAAAAAAAAAAAAAAAA==', Buffer.alloc(64).toString('base64')] : parts;
  const want = Buffer.from(hash, 'base64');
  const got = userCrypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(pp), maxmem: USER_SCRYPT.maxmem });
  return userCrypto.timingSafeEqual(got, want) && !dummy;
}
const safeEqual = (a, b) => {
  const x = Buffer.from(sha256(a)), y = Buffer.from(sha256(b));
  return userCrypto.timingSafeEqual(x, y) && String(a) === String(b);
};

function parseCookies(header) {
  const c = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) c[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return c;
}
const clientIp = (h) => String((h || {})['x-vercel-forwarded-for'] || (h || {})['cf-connecting-ip'] || (h || {})['x-real-ip'] || (h || {})['x-forwarded-for'] || '').split(',')[0].trim();

const normEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 254);
const validEmail = (e) => /^[^\s@<>"',;()]+@[^\s@<>"',;()]+\.[a-z]{2,}$/i.test(e);
function pwProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Password minimal 8 karakter';
  if (pw.length > 128) return 'Password maksimal 128 karakter';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Password harus berisi huruf dan angka';
  return '';
}
const newUid = () => 'u_' + userCrypto.randomBytes(12).toString('hex');
const newOtpCode = () => String(userCrypto.randomInt(0, 1000000)).padStart(6, '0');
const otpHash = (email, purpose, code) => sha256(normEmail(email) + ':' + purpose + ':' + String(code));

const SESSION_DAYS = 30;
// Sesi baru: token mentah hanya ada di cookie; tabel menyimpan hash-nya
function newSession(userId, extra) {
  const token = userCrypto.randomBytes(32).toString('hex');
  return {
    cookie: 'wany_session=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_DAYS * 86400,
    session: Object.assign({ token: sha256(token), user_id: userId, ig_user_id: '', tt_open_id: '',
      expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() }, extra || {}),
  };
}
const CLEAR_SESSION_COOKIE = 'wany_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

// Baris lengkap wany_users (upsert menimpa semua kolom, jadi selalu kirim baris utuh)
const USER_FIELDS = ['uid', 'email', 'email_verified', 'password_hash', 'google_sub', 'name', 'avatar', 'group_id',
  'onboarding', 'marketing_opt_in', 'last_login_at'];
function userRow(u, fields) {
  const base = {};
  for (const k of USER_FIELDS) base[k] = u && u[k] !== undefined && u[k] !== null ? u[k] : '';
  base.email_verified = isTrueUser(base.email_verified);
  base.marketing_opt_in = isTrueUser(base.marketing_opt_in);
  base.last_login_at = base.last_login_at || null;
  return Object.assign(base, fields || {});
}
const isTrueUser = (v) => v === true || v === 'true';
function readOnboarding(u) {
  try { const o = JSON.parse((u && u.onboarding) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
const onboardingDone = (u) => !!readOnboarding(u).done;
function publicUser(u) {
  return {
    uid: String(u.uid), email: u.email || '', name: u.name || '', avatar: u.avatar || '',
    email_verified: isTrueUser(u.email_verified), has_password: !!u.password_hash, has_google: !!u.google_sub,
    onboarding: readOnboarding(u), marketing_opt_in: isTrueUser(u.marketing_opt_in),
  };
}
// Baris terbaru per kunci (tabel tanpa unique key; baris id terbesar menang)
function latestRow(rows, key, value) {
  let best = null;
  for (const r of rows) if (r && String(r[key]) === String(value) && (!best || Number(r.id) > Number(best.id))) best = r;
  return best;
}

// Batas percobaan per kunci (IP / email) di static data workflow; jendela 15 menit
function makeLimiter(sd, windowMs) {
  sd.hits = sd.hits || {};
  const now = Date.now();
  for (const [k, v] of Object.entries(sd.hits)) if (!v || now - v.t > windowMs) delete sd.hits[k];
  return {
    over: (key, max) => !!sd.hits[key] && sd.hits[key].n >= max,
    hit: (key) => { const v = sd.hits[key] || { n: 0, t: now }; v.n += 1; sd.hits[key] = v; },
    clear: (key) => { delete sd.hits[key]; },
  };
}
// ---- akhir lib_user.js ----

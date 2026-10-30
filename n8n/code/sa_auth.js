// API superadmin: login (scrypt + 2FA TOTP opsional + batas percobaan), sesi cookie HttpOnly, validasi semua perubahan.
//#include lib_plans.js
const crypto = require('crypto');
const helpers = this.helpers;
const req = $('Webhook SA').first().json;
const headers = req.headers || {};
const body = req.body && typeof req.body === 'object' ? req.body : {};
const action = String(body.action || '');
const p = body.payload && typeof body.payload === 'object' ? body.payload : {};
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_midtrans.js
const base = String(settings.public_url || '').replace(/\/$/, '');
const ip = String(headers['x-vercel-forwarded-for'] || headers['cf-connecting-ip'] || headers['x-real-ip'] || '').split(',')[0].trim();
const edgeIp = String(headers['cf-connecting-ip'] || '');
const ua = String(headers['user-agent'] || '').slice(0, 200);
const now = Date.now();
const out = [];
const COOKIE = 'wany_sa';

const send = (response, status) => out.push({ json: { route: 'direct', status: status || (response.ok ? 200 : 400), response } });
const audit = (act, target, detail) => out.push({ json: { route: 'audit', actor: 'superadmin', action: act, target: String(target || ''), detail: String(detail || '').slice(0, 1000), ip } });
const done = (status, response) => { send(response, status); return out; };

// --- primitif keamanan
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(sha256(a)), y = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(x, y) && String(a) === String(b);
};
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}
function verifyPw(pw, stored) {
  const parts = String(stored || '').split('$');
  const dummy = !parts[0] || parts[0] !== 'scrypt' || parts.length !== 6;
  const [, N, r, pp, salt, hash] = dummy ? ['scrypt', 16384, 8, 1, 'AAAAAAAAAAAAAAAAAAAAAA==', Buffer.alloc(64).toString('base64')] : parts;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(pp), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(got, want) && !dummy;
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) {
  let bits = 0, val = 0, s = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { s += B32[(val >>> (bits - 5)) & 31]; bits -= 5; val &= (1 << bits) - 1; }
  }
  if (bits > 0) s += B32[(val << (5 - bits)) & 31];
  return s;
}
function b32dec(s) {
  let bits = 0, val = 0;
  const o = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { o.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
  }
  return Buffer.from(o);
}
function totpAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(step / 4294967296), 0);
  msg.writeUInt32BE(step >>> 0, 4);
  const h = crypto.createHmac('sha1', b32dec(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
const sd = $getWorkflowStaticData('global');
function checkTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    if (safeEq(totpAt(secret, step + d), c)) {
      if (Number(sd.lastTotpStep || 0) >= step + d) return false; // kode yang sama tidak bisa dipakai dua kali
      sd.lastTotpStep = step + d;
      return true;
    }
  }
  return false;
}

// --- batas percobaan login: per IP klien, per IP edge, dan global (15 menit)
const WINDOW = 15 * 60 * 1000;
sd.fails = sd.fails && typeof sd.fails === 'object' ? sd.fails : {};
for (const k of Object.keys(sd.fails)) {
  sd.fails[k] = (sd.fails[k] || []).filter(t => now - t < WINDOW);
  if (!sd.fails[k].length) delete sd.fails[k];
}
const LIMITS = [['ip:' + ip, 5], ['edge:' + edgeIp, 20], ['global', 30]];
const lockedFor = () => {
  for (const [k, n] of LIMITS) {
    const list = sd.fails[k] || [];
    if (list.length >= n) return Math.ceil((WINDOW - (now - list[list.length - n])) / 60000);
  }
  return 0;
};
const recordFail = () => { for (const [k] of LIMITS) (sd.fails[k] = sd.fails[k] || []).push(now); };

// --- CSRF: header khusus + Origin harus sama dengan domain panel
const origin = String(headers.origin || '');
if (String(headers['x-wany-sa'] || '') !== '1' || (origin && origin !== base)) {
  return done(403, { ok: false, error: 'Permintaan ditolak' });
}

if (action === 'sa.login') {
  const wait = lockedFor();
  if (wait) {
    audit('login_locked', ip, 'masih terkunci ' + wait + ' menit');
    return done(429, { ok: false, error: 'Terlalu banyak percobaan gagal. Coba lagi dalam ' + wait + ' menit.' });
  }
  if (!settings.sa_password_hash || !settings.sa_username) return done(503, { ok: false, error: 'Superadmin belum disetel di server.' });
  const userOk = safeEq(String(p.username || '').trim().toLowerCase(), String(settings.sa_username).toLowerCase());
  const pwOk = verifyPw(String(p.password || '').slice(0, 256), settings.sa_password_hash);
  const needTotp = !!settings.sa_totp_secret;
  if (userOk && pwOk && needTotp && !p.code) return done(200, { ok: false, need_totp: true, error: 'Masukkan kode 2FA dari aplikasi authenticator.' });
  const totpOk = !needTotp || checkTotp(settings.sa_totp_secret, p.code);
  if (!(userOk && pwOk && totpOk)) {
    recordFail();
    audit('login_failed', String(p.username || '').slice(0, 60), ua);
    return done(401, { ok: false, error: needTotp && userOk && pwOk ? 'Kode 2FA salah atau sudah dipakai.' : 'Username atau password salah.' });
  }
  delete sd.fails['ip:' + ip];
  const token = crypto.randomBytes(32).toString('hex');
  out.push({ json: {
    route: 'login', token_hash: sha256(token), expires_at: new Date(now + 12 * 3600 * 1000).toISOString(), ip, ua,
    cookie: COOKIE + '=' + token + '; Path=/sa-api; HttpOnly; Secure; SameSite=Strict; Max-Age=43200',
    response: { ok: true, user: settings.sa_username, totp: needTotp },
  } });
  out.push({ json: { route: 'cleanup', before: new Date(now).toISOString() } });
  audit('login_ok', settings.sa_username, ua);
  return out;
}

// --- semua aksi lain butuh sesi superadmin yang sah
const s = $('Cari Sesi Admin').first().json || {};
const sessionOk = !!(s.token_hash && s.expires_at && new Date(s.expires_at).getTime() > now && (!s.ua || s.ua === ua));
if (!sessionOk) return [{ json: { route: 'deny', response: { ok: false, error: 'Sesi superadmin habis. Silakan masuk lagi.' } } }];

const plans = loadPlans(settings);
const billingBy = latestBy($('Baca Billing').all().map(i => i.json), 'account_id');
const saveSettings = (pairs, response, act, detail) => {
  for (const [key, value] of pairs) out.push({ json: { route: 'settings_save', key, value: String(value), response } });
  audit(act, pairs.map(x => x[0]).join(','), detail || '');
  return out;
};

// Setelan yang boleh diubah dari dasbor, beserta validasinya. secret = tidak pernah dikirim balik ke browser.
const BOOL = (v) => v === 'true' || v === 'false';
const NUM = (min, max) => (v) => v !== '' && isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
const PAYMENTS = ['credit_card', 'gopay', 'shopeepay', 'other_qris', 'bca_va', 'bni_va', 'bri_va', 'permata_va', 'cimb_va', 'echannel', 'other_va'];
const EDITABLE = {
  public_url: { ok: (v) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v) },
  graph_version: { ok: (v) => /^v\d{1,2}\.\d$/.test(v) },
  ig_app_id: { ok: (v) => /^\d{5,20}$/.test(v) },
  app_secret: { secret: true, ok: (v) => /^[a-f0-9]{32}$/i.test(v) },
  verify_token: { ok: (v) => /^[\w-]{16,128}$/.test(v) },
  engine_enabled: { ok: BOOL },
  signup_open: { ok: BOOL },
  gemini_enabled: { ok: BOOL },
  gemini_persona: { ok: (v) => v.length <= 2000 },
  announcement: { ok: (v) => v.length <= 300 },
  midtrans_env: { ok: (v) => v === 'sandbox' || v === 'production' },
  midtrans_server_key: { secret: true, ok: (v) => /^(SB-)?Mid-server-[\w.-]{8,}$/.test(v) },
  midtrans_signature_key: { secret: true, ok: (v) => /^(SB-)?Mid-server-[\w.-]{8,}$/.test(v) },
  midtrans_client_key: { ok: (v) => /^(SB-)?Mid-client-[\w.-]{8,}$/.test(v) },
  midtrans_payments: { ok: (v) => v.split(',').every(x => PAYMENTS.includes(x.trim())) && v.trim() !== '' },
  midtrans_fee_pct: { ok: NUM(0, 20) },
  midtrans_fee_flat: { ok: NUM(0, 100000) },
  cost_server_idr: { ok: NUM(0, 100000000) },
  cost_other_idr: { ok: NUM(0, 100000000) },
  cost_ai_per_1m_idr: { ok: NUM(0, 10000000) },
  usd_idr: { ok: NUM(1000, 100000) },
};

function validPlans(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 8) return 'Jumlah paket 1-8';
  const ids = new Set();
  const clean = [];
  for (const x of list) {
    const id = String(x.id || '').trim();
    if (!/^[a-z0-9_]{2,20}$/.test(id) || ids.has(id)) return 'ID paket tidak valid atau dobel: ' + id;
    ids.add(id);
    const n = (v, max) => Math.round(Number(v));
    const item = {
      id, name: String(x.name || '').trim().slice(0, 30), price: n(x.price), dm: n(x.dm), ai: n(x.ai), rules: n(x.rules),
      followup: !!x.followup, persona: !!x.persona,
    };
    if (!item.name) return 'Nama paket ' + id + ' kosong';
    for (const [k, max] of [['price', 100000000], ['dm', 10000000], ['ai', 10000000], ['rules', 1000]]) {
      if (!(item[k] >= 0 && item[k] <= max)) return k + ' paket ' + id + ' tidak valid';
    }
    if (id !== 'free' && item.price > 0 && item.price < 1000) return 'Harga minimal Rp 1.000';
    clean.push(item);
  }
  const free = clean.find(x => x.id === 'free');
  if (!free || free.price !== 0) return 'Paket "free" dengan harga 0 wajib ada';
  return clean;
}

switch (action) {
  case 'sa.me':
    return done(200, { ok: true, user: settings.sa_username, totp: !!settings.sa_totp_secret, expires_at: s.expires_at });

  case 'sa.logout':
    out.push({ json: { route: 'logout', token_hash: s.token_hash, response: { ok: true } } });
    audit('logout', settings.sa_username, '');
    return out;

  case 'sa.overview':
  case 'sa.users':
  case 'sa.payments':
  case 'sa.audit':
  case 'sa.settings.get':
    return [{ json: { route: 'data', action, params: p } }];

  case 'sa.settings.save': {
    const values = p.values && typeof p.values === 'object' ? p.values : {};
    const pairs = [];
    for (const [k, raw] of Object.entries(values)) {
      const def = EDITABLE[k];
      if (!def) return done(400, { ok: false, error: 'Setelan tidak dikenal: ' + k });
      const v = String(raw ?? '').trim();
      if (def.secret && v === '') continue; // kosong = tidak diubah
      if (!def.ok(v)) return done(400, { ok: false, error: 'Nilai tidak valid untuk ' + k });
      if (!def.secret && v === String(settings[k] ?? '')) continue;
      pairs.push([k, v]);
    }
    if (!pairs.length) return done(200, { ok: true, changed: [] });
    return saveSettings(pairs, { ok: true, changed: pairs.map(x => x[0]) }, 'settings_save',
      pairs.map(([k, v]) => k + '=' + (EDITABLE[k].secret ? '••••' + v.slice(-4) : v.slice(0, 80))).join('; '));
  }

  case 'sa.plans.save': {
    const r = validPlans(p.plans);
    if (typeof r === 'string') return done(400, { ok: false, error: r });
    return saveSettings([['plans', JSON.stringify(r)]], { ok: true, plans: r }, 'plans_save', r.map(x => x.id + ':' + x.price).join(' '));
  }

  case 'sa.user.update': {
    const id = String(p.account_id || '');
    if (!/^\d{5,25}$/.test(id)) return done(400, { ok: false, error: 'account_id tidak valid' });
    const cur = billingRow(billingBy[id], id);
    const next = Object.assign({}, cur);
    if (p.plan !== undefined) {
      const plan = plans.find(x => x.id === String(p.plan));
      if (!plan) return done(400, { ok: false, error: 'Paket tidak dikenal' });
      next.plan = plan.id;
      if (plan.id === 'free') Object.assign(next, { status: 'free', period_end: null });
      else {
        const end = new Date(String(p.period_end || '')).getTime();
        if (!(end > now)) return done(400, { ok: false, error: 'Isi tanggal berakhir paket (di masa depan)' });
        Object.assign(next, { status: 'active', period_end: new Date(end).toISOString(), source: 'manual' });
      }
    }
    if (typeof p.suspended === 'boolean') next.suspended = p.suspended;
    if (typeof p.note === 'string') next.note = p.note.trim().slice(0, 300);
    out.push({ json: { route: 'billing_save', billing: next, response: { ok: true, billing: next } } });
    if (next.suspended && !cur.suspended) out.push({ json: { route: 'revoke', account_id: id } });
    audit('user_update', id, ['plan=' + next.plan, 'end=' + (next.period_end || '-'), 'suspended=' + next.suspended, next.note ? 'note' : ''].join(' '));
    return out;
  }

  case 'sa.user.cancel_sub': {
    const id = String(p.account_id || '');
    const cur = billingBy[id];
    if (!cur || !cur.subscription_id) return done(400, { ok: false, error: 'User ini tidak punya langganan otomatis' });
    const r = await midtrans('POST', CORE + '/v1/subscriptions/' + encodeURIComponent(cur.subscription_id) + '/disable');
    if (!r.ok) return done(502, { ok: false, error: 'Midtrans: ' + r.error });
    const next = Object.assign(billingRow(cur, id), { subscription_id: '', cancel_at_period_end: true, status: 'canceled' });
    out.push({ json: { route: 'billing_save', billing: next, response: { ok: true, billing: next } } });
    audit('subscription_cancel', id, cur.subscription_id);
    return out;
  }

  case 'sa.user.revoke': {
    const id = String(p.account_id || '');
    if (!/^\d{5,25}$/.test(id)) return done(400, { ok: false, error: 'account_id tidak valid' });
    out.push({ json: { route: 'revoke', account_id: id, response: { ok: true } } });
    audit('sessions_revoke', id, '');
    return out;
  }

  case 'sa.password': {
    if (!verifyPw(String(p.current || ''), settings.sa_password_hash)) {
      recordFail();
      audit('password_change_failed', settings.sa_username, 'password lama salah');
      return done(400, { ok: false, error: 'Password lama salah' });
    }
    const next = String(p.next || '');
    if (next.length < 12 || next.length > 128 || !/[a-z]/i.test(next) || !/\d/.test(next)) {
      return done(400, { ok: false, error: 'Password baru minimal 12 karakter, berisi huruf dan angka' });
    }
    const pairs = [['sa_password_hash', hashPw(next)]];
    if (p.username !== undefined) {
      const u = String(p.username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(u)) return done(400, { ok: false, error: 'Username 3-40 karakter: huruf, angka, titik, strip' });
      pairs.push(['sa_username', u]);
    }
    return saveSettings(pairs, { ok: true }, 'password_change', '');
  }

  case 'sa.totp.begin': {
    if (settings.sa_totp_secret) return done(400, { ok: false, error: '2FA sudah aktif' });
    const secret = b32enc(crypto.randomBytes(20));
    const uri = 'otpauth://totp/' + encodeURIComponent('Wanychat:' + settings.sa_username) + '?secret=' + secret + '&issuer=Wanychat&algorithm=SHA1&digits=6&period=30';
    return saveSettings([['sa_totp_pending', secret]], { ok: true, secret, uri }, 'totp_begin', '');
  }

  case 'sa.totp.confirm': {
    const pending = settings.sa_totp_pending;
    if (!pending) return done(400, { ok: false, error: 'Mulai ulang aktivasi 2FA' });
    if (!checkTotp(pending, p.code)) return done(400, { ok: false, error: 'Kode salah. Pastikan jam HP akurat.' });
    return saveSettings([['sa_totp_secret', pending], ['sa_totp_pending', '']], { ok: true }, 'totp_enabled', '');
  }

  case 'sa.totp.disable': {
    if (!settings.sa_totp_secret) return done(400, { ok: false, error: '2FA belum aktif' });
    if (!verifyPw(String(p.password || ''), settings.sa_password_hash) || !checkTotp(settings.sa_totp_secret, p.code)) {
      recordFail();
      return done(400, { ok: false, error: 'Password atau kode 2FA salah' });
    }
    return saveSettings([['sa_totp_secret', '']], { ok: true }, 'totp_disabled', '');
  }

  default:
    return done(400, { ok: false, error: 'Aksi tidak dikenal' });
}

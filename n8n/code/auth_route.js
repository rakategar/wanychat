// API akun Wanychat (POST /auth -> /webhook/wany-auth): daftar, masuk, verifikasi OTP email, lupa/reset password.
// Keluaran satu item dengan `route`:
//   direct   -> langsung dibalas
//   user_otp -> simpan user + simpan OTP + kirim email (daftar)
//   otp_mail -> simpan OTP + kirim email (kirim ulang, lupa password, login akun belum terverifikasi)
//   otp_fail -> tambah hitungan salah OTP
//   session  -> tandai OTP terpakai + simpan user + (cabut sesi lama) + buat sesi + set cookie
//#include lib_user.js
const req = $('Webhook Auth').first().json;
const headers = req.headers || {};
const body = req.body && typeof req.body === 'object' ? req.body : {};
const action = String(body.action || '');
const p = body.payload && typeof body.payload === 'object' ? body.payload : {};
const settings = {};
for (const it of $('Baca Settings Auth').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_mail.js
const base = String(settings.public_url || '').replace(/\/$/, '');
const ip = clientIp(headers) || 'unknown';
const sd = $getWorkflowStaticData('global');
const limit = makeLimiter(sd, 15 * 60 * 1000);

const out = (route, response, extra, status) => [{ json: Object.assign({ route, response, status: status || (response.ok ? 200 : 400) }, extra || {}) }];
const fail = (error, status, extra) => out('direct', Object.assign({ ok: false, error }, extra || {}), null, status || 400);

// Tolak permintaan lintas situs (CSRF): browser selalu mengirim Origin untuk POST fetch
const origin = String(headers.origin || '');
const extraOrigins = String(settings.extra_origins || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
if (origin && base && origin !== base && !extraOrigins.includes(origin)) return fail('Permintaan ditolak', 403);
// Batas per IP + batas global (IP dari header bisa dipalsukan bila webhook n8n dipanggil langsung tanpa Vercel)
if (limit.over('ip:' + ip, 40) || limit.over('all', 600)) return fail('Terlalu banyak percobaan. Coba lagi dalam 15 menit.', 429);
limit.hit('ip:' + ip);
limit.hit('all');

const email = normEmail(p.email);
const user = latestRow($('Baca User Auth').all().map(i => i.json), 'email', email);
const otps = $('Baca OTP Auth').all().map(i => i.json).filter(o => o && o.id && o.email === email);
const now = Date.now();
const nextPage = (u) => (onboardingDone(u) ? 'dashboard' : 'onboarding');

// OTP baru (+ throttle 60 detik per email & tujuan)
function issueOtp(purpose, u) {
  const last = otps.filter(o => o.purpose === purpose).sort((a, b) => Number(b.id) - Number(a.id))[0];
  const age = last ? now - new Date(last.createdAt).getTime() : Infinity;
  if (age < 60000) return { wait: Math.ceil((60000 - age) / 1000) };
  const code = newOtpCode();
  return {
    otp: { email, purpose, code_hash: otpHash(email, purpose, code), expires_at: new Date(now + 10 * 60000).toISOString(), tries: 0, used: false, ip },
    mail: mailOtp(email, code, purpose, u && u.name),
  };
}
// Cek kode OTP terbaru yang belum dipakai
function checkOtp(purpose, code) {
  const o = otps.filter(x => x.purpose === purpose && !isTrueUser(x.used)).sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!o || new Date(o.expires_at).getTime() < now) return { error: 'Kode sudah kedaluwarsa. Kirim ulang kode baru.' };
  const tries = Number(o.tries) || 0;
  if (tries >= 5) return { error: 'Terlalu banyak kode salah. Kirim ulang kode baru.' };
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6 || !safeEqual(otpHash(email, purpose, c), o.code_hash)) {
    return { wrong: true, otp_update: { id: o.id, tries: tries + 1, used: tries + 1 >= 5 }, left: 4 - tries };
  }
  return { ok: true, otp_update: { id: o.id, tries, used: true } };
}
// Masuk: simpan user (last_login_at) + sesi baru; revoke = cabut semua sesi lama user (setelah reset password)
function login(u, fields, otpUpdate, revoke) {
  const row = userRow(u, Object.assign({ last_login_at: new Date(now).toISOString() }, fields || {}));
  const s = newSession(row.uid);
  return out('session', { ok: true, next: nextPage(row), user: publicUser(row) }, {
    user: row, otp_update: otpUpdate || { id: -1, tries: 0, used: true }, revoke_user: revoke ? row.uid : 'none',
    session: s.session, cookie: s.cookie,
  });
}

switch (action) {
  case 'register': {
    if (!validEmail(email)) return fail('Format email tidak valid');
    const pw = String(p.password || '');
    const bad = pwProblem(pw);
    if (bad) return fail(bad);
    const name = String(p.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name) return fail('Nama wajib diisi');
    if (user && isTrueUser(user.email_verified)) {
      return fail(user.password_hash ? 'Email sudah terdaftar. Silakan masuk.' : 'Email ini terdaftar lewat Google. Masuk dengan Google, lalu buat password di menu Akun.', 409);
    }
    if (!user && settings.signup_open === 'false') return fail('Pendaftaran akun baru sedang ditutup sementara.', 403);
    // Email belum terverifikasi boleh didaftarkan ulang (password lama diganti): pemilik asli tetap harus lolos OTP
    const uid = user ? String(user.uid) : newUid();
    const row = userRow(user, {
      uid, email, email_verified: false, password_hash: hashPw(pw), name,
      group_id: user && user.group_id ? user.group_id : uid, marketing_opt_in: p.marketing_opt_in !== false,
      onboarding: user && user.onboarding ? user.onboarding : '{}',
    });
    const o = issueOtp('verify', row);
    if (o.wait) return fail('Kode baru saja dikirim. Tunggu ' + o.wait + ' detik lalu coba lagi.', 429, { next: 'verify', email });
    return out('user_otp', { ok: true, next: 'verify', email }, { user: row, otp: o.otp, mail: o.mail });
  }

  case 'login': {
    if (limit.over('email:' + email, 8)) return fail('Terlalu banyak percobaan untuk email ini. Coba lagi dalam 15 menit.', 429);
    const ok = verifyPw(String(p.password || '').slice(0, 256), user && user.password_hash);
    if (!user || !ok) {
      limit.hit('email:' + email);
      if (user && !user.password_hash && user.google_sub) return fail('Akun ini dibuat dengan Google. Pilih "Lanjut dengan Google".', 401);
      return fail('Email atau password salah', 401);
    }
    limit.clear('email:' + email);
    if (!isTrueUser(user.email_verified)) {
      const o = issueOtp('verify', user);
      if (o.wait) return out('direct', { ok: true, next: 'verify', email, notice: 'Masukkan kode verifikasi yang sudah dikirim ke emailmu.' });
      return out('otp_mail', { ok: true, next: 'verify', email, notice: 'Email belum diverifikasi. Kode baru sudah dikirim.' }, { otp: o.otp, mail: o.mail });
    }
    return login(user);
  }

  case 'otp.verify': {
    if (!user) return fail('Kode sudah kedaluwarsa. Kirim ulang kode baru.');
    if (isTrueUser(user.email_verified)) return fail('Email sudah terverifikasi. Silakan masuk.', 409);
    const r = checkOtp('verify', p.code);
    if (r.error) return fail(r.error);
    if (r.wrong) return out('otp_fail', { ok: false, error: r.left > 0 ? 'Kode salah. Sisa ' + r.left + ' kali percobaan.' : 'Kode salah. Kirim ulang kode baru.' }, { otp_update: r.otp_update }, 400);
    return login(user, { email_verified: true }, r.otp_update);
  }

  case 'otp.resend': {
    const purpose = p.purpose === 'reset' ? 'reset' : 'verify';
    const generic = { ok: true, notice: 'Kalau email terdaftar, kode baru sudah dikirim.' };
    if (!user || (purpose === 'verify' && isTrueUser(user.email_verified))) return out('direct', generic);
    const o = issueOtp(purpose, user);
    if (o.wait) return fail('Tunggu ' + o.wait + ' detik sebelum meminta kode baru.', 429);
    return out('otp_mail', generic, { otp: o.otp, mail: o.mail });
  }

  case 'password.forgot': {
    if (!validEmail(email)) return fail('Format email tidak valid');
    // Jawaban sama untuk email terdaftar/tidak (tidak membocorkan siapa yang punya akun)
    const generic = { ok: true, next: 'reset', email, notice: 'Kalau email terdaftar, kode reset sudah dikirim.' };
    if (!user) return out('direct', generic);
    const o = issueOtp('reset', user);
    if (o.wait) return out('direct', generic);
    return out('otp_mail', generic, { otp: o.otp, mail: o.mail });
  }

  case 'password.reset': {
    const pw = String(p.password || '');
    const bad = pwProblem(pw);
    if (bad) return fail(bad);
    if (!user) return fail('Kode sudah kedaluwarsa. Kirim ulang kode baru.');
    const r = checkOtp('reset', p.code);
    if (r.error) return fail(r.error);
    if (r.wrong) return out('otp_fail', { ok: false, error: r.left > 0 ? 'Kode salah. Sisa ' + r.left + ' kali percobaan.' : 'Kode salah. Kirim ulang kode baru.' }, { otp_update: r.otp_update }, 400);
    // Lolos OTP = pemilik email: password diganti, email dianggap terverifikasi, semua sesi lain dicabut
    return login(user, { password_hash: hashPw(pw), email_verified: true }, r.otp_update, true);
  }

  default:
    return fail('Aksi tidak dikenal: ' + action);
}

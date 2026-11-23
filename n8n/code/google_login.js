// Callback Google tahap 2: cocokkan user (google_sub -> email -> baru), buat sesi, arahkan ke onboarding/dasbor
//#include lib_user.js
const s = {};
for (const it of $('Baca Settings Google Callback').all()) if (it.json.key) s[it.json.key] = it.json.value ?? '';
const base = String(s.public_url || '').replace(/\/$/, '');
const fail = (msg) => [{ json: { ok: false, location: base + '/#/login?error=' + encodeURIComponent(String(msg).slice(0, 200)) } }];
const g = $('Tukar Kode Google').first().json.google;
const rows = $('Cari User Google').all().map(i => i.json).filter(u => u && u.uid);
// Email terverifikasi Google = bukti kepemilikan email, jadi boleh menautkan ke akun email/password yang sama
const user = latestRow(rows, 'google_sub', g.sub) || latestRow(rows, 'email', g.email);
if (!user && s.signup_open === 'false') return fail('Pendaftaran akun baru sedang ditutup sementara.');
const uid = user ? String(user.uid) : newUid();
const row = userRow(user, {
  uid, email: user ? user.email || g.email : g.email, email_verified: true, google_sub: g.sub,
  name: (user && user.name) || g.name || g.email.split('@')[0], avatar: (user && user.avatar) || g.avatar,
  group_id: (user && user.group_id) || uid, onboarding: (user && user.onboarding) || '{}',
  marketing_opt_in: user ? isTrueUser(user.marketing_opt_in) : true, last_login_at: new Date().toISOString(),
});
const sess = newSession(uid);
return [{ json: { ok: true, user: row, session: sess.session, cookie: sess.cookie,
  location: base + '/#/' + (onboardingDone(row) ? 'dashboard' : 'onboarding') } }];

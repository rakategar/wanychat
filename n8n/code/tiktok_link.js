// Callback TikTok tahap 2: tautkan akun TikTok ke akun Wanychat yang sedang login (grup langganan user).
// Akun TikTok milik user lain ditolak; batas akun paket dihitung gabungan Instagram + TikTok.
//#include lib_plans.js
//#include lib_user.js
const settings = {};
for (const it of $('Baca Settings TikTok').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const x = $('Tukar Kode TikTok').first().json;
const fail = (msg) => [{ json: { ok: false, location: x.back + '?error=' + encodeURIComponent(String(msg).slice(0, 200)) } }];

const sess = $('Cari Sesi TikTok').first().json;
const sessOk = !!(sess && sess.token && sess.user_id && (!sess.expires_at || new Date(sess.expires_at) > new Date()));
const user = sessOk ? latestRow($('Baca User TikTok').all().map(i => i.json), 'uid', sess.user_id) : null;
if (!user) return fail('Masuk dulu ke akun Wanychat, lalu hubungkan TikTok.');
const gid = String(user.group_id || user.uid);

const ttRows = $('Baca TikTok Terkait').all().map(i => i.json).filter(a => a && a.open_id);
const existing = latestRow(ttRows, 'open_id', x.open_id);
const owner = existing ? String(existing.owner_id || '') : '';
const mine = owner === gid;
if (existing && owner && owner !== 'unlinked' && !mine) return fail('Akun TikTok @' + (x.account.username || x.open_id) + ' sudah terhubung ke akun Wanychat lain.');

const billing = latestBy($('Baca Billing TikTok').all().map(i => i.json), 'account_id')[gid];
if (billing && isTrue(billing.suspended)) return fail('Akun ini dinonaktifkan. Hubungi admin Wanychat.');
const plan = effectivePlan(billing, loadPlans(settings));
const ttCount = ttRows.filter(a => String(a.owner_id) === gid && a.open_id !== x.open_id).length;
const max = Math.max(1, Number(plan.accounts) || 1);
// batas paket per platform: akun Instagram tidak dihitung
if (!mine && ttCount >= max) return fail('Paket ' + plan.name + ' maksimal ' + max + ' akun TikTok. Upgrade di menu Langganan.');

const account = Object.assign({}, x.account, {
  owner_id: gid,
  username: x.account.username || (existing && existing.username) || '',
  display_name: x.account.display_name || (existing && existing.display_name) || '',
  avatar: x.account.avatar || (existing && existing.avatar) || '',
  connected_at: mine && existing.connected_at ? existing.connected_at : new Date().toISOString(),
});
return [{ json: { ok: true, account, location: x.back + (x.onboarding ? '?step=about&connected=tiktok' : '?connected=1') } }];

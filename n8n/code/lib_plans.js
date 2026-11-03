// ---- lib_plans.js (disisipkan build.py lewat //#include) ----
// Paket langganan. Sumber kebenaran: setting "plans" (JSON, diubah dari dasbor superadmin); ini nilai bawaan.
// dm = DM otomatis / bulan, ai = balasan AI / bulan (0 = tanpa AI), rules = jumlah automasi (0 = tanpa batas),
// accounts = akun Instagram per langganan (kuota dibagi bersama), analytics = dasbor analitik lead,
// watermark = DM diberi tanda "via Wanychat" (promosi di paket gratis)
const DEFAULT_PLANS = [
  { id: 'free', name: 'Gratis', price: 0, dm: 100, ai: 0, rules: 3, followup: false, persona: false, accounts: 1, analytics: false, watermark: true },
  { id: 'kreator', name: 'Kreator', price: 49000, dm: 1000, ai: 50, rules: 0, followup: true, persona: false, accounts: 1, analytics: false, watermark: false },
  { id: 'pro', name: 'Pro', price: 99000, dm: 5000, ai: 1000, rules: 0, followup: true, persona: true, accounts: 2, analytics: false, watermark: false },
  { id: 'bisnis', name: 'Bisnis', price: 249000, dm: 20000, ai: 5000, rules: 0, followup: true, persona: true, accounts: 5, analytics: true, watermark: false },
];
const GRACE_MS = 3 * 24 * 3600 * 1000; // tenggang setelah masa aktif habis sebelum turun ke Gratis

function loadPlans(settings) {
  try {
    const p = JSON.parse(settings.plans || '');
    // Paket lama (sebelum ada field accounts/analytics/watermark) dilengkapi dari bawaan dengan id sama
    if (Array.isArray(p) && p.some(x => x && x.id === 'free')) return p.map(x => {
      const d = DEFAULT_PLANS.find(y => y.id === x.id) || { accounts: 1, analytics: false, watermark: false };
      return Object.assign({ accounts: d.accounts, analytics: d.analytics, watermark: d.watermark }, x);
    });
  } catch (e) { /* pakai bawaan */ }
  return DEFAULT_PLANS;
}

// Paket top-up kredit balasan AI (tidak hangus, dipakai setelah kuota bulanan habis). Setting "ai_topups" (JSON).
const DEFAULT_TOPUPS = [
  { id: 'ai100', credits: 100, price: 10000 },
  { id: 'ai500', credits: 500, price: 39000 },
  { id: 'ai2000', credits: 2000, price: 129000 },
];
function loadTopups(settings) {
  try {
    const t = JSON.parse(settings.ai_topups || '');
    if (Array.isArray(t) && t.length) return t.filter(x => x && /^ai\w{1,18}$/.test(x.id) && Number(x.credits) > 0 && Number(x.price) >= 1000)
      .map(x => ({ id: x.id, credits: Math.round(Number(x.credits)), price: Math.round(Number(x.price)) }));
  } catch (e) { /* pakai bawaan */ }
  return DEFAULT_TOPUPS;
}
const creditBalance = (row) => Math.max(0, (Number(row && row.granted) || 0) - (Number(row && row.used) || 0));

// Multi akun: akun tambahan menyimpan owner_id = akun pemilik langganan; pemilik owner_id kosong
const groupOf = (acc) => String((acc && (acc.owner_id || acc.ig_user_id)) || '');
// Urutan akun dalam grup: pemilik dulu, lalu yang lebih dulu terhubung. Hanya `plan.accounts` pertama yang aktif.
function groupMembers(accounts, gid) {
  return accounts.filter(a => a && a.ig_user_id && groupOf(a) === gid).sort((a, b) =>
    (String(a.ig_user_id) === gid ? -1 : String(b.ig_user_id) === gid ? 1 : 0) ||
    String(a.connected_at || a.createdAt || '').localeCompare(String(b.connected_at || b.createdAt || '')) || Number(a.id) - Number(b.id));
}
function activeInGroup(acc, accounts, plan) {
  const members = groupMembers(accounts, groupOf(acc));
  const i = members.findIndex(a => String(a.ig_user_id) === String(acc.ig_user_id));
  return i >= 0 && i < Math.max(1, Number(plan.accounts) || 1);
}
// Pemakaian bulan ini untuk seluruh akun satu grup (kuota paket dibagi bersama)
function groupUsage(usageRows, accounts, gid) {
  const ids = new Set(accounts.filter(a => groupOf(a) === gid).map(a => String(a.ig_user_id)));
  ids.add(gid);
  const latest = latestBy(usageRows, 'account_id');
  const t = { dm: 0, ai: 0 };
  for (const id of ids) if (latest[id]) { t.dm += Number(latest[id].dm) || 0; t.ai += Number(latest[id].ai) || 0; }
  return t;
}

// Tanda promosi di DM paket gratis; teks dasar dipotong supaya total tetap <= 1000 karakter (batas Instagram)
const watermarkText = (settings) => String(settings.watermark_text || '⚡ Dikirim otomatis via Wanychat · wanychat.remot.in').slice(0, 200);
function withWatermark(text, plan, settings) {
  text = String(text || '');
  if (!plan || !isTrue(plan.watermark)) return text.slice(0, 1000);
  const wm = '\n\n' + watermarkText(settings);
  return text.slice(0, 1000 - wm.length) + wm;
}

// Bulan berjalan di zona Asia/Jakarta, "YYYY-MM"
function monthKey(d) {
  return new Date((d ? new Date(d).getTime() : Date.now()) + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

// Baris terakhir per akun menang (tabel tanpa unique key)
function latestBy(rows, key) {
  const m = {};
  for (const r of rows) {
    if (!r || !r[key]) continue;
    const k = String(r[key]);
    if (!m[k] || Number(r.id) > Number(m[k].id)) m[k] = r;
  }
  return m;
}

// Paket yang berlaku sekarang untuk satu baris billing
function effectivePlan(billing, plans) {
  const free = plans.find(p => p.id === 'free') || DEFAULT_PLANS[0];
  if (!billing || !billing.plan || billing.plan === 'free') return free;
  const plan = plans.find(p => p.id === billing.plan);
  if (!plan) return free;
  const end = billing.period_end ? new Date(billing.period_end).getTime() : 0;
  if (!end || end + GRACE_MS < Date.now()) return free;
  return plan;
}

const isTrue = (v) => v === true || v === 'true';
// ---- akhir lib_plans.js ----

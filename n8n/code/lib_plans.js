// ---- lib_plans.js (disisipkan build.py lewat //#include) ----
// Paket langganan. Sumber kebenaran: setting "plans" (JSON, diubah dari dasbor superadmin); ini nilai bawaan.
// dm = DM otomatis / bulan, ai = balasan AI / bulan (0 = tanpa AI), rules = jumlah automasi (0 = tanpa batas)
const DEFAULT_PLANS = [
  { id: 'free', name: 'Gratis', price: 0, dm: 100, ai: 0, rules: 3, followup: false, persona: false },
  { id: 'kreator', name: 'Kreator', price: 49000, dm: 1000, ai: 300, rules: 0, followup: true, persona: false },
  { id: 'pro', name: 'Pro', price: 99000, dm: 5000, ai: 2000, rules: 0, followup: true, persona: true },
  { id: 'bisnis', name: 'Bisnis', price: 249000, dm: 20000, ai: 10000, rules: 0, followup: true, persona: true },
];
const GRACE_MS = 3 * 24 * 3600 * 1000; // tenggang setelah masa aktif habis sebelum turun ke Gratis

function loadPlans(settings) {
  try {
    const p = JSON.parse(settings.plans || '');
    if (Array.isArray(p) && p.some(x => x && x.id === 'free')) return p;
  } catch (e) { /* pakai bawaan */ }
  return DEFAULT_PLANS;
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

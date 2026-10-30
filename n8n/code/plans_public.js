// Daftar paket untuk halaman landing (di-cache CDN Vercel, jadi jarang memicu eksekusi)
//#include lib_plans.js
const settings = {};
for (const it of $('Baca Settings Paket').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const plans = loadPlans(settings).map(x => ({
  id: x.id, name: x.name, price: Number(x.price) || 0, dm: Number(x.dm) || 0, ai: Number(x.ai) || 0,
  rules: Number(x.rules) || 0, followup: !!x.followup, persona: !!x.persona,
}));
return [{ json: { ok: true, plans, signup_open: settings.signup_open !== 'false' } }];

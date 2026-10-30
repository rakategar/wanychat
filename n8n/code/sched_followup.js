// Kirim follow-up yang sudah jatuh tempo. Instagram hanya mengizinkan pesan biasa
// jika user mengirim pesan / menekan tombol dalam 24 jam terakhir.
//#include lib_plans.js
const helpers = this.helpers;
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const contacts = {};
for (const it of $('Baca Kontak').all()) if (it.json.ig_user_id) contacts[it.json.account_id + ':' + it.json.ig_user_id] = it.json;
const accounts = {};
for (const it of $('Baca Akun').all()) if (it.json.ig_user_id) accounts[String(it.json.ig_user_id)] = it.json;
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');
const plans = loadPlans(settings);
const month = monthKey();
const billingBy = latestBy($('Baca Billing').all().map(i => i.json), 'account_id');
const usageBy = latestBy($('Baca Usage').all().map(i => i.json).filter(u => u.month === month), 'account_id');
const usage = {};
const useOf = (id) => {
  if (!usage[id]) {
    const r = usageBy[id] || {};
    usage[id] = { dm: Number(r.dm) || 0, ai: Number(r.ai) || 0, ai_tokens: Number(r.ai_tokens) || 0, comments: Number(r.comments) || 0, changed: false };
  }
  return usage[id];
};
const now = Date.now();
const DAY = 24 * 3600 * 1000;
const out = [];

for (const item of $('Baca Follow Up Pending').all()) {
  const f = item.json;
  if (!f.id || f.status !== 'pending') continue;
  const due = new Date(f.due_at).getTime();
  if (!(due <= now)) continue;

  const c = contacts[f.account_id + ':' + f.ig_user_id];
  const acc = accounts[String(f.account_id)];
  const lastMsg = c && c.last_user_msg_at ? new Date(c.last_user_msg_at).getTime() : 0;
  const windowOpen = lastMsg && now - lastMsg < DAY - 5 * 60000;

  if (!acc || !acc.access_token) {
    out.push({ json: { kind: 'update', id: f.id, status: 'error', sent_at: null, error: 'akun tidak terhubung' } });
    continue;
  }
  if (settings.engine_enabled === 'false') continue;
  const bill = billingBy[String(f.account_id)];
  const plan = effectivePlan(bill, plans);
  const u = useOf(String(f.account_id));
  if ((bill && isTrue(bill.suspended)) || !plan.followup || u.dm >= Number(plan.dm || 0)) {
    out.push({ json: { kind: 'update', id: f.id, status: 'expired', sent_at: null, error: bill && isTrue(bill.suspended) ? 'akun dinonaktifkan' : !plan.followup ? 'follow-up tidak termasuk paket ' + plan.name : 'kuota DM bulan ini habis' } });
    continue;
  }
  if (!windowOpen) {
    // Tunggu user berinteraksi; kalau 24 jam lewat jatuh tempo, anggap kedaluwarsa
    if (now - due > DAY) {
      out.push({ json: { kind: 'update', id: f.id, status: 'expired', sent_at: null, error: 'user tidak membuka percakapan (jendela 24 jam tertutup)' } });
    }
    continue;
  }

  let ok = false;
  let error = '';
  try {
    const res = await helpers.httpRequest({
      method: 'POST', url: G + '/' + acc.ig_user_id + '/messages',
      qs: { access_token: acc.access_token },
      body: { recipient: { id: f.ig_user_id }, message: { text: f.message } },
      json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
    });
    const b = res.body || {};
    ok = res.statusCode < 400 && !b.error;
    if (!ok) error = (b.error && b.error.message) || ('HTTP ' + res.statusCode);
  } catch (err) {
    error = err.message;
  }
  if (ok) { u.dm++; u.changed = true; }
  out.push({ json: { kind: 'update', id: f.id, status: ok ? 'sent' : 'error', sent_at: ok ? new Date().toISOString() : null, error } });
  out.push({ json: {
    kind: 'log', account_id: String(f.account_id || ''), type: 'followup', status: ok ? 'ok' : 'error', rule_id: String(f.rule_id || ''), rule_name: '',
    ig_user_id: f.ig_user_id, username: f.username || '', ref_id: String(f.id), media_id: '', text: f.message, error,
  } });
}
for (const [id, x] of Object.entries(usage)) {
  if (x.changed) out.push({ json: { kind: 'usage', account_id: id, month, dm: x.dm, ai: x.ai, ai_tokens: x.ai_tokens, comments: x.comments } });
}
return out;

// Notifikasi pembayaran DOKU Checkout.
// Yang dipercaya hanya status hasil GET /orders/v1/status (request kita sendiri yang ditandatangani) + nominal yang kita simpan
// saat checkout; tanda tangan notifikasi tetap dicek dan dicatat kalau tidak cocok.
//#include lib_plans.js
const helpers = this.helpers;
const n = $('Ambil Body Mentah').first().json;
const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
//#include lib_doku.js

const out = [];
const audit = (action, target, detail) => out.push({ json: { kind: 'audit', actor: 'doku', action, target: String(target || ''), detail: String(detail || '').slice(0, 1000), ip: '' } });

if (!DOKU_READY || !n.invoice) return [];

const given = n.signature;
const expected = n.raw ? dokuSignature(n.client_id, n.request_id, n.timestamp, DOKU_NOTIFY_PATH, n.raw) : '';
const sigOk = !!given && given.length === expected.length && dokuCrypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  && n.client_id === String(settings.doku_client_id);

const known = $('Baca Pembayaran').all().map(i => i.json).find(x => x.order_id === n.invoice);
if (!known) {
  audit(sigOk ? 'doku_unmatched' : 'doku_bad_signature', n.invoice, 'order tidak dikenal, diabaikan');
  return out;
}
if (!sigOk) audit('doku_bad_signature', n.invoice, 'tanda tangan notifikasi tidak cocok; status tetap dicek langsung ke API DOKU');

const r = await dokuStatus(n.invoice);
if (!r.ok) { audit('doku_status_error', n.invoice, r.status + ' ' + r.error); return out; }

const plans = loadPlans(settings);
const cur = latestBy($('Baca Billing').all().map(i => i.json), 'account_id')[String(known.account_id)];
const credit = latestBy($('Baca Kredit').all().map(i => i.json), 'account_id')[String(known.account_id)];
const res = applyDokuStatus(r.body, known, cur, plans, credit);
out.push({ json: { kind: 'payment', payment: res.payment } });
if (res.billing) out.push({ json: { kind: 'billing', billing: res.billing } });
if (res.credits) out.push({ json: { kind: 'credits', credits: res.credits } });
for (const a of res.audits) audit(...a);
return out;

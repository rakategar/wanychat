// ---- lib_pay.js (disisipkan build.py lewat //#include, selalu bersama lib_doku.js & lib_midtrans.js) ----
// Bagian umum gateway pembayaran. Setting payment_provider (doku | midtrans) memilih gateway untuk checkout BARU;
// order lama selalu dicek ke gateway asalnya (kolom gateway di wany_payments, kosong = doku).
const PAY_GATEWAY = settings.payment_provider === 'midtrans' ? 'midtrans' : 'doku';
const PAY_NAMES = { doku: 'DOKU', midtrans: 'Midtrans' };
const gatewayOf = (known) => (known && known.gateway === 'midtrans' ? 'midtrans' : 'doku');
const gatewayReady = (g) => (g === 'midtrans' ? MT_READY : DOKU_READY);
const payReady = () => gatewayReady(PAY_GATEWAY);
const payMethods = () => (PAY_GATEWAY === 'midtrans' ? mtMethods() : dokuMethods());
const payLabel = (id) => MT_LABELS[id] || DOKU_LABELS[id] || id;
const payCharge = (price, method) => (PAY_GATEWAY === 'midtrans' ? mtCharge(price, method) : dokuCharge(price, method));
const payFeeOf = (g, amount, method) => (g === 'midtrans' ? mtFeeOf(amount, method) : dokuFeeOf(amount, method));

// Fee gateway (+ PPN) atas nominal yang dibayar pelanggan
const feeWith = (amount, [pct, flat], vat) => Math.ceil((Number(amount || 0) * pct / 100 + flat) * vat);

// Total yang ditagih supaya yang diterima bersih = harga (fee + PPN-nya ditanggung pelanggan), dibulatkan ke atas per `step`
function chargeWith(price, rate, vat, step, toCustomer) {
  price = Math.round(Number(price) || 0);
  if (!toCustomer) return { total: price, surcharge: 0, fee: feeWith(price, rate, vat) };
  const [pct, flat] = rate;
  step = Math.max(1, step);
  let total = Math.ceil((price + flat * vat) / (1 - pct / 100 * vat));
  total = Math.ceil(total / step) * step;
  while (total - feeWith(total, rate, vat) < price) total += step;
  return { total, surcharge: total - price, fee: feeWith(total, rate, vat) };
}

// Buat halaman bayar di gateway aktif; hasil { ok, url, session, error }
async function payCheckout(o) {
  if (PAY_GATEWAY === 'midtrans') {
    const r = await mtCheckout(o);
    return { ok: r.ok, url: r.url, session: r.token, error: r.error };
  }
  const r = await doku('POST', '/checkout/v1/payment', {
    order: {
      amount: o.total, invoice_number: o.orderId, currency: 'IDR', line_items: o.items, auto_redirect: true,
      callback_url: o.base + '/#/billing?paid=1', callback_url_result: o.base + '/#/billing?paid=1', language: 'ID',
    },
    payment: { payment_due_date: 120, payment_method_types: [o.method] },
    customer: { id: o.customerId, name: o.customerName },
    additional_info: { override_notification_url: o.base + DOKU_NOTIFY_PATH },
  });
  const res = r.body && r.body.response;
  const url = res && res.payment && res.payment.url;
  return { ok: r.ok && !!url, url: url || '', session: String((res && res.order && res.order.session_id) || ''), error: r.error || 'tanpa URL pembayaran' };
}

// Tanya status order ke gateway asalnya; hasil { ok, notFound, error, norm }
async function payStatus(known) {
  if (gatewayOf(known) === 'midtrans') {
    const r = await mtStatus(known.order_id);
    return { ok: r.ok, notFound: r.status === 404, error: r.status + ' ' + r.error, norm: r.ok ? mtNormalize(r.body) : null };
  }
  const r = await dokuStatus(known.order_id);
  return { ok: r.ok, notFound: r.status === 404, error: r.status + ' ' + r.error, norm: r.ok ? dokuNormalize(r.body) : null };
}

// Tambah 1 bulan kalender (31 Jan -> 28/29 Feb)
function addMonth(ms) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

function billingRow(b, accountId) {
  return {
    account_id: String(accountId), plan: (b && b.plan) || 'free', status: (b && b.status) || 'free', period_end: (b && b.period_end) || null,
    subscription_id: (b && b.subscription_id) || '', subscription_name: (b && b.subscription_name) || '',
    cancel_at_period_end: !!(b && isTrue(b.cancel_at_period_end)), suspended: !!(b && isTrue(b.suspended)),
    source: (b && b.source) || '', card_hint: (b && b.card_hint) || '', last_order_id: (b && b.last_order_id) || '', note: (b && b.note) || '',
  };
}

// Terapkan status gateway (sudah dinormalisasi: {status, amount, channel, txid, paidAt}) ke satu order yang kita buat sendiri
// (`known`, baris wany_payments). Hasil: { payment, billing?, credits?, audits[] }. Hanya status dari API gateway + nominal
// yang kita simpan yang dipercaya. `credit` = baris wany_credits grup (untuk top-up kredit AI; hanya kolom granted yang ditulis).
function applyPayment(nm, known, cur, plans, credit) {
  const g = gatewayOf(known);
  const audits = [];
  const accountId = String(known.account_id);
  const wasPaid = ['settlement', 'capture'].includes(known.status);
  let status = nm.status;
  if (wasPaid && status !== 'refund') status = known.status; // lunas tidak pernah mundur ke pending/expire
  const amount = nm.amount;
  const expect = Math.round(Number(known.amount) || 0);
  const channel = nm.channel || known.payment_type || '';
  const pay = Object.assign({}, known, { status, payment_type: channel, transaction_id: nm.txid || known.transaction_id || '', gateway: g });
  delete pay.id; delete pay.createdAt; delete pay.updatedAt;
  if (status === 'settlement') {
    pay.paid_at = known.paid_at || nm.paidAt || new Date().toISOString();
    pay.fee = payFeeOf(g, amount, known.payment_type || channel);
  }
  if (status === 'settlement' && amount !== expect) {
    pay.status = 'amount_mismatch';
    pay.note = 'nominal ' + amount + ' != ' + expect;
    audits.push([g + '_amount_mismatch', known.order_id, pay.note]);
    return { payment: pay, audits };
  }
  if (known.kind === 'topup') {
    const n = Math.round(Number(known.credits) || 0);
    if (status === 'settlement' && !wasPaid && n > 0) {
      const granted = (Number(credit && credit.granted) || 0) + n;
      audits.push(['topup_paid', accountId, n + ' kredit AI ' + amount + ' ' + channel + ' ' + known.order_id]);
      return { payment: pay, credits: { account_id: accountId, granted }, audits };
    }
    if (status === 'refund' && known.status !== 'refund') audits.push(['payment_refund', accountId, known.order_id + ' top-up (kurangi kredit manual)']);
    return { payment: pay, audits };
  }
  const plan = plans.find(x => x.id === known.plan);
  if (status === 'settlement' && !wasPaid && plan) {
    const b = billingRow(cur, accountId);
    const now = Date.now();
    const curEnd = cur && cur.period_end ? new Date(cur.period_end).getTime() : 0;
    // Perpanjangan paket sama: lanjut dari akhir periode. Ganti paket: mulai hari ini.
    const from = (cur && cur.plan === plan.id && curEnd > now) ? curEnd : now;
    Object.assign(b, {
      plan: plan.id, status: 'active', period_end: new Date(addMonth(from)).toISOString(), source: g, last_order_id: known.order_id,
      subscription_id: '', subscription_name: '', cancel_at_period_end: false, card_hint: '',
    });
    audits.push(['payment_paid', accountId, plan.id + ' ' + amount + ' ' + channel + ' ' + known.order_id]);
    return { payment: pay, billing: b, audits };
  }
  if (status === 'refund' && known.status !== 'refund') {
    audits.push(['payment_refund', accountId, known.order_id + ' (cek manual di dasbor superadmin)']);
  }
  return { payment: pay, audits };
}
// ---- akhir lib_pay.js ----

import { useCallback, useEffect, useState } from 'react'
import { api, type Billing, type Payment } from '../api'
import { planFeatures, rupiah, rupiahShort, fmt, type Plan } from '../plans'
import { Confirm, Spinner, useToast } from '../components/ui'

const STATUS: Record<string, { label: string; color: string }> = {
  settlement: { label: 'lunas', color: 'green' },
  capture: { label: 'lunas', color: 'green' },
  pending: { label: 'menunggu', color: 'yellow' },
  expire: { label: 'kedaluwarsa', color: '' },
  cancel: { label: 'batal', color: '' },
  deny: { label: 'ditolak', color: 'red' },
  failure: { label: 'gagal', color: 'red' },
  refund: { label: 'refund', color: 'purple' },
}
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-')

export default function BillingPage({ billing: initial, reload }: { billing: Billing | null; reload: () => Promise<unknown> }) {
  const toast = useToast()
  const [billing, setBilling] = useState<Billing | null>(initial)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [choose, setChoose] = useState<Plan | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(() => window.location.hash.includes('paid=1'))

  const load = useCallback(async () => {
    const [b, p] = await Promise.all([
      api<{ billing: Billing; plans: Plan[]; payments_enabled: boolean }>('billing.get'),
      api<{ payments: Payment[] }>('billing.payments'),
    ])
    setBilling(b.billing)
    setPlans(b.plans)
    setEnabled(b.payments_enabled)
    setPayments(p.payments)
    return { billing: b.billing, payments: p.payments }
  }, [])

  useEffect(() => { load().catch((e) => toast(e.message, 'error')) }, [load, toast])

  // Kembali dari halaman Midtrans: tunggu notifikasi pembayaran diproses (maks ±1 menit)
  useEffect(() => {
    if (!waiting) return
    let n = 0
    const t = setInterval(async () => {
      n++
      try {
        const r = await load()
        const last = r.payments[0]
        if (last && ['settlement', 'capture'].includes(last.status)) {
          clearInterval(t); setWaiting(false); reload(); toast('Pembayaran berhasil, paket aktif 🎉')
          window.history.replaceState(null, '', '#/billing')
        }
      } catch { /* coba lagi */ }
      if (n >= 12) { clearInterval(t); setWaiting(false); window.history.replaceState(null, '', '#/billing') }
    }, 5000)
    return () => clearInterval(t)
  }, [waiting, load, reload, toast])

  const checkout = async (plan: Plan) => {
    setBusy(true)
    try {
      const r = await api<{ redirect_url: string }>('billing.checkout', { plan: plan.id })
      window.location.href = r.redirect_url
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(false)
      setChoose(null)
    }
  }

  const cancel = async () => {
    setCanceling(false)
    try {
      await api('billing.cancel')
      toast('Perpanjangan otomatis dihentikan')
      await load(); reload()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  if (!billing) return <Spinner />
  const plan = billing.plan
  const paid = plan.id !== 'free'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Langganan</h1>
          <p>Paket kamu, pemakaian bulan ini, dan riwayat pembayaran.</p>
        </div>
      </div>

      {waiting && <div className="callout yellow" style={{ marginBottom: 20 }}><Spinner /> &nbsp;Menunggu konfirmasi pembayaran dari Midtrans…</div>}

      <div className="grid two">
        <section className={'card stack ' + (paid ? 'tint-yellow' : '')}>
          <div className="row between">
            <div>
              <div className="small muted" style={{ color: 'inherit' }}>Paket sekarang</div>
              <div className="plan-now">{plan.name}</div>
            </div>
            <div className="plan-price">{rupiahShort(plan.price)}<span>/bulan</span></div>
          </div>
          <div className="small">
            {!paid && 'Paket gratis selamanya. Upgrade kapan saja untuk kuota lebih besar, follow-up, dan AI.'}
            {paid && billing.auto_renew && <>Diperpanjang otomatis pada <b>{date(billing.period_end)}</b>{billing.card_hint && <> dengan kartu <b>{billing.card_hint}</b></>}.</>}
            {paid && !billing.auto_renew && billing.cancel_at_period_end && <>Perpanjangan dihentikan. Paket aktif sampai <b>{date(billing.period_end)}</b>, lalu kembali ke Gratis.</>}
            {paid && !billing.auto_renew && !billing.cancel_at_period_end && <>Aktif sampai <b>{date(billing.period_end)}</b>.{billing.source !== 'manual' && ' Tanpa perpanjangan otomatis: bayar lagi sebelum tanggal itu.'}</>}
            {billing.status === 'past_due' && <div className="callout pink" style={{ marginTop: 10 }}>Tagihan bulan ini gagal. Perbarui pembayaran supaya paket tidak turun ke Gratis.</div>}
          </div>
          {billing.auto_renew && (
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCanceling(true)}>Hentikan perpanjangan otomatis</button>
          )}
        </section>

        <section className="card stack">
          <h2 className="card-title">Pemakaian {new Date(billing.month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</h2>
          <Meter label="DM otomatis" used={billing.usage.dm} limit={plan.dm} />
          <Meter label="Balasan AI" used={billing.usage.ai} limit={plan.ai} none="Tidak termasuk paket" />
          <Meter label="Automasi" used={billing.rules_used} limit={plan.rules} unlimited="Tanpa batas" />
          <p className="hint">Kuota direset setiap tanggal 1. Balasan komentar publik tidak dihitung.</p>
        </section>
      </div>

      <h2 className="section-title">Pilih paket</h2>
      {!enabled && <div className="callout" style={{ marginBottom: 16 }}>Pembayaran online sedang disiapkan. Hubungi admin Wanychat untuk upgrade.</div>}
      {!plans ? <Spinner /> : (
        <div className="grid lp-plans">
          {plans.map((p) => {
            const current = p.id === plan.id
            return (
              <article key={p.id} className={'card plan' + (current ? ' current' : '')}>
                {current && <span className="badge dark plan-tag">Paket kamu</span>}
                <h3>{p.name}</h3>
                <div className="plan-price">{rupiahShort(p.price)}<span>{p.price ? '/bulan' : ''}</span></div>
                <ul className="plan-list">{planFeatures(p).map((f) => <li key={f}>{f}</li>)}</ul>
                {p.price > 0 && (
                  <button className={'btn ' + (current ? '' : 'dark')} style={{ marginTop: 'auto' }}
                    disabled={!enabled || busy || (current && billing.auto_renew)} onClick={() => setChoose(p)}>
                    {current ? (billing.auto_renew ? 'Aktif' : 'Perpanjang') : plan.price > p.price ? 'Turun ke ' + p.name : 'Upgrade ke ' + p.name}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        Pembayaran diproses Midtrans. Centang “Simpan kartu” di halaman pembayaran supaya diperpanjang otomatis tiap bulan.
        Ganti paket berlaku langsung tanpa prorata.
      </p>

      <section className="card" style={{ marginTop: 28 }}>
        <h2 className="card-title">Riwayat pembayaran</h2>
        {!payments ? <Spinner /> : payments.length === 0 ? <p className="muted" style={{ margin: 0 }}>Belum ada pembayaran.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tanggal</th><th>Paket</th><th>Jumlah</th><th>Status</th><th>Order</th></tr></thead>
              <tbody>
                {payments.map((x) => {
                  const st = STATUS[x.status] || { label: x.status, color: '' }
                  return (
                    <tr key={x.order_id}>
                      <td>{date(x.paid_at || x.createdAt)}</td>
                      <td>{plans?.find((p) => p.id === x.plan)?.name || x.plan}{x.kind === 'renewal' && <span className="muted"> · otomatis</span>}</td>
                      <td>{rupiah(x.amount)}</td>
                      <td><span className={'badge ' + st.color}>{st.label}</span></td>
                      <td className="mono">{x.order_id}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {choose && (
        <Confirm
          title={`Langganan ${choose.name}`}
          tone="primary"
          body={<>
            <p style={{ marginTop: 0 }}>Bayar <b>{rupiah(choose.price)}</b> sekarang untuk 1 bulan. Dengan kartu kredit/debit yang disimpan,
              paket diperpanjang otomatis <b>{rupiah(choose.price)} setiap bulan</b> sampai kamu menghentikannya.</p>
            <p style={{ marginBottom: 0 }}>Kamu akan diarahkan ke halaman pembayaran aman Midtrans.</p>
          </>}
          confirmLabel={busy ? 'Membuka…' : 'Lanjut bayar'}
          onConfirm={() => checkout(choose)}
          onCancel={() => !busy && setChoose(null)}
        />
      )}
      {canceling && (
        <Confirm
          title="Hentikan perpanjangan otomatis?"
          body={<>Paket {plan.name} tetap aktif sampai {date(billing.period_end)}, lalu turun ke Gratis. Kamu bisa berlangganan lagi kapan saja.</>}
          confirmLabel="Hentikan"
          onConfirm={cancel}
          onCancel={() => setCanceling(false)}
        />
      )}
    </>
  )
}

export function Meter({ label, used, limit, none, unlimited }: { label: string; used: number; limit: number; none?: string; unlimited?: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const tone = pct >= 100 ? 'red' : pct >= 80 ? 'orange' : 'green'
  return (
    <div className="meter">
      <div className="row between small">
        <b>{label}</b>
        <span>{limit > 0 ? `${fmt(used)} / ${fmt(limit)}` : limit === 0 && unlimited ? `${fmt(used)} · ${unlimited}` : none}</span>
      </div>
      {limit > 0 && <div className="meter-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span className={tone} style={{ width: pct + '%' }} /></div>}
    </div>
  )
}

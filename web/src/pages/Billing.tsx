import { useCallback, useEffect, useState } from 'react'
import { api, type Billing, type Payment } from '../api'
import { planFeatures, rupiah, rupiahShort, fmt, type Plan, type Topup } from '../plans'
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
  amount_mismatch: { label: 'perlu dicek', color: 'red' },
}
type Method = { id: string; label: string; totals: Record<string, number> }
// Yang sedang dibayar: paket langganan atau top-up kredit AI
type Item = { kind: 'plan' | 'topup'; id: string; name: string; price: number }
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-')

export default function BillingPage({ billing: initial, reload }: { billing: Billing | null; reload: () => Promise<unknown> }) {
  const toast = useToast()
  const [billing, setBilling] = useState<Billing | null>(initial)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [methods, setMethods] = useState<Method[]>([])
  const [topups, setTopups] = useState<Topup[]>([])
  const [choose, setChoose] = useState<Item | null>(null)
  const [method, setMethod] = useState('')
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(() => window.location.hash.includes('paid=1'))

  const load = useCallback(async () => {
    const [b, p] = await Promise.all([
      api<{ billing: Billing; plans: Plan[]; topups: Topup[]; payments_enabled: boolean; methods: Method[] }>('billing.get'),
      api<{ payments: Payment[] }>('billing.payments'),
    ])
    setBilling(b.billing)
    setPlans(b.plans)
    setTopups(b.topups || [])
    setEnabled(b.payments_enabled && b.methods.length > 0)
    setMethods(b.methods)
    setPayments(p.payments)
    return { billing: b.billing, payments: p.payments }
  }, [])

  useEffect(() => { load().catch((e) => toast(e.message, 'error')) }, [load, toast])

  // Kembali dari halaman DOKU: tunggu notifikasi pembayaran diproses (maks ±1 menit)
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
      if (n >= 24) { clearInterval(t); setWaiting(false); window.history.replaceState(null, '', '#/billing') }
    }, 5000)
    return () => clearInterval(t)
  }, [waiting, load, reload, toast])

  const checkout = async (item: Item, method: string) => {
    setBusy(true)
    try {
      const r = await api<{ redirect_url: string }>('billing.checkout', item.kind === 'topup' ? { topup: item.id, method } : { plan: item.id, method })
      window.location.href = r.redirect_url
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(false)
      setChoose(null)
    }
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

      {waiting && <div className="callout yellow" style={{ marginBottom: 20 }}><Spinner /> &nbsp;Menunggu konfirmasi pembayaran dari DOKU… (pembayaran VA/minimarket bisa dibayar nanti; paket aktif otomatis begitu lunas)</div>}

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
            {paid && <>Aktif sampai <b>{date(billing.period_end)}</b>.{billing.source !== 'manual' && ' Bayar lagi sebelum tanggal itu untuk memperpanjang 1 bulan (sisa masa aktif tidak hilang).'}</>}
            {billing.accounts_limit > 1 && <div style={{ marginTop: 6 }}>{billing.accounts_used} dari {billing.accounts_limit} akun Instagram terpakai. <a href="#/settings">Kelola akun</a></div>}
            {!billing.is_owner && billing.owner_username && <div style={{ marginTop: 6 }}>Langganan grup milik <b>@{billing.owner_username}</b>. Pembayaran dari akun ini memperpanjang paket grup.</div>}
            {billing.status === 'past_due' && <div className="callout pink" style={{ marginTop: 10 }}>Tagihan bulan ini gagal. Perbarui pembayaran supaya paket tidak turun ke Gratis.</div>}
          </div>
        </section>

        <section className="card stack">
          <h2 className="card-title">Pemakaian {new Date(billing.month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</h2>
          <Meter label="DM otomatis" used={billing.usage.dm} limit={plan.dm} />
          <Meter label="Balasan AI" used={billing.usage.ai} limit={plan.ai} none={billing.credits > 0 ? 'Memakai kredit top-up' : 'Tidak termasuk paket'} />
          {billing.credits > 0 && <div className="small"><b>+ {fmt(billing.credits)} kredit AI</b> dipakai setelah kuota bulanan habis.</div>}
          <Meter label="Automasi" used={billing.rules_used} limit={plan.rules} unlimited="Tanpa batas" />
          <p className="hint">Kuota direset setiap tanggal 1{billing.accounts_limit > 1 ? ' dan dipakai bersama semua akun di langganan ini' : ''}. Balasan komentar publik tidak dihitung.</p>
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
                    disabled={!enabled || busy} onClick={() => { setChoose({ kind: 'plan', id: p.id, name: 'Langganan ' + p.name, price: p.price }); setMethod(methods[0]?.id || '') }}>
                    {current ? 'Perpanjang' : plan.price > p.price ? 'Turun ke ' + p.name : 'Upgrade ke ' + p.name}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        Pembayaran diproses DOKU (Virtual Account, minimarket, e-wallet). Tiap pembayaran = 1 bulan, tanpa tagihan otomatis.
        Biaya layanan metode bayar ditambahkan ke total. Ganti paket berlaku langsung tanpa prorata.
      </p>

      {topups.length > 0 && (
        <section className="card stack tint-green" style={{ marginTop: 28 }}>
          <div className="row between">
            <div>
              <h2 className="card-title" style={{ margin: 0 }}>Top-up kredit balasan AI</h2>
              <p className="small" style={{ margin: '4px 0 0' }}>Kredit tidak hangus dan dipakai otomatis setelah kuota AI bulanan habis.{plan.ai === 0 && ' Di paket Gratis, kredit membuka fitur Balasan AI.'}</p>
            </div>
            <div className="plan-price">{fmt(billing.credits)}<span> kredit</span></div>
          </div>
          <div className="topups">
            {topups.map((t) => (
              <button key={t.id} className="card plan topup" disabled={!enabled || busy}
                onClick={() => { setChoose({ kind: 'topup', id: t.id, name: fmt(t.credits) + ' kredit AI', price: t.price }); setMethod(methods[0]?.id || '') }}>
                <b style={{ fontSize: 22 }}>{fmt(t.credits)} kredit</b>
                <span>{rupiah(t.price)}</span>
                <span className="small muted">{rupiah(t.price / t.credits)} / balasan</span>
              </button>
            ))}
          </div>
        </section>
      )}

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
                      <td>{x.kind === 'topup' ? `${fmt(x.credits || 0)} kredit AI` : plans?.find((p) => p.id === x.plan)?.name || x.plan}</td>
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
          title={choose.name}
          tone="primary"
          body={<>
            <p style={{ marginTop: 0 }}>{choose.kind === 'plan' ? <>{choose.name} <b>{rupiah(choose.price)}</b> untuk 1 bulan.</> : <>{choose.name} <b>{rupiah(choose.price)}</b>, tidak hangus.</>} Pilih cara bayar:</p>
            <div className="pay-methods" role="radiogroup">
              {methods.map((m) => (
                <label key={m.id} className={'pay-method' + (m.id === method ? ' on' : '')}>
                  <input type="radio" name="pay-method" checked={m.id === method} onChange={() => setMethod(m.id)} />
                  <span>{m.label}</span>
                  <b>{rupiah(m.totals[choose.id] ?? choose.price)}</b>
                </label>
              ))}
            </div>
            <p className="small" style={{ marginBottom: 0 }}>Total sudah termasuk biaya layanan pembayaran
              {method && <> (<b>{rupiah((methods.find((m) => m.id === method)?.totals[choose.id] ?? choose.price) - choose.price)}</b>)</>}.
              Kamu akan diarahkan ke halaman pembayaran aman DOKU.</p>
          </>}
          confirmLabel={busy ? 'Membuka…' : method ? 'Bayar ' + rupiah(methods.find((m) => m.id === method)?.totals[choose.id] ?? choose.price) : 'Pilih metode'}
          onConfirm={() => method && !busy && checkout(choose, method)}
          onCancel={() => !busy && setChoose(null)}
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

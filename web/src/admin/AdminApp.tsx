import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, saApi } from '../api'
import { Brand, Confirm, Field, Spinner, Switch, timeAgo, useToast } from '../components/ui'
import { fmt, rupiah, type Plan } from '../plans'
import type { AuditRow, Overview, PaymentRow, SettingsView, UserRow } from './types'

type Tab = 'overview' | 'users' | 'payments' | 'plans' | 'settings' | 'security'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Ringkasan', icon: '📊' },
  { id: 'users', label: 'Pengguna', icon: '👥' },
  { id: 'payments', label: 'Pembayaran', icon: '💳' },
  { id: 'plans', label: 'Paket', icon: '🏷️' },
  { id: 'settings', label: 'Teknis', icon: '⚙️' },
  { id: 'security', label: 'Keamanan', icon: '🛡️' },
]
const IDLE_MS = 30 * 60 * 1000 // keluar otomatis setelah 30 menit tanpa aktivitas
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const monthName = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })

export default function AdminApp() {
  const toast = useToast()
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking')
  const [user, setUser] = useState('')
  const [tab, setTab] = useState<Tab>(() => {
    const t = window.location.hash.split('/')[2] as Tab
    return TABS.some((x) => x.id === t) ? t : 'overview'
  })

  useEffect(() => {
    const f = () => {
      const t = window.location.hash.split('/')[2] as Tab
      if (TABS.some((x) => x.id === t)) setTab(t)
    }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  useEffect(() => {
    document.title = 'Superadmin · Wanychat'
    saApi<{ user: string }>('sa.me').then((r) => { setUser(r.user); setState('in') }).catch(() => setState('out'))
    return () => { document.title = 'Wanychat · Auto-DM Instagram' }
  }, [])

  const logout = useCallback(async (why?: string) => {
    try { await saApi('sa.logout') } catch { /* sesi sudah habis */ }
    setState('out')
    if (why) toast(why, 'error')
  }, [toast])

  useEffect(() => {
    if (state !== 'in') return
    let last = Date.now()
    const bump = () => { last = Date.now() }
    const ev = ['pointerdown', 'keydown', 'scroll']
    ev.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const t = setInterval(() => { if (Date.now() - last > IDLE_MS) logout('Keluar otomatis karena tidak aktif 30 menit') }, 30000)
    return () => { clearInterval(t); ev.forEach((e) => window.removeEventListener(e, bump)) }
  }, [state, logout])

  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, '', '#/admin/' + t); window.scrollTo(0, 0) }
  // Sesi habis di tengah jalan -> kembali ke form login
  const guard = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setState('out'); toast(e.message, 'error') } else toast((e as Error).message, 'error')
  }, [toast])

  if (state === 'checking') return <div className="login"><Spinner /></div>
  if (state === 'out') return <Login onIn={(u) => { setUser(u); setState('in') }} />

  return (
    <div className="shell admin">
      <aside className="sidebar">
        <div><Brand /><span className="badge dark" style={{ marginTop: 10 }}>Superadmin</span></div>
        <nav className="nav">
          {TABS.map((n) => (
            <button key={n.id} className={'nav-item' + (tab === n.id ? ' active' : '')} onClick={() => go(n.id)}>
              <span aria-hidden>{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="small">Masuk sebagai <b>{user}</b></div>
          <button className="btn sm" onClick={() => logout()}>Keluar</button>
        </div>
      </aside>

      <header className="mobile-bar">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Brand size={17} /><span className="badge dark">SA</span></div>
        <button className="btn sm" onClick={() => logout()}>Keluar</button>
      </header>

      <main className="main">
        <nav className="admin-tabs" aria-label="Menu superadmin">
          {TABS.map((n) => (
            <button key={n.id} className={'chip' + (tab === n.id ? ' on' : '')} onClick={() => go(n.id)}>{n.icon} {n.label}</button>
          ))}
        </nav>
        {tab === 'overview' && <OverviewTab guard={guard} go={go} />}
        {tab === 'users' && <UsersTab guard={guard} />}
        {tab === 'payments' && <PaymentsTab guard={guard} />}
        {tab === 'plans' && <PlansTab guard={guard} />}
        {tab === 'settings' && <SettingsTab guard={guard} />}
        {tab === 'security' && <SecurityTab guard={guard} />}
      </main>
    </div>
  )
}

type Guard = (e: unknown) => void

function useLoad<T>(action: string, guard: Guard) {
  const [data, setData] = useState<T | null>(null)
  const load = useCallback(() => saApi<T>(action).then(setData).catch(guard), [action, guard])
  useEffect(() => { load() }, [load])
  return { data, load }
}

// ---------------------------------------------------------------- Login
function Login({ onIn }: { onIn: (u: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await saApi<{ user: string }>('sa.login', { username, password, code: needCode ? code : undefined })
      onIn(r.user)
    } catch (err) {
      const ex = err as ApiError
      if (ex.data?.need_totp) setNeedCode(true)
      setError(ex.message)
      setCode('')
    } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit} autoComplete="on">
        <div className="row between"><Brand /><span className="badge dark">Superadmin</span></div>
        <p className="muted" style={{ margin: 0 }}>Area terbatas. Semua percobaan masuk dicatat.</p>
        {error && <div className="callout pink" role="alert">{error}</div>}
        <Field label="Username" htmlFor="sa-u">
          <input id="sa-u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" htmlFor="sa-p">
          <input id="sa-p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {needCode && (
          <Field label="Kode 2FA" htmlFor="sa-c" hint="6 digit dari aplikasi authenticator.">
            <input id="sa-c" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
          </Field>
        )}
        <button className="btn dark" disabled={busy}>{busy ? <Spinner /> : 'Masuk'}</button>
        <a className="small muted" href="#/">← Kembali ke Wanychat</a>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- Ringkasan
function OverviewTab({ guard, go }: { guard: Guard; go: (t: Tab) => void }) {
  const { data, load } = useLoad<{ overview: Overview }>('sa.overview', guard)
  if (!data) return <Spinner />
  const o = data.overview
  const cur = o.months[o.months.length - 1]
  const h = o.health
  const errors = Object.entries(h.errors_24h)
  const checks: [boolean, string, string][] = [
    [h.engine_enabled, 'Engine auto-reply', h.engine_enabled ? 'Berjalan' : 'Mode perawatan: semua balasan dihentikan'],
    [h.meta_app, 'Aplikasi Meta', h.meta_app ? 'App ID & App Secret terisi' : 'Isi di tab Teknis'],
    [!!h.midtrans, 'Midtrans', h.midtrans ? `Terhubung (${h.midtrans})` : 'Server key belum diisi: pembayaran nonaktif'],
    [errors.length === 0, 'Error 24 jam', errors.length ? errors.map(([k, v]) => `${k}: ${v}`).join(', ') : 'Tidak ada'],
    [h.token_errors.length === 0, 'Token Instagram', h.token_errors.length ? 'Gagal diperpanjang: ' + h.token_errors.map((x) => '@' + x).join(', ') : h.token_expiring.length ? 'Segera habis: ' + h.token_expiring.join(', ') : 'Semua sehat'],
    [true, 'Event terakhir', h.last_event_at ? timeAgo(h.last_event_at) : 'Belum ada'],
  ]
  const max = Math.max(1, ...o.months.map((m) => m.revenue))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ringkasan</h1>
          <p>Bisnis Wanychat bulan {new Date(o.month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}.</p>
        </div>
        <button className="btn sm" onClick={load}>↻ Muat ulang</button>
      </div>

      <div className="grid stats" style={{ marginBottom: 24 }}>
        <Tile n={fmt(o.totals.users)} label="Pengguna" sub={`+${o.totals.new_this_month} bulan ini`} tint="blue" />
        <Tile n={fmt(o.totals.paid_users)} label="Berbayar" sub={`${o.totals.auto_renew} perpanjang otomatis`} tint="yellow" />
        <Tile n={rupiah(o.totals.mrr)} label="MRR" sub="dari langganan otomatis" tint="green" />
        <Tile n={rupiah(cur.revenue)} label="Pendapatan" sub={`${cur.payments} pembayaran`} tint="pink" />
        <Tile n={rupiah(cur.profit)} label="Laba bersih" sub="setelah biaya" tint={cur.profit < 0 ? 'red' : 'purple'} />
        <Tile n={fmt(o.totals.active_7d)} label="Aktif 7 hari" sub={`${o.totals.suspended} dinonaktifkan`} tint="" />
      </div>

      <div className="grid two">
        <section className="card">
          <h2 className="card-title">Pendapatan 6 bulan</h2>
          <p className="card-sub">Pembayaran lunas per bulan (Rupiah).</p>
          <div className="bars" role="img" aria-label="Grafik pendapatan per bulan">
            {o.months.map((m) => (
              <div key={m.month} className="bar-col" tabIndex={0} data-tip={`${monthName(m.month)}: ${rupiah(m.revenue)} · laba ${rupiah(m.profit)}`}>
                <span className="bar-val">{m.revenue ? fmt(Math.round(m.revenue / 1000)) + 'rb' : ''}</span>
                <span className="bar" style={{ height: Math.max(2, (m.revenue / max) * 140) }} />
                <span className="bar-lbl">{monthName(m.month)}</span>
              </div>
            ))}
          </div>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="table">
              <thead><tr><th>Bulan</th><th>Pendapatan</th><th>Biaya Midtrans</th><th>Biaya AI</th><th>Server & lain</th><th>Laba</th></tr></thead>
              <tbody>
                {[...o.months].reverse().map((m) => (
                  <tr key={m.month}>
                    <td>{monthName(m.month)}</td><td>{rupiah(m.revenue)}</td><td>{rupiah(m.fees)}</td><td>{rupiah(m.ai_cost)}</td>
                    <td>{rupiah(m.fixed_cost)}</td><td className={m.profit < 0 ? 'neg' : ''}><b>{rupiah(m.profit)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Biaya AI = estimasi token × tarif di tab Teknis. Biaya server & lain diisi manual di tab Teknis.</p>
        </section>

        <div className="stack" style={{ gap: 20 }}>
          <section className="card">
            <h2 className="card-title">Kesehatan sistem</h2>
            {checks.map(([ok, t, d]) => (
              <div className="check" key={t}>
                <span className={'dot ' + (ok ? 'ok' : 'bad')} aria-hidden>{ok ? '✓' : '✕'}</span>
                <div style={{ minWidth: 0 }}><b>{t}</b><div className="small muted" style={{ wordBreak: 'break-word' }}>{d}</div></div>
              </div>
            ))}
          </section>

          <section className="card">
            <h2 className="card-title">Pemakaian bulan ini</h2>
            <div className="kv">
              <span>DM otomatis</span><b>{fmt(o.usage.dm)}</b>
              <span>Komentar diproses</span><b>{fmt(o.usage.comments)}</b>
              <span>Balasan AI</span><b>{fmt(o.usage.ai)}</b>
              <span>Token AI (estimasi)</span><b>{fmt(o.usage.ai_tokens)}</b>
              <span>Biaya AI (estimasi)</span><b>{rupiah(cur.ai_cost)}</b>
            </div>
            {o.usage.top_ai.length > 0 && <>
              <div className="label" style={{ marginTop: 14 }}>Pemakai AI terbanyak</div>
              {o.usage.top_ai.map((x) => <div key={x.username} className="row between small"><span>@{x.username}</span><span>{fmt(x.ai)} / {fmt(x.limit)}</span></div>)}
            </>}
            {h.over_quota.length > 0 && <p className="small" style={{ marginBottom: 0 }}><span className="badge orange">Kuota habis</span> {h.over_quota.map((x) => '@' + x).join(', ')}</p>}
          </section>

          <section className="card">
            <h2 className="card-title">Sebaran paket</h2>
            {o.plans.map((p) => (
              <div key={p.id} className="row between" style={{ padding: '6px 0' }}>
                <span><b>{p.name}</b> <span className="muted small">{rupiah(p.price)}</span></span>
                <span className="badge">{p.users} user</span>
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 6 }}>{o.totals.canceled} berhenti perpanjang · {o.totals.past_due} gagal bayar · {o.totals.rules} automasi total</div>
          </section>
        </div>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="row between"><h2 className="card-title">Aktivitas admin terbaru</h2><button className="btn sm" onClick={() => go('security')}>Semua log</button></div>
          <AuditTable rows={o.audit} />
        </section>
      </div>
    </>
  )
}

function Tile({ n, label, sub, tint }: { n: ReactNode; label: string; sub?: string; tint: string }) {
  return (
    <div className={'card stat ' + (tint ? 'tint-' + tint : '')}>
      <div className="num">{n}</div>
      <div className="lbl">{label}</div>
      {sub && <div className="small" style={{ opacity: .75 }}>{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- Pengguna
function UsersTab({ guard }: { guard: Guard }) {
  const toast = useToast()
  const { data, load } = useLoad<{ users: UserRow[]; plans: Plan[] }>('sa.users', guard)
  const [q, setQ] = useState('')
  const [planFilter, setPlanFilter] = useState('all')
  const [edit, setEdit] = useState<UserRow | null>(null)
  const shown = useMemo(() => (data?.users || []).filter((u) =>
    (planFilter === 'all' || (planFilter === 'suspended' ? u.suspended : u.plan === planFilter)) &&
    (!q || (u.username + ' ' + u.name + ' ' + u.ig_user_id).toLowerCase().includes(q.toLowerCase()))), [data, q, planFilter])

  if (!data) return <Spinner />
  return (
    <>
      <div className="page-head">
        <div><h1>Pengguna</h1><p>{data.users.length} akun Instagram terdaftar.</p></div>
        <button className="btn sm" onClick={load}>↻ Muat ulang</button>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Cari username / nama / ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 200 }} value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
          <option value="all">Semua paket</option>
          {data.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="suspended">Dinonaktifkan</option>
        </select>
      </div>
      <div className="grid user-grid">
        {shown.map((u) => (
          <article key={u.ig_user_id} className={'card user-card' + (u.suspended ? ' off' : '')}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              {u.avatar ? <img className="avatar" src={u.avatar} alt="" style={{ width: 44, height: 44 }} /> : <span className="avatar" style={{ width: 44, height: 44 }} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ellipsis"><b>@{u.username}</b></div>
                <div className="small muted ellipsis">{u.name || u.ig_user_id}</div>
              </div>
              <span className={'badge ' + (u.suspended ? 'red' : u.plan === 'free' ? '' : 'yellow')}>{u.suspended ? 'nonaktif' : data.plans.find((p) => p.id === u.plan)?.name || u.plan}</span>
            </div>
            <div className="kv small">
              <span>Masa aktif</span><b>{u.plan === 'free' ? '-' : date(u.period_end)}{u.auto_renew ? ' ↻' : ''}{u.source === 'manual' ? ' (manual)' : ''}</b>
              <span>DM bulan ini</span><b>{fmt(u.usage.dm)} / {fmt(u.limits.dm)}</b>
              <span>AI bulan ini</span><b>{fmt(u.usage.ai)} / {fmt(u.limits.ai)}</b>
              <span>Automasi</span><b>{u.rules}</b>
              <span>Aktivitas</span><b>{u.last_event_at ? timeAgo(u.last_event_at) : '-'}</b>
              <span>Daftar</span><b>{date(u.created_at)}</b>
            </div>
            {u.token_refresh_error && <div className="small" style={{ color: '#b3261e' }}>⚠ token: {u.token_refresh_error}</div>}
            {u.note && <div className="small muted">📝 {u.note}</div>}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit(u)}>Kelola</button>
          </article>
        ))}
      </div>
      {shown.length === 0 && <p className="muted">Tidak ada pengguna yang cocok.</p>}
      {edit && <UserEditor user={edit} plans={data.plans} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); toast('Tersimpan') }} guard={guard} />}
    </>
  )
}

function UserEditor({ user, plans, onClose, onSaved, guard }: { user: UserRow; plans: Plan[]; onClose: () => void; onSaved: () => void; guard: Guard }) {
  const toast = useToast()
  const [plan, setPlan] = useState(user.subscribed_plan || 'free')
  const [end, setEnd] = useState(() => (user.period_end ? user.period_end.slice(0, 10) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)))
  const [suspended, setSuspended] = useState(user.suspended)
  const [note, setNote] = useState(user.note)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState<'' | 'revoke' | 'cancel'>('')

  const run = async (label: string, action: string, payload: unknown, done?: string) => {
    setBusy(label)
    try { await saApi(action, payload); if (done) toast(done); onSaved() } catch (e) { guard(e) } finally { setBusy('') }
  }
  const save = () => run('save', 'sa.user.update', {
    account_id: user.ig_user_id, plan, period_end: plan === 'free' ? '' : end + 'T23:59:59+07:00', suspended, note,
  })

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card modal stack" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">Kelola @{user.username}</h3>
        <div className="small muted mono">ID {user.ig_user_id}{user.subscription_id && ' · langganan ' + user.subscription_id}</div>
        <div className="grid two" style={{ gap: 12 }}>
          <Field label="Paket">
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({rupiah(p.price)})</option>)}
            </select>
          </Field>
          {plan !== 'free' && (
            <Field label="Aktif sampai">
              <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          )}
        </div>
        {plan !== user.subscribed_plan && user.auto_renew && <div className="callout yellow small">User ini punya langganan otomatis {user.subscribed_plan}. Hentikan dulu supaya tidak tertagih dobel.</div>}
        <Switch checked={!suspended} onChange={(on) => setSuspended(!on)} label={suspended ? 'Dinonaktifkan: bot berhenti & tidak bisa login' : 'Akun aktif'} />
        <Field label="Catatan internal">
          <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. bonus 1 bulan, mitra, …" />
        </Field>
        <div className="row">
          <button className="btn sm" disabled={!!busy} onClick={() => setConfirm('revoke')}>Paksa keluar</button>
          {user.auto_renew && <button className="btn sm" disabled={!!busy} onClick={() => setConfirm('cancel')}>Hentikan langganan otomatis</button>}
        </div>
        <div className="row modal-actions">
          <button className="btn" onClick={onClose}>Batal</button>
          <button className="btn dark" disabled={!!busy} onClick={save}>{busy === 'save' ? <Spinner /> : 'Simpan'}</button>
        </div>
      </div>
      {confirm === 'revoke' && <Confirm title="Paksa keluar?" body={`Semua sesi login @${user.username} dihapus. Automasinya tetap jalan.`} confirmLabel="Keluarkan"
        onCancel={() => setConfirm('')} onConfirm={() => { setConfirm(''); run('revoke', 'sa.user.revoke', { account_id: user.ig_user_id }, 'Sesi dicabut') }} />}
      {confirm === 'cancel' && <Confirm title="Hentikan langganan otomatis?" body="Tagihan bulan berikutnya di Midtrans dibatalkan. Paket tetap aktif sampai masa aktif habis." confirmLabel="Hentikan"
        onCancel={() => setConfirm('')} onConfirm={() => { setConfirm(''); run('cancel', 'sa.user.cancel_sub', { account_id: user.ig_user_id }, 'Langganan otomatis dihentikan') }} />}
    </div>
  )
}

// ---------------------------------------------------------------- Pembayaran
const PAY_COLOR: Record<string, string> = { settlement: 'green', capture: 'green', pending: 'yellow', deny: 'red', failure: 'red', amount_mismatch: 'red', refund: 'purple', chargeback: 'red' }
function PaymentsTab({ guard }: { guard: Guard }) {
  const { data, load } = useLoad<{ payments: PaymentRow[] }>('sa.payments', guard)
  const [filter, setFilter] = useState('all')
  if (!data) return <Spinner />
  const shown = data.payments.filter((p) => filter === 'all' || (filter === 'paid' ? ['settlement', 'capture'].includes(p.status) : !['settlement', 'capture'].includes(p.status)))
  const total = shown.filter((p) => ['settlement', 'capture'].includes(p.status)).reduce((s, p) => s + p.amount, 0)
  return (
    <>
      <div className="page-head">
        <div><h1>Pembayaran</h1><p>{shown.length} transaksi · lunas {rupiah(total)}</p></div>
        <div className="row">
          {[['all', 'Semua'], ['paid', 'Lunas'], ['other', 'Lainnya']].map(([k, l]) => <button key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>)}
          <button className="btn sm" onClick={load}>↻</button>
        </div>
      </div>
      <section className="card">
        {shown.length === 0 ? <p className="muted" style={{ margin: 0 }}>Belum ada transaksi.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Waktu</th><th>User</th><th>Paket</th><th>Jumlah</th><th>Fee</th><th>Status</th><th>Metode</th><th>Order</th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>{date(p.paid_at || p.createdAt)}</td>
                    <td>{p.username ? '@' + p.username : <span className="muted">{p.account_id || '?'}</span>}</td>
                    <td>{p.plan}{p.kind === 'renewal' ? ' ↻' : ''}</td>
                    <td>{rupiah(p.amount)}</td><td>{rupiah(p.fee || 0)}</td>
                    <td><span className={'badge ' + (PAY_COLOR[p.status] || '')}>{p.status}</span>{p.note && <div className="small muted">{p.note}</div>}</td>
                    <td>{p.payment_type || '-'}</td>
                    <td className="mono">{p.order_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

// ---------------------------------------------------------------- Paket
function PlansTab({ guard }: { guard: Guard }) {
  const toast = useToast()
  const { data, load } = useLoad<{ settings: SettingsView }>('sa.settings.get', guard)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setPlans(data.settings.plans) }, [data])
  if (!plans) return <Spinner />
  const set = (i: number, k: keyof Plan, v: unknown) => setPlans((ps) => ps!.map((p, j) => (j === i ? { ...p, [k]: v } : p)))
  const save = async () => {
    setBusy(true)
    try { await saApi('sa.plans.save', { plans }); toast('Paket tersimpan'); load() } catch (e) { guard(e) } finally { setBusy(false) }
  }
  const NUMS: [keyof Plan, string, string][] = [['price', 'Harga / bulan (Rp)', ''], ['dm', 'DM / bulan', ''], ['ai', 'Balasan AI / bulan', '0 = tanpa AI'], ['rules', 'Maks automasi', '0 = tanpa batas']]
  return (
    <>
      <div className="page-head">
        <div><h1>Paket & harga</h1><p>Berlaku langsung untuk kuota, checkout, dan halaman harga (cache landing ±15 menit).</p></div>
        <div className="row">
          <button className="btn" onClick={() => setPlans([...plans, { id: 'baru' + plans.length, name: 'Paket baru', price: 149000, dm: 10000, ai: 5000, rules: 0, followup: true, persona: true }])}>+ Paket</button>
          <button className="btn dark" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Simpan paket'}</button>
        </div>
      </div>
      <div className="callout yellow small" style={{ marginBottom: 16 }}>Mengubah harga tidak mengubah tagihan otomatis yang sudah berjalan di Midtrans; harga baru berlaku untuk langganan baru.</div>
      <div className="grid lp-plans">
        {plans.map((p, i) => (
          <section key={i} className="card stack">
            <div className="row between">
              <input className="input" style={{ fontWeight: 700 }} value={p.name} onChange={(e) => set(i, 'name', e.target.value)} aria-label="Nama paket" />
              {p.id !== 'free' && <button className="btn sm ghost" aria-label="Hapus paket" onClick={() => setPlans(plans.filter((_, j) => j !== i))}>✕</button>}
            </div>
            <Field label="ID" hint="huruf kecil/angka, jangan diubah setelah ada pelanggan">
              <input className="input mono" value={p.id} disabled={p.id === 'free'} onChange={(e) => set(i, 'id', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
            </Field>
            {NUMS.map(([k, label, hint]) => (
              <Field key={k} label={label} hint={hint || undefined}>
                <input className="input" type="number" min={0} value={p[k] as number} disabled={k === 'price' && p.id === 'free'} onChange={(e) => set(i, k, Number(e.target.value))} />
              </Field>
            ))}
            <Switch checked={p.followup} onChange={(v) => set(i, 'followup', v)} label="Follow-up DM" />
            <Switch checked={p.persona} onChange={(v) => set(i, 'persona', v)} label="Persona AI sendiri" />
          </section>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Teknis
type Def = { key: string; label: string; hint?: string; kind?: 'bool' | 'secret' | 'text' | 'area' | 'select' | 'number'; options?: string[] }
const GROUPS: { title: string; desc: string; fields: Def[] }[] = [
  { title: 'Umum', desc: 'Operasional aplikasi.', fields: [
    { key: 'engine_enabled', label: 'Engine auto-reply aktif', kind: 'bool', hint: 'Matikan untuk mode perawatan: semua balasan & follow-up berhenti.' },
    { key: 'signup_open', label: 'Pendaftaran akun baru dibuka', kind: 'bool' },
    { key: 'announcement', label: 'Pengumuman di panel pengguna', hint: 'Kosongkan untuk menyembunyikan. Maks 300 karakter.' },
    { key: 'public_url', label: 'URL publik panel', hint: 'mis. https://wanychat.remot.in (tanpa / di akhir). Dipakai untuk login Instagram & Midtrans.' },
  ] },
  { title: 'Instagram / Meta', desc: 'Aplikasi Meta untuk login & webhook.', fields: [
    { key: 'ig_app_id', label: 'Instagram App ID' },
    { key: 'app_secret', label: 'Instagram App Secret', kind: 'secret', hint: 'Dipakai juga untuk memverifikasi tanda tangan webhook.' },
    { key: 'verify_token', label: 'Verify token webhook' },
    { key: 'graph_version', label: 'Versi Graph API', hint: 'mis. v23.0' },
  ] },
  { title: 'AI (DeepSeek)', desc: 'Balasan AI untuk komentar.', fields: [
    { key: 'gemini_enabled', label: 'Balasan AI aktif (global)', kind: 'bool' },
    { key: 'gemini_persona', label: 'Persona bawaan', kind: 'area', hint: 'Dipakai paket tanpa persona sendiri.' },
    { key: 'cost_ai_per_1m_idr', label: 'Biaya AI per 1 juta token (Rp)', kind: 'number', hint: 'Untuk estimasi biaya; lihat tarif DeepSeek.' },
  ] },
  { title: 'Midtrans', desc: 'Pembayaran langganan bulanan.', fields: [
    { key: 'midtrans_env', label: 'Mode', kind: 'select', options: ['sandbox', 'production'] },
    { key: 'midtrans_server_key', label: 'Server key', kind: 'secret', hint: 'SB-Mid-server-… (sandbox) atau Mid-server-… (production).' },
    { key: 'midtrans_client_key', label: 'Client key' },
    { key: 'midtrans_payments', label: 'Metode bayar', hint: 'credit_card untuk perpanjangan otomatis. Tambahan (gopay, other_qris, bca_va, …) = bayar manual tiap bulan.' },
    { key: 'midtrans_fee_pct', label: 'Fee Midtrans (%)', kind: 'number' },
    { key: 'midtrans_fee_flat', label: 'Fee Midtrans tetap (Rp)', kind: 'number' },
  ] },
  { title: 'Biaya bulanan', desc: 'Untuk menghitung laba.', fields: [
    { key: 'cost_server_idr', label: 'Server / n8n (Rp per bulan)', kind: 'number' },
    { key: 'cost_other_idr', label: 'Biaya lain (Rp per bulan)', kind: 'number' },
    { key: 'usd_idr', label: 'Kurs USD → IDR', kind: 'number' },
  ] },
]

function SettingsTab({ guard }: { guard: Guard }) {
  const toast = useToast()
  const { data, load } = useLoad<{ settings: SettingsView }>('sa.settings.get', guard)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!data) return
    const f: Record<string, string> = {}
    for (const g of GROUPS) for (const d of g.fields) {
      const v = data.settings.values[d.key]
      f[d.key] = d.kind === 'secret' ? '' : typeof v === 'string' ? v : d.kind === 'bool' ? 'true' : ''
    }
    setForm(f)
  }, [data])
  if (!data) return <Spinner />
  const values = data.settings.values
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => {
    const d = GROUPS.flatMap((g) => g.fields).find((x) => x.key === k)!
    return d.kind === 'secret' ? v.trim() !== '' : v !== (typeof values[k] === 'string' ? values[k] : d.kind === 'bool' ? 'true' : '')
  }))
  const save = async () => {
    setBusy(true)
    try {
      const r = await saApi<{ changed: string[] }>('sa.settings.save', { values: changed })
      toast(r.changed.length ? 'Tersimpan: ' + r.changed.join(', ') : 'Tidak ada perubahan')
      load()
    } catch (e) { guard(e) } finally { setBusy(false) }
  }
  const n = Object.keys(changed).length

  return (
    <>
      <div className="page-head">
        <div><h1>Pengaturan teknis</h1><p>Rahasia (secret key) tidak pernah ditampilkan; isi hanya untuk mengganti.</p></div>
        <button className="btn dark" disabled={busy || !n} onClick={save}>{busy ? <Spinner /> : n ? `Simpan ${n} perubahan` : 'Simpan'}</button>
      </div>
      <div className="grid two">
        {GROUPS.map((g) => (
          <section key={g.title} className="card stack">
            <div><h2 className="card-title">{g.title}</h2><p className="card-sub" style={{ margin: 0 }}>{g.desc}</p></div>
            {g.fields.map((d) => {
              const v = form[d.key] ?? ''
              const cur = values[d.key]
              const set = (x: string) => setForm((f) => ({ ...f, [d.key]: x }))
              if (d.kind === 'bool') return <div key={d.key}><Switch checked={v === 'true'} onChange={(b) => set(b ? 'true' : 'false')} label={d.label} />{d.hint && <p className="hint">{d.hint}</p>}</div>
              const secretHint = d.kind === 'secret' && typeof cur === 'object' ? (cur.set ? `Tersimpan (${cur.hint}). ` : 'Belum diisi. ') : ''
              return (
                <Field key={d.key} label={d.label} hint={secretHint + (d.hint || '')}>
                  {d.kind === 'area' ? <textarea className="input" rows={4} value={v} onChange={(e) => set(e.target.value)} />
                    : d.kind === 'select' ? <select className="input" value={v} onChange={(e) => set(e.target.value)}>{d.options!.map((o) => <option key={o}>{o}</option>)}</select>
                      : <input className={'input' + (d.kind === 'secret' ? ' mono' : '')} type={d.kind === 'secret' ? 'password' : d.kind === 'number' ? 'number' : 'text'}
                        autoComplete="off" step="any" value={v} placeholder={d.kind === 'secret' ? 'isi untuk mengganti' : ''} onChange={(e) => set(e.target.value)} />}
                </Field>
              )
            })}
            {g.title === 'Instagram / Meta' && <>
              <Copy label="Callback URL webhook Meta" value={data.settings.webhooks.meta} />
              <Copy label="OAuth redirect URI" value={data.settings.webhooks.oauth_redirect} />
            </>}
            {g.title === 'Midtrans' && <Copy label="Payment & Recurring Notification URL (dasbor Midtrans)" value={data.settings.webhooks.midtrans} />}
          </section>
        ))}
      </div>
    </>
  )
}

function Copy({ label, value }: { label: string; value: string }) {
  const toast = useToast()
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <code className="mono copy-val">{value}</code>
        <button className="btn sm" onClick={() => navigator.clipboard.writeText(value).then(() => toast('Disalin'))}>Salin</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Keamanan
function SecurityTab({ guard }: { guard: Guard }) {
  const toast = useToast()
  const { data: me, load: reloadMe } = useLoad<{ user: string; totp: boolean }>('sa.me', guard)
  const { data: audit, load: reloadAudit } = useLoad<{ audit: AuditRow[] }>('sa.audit', guard)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '', username: '' })
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [off, setOff] = useState({ password: '', code: '' })
  const [busy, setBusy] = useState('')

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label)
    try { await fn(); toast(ok); reloadMe(); reloadAudit() } catch (e) { guard(e) } finally { setBusy('') }
  }
  const strong = pw.next.length >= 12 && /[a-z]/i.test(pw.next) && /\d/.test(pw.next)

  return (
    <>
      <div className="page-head"><div><h1>Keamanan</h1><p>Password, verifikasi dua langkah, dan log aktivitas admin.</p></div></div>
      <div className="grid two">
        <form className="card stack" onSubmit={(e) => {
          e.preventDefault()
          if (pw.next !== pw.confirm) return toast('Konfirmasi password tidak sama', 'error')
          run('pw', () => saApi('sa.password', { current: pw.current, next: pw.next, ...(pw.username ? { username: pw.username } : {}) }), 'Password diganti')
            .then(() => setPw({ current: '', next: '', confirm: '', username: '' }))
        }}>
          <h2 className="card-title">Ganti password</h2>
          <Field label="Password sekarang"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
          <Field label="Password baru" hint="Minimal 12 karakter, huruf + angka. Gunakan password manager.">
            <input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
          </Field>
          <Field label="Ulangi password baru"><input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
          <Field label="Username baru (opsional)" hint={`Sekarang: ${me?.user || '…'}`}><input className="input" autoComplete="off" value={pw.username} onChange={(e) => setPw({ ...pw, username: e.target.value })} /></Field>
          <button className="btn dark" disabled={!!busy || !strong}>{busy === 'pw' ? <Spinner /> : 'Simpan password'}</button>
        </form>

        <section className="card stack">
          <h2 className="card-title">Verifikasi dua langkah (2FA)</h2>
          {!me ? <Spinner /> : me.totp ? (
            <>
              <div className="callout" style={{ background: 'var(--green)' }}>✓ 2FA aktif. Login butuh kode dari aplikasi authenticator.</div>
              <details>
                <summary className="small" style={{ cursor: 'pointer' }}>Matikan 2FA</summary>
                <div className="stack" style={{ marginTop: 10 }}>
                  <input className="input" type="password" placeholder="Password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} />
                  <input className="input mono" inputMode="numeric" maxLength={6} placeholder="Kode 2FA" value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value.replace(/\D/g, '') })} />
                  <button className="btn danger sm" disabled={!!busy} onClick={() => run('off', () => saApi('sa.totp.disable', off), '2FA dimatikan').then(() => setOff({ password: '', code: '' }))}>Matikan 2FA</button>
                </div>
              </details>
            </>
          ) : setup ? (
            <>
              <ol className="steps small">
                <li>Buka Google Authenticator / Authy / 1Password, tambah akun dengan <b>kunci manual</b>.</li>
                <li>Masukkan kunci ini (tipe: berbasis waktu):</li>
              </ol>
              <code className="mono copy-val" style={{ fontSize: 15, letterSpacing: '.08em' }}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
              <a className="small" href={setup.uri}>Buka langsung di aplikasi authenticator (di HP)</a>
              <Field label="Kode 6 digit dari aplikasi">
                <input className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <button className="btn dark" disabled={!!busy || code.length !== 6} onClick={() => run('confirm', () => saApi('sa.totp.confirm', { code }), '2FA aktif').then(() => { setSetup(null); setCode('') })}>Aktifkan</button>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>Sangat disarankan: walau password bocor, orang lain tetap tidak bisa masuk tanpa HP kamu.</p>
              <button className="btn dark" disabled={!!busy} onClick={async () => {
                setBusy('begin')
                try { setSetup(await saApi<{ secret: string; uri: string }>('sa.totp.begin')) } catch (e) { guard(e) } finally { setBusy('') }
              }}>Mulai aktivasi 2FA</button>
            </>
          )}
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="row between"><h2 className="card-title">Log audit</h2><button className="btn sm" onClick={reloadAudit}>↻</button></div>
          <p className="card-sub">Login, perubahan setelan, pembayaran, dan tindakan pada pengguna (300 terbaru).</p>
          {!audit ? <Spinner /> : <AuditTable rows={audit.audit} />}
        </section>
      </div>
    </>
  )
}

const AUDIT_COLOR: Record<string, string> = { login_failed: 'red', login_locked: 'red', midtrans_bad_signature: 'red', midtrans_amount_mismatch: 'red', payment_paid: 'green', login_ok: 'blue' }
function AuditTable({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>Belum ada catatan.</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Waktu</th><th>Oleh</th><th>Aksi</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td title={new Date(r.createdAt).toLocaleString('id-ID')}>{timeAgo(r.createdAt)}</td>
              <td>{r.actor}</td>
              <td><span className={'badge ' + (AUDIT_COLOR[r.action] || '')}>{r.action}</span></td>
              <td className="mono">{r.target}</td>
              <td className="small">{r.detail}</td>
              <td className="mono">{r.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

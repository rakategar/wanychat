import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Account, type Billing } from './api'
import { Brand, Spinner, useToast } from './components/ui'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import Automations from './pages/Automations'
import Activity from './pages/Activity'
import BillingPage from './pages/Billing'
import SettingsPage from './pages/Settings'

// Dasbor superadmin dimuat terpisah: tidak ikut terunduh oleh pengguna biasa
const AdminApp = lazy(() => import('./admin/AdminApp'))

export type Page = 'dashboard' | 'automations' | 'activity' | 'billing' | 'settings'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dasbor', icon: '🏠' },
  { id: 'automations', label: 'Automasi', icon: '⚡' },
  { id: 'activity', label: 'Aktivitas', icon: '📜' },
  { id: 'billing', label: 'Langganan', icon: '💳' },
  { id: 'settings', label: 'Akun', icon: '👤' },
]

// Hash route: "" / "#/" = landing (tanpa panggilan API), "#/dashboard" dst = panel, "#/login?error=..." = landing + pesan,
// "#/admin" = dasbor superadmin
const readHash = () => {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { path, params: new URLSearchParams(query) }
}
const isPanel = (path: string) => NAV.some((n) => n.id === path)
const pageFromHash = (): Page => {
  const { path } = readHash()
  return isPanel(path) ? (path as Page) : 'dashboard'
}

// Penanda non-rahasia bahwa browser ini pernah login (cookie sesi sendiri HttpOnly)
const HINT = 'wany_signed_in'
const hint = {
  get: () => { try { return localStorage.getItem(HINT) === '1' } catch { return false } },
  set: (on: boolean) => { try { if (on) localStorage.setItem(HINT, '1'); else localStorage.removeItem(HINT) } catch { /* mode privat */ } },
}

export default function App() {
  const [admin, setAdmin] = useState(() => readHash().path.startsWith('admin'))
  useEffect(() => {
    const f = () => setAdmin(readHash().path.startsWith('admin'))
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  if (admin) return <Suspense fallback={<div className="login"><Spinner /></div>}><AdminApp /></Suspense>
  return <UserApp />
}

function UserApp() {
  const toast = useToast()
  const [account, setAccount] = useState<Account | null>(null)
  const [billing, setBilling] = useState<Billing | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [auth, setAuth] = useState<'checking' | 'out' | 'in'>(() => (isPanel(readHash().path) ? 'checking' : 'out'))
  const [page, setPage] = useState<Page>(pageFromHash)
  const [loginError, setLoginError] = useState(() => readHash().params.get('error') || '')

  const loadAccount = useCallback(async () => {
    const r = await api<{ account: Account; billing: Billing; announcement: string }>('auth.me')
    setAccount(r.account)
    setBilling(r.billing)
    setAnnouncement(r.announcement || '')
    return r.account
  }, [])

  const checkAuth = useCallback(() => {
    setAuth('checking')
    const warn = readHash().params.get('warn')
    loadAccount()
      .then(() => {
        hint.set(true)
        setAuth('in')
        if (warn) toast(warn, 'error')
        const { params } = readHash()
        if (params.size && !params.has('paid')) window.history.replaceState(null, '', '#/' + pageFromHash())
      })
      .catch((e) => {
        hint.set(false)
        setAuth('out')
        window.history.replaceState(null, '', '#/')
        if (e instanceof ApiError && e.status === 401 && e.message !== 'Silakan masuk dengan Instagram') setLoginError(e.message)
        else if (!(e instanceof ApiError && e.status === 401)) toast(e.message, 'error')
      })
  }, [loadAccount, toast])

  useEffect(() => {
    if (auth === 'checking') checkAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onHash = () => {
      const { path, params } = readHash()
      if (isPanel(path)) {
        setPage(path as Page)
        if (!account) checkAuth()
      } else if (path === 'login' || path === '') {
        setLoginError(params.get('error') || '')
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [account, checkAuth])

  const go = (p: Page) => { window.location.hash = '/' + p; setPage(p); window.scrollTo(0, 0) }
  const logout = async () => {
    try { await api('auth.logout') } catch { /* sesi sudah habis */ }
    hint.set(false)
    setAccount(null)
    setAuth('out')
    window.history.replaceState(null, '', '#/')
  }

  if (auth === 'checking') return <div className="login"><Spinner /></div>
  if (auth === 'out' || !account || !isPanel(readHash().path)) return <Landing error={loginError} signedIn={!!account || hint.get()} />

  const planName = billing?.plan.name || 'Gratis'

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={'nav-item' + (page === n.id ? ' active' : '')} onClick={() => go(n.id)}>
              <span aria-hidden>{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="plan-chip" onClick={() => go('billing')}>
            Paket <b>{planName}</b>
            {billing && billing.plan.id === 'free' && <span className="badge dark">Upgrade</span>}
          </button>
          <div className="account-chip">
            {account.avatar ? <img src={account.avatar} alt="" /> : <span className="avatar" />}
            <div style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontWeight: 700 }}>@{account.username}</div>
              <div className="small muted">terhubung</div>
            </div>
          </div>
          <button className="btn sm ghost" onClick={logout}>Keluar</button>
        </div>
      </aside>

      <header className="mobile-bar">
        <Brand size={17} />
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <button className="badge yellow" onClick={() => go('billing')}>{planName}</button>
          <button className="avatar-btn" onClick={() => go('settings')} aria-label="Akun">
            {account.avatar ? <img className="avatar" src={account.avatar} alt="" /> : <span className="avatar" />}
          </button>
        </div>
      </header>

      <main className="main">
        {announcement && <div className="callout yellow announce" role="status">📣 {announcement}</div>}
        {page === 'dashboard' && <Dashboard account={account} billing={billing} go={go} />}
        {page === 'automations' && <Automations account={account} billing={billing} />}
        {page === 'activity' && <Activity />}
        {page === 'billing' && <BillingPage billing={billing} reload={loadAccount} />}
        {page === 'settings' && <SettingsPage account={account} billing={billing} reload={loadAccount} logout={logout} />}
      </main>

      <nav className="tabbar">
        {NAV.map((n) => (
          <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => go(n.id)}>
            <span aria-hidden className="tab-icon">{n.icon}</span>{n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, switchAccount, type Me, type SocialAccount, type User } from './api'
import { Brand, Spinner, useToast } from './components/ui'
import { CHANNEL } from './components/Connect'
import Landing from './pages/Landing'
import AuthPage, { type AuthMode } from './pages/Auth'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Automations from './pages/Automations'
import Activity from './pages/Activity'
import BillingPage from './pages/Billing'
import SettingsPage from './pages/Settings'
import AnalyticsPage from './pages/Analytics'
import TikTokPage from './pages/TikTok'

// Dasbor superadmin dimuat terpisah: tidak ikut terunduh oleh pengguna biasa
const AdminApp = lazy(() => import('./admin/AdminApp'))

export type Page = 'dashboard' | 'automations' | 'tiktok' | 'activity' | 'analytics' | 'billing' | 'settings'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dasbor', icon: '🏠' },
  { id: 'automations', label: 'Automasi', icon: '⚡' },
  { id: 'tiktok', label: 'TikTok', icon: '🎵' },
  { id: 'activity', label: 'Aktivitas', icon: '📜' },
  { id: 'analytics', label: 'Analitik', icon: '📊' },
  { id: 'billing', label: 'Langganan', icon: '💳' },
  { id: 'settings', label: 'Akun', icon: '👤' },
]
const AUTH_MODES: AuthMode[] = ['login', 'register', 'verify', 'forgot', 'reset']

// Hash route: "" / "#/" = landing (tanpa panggilan API), "#/login" dst = halaman akun, "#/onboarding" = user baru,
// "#/dashboard" dst = panel, "#/admin" = dasbor superadmin
const readHash = () => {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { path, params: new URLSearchParams(query) }
}
const isPanel = (path: string) => NAV.some((n) => n.id === path)
const needsSession = (path: string) => isPanel(path) || path === 'onboarding'
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
  const [me, setMeState] = useState<Me | null>(null)
  // Salinan sinkron untuk handler hashchange (bisa jalan sebelum React merender state baru)
  const meRef = useRef<Me | null>(null)
  const setMe = useCallback((m: Me | null) => { meRef.current = m; setMeState(m) }, [])
  const [route, setRoute] = useState(readHash)
  const [auth, setAuth] = useState<'checking' | 'out' | 'in'>(() => (needsSession(readHash().path) ? 'checking' : 'out'))

  const loadMe = useCallback(async () => {
    const r = await api<Me>('auth.me')
    setMe(r)
    return r
  }, [setMe])

  // Pesan sekali jalan dari redirect OAuth / pembayaran (?linked=, ?connected=, ?error=, ?warn=), lalu dibersihkan dari URL
  const flash = useCallback(() => {
    const { path, params } = readHash()
    if (path === 'onboarding') return
    if (params.get('warn')) toast(params.get('warn')!, 'error')
    if (params.get('error') && isPanel(path)) toast(params.get('error')!, 'error')
    if (params.get('linked') === 'instagram') toast(params.get('claimed') === '1' ? 'Instagram terhubung. Automasi & data lamanya ikut masuk 🎉' : 'Instagram terhubung 🎉')
    if (params.get('connected') === '1') toast('TikTok terhubung 🎉')
    if (isPanel(path) && params.size && !params.has('paid') && !params.has('plan')) window.history.replaceState(null, '', '#/' + path)
  }, [toast])

  const checkAuth = useCallback(() => {
    setAuth('checking')
    loadMe()
      .then((r) => {
        hint.set(true)
        setAuth('in')
        const { path } = readHash()
        // User yang belum menyelesaikan onboarding selalu diarahkan ke sana dulu
        if (!r.user.onboarding.done && path !== 'onboarding') window.location.hash = '/onboarding'
        else flash()
      })
      .catch((e) => {
        hint.set(false)
        setMe(null)
        setAuth('out')
        if (e instanceof ApiError && e.status === 401) window.location.hash = '/login'
        else { toast(e.message, 'error'); window.history.replaceState(null, '', '#/') }
      })
  }, [loadMe, flash, toast, setMe])

  useEffect(() => {
    if (auth === 'checking') checkAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onHash = () => {
      const r = readHash()
      const cur = meRef.current
      setRoute(r)
      if (needsSession(r.path) && !cur) checkAuth()
      else if (isPanel(r.path) && cur && !cur.user.onboarding.done) window.location.hash = '/onboarding'
      else if (isPanel(r.path)) flash()
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [checkAuth, flash])

  const go = (p: Page) => { window.location.hash = '/' + p; window.scrollTo(0, 0) }
  const logout = async () => {
    try { await api('auth.logout') } catch { /* sesi sudah habis */ }
    hint.set(false)
    setMe(null)
    setAuth('out')
    window.location.hash = '/'
  }
  const signedIn = (next: 'onboarding' | 'dashboard') => {
    setMe(null)
    setAuth('checking')
    window.location.hash = '/' + next
    checkAuth()
  }
  const setUser = (u: User) => { if (meRef.current) setMe({ ...meRef.current, user: u }) }

  const { path, params } = route
  if (AUTH_MODES.includes(path as AuthMode)) return <AuthPage mode={path as AuthMode} error={params.get('error') || ''} onSignedIn={signedIn} />
  if (auth === 'checking') return <div className="login"><Spinner /></div>
  if (auth === 'out' || !me || !needsSession(path)) return <Landing signedIn={!!me || hint.get()} />
  if (path === 'onboarding') return <Onboarding key={params.get('step') || ''} me={me} onUser={setUser} onDone={(to) => { loadMe().catch(() => {}); window.location.hash = to }} />

  const { user, account, billing, accounts } = me
  const page = pageFromHash()
  const planName = billing?.plan.name || 'Gratis'
  const current = account ? { type: 'instagram' as const, username: account.username, avatar: account.avatar }
    : me.tiktok ? { type: 'tiktok' as const, username: me.tiktok.username, avatar: me.tiktok.avatar } : null

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
          <AccountSwitcher accounts={accounts} go={go} />
          <div className="account-chip">
            {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
            <div style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontWeight: 700 }}>{user.name || user.email}</div>
              <div className="small muted ellipsis">{user.email}</div>
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
            {current?.avatar ? <img className="avatar" src={current.avatar} alt="" /> : <span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
          </button>
        </div>
      </header>

      <main className="main">
        {me.announcement && <div className="callout yellow announce" role="status">📣 {me.announcement}</div>}
        {billing?.group_inactive && (
          <div className="callout pink announce" role="status">
            Akun ini tidak aktif: paket {billing.plan.name} hanya untuk {billing.accounts_limit} akun sosial. Automasi akun ini berhenti sampai paket dinaikkan
            atau akun lain dilepas. <a href="#/billing">Lihat paket</a>
          </div>
        )}
        {page === 'dashboard' && <Dashboard me={me} go={go} />}
        {page === 'automations' && <Automations account={account} billing={billing} />}
        {page === 'tiktok' && <TikTokPage tiktok={me.tiktok} accounts={accounts} billing={billing} />}
        {page === 'activity' && <Activity account={account} />}
        {page === 'analytics' && <AnalyticsPage account={account} billing={billing} go={go} />}
        {page === 'billing' && <BillingPage billing={billing} reload={loadMe} />}
        {page === 'settings' && <SettingsPage me={me} reload={loadMe} logout={logout} />}
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

// Semua akun sosial milik user (Instagram + TikTok): klik untuk membuka dasbor akun itu
function AccountSwitcher({ accounts, go }: { accounts: SocialAccount[]; go: (p: Page) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  return (
    <div className="switcher">
      {accounts.map((a) => (
        <button key={a.type + a.id} className={'switcher-item' + (a.current ? ' current' : '')} disabled={!!busy}
          title={a.current ? 'Sedang dibuka' : 'Buka akun ini'}
          onClick={async () => {
            if (a.current) { go(a.type === 'tiktok' ? 'tiktok' : 'dashboard'); return }
            setBusy(a.id)
            try { await switchAccount(a) } catch (e) { toast((e as Error).message, 'error'); setBusy('') }
          }}>
          {a.avatar ? <img src={a.avatar} alt="" /> : <span className="avatar" />}
          <span className="ellipsis">@{a.username || a.id}</span>
          {busy === a.id ? <Spinner /> : <span aria-hidden title={CHANNEL[a.type].label}>{CHANNEL[a.type].icon}</span>}
        </button>
      ))}
      <button className="switcher-item add" onClick={() => go('settings')}>＋ {accounts.length ? 'Kelola akun' : 'Hubungkan akun'}</button>
    </div>
  )
}

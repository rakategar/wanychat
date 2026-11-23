import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, channelPref, switchAccount, type Me, type SocialAccount, type User } from './api'
import { Brand, Spinner, useToast } from './components/ui'
import { CHANNEL, ChannelLogo } from './components/Connect'
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

// 'tiktok' = alamat lama (redirect OAuth TikTok): membuka dasbor kanal TikTok
export type Page = 'dashboard' | 'automations' | 'comments' | 'activity' | 'analytics' | 'billing' | 'settings' | 'tiktok'
type Channel = SocialAccount['type'] | 'none'
type NavItem = { id: Page; label: string; icon: string }

// Menu mengikuti akun yang sedang dibuka (seperti ManyChat): tiap kanal punya dasbornya sendiri
const CHANNEL_NAV: Record<Channel, NavItem[]> = {
  instagram: [
    { id: 'dashboard', label: 'Dasbor', icon: '🏠' },
    { id: 'automations', label: 'Automasi', icon: '⚡' },
    { id: 'activity', label: 'Aktivitas', icon: '📜' },
    { id: 'analytics', label: 'Analitik', icon: '📊' },
  ],
  tiktok: [
    { id: 'dashboard', label: 'Dasbor', icon: '🏠' },
    { id: 'automations', label: 'Automasi', icon: '⚡' },
    { id: 'comments', label: 'Komentar', icon: '💬' },
    { id: 'activity', label: 'Aktivitas', icon: '📜' },
  ],
  none: [{ id: 'dashboard', label: 'Dasbor', icon: '🏠' }],
}
const ACCOUNT_NAV: NavItem[] = [
  { id: 'billing', label: 'Langganan', icon: '💳' },
  { id: 'settings', label: 'Akun', icon: '👤' },
]
const PAGES: Page[] = ['dashboard', 'automations', 'comments', 'activity', 'analytics', 'billing', 'settings', 'tiktok']
const AUTH_MODES: AuthMode[] = ['login', 'register', 'verify', 'forgot', 'reset']

// Hash route: "" / "#/" = landing (tanpa panggilan API), "#/login" dst = halaman akun, "#/onboarding" = user baru,
// "#/dashboard" dst = panel, "#/admin" = dasbor superadmin
const readHash = () => {
  let [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  if (path === 'tiktok') {
    channelPref.set('tiktok')
    path = 'dashboard'
    window.history.replaceState(null, '', '#/dashboard' + (query ? '?' + query : ''))
  }
  return { path, params: new URLSearchParams(query) }
}
const isPanel = (path: string) => PAGES.includes(path as Page)
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
    if (params.get('linked') === 'instagram') channelPref.set('instagram')
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
  const pref = channelPref.get()
  const channel: Channel = pref === 'tiktok' && me.tiktok ? 'tiktok' : account ? 'instagram' : me.tiktok ? 'tiktok' : 'none'
  const nav = CHANNEL_NAV[channel]
  const want = pageFromHash()
  // Halaman yang tidak ada di kanal ini (mis. Analitik saat membuka TikTok) jatuh ke dasbor kanal
  const page: Page = nav.some((n) => n.id === want) || ACCOUNT_NAV.some((n) => n.id === want) ? want : 'dashboard'
  const planName = billing?.plan.name || 'Gratis'
  const tabs = [...nav, ACCOUNT_NAV[1]]

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <WorkspaceSwitcher accounts={accounts} channel={channel} go={go} />
        <nav className="nav">
          {nav.map((n) => (
            <button key={n.id} className={'nav-item' + (page === n.id ? ' active' : '')} onClick={() => go(n.id)}>
              <span aria-hidden>{n.icon}</span> {n.label}
            </button>
          ))}
          <div className="nav-sep" role="separator" />
          {ACCOUNT_NAV.map((n) => (
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
            {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="ellipsis" style={{ fontWeight: 700 }}>{user.name || user.email}</div>
              <div className="small muted ellipsis">{user.email}</div>
            </div>
          </div>
          <button className="btn sm ghost" onClick={logout}>Keluar</button>
        </div>
      </aside>

      <header className="mobile-bar">
        <WorkspaceSwitcher accounts={accounts} channel={channel} go={go} compact />
        <button className="badge yellow" style={{ flex: 'none' }} onClick={() => go('billing')}>{planName}</button>
      </header>

      <main className="main">
        {me.announcement && <div className="callout yellow announce" role="status">📣 {me.announcement}</div>}
        {billing?.group_inactive && channel === 'instagram' && (
          <div className="callout pink announce" role="status">
            Akun ini tidak aktif: paket {billing.plan.name} hanya untuk {billing.accounts_limit} akun sosial. Automasi akun ini berhenti sampai paket dinaikkan
            atau akun lain dilepas. <a href="#/billing">Lihat paket</a>
          </div>
        )}
        {channel === 'tiktok' && me.tiktok && ['dashboard', 'automations', 'comments', 'activity'].includes(page) && (
          <TikTokPage key={me.tiktok.open_id} view={page as 'dashboard'} tiktok={me.tiktok} accounts={accounts} billing={billing} go={go} />
        )}
        {channel !== 'tiktok' && <>
          {page === 'dashboard' && <Dashboard me={me} go={go} />}
          {page === 'automations' && <Automations account={account} billing={billing} />}
          {page === 'activity' && <Activity account={account} />}
          {page === 'analytics' && <AnalyticsPage account={account} billing={billing} go={go} />}
        </>}
        {page === 'billing' && <BillingPage billing={billing} reload={loadMe} />}
        {page === 'settings' && <SettingsPage me={me} reload={loadMe} logout={logout} />}
      </main>

      <nav className="tabbar">
        {tabs.map((n) => (
          <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => go(n.id)}>
            <span aria-hidden className="tab-icon">{n.icon}</span>{n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

// Pemilih akun di atas menu (seperti ManyChat): akun yang sedang dibuka + daftar akun Instagram & TikTok
function WorkspaceSwitcher({ accounts, channel, go, compact }: { accounts: SocialAccount[]; channel: Channel; go: (p: Page) => void; compact?: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const cur = channel === 'none' ? null : accounts.find((a) => a.type === channel && a.current) || null
  const pick = async (a: SocialAccount) => {
    if (a.current) {
      channelPref.set(a.type)
      setOpen(false)
      if (a.type !== channel) { window.location.hash = '/dashboard'; window.location.reload() } else go('dashboard')
      return
    }
    setBusy(a.type + a.id)
    try { await switchAccount(a) } catch (e) { toast((e as Error).message, 'error'); setBusy('') }
  }
  const groups = (['instagram', 'tiktok'] as const).map((t) => ({ t, list: accounts.filter((a) => a.type === t) })).filter((g) => g.list.length)

  return (
    <div className={'ws' + (compact ? ' compact' : '')} ref={ref}>
      <button className="ws-current" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ws-avatar">
          {cur?.avatar ? <img src={cur.avatar} alt="" /> : <span className="avatar">{cur ? (cur.username || '?').slice(0, 1).toUpperCase() : '＋'}</span>}
          {cur && <span className="ws-badge"><ChannelLogo type={cur.type} size={16} /></span>}
        </span>
        <span className="ws-text">
          <b className="ellipsis">{cur ? '@' + (cur.username || cur.id) : 'Belum ada akun'}</b>
          <span className="small muted ellipsis">{cur ? CHANNEL[cur.type].label + (cur.active ? '' : ' · tidak aktif') : 'Hubungkan Instagram/TikTok'}</span>
        </span>
        <span aria-hidden className="ws-caret">▾</span>
      </button>
      {open && (
        <div className="ws-menu" role="menu">
          {groups.map((g) => (
            <div key={g.t} className="ws-group">
              <div className="ws-label"><ChannelLogo type={g.t} size={14} /> {CHANNEL[g.t].label}</div>
              {g.list.map((a) => {
                const on = a.type === channel && a.current
                return (
                  <button key={a.id} role="menuitem" className={'ws-item' + (on ? ' on' : '')} disabled={!!busy} onClick={() => pick(a)}>
                    {a.avatar ? <img className="avatar" src={a.avatar} alt="" /> : <span className="avatar" />}
                    <span className="ellipsis">@{a.username || a.id}</span>
                    {busy === a.type + a.id ? <Spinner /> : on ? <span aria-label="sedang dibuka">✓</span> : !a.active ? <span className="badge orange">nonaktif</span> : null}
                  </button>
                )
              })}
            </div>
          ))}
          <button role="menuitem" className="ws-item add" onClick={() => { setOpen(false); go('settings') }}>＋ {accounts.length ? 'Hubungkan / kelola akun' : 'Hubungkan akun'}</button>
        </div>
      )}
    </div>
  )
}

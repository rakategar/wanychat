import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, authApi, GOOGLE_URL, type User } from '../api'
import { Brand, Spinner } from '../components/ui'

export type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'
type Next = 'onboarding' | 'dashboard'
type AuthRes = { next?: Next | 'verify' | 'reset'; email?: string; notice?: string; user?: User }

// Email yang sedang diverifikasi / direset: hanya di memori tab (tidak ditaruh di URL)
const KEY = 'wany_auth_email'
const pending = {
  get: () => { try { return sessionStorage.getItem(KEY) || '' } catch { return '' } },
  set: (v: string) => { try { sessionStorage.setItem(KEY, v) } catch { /* mode privat */ } },
}
const go = (mode: AuthMode) => { window.location.hash = '/' + mode }

export default function AuthPage({ mode, error, onSignedIn }: { mode: AuthMode; error?: string; onSignedIn: (next: Next) => void }) {
  const [email, setEmail] = useState(pending.get)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState(error || '')
  useEffect(() => { setErr(error || '') }, [error])
  useEffect(() => { setNotice(''); if (!error) setErr('') }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Semua aksi memakai pola sama: kirim, tangani "next" dari server, tampilkan error di form
  const submit = async (action: string, payload: Record<string, unknown>, after?: (r: AuthRes) => void) => {
    setErr('')
    try {
      const r = await authApi<AuthRes>(action, payload)
      if (r.email) { pending.set(r.email); setEmail(r.email) }
      if (r.notice) setNotice(r.notice)
      if (r.next === 'onboarding' || r.next === 'dashboard') onSignedIn(r.next)
      else if (r.next === 'verify' && mode !== 'verify') go('verify')
      else if (r.next === 'reset' && mode !== 'reset') go('reset')
      after?.(r)
    } catch (e) {
      const data = e instanceof ApiError ? (e.data as AuthRes | undefined) : undefined
      if (data?.next === 'verify' && data.email) { pending.set(data.email); setEmail(data.email); if (mode !== 'verify') go('verify') }
      setErr((e as Error).message)
    }
  }

  const titles: Record<AuthMode, [string, string]> = {
    login: ['Masuk ke Wanychat', 'Kelola automasi Instagram & TikTok dari satu akun.'],
    register: ['Buat akun Wanychat', 'Gratis, tanpa kartu kredit. Hubungkan Instagram & TikTok setelah daftar.'],
    verify: ['Cek email kamu', email ? `Kami mengirim kode 6 digit ke ${email}.` : 'Masukkan email dan kode 6 digit yang kami kirim.'],
    forgot: ['Lupa password', 'Masukkan email akunmu. Kami kirim kode untuk membuat password baru.'],
    reset: ['Buat password baru', email ? `Masukkan kode yang dikirim ke ${email} dan password barumu.` : 'Masukkan email, kode, dan password barumu.'],
  }
  const [title, sub] = titles[mode]

  return (
    <div className="auth">
      <aside className="auth-side card tint-yellow">
        <a href="/" className="brand-link" aria-label="Wanychat, beranda"><Brand /></a>
        <div className="auth-pitch">
          <h2>Komentar masuk, balasan terkirim.</h2>
          <ul className="plan-list">
            <li>Satu akun untuk Instagram & TikTok</li>
            <li>Balas komentar & DM otomatis 24 jam</li>
            <li>Balasan AI sesuai produkmu</li>
          </ul>
        </div>
        <p className="small" style={{ margin: 0 }}>Wanychat · PT Remotin Cloud Infrastructure</p>
      </aside>

      <main className="auth-main">
        <div className="card auth-card stack">
          <div>
            <h1 className="auth-title">{title}</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>{sub}</p>
          </div>
          {err && <div className="callout pink" role="alert">{err}</div>}
          {notice && !err && <div className="callout yellow" role="status">{notice}</div>}

          {mode === 'login' && <LoginForm email={email} setEmail={setEmail} submit={submit} />}
          {mode === 'register' && <RegisterForm email={email} setEmail={setEmail} submit={submit} />}
          {mode === 'verify' && <VerifyForm email={email} setEmail={setEmail} submit={submit} />}
          {mode === 'forgot' && <ForgotForm email={email} setEmail={setEmail} submit={submit} />}
          {mode === 'reset' && <ResetForm email={email} setEmail={setEmail} submit={submit} />}

          {(mode === 'login' || mode === 'register') && (
            <>
              <div className="or"><span>atau</span></div>
              <a className="btn google-btn" href={GOOGLE_URL}><GoogleIcon /> Lanjut dengan Google</a>
            </>
          )}
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
            {mode === 'login' && <>Belum punya akun? <a href="#/register">Daftar gratis</a></>}
            {mode === 'register' && <>Sudah punya akun? <a href="#/login">Masuk</a></>}
            {(mode === 'verify' || mode === 'forgot' || mode === 'reset') && <a href="#/login">← Kembali ke halaman masuk</a>}
          </p>
        </div>
        {mode === 'register' && (
          <p className="hint" style={{ textAlign: 'center', maxWidth: 420 }}>
            Dengan mendaftar kamu menyetujui penggunaan data akun untuk menjalankan layanan Wanychat.
          </p>
        )}
      </main>
    </div>
  )
}

type FormProps = {
  email: string
  setEmail: (v: string) => void
  submit: (action: string, payload: Record<string, unknown>, after?: (r: AuthRes) => void) => Promise<void>
}

function Form({ onSubmit, children, label }: { onSubmit: () => Promise<void>; children: ReactNode; label: string }) {
  const [busy, setBusy] = useState(false)
  const handle = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try { await onSubmit() } finally { setBusy(false) }
  }
  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={handle} noValidate>
      {children}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? <Spinner /> : label}</button>
    </form>
  )
}

function EmailField({ email, setEmail, autoFocus }: { email: string; setEmail: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="field">
      <label htmlFor="auth-email">Email</label>
      <input id="auth-email" className="input" type="email" autoComplete="email" inputMode="email" required autoFocus={autoFocus}
        value={email} onChange={(e) => setEmail(e.target.value)} />
    </div>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input id={id} className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} required minLength={8} maxLength={128}
          value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}>
          {show ? 'Sembunyikan' : 'Lihat'}
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

function LoginForm({ email, setEmail, submit }: FormProps) {
  const [password, setPassword] = useState('')
  return (
    <Form label="Masuk" onSubmit={() => submit('login', { email, password })}>
      <EmailField email={email} setEmail={setEmail} autoFocus />
      <PasswordField id="auth-pw" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <a href="#/forgot" className="small" style={{ alignSelf: 'flex-end', marginTop: -6 }}>Lupa password?</a>
    </Form>
  )
}

function RegisterForm({ email, setEmail, submit }: FormProps) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [promo, setPromo] = useState(true)
  return (
    <Form label="Buat akun" onSubmit={() => submit('register', { name, email, password, marketing_opt_in: promo })}>
      <div className="field">
        <label htmlFor="auth-name">Nama</label>
        <input id="auth-name" className="input" autoComplete="name" required maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <EmailField email={email} setEmail={setEmail} />
      <PasswordField id="auth-pw" label="Password" value={password} onChange={setPassword} autoComplete="new-password" hint="Minimal 8 karakter, berisi huruf dan angka." />
      <label className="check-line small">
        <input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} />
        Kirimi saya tips & promo Wanychat lewat email (bisa berhenti kapan saja)
      </label>
    </Form>
  )
}

// Hitung mundur kirim ulang kode (server membatasi 1 kode / 60 detik)
function useCountdown(start: number) {
  const [left, setLeft] = useState(start)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return [left, setLeft] as const
}

function CodeField({ code, setCode }: { code: string; setCode: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="field">
      <label htmlFor="auth-code">Kode 6 digit</label>
      <input id="auth-code" ref={ref} className="input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
        pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    </div>
  )
}

function Resend({ email, purpose, submit }: { email: string; purpose: 'verify' | 'reset'; submit: FormProps['submit'] }) {
  const [left, setLeft] = useCountdown(60)
  const [busy, setBusy] = useState(false)
  return (
    <p className="small muted" style={{ margin: 0 }}>
      Tidak menerima email? Cek folder spam/promosi.{' '}
      {left > 0 ? <span>Kirim ulang dalam {left} dtk.</span> : (
        <button type="button" className="linklike" disabled={busy || !email}
          onClick={async () => { setBusy(true); await submit('otp.resend', { email, purpose }, () => setLeft(60)); setBusy(false) }}>
          Kirim ulang kode
        </button>
      )}
    </p>
  )
}

function VerifyForm({ email, setEmail, submit }: FormProps) {
  const [code, setCode] = useState('')
  const known = useRef(!!email).current
  return (
    <>
      <Form label="Verifikasi" onSubmit={() => submit('otp.verify', { email, code })}>
        {!known && <EmailField email={email} setEmail={setEmail} />}
        <CodeField code={code} setCode={setCode} />
      </Form>
      <Resend email={email} purpose="verify" submit={submit} />
    </>
  )
}

function ForgotForm({ email, setEmail, submit }: FormProps) {
  return (
    <Form label="Kirim kode" onSubmit={() => submit('password.forgot', { email })}>
      <EmailField email={email} setEmail={setEmail} autoFocus />
    </Form>
  )
}

function ResetForm({ email, setEmail, submit }: FormProps) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const known = useRef(!!email).current
  return (
    <>
      <Form label="Simpan password baru" onSubmit={() => submit('password.reset', { email, code, password })}>
        {!known && <EmailField email={email} setEmail={setEmail} />}
        <CodeField code={code} setCode={setCode} />
        <PasswordField id="auth-pw" label="Password baru" value={password} onChange={setPassword} autoComplete="new-password" hint="Minimal 8 karakter, berisi huruf dan angka. Semua perangkat lain akan dikeluarkan." />
      </Form>
      <Resend email={email} purpose="reset" submit={submit} />
    </>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

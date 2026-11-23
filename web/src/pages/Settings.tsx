import { useEffect, useState, type ReactNode } from 'react'
import { api, connectUrl, switchAccount, type Account, type Billing, type Me, type Profile, type SocialAccount } from '../api'
import { Confirm, Field, Spinner, Switch, useToast } from '../components/ui'
import { InstallCard } from '../components/Install'
import { CHANNEL, ChannelLogo } from '../components/Connect'

type Sub = { subscribed_fields: string[] }

export default function SettingsPage({ me, reload, logout }: { me: Me; reload: () => Promise<Me>; logout: () => void }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Akun</h1>
          <p>Profil akun Wanychat, akun Instagram & TikTok yang terhubung, dan gaya balasan AI.</p>
        </div>
      </div>
      <div className="grid two">
        <ProfileSection me={me} reload={reload} logout={logout} />
        <LinkedAccounts me={me} reload={reload} />
        {me.account && <InstagramSection key={me.account.ig_user_id} account={me.account} billing={me.billing} reload={reload} />}
        <InstallCard />
      </div>
    </>
  )
}

function ProfileSection({ me, reload, logout }: { me: Me; reload: () => Promise<Me>; logout: () => void }) {
  const toast = useToast()
  const { user } = me
  const [name, setName] = useState(user.name)
  const [promo, setPromo] = useState(user.marketing_opt_in)
  const [pw, setPw] = useState({ current: '', next: '' })
  const [busy, setBusy] = useState('')
  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label)
    try { await fn(); toast(ok) } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
  }
  return (
    <section className="card stack">
      <div className="row" style={{ flexWrap: 'nowrap', gap: 14 }}>
        {user.avatar ? <img className="avatar" style={{ width: 64, height: 64 }} src={user.avatar} alt="" referrerPolicy="no-referrer" />
          : <span className="avatar" style={{ width: 64, height: 64 }}>{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }} className="ellipsis">{user.name || 'Akun Wanychat'}</div>
          <div className="muted ellipsis">{user.email}</div>
          <div className="row small" style={{ gap: 6, marginTop: 4 }}>
            {user.email_verified && <span className="badge green">Email terverifikasi</span>}
            {user.has_google && <span className="badge">Google</span>}
            {user.has_password && <span className="badge">Password</span>}
          </div>
        </div>
      </div>
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); run('profile', async () => { await api('user.update', { name, marketing_opt_in: promo }); await reload() }, 'Profil tersimpan') }}>
        <Field label="Nama"><input className="input" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
        <Switch checked={promo} onChange={setPromo} label="Terima tips & promo Wanychat lewat email" />
        <button className="btn primary" disabled={!!busy}>{busy === 'profile' ? <Spinner /> : 'Simpan profil'}</button>
      </form>
      <hr className="rule" />
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        run('pw', async () => { await api('user.password', pw); setPw({ current: '', next: '' }); await reload() }, user.has_password ? 'Password diganti' : 'Password dibuat. Sekarang bisa masuk dengan email + password.')
      }}>
        <h3 className="card-title" style={{ margin: 0 }}>{user.has_password ? 'Ganti password' : 'Buat password'}</h3>
        {!user.has_password && <p className="small muted" style={{ margin: 0 }}>Akunmu dibuat dengan Google. Buat password supaya bisa masuk juga dengan email.</p>}
        {user.has_password && (
          <Field label="Password lama"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        )}
        <Field label="Password baru" hint="Minimal 8 karakter, berisi huruf dan angka.">
          <input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <button className="btn" disabled={!!busy || !pw.next}>{busy === 'pw' ? <Spinner /> : user.has_password ? 'Ganti password' : 'Buat password'}</button>
      </form>
      <hr className="rule" />
      <div className="row"><span className="spacer" /><button className="btn sm danger" onClick={logout}>Keluar</button></div>
    </section>
  )
}

// Akun Instagram yang sedang dibuka: status koneksi + gaya balasan AI
function InstagramSection({ account, billing, reload }: { account: Account; billing: Billing | null; reload: () => Promise<Me> }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [subs, setSubs] = useState<string[] | null>(null)
  const [statusError, setStatusError] = useState('')
  const [ai, setAi] = useState(account.ai_enabled)
  const [persona, setPersona] = useState(account.ai_persona)

  const check = async () => {
    setStatusError('')
    try {
      const r = await api<{ profile: Profile; subscriptions: Sub[] | null }>('ig.test')
      setProfile(r.profile)
      setSubs(r.subscriptions ? r.subscriptions.flatMap((s) => s.subscribed_fields) : [])
    } catch (e) {
      setStatusError((e as Error).message)
    }
  }
  useEffect(() => { check() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label)
    try { await fn(); toast(ok) } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
  }

  const connected = !statusError
  const listening = !!subs?.includes('comments') && !!subs?.includes('messages')
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null
  const canPersona = !billing || billing.plan.persona

  return (
    <>
      <section className="card stack">
        <div className="row" style={{ flexWrap: 'nowrap', gap: 14 }}>
          {account.avatar ? <img className="avatar" style={{ width: 56, height: 56 }} src={account.avatar} alt="" /> : <span className="avatar" style={{ width: 56, height: 56 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}><span className="row" style={{ gap: 8 }}><ChannelLogo type="instagram" size={22} />@{account.username}</span></div>
            <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</div>
            {profile && <div className="small"><b>{profile.followers_count?.toLocaleString('id-ID')}</b> pengikut · <b>{profile.media_count}</b> post</div>}
          </div>
        </div>

        <div>
          <Status ok={subs === null && !statusError ? null : connected} title={connected ? 'Instagram terhubung' : 'Koneksi bermasalah'}
            desc={statusError || 'Izin membaca komentar & mengirim DM aktif.'} />
          <Status ok={subs === null ? null : listening} title={listening ? 'Menerima komentar & DM' : 'Belum menerima komentar & DM'}
            desc={listening ? 'Setiap komentar baru langsung diproses.' : 'Tekan "Perbaiki" supaya komentar dan DM diteruskan ke sistem.'}
            action={subs !== null && !listening && connected ? (
              <button className="btn sm green" disabled={!!busy} onClick={() => run('sub', async () => { await api('ig.subscribe'); await check() }, 'Sudah menerima komentar & DM')}>
                {busy === 'sub' ? <Spinner /> : 'Perbaiki'}
              </button>
            ) : undefined} />
          <Status ok={!account.token_refresh_error} title="Koneksi diperpanjang otomatis"
            desc={account.token_refresh_error
              ? 'Gagal memperpanjang. Hubungkan ulang Instagram.'
              : expires ? `Aman sampai ${expires.toLocaleDateString('id-ID', { dateStyle: 'long' })}, lalu diperpanjang sendiri.` : 'Diperpanjang sendiri setiap hari.'} />
        </div>

        <div className="row">
          <button className="btn sm" disabled={!!busy} onClick={() => run('check', async () => { await check(); await reload() }, 'Status diperbarui')}>
            {busy === 'check' ? <Spinner /> : 'Periksa ulang'}
          </button>
          <a className="btn sm" href={connectUrl('instagram')}>Hubungkan ulang Instagram</a>
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2 className="card-title">Balasan AI · @{account.username}</h2>
          <p className="card-sub" style={{ margin: 0 }}>Menjawab komentar yang tidak cocok keyword di automasi yang menyalakan "Balasan AI".</p>
        </div>
        <Switch checked={ai} onChange={setAi} label={ai ? 'AI aktif' : 'AI dimatikan'} />
        <Field label="Gaya bahasa AI" hint={canPersona
          ? "Tulis seperti memberi arahan ke admin baru. Contoh: sapa dengan 'kak', maksimal 2 kalimat, jangan sebut harga."
          : <>Persona sendiri tersedia mulai paket Pro. Sekarang memakai gaya bawaan Wanychat. <a href="#/billing">Lihat paket</a></>}>
          <textarea className="input" rows={5} value={persona} disabled={!canPersona} onChange={(e) => setPersona(e.target.value)} />
        </Field>
        <button className="btn primary" disabled={!!busy} onClick={() => run('ai', async () => { await api('settings.save', canPersona ? { ai_enabled: ai, ai_persona: persona } : { ai_enabled: ai }); await reload() }, 'Pengaturan AI tersimpan')}>
          {busy === 'ai' ? <Spinner /> : 'Simpan'}
        </button>
      </section>
    </>
  )
}

function Status({ ok, title, desc, action }: { ok: boolean | null; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="check">
      <span className={'dot ' + (ok === null ? 'warn' : ok ? 'ok' : 'bad')} aria-hidden>{ok === null ? '…' : ok ? '✓' : '✕'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div className="small muted" style={{ wordBreak: 'break-word' }}>{desc}</div>
      </div>
      {action}
    </div>
  )
}

// Akun sosial milik user: batas akun paket per platform (Instagram & TikTok masing-masing), tiap akun punya dasbor sendiri
function LinkedAccounts({ me, reload }: { me: Me; reload: () => Promise<Me> }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [unlink, setUnlink] = useState<SocialAccount | null>(null)
  const { accounts, billing } = me
  const limit = billing.accounts_limit
  const freeIg = Math.max(0, limit - accounts.filter((a) => a.type === 'instagram').length)
  const freeTt = Math.max(0, limit - accounts.filter((a) => a.type === 'tiktok').length)
  return (
    <section className="card stack">
      <div>
        <h2 className="card-title">Akun sosial terhubung</h2>
        <p className="card-sub" style={{ margin: 0 }}>
          Paket {billing.plan.name}: {limit} akun Instagram + {limit} akun TikTok{limit > 1 ? ', kuota DM & AI dipakai bersama' : ''}.{' '}
          {limit < 5 && <a href="#/billing">Butuh lebih banyak?</a>}
        </p>
      </div>
      <div>
        {accounts.length === 0 && <p className="muted" style={{ margin: 0 }}>Belum ada akun terhubung.</p>}
        {accounts.map((a) => (
          <div key={a.type + a.id} className="member-row">
            {a.avatar ? <img className="avatar" src={a.avatar} alt="" /> : <span className="avatar" />}
            <div>
              <div className="ellipsis" style={{ fontWeight: 700 }}>@{a.username || a.id}</div>
              <div className="small muted">
                <ChannelLogo type={a.type} size={14} /> {CHANNEL[a.type].label}{a.current ? ' · sedang dibuka' : ''}{!a.active ? ' · tidak aktif (melebihi paket)' : ''}
                {a.token_refresh_error ? ' · perlu dihubungkan ulang' : ''}
              </div>
            </div>
            {!a.current && (
              <button className="btn sm" disabled={!!busy} onClick={async () => { setBusy(a.id); try { await switchAccount(a) } catch (e) { toast((e as Error).message, 'error'); setBusy('') } }}>
                {busy === a.id ? <Spinner /> : 'Buka'}
              </button>
            )}
            <button className="btn sm ghost" disabled={!!busy} onClick={() => setUnlink(a)}>Lepas</button>
          </div>
        ))}
      </div>
      {freeIg + freeTt > 0 ? (
        <>
          <div className="row">
            {freeIg > 0 && <a className="btn ig-btn" href={connectUrl('instagram')}><ChannelLogo type="instagram" size={20} /> Tambah Instagram</a>}
            {freeTt > 0 && <a className="btn tt-btn" href={connectUrl('tiktok')}><ChannelLogo type="tiktok" size={20} /> Tambah TikTok</a>}
          </div>
          <p className="hint" style={{ margin: 0 }}>Slot tersisa: {freeIg} Instagram, {freeTt} TikTok. Kamu akan diarahkan ke halaman izin resmi. Untuk menambah akun lain di aplikasi yang sama,
            keluar dulu dari akun yang sedang login di instagram.com / tiktok.com.</p>
        </>
      ) : <p className="hint" style={{ margin: 0 }}>Semua slot Instagram & TikTok paket ini terpakai. <a href="#/billing">Naikkan paket</a> untuk menambah akun.</p>}
      {unlink && (
        <Confirm
          title={`Lepas @${unlink.username || unlink.id}?`}
          body={<p style={{ margin: 0 }}>{unlink.type === 'tiktok'
            ? 'Izin akun TikTok ini dihapus dari Wanychat, dan semua automasi serta log aktivitasnya ikut dihapus permanen.'
            : 'Automasi akun ini berhenti dan izinnya dihapus dari Wanychat. Automasi & log tetap tersimpan dan kembali aktif kalau akun dihubungkan lagi.'}</p>}
          confirmLabel="Lepas akun"
          onCancel={() => setUnlink(null)}
          onConfirm={async () => {
            const target = unlink
            setUnlink(null)
            setBusy(target.id)
            try {
              await api('accounts.unlink', { type: target.type, id: target.id })
              toast('@' + (target.username || target.id) + ' dilepas')
              await reload()
            } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
          }}
        />
      )}
    </section>
  )
}

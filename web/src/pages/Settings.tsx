import { useEffect, useState, type ReactNode } from 'react'
import { api, LINK_URL, LOGIN_URL, switchAccount, type Account, type Billing, type Member, type Profile } from '../api'
import { Confirm, Field, Spinner, Switch, useToast } from '../components/ui'
import { InstallCard } from '../components/Install'

type Sub = { subscribed_fields: string[] }

export default function SettingsPage({ account, billing, reload, logout }: { account: Account; billing: Billing | null; reload: () => Promise<Account>; logout: () => void }) {
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
      <div className="page-head">
        <div>
          <h1>Akun</h1>
          <p>Akun Instagram yang terhubung dan gaya balasan AI.</p>
        </div>
      </div>

      <div className="grid two">
        <section className="card stack">
          <div className="row" style={{ flexWrap: 'nowrap', gap: 14 }}>
            {account.avatar ? <img className="avatar" style={{ width: 72, height: 72 }} src={account.avatar} alt="" /> : <span className="avatar" style={{ width: 72, height: 72 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>@{account.username}</div>
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
                ? 'Gagal memperpanjang. Masuk ulang dengan Instagram.'
                : expires ? `Aman sampai ${expires.toLocaleDateString('id-ID', { dateStyle: 'long' })}, lalu diperpanjang sendiri.` : 'Diperpanjang sendiri setiap hari.'} />
          </div>

          <div className="row">
            <button className="btn sm" disabled={!!busy} onClick={() => run('check', async () => { await check(); await reload() }, 'Status diperbarui')}>
              {busy === 'check' ? <Spinner /> : 'Periksa ulang'}
            </button>
            <a className="btn sm" href={LOGIN_URL}>Hubungkan ulang Instagram</a>
            <span className="spacer" />
            <button className="btn sm danger" onClick={logout}>Keluar</button>
          </div>
        </section>

        <section className="card stack">
          <div>
            <h2 className="card-title">Balasan AI</h2>
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

        <LinkedAccounts account={account} billing={billing} />

        <InstallCard />
      </div>
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

// Akun Instagram lain dalam satu langganan: tiap akun punya dasbor sendiri, kuota paket dibagi bersama
function LinkedAccounts({ account, billing }: { account: Account; billing: Billing | null }) {
  const toast = useToast()
  const [data, setData] = useState<{ accounts: Member[]; limit: number; is_owner: boolean; plan: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [unlink, setUnlink] = useState<Member | null>(null)
  const load = () => api<{ accounts: Member[]; limit: number; is_owner: boolean; plan: string }>('accounts.list').then(setData).catch(() => {})
  useEffect(() => { load() }, [account.ig_user_id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <section className="card"><Spinner /></section>
  const free = Math.max(0, data.limit - data.accounts.length)
  const canAdd = data.limit > 1 && free > 0
  return (
    <section className="card stack">
      <div>
        <h2 className="card-title">Akun Instagram di langganan ini</h2>
        <p className="card-sub" style={{ margin: 0 }}>
          {data.limit > 1
            ? <>Paket {data.plan}: {data.limit} akun, kuota DM & AI dipakai bersama. Tiap akun punya automasi dan dasbor sendiri.</>
            : <>Paket {data.plan} untuk 1 akun. Paket Pro bisa 2 akun, Bisnis 5 akun. <a href="#/billing">Lihat paket</a></>}
        </p>
      </div>
      <div>
        {data.accounts.map((m) => (
          <div key={m.ig_user_id} className="member-row">
            {m.avatar ? <img className="avatar" src={m.avatar} alt="" /> : <span className="avatar" />}
            <div>
              <div className="ellipsis" style={{ fontWeight: 700 }}>@{m.username}</div>
              <div className="small muted">
                {m.owner ? 'Pemilik langganan' : 'Akun tambahan'}{m.current ? ' · sedang dibuka' : ''}{!m.active ? ' · tidak aktif (melebihi paket)' : ''}
              </div>
            </div>
            {!m.current && (
              <button className="btn sm" disabled={!!busy} onClick={async () => { setBusy(m.ig_user_id); try { await switchAccount(m.ig_user_id) } catch (e) { toast((e as Error).message, 'error'); setBusy('') } }}>
                {busy === m.ig_user_id ? <Spinner /> : 'Buka'}
              </button>
            )}
            {!m.owner && (data.is_owner || m.current) && (
              <button className="btn sm ghost" disabled={!!busy} onClick={() => setUnlink(m)}>{m.current ? 'Keluar grup' : 'Lepas'}</button>
            )}
          </div>
        ))}
      </div>
      {canAdd && (
        <>
          <a className="btn primary" href={LINK_URL}>＋ Tambah akun Instagram ({free} slot tersisa)</a>
          <p className="hint" style={{ margin: 0 }}>Kamu akan diarahkan ke login Instagram. Masuk dengan akun yang ingin ditambahkan
            (kalau Instagram langsung memakai akun ini, pilih "Bukan kamu?" atau keluar dulu di instagram.com).</p>
        </>
      )}
      {!billing?.is_owner && billing?.owner_username && <p className="hint" style={{ margin: 0 }}>Langganan dikelola oleh @{billing.owner_username}.</p>}
      {unlink && (
        <Confirm
          title={unlink.current ? 'Keluar dari langganan grup?' : `Lepas @${unlink.username}?`}
          body={<p style={{ margin: 0 }}>@{unlink.username} jadi akun terpisah dengan paket Gratis. Automasi dan lognya tetap tersimpan. Bisa ditambahkan lagi kapan saja.</p>}
          confirmLabel={unlink.current ? 'Keluar grup' : 'Lepas akun'}
          onCancel={() => setUnlink(null)}
          onConfirm={async () => {
            const target = unlink
            setUnlink(null)
            try {
              await api('accounts.unlink', { ig_user_id: target.ig_user_id })
              toast('@' + target.username + ' dilepas')
              if (target.current) window.location.reload()
              else load()
            } catch (e) { toast((e as Error).message, 'error') }
          }}
        />
      )}
    </section>
  )
}

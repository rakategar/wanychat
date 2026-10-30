import { useEffect, useMemo, useState } from 'react'
import { api, type Account, type EventRow, type Profile, type Rule } from '../api'
import type { Page } from '../App'
import { EVENT_META, Spinner, timeAgo } from '../components/ui'

type Sub = { subscribed_fields: string[] }

export default function Dashboard({ account, go }: { account: Account; go: (p: Page) => void }) {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [subs, setSubs] = useState<string[] | null>(null)
  const [igError, setIgError] = useState('')

  useEffect(() => {
    api<{ events: EventRow[] }>('events.list', { limit: 500 }).then((r) => setEvents(r.events)).catch(() => setEvents([]))
    api<{ rules: Rule[] }>('rules.list').then((r) => setRules(r.rules)).catch(() => {})
    api<{ profile: Profile; subscriptions: Sub[] | null }>('ig.test')
      .then((r) => {
        setProfile(r.profile)
        setSubs(r.subscriptions ? r.subscriptions.flatMap((s) => s.subscribed_fields) : null)
      })
      .catch((e) => setIgError(e.message))
  }, [])

  const stats = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const today = (events || []).filter((e) => new Date(e.createdAt) >= start)
    const n = (fn: (e: EventRow) => boolean) => today.filter(fn).length
    return {
      comments: n((e) => e.type === 'comment_in'),
      dms: n((e) => (e.type === 'private_reply' || e.type === 'dm_out' || e.type === 'followup') && e.status === 'ok'),
      taps: n((e) => e.type === 'button_tap'),
      ai: n((e) => e.type === 'ai_reply' && e.status === 'ok'),
      errors: n((e) => e.status === 'error'),
    }
  }, [events])

  const activeRules = rules.filter((r) => r.active).length
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null
  const daysLeft = expires ? Math.round((expires.getTime() - Date.now()) / 86400000) : null
  const hasComments = subs?.includes('comments')

  const checks: { ok: 'ok' | 'bad' | 'warn'; title: string; desc: string; action?: Page }[] = [
    !igError
      ? { ok: 'ok', title: 'Instagram terhubung', desc: `@${account.username}` }
      : { ok: 'bad', title: 'Koneksi Instagram bermasalah', desc: igError, action: 'settings' },
    subs === null
      ? { ok: 'warn', title: 'Memeriksa koneksi…', desc: 'Sebentar ya.' }
      : hasComments
        ? { ok: 'ok', title: 'Menerima komentar & DM', desc: 'Komentar baru langsung diproses.' }
        : { ok: 'bad', title: 'Belum menerima komentar', desc: 'Buka halaman Akun lalu tekan "Perbaiki".', action: 'settings' },
    activeRules
      ? { ok: 'ok', title: `${activeRules} automasi aktif`, desc: `${rules.length} total automasi` }
      : { ok: 'warn', title: 'Belum ada automasi aktif', desc: 'Buat automasi pertama kamu.', action: 'automations' },
    daysLeft === null
      ? { ok: 'ok', title: 'Koneksi diperpanjang otomatis', desc: 'Tidak perlu login ulang.' }
      : daysLeft > 3 && !account.token_refresh_error
        ? { ok: 'ok', title: 'Koneksi diperpanjang otomatis', desc: `Aman ${daysLeft} hari ke depan, lalu diperpanjang sendiri.` }
        : { ok: 'bad', title: 'Koneksi hampir habis', desc: 'Masuk ulang dengan Instagram di halaman Akun.', action: 'settings' },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Halo{profile?.name ? `, ${profile.name.split(/[|·-]/)[0].trim()}` : ''} 👋</h1>
          <p>Ringkasan auto-reply komentar & DM Instagram hari ini.</p>
        </div>
        <button className="btn primary" onClick={() => go('automations')}>+ Automasi baru</button>
      </div>

      <div className="grid stats" style={{ marginBottom: 24 }}>
        <Stat n={stats.comments} label="Komentar masuk" tint="blue" loading={!events} />
        <Stat n={stats.dms} label="DM terkirim" tint="pink" loading={!events} />
        <Stat n={stats.taps} label="Tombol ditekan" tint="yellow" loading={!events} />
        <Stat n={stats.ai} label="Balasan AI" tint="green" loading={!events} />
        <Stat n={stats.errors} label="Error" tint={stats.errors ? 'pink' : ''} loading={!events} />
      </div>

      <div className="grid two">
        <section className="card">
          <h2 className="card-title">Status sistem</h2>
          <p className="card-sub">Semua harus hijau supaya auto-reply jalan.</p>
          {checks.map((c) => (
            <div className="check" key={c.title}>
              <span className={'dot ' + c.ok} aria-hidden>{c.ok === 'ok' ? '✓' : c.ok === 'bad' ? '✕' : '!'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{c.title}</div>
                <div className="small muted" style={{ wordBreak: 'break-word' }}>{c.desc}</div>
              </div>
              {c.action && c.ok !== 'ok' && <button className="btn sm" onClick={() => go(c.action!)}>Perbaiki</button>}
            </div>
          ))}
        </section>

        <section className="card">
          <div className="row between">
            <h2 className="card-title">Aktivitas terbaru</h2>
            <button className="btn sm" onClick={() => go('activity')}>Lihat semua</button>
          </div>
          {!events ? <Spinner /> : events.length === 0 ? (
            <p className="muted">Belum ada aktivitas. Komentar & DM yang masuk akan muncul di sini.</p>
          ) : (
            <div className="feed">
              {events.slice(0, 7).map((e) => {
                const m = EVENT_META[e.type] || { label: e.type, color: '', icon: '•' }
                return (
                  <div key={e.id} className="row" style={{ padding: '8px 0', borderBottom: '2px solid rgba(17,17,17,.1)', flexWrap: 'nowrap' }}>
                    <span aria-hidden>{m.icon}</span>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b>{e.username ? '@' + e.username : m.label}</b> <span className="muted">{e.text}</span>
                    </div>
                    {e.status === 'error' && <span className="badge red">error</span>}
                    <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{timeAgo(e.createdAt)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="card tint-purple" style={{ gridColumn: '1 / -1' }}>
          <h2 className="card-title">Cara kerjanya (seperti ManyChat)</h2>
          <div className="grid stats" style={{ marginTop: 12 }}>
            <HowStep n={1} title="Orang komentar keyword" desc="Siapa saja, walau belum pernah DM akunmu." />
            <HowStep n={2} title="Balas komentar + DM pertama" desc="Private reply: 1 DM per komentar, maksimal 7 hari setelah komentar." />
            <HowStep n={3} title="Dia tekan tombol" desc="Ini membuka jendela chat 24 jam." />
            <HowStep n={4} title="Kirim link & follow-up" desc="Pesan lanjutan hanya bisa dikirim di dalam jendela 24 jam itu." />
          </div>
        </section>
      </div>
    </>
  )
}

function Stat({ n, label, tint, loading }: { n: number; label: string; tint: string; loading: boolean }) {
  return (
    <div className={'card stat ' + (tint ? 'tint-' + tint : '')}>
      <div className="num">{loading ? '–' : n}</div>
      <div className="lbl">{label}</div>
    </div>
  )
}

function HowStep({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="card" style={{ padding: 14, boxShadow: 'var(--shadow-sm)' }}>
      <span className="step-num" style={{ marginBottom: 8 }}>{n}</span>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div className="small muted">{desc}</div>
    </div>
  )
}

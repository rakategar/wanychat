import { useCallback, useEffect, useState } from 'react'
import { api, type EventRow, type Followup } from '../api'
import { Confirm, EVENT_META, Empty, Segmented, Spinner, timeAgo, useToast } from '../components/ui'

type Tab = 'events' | 'followups'
const FILTERS: { id: string; label: string; match: (e: EventRow) => boolean }[] = [
  { id: 'all', label: 'Semua', match: () => true },
  { id: 'in', label: 'Masuk', match: (e) => ['comment_in', 'dm_in', 'button_tap'].includes(e.type) },
  { id: 'out', label: 'Terkirim', match: (e) => ['comment_reply', 'private_reply', 'dm_out', 'ai_reply', 'followup'].includes(e.type) },
  { id: 'error', label: 'Error', match: (e) => e.status === 'error' },
]
const FU_COLOR: Record<string, string> = { pending: 'yellow', sent: 'green', expired: '', error: 'red' }

export default function Activity() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('events')
  const [filter, setFilter] = useState('all')
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [followups, setFollowups] = useState<Followup[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ev, fu] = await Promise.all([
        api<{ events: EventRow[] }>('events.list', { limit: 300 }),
        api<{ followups: Followup[] }>('followups.list'),
      ])
      setEvents(ev.events)
      setFollowups(fu.followups)
    } catch (e) {
      toast((e as Error).message, 'error')
      setEvents((x) => x || [])
      setFollowups((x) => x || [])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  const shown = (events || []).filter(FILTERS.find((f) => f.id === filter)!.match)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Aktivitas</h1>
          <p>Semua komentar, DM, dan balasan yang diproses. Diperbarui otomatis setiap 20 detik.</p>
        </div>
        <div className="row">
          <button className="btn sm danger" onClick={() => setClearing(true)}>Bersihkan log</button>
          <button className="btn" onClick={load} disabled={loading}>{loading ? <Spinner /> : '↻ Muat ulang'}</button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'events', label: '📜 Log' }, { value: 'followups', label: '⏰ Follow-up' }]} />
        {tab === 'events' && (
          <div className="row" style={{ gap: 6 }}>
            {FILTERS.map((f) => (
              <button key={f.id} className={'chip' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
        )}
      </div>

      <section className="card">
        {tab === 'events' ? (
          !events ? <Spinner /> : shown.length === 0 ? (
            <Empty icon="📭" title="Belum ada aktivitas">Komentar di post yang punya automasi aktif akan tercatat di sini.</Empty>
          ) : (
            <div className="feed">
              {shown.map((e) => {
                const m = EVENT_META[e.type] || { label: e.type, color: '', icon: '•' }
                return (
                  <div className="feed-item" key={e.id}>
                    <div>
                      <span className={'badge ' + m.color}>{m.icon} {m.label}</span>
                      <div className="meta" style={{ marginTop: 4 }} title={new Date(e.createdAt).toLocaleString('id-ID')}>{timeAgo(e.createdAt)}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="small">
                        {e.username ? <b>@{e.username}</b> : <span className="mono muted">{e.ig_user_id || '-'}</span>}
                        {e.rule_name && <span className="muted"> · {e.rule_name}</span>}
                      </div>
                      {e.text && <div className="text">{e.text}</div>}
                      {e.error && <div className="err">⚠ {e.error}</div>}
                    </div>
                    <span className={'badge ' + (e.status === 'error' ? 'red' : e.status === 'skipped' ? '' : 'green')}>{e.status}</span>
                  </div>
                )
              })}
            </div>
          )
        ) : !followups ? <Spinner /> : followups.length === 0 ? (
          <Empty icon="⏰" title="Belum ada follow-up">Follow-up dijadwalkan setelah DM pertama terkirim di automasi yang mengaktifkan follow-up.</Empty>
        ) : (
          <div className="feed">
            {followups.map((f) => (
              <div className="feed-item" key={f.id}>
                <div>
                  <span className={'badge ' + FU_COLOR[f.status]}>{f.status}</span>
                  <div className="meta" style={{ marginTop: 4 }}>{f.status === 'sent' ? 'terkirim ' + timeAgo(f.sent_at) : 'jadwal ' + timeAgo(f.due_at)}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="small">{f.username ? <b>@{f.username}</b> : <span className="mono">{f.ig_user_id}</span>}</div>
                  <div className="text">{f.message}</div>
                  {f.error && <div className="err">⚠ {f.error}</div>}
                </div>
                <span />
              </div>
            ))}
          </div>
        )}
      </section>

      {clearing && (
        <Confirm
          title="Bersihkan semua log?"
          body="Semua log aktivitas dan antrean follow-up akan dihapus permanen. Automasi tidak terpengaruh."
          confirmLabel="Hapus semua"
          onCancel={() => setClearing(false)}
          onConfirm={async () => {
            setClearing(false)
            try { await api('logs.clear'); toast('Log dibersihkan'); load() } catch (e) { toast((e as Error).message, 'error') }
          }}
        />
      )}
    </>
  )
}

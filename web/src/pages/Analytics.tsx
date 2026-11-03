import { useEffect, useMemo, useState } from 'react'
import { api, type Analytics, type Billing, type Media } from '../api'
import type { Page } from '../App'
import { Empty, Segmented, Spinner, timeAgo, useToast } from '../components/ui'
import { fmt } from '../plans'

type Range = '7' | '30' | '90'
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

export default function AnalyticsPage({ billing, go }: { billing: Billing | null; go: (p: Page) => void }) {
  const toast = useToast()
  const allowed = !!billing?.plan.analytics
  const [range, setRange] = useState<Range>('30')
  const [data, setData] = useState<Analytics | null>(null)
  const [media, setMedia] = useState<Record<string, Media>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!allowed) return
    setLoading(true)
    api<Analytics & { ok: boolean }>('analytics.get', { days: Number(range) })
      .then(setData)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [allowed, range, toast])

  // Thumbnail & caption postingan dari Instagram (sekali saja)
  useEffect(() => {
    if (!allowed) return
    api<{ media: Media[] }>('ig.media', { limit: 50 })
      .then((r) => setMedia(Object.fromEntries(r.media.map((m) => [m.id, m]))))
      .catch(() => {})
  }, [allowed])

  const head = (
    <div className="page-head">
      <div>
        <h1>Analitik</h1>
        <p>Dari mana lead datang: postingan, automasi, dan jam paling ramai.</p>
      </div>
      {allowed && <Segmented value={range} onChange={setRange} options={[{ value: '7', label: '7 hari' }, { value: '30', label: '30 hari' }, { value: '90', label: '90 hari' }]} />}
    </div>
  )

  if (!allowed) {
    return (
      <>
        {head}
        <div className="locked">
          <div className="locked-overlay">
            <div className="card stack">
              <div style={{ fontSize: 36 }} aria-hidden>📊</div>
              <h2 className="card-title" style={{ margin: 0 }}>Analitik lead ada di paket Bisnis</h2>
              <p className="muted" style={{ margin: 0 }}>Lihat postingan mana yang paling banyak menghasilkan lead, automasi yang paling sering ditekan, jam komentar paling ramai, dan daftar lead terpanas yang bisa diunduh.</p>
              <button className="btn dark" onClick={() => go('billing')}>Lihat paket Bisnis</button>
            </div>
          </div>
          <div className="locked-preview" aria-hidden><Report data={SAMPLE} media={{}} /></div>
        </div>
      </>
    )
  }

  return (
    <>
      {head}
      {!data || loading ? <Spinner /> : data.events === 0
        ? <Empty icon="📊" title="Belum ada data">Analitik muncul setelah ada komentar atau DM yang diproses dalam {data.days} hari terakhir.</Empty>
        : <Report data={data} media={media} />}
    </>
  )
}

function Report({ data, media }: { data: Analytics; media: Record<string, Media> }) {
  const t = data.totals
  const max = Math.max(1, ...data.funnel.map((f) => f.value))
  return (
    <>
      <div className="kpis">
        <Kpi label="Lead" value={t.leads} sub={`${fmt(t.commenters)} orang berkomentar`} tint="tint-yellow" />
        <Kpi label="Komentar" value={t.comments} sub={`${t.match_rate}% cocok automasi`} />
        <Kpi label="DM terkirim" value={t.dms} sub={`${fmt(t.followups)} follow-up`} />
        <Kpi label="Tombol ditekan" value={t.taps} sub={`${t.tap_rate}% dari DM`} tint="tint-green" />
        <Kpi label="DM masuk" value={t.dm_in} sub={`${fmt(t.ai)} balasan AI`} />
      </div>

      <div className="grid two">
        <section className="card stack">
          <h2 className="card-title">Corong lead</h2>
          <div className="funnel">
            {data.funnel.map((f) => (
              <div key={f.key} className="funnel-row">
                <span>{f.label}</span>
                <div className="funnel-bar"><span style={{ width: `${(f.value / max) * 100}%` }} /></div>
                <b>{fmt(f.value)}</b>
              </div>
            ))}
          </div>
          {t.quota > 0 && <p className="hint" style={{ margin: 0 }}>{fmt(t.quota)} pesan tidak terkirim karena kuota habis.</p>}
        </section>
        <Trend data={data} />
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2 className="card-title">Postingan penghasil lead</h2>
        {data.posts.length === 0 ? <p className="muted">Belum ada komentar di postingan.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Postingan</th><th>Komentar</th><th>Lead</th><th>DM</th><th>Tombol</th><th>Rasio tombol</th></tr></thead>
              <tbody>
                {data.posts.map((p) => {
                  const m = media[p.media_id]
                  const thumb = m?.thumbnail_url || m?.media_url
                  return (
                    <tr key={p.media_id}>
                      <td>
                        <a className="post-cell" href={m?.permalink || undefined} target="_blank" rel="noreferrer">
                          {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="ph" />}
                          <div className="ellipsis">{m?.caption?.slice(0, 80) || <span className="mono">{p.media_id}</span>}</div>
                        </a>
                      </td>
                      <td>{fmt(p.comments)}</td>
                      <td><b>{fmt(p.leads)}</b></td>
                      <td>{fmt(p.dms)}</td>
                      <td>{fmt(p.taps)}</td>
                      <td>{p.dms ? p.tap_rate + '%' : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid two" style={{ marginTop: 20 }}>
        <section className="card">
          <h2 className="card-title">Automasi</h2>
          {data.rules.length === 0 ? <p className="muted">Belum ada automasi yang terpicu.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Automasi</th><th>Terpicu</th><th>DM</th><th>Tombol</th><th>Follow-up</th></tr></thead>
                <tbody>
                  {data.rules.map((r) => (
                    <tr key={r.rule_id}><td>{r.name || '#' + r.rule_id}</td><td>{fmt(r.matched)}</td><td>{fmt(r.dms)}</td>
                      <td>{fmt(r.taps)}{r.dms ? <span className="muted small"> ({r.tap_rate}%)</span> : null}</td><td>{fmt(r.followups)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card stack">
          <h2 className="card-title">Jam komentar paling ramai (WIB)</h2>
          <Heat hours={data.hours} />
          {data.words.length > 0 && (
            <>
              <h3 style={{ margin: '8px 0 0', fontSize: 15 }}>Kata yang sering muncul</h3>
              <div className="words">{data.words.map((w) => <span key={w.word} className="badge">{w.word} · {w.count}</span>)}</div>
            </>
          )}
        </section>
      </div>

      <Leads data={data} media={media} />
      {data.truncated && <p className="hint">Hanya 20.000 aktivitas terbaru yang dihitung.</p>}
      <p className="hint">Data dari log aktivitas. Menghapus log di menu Aktivitas juga menghapus data analitik.</p>
    </>
  )
}

function Kpi({ label, value, sub, tint = '' }: { label: string; value: number; sub: string; tint?: string }) {
  return (
    <div className={'card kpi ' + tint}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{fmt(value)}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

function Trend({ data }: { data: Analytics }) {
  const max = Math.max(1, ...data.series.map((d) => Math.max(d.comments, d.leads)))
  const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
  return (
    <section className="card stack">
      <h2 className="card-title">Tren harian</h2>
      <div className="legend"><span><i style={{ background: 'var(--blue)' }} />Komentar</span><span><i style={{ background: 'var(--yellow)' }} />Lead</span></div>
      <div className="trend" role="img" aria-label="Grafik komentar dan lead per hari">
        {data.series.map((d) => (
          <div key={d.date} className="trend-col" title={`${short(d.date)}: ${d.comments} komentar, ${d.leads} lead`}>
            <span className="lead" style={{ height: `${(d.leads / max) * 100}%` }} />
            <span style={{ height: `${(Math.max(0, d.comments - d.leads) / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="trend-axis"><span>{short(data.series[0]?.date || '')}</span><span>{short(data.series[data.series.length - 1]?.date || '')}</span></div>
    </section>
  )
}

function Heat({ hours }: { hours: number[][] }) {
  const max = Math.max(1, ...hours.flat())
  return (
    <div className="heat" role="img" aria-label="Sebaran komentar per hari dan jam">
      <span className="lbl" />
      {Array.from({ length: 24 }, (_, h) => <span key={h} className="lbl" style={{ justifyContent: 'center' }}>{h % 6 === 0 ? h : ''}</span>)}
      {hours.map((row, d) => [
        <span key={'l' + d} className="lbl">{DAYS[d]}</span>,
        ...row.map((v, h) => (
          <div key={d + '-' + h} title={`${DAYS[d]} ${h}.00: ${v} komentar`}
            style={{ background: v ? `rgba(255, 143, 171, ${0.2 + (v / max) * 0.8})` : 'rgba(17,17,17,.06)' }} />
        )),
      ])}
    </div>
  )
}

function Leads({ data, media }: { data: Analytics; media: Record<string, Media> }) {
  const [all, setAll] = useState(false)
  const rows = all ? data.leads : data.leads.slice(0, 15)
  const csv = useMemo(() => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [['username', 'skor', 'komentar', 'tombol', 'dm_masuk', 'postingan', 'pertama', 'terakhir', 'pesan_terakhir'].join(',')]
    for (const l of data.leads) {
      lines.push([l.username, l.score, l.comments, l.taps, l.dms_in, l.posts.map((p) => media[p]?.permalink || p).join(' '), l.first_at, l.last_at, l.last_text].map(esc).join(','))
    }
    return lines.join('\n')
  }, [data, media])
  const download = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `lead-wanychat-${data.days}hari.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="row between">
        <h2 className="card-title" style={{ margin: 0 }}>Lead terpanas</h2>
        {data.leads.length > 0 && <button className="btn sm" onClick={download}>Unduh CSV</button>}
      </div>
      <p className="card-sub">Skor: komentar 1, DM masuk 2, cocok automasi 2, tekan tombol 3. Hubungi yang skornya tinggi duluan.</p>
      {data.leads.length === 0 ? <p className="muted">Belum ada lead.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Akun</th><th>Skor</th><th>Interaksi</th><th>Pesan terakhir</th><th>Terakhir aktif</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.ig_user_id}>
                  <td>{l.username ? <a href={`https://instagram.com/${l.username}`} target="_blank" rel="noreferrer">@{l.username}</a> : <span className="mono">{l.ig_user_id}</span>}</td>
                  <td><span className={'badge ' + (l.score >= 6 ? 'pink' : l.score >= 3 ? 'yellow' : '')}>{l.score}</span></td>
                  <td className="small">{l.comments} komentar · {l.taps} tombol · {l.dms_in} DM</td>
                  <td className="small" style={{ maxWidth: 280 }}>{l.last_text || '-'}</td>
                  <td className="small">{timeAgo(l.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.leads.length > 15 && <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>{all ? 'Tampilkan lebih sedikit' : `Tampilkan semua (${data.leads.length})`}</button>}
    </section>
  )
}

// Contoh data untuk pratinjau terkunci (paket selain Bisnis)
const SAMPLE: Analytics = {
  days: 30, since: '', events: 1, truncated: false,
  totals: { comments: 1240, matched: 610, dms: 598, taps: 377, followups: 140, ai: 210, dm_in: 260, errors: 0, quota: 0, leads: 702, commenters: 980, match_rate: 49.2, tap_rate: 63 },
  funnel: [
    { key: 'comments', label: 'Komentar masuk', value: 1240 }, { key: 'matched', label: 'Cocok automasi', value: 610 },
    { key: 'dms', label: 'DM terkirim', value: 598 }, { key: 'taps', label: 'Tombol ditekan', value: 377 }, { key: 'followups', label: 'Follow-up terkirim', value: 140 },
  ],
  series: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10), comments: 20 + ((i * 37) % 40), leads: 10 + ((i * 23) % 25), dms: 0, taps: 0 })),
  posts: [
    { media_id: 'a', comments: 520, commenters: 410, matched: 300, dms: 296, taps: 201, ai: 40, leads: 330, tap_rate: 68 },
    { media_id: 'b', comments: 310, commenters: 260, matched: 150, dms: 148, taps: 80, ai: 30, leads: 170, tap_rate: 54 },
  ],
  rules: [{ rule_id: '1', name: 'Info harga', matched: 400, dms: 390, taps: 260, followups: 90, ai: 0, tap_rate: 67 }],
  hours: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h >= 19 && h <= 22 ? 8 + d : h >= 11 && h <= 13 ? 4 : 1))),
  words: [{ word: 'harga', count: 210 }, { word: 'info', count: 180 }, { word: 'ready', count: 75 }],
  leads: [{ ig_user_id: '1', username: 'pelanggan_setia', score: 9, comments: 2, taps: 1, dms_in: 1, posts: [], first_at: '', last_at: new Date().toISOString(), last_text: 'kak mau order 2' }],
}

import { useCallback, useEffect, useState } from 'react'
import { api, connectUrl, type SocialAccount, type TikTokAccount } from '../api'
import { Confirm, Empty, Spinner, timeAgo, useToast } from '../components/ui'
import { compact, ttDate, TT_SCOPES, type TtComment, type TtProfile, type TtVideo } from '../tiktok'

// Kanal TikTok: hubungkan akun lewat halaman izin TikTok, lalu kelola komentar video dari Wanychat.
export default function TikTokPage({ tiktok, accounts }: { tiktok: TikTokAccount | null; accounts: SocialAccount[] }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>TikTok</h1>
          <p>Lihat video, baca & balas komentar, dan sembunyikan spam akun TikTok kamu.</p>
        </div>
      </div>
      {tiktok ? <Connected key={tiktok.open_id} tiktok={tiktok} /> : <Connect full={accounts.length > 0} />}
    </>
  )
}

function Connect({ full }: { full: boolean }) {
  return (
    <div className="grid two">
      <section className="card stack tint-yellow">
        <h3 className="card-title">Hubungkan akun TikTok</h3>
        <p style={{ margin: 0 }}>
          Kamu masuk di halaman izin resmi TikTok dan memilih sendiri izin yang diberikan. Wanychat tidak pernah melihat password TikTok kamu,
          dan akses bisa dicabut kapan saja dari menu Akun.
        </p>
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Tekan tombol di bawah, lalu masuk ke akun TikTok kamu.</li>
          <li>Setujui izin yang diminta.</li>
          <li>Video dan komentarmu langsung tampil di sini.</li>
        </ol>
        <div><a className="btn dark" href={connectUrl('tiktok')}>🎵 Hubungkan TikTok</a></div>
        {full && <p className="hint" style={{ margin: 0 }}>Kuota akun paket dihitung gabungan Instagram + TikTok. Cek slot di menu Akun.</p>}
      </section>
      <section className="card stack">
        <h3 className="card-title">Izin yang diminta</h3>
        <ul className="tt-scopes">
          {TT_SCOPES.map((s) => (
            <li key={s.scope}>
              <b>{s.label}</b> <code className="small">{s.scope}</code>
              <div className="small muted">{s.why}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Connected({ tiktok }: { tiktok: TikTokAccount }) {
  const toast = useToast()
  const [profile, setProfile] = useState<TtProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [videos, setVideos] = useState<TtVideo[] | null>(null)
  const [cursor, setCursor] = useState('')
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [video, setVideo] = useState<TtVideo | null>(null)

  useEffect(() => {
    api<{ profile: TtProfile | null; profile_error: string }>('tiktok.status')
      .then((r) => { setProfile(r.profile); setProfileError(r.profile_error) })
      .catch((e) => setProfileError(e.message))
    api<{ videos: TtVideo[]; cursor: string; has_more: boolean }>('tiktok.videos')
      .then((r) => { setVideos(r.videos); setCursor(r.cursor); setMore(r.has_more) })
      .catch((e) => { setVideos([]); toast(e.message, 'error') })
  }, [toast])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const r = await api<{ videos: TtVideo[]; cursor: string; has_more: boolean }>('tiktok.videos', { cursor })
      setVideos((v) => [...(v || []), ...r.videos]); setCursor(r.cursor); setMore(r.has_more)
    } catch (e) { toast((e as Error).message, 'error') } finally { setLoadingMore(false) }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card tt-profile">
        <div className="row" style={{ flexWrap: 'nowrap', gap: 14 }}>
          {(profile?.profile_image || tiktok.avatar) ? <img className="avatar" style={{ width: 64, height: 64 }} src={profile?.profile_image || tiktok.avatar} alt="" />
            : <span className="avatar" style={{ width: 64, height: 64 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }} className="ellipsis">@{profile?.username || tiktok.username}</div>
            <div className="muted small ellipsis">{profile?.display_name || tiktok.display_name}</div>
            {profile && (
              <div className="row small" style={{ gap: 14, marginTop: 4 }}>
                <span><b>{compact(profile.followers_count)}</b> pengikut</span>
                <span><b>{compact(profile.total_likes)}</b> suka</span>
                <span><b>{compact(profile.videos_count)}</b> video</span>
              </div>
            )}
          </div>
        </div>
        <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          {profileError || tiktok.token_refresh_error
            ? <><span className="badge orange">Perlu dihubungkan ulang</span><a className="btn sm" href={connectUrl('tiktok')}>Hubungkan ulang</a></>
            : <span className="badge green">● Terhubung · diperpanjang otomatis</span>}
          <span className="small muted">Terhubung {timeAgo(tiktok.connected_at)}</span>
        </div>
      </section>

      <section className="callout yellow small" style={{ margin: 0 }}>
        ⚡ Automasi TikTok (keyword → balas komentar otomatis, balasan AI, sembunyikan spam otomatis) sedang disiapkan. Sementara ini, balas & sembunyikan komentar dari sini.
      </section>

      <div className="tt-layout">
        <section className="card stack">
          <h2 className="card-title" style={{ margin: 0 }}>Video</h2>
          {!videos ? <Spinner /> : videos.length === 0 ? <p className="muted" style={{ margin: 0 }}>Belum ada video.</p> : (
            <div className="tt-videos">
              {videos.map((v) => (
                <button key={v.item_id} className={'tt-video' + (video?.item_id === v.item_id ? ' on' : '')} onClick={() => setVideo(v)}>
                  {v.thumbnail_url ? <img className="tt-cover" src={v.thumbnail_url} alt="" loading="lazy" /> : <span className="tt-cover" aria-hidden>🎬</span>}
                  <span className="small ellipsis" style={{ display: 'block', textAlign: 'left' }}>{v.caption || 'Tanpa caption'}</span>
                  <span className="small muted">▶ {compact(v.video_views)} · 💬 {compact(v.comments)}</span>
                </button>
              ))}
            </div>
          )}
          {more && <button className="btn sm" disabled={loadingMore} onClick={loadMore}>{loadingMore ? <Spinner /> : 'Muat lebih banyak'}</button>}
        </section>
        <section className="card stack">
          {video ? <Comments key={video.item_id} video={video} /> : <Empty icon="💬" title="Pilih video">Komentar video yang dipilih tampil di sini.</Empty>}
        </section>
      </div>
    </div>
  )
}

function Comments({ video }: { video: TtVideo }) {
  const toast = useToast()
  const [list, setList] = useState<TtComment[] | null>(null)
  const [cursor, setCursor] = useState('')
  const [more, setMore] = useState(false)
  const [replying, setReplying] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [hiding, setHiding] = useState<TtComment | null>(null)

  const load = useCallback(async (next?: string) => {
    const r = await api<{ comments: TtComment[]; cursor: string; has_more: boolean }>('tiktok.comments', { video_id: video.item_id, cursor: next || '' })
    setList((l) => (next ? [...(l || []), ...r.comments] : r.comments)); setCursor(r.cursor); setMore(r.has_more)
  }, [video.item_id])
  useEffect(() => { load().catch((e) => { setList([]); toast(e.message, 'error') }) }, [load, toast])

  const send = async (c: TtComment) => {
    setBusy(c.comment_id)
    try {
      await api('tiktok.reply', { video_id: video.item_id, comment_id: c.comment_id, text })
      toast('Balasan terkirim')
      setReplying(''); setText('')
      await load()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
  }
  const setHidden = async (c: TtComment, hide: boolean) => {
    setBusy(c.comment_id)
    try {
      await api('tiktok.hide', { video_id: video.item_id, comment_id: c.comment_id, hide })
      setList((l) => l && l.map((x) => (x.comment_id === c.comment_id ? { ...x, status: hide ? 'HIDDEN' : 'PUBLIC' } : x)))
      toast(hide ? 'Komentar disembunyikan' : 'Komentar ditampilkan lagi')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
  }

  return (
    <>
      <div className="row between">
        <h2 className="card-title ellipsis" style={{ margin: 0, minWidth: 0 }}>Komentar</h2>
        {video.share_url && <a className="small" href={video.share_url} target="_blank" rel="noreferrer">Buka di TikTok ↗</a>}
      </div>
      {!list ? <Spinner /> : list.length === 0 ? <p className="muted" style={{ margin: 0 }}>Belum ada komentar di video ini.</p> : (
        <div className="stack" style={{ gap: 10 }}>
          {list.map((c) => {
            const hidden = String(c.status || '').toUpperCase() === 'HIDDEN'
            return (
              <article key={c.comment_id} className={'tt-comment' + (hidden ? ' hidden' : '')}>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 10 }}>
                  {c.profile_image ? <img className="avatar" src={c.profile_image} alt="" /> : <span className="avatar" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small"><b>{c.display_name || c.username || 'Pengguna TikTok'}</b>{c.owner && <span className="badge" style={{ marginLeft: 6 }}>kamu</span>}
                      <span className="muted"> · {timeAgo(ttDate(c.create_time))}</span>{hidden && <span className="badge orange" style={{ marginLeft: 6 }}>disembunyikan</span>}</div>
                    <p style={{ margin: '2px 0 0', wordBreak: 'break-word' }}>{c.text}</p>
                    <div className="small muted">❤ {compact(c.likes)}{c.replies ? ` · ${c.replies} balasan` : ''}</div>
                  </div>
                </div>
                {!c.owner && (
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <button className="btn sm" disabled={!!busy || hidden} onClick={() => { setReplying(replying === c.comment_id ? '' : c.comment_id); setText('') }}>Balas</button>
                    <button className="btn sm ghost" disabled={!!busy} onClick={() => (hidden ? setHidden(c, false) : setHiding(c))}>
                      {busy === c.comment_id ? <Spinner /> : hidden ? 'Tampilkan' : 'Sembunyikan'}
                    </button>
                  </div>
                )}
                {replying === c.comment_id && (
                  <form className="tt-reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(c) }}>
                    <input className="input" autoFocus maxLength={150} placeholder={'Balas ' + (c.username ? '@' + c.username : 'komentar') + '…'} value={text} onChange={(e) => setText(e.target.value)} />
                    <button className="btn sm primary" disabled={!text.trim() || busy === c.comment_id}>{busy === c.comment_id ? <Spinner /> : 'Kirim'}</button>
                  </form>
                )}
              </article>
            )
          })}
          {more && <button className="btn sm" onClick={() => load(cursor).catch((e) => toast(e.message, 'error'))}>Muat lebih banyak</button>}
        </div>
      )}
      {hiding && (
        <Confirm title="Sembunyikan komentar?" tone="primary"
          body="Komentar tidak terlihat oleh orang lain di TikTok (penulisnya tetap bisa melihat). Bisa ditampilkan lagi kapan saja."
          confirmLabel="Sembunyikan" onCancel={() => setHiding(null)} onConfirm={() => { const c = hiding; setHiding(null); setHidden(c, true) }} />
      )}
    </>
  )
}

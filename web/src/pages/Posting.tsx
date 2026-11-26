import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, channelPref, emptyRule, emptyTtRule, type Me, type MatchMode, type Rule } from '../api'
import { ChannelLogo, CHANNEL } from '../components/Connect'
import { Confirm, Empty, Field, Segmented, Spinner, Switch, timeAgo, useToast } from '../components/ui'
import {
  captionStats, checkTarget, faststart, fmtMb, inspectMp4, planImage, postApi, publishAuthUrl, sniffFile, toJpeg, uploadPut,
  POST_LABEL, TARGET_LABEL, type CheckItem, type Destination, type Mp4Info, type Platform, type PostConfig, type PostTarget, type PostView, type TtOptions,
} from '../posting'

// Posting multi-platform: satu konten -> beberapa akun Instagram & TikTok sekaligus.
// #/posting = tulis posting + riwayat; #/posting?post=<id> = status per akun, lalu langsung diarahkan ke automasi postingan itu.
export default function PostingPage({ me, params, reload }: { me: Me; params: URLSearchParams; reload: () => Promise<unknown> }) {
  const postId = params.get('post') || ''
  return postId ? <PostStatusView key={postId} postId={postId} me={me} reload={reload} /> : <Composer />
}

const key = (d: { type: Platform; id: string }) => d.type + ':' + d.id
const openPost = (id: string) => { window.location.hash = '/posting?post=' + encodeURIComponent(id); window.scrollTo(0, 0) }

// ---------------------------------------------------------------- tulis posting
interface Item {
  uid: string
  file: File
  preview: string
  kind: 'image' | 'video'
  mime: string
  width: number
  height: number
  duration: number
  fps: number
  video_codec: string
  audio_codec: string
  mp4?: Mp4Info
  error: string
  uploaded?: { media_id: string; fitIg: boolean }
}

const DEFAULT_TT: TtOptions = { privacy: 'PUBLIC_TO_EVERYONE', disable_comment: false, disable_duet: false, disable_stitch: false, brand_organic: false, branded: false, ai_generated: false, auto_music: false, title: '' }
const PRIVACY_LABEL: Record<string, string> = { PUBLIC_TO_EVERYONE: 'Publik', MUTUAL_FOLLOW_FRIENDS: 'Teman', FOLLOWER_OF_CREATOR: 'Pengikut', SELF_ONLY: 'Hanya saya' }
const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))
const pad = (n: number) => String(n).padStart(2, '0')
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

async function readItem(file: File): Promise<Item> {
  const base: Item = { uid: newRef(), file, preview: URL.createObjectURL(file), kind: 'image', mime: '', width: 0, height: 0, duration: 0, fps: 0, video_codec: '', audio_codec: '', error: '' }
  const sn = await sniffFile(file)
  if (!sn) return { ...base, error: 'Bukan foto atau video yang dikenali.' }
  if (sn.kind === 'video') {
    if (sn.mime === 'video/webm') return { ...base, kind: 'video', mime: sn.mime, error: 'WebM tidak diterima Instagram. Ekspor ulang sebagai MP4 (H.264).' }
    const info = await inspectMp4(file).catch(() => null)
    if (!info || !info.moov) return { ...base, kind: 'video', mime: sn.mime, error: 'Video tidak bisa dibaca (file rusak atau belum selesai diekspor).' }
    return { ...base, kind: 'video', mime: sn.mime, mp4: info, width: info.width, height: info.height, duration: info.duration, fps: info.fps, video_codec: info.video_codec, audio_codec: info.audio_codec }
  }
  if (sn.mime === 'image/gif') return { ...base, mime: sn.mime, error: 'GIF tidak didukung. Pakai JPEG/PNG, atau ubah GIF menjadi video MP4.' }
  const img = new Image()
  img.src = base.preview
  try { await img.decode() } catch { return { ...base, mime: sn.mime, error: sn.mime === 'image/heic' ? 'Foto HEIC tidak bisa dibuka di browser ini. Ubah ke JPEG dulu.' : 'Foto tidak bisa dibuka.' } }
  return { ...base, mime: sn.mime, width: img.naturalWidth, height: img.naturalHeight }
}

function Composer() {
  const toast = useToast()
  const [cfg, setCfg] = useState<PostConfig | null>(null)
  const [cfgErr, setCfgErr] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [caption, setCaption] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [perAccount, setPerAccount] = useState(false)
  const [tt, setTt] = useState<TtOptions>(DEFAULT_TT)
  const [shareFeed, setShareFeed] = useState(true)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(() => localInput(new Date(Date.now() + 3600000)))
  const [busy, setBusy] = useState<{ step: string; frac: number } | null>(null)
  const [serverErr, setServerErr] = useState('')
  const [drag, setDrag] = useState(false)
  const refRef = useRef(newRef())
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setCfgErr('')
    postApi<PostConfig>('post.config').then(setCfg).catch((e) => setCfgErr(e.message))
  }, [])
  useEffect(load, [load])
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const dests = cfg?.accounts || []
  const chosen = dests.filter((d) => selected.includes(key(d)))
  const igOn = chosen.some((d) => d.type === 'instagram')
  const ttOn = chosen.some((d) => d.type === 'tiktok')
  const photoOnly = items.length > 0 && items.every((i) => i.kind === 'image')

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 20)
    if (!list.length) return
    const read = await Promise.all(list.map(readItem))
    setItems((cur) => [...cur, ...read].slice(0, 35))
    setServerErr('')
  }
  const remove = (uid: string) => setItems((cur) => { const it = cur.find((i) => i.uid === uid); if (it) URL.revokeObjectURL(it.preview); return cur.filter((i) => i.uid !== uid) })
  const move = (uid: string, dir: -1 | 1) => setItems((cur) => {
    const i = cur.findIndex((x) => x.uid === uid), j = i + dir
    if (i < 0 || j < 0 || j >= cur.length) return cur
    const next = cur.slice(); [next[i], next[j]] = [next[j], next[i]]; return next
  })
  const toggle = (d: Destination) => setSelected((s) => (s.includes(key(d)) ? s.filter((x) => x !== key(d)) : [...s, key(d)]))

  // Item seperti yang akan diterima server: foto sudah dikonversi JPEG (dipotong bila ada tujuan Instagram)
  const planned: CheckItem[] = items.filter((i) => !i.error).map((i) => {
    if (i.kind === 'video') return { kind: 'video', mime: i.mime, size: i.file.size, width: i.width, height: i.height, duration: i.duration, fps: i.fps, video_codec: i.video_codec, audio_codec: i.audio_codec }
    const p = planImage(i.width, i.height, igOn)
    return { kind: 'image', mime: 'image/jpeg', size: 0, width: p.w, height: p.h, duration: 0, fps: 0, video_codec: '', audio_codec: '' }
  })
  const croppedCount = igOn ? items.filter((i) => i.kind === 'image' && !i.error && planImage(i.width, i.height, true).cropped).length : 0

  const problems = useMemo(() => {
    if (!cfg) return []
    const out: string[] = []
    if (!items.length) out.push('Tambahkan foto atau video.')
    if (items.some((i) => i.error)) out.push('Hapus file yang ditandai merah.')
    if (items.length > 1 && items.length < cfg.rules.carousel_min) out.push('Carousel minimal 2 media.')
    if (!chosen.length) out.push('Pilih minimal satu akun tujuan.')
    for (const d of chosen) {
      const cap = (perAccount && overrides[key(d)]?.trim()) || caption.trim()
      const who = `${CHANNEL[d.type].label} @${d.username || d.id}`
      if (d.quota && d.quota.used >= d.quota.total) out.push(`${who}: batas ${d.quota.total} posting per 24 jam sudah tercapai.`)
      if (planned.length) checkTarget(d.type, planned, cap, tt, d.limits, cfg.rules).forEach((e) => out.push(`${who}: ${e}`))
    }
    if (cfg.plan.posts > 0 && cfg.plan.used + chosen.length > cfg.plan.posts) out.push(`Kuota posting paket ${cfg.plan.name} tinggal ${Math.max(0, cfg.plan.posts - cfg.plan.used)} (dihitung per akun tujuan).`)
    if (when === 'later') {
      const t = new Date(at).getTime()
      if (!(t > Date.now() + 60000)) out.push('Waktu jadwal harus di masa depan.')
      else if (t > Date.now() + 30 * 86400000) out.push('Jadwal maksimal 30 hari dari sekarang.')
    }
    return out
  }, [cfg, items, chosen, caption, overrides, perAccount, tt, when, at, planned])

  const submit = async () => {
    if (!cfg || problems.length || busy) return
    setServerErr('')
    const total = items.reduce((s, i) => s + i.file.size, 0) || 1
    let done = 0
    try {
      const ids: string[] = []
      for (const [n, it] of items.entries()) {
        const label = `Media ${n + 1}/${items.length}`
        if (it.uploaded && (it.kind === 'video' || it.uploaded.fitIg === igOn)) { ids.push(it.uploaded.media_id); done += it.file.size; continue }
        setBusy({ step: label + ': menyiapkan…', frac: done / total })
        let blob: Blob, mime: string, meta: Partial<CheckItem>
        if (it.kind === 'image') {
          const j = await toJpeg(it.file, { fitInstagram: igOn, maxBytes: cfg.rules.ig_image.max_bytes })
          blob = j.blob; mime = 'image/jpeg'; meta = { width: j.width, height: j.height }
        } else {
          blob = it.mp4 ? await faststart(it.file, it.mp4) : it.file
          mime = it.mime; meta = { width: it.width, height: it.height, duration: it.duration, fps: it.fps, video_codec: it.video_codec, audio_codec: it.audio_codec }
        }
        const start = await postApi<{ media_id: string; upload_url: string }>('media.start', { ...meta, mime, size: blob.size, name: it.file.name })
        await uploadPut(start.upload_url, blob, mime, (f) => setBusy({ step: label + ': mengunggah…', frac: (done + f * it.file.size) / total }))
        setBusy({ step: label + ': memeriksa file…', frac: (done + it.file.size) / total })
        await postApi('media.finish', { media_id: start.media_id })
        done += it.file.size
        ids.push(start.media_id)
        const fitIg = igOn
        setItems((cur) => cur.map((x) => (x.uid === it.uid ? { ...x, uploaded: { media_id: start.media_id, fitIg } } : x)))
      }
      setBusy({ step: 'Mengirim ke antrean…', frac: 1 })
      const r = await postApi<{ post: PostView }>('post.create', {
        media_ids: ids, caption: caption.trim(), client_ref: refRef.current,
        targets: chosen.map((d) => ({ type: d.type, id: d.id, ...(perAccount && overrides[key(d)]?.trim() ? { caption: overrides[key(d)].trim() } : {}) })),
        tiktok: tt, instagram: { share_to_feed: shareFeed },
        ...(when === 'later' ? { schedule_at: new Date(at).toISOString() } : {}),
      })
      refRef.current = newRef()
      toast(when === 'later' ? 'Posting dijadwalkan 🗓️' : 'Posting masuk antrean 🚀')
      openPost(r.post.post_id)
    } catch (e) {
      setServerErr((e as Error).message)
      load() // kuota & izin terbaru
    } finally {
      setBusy(null)
    }
  }

  if (cfgErr) return <><Head /><div className="callout pink">{cfgErr} <button className="linklike" onClick={load}>Coba lagi</button></div></>
  if (!cfg) return <><Head /><Spinner /></>

  const groups = (['instagram', 'tiktok'] as const).map((t) => ({ t, list: dests.filter((d) => d.type === t) }))
  const stats = captionStats(caption)
  return (
    <>
      <Head plan={cfg.plan} />
      {!cfg.ready && <div className="callout pink" style={{ marginBottom: 16 }}>Penyimpanan media belum disiapkan admin Wanychat, jadi posting belum bisa dikirim.</div>}
      {!dests.length && (
        <section className="card" style={{ marginBottom: 20 }}>
          <Empty icon="📤" title="Belum ada akun">Hubungkan akun Instagram atau TikTok di menu <a href="#/settings">Akun</a> dulu.</Empty>
        </section>
      )}

      <div className="editor">
        <div className="stack" style={{ gap: 22 }}>
          <section className="card stack">
            <h3 className="card-title">1. Foto / video</h3>
            <div className={'dropzone' + (drag ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}>
              <p style={{ margin: 0 }}><b>Tarik file ke sini</b> atau</p>
              <button type="button" className="btn sm" onClick={() => fileInput.current?.click()} disabled={!!busy}>Pilih file</button>
              <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
              <p className="hint">1 video (Reels/TikTok), 1 foto, atau 2–10 media untuk carousel. Foto otomatis diubah ke JPEG.</p>
            </div>
            {items.length > 0 && (
              <div className="media-list">
                {items.map((it, i) => (
                  <div key={it.uid} className={'media-item' + (it.error ? ' bad' : '')}>
                    {it.kind === 'video' ? <video src={it.preview} muted playsInline preload="metadata" /> : <img src={it.preview} alt="" />}
                    <div className="media-meta">
                      <b>{items.length > 1 ? `#${i + 1} ` : ''}{it.kind === 'video' ? '🎬 Video' : '🖼️ Foto'}</b>
                      <span className="small muted">
                        {it.width ? `${it.width}×${it.height}` : ''}{it.duration ? ` · ${Math.round(it.duration * 10) / 10} dtk` : ''}{it.fps ? ` · ${Math.round(it.fps)} fps` : ''} · {fmtMb(it.file.size)}
                      </span>
                      {it.error && <span className="small err">{it.error}</span>}
                      {!it.error && it.kind === 'video' && it.mp4 && !it.mp4.faststart && <span className="small muted">Disiapkan otomatis untuk streaming (moov di depan).</span>}
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      {items.length > 1 && <>
                        <button className="btn sm ghost" aria-label="Geser ke kiri" disabled={i === 0 || !!busy} onClick={() => move(it.uid, -1)}>◀</button>
                        <button className="btn sm ghost" aria-label="Geser ke kanan" disabled={i === items.length - 1 || !!busy} onClick={() => move(it.uid, 1)}>▶</button>
                      </>}
                      <button className="btn sm ghost" aria-label="Hapus" disabled={!!busy} onClick={() => remove(it.uid)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {croppedCount > 0 && <p className="hint">✂️ {croppedCount} foto di luar rasio Instagram (4:5–1.91:1) akan dipotong tengah otomatis.</p>}
          </section>

          <section className="card stack">
            <h3 className="card-title">2. Caption</h3>
            <Field label="Caption" hint={<>{stats.chars}/2200 karakter · {stats.hashtags} hashtag (maks 30 di Instagram) · {stats.mentions} mention</>}>
              <textarea className="input" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Tulis caption… #hashtag @mention" />
            </Field>
            {chosen.length > 1 && <Switch checked={perAccount} onChange={setPerAccount} label="Caption berbeda per akun" />}
            {perAccount && chosen.map((d) => (
              <Field key={key(d)} label={`${CHANNEL[d.type].label} @${d.username}`} hint="Kosong = pakai caption utama.">
                <textarea className="input" rows={3} value={overrides[key(d)] || ''} onChange={(e) => setOverrides((o) => ({ ...o, [key(d)]: e.target.value }))} />
              </Field>
            ))}
          </section>

          {(ttOn || igOn) && (
            <section className="card stack">
              <h3 className="card-title">3. Opsi platform</h3>
              {igOn && items.length === 1 && items[0].kind === 'video' && <Switch checked={shareFeed} onChange={setShareFeed} label="Instagram: tampilkan Reels juga di feed profil" />}
              {ttOn && <>
                {photoOnly && (
                  <>
                    <Field label="TikTok: judul foto (opsional)" hint={`${tt.title.length}/90 karakter`}>
                      <input className="input" maxLength={90} value={tt.title} onChange={(e) => setTt({ ...tt, title: e.target.value })} />
                    </Field>
                    <Field label="TikTok: siapa yang bisa melihat">
                      <select className="input" value={tt.privacy} onChange={(e) => setTt({ ...tt, privacy: e.target.value })}>
                        {Object.entries(PRIVACY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Field>
                    <Switch checked={tt.auto_music} onChange={(v) => setTt({ ...tt, auto_music: v })} label="TikTok: tambahkan musik rekomendasi otomatis" />
                  </>
                )}
                <Switch checked={!tt.disable_comment} onChange={(v) => setTt({ ...tt, disable_comment: !v })} label="TikTok: izinkan komentar" />
                {!photoOnly && <>
                  <Switch checked={!tt.disable_duet} onChange={(v) => setTt({ ...tt, disable_duet: !v })} label="TikTok: izinkan Duet" />
                  <Switch checked={!tt.disable_stitch} onChange={(v) => setTt({ ...tt, disable_stitch: !v })} label="TikTok: izinkan Stitch" />
                </>}
                <Switch checked={tt.brand_organic} onChange={(v) => setTt({ ...tt, brand_organic: v })} label='TikTok: promosi brand/bisnis sendiri (label "Konten promosi")' />
                <Switch checked={tt.branded} onChange={(v) => setTt({ ...tt, branded: v })} label='TikTok: kerja sama berbayar (label "Kemitraan berbayar")' />
                <Switch checked={tt.ai_generated} onChange={(v) => setTt({ ...tt, ai_generated: v })} label="TikTok: konten dibuat AI (label permanen)" />
                {tt.disable_comment && <p className="hint">⚠️ Komentar dimatikan: automasi komentar tidak akan berjalan untuk video ini.</p>}
              </>}
            </section>
          )}
        </div>

        <div className="preview-col stack">
          <section className="card stack">
            <h3 className="card-title">Posting ke</h3>
            {groups.map((g) => g.list.length > 0 && (
              <div key={g.t} className="stack" style={{ gap: 8 }}>
                <div className="label row" style={{ gap: 6 }}><ChannelLogo type={g.t} size={16} /> {CHANNEL[g.t].label}</div>
                {g.list.map((d) => {
                  const on = selected.includes(key(d))
                  return (
                    <div key={d.id} className={'dest' + (on ? ' on' : '') + (d.can_publish ? '' : ' off')}>
                      <label className="row" style={{ flexWrap: 'nowrap', cursor: d.can_publish ? 'pointer' : 'default', flex: 1, minWidth: 0 }}>
                        <input type="checkbox" checked={on} disabled={!d.can_publish || !!busy} onChange={() => toggle(d)} />
                        {d.avatar ? <img className="avatar" src={d.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" />}
                        <span style={{ minWidth: 0 }}>
                          <b className="ellipsis" style={{ display: 'block' }}>@{d.username || d.id}</b>
                          <span className="small muted">{d.quota ? `${d.quota.used}/${d.quota.total} posting 24 jam` : ''}</span>
                        </span>
                      </label>
                      {!d.can_publish && (
                        <div className="small" style={{ marginTop: 6 }}>
                          {d.reason}{' '}
                          {d.need_auth && <a className="btn sm" href={publishAuthUrl(d.type)}>Izinkan posting</a>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            {dests.some((d) => d.need_auth) && <p className="hint">"Izinkan posting" membuka halaman izin resmi Instagram/TikTok, sekali saja per akun. Masuk dengan akun yang sama.</p>}
          </section>

          <section className="card stack">
            <h3 className="card-title">Waktu</h3>
            <Segmented value={when} onChange={setWhen} options={[{ value: 'now', label: 'Sekarang' }, { value: 'later', label: 'Jadwalkan' }]} />
            {when === 'later' && <input className="input" type="datetime-local" value={at} min={localInput(new Date())} onChange={(e) => setAt(e.target.value)} aria-label="Waktu posting" />}
          </section>

          {(problems.length > 0 && (items.length > 0 || chosen.length > 0)) && (
            <div className="callout yellow small" role="status">
              <b>Belum bisa dikirim:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{problems.slice(0, 10).map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {serverErr && <div className="callout pink small" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{serverErr}</div>}
          {busy && (
            <div className="meter" aria-live="polite">
              <span className="small"><b>{busy.step}</b> {Math.round(busy.frac * 100)}%</span>
              <div className="meter-bar"><span className="green" style={{ width: Math.round(busy.frac * 100) + '%' }} /></div>
            </div>
          )}
          <button className="btn primary" disabled={!cfg.ready || problems.length > 0 || !!busy} onClick={submit}>
            {busy ? <Spinner /> : !chosen.length ? (when === 'later' ? 'Jadwalkan' : 'Posting') : `${when === 'later' ? 'Jadwalkan' : 'Posting'} ke ${chosen.length} akun`}
          </button>
          <p className="hint">Setelah terbit, kamu langsung diarahkan membuat automasi komentar & DM untuk postingan ini.</p>
        </div>
      </div>

      <RecentPosts />
    </>
  )
}

function Head({ plan }: { plan?: PostConfig['plan'] }) {
  return (
    <div className="page-head">
      <div>
        <h1>Posting</h1>
        <p>Satu konten ke beberapa akun Instagram & TikTok sekaligus.
          {plan && plan.posts > 0 && <> <b>{plan.used}/{plan.posts}</b> posting bulan ini.</>}</p>
      </div>
    </div>
  )
}

function RecentPosts() {
  const [posts, setPosts] = useState<PostView[] | null>(null)
  useEffect(() => { postApi<{ posts: PostView[] }>('post.list', { limit: 20 }).then((r) => setPosts(r.posts)).catch(() => setPosts([])) }, [])
  if (!posts || !posts.length) return null
  return (
    <>
      <h2 className="section-title">Riwayat posting</h2>
      <div className="stack">
        {posts.map((p) => (
          <button key={p.post_id} className="card post-row" onClick={() => openPost(p.post_id)}>
            <Thumb m={p.media[0]} />
            <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
              <span className="row" style={{ gap: 6 }}>
                <span className={'badge ' + POST_LABEL[p.status].color}>{POST_LABEL[p.status].label}</span>
                <span className="small muted">{p.status === 'scheduled' ? 'dijadwalkan ' + new Date(p.scheduled_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : timeAgo(p.created_at)}</span>
              </span>
              <span className="ellipsis" style={{ display: 'block', marginTop: 4 }}>{p.caption || '(tanpa caption)'}</span>
              <span className="row small" style={{ gap: 6, marginTop: 4 }}>
                {p.targets.map((t) => <span key={t.platform + t.account_id} className="row" style={{ gap: 3 }}><ChannelLogo type={t.platform} size={14} />@{t.username}{t.status === 'published' ? ' ✓' : t.status === 'failed' ? ' ✕' : ''}</span>)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function Thumb({ m }: { m?: PostView['media'][number] }) {
  if (!m || !m.url) return <span className="post-thumb">📤</span>
  return m.kind === 'video' ? <video className="post-thumb" src={m.url} muted playsInline preload="metadata" /> : <img className="post-thumb" src={m.url} alt="" loading="lazy" />
}

// ---------------------------------------------------------------- status posting + automasi
function PostStatusView({ postId, me, reload }: { postId: string; me: Me; reload: () => Promise<unknown> }) {
  const toast = useToast()
  const [post, setPost] = useState<PostView | null>(null)
  const [err, setErr] = useState('')
  const [canceling, setCanceling] = useState(false)
  const started = useRef(Date.now())
  const autoRef = useRef<HTMLDivElement>(null)
  const wasActive = useRef(false)

  const load = useCallback(() => postApi<{ post: PostView }>('post.get', { post_id: postId }).then((r) => { setPost(r.post); setErr('') }).catch((e) => setErr(e.message)), [postId])
  useEffect(() => { load() }, [load])
  const active = !!post && post.targets.some((t) => t.status === 'queued' || t.status === 'processing')
  // Polling selama masih ada akun yang diproses: 5 detik, lalu 15 detik setelah 3 menit (worker jalan tiap 2 menit)
  useEffect(() => {
    if (!active) return
    wasActive.current = true
    const ms = Date.now() - started.current > 180000 ? 15000 : 5000
    const t = setTimeout(load, post?.status === 'scheduled' ? 60000 : ms)
    return () => clearTimeout(t)
  }, [active, post, load])

  const published = post ? post.targets.filter((t) => t.status === 'published') : []
  const finished = !!post && !active
  // Begitu semua akun selesai & ada yang terbit: langsung arahkan ke langkah automasi
  useEffect(() => {
    if (finished && published.length && wasActive.current) autoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [finished, published.length])

  const retry = async (t?: PostTarget) => {
    try { await postApi('post.retry', { post_id: postId, ...(t ? { target_ids: [t.id] } : {}) }); toast('Dicoba lagi'); started.current = Date.now(); load() }
    catch (e) { toast((e as Error).message, 'error') }
  }
  const cancel = async () => {
    setCanceling(false)
    try { const r = await postApi<{ canceled: number }>('post.cancel', { post_id: postId }); toast(r.canceled + ' akun dibatalkan'); load() }
    catch (e) { toast((e as Error).message, 'error') }
  }

  if (err && !post) return <><BackHead /><div className="callout pink">{err}</div></>
  if (!post) return <><BackHead /><Spinner /></>
  const queued = post.targets.filter((t) => t.status === 'queued').length
  const retryable = post.targets.filter((t) => t.status === 'failed' && t.retryable).length

  return (
    <>
      <BackHead />
      <section className="card stack" style={{ marginBottom: 20 }}>
        <div className="row between">
          <span className={'badge ' + POST_LABEL[post.status].color}>{POST_LABEL[post.status].label}</span>
          <span className="small muted">{post.status === 'scheduled' ? 'Terbit ' + new Date(post.scheduled_at).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' }) : 'Dibuat ' + timeAgo(post.created_at)}</span>
        </div>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div className="thumbs">{post.media.slice(0, 5).map((m) => <Thumb key={m.media_id} m={m} />)}{post.media.length > 5 && <span className="more">+{post.media.length - 5}</span>}</div>
          <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>{post.caption || <span className="muted">(tanpa caption)</span>}</p>
        </div>
        <div className="stack" style={{ gap: 0 }}>
          {post.targets.map((t) => (
            <div key={t.platform + t.account_id} className="target-row">
              <ChannelLogo type={t.platform} size={22} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b>@{t.username}</b>
                  <span className={'badge ' + TARGET_LABEL[t.status].color}>{t.status === 'queued' && post.status === 'scheduled' ? 'Terjadwal' : TARGET_LABEL[t.status].label}</span>
                  {(t.status === 'queued' || t.status === 'processing') && <Spinner />}
                </div>
                {t.status === 'processing' && <div className="small muted">{t.platform === 'tiktok' ? 'TikTok sedang mengunduh & memoderasi…' : 'Instagram sedang memproses media…'}</div>}
                {t.status === 'queued' && post.status !== 'scheduled' && <div className="small muted">Menunggu giliran (maks ±2 menit).</div>}
                {t.error && t.status !== 'canceled' && <div className="small err">{t.error}</div>}
                {t.note && t.status === 'published' && <div className="small muted">{t.note}</div>}
              </div>
              {t.permalink && <a className="btn sm" href={t.permalink} target="_blank" rel="noreferrer">Lihat ↗</a>}
              {t.status === 'failed' && t.retryable && <button className="btn sm" onClick={() => retry(t)}>Coba lagi</button>}
            </div>
          ))}
        </div>
        <div className="row">
          {queued > 0 && <button className="btn sm danger" onClick={() => setCanceling(true)}>Batalkan {queued} akun yang belum diproses</button>}
          {retryable > 1 && <button className="btn sm" onClick={() => retry()}>Coba lagi semua yang gagal</button>}
          <span className="spacer" />
          <a className="btn sm" href="#/posting">+ Posting baru</a>
        </div>
      </section>

      <div ref={autoRef}>
        {active && post.status !== 'scheduled' && (
          <div className="callout small"><b>⚡ Langkah berikutnya: automasi.</b> Setelah semua akun selesai, kamu langsung bisa membuat balasan komentar & DM otomatis khusus untuk postingan ini.</div>
        )}
        {finished && published.length > 0 && <PostAutomation post={post} me={me} reload={reload} />}
        {finished && !published.length && <div className="callout pink small">Tidak ada akun yang berhasil terbit, jadi automasi belum bisa dibuat. Perbaiki penyebabnya lalu coba lagi.</div>}
      </div>

      {canceling && <Confirm title="Batalkan posting?" body={<>{queued} akun yang belum diproses tidak akan diposting. Akun yang sudah terbit tidak terpengaruh.</>} confirmLabel="Batalkan" onConfirm={cancel} onCancel={() => setCanceling(false)} />}
    </>
  )
}

function BackHead() {
  return (
    <div className="page-head">
      <div>
        <a className="btn sm ghost" href="#/posting" style={{ marginLeft: -10, marginBottom: 6 }}>← Posting</a>
        <h1>Status posting</h1>
      </div>
    </div>
  )
}

// Satu formulir -> satu automasi per akun yang berhasil terbit, khusus postingan baru itu (post_ids = ID postingan).
// Pakai API automasi yang sudah ada (rules.save) per akun: sesi dipindah ke akun itu, lalu dikembalikan ke akun semula.
function PostAutomation({ post, me, reload }: { post: PostView; me: Me; reload: () => Promise<unknown> }) {
  const toast = useToast()
  const plan = me.billing?.plan
  const canAi = !plan || plan.ai > 0 || (me.billing?.credits || 0) > 0
  const pub = post.targets.filter((t) => t.status === 'published')
  const ready = pub.filter((t) => t.media_id)
  const noId = pub.filter((t) => !t.media_id)
  const igT = ready.filter((t) => t.platform === 'instagram')
  const ttT = ready.filter((t) => t.platform === 'tiktok')
  const ig0 = emptyRule(), tt0 = emptyTtRule()
  const [name, setName] = useState(() => 'Posting: ' + (post.caption.split('\n')[0].slice(0, 40) || new Date(post.created_at).toLocaleDateString('id-ID')))
  const [match, setMatch] = useState<MatchMode>('contains')
  const [keywords, setKeywords] = useState('info, harga, mau')
  const [igReplies, setIgReplies] = useState(ig0.comment_replies)
  const [dm, setDm] = useState(ig0.dm_message)
  const [btn, setBtn] = useState(ig0.dm_button_title)
  const [content, setContent] = useState('')
  const [ttReplies, setTtReplies] = useState(tt0.comment_replies)
  const [ai, setAi] = useState(false)
  const [aiCtx, setAiCtx] = useState(post.caption.slice(0, 1000))
  const [pick, setPick] = useState<string[]>(() => ready.map((t) => t.platform + ':' + t.account_id))
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ t: PostTarget; ok: boolean; error?: string }[] | null>(null)
  const [error, setError] = useState('')

  const ttLong = ttReplies.split('\n').map((s) => s.trim()).filter(Boolean).filter((s) => s.length > 150).length
  const chosen = ready.filter((t) => pick.includes(t.platform + ':' + t.account_id))

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Nama automasi wajib diisi.')
    if (match !== 'any' && !keywords.trim()) return setError('Isi minimal satu keyword, atau pilih "Semua komentar".')
    if (btn && !content.trim() && chosen.some((t) => t.platform === 'instagram')) return setError('Isi pesan setelah tombol ditekan, atau kosongkan judul tombol.')
    if (ttLong) return setError('Balasan TikTok maksimal 150 karakter per baris.')
    if (!chosen.length) return setError('Pilih minimal satu akun.')
    setBusy(true)
    const out: { t: PostTarget; ok: boolean; error?: string }[] = []
    const origIg = me.account?.ig_user_id, origTt = me.tiktok?.open_id
    try {
      for (const t of chosen) {
        try {
          await api('accounts.switch', { type: t.platform, id: t.account_id })
          const base = t.platform === 'tiktok' ? emptyTtRule() : emptyRule()
          const rule: Rule = {
            ...base, name: name.trim().slice(0, 120), active: true, post_ids: t.media_id, keywords: match === 'any' ? '' : keywords, match_mode: match,
            ai_fallback: ai && canAi, ai_context: ai ? aiCtx : '',
            ...(t.platform === 'tiktok'
              ? { comment_replies: ttReplies }
              : { channel: 'comment', comment_replies: igReplies, dm_message: dm, dm_button_title: btn, dm_content: btn ? content : '' }),
          }
          await api('rules.save', t.platform === 'tiktok' ? { type: 'tiktok', rule } : { rule })
          out.push({ t, ok: true })
        } catch (e) {
          out.push({ t, ok: false, error: (e as Error).message })
        }
      }
    } finally {
      // Kembalikan dasbor ke akun yang sedang dibuka sebelumnya
      try {
        if (origIg) await api('accounts.switch', { type: 'instagram', id: origIg })
        if (origTt) await api('accounts.switch', { type: 'tiktok', id: origTt })
      } catch { /* sesi tetap valid; akun aktif bisa dipilih ulang */ }
      await reload().catch(() => {})
      setBusy(false)
    }
    setResults(out)
    const good = out.filter((x) => x.ok).length
    if (good) toast(`Automasi aktif di ${good} akun ⚡`)
  }

  const openAutomations = async (t: PostTarget) => {
    try {
      await api('accounts.switch', { type: t.platform, id: t.account_id })
      channelPref.set(t.platform)
      window.location.hash = '#/automations'
      window.location.reload()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  if (results) {
    return (
      <section className="card tint-green stack">
        <h3 className="card-title">⚡ Automasi postingan ini</h3>
        {results.map((r) => (
          <div key={r.t.platform + r.t.account_id} className="row">
            <ChannelLogo type={r.t.platform} size={18} /> <b>@{r.t.username}</b>
            {r.ok ? <span className="badge green">Aktif</span> : <span className="badge red">Gagal</span>}
            {r.error && <span className="small">{r.error}</span>}
            <span className="spacer" />
            {r.ok && <button className="btn sm" onClick={() => openAutomations(r.t)}>Buka automasi</button>}
          </div>
        ))}
        {results.some((r) => !r.ok) && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setResults(null)}>Ubah & coba lagi</button>}
      </section>
    )
  }

  return (
    <section className="card stack automation-step">
      <div>
        <span className="badge yellow">Langkah berikutnya</span>
        <h3 className="card-title" style={{ marginTop: 8 }}>⚡ Buat automasi untuk postingan ini</h3>
        <p className="card-sub" style={{ margin: 0 }}>Orang yang komentar keyword di postingan baru ini langsung dibalas{igT.length ? ' dan dapat DM (Instagram)' : ''}. Dibuat sekaligus di semua akun yang terbit.</p>
      </div>
      {noId.length > 0 && <div className="callout small">ID postingan {noId.map((t) => '@' + t.username).join(', ')} belum diberikan {noId.some((t) => t.platform === 'tiktok') ? 'TikTok (masih moderasi / bukan publik)' : 'platform'}, jadi automasinya dibuat nanti dari menu Automasi akun itu.</div>}
      {!ready.length ? null : <>
        <Field label="Akun">
          <div className="row">
            {ready.map((t) => {
              const k = t.platform + ':' + t.account_id
              return <button key={k} type="button" className={'chip' + (pick.includes(k) ? ' on' : '')} onClick={() => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
                <ChannelLogo type={t.platform} size={14} /> @{t.username}
              </button>
            })}
          </div>
        </Field>
        <Field label="Nama automasi"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Dipicu komentar yang">
          <Segmented<MatchMode> value={match} onChange={setMatch} options={[{ value: 'contains', label: 'Mengandung keyword' }, { value: 'exact', label: 'Sama persis' }, { value: 'any', label: 'Semua komentar' }]} />
        </Field>
        {match !== 'any' && <Field label="Keyword" hint="Pisahkan dengan koma."><input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></Field>}
        {igT.length > 0 && chosen.some((t) => t.platform === 'instagram') && (
          <div className="stack sub-block">
            <div className="label row" style={{ gap: 6 }}><ChannelLogo type="instagram" size={16} /> Instagram</div>
            <Field label="Balasan komentar (satu per baris, dipilih acak)" hint="{username} = mention pemberi komentar."><textarea className="input" rows={3} value={igReplies} onChange={(e) => setIgReplies(e.target.value)} /></Field>
            <Field label="DM pertama" hint="{nama} = username."><textarea className="input" rows={3} value={dm} onChange={(e) => setDm(e.target.value)} /></Field>
            <Field label="Judul tombol (opsional)" hint={`${btn.length}/20`}><input className="input" maxLength={20} value={btn} onChange={(e) => setBtn(e.target.value)} /></Field>
            {btn && <Field label="Pesan setelah tombol ditekan" hint="Biasanya link produk / katalog."><textarea className="input" rows={2} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Ini linknya kak: https://…" /></Field>}
          </div>
        )}
        {ttT.length > 0 && chosen.some((t) => t.platform === 'tiktok') && (
          <div className="stack sub-block">
            <div className="label row" style={{ gap: 6 }}><ChannelLogo type="tiktok" size={16} /> TikTok</div>
            <Field label="Balasan komentar (satu per baris, maks 150 karakter)" hint={ttLong ? `⚠️ ${ttLong} baris lebih dari 150 karakter.` : 'TikTok tidak punya DM otomatis; balasan muncul di kolom komentar.'}>
              <textarea className="input" rows={3} value={ttReplies} onChange={(e) => setTtReplies(e.target.value)} />
            </Field>
          </div>
        )}
        <Switch checked={ai && canAi} disabled={!canAi} onChange={setAi} label="Balas pertanyaan lain dengan AI" />
        {!canAi && <p className="hint"><span className="badge orange">Kreator+</span> Balasan AI butuh paket Kreator atau kredit AI. <a href="#/billing">Lihat paket</a></p>}
        {ai && canAi && <Field label="Konteks untuk AI" hint="Info produk/harga yang boleh disebut AI."><textarea className="input" rows={3} value={aiCtx} onChange={(e) => setAiCtx(e.target.value)} /></Field>}
        {error && <div className="callout pink small" role="alert">{error}</div>}
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : `Aktifkan automasi di ${chosen.length} akun`}</button>
          <a className="btn ghost" href="#/posting">Lewati</a>
        </div>
      </>}
    </section>
  )
}

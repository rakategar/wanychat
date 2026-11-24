import { useCallback, useEffect, useState } from 'react'
import { api, emptyTtRule, type Billing, type EventRow, type MatchMode, type Rule, type TikTokAccount } from '../api'
import { Confirm, EVENT_META, Empty, Field, Segmented, Spinner, Switch, timeAgo, useToast } from '../components/ui'
import type { TtVideo } from '../tiktok'
import { KeywordInput, Section } from './RuleEditor'

// Automasi komentar TikTok: keyword -> balas publik / sembunyikan, atau balasan AI. Komentar dicek berkala (polling),
// bukan real-time, karena TikTok tidak mengirim notifikasi komentar ke aplikasi.
const T = { type: 'tiktok' }
const MAX = 150
export const pollMinutes = (b: Billing | null) => (b && b.plan.price > 0 ? 5 : 30)

type Kind = 'reply' | 'hide'

export function TtAutomations({ tiktok, billing, videos }: { tiktok: TikTokAccount; billing: Billing | null; videos: TtVideo[] | null }) {
  const toast = useToast()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [deleting, setDeleting] = useState<Rule | null>(null)

  const load = useCallback(() => {
    api<{ rules: Rule[] }>('rules.list', T)
      .then((r) => setRules(r.rules.sort((a, b) => (b.id || 0) - (a.id || 0))))
      .catch((e) => { setRules([]); toast(e.message, 'error') })
  }, [toast])
  useEffect(load, [load])

  const toggle = async (rule: Rule, active: boolean) => {
    setRules((rs) => rs && rs.map((r) => (r.id === rule.id ? { ...r, active } : r)))
    try {
      await api('rules.save', { ...T, rule: { ...rule, active } })
      toast(active ? `"${rule.name}" aktif` : `"${rule.name}" dimatikan`)
    } catch (e) { toast((e as Error).message, 'error'); load() }
  }
  const remove = async () => {
    if (!deleting) return
    const r = deleting
    setDeleting(null)
    try { await api('rules.delete', { ...T, id: r.id }); toast(`"${r.name}" dihapus`); load() } catch (e) { toast((e as Error).message, 'error') }
  }

  if (editing) return <TtRuleEditor initial={editing} videos={videos} username={tiktok.username} billing={billing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />

  const limit = billing?.plan.rules || 0
  const full = !!limit && !!rules && rules.length >= limit
  const create = (r?: Rule) => (full ? toast(`Paket ${billing?.plan.name} maksimal ${limit} automasi per akun. Upgrade di menu Langganan.`, 'error') : setEditing(r || emptyTtRule()))
  const spam = (): Rule => ({ ...emptyTtRule(), name: 'Sembunyikan spam', keywords: 'slot, judi, gacor, pinjol, togel', hide_comment: true, comment_replies: '' })
  const thumb = (id: string) => videos?.find((v) => v.item_id === id)

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between">
        <p className="muted" style={{ margin: 0, maxWidth: 620 }}>
          Komentar baru dicek tiap <b>{pollMinutes(billing)} menit</b>{billing && billing.plan.price === 0 && <> (paket berbayar: tiap 5 menit)</>}.
          Hanya komentar yang masuk setelah automasi aktif yang diproses.{limit > 0 && rules && <> <b>{rules.length}/{limit}</b> automasi terpakai.</>}
        </p>
        <button className="btn primary" onClick={() => create()}>+ Automasi baru</button>
      </div>

      {!rules ? <Spinner /> : rules.length === 0 ? (
        <Empty icon="⚡" title="Belum ada automasi TikTok">
          <p>Contoh: orang komentar <code>harga</code> di video, lalu otomatis dibalas "Cek link di bio ya!". Atau sembunyikan komentar promosi judi otomatis.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => create()}>Buat automasi balasan</button>
            <button className="btn" onClick={() => create(spam())}>🙈 Sembunyikan spam</button>
          </div>
        </Empty>
      ) : (
        <div className="grid two">
          {rules.map((r) => {
            const vids = r.post_ids === '*' ? [] : r.post_ids.split(',').map((s) => s.trim()).filter(Boolean)
            const kws = r.keywords.split(',').map((s) => s.trim()).filter(Boolean)
            const replies = r.comment_replies.split('\n').filter((s) => s.trim())
            return (
              <article key={r.id} className={'card rule-card' + (r.active ? '' : ' off')}>
                <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      {r.hide_comment ? <span className="badge orange">🙈 Sembunyikan</span> : <span className="badge pink">↩️ Balas komentar</span>}
                      {r.ai_fallback && <span className="badge green">✨ AI</span>}
                    </div>
                    <h3>{r.name}</h3>
                  </div>
                  <Switch checked={r.active} onChange={(v) => toggle(r, v)} />
                </div>
                <div className="small">
                  <span className="label">Pemicu: </span>
                  {r.match_mode === 'any' ? 'semua komentar' : (
                    <span className="row" style={{ display: 'inline-flex', gap: 6 }}>
                      {kws.slice(0, 6).map((k) => <span key={k} className="chip" style={{ cursor: 'default', padding: '2px 8px' }}>{k}</span>)}
                      {kws.length > 6 && <span className="muted">+{kws.length - 6}</span>}
                      {r.match_mode === 'exact' && <span className="muted">(persis)</span>}
                    </span>
                  )}
                </div>
                <div className="row small">
                  <span className="label">Video:</span>
                  {vids.length === 0 ? <span>10 video terbaru</span> : (
                    <div className="thumbs">
                      {vids.slice(0, 5).map((id) => { const v = thumb(id); return v?.thumbnail_url ? <img key={id} src={v.thumbnail_url} alt="" /> : <span key={id} className="more">🎬</span> })}
                      {vids.length > 5 && <span className="more">+{vids.length - 5}</span>}
                    </div>
                  )}
                </div>
                {!r.hide_comment && (
                  <p className="small muted" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    ↩️ {replies[0] || (r.ai_fallback ? 'Dijawab AI' : '-')}{replies.length > 1 && ` (+${replies.length - 1} variasi)`}
                  </p>
                )}
                <div className="row" style={{ marginTop: 'auto' }}>
                  <button className="btn sm" onClick={() => setEditing(r)}>Edit</button>
                  <button className="btn sm" onClick={() => create({ ...r, id: undefined, name: r.name + ' (salinan)', active: false })}>Duplikat</button>
                  <span className="spacer" />
                  <button className="btn sm danger" onClick={() => setDeleting(r)}>Hapus</button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {deleting && (
        <Confirm title="Hapus automasi?" body={<>Automasi <b>{deleting.name}</b> akan dihapus permanen. Log aktivitasnya tetap tersimpan.</>}
          confirmLabel="Hapus" onConfirm={remove} onCancel={() => setDeleting(null)} />
      )}
    </div>
  )
}

function TtRuleEditor({ initial, videos, username, billing, onCancel, onSaved }: {
  initial: Rule; videos: TtVideo[] | null; username: string; billing: Billing | null; onCancel: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [r, setR] = useState<Rule>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setR((x) => ({ ...x, [k]: v }))
  const kind: Kind = r.hide_comment ? 'hide' : 'reply'
  const [specific, setSpecific] = useState(!['', '*'].includes(initial.post_ids.trim()))
  const selected = specific ? r.post_ids.split(',').map((s) => s.trim()).filter((s) => s && s !== '*') : []
  const toggleVideo = (id: string) => set('post_ids', (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]).join(','))
  const variants = r.comment_replies.split('\n').map((s) => s.trim()).filter(Boolean)
  const tooLong = variants.filter((v) => v.length > MAX)
  const plan = billing?.plan
  const canAi = !plan || plan.ai > 0 || (billing?.credits || 0) > 0
  const sample = (tpl: string) => tpl.replace(/\{username\}/gi, '@pembeli').replace(/\{nama\}/gi, 'pembeli')
  const firstKeyword = r.keywords.split(',')[0]?.trim() || 'harga'

  const setKind = (k: Kind) => setR((x) => ({ ...x, hide_comment: k === 'hide', match_mode: k === 'hide' && x.match_mode === 'any' ? 'contains' : x.match_mode }))
  const save = async () => {
    setError('')
    if (specific && selected.length === 0) return setError('Pilih minimal satu video, atau pilih "Video terbaru".')
    if (kind === 'reply' && tooLong.length) return setError(`Balasan TikTok maksimal ${MAX} karakter per baris.`)
    setBusy(true)
    try {
      await api('rules.save', { ...T, rule: { ...r, post_ids: specific ? selected.join(',') : '*' } })
      toast(`Automasi "${r.name}" tersimpan`)
      onSaved()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn sm ghost" onClick={onCancel} style={{ marginLeft: -10, marginBottom: 6 }}>← Kembali</button>
          <h1 style={{ fontSize: 30 }}>{initial.id ? 'Edit automasi TikTok' : 'Automasi TikTok baru'}</h1>
        </div>
        <div className="row save-bar">
          <Switch checked={r.active} onChange={(v) => set('active', v)} label={r.active ? 'Aktif' : 'Nonaktif'} />
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>Batal</button>
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Simpan'}</button>
        </div>
      </div>

      {error && <div className="callout pink" role="alert" style={{ marginBottom: 20 }}>{error}</div>}

      <div className="editor">
        <div className="stack" style={{ gap: 22 }}>
          <Section n={1} title="Nama & aksi">
            <Field label="Nama automasi" htmlFor="tt-name">
              <input id="tt-name" className="input" value={r.name} onChange={(e) => set('name', e.target.value)} placeholder="mis. Tanya harga — arahkan ke bio" />
            </Field>
            <Field label="Kalau komentar cocok" hint={kind === 'hide' ? 'Komentar disembunyikan dari publik (penulisnya tetap bisa melihat). Bisa ditampilkan lagi dari tab Komentar.' : 'Wanychat membalas di kolom komentar video.'}>
              <Segmented<Kind> value={kind} onChange={setKind} options={[{ value: 'reply', label: '↩️ Balas komentar' }, { value: 'hide', label: '🙈 Sembunyikan komentar' }]} />
            </Field>
          </Section>

          <Section n={2} title="Pemicu">
            <Field label="Cocokkan" hint={r.match_mode === 'any' ? 'Setiap komentar baru akan dibalas.' : r.match_mode === 'exact' ? 'Hanya jika isinya persis sama dengan keyword (tidak peka huruf besar/kecil).' : 'Jika mengandung salah satu keyword (tidak peka huruf besar/kecil).'}>
              <Segmented<MatchMode> value={r.match_mode} onChange={(v) => set('match_mode', v)}
                options={kind === 'hide' ? [{ value: 'contains', label: 'Mengandung keyword' }, { value: 'exact', label: 'Sama persis' }]
                  : [{ value: 'contains', label: 'Mengandung keyword' }, { value: 'exact', label: 'Sama persis' }, { value: 'any', label: 'Semua' }]} />
            </Field>
            {r.match_mode !== 'any' && (
              <Field label="Keyword" hint="Tekan Enter atau koma untuk menambah.">
                <KeywordInput value={r.keywords} onChange={(v) => set('keywords', v)} />
              </Field>
            )}
          </Section>

          <Section n={3} title="Video">
            <div className="row">
              <button type="button" className={'chip' + (!specific ? ' on' : '')} onClick={() => setSpecific(false)}>🆕 10 video terbaru</button>
              <button type="button" className={'chip' + (specific ? ' on' : '')} onClick={() => setSpecific(true)}>🎯 Pilih video {selected.length > 0 && `(${selected.length})`}</button>
            </div>
            {!specific ? <p className="hint">Video baru otomatis ikut dipantau.</p> : videos === null ? <Spinner /> : videos.length === 0 ? <p className="hint">Belum ada video.</p> : (
              <div className="posts">
                {videos.map((v) => {
                  const on = selected.includes(v.item_id)
                  return (
                    <button key={v.item_id} type="button" className={'post' + (on ? ' on' : '')} onClick={() => toggleVideo(v.item_id)} title={v.caption || ''} aria-pressed={on}>
                      {v.thumbnail_url ? <img src={v.thumbnail_url} alt={v.caption?.slice(0, 60) || 'video'} loading="lazy" /> : <span aria-hidden>🎬</span>}
                      <span className="tick">{on ? '✓' : ''}</span>
                      <span className="cap">▶ {v.caption || 'Tanpa caption'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </Section>

          {kind === 'reply' && (
            <Section n={4} title="Balasan komentar">
              <Field label="Variasi balasan" hint={`Satu balasan per baris, dipilih acak. Maksimal ${MAX} karakter per baris. Pakai {username} untuk mention. Kosongkan bila hanya ingin balasan AI.`}>
                <textarea className="input" rows={4} value={r.comment_replies} onChange={(e) => set('comment_replies', e.target.value)} />
              </Field>
              {tooLong.length > 0 && <p className="hint" style={{ color: 'var(--red, #c0392b)' }}>⚠ {tooLong.length} baris lebih dari {MAX} karakter.</p>}
              <p className="hint">Hindari link di balasan; TikTok bisa menganggapnya spam. Arahkan ke "link di bio".</p>
            </Section>
          )}

          {kind === 'reply' && (
            <Section n={5} title="Balasan AI" right={<Switch checked={r.ai_fallback} disabled={!canAi && !r.ai_fallback} onChange={(v) => set('ai_fallback', v)} />}>
              {!canAi ? <p className="hint"><span className="badge orange">Kreator+</span> Balasan AI tersedia mulai paket Kreator, atau beli top-up kredit AI. <a href="#/billing">Lihat paket</a></p> : r.ai_fallback ? (
                <>
                <Field label="Konteks produk untuk AI" hint="Komentar yang TIDAK cocok keyword dijawab AI (maks 150 karakter) berdasarkan konteks ini. Kuota AI dibagi dengan Instagram.">
                  <textarea className="input" rows={4} value={r.ai_context} onChange={(e) => set('ai_context', e.target.value)} placeholder="Nama produk, harga, cara order, link di bio, FAQ…" />
                </Field>
                <label className="check" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <input type="checkbox" checked={!!r.ai_reply_all} onChange={(e) => set('ai_reply_all', e.target.checked)} />
                  <span>Balas semua komentar, termasuk "gamau", candaan, emoji, atau tag teman. Spam dan komentar kasar tetap dilewati.</span>
                </label>
                </>
              ) : <p className="hint">Nyalakan supaya pertanyaan lain di video ini dijawab otomatis oleh AI.</p>}
            </Section>
          )}
        </div>

        <aside className="preview-col">
          <div className="label" style={{ marginBottom: 10 }}>Pratinjau</div>
          <div className="phone">
            <div className="phone-top">
              <span className="avatar" />
              <div><div style={{ fontWeight: 700 }}>@{username}</div><div className="small muted">TikTok · komentar video</div></div>
            </div>
            <div className="phone-body">
              <div className={'bubble comment' + (kind === 'hide' ? ' muted' : '')} style={kind === 'hide' ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
                <b>@pembeli</b> {r.match_mode === 'any' ? 'keren kak!' : kind === 'hide' ? `${firstKeyword} 88 gacor cek bio` : `kak ${firstKeyword} berapa?`}
              </div>
              {kind === 'hide' ? <div className="sys">🙈 Disembunyikan otomatis</div>
                : variants[0] ? <div className="bubble comment" style={{ marginLeft: 18 }}><b>@{username}</b> {sample(variants[0]).slice(0, MAX)}</div>
                  : r.ai_fallback ? <div className="sys">✨ Dijawab AI</div> : null}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

export function TtActivity() {
  const toast = useToast()
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [clearing, setClearing] = useState(false)
  const load = useCallback(() => {
    api<{ events: EventRow[] }>('events.list', { ...T, limit: 300 })
      .then((r) => setEvents(r.events))
      .catch((e) => { setEvents((x) => x || []); toast(e.message, 'error') })
  }, [toast])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])
  const shown = (events || []).filter((e) => !errorsOnly || e.status === 'error')

  return (
    <section className="card stack">
      <div className="row between">
        <div className="row" style={{ gap: 6 }}>
          <button className={'chip' + (!errorsOnly ? ' on' : '')} onClick={() => setErrorsOnly(false)}>Semua</button>
          <button className={'chip' + (errorsOnly ? ' on' : '')} onClick={() => setErrorsOnly(true)}>Error</button>
        </div>
        <div className="row">
          <button className="btn sm danger" onClick={() => setClearing(true)}>Bersihkan log</button>
          <button className="btn sm" onClick={load}>↻ Muat ulang</button>
        </div>
      </div>
      {!events ? <Spinner /> : shown.length === 0 ? (
        <Empty icon="📭" title="Belum ada aktivitas">Komentar di video yang punya automasi aktif akan tercatat di sini.</Empty>
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
                    {e.username ? <b>@{e.username}</b> : <span className="muted">{e.type === 'tt_error' ? 'Wanychat' : '-'}</span>}
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
      )}
      {clearing && (
        <Confirm title="Bersihkan log TikTok?" body="Semua log aktivitas akun TikTok ini dihapus permanen. Automasi tidak terpengaruh." confirmLabel="Hapus semua"
          onCancel={() => setClearing(false)}
          onConfirm={async () => { setClearing(false); try { await api('logs.clear', T); toast('Log dibersihkan'); load() } catch (e) { toast((e as Error).message, 'error') } }} />
      )}
    </section>
  )
}

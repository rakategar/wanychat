import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { api, type MatchMode, type Media, type Rule } from '../api'
import { Field, Segmented, Spinner, Switch, useToast } from '../components/ui'
import type { Plan } from '../plans'

interface Props {
  initial: Rule
  media: Media[] | null
  mediaError: string
  username: string
  plan: Plan | null
  onCancel: () => void
  onSaved: () => void
}

export default function RuleEditor({ initial, media, mediaError, username, plan, onCancel, onSaved }: Props) {
  const toast = useToast()
  const [r, setR] = useState<Rule>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setR((x) => ({ ...x, [k]: v }))

  const [specific, setSpecific] = useState(!['', '*'].includes(initial.post_ids.trim()))
  const allPosts = !specific
  const selected = allPosts ? [] : r.post_ids.split(',').map((s) => s.trim()).filter((s) => s && s !== '*')
  const togglePost = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    set('post_ids', next.join(','))
  }

  const save = async () => {
    setError('')
    if (r.channel === 'comment' && !allPosts && selected.length === 0) return setError('Pilih minimal satu post, atau pilih "Semua post".')
    if (r.dm_button_title && !r.dm_content) return setError('Isi "Pesan setelah tombol ditekan" atau kosongkan judul tombol.')
    setBusy(true)
    try {
      await api('rules.save', { rule: { ...r, post_ids: allPosts ? '*' : selected.join(',') } })
      toast(`Automasi "${r.name}" tersimpan`)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const variants = r.comment_replies.split('\n').map((s) => s.trim()).filter(Boolean)
  const sample = (tpl: string) => tpl.replace(/\{username\}/gi, '@pembeli').replace(/\{nama\}/gi, 'pembeli')
  const firstKeyword = r.keywords.split(',')[0]?.trim() || 'info'
  const canFollowup = !plan || plan.followup
  const canAi = !plan || plan.ai > 0
  const locked = (what: string) => <p className="hint"><span className="badge orange">Kreator+</span> {what} tersedia mulai paket Kreator. <a href="#/billing">Lihat paket</a></p>

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn sm ghost" onClick={onCancel} style={{ marginLeft: -10, marginBottom: 6 }}>← Kembali</button>
          <h1>{initial.id ? 'Edit automasi' : 'Automasi baru'}</h1>
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
          <Section n={1} title="Nama & pemicu">
            <Field label="Nama automasi" htmlFor="name">
              <input id="name" className="input" value={r.name} onChange={(e) => set('name', e.target.value)} placeholder="mis. Promo kelas — kirim link" />
            </Field>
            <Field label="Dipicu oleh">
              <Segmented
                value={r.channel}
                onChange={(v) => set('channel', v)}
                options={[{ value: 'comment', label: '💬 Komentar post' }, { value: 'dm', label: '📥 DM masuk' }]}
              />
            </Field>
            <Field label="Cocokkan" hint={r.match_mode === 'any' ? 'Setiap komentar/DM akan dibalas.' : r.match_mode === 'exact' ? 'Hanya jika isinya persis sama dengan keyword (tidak peka huruf besar/kecil).' : 'Jika mengandung salah satu keyword (tidak peka huruf besar/kecil).'}>
              <Segmented<MatchMode>
                value={r.match_mode}
                onChange={(v) => set('match_mode', v)}
                options={[{ value: 'contains', label: 'Mengandung keyword' }, { value: 'exact', label: 'Sama persis' }, { value: 'any', label: 'Semua' }]}
              />
            </Field>
            {r.match_mode !== 'any' && (
              <Field label="Keyword" hint="Tekan Enter atau koma untuk menambah.">
                <KeywordInput value={r.keywords} onChange={(v) => set('keywords', v)} />
              </Field>
            )}
          </Section>

          {r.channel === 'comment' && (
            <Section n={2} title="Postingan">
              <div className="row">
                <button type="button" className={'chip' + (allPosts ? ' on' : '')} onClick={() => setSpecific(false)}>🌐 Semua post</button>
                <button type="button" className={'chip' + (!allPosts ? ' on' : '')} onClick={() => setSpecific(true)}>🎯 Pilih post tertentu {selected.length > 0 && `(${selected.length})`}</button>
              </div>
              {!allPosts && (
                media === null ? <Spinner /> : mediaError ? <div className="callout pink">{mediaError}</div> : (
                  <div className="posts">
                    {media.map((m) => {
                      const on = selected.includes(m.id)
                      return (
                        <button key={m.id} type="button" className={'post' + (on ? ' on' : '')} onClick={() => togglePost(m.id)} title={m.caption || ''} aria-pressed={on}>
                          <img src={m.thumbnail_url || m.media_url} alt={m.caption?.slice(0, 60) || 'post'} loading="lazy" />
                          <span className="tick">{on ? '✓' : ''}</span>
                          <span className="cap">{m.media_type === 'VIDEO' ? '▶ ' : ''}{m.caption || new Date(m.timestamp).toLocaleDateString('id-ID')}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              )}
            </Section>
          )}

          {r.channel === 'comment' && (
            <Section n={3} title="Balas komentar (publik)">
              <Field label="Variasi balasan" hint="Satu balasan per baris; dipilih acak supaya tidak terlihat seperti bot. Kosongkan jika tidak ingin membalas di kolom komentar. Pakai {username} untuk mention.">
                <textarea className="input" rows={4} value={r.comment_replies} onChange={(e) => set('comment_replies', e.target.value)} />
              </Field>
            </Section>
          )}

          <Section n={r.channel === 'comment' ? 4 : 2} title={r.channel === 'comment' ? 'DM pertama (private reply)' : 'Balasan DM'}>
            <Field label="Pesan" hint={r.channel === 'comment' ? 'Terkirim ke siapa pun yang komentar, walau belum pernah DM. Hanya 1 pesan per komentar. {nama} = username.' : '{nama} = username pengirim.'}>
              <textarea className="input" rows={3} value={r.dm_message} onChange={(e) => set('dm_message', e.target.value)} />
            </Field>
            <div className="grid two" style={{ gap: 14 }}>
              <Field label="Judul tombol (opsional)" hint={`${r.dm_button_title.length}/20 karakter`}>
                <input className="input" maxLength={20} value={r.dm_button_title} onChange={(e) => set('dm_button_title', e.target.value)} placeholder="Kirim linknya 👉" />
              </Field>
            </div>
            {r.dm_button_title && (
              <Field label="Pesan setelah tombol ditekan" hint="Biasanya berisi link / katalog. Saat tombol ditekan, jendela chat 24 jam terbuka.">
                <textarea className="input" rows={3} value={r.dm_content} onChange={(e) => set('dm_content', e.target.value)} placeholder="Ini linknya kak: https://…" />
              </Field>
            )}
            <div className="callout yellow small">
              <b>Kenapa pakai tombol?</b> Instagram hanya mengizinkan 1 DM ke orang yang komentar. Begitu dia menekan tombol,
              percakapan terbuka dan sistem boleh mengirim link + follow-up. Jika Instagram menolak tombol, link langsung digabung ke DM pertama.
            </div>
          </Section>

          <Section n={r.channel === 'comment' ? 5 : 3} title="Follow-up" right={<Switch checked={r.followup_enabled} disabled={!canFollowup && !r.followup_enabled} onChange={(v) => set('followup_enabled', v)} />}>
            {!canFollowup ? locked('Follow-up') : r.followup_enabled ? (
              <>
                <Field label="Kirim setelah (menit)" hint="Dihitung dari DM pertama. Maksimal 1380 menit (23 jam).">
                  <input className="input" type="number" min={1} max={1380} value={r.followup_delay_min} onChange={(e) => set('followup_delay_min', Number(e.target.value))} style={{ maxWidth: 160 }} />
                </Field>
                <Field label="Pesan follow-up">
                  <textarea className="input" rows={2} value={r.followup_message} onChange={(e) => set('followup_message', e.target.value)} />
                </Field>
                <p className="hint">Hanya terkirim jika orangnya sudah menekan tombol / membalas DM dalam 24 jam terakhir. Kalau tidak, statusnya jadi "expired".</p>
              </>
            ) : <p className="hint">Matikan jika tidak perlu pesan susulan.</p>}
          </Section>

          {r.channel === 'comment' && (
            <Section n={6} title="Balasan AI" right={<Switch checked={r.ai_fallback} disabled={!canAi && !r.ai_fallback} onChange={(v) => set('ai_fallback', v)} />}>
              {!canAi ? locked('Balasan AI') : r.ai_fallback ? (
                <Field label="Konteks produk untuk AI" hint="Komentar di post ini yang TIDAK cocok keyword akan dijawab AI di kolom komentar berdasarkan konteks ini.">
                  <textarea className="input" rows={4} value={r.ai_context} onChange={(e) => set('ai_context', e.target.value)} placeholder="Nama produk, harga, cara order, jadwal, FAQ…" />
                </Field>
              ) : <p className="hint">Nyalakan supaya pertanyaan lain di post ini dijawab otomatis oleh AI.</p>}
            </Section>
          )}
        </div>

        <aside className="preview-col">
          <div className="label" style={{ marginBottom: 10 }}>Pratinjau</div>
          <div className="phone">
            <div className="phone-top">
              <span className="avatar" />
              <div><div style={{ fontWeight: 700 }}>@{username}</div><div className="small muted">Instagram</div></div>
            </div>
            <div className="phone-body">
              {r.channel === 'comment' ? (
                <>
                  <div className="sys">Komentar di post</div>
                  <div className="bubble comment"><b>@pembeli</b> {r.match_mode === 'any' ? 'mau dong kak' : `kak ${firstKeyword} dong`}</div>
                  {variants[0] && <div className="bubble comment" style={{ marginLeft: 18 }}><b>@{username}</b> {sample(variants[0])}</div>}
                  <div className="sys">— Direct Message —</div>
                </>
              ) : (
                <div className="bubble them">{r.match_mode === 'any' ? 'halo kak' : firstKeyword}</div>
              )}
              {r.dm_message && <div className="bubble me">{sample(r.dm_message)}</div>}
              {r.dm_button_title && r.dm_content && (
                <>
                  <div className="quick">{r.dm_button_title}</div>
                  <div className="bubble them">{r.dm_button_title}</div>
                  <div className="bubble me">{sample(r.dm_content)}</div>
                </>
              )}
              {r.followup_enabled && r.followup_message && (
                <>
                  <div className="sys">⏰ {r.followup_delay_min} menit kemudian</div>
                  <div className="bubble me">{sample(r.followup_message)}</div>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function Section({ n, title, right, children }: { n: number; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card stack">
      <div className="row between" style={{ flexWrap: 'nowrap' }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="step-num">{n}</span>
          <h2 className="card-title" style={{ margin: 0 }}>{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function KeywordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState('')
  const list = value.split(',').map((s) => s.trim()).filter(Boolean)
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const next = [...list]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next.join(', '))
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) { e.preventDefault(); add(draft) }
    if (e.key === 'Backspace' && !draft && list.length) onChange(list.slice(0, -1).join(', '))
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {list.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {list.map((k) => (
            <span key={k} className="chip on">
              {k}
              <button type="button" aria-label={`hapus ${k}`} style={{ color: 'inherit' }} onClick={() => onChange(list.filter((x) => x !== k).join(', '))}>×</button>
            </span>
          ))}
        </div>
      )}
      <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft.trim() && add(draft)} placeholder="info, harga, link…" />
    </div>
  )
}

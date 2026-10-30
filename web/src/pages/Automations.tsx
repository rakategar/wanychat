import { useCallback, useEffect, useState } from 'react'
import { api, emptyRule, type Account, type Billing, type Media, type Rule } from '../api'
import { Confirm, Empty, Spinner, Switch, useToast } from '../components/ui'
import RuleEditor from './RuleEditor'

export default function Automations({ account, billing }: { account: Account; billing: Billing | null }) {
  const toast = useToast()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [media, setMedia] = useState<Media[] | null>(null)
  const [mediaError, setMediaError] = useState('')
  const [editing, setEditing] = useState<Rule | null>(null)
  const [deleting, setDeleting] = useState<Rule | null>(null)

  const load = useCallback(() => {
    api<{ rules: Rule[] }>('rules.list')
      .then((r) => setRules(r.rules.sort((a, b) => (b.id || 0) - (a.id || 0))))
      .catch((e) => { setRules([]); toast(e.message, 'error') })
  }, [toast])

  useEffect(() => {
    load()
    api<{ media: Media[] }>('ig.media', { limit: 50 }).then((r) => setMedia(r.media)).catch((e) => { setMedia([]); setMediaError(e.message) })
  }, [load])

  const toggle = async (rule: Rule, active: boolean) => {
    setRules((rs) => rs && rs.map((r) => (r.id === rule.id ? { ...r, active } : r)))
    try {
      await api('rules.save', { rule: { ...rule, active } })
      toast(active ? `"${rule.name}" aktif` : `"${rule.name}" dimatikan`)
    } catch (e) {
      toast((e as Error).message, 'error')
      load()
    }
  }

  const remove = async () => {
    if (!deleting) return
    const r = deleting
    setDeleting(null)
    try {
      await api('rules.delete', { id: r.id })
      toast(`"${r.name}" dihapus`)
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (editing) {
    return (
      <RuleEditor
        initial={editing}
        media={media}
        mediaError={mediaError}
        username={account.username}
        plan={billing?.plan || null}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }}
      />
    )
  }

  const thumb = (id: string) => media?.find((m) => m.id === id)
  const limit = billing?.plan.rules || 0
  const full = !!limit && !!rules && rules.length >= limit
  const create = () => (full ? toast(`Paket ${billing?.plan.name} maksimal ${limit} automasi. Upgrade di menu Langganan.`, 'error') : setEditing(emptyRule()))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Automasi</h1>
          <p>Atur keyword pemicu, balasan komentar, DM, tombol, dan follow-up untuk tiap postingan.
            {limit > 0 && rules && <> <b>{rules.length}/{limit}</b> automasi terpakai.</>}</p>
        </div>
        <button className="btn primary" onClick={create}>+ Automasi baru</button>
      </div>

      {!rules ? <Spinner /> : rules.length === 0 ? (
        <Empty icon="⚡" title="Belum ada automasi">
          <p>Contoh: orang komentar <code>info</code> di post, lalu otomatis dapat DM berisi link.</p>
          <button className="btn primary" onClick={create}>Buat automasi pertama</button>
        </Empty>
      ) : (
        <div className="grid two">
          {rules.map((r) => {
            const posts = r.post_ids === '*' ? [] : r.post_ids.split(',').map((s) => s.trim()).filter(Boolean)
            const kws = r.keywords.split(',').map((s) => s.trim()).filter(Boolean)
            return (
              <article key={r.id} className={'card rule-card' + (r.active ? '' : ' off')}>
                <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <span className={'badge ' + (r.channel === 'dm' ? 'blue' : 'pink')}>{r.channel === 'dm' ? '📥 DM' : '💬 Komentar'}</span>
                      {r.dm_button_title && r.dm_content && <span className="badge yellow">👆 Tombol</span>}
                      {r.followup_enabled && <span className="badge orange">⏰ {r.followup_delay_min} mnt</span>}
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

                {r.channel === 'comment' && (
                  <div className="row small">
                    <span className="label">Post:</span>
                    {posts.length === 0 ? <span>semua postingan</span> : (
                      <div className="thumbs">
                        {posts.slice(0, 5).map((id) => {
                          const m = thumb(id)
                          return m ? <img key={id} src={m.thumbnail_url || m.media_url} alt="" /> : <span key={id} className="more">?</span>
                        })}
                        {posts.length > 5 && <span className="more">+{posts.length - 5}</span>}
                      </div>
                    )}
                  </div>
                )}

                <p className="small muted" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  📩 {r.dm_message || '(tanpa DM)'}
                </p>

                <div className="row" style={{ marginTop: 'auto' }}>
                  <button className="btn sm" onClick={() => setEditing(r)}>Edit</button>
                  <button className="btn sm" onClick={() => (full ? create() : setEditing({ ...r, id: undefined, name: r.name + ' (salinan)', active: false }))}>Duplikat</button>
                  <span className="spacer" />
                  <button className="btn sm danger" onClick={() => setDeleting(r)}>Hapus</button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {deleting && (
        <Confirm
          title="Hapus automasi?"
          body={<>Automasi <b>{deleting.name}</b> akan dihapus permanen. Log aktivitasnya tetap tersimpan.</>}
          confirmLabel="Hapus"
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

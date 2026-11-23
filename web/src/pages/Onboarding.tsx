import { useEffect, useState, type ReactNode } from 'react'
import { api, connectUrl, type Me, type Onboarding as Ob, type User } from '../api'
import { Brand, Spinner, useToast } from '../components/ui'
import { ChannelLogo } from '../components/Connect'
import { loadPublicCatalog, planFeatures, rupiahShort, type Plan } from '../plans'

// Onboarding user baru: pilih kanal pertama (atau lihat-lihat dulu) -> untuk siapa -> tahu dari mana -> pilih paket.
// Posisi langkah ada di URL (#/onboarding?step=about) supaya bisa kembali dari halaman izin Instagram/TikTok.
type Step = 'channel' | 'about' | 'source' | 'plan'
const STEPS: Step[] = ['channel', 'about', 'source', 'plan']

const SOURCES: [string, string, string][] = [
  ['search', '🔎', 'Mesin pencari (Google, Bing)'],
  ['instagram', '📸', 'Instagram'],
  ['tiktok', '🎵', 'TikTok'],
  ['friend', '🧑‍🤝‍🧑', 'Dari teman'],
  ['creator', '⭐', 'Dari kreator yang saya ikuti'],
  ['ai_search', '✨', 'AI (ChatGPT, Gemini, Claude, Perplexity)'],
  ['ads', '📣', 'Iklan online'],
  ['agency', '🏢', 'Dari agensi'],
  ['other', '💬', 'Lainnya'],
]

const SIDE: Record<Step, { icon: string; title: string; sub: string }> = {
  channel: { icon: '👋', title: 'Mau mulai dari mana?', sub: 'Tenang, kanal lain bisa dihubungkan nanti.' },
  about: { icon: '🙌', title: 'Sedikit tentang kamu', sub: 'Supaya Wanychat menyiapkan titik awal yang pas.' },
  source: { icon: '📣', title: 'Satu lagi dan selesai!', sub: 'Bantu kami muncul di tempat yang tepat.' },
  plan: { icon: '🚀', title: 'Pilih paket', sub: 'Mulai gratis, naik paket kapan saja.' },
}

const readStep = (): Step => {
  const s = new URLSearchParams(window.location.hash.split('?')[1] || '').get('step') as Step
  return STEPS.includes(s) ? s : 'channel'
}

export default function Onboarding({ me, onUser, onDone }: { me: Me; onUser: (u: User) => void; onDone: (to: string) => void }) {
  const toast = useToast()
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const [step, setStepState] = useState<Step>(() => (me.user.onboarding.step && me.user.onboarding.step !== 'done' && !params.get('step') ? me.user.onboarding.step as Step : readStep()))
  const [error, setError] = useState(params.get('error') || '')
  const connected = params.get('connected') as 'instagram' | 'tiktok' | null
  const [busy, setBusy] = useState('')
  const ob = me.user.onboarding

  useEffect(() => {
    const f = () => { setStepState(readStep()); setError(new URLSearchParams(window.location.hash.split('?')[1] || '').get('error') || '') }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  useEffect(() => { if (connected) toast((connected === 'tiktok' ? 'TikTok' : 'Instagram') + ' terhubung 🎉') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (params.get('claimed') === '1') toast('Automasi & data akun Instagram lamamu ikut terhubung.') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<Ob> & { done?: boolean }) => {
    const r = await api<{ user: User }>('onboarding.save', patch)
    onUser(r.user)
    return r.user
  }
  const goStep = (s: Step) => { window.location.hash = '/onboarding?step=' + s }
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try { await fn() } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
  }

  const side = SIDE[step]
  const linked = me.accounts.length > 0

  return (
    <div className="auth onboarding">
      <aside className="auth-side card tint-yellow">
        <Brand />
        <div className="auth-pitch">
          <div className="ob-icon" aria-hidden>{connected && step === 'about' ? '🎉' : side.icon}</div>
          <h2>{connected && step === 'about' ? (connected === 'tiktok' ? 'TikTok kamu terhubung!' : 'Instagram kamu terhubung!') : side.title}</h2>
          <p style={{ margin: 0 }}>{side.sub}</p>
        </div>
        <ol className="ob-dots" aria-label="Langkah onboarding">
          {STEPS.map((s, i) => <li key={s} className={STEPS.indexOf(step) >= i ? 'on' : ''} aria-current={s === step ? 'step' : undefined} />)}
        </ol>
      </aside>

      <main className="auth-main">
        <div className="ob-body stack">
          {error && <div className="callout pink" role="alert">{error}</div>}

          {step === 'channel' && (
            <>
              <h1 className="auth-title">Hubungkan akun pertamamu</h1>
              {linked && <div className="callout yellow">Sudah terhubung: {me.accounts.map((a) => '@' + a.username).join(', ')}. Kamu bisa lanjut.</div>}
              <ChannelCard icon={<ChannelLogo type="instagram" size={44} />} title="Instagram" desc="Balas komentar jadi DM otomatis, tombol, follow-up, dan balasan AI." busy={busy === 'instagram'}
                onClick={() => run('instagram', async () => { await save({ channel: 'instagram', step: 'channel' }); window.location.href = connectUrl('instagram', 'onboarding') })} />
              <ChannelCard icon={<ChannelLogo type="tiktok" size={44} />} title="TikTok" desc="Kelola komentar video TikTok: balas dan sembunyikan spam dari satu tempat." busy={busy === 'tiktok'}
                onClick={() => run('tiktok', async () => { await save({ channel: 'tiktok', step: 'channel' }); window.location.href = connectUrl('tiktok', 'onboarding') })} />
              <button className="btn ghost" disabled={!!busy} onClick={() => run('explore', async () => { await save({ channel: ob.channel || 'explore', step: 'about' }); goStep('about') })}>
                {linked ? 'Lanjut →' : 'Lihat-lihat dulu tanpa menghubungkan →'}
              </button>
              <p className="hint" style={{ margin: 0 }}>Instagram harus akun Profesional (Kreator/Bisnis). Kamu masuk lewat halaman resmi Instagram/TikTok; Wanychat tidak pernah melihat password-nya.</p>
            </>
          )}

          {step === 'about' && (
            <>
              <h1 className="auth-title">Akun ini untuk siapa?</h1>
              <div className="stack" role="radiogroup">
                {([['employer', '💼', 'Untuk kantor / tempat kerja'], ['myself', '💡', 'Untuk diri sendiri'], ['client', '🤝', 'Untuk klien']] as const).map(([v, icon, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={ob.for_whom === v} className={'ob-option' + (ob.for_whom === v ? ' on' : '')} disabled={!!busy}
                    onClick={() => run(v, async () => { await save({ for_whom: v, step: 'source' }); goStep('source') })}>
                    <span aria-hidden>{icon}</span> {label} {busy === v ? <Spinner /> : <span className="ob-radio" aria-hidden />}
                  </button>
                ))}
              </div>
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => goStep('channel')}>← Kembali</button>
            </>
          )}

          {step === 'source' && <SourceStep initial={ob.heard_from || []} busy={busy === 'source'} back={() => goStep('about')}
            next={(list) => run('source', async () => { await save({ heard_from: list, step: 'plan' }); goStep('plan') })} />}

          {step === 'plan' && <PlanStep busy={busy} back={() => goStep('source')}
            choose={(plan) => run(plan.id, async () => { await save({ step: 'done', done: true }); onDone(plan.price ? '/billing?plan=' + plan.id : '/dashboard') })} />}
        </div>
      </main>
    </div>
  )
}

function ChannelCard({ icon, title, desc, onClick, busy }: { icon: ReactNode; title: string; desc: string; onClick: () => void; busy: boolean }) {
  return (
    <button type="button" className="card ob-channel" onClick={onClick} disabled={busy}>
      <span className="ob-channel-icon" aria-hidden>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <b style={{ fontSize: 20 }}>{title}</b>
        <span className="small muted" style={{ display: 'block' }}>{desc}</span>
      </span>
      {busy ? <Spinner /> : <span aria-hidden>→</span>}
    </button>
  )
}

function SourceStep({ initial, busy, back, next }: { initial: string[]; busy: boolean; back: () => void; next: (list: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(initial)
  const toggle = (k: string) => setSel(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k])
  return (
    <>
      <h1 className="auth-title">Tahu Wanychat dari mana?</h1>
      <div className="stack" style={{ gap: 10 }}>
        {SOURCES.map(([k, icon, label]) => (
          <label key={k} className={'ob-option' + (sel.includes(k) ? ' on' : '')}>
            <span aria-hidden>{icon}</span> {label}
            <input type="checkbox" checked={sel.includes(k)} onChange={() => toggle(k)} />
          </label>
        ))}
      </div>
      <div className="row between">
        <button className="btn ghost sm" onClick={back}>← Kembali</button>
        <button className="btn primary" disabled={busy} onClick={() => next(sel)}>{busy ? <Spinner /> : 'Lanjut'}</button>
      </div>
    </>
  )
}

function PlanStep({ busy, back, choose }: { busy: string; back: () => void; choose: (p: Plan) => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  useEffect(() => { loadPublicCatalog().then((c) => setPlans(c.plans)) }, [])
  if (!plans) return <Spinner />
  const free = plans.find((p) => p.price === 0)
  return (
    <>
      <h1 className="auth-title">Pilih paket kamu</h1>
      <div className="grid ob-plans">
        {plans.filter((p) => p.price > 0).map((p) => (
          <article key={p.id} className={'card plan' + (p.id === 'pro' ? ' tint-yellow featured' : '')}>
            {p.id === 'pro' && <span className="badge dark plan-tag">Paling laris</span>}
            <h3>{p.name}</h3>
            <div className="plan-price">{rupiahShort(p.price)}<span>/bulan</span></div>
            <ul className="plan-list">{planFeatures(p).slice(0, 5).map((f) => <li key={f}>{f}</li>)}</ul>
            <button className={'btn ' + (p.id === 'pro' ? 'dark' : '')} style={{ marginTop: 'auto' }} disabled={!!busy} onClick={() => choose(p)}>
              {busy === p.id ? <Spinner /> : 'Pilih ' + p.name}
            </button>
          </article>
        ))}
      </div>
      <div className="row between">
        <button className="btn ghost sm" onClick={back}>← Kembali</button>
        {free && (
          <button className="btn" disabled={!!busy} onClick={() => choose(free)}>
            {busy === free.id ? <Spinner /> : 'Lanjut dengan paket ' + free.name}
          </button>
        )}
      </div>
      <p className="hint" style={{ margin: 0 }}>Paket berbayar dibayar per bulan lewat Virtual Account, minimarket, atau e-wallet. Tanpa tagihan otomatis.</p>
    </>
  )
}

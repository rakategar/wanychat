import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={props.htmlFor}>{props.label}</label>
      {props.children}
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  )
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="track" aria-hidden />
      {props.label && <span>{props.label}</span>}
    </label>
  )
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner() {
  return <span className="spin" aria-label="memuat" />
}

export function Empty(props: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden>{props.icon}</div>
      <h3 style={{ margin: '8px 0 4px' }}>{props.title}</h3>
      {props.children && <div className="muted">{props.children}</div>}
    </div>
  )
}

export function Confirm(props: { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={props.onCancel}>
      <div className="card modal stack" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">{props.title}</h3>
        <div className="muted">{props.body}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={props.onCancel}>Batal</button>
          <button className="btn danger" onClick={props.onConfirm} autoFocus>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ----- Toasts -----
type Toast = { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.kind === 'error' ? 'error' : '')}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ----- Formatting -----
export function timeAgo(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso).getTime()
  const s = Math.round((Date.now() - d) / 1000)
  if (s < 0) {
    const m = Math.round(-s / 60)
    return m < 60 ? `dalam ${m} mnt` : `dalam ${Math.round(m / 60)} jam`
  }
  if (s < 60) return 'baru saja'
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const EVENT_META: Record<string, { label: string; color: string; icon: string }> = {
  comment_in: { label: 'Komentar masuk', color: 'blue', icon: '💬' },
  comment_reply: { label: 'Balas komentar', color: 'purple', icon: '↩️' },
  private_reply: { label: 'DM pertama', color: 'pink', icon: '📩' },
  button_tap: { label: 'Tombol ditekan', color: 'yellow', icon: '👆' },
  dm_in: { label: 'DM masuk', color: 'blue', icon: '📥' },
  dm_out: { label: 'DM terkirim', color: 'pink', icon: '📤' },
  ai_reply: { label: 'Balasan AI', color: 'green', icon: '✨' },
  followup: { label: 'Follow-up', color: 'orange', icon: '⏰' },
}

export function Brand({ size = 20 }: { size?: number }) {
  return (
    <div className="brand" style={{ fontSize: size }}>
      <span className="brand-mark" aria-hidden>W</span> Wanychat
    </div>
  )
}

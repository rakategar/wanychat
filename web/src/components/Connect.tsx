import { connectUrl, type SocialAccount } from '../api'
import { Empty } from './ui'

export const CHANNEL: Record<SocialAccount['type'], { icon: string; label: string }> = {
  instagram: { icon: '📸', label: 'Instagram' },
  tiktok: { icon: '🎵', label: 'TikTok' },
}

// Tombol hubungkan akun sosial (halaman izin resmi Instagram / TikTok)
export function ConnectButtons({ only }: { only?: SocialAccount['type'] }) {
  return (
    <div className="row">
      {(only ? [only] : (['instagram', 'tiktok'] as const)).map((t) => (
        <a key={t} className={'btn ' + (t === 'instagram' ? 'ig-btn' : 'dark')} href={connectUrl(t)}>
          <span aria-hidden>{CHANNEL[t].icon}</span> Hubungkan {CHANNEL[t].label}
        </a>
      ))}
    </div>
  )
}

// Halaman yang butuh akun Instagram tapi user belum menghubungkannya
export function NeedInstagram({ what }: { what: string }) {
  return (
    <section className="card">
      <Empty icon="📸" title="Hubungkan Instagram dulu">
        <p style={{ marginTop: 0 }}>{what} butuh akun Instagram Profesional (Kreator/Bisnis) yang terhubung.</p>
        <div style={{ display: 'flex', justifyContent: 'center' }}><ConnectButtons only="instagram" /></div>
      </Empty>
    </section>
  )
}

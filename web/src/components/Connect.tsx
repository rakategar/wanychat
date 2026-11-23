import { connectUrl, type SocialAccount } from '../api'
import { Empty } from './ui'

export const CHANNEL: Record<SocialAccount['type'], { label: string }> = {
  instagram: { label: 'Instagram' },
  tiktok: { label: 'TikTok' },
}

// Logo resmi kanal (public/brand/*.png)
export function ChannelLogo({ type, size = 18 }: { type: SocialAccount['type']; size?: number }) {
  return <img className="ch-logo" src={`/brand/${type}.png`} width={size} height={size} alt={CHANNEL[type].label} />
}

// Tombol hubungkan akun sosial (halaman izin resmi Instagram / TikTok)
export function ConnectButtons({ only }: { only?: SocialAccount['type'] }) {
  return (
    <div className="row">
      {(only ? [only] : (['instagram', 'tiktok'] as const)).map((t) => (
        <a key={t} className={'btn ' + (t === 'instagram' ? 'ig-btn' : 'tt-btn')} href={connectUrl(t)}>
          <ChannelLogo type={t} size={20} /> Hubungkan {CHANNEL[t].label}
        </a>
      ))}
    </div>
  )
}

// Halaman yang butuh akun Instagram tapi user belum menghubungkannya
export function NeedInstagram({ what }: { what: string }) {
  return (
    <section className="card">
      <Empty icon={<ChannelLogo type="instagram" size={44} />} title="Hubungkan Instagram dulu">
        <p style={{ marginTop: 0 }}>{what} butuh akun Instagram Profesional (Kreator/Bisnis) yang terhubung.</p>
        <div style={{ display: 'flex', justifyContent: 'center' }}><ConnectButtons only="instagram" /></div>
      </Empty>
    </section>
  )
}

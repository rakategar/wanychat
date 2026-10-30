import { useInstall } from '../pwa'
import { useToast } from './ui'

// Tombol "Pasang aplikasi" (PWA). Android/desktop: prompt bawaan browser. iPhone: petunjuk Safari.
export function InstallButton({ className = 'btn sm' }: { className?: string }) {
  const toast = useToast()
  const app = useInstall()
  if (app.installed || (!app.canInstall && !app.ios)) return null
  const onClick = async () => {
    if (app.canInstall) {
      if (await app.install()) toast('Wanychat terpasang di layar utama')
    } else {
      toast('Di Safari: tekan tombol Bagikan (kotak dengan panah), lalu “Tambah ke Layar Utama”.')
    }
  }
  return <button className={className} onClick={onClick}>📲 Pasang aplikasi</button>
}

export function InstallCard() {
  const app = useInstall()
  return (
    <section className="card stack tint-blue">
      <div>
        <h2 className="card-title">Aplikasi Wanychat</h2>
        <p className="card-sub" style={{ margin: 0, color: 'inherit' }}>
          {app.installed
            ? 'Sudah terpasang di perangkat ini. Buka dari ikon Wanychat di layar utama.'
            : app.canInstall || app.ios
              ? 'Pasang di HP atau laptop supaya dasbor terbuka seperti aplikasi, tanpa mengetik alamat.'
              : 'Buka wanychat.remot.in di Chrome (Android/PC) atau Safari (iPhone) untuk memasang aplikasi.'}
        </p>
      </div>
      <InstallButton className="btn" />
    </section>
  )
}

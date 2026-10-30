import { useEffect, useState } from 'react'
import { LOGIN_URL } from '../api'
import { Brand } from '../components/ui'
import { InstallButton } from '../components/Install'
import { DEFAULT_PLANS, fmt, loadPublicPlans, planFeatures, rupiahShort, type Plan } from '../plans'

// Halaman publik: tidak memanggil API sama sekali (setiap panggilan = 1 eksekusi n8n)

// Tampilan per paket; harga & kuota dari /plans.json (diatur superadmin), cadangan DEFAULT_PLANS
const LOOK: Record<string, { tint: string; pitch: string; tag?: string }> = {
  free: { tint: '', pitch: 'Coba dulu, tanpa kartu kredit.' },
  kreator: { tint: 'tint-blue', pitch: 'Untuk kreator & toko yang baru jalan.' },
  pro: { tint: 'tint-yellow', pitch: 'Untuk jualan harian & launching.', tag: 'Paling laris' },
  bisnis: { tint: 'tint-pink', pitch: 'Untuk brand dengan volume DM tinggi.' },
}

const FEATURES = [
  { icon: '💬', tint: 'tint-blue', title: 'Komentar jadi DM', desc: 'Orang komentar "info", "mau", atau "harga", langsung dapat DM. Walau belum pernah chat kamu.' },
  { icon: '👆', tint: 'tint-yellow', title: 'Tombol di DM', desc: 'DM pertama berisi tombol. Sekali ditekan, kamu bisa kirim link, katalog, dan pesan lanjutan.' },
  { icon: '✨', tint: 'tint-green', title: 'AI yang ngerti produkmu', desc: 'Komentar yang tidak cocok keyword? AI menjawab sesuai info produk yang kamu tulis.' },
  { icon: '⏰', tint: 'tint-pink', title: 'Follow-up otomatis', desc: 'Kirim pengingat beberapa jam kemudian ke yang sudah tekan tombol. Closing jalan terus.' },
  { icon: '🎯', tint: 'tint-purple', title: 'Pilih postingan', desc: 'Atur automasi untuk semua postingan atau hanya reels tertentu, langsung dari galeri.' },
  { icon: '🔒', tint: 'tint-blue', title: 'Login Instagram resmi', desc: 'Pakai login resmi Instagram. Tanpa password, tanpa token, tanpa setelan teknis.' },
]

const compare = (pro: Plan): [string, string, string][] => [
  ['Harga paket menengah', `${rupiahShort(pro.price)} / bulan`, '± Rp 480rb / bulan (Pro, $29)'],
  ['Balasan AI', `Termasuk (${fmt(pro.ai)} / bulan)`, 'Add-on berbayar terpisah'],
  ['Bahasa & bantuan', 'Bahasa Indonesia', 'Bahasa Inggris'],
  ['Mata uang', 'Rupiah', 'Dolar AS (USD)'],
]

const FAQ = [
  {
    q: 'Akun Instagram pribadi bisa?',
    a: <>Instagram hanya mengizinkan balas otomatis untuk akun <b>Profesional</b> (Kreator atau Bisnis). Mengubahnya gratis dan 1 menit:
      Profil → ☰ → <b>Pengaturan dan privasi</b> → <b>Jenis akun dan alat</b> → <b>Beralih ke akun profesional</b> → pilih <b>Kreator</b>.
      Pengikut, postingan, dan DM tetap sama. Akun tidak boleh privat.</>,
  },
  {
    q: 'Apakah aman? Password saya disimpan?',
    a: <>Tidak. Kamu masuk lewat halaman resmi Instagram, lalu Instagram memberi izin terbatas (baca komentar & kirim pesan). Izin bisa dicabut kapan saja dari pengaturan Instagram.</>,
  },
  {
    q: 'Kenapa harus pakai tombol di DM?',
    a: <>Aturan Instagram: ke orang yang belum pernah chat, kamu hanya boleh kirim 1 DM per komentar. Saat dia menekan tombol, terbuka jendela chat 24 jam, jadi link dan follow-up bisa terkirim.</>,
  },
  {
    q: 'Yang dihitung "DM otomatis" apa saja?',
    a: <>Setiap pesan yang dikirim sistem: DM pertama dari komentar, isi setelah tombol ditekan, follow-up, dan balasan DM otomatis. Balasan komentar publik tidak dihitung.</>,
  },
  {
    q: 'Bisa berhenti kapan saja?',
    a: <>Bisa. Paket berbayar diperpanjang otomatis tiap bulan lewat Midtrans, dan bisa kamu hentikan kapan saja dari menu Langganan. Paket tetap aktif sampai akhir periode.</>,
  },
  {
    q: 'Bisa dipasang di HP seperti aplikasi?',
    a: <>Bisa. Buka Wanychat di Chrome (Android) lalu pilih <b>Pasang aplikasi</b>, atau di Safari (iPhone) tekan <b>Bagikan → Tambah ke Layar Utama</b>.</>,
  },
]

function IgButton({ label, className = '' }: { label: string; className?: string }) {
  return (
    <a className={'btn ig-btn ' + className} href={LOGIN_URL}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
      </svg>
      {label}
    </a>
  )
}

export default function Landing({ error, signedIn }: { error?: string; signedIn: boolean }) {
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS)
  useEffect(() => { loadPublicPlans().then(setPlans) }, [])
  const pro = plans.find((p) => p.id === 'pro') || plans[plans.length - 1]
  const cta = (p: Plan) => (signedIn ? (p.price ? '#/billing' : '#/dashboard') : LOGIN_URL)
  return (
    <div className="landing">
      <header className="lp-nav">
        <a href="#/" className="brand-link"><Brand /></a>
        <nav className="lp-links">
          <a href="#fitur">Fitur</a>
          <a href="#harga">Harga</a>
          <a href="#faq">FAQ</a>
        </nav>
        {signedIn
          ? <a className="btn sm dark" href="#/dashboard">Buka dasbor</a>
          : <a className="btn sm dark" href={LOGIN_URL}>Masuk</a>}
      </header>

      <section className="lp-hero">
        <div className="stack" style={{ gap: 20 }}>
          <span className="badge yellow" style={{ alignSelf: 'flex-start' }}>Auto-DM Instagram · buatan Indonesia</span>
          <h1>Komentar masuk, <mark>DM terkirim</mark>, kamu tinggal closing.</h1>
          <p className="lead">
            Wanychat membalas komentar dan DM Instagram kamu secara otomatis, 24 jam. Cukup login dengan Instagram,
            tulis keyword, selesai. Fitur seperti ManyChat, harga mulai Rp 0.
          </p>
          {error && <div className="callout pink" role="alert">{error}</div>}
          <div className="row hero-cta">
            <IgButton label="Mulai gratis dengan Instagram" />
            <a className="btn" href="#harga">Lihat harga</a>
          </div>
          <p className="hint">Untuk akun Instagram Kreator atau Bisnis. Tanpa kartu kredit. <InstallButton className="linklike" /></p>
        </div>

        <div className="phone lp-phone" aria-label="Contoh percakapan otomatis">
          <div className="phone-top">
            <span className="avatar" style={{ background: 'var(--yellow)' }} />
            <div><b>tokokamu</b><div className="small muted">Instagram</div></div>
          </div>
          <div className="phone-body">
            <div className="bubble comment"><b>@rina.belanja</b> mau kak, harganya berapa?</div>
            <div className="sys">↳ dibalas: "Udah aku kirim ke DM kak! ✨"</div>
            <div className="bubble me">Halo Rina! Makasih udah komen 😊 Tekan tombol di bawah ya, nanti aku kirim katalognya.</div>
            <div className="quick">Kirim katalognya 👉</div>
            <div className="bubble them">Kirim katalognya 👉</div>
            <div className="bubble me">Ini katalog + harga lengkapnya kak: tokokamu.id/katalog 🛍️</div>
            <div className="sys">⏰ follow-up terjadwal 2 jam lagi</div>
          </div>
        </div>
      </section>

      <section className="lp-strip">
        {[['1', 'Login dengan Instagram'], ['2', 'Tulis keyword & pesan'], ['3', 'Biarkan Wanychat bekerja']].map(([n, t]) => (
          <div key={n} className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="step-num">{n}</span><b>{t}</b>
          </div>
        ))}
      </section>

      <section id="fitur" className="lp-section">
        <h2>Semua yang kamu butuhkan untuk jualan lewat komentar</h2>
        <div className="grid lp-features">
          {FEATURES.map((f) => (
            <article key={f.title} className="card">
              <div className={'lp-icon card ' + f.tint} aria-hidden>{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="muted">{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="harga" className="lp-section">
        <h2>Harga jujur, dalam Rupiah</h2>
        <p className="lead" style={{ marginTop: -8 }}>Mulai gratis. Naik paket kalau DM-nya sudah ramai.</p>
        <div className="grid lp-plans">
          {plans.map((p) => {
            const look = LOOK[p.id] || { tint: '', pitch: '' }
            return (
              <article key={p.id} className={'card plan ' + look.tint + (look.tag ? ' featured' : '')}>
                {look.tag && <span className="badge dark plan-tag">{look.tag}</span>}
                <h3>{p.name}</h3>
                <div className="plan-price">{rupiahShort(p.price)}<span>{p.price ? '/bulan' : ''}</span></div>
                {look.pitch && <p className="small">{look.pitch}</p>}
                <ul className="plan-list">
                  {planFeatures(p).map((f) => <li key={f}>{f}</li>)}
                </ul>
                <a className={'btn ' + (look.tag ? 'dark' : '')} href={cta(p)} style={{ marginTop: 'auto' }}>
                  {p.price ? 'Pilih ' + p.name : 'Mulai gratis'}
                </a>
              </article>
            )
          })}
        </div>
        <p className="hint" style={{ marginTop: 16 }}>Harga per akun Instagram per bulan, sudah termasuk biaya server dan AI. Diperpanjang otomatis, bisa dihentikan kapan saja.</p>

        <div className="card lp-compare">
          <h3 style={{ marginTop: 0 }}>Wanychat vs ManyChat</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th></th><th>Wanychat</th><th>ManyChat</th></tr></thead>
              <tbody>
                {compare(pro).map(([k, a, b]) => (
                  <tr key={k}><td>{k}</td><td><b>{a}</b></td><td className="muted">{b}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>Harga ManyChat dari halaman harga publik mereka (Oktober 2026), kurs ± Rp 16.500/USD.</p>
        </div>
      </section>

      <section id="faq" className="lp-section">
        <h2>Pertanyaan yang sering muncul</h2>
        <div className="stack">
          {FAQ.map((f) => (
            <details key={f.q} className="card faq">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <div className="card tint-yellow lp-cta">
          <h2 style={{ margin: 0 }}>Komentar berikutnya bisa jadi pembeli.</h2>
          <IgButton label="Mulai gratis dengan Instagram" />
        </div>
      </section>

      <footer className="lp-foot">
        <Brand />
        <span className="small muted">© {new Date().getFullYear()} Wanychat. Tidak berafiliasi dengan Instagram, Meta, atau ManyChat.</span>
      </footer>
    </div>
  )
}

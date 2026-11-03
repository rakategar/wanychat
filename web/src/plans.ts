// Paket langganan. Nilai bawaan sama dengan n8n/code/lib_plans.js; versi terbaru dibaca dari /plans.json (diatur superadmin).
export interface Plan {
  id: string
  name: string
  price: number
  dm: number
  ai: number
  rules: number
  followup: boolean
  persona: boolean
  accounts: number
  analytics: boolean
  watermark: boolean
}

export interface Topup {
  id: string
  credits: number
  price: number
}

export const DEFAULT_PLANS: Plan[] = [
  { id: 'free', name: 'Gratis', price: 0, dm: 100, ai: 0, rules: 3, followup: false, persona: false, accounts: 1, analytics: false, watermark: true },
  { id: 'kreator', name: 'Kreator', price: 49000, dm: 1000, ai: 50, rules: 0, followup: true, persona: false, accounts: 1, analytics: false, watermark: false },
  { id: 'pro', name: 'Pro', price: 99000, dm: 5000, ai: 1000, rules: 0, followup: true, persona: true, accounts: 2, analytics: false, watermark: false },
  { id: 'bisnis', name: 'Bisnis', price: 249000, dm: 20000, ai: 5000, rules: 0, followup: true, persona: true, accounts: 5, analytics: true, watermark: false },
]

export const DEFAULT_TOPUPS: Topup[] = [
  { id: 'ai100', credits: 100, price: 10000 },
  { id: 'ai500', credits: 500, price: 39000 },
  { id: 'ai2000', credits: 2000, price: 129000 },
]

export const rupiah = (n: number) => (n < 0 ? '−Rp ' : 'Rp ') + Math.abs(Math.round(n)).toLocaleString('id-ID')
export const rupiahShort = (n: number) => (n === 0 ? 'Rp 0' : n % 1000 === 0 && n < 1_000_000 ? `Rp ${n / 1000}rb` : rupiah(n))
export const fmt = (n: number) => Math.round(n).toLocaleString('id-ID')

export function planFeatures(p: Plan): string[] {
  const accounts = p.accounts || 1
  return [
    accounts > 1 ? `${accounts} akun Instagram (kuota dibagi)` : '1 akun Instagram',
    p.rules ? `${p.rules} automasi` : 'Automasi tanpa batas',
    `${fmt(p.dm)} DM otomatis / bulan`,
    'Balas komentar + DM + tombol',
    ...(p.followup ? ['Follow-up DM'] : []),
    p.ai ? `${fmt(p.ai)} balasan AI / bulan` : 'Balasan AI lewat top-up kredit',
    ...(p.persona ? ['Persona AI sesuai brand'] : []),
    ...(p.analytics ? ['Dasbor analitik lead & postingan'] : []),
    ...(p.watermark ? ['DM berisi tanda "via Wanychat"'] : ['DM tanpa tanda Wanychat']),
  ]
}

type PublicPlans = { plans: Plan[]; topups: Topup[] }
let cached: Promise<PublicPlans> | null = null
// Di-cache CDN (s-maxage), jadi jarang memicu eksekusi n8n
export function loadPublicCatalog(): Promise<PublicPlans> {
  const fallback = { plans: DEFAULT_PLANS, topups: DEFAULT_TOPUPS }
  cached ??= fetch('/plans.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && Array.isArray(d.plans) && d.plans.length
      ? { plans: d.plans as Plan[], topups: Array.isArray(d.topups) && d.topups.length ? (d.topups as Topup[]) : DEFAULT_TOPUPS }
      : fallback))
    .catch(() => fallback)
  return cached
}

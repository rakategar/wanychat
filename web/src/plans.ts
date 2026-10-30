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
}

export const DEFAULT_PLANS: Plan[] = [
  { id: 'free', name: 'Gratis', price: 0, dm: 100, ai: 0, rules: 3, followup: false, persona: false },
  { id: 'kreator', name: 'Kreator', price: 49000, dm: 1000, ai: 300, rules: 0, followup: true, persona: false },
  { id: 'pro', name: 'Pro', price: 99000, dm: 5000, ai: 2000, rules: 0, followup: true, persona: true },
  { id: 'bisnis', name: 'Bisnis', price: 249000, dm: 20000, ai: 10000, rules: 0, followup: true, persona: true },
]

export const rupiah = (n: number) => (n < 0 ? '−Rp ' : 'Rp ') + Math.abs(Math.round(n)).toLocaleString('id-ID')
export const rupiahShort = (n: number) => (n === 0 ? 'Rp 0' : n % 1000 === 0 && n < 1_000_000 ? `Rp ${n / 1000}rb` : rupiah(n))
export const fmt = (n: number) => Math.round(n).toLocaleString('id-ID')

export function planFeatures(p: Plan): string[] {
  return [
    '1 akun Instagram',
    p.rules ? `${p.rules} automasi` : 'Automasi tanpa batas',
    `${fmt(p.dm)} DM otomatis / bulan`,
    'Balas komentar + DM + tombol',
    ...(p.followup ? ['Follow-up DM'] : []),
    ...(p.ai ? [`${fmt(p.ai)} balasan AI / bulan`] : []),
    ...(p.persona ? ['Persona AI sesuai brand'] : []),
  ]
}

let cached: Promise<Plan[]> | null = null
// Di-cache CDN (s-maxage), jadi jarang memicu eksekusi n8n
export function loadPublicPlans(): Promise<Plan[]> {
  cached ??= fetch('/plans.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && Array.isArray(d.plans) && d.plans.length ? (d.plans as Plan[]) : DEFAULT_PLANS))
    .catch(() => DEFAULT_PLANS)
  return cached
}

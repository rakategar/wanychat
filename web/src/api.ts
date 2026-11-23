import type { Plan } from './plans'

// Client for the "Wanychat · Admin API" webhook in n8n (proxied as /api by Vite locally, by vercel.json in production)

export type Channel = 'comment' | 'dm'
export type MatchMode = 'contains' | 'exact' | 'any'

export interface Rule {
  id?: number
  name: string
  active: boolean
  channel: Channel
  post_ids: string
  keywords: string
  match_mode: MatchMode
  comment_replies: string
  dm_message: string
  dm_button_title: string
  dm_content: string
  followup_enabled: boolean
  followup_delay_min: number
  followup_message: string
  ai_fallback: boolean
  ai_context: string
  createdAt?: string
  updatedAt?: string
}

export interface EventRow {
  id: number
  type: string
  status: string
  rule_id: string
  rule_name: string
  ig_user_id: string
  username: string
  ref_id: string
  media_id: string
  text: string
  error: string
  createdAt: string
}

export interface Followup {
  id: number
  ig_user_id: string
  username: string
  rule_id: string
  due_at: string
  message: string
  status: 'pending' | 'sent' | 'expired' | 'error'
  sent_at: string | null
  error: string
  createdAt: string
}

export interface Account {
  ig_user_id: string
  username: string
  name: string
  avatar: string
  token_expires_at: string
  token_refresh_error: string
  ai_enabled: boolean
  ai_persona: string
  connected_at: string
  owner_id: string
}

// Akun Wanychat (login email/password atau Google); akun sosial terhubung ke sini
export interface Onboarding {
  step?: 'channel' | 'about' | 'source' | 'plan' | 'done'
  channel?: 'instagram' | 'tiktok' | 'explore'
  for_whom?: 'employer' | 'myself' | 'client'
  heard_from?: string[]
  done?: boolean
}

export interface User {
  uid: string
  email: string
  name: string
  avatar: string
  email_verified: boolean
  has_password: boolean
  has_google: boolean
  onboarding: Onboarding
  marketing_opt_in: boolean
}

// Akun sosial (Instagram / TikTok) milik user; kuota paket dipakai bersama
export interface SocialAccount {
  type: 'instagram' | 'tiktok'
  id: string
  username: string
  name: string
  avatar: string
  current: boolean
  active: boolean
  connected_at: string
  token_refresh_error: string
}

export interface TikTokAccount {
  open_id: string
  username: string
  display_name: string
  avatar: string
  connected_at: string
  token_refresh_error: string
}

export interface Me {
  user: User
  account: Account | null
  tiktok: TikTokAccount | null
  accounts: SocialAccount[]
  billing: Billing
  announcement: string
}

export interface Media {
  id: string
  caption?: string
  media_type: string
  media_product_type?: string
  media_url?: string
  thumbnail_url?: string
  permalink: string
  timestamp: string
  comments_count?: number
  like_count?: number
}

export interface Profile {
  user_id: string
  username: string
  name?: string
  profile_picture_url?: string
  followers_count?: number
  media_count?: number
}

export interface Billing {
  plan: Plan
  subscribed_plan: string
  status: string
  period_end: string
  auto_renew: boolean
  cancel_at_period_end: boolean
  card_hint: string
  source: string
  usage: { dm: number; ai: number }
  month: string
  rules_used: number
  credits: number
  accounts_limit: number
  accounts_used: number
  group_inactive: boolean
  is_owner: boolean
  owner_username: string
}

export interface Analytics {
  days: number
  since: string
  events: number
  truncated: boolean
  totals: {
    comments: number; matched: number; dms: number; taps: number; followups: number; ai: number; dm_in: number
    errors: number; quota: number; leads: number; commenters: number; match_rate: number; tap_rate: number
  }
  funnel: { key: string; label: string; value: number }[]
  series: { date: string; comments: number; leads: number; dms: number; taps: number }[]
  posts: { media_id: string; comments: number; commenters: number; matched: number; dms: number; taps: number; ai: number; leads: number; tap_rate: number }[]
  rules: { rule_id: string; name: string; matched: number; dms: number; taps: number; followups: number; ai: number; tap_rate: number }[]
  hours: number[][]
  words: { word: string; count: number }[]
  leads: { ig_user_id: string; username: string; score: number; comments: number; taps: number; dms_in: number; posts: string[]; first_at: string; last_at: string; last_text: string }[]
}

export interface Payment {
  order_id: string
  plan: string
  amount: number
  status: string
  payment_type: string
  kind: string
  credits?: number
  paid_at: string | null
  createdAt: string
  pay_url?: string
}

// Login akun Wanychat (email/password lewat /auth, atau Google): n8n memasang cookie sesi HttpOnly.
// Instagram & TikTok hanya ditautkan ke akun yang sedang login (halaman izin resmi masing-masing).
export const GOOGLE_URL = '/webhook/wany-google'
export const IG_CONNECT_URL = '/webhook/wany-login'
export const TT_CONNECT_URL = '/webhook/wany-tiktok-start'
export const connectUrl = (type: SocialAccount['type'], from?: 'onboarding') =>
  (type === 'tiktok' ? TT_CONNECT_URL : IG_CONNECT_URL) + (from ? '?from=' + from : '')

export class ApiError extends Error {
  data?: Record<string, unknown>
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T = Record<string, unknown>>(action: string, payload?: unknown): Promise<T> {
  return post<T>('/api', {}, action, payload)
}

// Daftar / masuk / OTP / reset password (tanpa sesi)
export async function authApi<T = Record<string, unknown>>(action: string, payload?: unknown): Promise<T> {
  return post<T>('/auth', {}, action, payload)
}

// API superadmin: cookie wany_sa (Path=/sa-api, SameSite=Strict) + header khusus anti-CSRF
export async function saApi<T = Record<string, unknown>>(action: string, payload?: unknown): Promise<T> {
  return post<T>('/sa-api', { 'x-wany-sa': '1' }, action, payload)
}

async function post<T>(url: string, headers: Record<string, string>, action: string, payload?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      credentials: 'same-origin',
      body: JSON.stringify({ action, payload }),
    })
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi internet kamu.', 0)
  }
  let data: { ok?: boolean; error?: string } & Record<string, unknown>
  try {
    data = await res.json()
  } catch {
    throw new ApiError(`Server sedang bermasalah (HTTP ${res.status}). Coba lagi sebentar lagi.`, res.status)
  }
  if (!data.ok) throw Object.assign(new ApiError(data.error || 'Permintaan gagal', res.status), { data })
  return data as T
}

// Pindah dasbor ke akun sosial lain milik user (sesi login yang sama)
export async function switchAccount(a: Pick<SocialAccount, 'type' | 'id'>) {
  await api('accounts.switch', { type: a.type, id: a.id })
  window.location.hash = a.type === 'tiktok' ? '#/tiktok' : '#/dashboard'
  window.location.reload()
}

export const emptyRule = (): Rule => ({
  name: '',
  active: true,
  channel: 'comment',
  post_ids: '*',
  keywords: '',
  match_mode: 'contains',
  comment_replies: 'Cek DM ya {username} 🙌\nUdah aku kirim ke DM kak!\nSiap kak, cek inbox ya ✨',
  dm_message: 'Halo {nama}! Makasih udah komen 😊 Tekan tombol di bawah ya, nanti aku kirim detailnya.',
  dm_button_title: 'Kirim detailnya 👉',
  dm_content: '',
  followup_enabled: false,
  followup_delay_min: 60,
  followup_message: 'Halo kak, gimana? Ada yang mau ditanyain lagi? 😊',
  ai_fallback: false,
  ai_context: '',
})

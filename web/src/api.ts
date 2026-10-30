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

// Login lewat Instagram: n8n memasang cookie sesi HttpOnly, browser mengirimnya otomatis ke /api
export const LOGIN_URL = '/webhook/wany-login'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T = Record<string, unknown>>(action: string, payload?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
  if (!data.ok) throw new ApiError(data.error || 'Permintaan gagal', res.status)
  return data as T
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

import type { Plan } from '../plans'

export interface MonthRow {
  month: string
  revenue: number
  fees: number
  ai_tokens: number
  ai_cost: number
  fixed_cost: number
  profit: number
  payments: number
  new_users: number
}

export interface AuditRow {
  id: number
  actor: string
  action: string
  target: string
  detail: string
  ip: string
  createdAt: string
}

export interface Overview {
  month: string
  usd_idr: number
  totals: {
    users: number; paid_users: number; suspended: number; active_7d: number; new_this_month: number
    mrr: number; auto_renew: number; canceled: number; past_due: number; rules: number
  }
  plans: { id: string; name: string; price: number; users: number }[]
  months: MonthRow[]
  usage: { dm: number; ai: number; ai_tokens: number; comments: number; top_ai: { username: string; ai: number; ai_tokens: number; limit: number }[] }
  health: {
    engine_enabled: boolean; signup_open: boolean; ai_enabled: boolean; midtrans: string; meta_app: boolean
    errors_24h: Record<string, number>; token_errors: string[]; token_expiring: string[]; last_event_at: string; over_quota: string[]
  }
  audit: AuditRow[]
}

export interface UserRow {
  ig_user_id: string
  username: string
  name: string
  avatar: string
  created_at: string
  connected_at: string
  token_expires_at: string
  token_refresh_error: string
  plan: string
  subscribed_plan: string
  status: string
  period_end: string
  auto_renew: boolean
  subscription_id: string
  source: string
  card_hint: string
  suspended: boolean
  note: string
  usage: { dm: number; ai: number; ai_tokens: number; comments: number }
  limits: { dm: number; ai: number; rules: number }
  rules: number
  last_event_at: string
}

export interface PaymentRow {
  id: number
  order_id: string
  account_id: string
  username: string
  plan: string
  amount: number
  status: string
  payment_type: string
  kind: string
  transaction_id: string
  paid_at: string | null
  fee: number
  note: string
  createdAt: string
}

export interface SettingsView {
  values: Record<string, string | { set: boolean; hint?: string }>
  plans: Plan[]
  webhooks: { meta: string; oauth_redirect: string; midtrans: string }
  totp: boolean
}

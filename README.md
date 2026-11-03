# Wanychat

Auto-DM and auto-reply for Instagram comments, ManyChat-style. Users "Masuk dengan Instagram" with no keys to fill in, write a keyword, and every commenter automatically gets a DM with a button, then the link, a follow-up, and AI replies.

```
Browser/PWA ─▶ Vercel (web/, Vite+React)          https://wanychat.remot.in
              │  /api                ─rewrite─▶ n8n cloud /webhook/wany-api     (Wanychat · Admin API)
              │  /sa-api             ─rewrite─▶ n8n cloud /webhook/wany-sa      (Wanychat · Superadmin)
              │  /plans.json         ─rewrite─▶ n8n cloud /webhook/wany-plans   (Wanychat · Billing, CDN-cached)
              │  /webhook/wany-*     ─rewrite─▶ n8n cloud /webhook/wany-login|oauth|doku
Meta webhook ─────────────────────────────────▶ n8n cloud /webhook/wany-ig      (Wanychat · Engine, HMAC-verified)
DOKU ─────────▶ /webhook/wany-doku                                              (Wanychat · Billing)
                                                n8n Scheduler: follow-ups every 30 min, token refresh at 03.00
                                                Billing: pending DOKU order check + downgrade at 04.00
Data: n8n Data Tables wany_settings, wany_rules, wany_contacts, wany_events, wany_followups, wany_accounts, wany_sessions,
      wany_billing, wany_payments, wany_usage, wany_admin_sessions, wany_audit
AI:   DeepSeek (deepseek-flash) via n8n credential
```

Vercel only serves static files plus a proxy (`web/vercel.json`), so the `wany_session` session cookie is first-party on the Vercel domain.
The landing page makes no API calls. Every call is one n8n execution, so only panel pages (`#/dashboard` and the others) call `/api`.

## Folders
| Folder | Contents |
|---|---|
| `web/` | Landing + pricing page (`#/`), panel (`#/dashboard`, `#/automations`, `#/activity`, `#/billing`, `#/settings`), superadmin (`#/admin`), PWA (`public/manifest.webmanifest`, `public/sw.js`) |
| `n8n/code/*.js` | Code-node logic (engine, scheduler, admin API, OAuth) |
| `n8n/build.py` | Assembles the 5 workflows into `n8n/dist/<target>/` from `targets.json` (`//#include lib_*.js` is inlined) |
| `n8n/sa_setup.py` | Sets the superadmin username + password (scrypt hash only) and default billing settings |
| `n8n/targets.json` | Data Table IDs, credentials, and workflows per target (`local`, `cloud`). No secrets. |
| `n8n/mcp.py` | Small MCP client. Tokens are read from `~/.config/wanychat/*.json` / `~/.claude.json`, never from the repo |
| `tunnel/` | Old mode: local n8n + Cloudflare tunnel |

## Development
```bash
npm --prefix web install
N8N_URL=https://kinasih.app.n8n.cloud npm --prefix web run dev   # panel :5180, proxied to n8n cloud
```
Login through Instagram only works on the domain registered in Meta (`public_url`). Locally, use the landing page and UI.

## Changing workflows (n8n cloud)
```bash
cd n8n
TARGET=cloud python3 build.py && python3 deploy_cloud.py   # changes node parameters/code, then publishes
```
`deploy_cloud.py` replaces the whole draft graph (nodes + connections) and then publishes, so the workflow ID stays the same. To deploy just one: `python3 deploy_cloud.py IgarEngine000001`.
Backup before deploying: `python3 backup_cloud.py` saves the live workflows to `n8n/backup/<date>/` (gitignored, local only).
MCP token for n8n cloud: `~/.config/wanychat/n8n-cloud.json` → `{"url": ".../mcp-server/http", "token": "..."}` (chmod 600).

Initial setup, already done: `python3 cloud_setup.py https://wanychat.remot.in` creates the tables and copies settings, rules, and accounts from local.
DeepSeek credential: create it in the n8n cloud UI (Credentials → DeepSeek), then run `python3 link_deepseek.py`.

## Meta setup (app 4227152544202744 → Instagram → API setup with Instagram login)
1. **Business login settings → OAuth redirect URI**: `https://wanychat.remot.in/webhook/wany-oauth`
2. **Configure webhooks**: Callback URL `https://kinasih.app.n8n.cloud/webhook/wany-ig`, with Verify token = the `verify_token` row in `wany_settings`.
   Fields: `comments`, `messages`, `messaging_postbacks`.
3. For Instagram accounts outside the app's roles to be able to log in, run App Review (Advanced Access) for
   `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`.

## Superadmin (`https://wanychat.remot.in/#/admin`)
- Users (plan, active period, suspend, force logout), subscription analytics, revenue/profit, AI token usage (estimate), plans & prices, technical settings (Meta, DOKU, AI, maintenance mode, announcement), password + 2FA (TOTP), audit log.
- Initial login: `SA_USER=... SA_PASSWORD=... python3 n8n/sa_setup.py`. **Change the password and turn on 2FA** from the Keamanan tab after your first login.
- Security: scrypt password, 12-hour HttpOnly + SameSite=Strict cookie (Path=/sa-api) tied to the User-Agent, session stored as SHA-256 only, 30-minute idle logout, login limits (5/IP, 20/edge IP, 30 global per 15 minutes), CSRF header + Origin check, every action logged to `wany_audit`.

## DOKU payments (prepaid, 1 month per payment)
1. DOKU dashboard (production) → Integration → API Keys: Client ID (`BRN-…`) + active Secret Key (`SK-…`) → superadmin → Teknis → DOKU. The DOKU public key and `doku_key_…` API key are not used (they are for SNAP / other DOKU products).
2. DOKU dashboard → Integration → Notification: set the notification URL of **DOKU Checkout and every payment method you enable** to `https://wanychat.remot.in/webhook/wany-doku` (checkout also sends `override_notification_url`).
3. Every method listed in `doku_methods` must be active in the DOKU dashboard, otherwise DOKU answers `PAYMENT CHANNEL IS INACTIVE`.
4. Flow: the user picks a plan + payment method in `#/billing` → `billing.checkout` computes the total (plan price + DOKU fee + 11% VAT on the fee, grossed up and rounded up to Rp 100, so the net received ≥ plan price) → DOKU Checkout (`/checkout/v1/payment`, only that method) → HTTP notification → signature (HMAC-SHA256 over the raw body, Request-Target `/webhook/wany-doku`) is checked and logged, then the status is re-fetched from `GET /orders/v1/status/{invoice}` + amount check → plan active for 1 month (paying again extends from the current end date). The daily 04.00 sync re-checks pending orders from the last 3 days; 3 days after the period ends without payment, the plan drops to Gratis.
5. Fee table (DOKU list prices, before VAT) lives in `n8n/code/lib_doku.js`; override per method with the `doku_fees` setting (JSON `{"METHOD": [percent, rupiah]}`) if DOKU gives you different rates. `doku_fee_to_customer=false` stops charging fees to customers.
6. There is no automatic recurring charge (DOKU Checkout has none); customers pay again each month.

## Plans, accounts, AI credits, analytics
| Plan | Price | DM / month | AI replies / month | IG accounts | Extras |
|---|---|---|---|---|---|
| Gratis | Rp 0 | 100 | 0 (top-up only) | 1 | DMs end with the "via Wanychat" watermark |
| Kreator | Rp 49rb | 1,000 | 50 | 1 | follow-up |
| Pro | Rp 99rb | 5,000 | 1,000 | 2 | + AI persona |
| Bisnis | Rp 249rb | 20,000 | 5,000 | 5 | + analytics dashboard |

- **Watermark** (`plan.watermark`): `withWatermark()` in `lib_plans.js` appends `watermark_text` (Teknis → Promosi) to every automatic DM, capped at 1,000 characters. Public comment replies are never watermarked.
- **Multiple accounts** (`plan.accounts`): extra accounts get `wany_accounts.owner_id` = the subscription owner. "Akun → Tambah akun Instagram" goes through `/webhook/wany-login?link=1` (the state ends in `-link`, and the callback requires a valid session). Billing, quota (pooled across the group), and credits belong to the owner. `accounts.switch` points the current session at another account in the group. When a plan is downgraded, accounts beyond the limit stop (owner first, then by `connected_at`).
- **AI credit top-up** (`ai_topups` setting, default 100/500/2,000 credits = Rp 10/39/129rb): `billing.checkout {topup}` creates a payment with `kind=topup`, `credits=N`. Once paid, `wany_credits.granted` += N (written only by Billing/superadmin), and the Engine increments `used` once the monthly AI quota is used up. Credits never expire and work on the Gratis plan too. Superadmin can add or remove credits in Pengguna → Kelola.
- **Analytics** (`plan.analytics`): `analytics.get {days}` → `n8n/code/analytics.js` computes from `wany_events` (up to 20,000 most recent rows): funnel, daily trend, leads per post (button taps are attributed to the post of that user's last private reply), per automation, comment heatmap (WIB), top words, and hot leads (CSV export in the browser). Clearing logs also clears analytics.

## Costs and pricing
For comparison, ManyChat Pro is about $29–39/month (~Rp 520–700rb at Rp 18,000/USD), with AI as a separate add-on.

| Cost item | n8n cloud (now) | Self-hosted VPS (target) |
|---|---|---|
| Server | Starter €24 (2,500 executions) / Pro €60 (10,000 executions) | ~Rp 100–150rb/month, unlimited executions |
| AI DeepSeek flash | ~Rp 1–2 per reply | same |
| Executions per DM conversation | ~4–5 (comment, echo, button tap, echo, follow-up) | not limited |

- On a VPS, the costs are covered by 2 Pro customers, and the margin stays above 90% even if they use their full AI quota.
- On n8n cloud, execution quota is the real cost. 10,000 executions ≈ 2,000–2,500 DM conversations per month **for all users combined**. Cloud is only suitable for the beta and the first few customers; move to a VPS once paying users start growing.
- The scheduler runs every 30 minutes on cloud (1,440 executions/month) to save quota. Locally it runs every 5 minutes.
- Plan quotas are enforced by the Engine/Scheduler (`wany_usage` per month): DMs, AI replies, number of automations, follow-ups, AI persona. Plans and prices can be changed from the superadmin dashboard (`plans` setting).
- AI token cost is an **estimate** (characters / 4) × the rate in the Teknis tab; the actual cost is in the DeepSeek dashboard.

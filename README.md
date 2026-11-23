# Wanychat

Auto-DM and auto-reply for Instagram comments, plus TikTok comment management, ManyChat-style. Users sign up with email + password or Google, connect Instagram and/or TikTok through the official permission pages, write a keyword, and every commenter automatically gets a DM with a button, then the link, a follow-up, and AI replies.

```
Browser/PWA ─▶ Vercel (web/, Vite+React)          https://wanychat.remot.in
              │  /api                ─rewrite─▶ n8n VPS (n8n.remot.in) /webhook/wany-api     (Wanychat · Admin API)
              │  /auth               ─rewrite─▶ n8n VPS (n8n.remot.in) /webhook/wany-auth    (Wanychat · Akun: register/login/OTP/reset)
              │  /sa-api             ─rewrite─▶ n8n VPS (n8n.remot.in) /webhook/wany-sa      (Wanychat · Superadmin)
              │  /plans.json         ─rewrite─▶ n8n VPS (n8n.remot.in) /webhook/wany-plans   (Wanychat · Billing, CDN-cached)
              │  /webhook/wany-*     ─rewrite─▶ n8n VPS (n8n.remot.in) /webhook/wany-login|oauth (link IG), wany-google|google-cb,
              │                                   wany-tiktok-start|tiktok-login (Wanychat · TikTok), wany-unsub, wany-doku
Meta webhook ─────────────────────────────────▶ n8n VPS (n8n.remot.in) /webhook/wany-ig      (Wanychat · Engine, HMAC-verified)
DOKU ─────────▶ /webhook/wany-doku                                              (Wanychat · Billing)
                                                n8n Scheduler: follow-ups every 30 min, token refresh at 03.00
                                                Billing: pending DOKU order check + downgrade at 04.00
Data: n8n Data Tables wany_settings, wany_rules, wany_contacts, wany_events, wany_followups, wany_accounts, wany_sessions,
      wany_billing, wany_payments, wany_usage, wany_admin_sessions, wany_audit,
      wany_users (Wanychat accounts), wany_otp (email codes, hash only), wany_tt_accounts (TikTok)
Email: n8n "Send Email" nodes with SMTP credential "Wanychat SMTP" (Hostinger contact@remot.in): OTP, invoice, promo
AI:   DeepSeek (deepseek-flash) via n8n credential
```

Vercel only serves static files plus a proxy (`web/vercel.json`), so the `wany_session` session cookie is first-party on the Vercel domain.
The landing page makes no API calls. Every call is one n8n execution, so only panel pages (`#/dashboard` and the others) call `/api`.

## Accounts & sign-in
- **1 Wanychat account (email or Google) → many social accounts.** `wany_users.group_id` is the subscription group key (billing, quota, AI credits); every linked IG account has `wany_accounts.owner_id = group_id` and every TikTok account `wany_tt_accounts.owner_id = group_id`. Engine/Scheduler/Billing still resolve groups with `groupOf()` (`owner_id || ig_user_id`).
- Sessions (`wany_session` cookie, 30 days, SHA-256 in `wany_sessions`) always carry `user_id`; sessions from the old Instagram login (no `user_id`) are rejected, so old users must register once.
- **Old Instagram users**: when a signed-in user links an IG account that already exists from the old login, the old group is claimed (rules, logs, plan and credits come along without row migration). If the user's group already has accounts or a paid plan, the old group's accounts are moved in (refused if the old group still has a paid plan/credits: superadmin merges manually). Linking an IG/TikTok account owned by another Wanychat user is refused. Unlinked accounts get `owner_id = "unlinked"` and an empty token.
- Plan `accounts` counts Instagram + TikTok together.
- New users go through onboarding (`#/onboarding`: first channel or explore → for whom → heard from → plan, free allowed) before the panel.
- Auth security: scrypt passwords, generic login errors, per-email (8) / per-IP (40) / global (600) attempts per 15 min, 6-digit OTP (10 min, 5 tries, 60 s resend throttle), password reset revokes all sessions, Origin check on every POST.

## Folders
| Folder | Contents |
|---|---|
| `web/` | Landing + pricing page (`#/`), panel (`#/dashboard`, `#/automations`, `#/activity`, `#/billing`, `#/settings`), superadmin (`#/admin`), PWA (`public/manifest.webmanifest`, `public/sw.js`) |
| `n8n/code/*.js` | Code-node logic (engine, scheduler, admin API, OAuth) |
| `n8n/build.py` | Assembles the 5 workflows into `n8n/dist/<target>/` from `targets.json` (`//#include lib_*.js` is inlined) |
| `n8n/tables.py` | Creates missing `wany_*` Data Tables / columns for a target (`python3 tables.py cloud`), schema in `cloud_setup.COLUMNS` |
| `n8n/settings_seed.py` | Writes TikTok app keys (from `~/.config/wanychat/tiktok.json`), `mail_secret`, sender settings into `wany_settings` |
| `n8n/link_smtp.py` | Records the SMTP credential ("Wanychat SMTP") so `build.py` attaches it to every email node |
| `n8n/dev/` | Local dev tools: `mailcatcher.mjs` (fake SMTP → `.eml`), `test_auth.py` (account/session audit against local n8n), `test_claim.mjs` (IG claim + TikTok link unit tests) |
| `n8n/sa_setup.py` | Sets the superadmin username + password (scrypt hash only) and default billing settings |
| `n8n/targets.json` | Data Table IDs, credentials, and workflows per target (`local`, `cloud`). No secrets. |
| `n8n/mcp.py` | Small MCP client. Tokens are read from `~/.config/wanychat/*.json` / `~/.claude.json`, never from the repo |
| `tunnel/` | Old mode: local n8n + Cloudflare tunnel |

## Development
```bash
npm --prefix web install
N8N_URL=https://kinasih.app.n8n.cloud npm --prefix web run dev   # panel :5180, proxied to n8n cloud
```
Full local stack (no production data touched):
```bash
node n8n/dev/mailcatcher.mjs &                       # SMTP on 172.17.0.1:1025, mails in n8n/dev/mail/
cd n8n && python3 tables.py local && python3 settings_seed.py local http://localhost:5180
./deploy.sh                                          # then publish the 7 workflows (MCP publish_workflow)
python3 dev/test_auth.py && node dev/test_claim.mjs
npm --prefix ../web run dev                          # panel on :5180, proxied to local n8n
```
The local n8n container needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (scrypt/HMAC in Code nodes). Instagram/TikTok/Google OAuth only work on the registered production URLs.

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

## Email (SMTP), Google, TikTok setup
1. **SMTP**: n8n → Credentials → SMTP, name `Wanychat SMTP`: host `smtp.hostinger.com`, port 465, SSL on, user `contact@remot.in`, mailbox password. Then `python3 link_smtp.py && TARGET=cloud python3 build.py && python3 deploy_cloud.py`. Test from superadmin → Teknis → Email. DNS for remot.in already has SPF, Hostinger DKIM and DMARC. Hostinger Starter has a low daily send limit: move promo mail to a bulk provider (Brevo etc.) by swapping the credential.
2. **Google login**: Google Cloud Console → OAuth consent screen (External) → Credentials → OAuth client ID (Web). Redirect URIs `https://wanychat.remot.in/webhook/wany-google-cb` (+ `http://localhost:5180/webhook/wany-google-cb` for dev). Fill Client ID/secret in superadmin → Teknis → Login Google.
3. **TikTok** (TikTok API for Business app 7711213753433325620, Accounts API): account-holder redirect URL `https://wanychat.remot.in/webhook/wany-tiktok-login`. App ID/secret live in `wany_settings` (`settings_seed.py`), never in the repo. TikTok comment automation is not built yet: see `dokumen/tiktok-automasi-tahap-2.md`.

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

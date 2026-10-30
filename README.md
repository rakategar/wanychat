# Wanychat

Auto-DM and auto-reply for Instagram comments, ManyChat-style. Users "Masuk dengan Instagram" with no keys to fill in, write a keyword, and every commenter automatically gets a DM with a button, then the link, a follow-up, and AI replies.

```
Browser/PWA ─▶ Vercel (web/, Vite+React)          https://wanychat.remot.in
              │  /api                ─rewrite─▶ n8n cloud /webhook/wany-api     (Wanychat · Admin API)
              │  /sa-api             ─rewrite─▶ n8n cloud /webhook/wany-sa      (Wanychat · Superadmin)
              │  /plans.json         ─rewrite─▶ n8n cloud /webhook/wany-plans   (Wanychat · Billing, CDN-cached)
              │  /webhook/wany-*     ─rewrite─▶ n8n cloud /webhook/wany-login|oauth|midtrans
Meta webhook ─────────────────────────────────▶ n8n cloud /webhook/wany-ig      (Wanychat · Engine, HMAC-verified)
Midtrans ─────▶ /webhook/wany-midtrans                                          (Wanychat · Billing)
                                                n8n Scheduler: follow-ups every 30 min, token refresh at 03.00
                                                Billing: subscription sync + downgrade at 04.00
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
- Users (plan, active period, suspend, force logout, stop auto-renewal), subscription analytics, revenue/profit, AI token usage (estimate), plans & prices, technical settings (Meta, Midtrans, AI, maintenance mode, announcement), password + 2FA (TOTP), audit log.
- Initial login: `SA_USER=... SA_PASSWORD=... python3 n8n/sa_setup.py`. **Change the password and turn on 2FA** from the Keamanan tab after your first login.
- Security: scrypt password, 12-hour HttpOnly + SameSite=Strict cookie (Path=/sa-api) tied to the User-Agent, session stored as SHA-256 only, 30-minute idle logout, login limits (5/IP, 20/edge IP, 30 global per 15 minutes), CSRF header + Origin check, every action logged to `wany_audit`.

## Midtrans payments (monthly subscription)
1. Midtrans dashboard → Settings → Access Keys: copy the Server Key & Client Key → superadmin → Teknis → Midtrans (start in `sandbox`).
2. Settings → Configuration: **Payment Notification URL** and **Recurring Notification URL** = `https://wanychat.remot.in/webhook/wany-midtrans`.
3. Automatic renewal needs card **One Click / recurring** activation (recurring MID) from Midtrans. Ask Midtrans Activation to enable it for production.
4. Flow: Snap checkout (card, `save_card`) → notification → status re-fetched from Midtrans API + SHA512 signature + amount check → plan active for 1 month → Subscription API (`/v1/subscriptions`, monthly) is created from `saved_token_id`. Each recurring charge extends the plan by 1 month; the daily 04.00 sync catches any missed notifications; 3 days after the period ends without payment, the plan drops to Gratis.
5. Without a saved card (or with non-card methods enabled in `midtrans_payments`) = 1 month active, no auto-renewal.

## Costs and pricing
Pricing on the landing page: Gratis (100 DM), Kreator Rp 49rb (1,000 DM), Pro Rp 99rb (5,000 DM), Bisnis Rp 249rb (3 accounts, 20,000 DM).
For comparison, ManyChat Pro is about $29–39/month (~Rp 480–640rb), with AI as a separate add-on.

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

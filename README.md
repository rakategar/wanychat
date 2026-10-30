# Wanychat

Auto-DM and auto-reply for Instagram comments, ManyChat-style. Users "Masuk dengan Instagram" with no keys to fill in, write a keyword, and every commenter automatically gets a DM with a button, then the link, a follow-up, and AI replies.

```
Browser ──▶ Vercel (web/, Vite+React)          https://wanychat.remot.in
              │  /api                ─rewrite─▶ n8n cloud /webhook/wany-api     (Wanychat · Admin API)
              │  /webhook/wany-*     ─rewrite─▶ n8n cloud /webhook/wany-login|oauth
Meta webhook ─────────────────────────────────▶ n8n cloud /webhook/wany-ig      (Wanychat · Engine)
                                                n8n Scheduler: follow-ups every 30 min, token refresh at 03.00
Data: n8n Data Tables wany_settings, wany_rules, wany_contacts, wany_events, wany_followups, wany_accounts, wany_sessions
AI:   DeepSeek (deepseek-flash) via n8n credential
```

Vercel only serves static files plus a proxy (`web/vercel.json`), so the `wany_session` session cookie is first-party on the Vercel domain.
The landing page makes no API calls. Every call is one n8n execution, so only panel pages (`#/dashboard` and the others) call `/api`.

## Folders
| Folder | Contents |
|---|---|
| `web/` | Landing + pricing page (`#/`) and panel (`#/dashboard`, `#/automations`, `#/activity`, `#/settings`) |
| `n8n/code/*.js` | Code-node logic (engine, scheduler, admin API, OAuth) |
| `n8n/build.py` | Assembles the 3 workflows into `n8n/dist/<target>/` from `targets.json` |
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
If you change the node structure or connections, archive the workflow in n8n, remove its ID from `targets.json` → `cloud.workflows`, then run it again.
MCP token for n8n cloud: `~/.config/wanychat/n8n-cloud.json` → `{"url": ".../mcp-server/http", "token": "..."}` (chmod 600).

Initial setup, already done: `python3 cloud_setup.py https://wanychat.remot.in` creates the tables and copies settings, rules, and accounts from local.
DeepSeek credential: create it in the n8n cloud UI (Credentials → DeepSeek), then run `python3 link_deepseek.py`.

## Meta setup (app 4227152544202744 → Instagram → API setup with Instagram login)
1. **Business login settings → OAuth redirect URI**: `https://wanychat.remot.in/webhook/wany-oauth`
2. **Configure webhooks**: Callback URL `https://kinasih.app.n8n.cloud/webhook/wany-ig`, with Verify token = the `verify_token` row in `wany_settings`.
   Fields: `comments`, `messages`, `messaging_postbacks`.
3. For Instagram accounts outside the app's roles to be able to log in, run App Review (Advanced Access) for
   `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`.

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
- **Not built yet:** payments and per-plan quota limits. The pricing page is marketing only, and every account currently gets all features.

# Telegram Bot Maker — Cloudflare Workers + D1

Pure Cloudflare Workers backend (ES Modules) running the Telegram Bot Maker & Multi-Bot Engine on Telegram Webhooks and Cloudflare D1.

## Features Preserved
- **Master Bot**: Daily coins, referral rewards, coin deposits (QR/UPI/screenshot/UTR), multi-admin management, unlimited force-join channels, device verification, broadcast center (master, specific child bot, or all child bots), and 7 child bot templates.
- **Child Bot Templates**:
  - Normal UPI Bot (`upi_normal`)
  - Advanced UPI Bot (`upi_advanced`)
  - Normal Redeem Code Bot (`redeem_normal`)
  - Advanced Redeem Code Bot (`redeem_advanced`)
  - Normal Star Bot (`star_normal`)
  - Advanced Star Bot (`star_advanced`)
  - Gmail Buy & Sell Bot (`gmail_bot`)
- **Automatic Child Bot Webhooks**: Creating, toggling, or deleting child bots automatically calls Telegram `setWebhook` / `deleteWebhook` pointing to `/webhook/child/:botId`.

## Environment Variables & Bindings

Configure these in Cloudflare Dashboard (**Workers & Pages → Settings → Variables and Secrets / Bindings**):

| Binding / Variable | Type | Description |
| --- | --- | --- |
| `DB` | D1 Database | Bound to your Cloudflare D1 database (`schema.sql`) |
| `BOT_TOKEN` | Secret | Telegram Master Bot token from `@BotFather` |
| `ADMIN_ID` | Variable / Secret | Primary Admin Telegram User ID (supports comma-separated IDs) |
| `WEBHOOK_SECRET` | Secret | Secret token (`A-Za-z0-9_-`) used to validate Telegram webhook requests & `/setup` |
| `DEFAULT_DAILY_COINS` | Optional Variable | Default daily coins (`2`) |
| `DEFAULT_BOT_COST` | Optional Variable | Default normal bot creation coin cost (`5`) |
| `DEFAULT_MASTER_REF_COINS` | Optional Variable | Default master referral coins (`1`) |

## Endpoints
- `GET /` — Health check (`200 OK` JSON)
- `GET /setup?secret=<WEBHOOK_SECRET>` (or `POST /setup` with `X-Setup-Secret`) — Registers Master Bot webhook (`/webhook`) and syncs webhooks for all active child bots
- `POST /webhook` — Master Bot Telegram webhook endpoint (validated via `X-Telegram-Bot-Api-Secret-Token`)
- `POST /webhook/child/:botId` — Child Bot Telegram webhook endpoint (validated via `X-Telegram-Bot-Api-Secret-Token`)
- `GET /verify?token=...` & `POST /api/verify-device` — In-bot Device Verification endpoints

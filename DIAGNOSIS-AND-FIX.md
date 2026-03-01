# GGRD-Rewards-Bot: Diagnosis & Fix

## TL;DR

Two bugs prevented the bot from working on VPS:
1. **MongoDB auth failure** — config expected `MONGODB_PASS` but VPS `.env` had no password variable at all
2. **Telegram parse errors** — `parse_mode: 'Markdown'` broke on URLs containing underscores (`GGRD_rewards_bot`)

Fixed files: `src/config.js` (legacy env fallback) and `src/bot.js` (Markdown → HTML).

---

## Bug 1: MongoDB Authentication Failed

### Symptom
```
MongoServerError: Authentication failed
```

### Root cause
`src/config.js` builds the MongoDB URI from env vars: `MONGODB_USER` + `MONGODB_PASS`.

The VPS `.env` (created manually, not via wizard) used **legacy short names**:
```env
DB=ggrd_bot
HOST=127.0.0.1
PORT=27017
USER=ggrd_bot_admin
AUTHSOURCE=admin
# ← PASSWORD / MONGODB_PASS was MISSING entirely
```

Config.js only checked `MONGODB_USER` / `MONGODB_PASS` → both returned `undefined` → threw error or tried connecting with no credentials.

### Fix
Added `env()` helper in `config.js` that checks **new names first, then legacy fallbacks**:

| New (wizard) | Legacy (old .env) |
|---|---|
| `MONGODB_HOST` | `HOST` |
| `MONGODB_PORT` | `PORT` |
| `MONGODB_DB` | `DB` |
| `MONGODB_USER` | `USER` |
| `MONGODB_PASS` | `MONGODB_PASSWORD`, `PASSWORD` |
| `MONGODB_AUTHSOURCE` | `AUTHSOURCE` |

**You still need to add the password** to `.env` on VPS (see Runbook below).

---

## Bug 2: Telegram "can't parse entities" (400)

### Symptom
```
TelegramError: 400: Bad Request: can't parse entities
```
Affected commands: `/invite`, `/leaderboard`, `/status`, `/rules`, `/help`, `/start`

### Root cause
All messages used `parse_mode: 'Markdown'` (Telegram Markdown V1).

Markdown V1 treats `_` as italic delimiter. The bot username (`GGRD_rewards_bot`) and referral links contain **multiple underscores**:

```
https://t.me/GGRD_rewards_bot?start=ref_123456
         ^^^^            ^^^             ^^^
```

Telegram's parser can't match italic pairs → **400 Bad Request**.

The `escapeMd()` function tried to escape special chars, but Markdown V1 escaping is fragile and incomplete.

### Fix
Switched **all** `parse_mode: 'Markdown'` → `parse_mode: 'HTML'` across bot.js (9 occurrences).

Formatting replacements:
- `*bold*` → `<b>bold</b>`
- `_italic_` → `<i>italic</i>`
- `` `code` `` → `<code>code</code>`
- `escapeMd()` → `escapeHtml()` (escapes `&`, `<`, `>` only)

HTML parse mode ignores underscores in URLs entirely → problem eliminated.

---

## Files changed

| File | Change |
|---|---|
| `src/config.js` | Added `env()` fallback helper; legacy env var names now accepted |
| `src/bot.js` | `parse_mode: 'HTML'` everywhere; `escapeHtml()` replaces `escapeMd()` |

All other files (`db.js`, `program.js`, `solana.js`, `index.js`, `setup/*`) are **unchanged**.

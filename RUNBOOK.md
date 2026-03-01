# RUNBOOK: Deploy fixes to VPS

## Prerequisites
- SSH access to VPS
- Bot path: `/opt/ggrd/GGRD-Rewards-Bot`
- MongoDB running in Docker (`ggrd-mongo` container)
- PM2 managing the bot process

---

## Step 1: Backup current state

```bash
ssh your-vps

cd /opt/ggrd
cp -r GGRD-Rewards-Bot GGRD-Rewards-Bot.bak.$(date +%Y%m%d)
```

## Step 2: Pull latest from GitHub

```bash
cd /opt/ggrd/GGRD-Rewards-Bot
git pull origin master
```

> If you pushed the fixed files to the repo already, `git pull` brings them in.
> Otherwise, upload `src/bot.js` and `src/config.js` manually via SCP.

### Manual upload alternative:
```powershell
# From your Windows machine:
scp "C:\GGRD-FIX\src\bot.js"    user@VPS:/opt/ggrd/GGRD-Rewards-Bot/src/bot.js
scp "C:\GGRD-FIX\src\config.js" user@VPS:/opt/ggrd/GGRD-Rewards-Bot/src/config.js
```

## Step 3: Fix .env — add MongoDB password

The `.env` on VPS is **missing the password**. Two options:

### Option A: Re-run the setup wizard (recommended for clean .env)
```bash
cd /opt/ggrd/GGRD-Rewards-Bot
node src/index.js --setup
```
The wizard generates a complete `.env` with all required variables.

### Option B: Add password manually to existing .env
```bash
cd /opt/ggrd/GGRD-Rewards-Bot

# Check what your MongoDB password is (set during docker-compose init):
docker exec ggrd-mongo mongosh \
  "mongodb://root:ROOT_PASS_HERE@localhost:27017/admin" \
  --eval "db.system.users.find({user:'ggrd_bot_admin'}).pretty()"

# Add to .env (use the password you set when creating the user):
echo 'MONGODB_PASS=YOUR_ACTUAL_PASSWORD_HERE' >> .env

# Or if using legacy names, add:
echo 'PASSWORD=YOUR_ACTUAL_PASSWORD_HERE' >> .env
```

**Verify the .env has these keys** (new or legacy names):
```bash
grep -E '^(MONGODB_|BOT_|SOLANA_|GGRD_TOKEN|DB=|HOST=|PORT=|USER=|PASSWORD=)' .env
```

Expected output should include either `MONGODB_PASS=...` or `PASSWORD=...`.

## Step 4: Test MongoDB connection

```bash
# Test with the URI the bot will build:
mongosh "mongodb://ggrd_bot_admin:YOUR_PASS@127.0.0.1:27017/ggrd_bot?authSource=admin" \
  --eval "db.members.countDocuments()"
```

Expected: a number (0 or more). If "Authentication failed" → password is wrong.

## Step 5: Restart the bot

```bash
cd /opt/ggrd/GGRD-Rewards-Bot
pm2 restart ecosystem.config.js
pm2 logs ggrd-rewards-bot --lines 30
```

Look for:
```
[OK] Bot started.
[OK] Hold-check worker enabled (30 min).
```

If you see `[FATAL] Missing required env: ...` → check .env again.

## Step 6: Verify bot commands in Telegram

Test each previously-broken command in private chat with the bot:

| Command | Expected behavior |
|---|---|
| `/start` | Welcome message with buttons (no error) |
| `/status` | Status card with checkmarks |
| `/invite` | Referral link displayed (URL with underscores shows correctly) |
| `/leaderboard` | Top 10 list or "No data yet" |
| `/rules` | Rules text with bold and italic |
| `/help` | Command list |

If any command returns nothing (bot silent) → check `pm2 logs` for errors.

## Step 7: Push to repo (if fixed locally)

```powershell
# TODO: From Windows (PowerShell):
cd "C:\APLIKACJE\GGRD BOT TG"
git add src/bot.js src/config.js DIAGNOSIS-AND-FIX.md
git commit -m "fix: Markdown→HTML parse_mode + MongoDB legacy env fallback"
git push origin master
```

---

## Rollback

If something goes wrong:
```bash
cd /opt/ggrd
pm2 stop ggrd-rewards-bot
rm -rf GGRD-Rewards-Bot
mv GGRD-Rewards-Bot.bak.YYYYMMDD GGRD-Rewards-Bot
cd GGRD-Rewards-Bot
pm2 start ecosystem.config.js
```

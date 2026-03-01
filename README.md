# 🎉 GGRD Rewards Bot (Pre-Graduation Points + Verified Buyer Referrals)

![Node.js CI](https://github.com/Giggle-GGRD/GGRD-Rewards-Bot/workflows/Node.js%20CI/badge.svg)
![License](https://img.shields.io/github/license/Giggle-GGRD/GGRD-Rewards-Bot)
![Stars](https://img.shields.io/github/stars/Giggle-GGRD/GGRD-Rewards-Bot)

Telegram bot to maximize **verified buyers/holders** during DBC phase using a **points ledger** and a **referral program**.

**Important:** During DBC phase the bot does **not** distribute GGRD. It accrues points that can be converted to GGRD after migration (when marketing pool unlocks).

## 🌟 Features

- 🔒 **DM-only mode** (privacy-first)
- 🔗 Wallet linking (Base58 validation)
- 🧾 Proof-of-buy via Solana transaction signature (on-chain verification)
- ✅ Verified holder checks (24h / 72h) with automated worker
- 👥 Referral program (credited only for verified buyers)
- 📊 Points ledger with weekly caps + daily referral caps
- 🏆 Leaderboard

## 🔒 Privacy & Security - DM-Only Mode

**The bot operates exclusively in private chats** to protect user privacy:

- ✅ Wallet addresses are NEVER shared publicly
- ✅ Transaction hashes remain private
- ✅ Reward statistics are confidential
- ✅ Zero spam in community groups

**How it works:**
- In groups: Bot only responds to `/start` with a button redirecting to private chat
- In DMs: Full bot functionality is available
- Groups remain clean and spam-free

📖 **[DM-Only Implementation Guide → DM-ONLY-GUIDE.md](./DM-ONLY-GUIDE.md)**

## 🚀 Quick Start

### 🖥️ Deploy on VPS (Recommended)

📖 **[VPS Deployment Guide → DEPLOYMENT_VPS.md](./DEPLOYMENT_VPS.md)**

### 💻 Local Installation

### Prerequisites

- Node.js 18+
- **MongoDB**:
  - recommended on VPS: `docker compose up -d mongo` (see `DEPLOYMENT_VPS.md`)
  - or any existing MongoDB (managed or self-hosted)
- Telegram Bot Token from @BotFather
- Bot must be admin in target channel (optional: if you use join-check gating)
- Solana RPC URL (private recommended to avoid rate limits)

### Installation

```bash
# Clone repository
git clone https://github.com/YOUR-USERNAME/GGRD-Rewards-Bot.git
cd GGRD-Rewards-Bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your configuration
```

### Configuration

Create `.env` file with the following variables:

```env
# Telegram Bot Configuration
BOT_TOKEN=your_bot_token_from_botfather
BOT_USERNAME=your_bot_username         # WITHOUT @ symbol (e.g., GGRDRewardsBot)

# Channel and Group to verify
CHANNEL_ID=@GGRDofficial
GROUP_ID=@GGRDchat

# Twitter account
TWITTER_HANDLE=@GGRD_Official

# MongoDB Connection
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?appName=Cluster0

# Admin Telegram ID
ADMIN_ID=your_telegram_id

# Solana RPC URL (private RPC recommended)
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Token mints
GGRD_TOKEN_MINT=TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Program parameters
MIN_HOLD_GGRD=100
MIN_NET_BUY_USDC=5
HOLD_TIME_1_HOURS=24
HOLD_TIME_2_HOURS=72
MAX_VERIFIED_REFERRALS_PER_DAY=10
MAX_POINTS_PER_WALLET_PER_WEEK=2000
```

**⚠️ IMPORTANT:** The `BOT_USERNAME` variable is **REQUIRED** for DM-only mode to work properly.

### Run

```bash
npm start
# or
node index.js
```

## 📋 User Commands

**Available in Private Chat only:**

- `/start` - Main menu
- `/status` - Your current status and points
- `/invite` - Referral link + stats
- `/leaderboard` - Top referrers
- `/rules` - Program rules

## 🎁 Rewards Logic (v1)

- Points are assigned after a verified buy TX.
- Verified holder bonuses are granted after holding ≥ MIN_HOLD_GGRD for 24h and 72h.
- Referral points are credited only when the invited user becomes a verified holder (24h).
- Points are converted to GGRD only after migration (marketing pool unlock).

## 🏗️ Project Structure

```
GGRD-Rewards-Bot/
├── src/                  # Bot code
│   ├── index.js          # Entry point
│   ├── bot.js            # Telegram handlers
│   ├── solana.js         # RPC helpers
│   ├── program.js        # Program logic / points
│   ├── db.js             # MongoDB
│   └── config.js         # Env config
├── .env                  # Configuration (NOT in repo)
├── .env.example          # Example configuration template
├── .gitignore           # Git ignore rules
├── package.json         # Dependencies
├── DEPLOYMENT_VPS.md    # VPS deployment guide
├── ecosystem.config.js  # pm2 config
└── README.md            # This file
```

## 💾 Database Schema

The bot uses MongoDB with three collections:

### Members Collection
```javascript
{
  telegram_id: String,
  telegram_username: String,
  first_name: String,
  last_name: String,
  wallet_address: String,
  referred_by: String,
  referrals: {
    count: Number,
    count_with_wallet: Number,
    earned: Number,
    reward_paid: Boolean
  },
  tasks: {
    tg_channel: Boolean,
    tg_group: Boolean
  },
  task1_completed: Boolean,
  task1_reward: Number,
  task1_lottery_entry: String,
  task2_purchase: {
    submitted: Boolean,
    tx_hash: String,
    amount_usd: Number,
    verified: Boolean,
    reward_claimed: Boolean
  },
  task2_reward: Number,
  task3_holder: {
    balance_ggrd: Number,
    snapshot_day0: Boolean,
    snapshot_day7: Boolean,
    qualified_lottery: Boolean,
    top100_rank: Number
  },
  task3_reward: Number,
  task3_lottery_entry: String,
  total_rewards: Number,
  disqualified: Boolean,
  disqualified_reason: String,
  created_at: Date,
  updated_at: Date
}
```

### Snapshots Collection
Stores all snapshot events (Day 0, Day 7, lotteries, awards)

### Daily Snapshots Collection
Tracks daily balances for biggest holder competition

## 🐛 Troubleshooting

**Bot doesn't start:**
- Check if `BOT_USERNAME` is in `.env` (WITHOUT @ symbol)
- Verify all required environment variables are set
- Check MongoDB connection string

**Bot doesn't verify membership:**
- Ensure bot is admin in both channel and group
- Check permissions: bot needs "View Members" permission

**Bot responds in groups:**
- Verify `BOT_USERNAME` is correctly set
- Check that middleware is working (see logs)
- Restart the bot

**DM link doesn't work:**
- Ensure `BOT_USERNAME` matches your actual bot username
- Make sure bot is public (not private)
- Test link format: `https://t.me/YOUR_BOT_USERNAME`

**MongoDB connection fails:**
- Verify MONGODB_URI format
- If using managed MongoDB, check network access/IP allowlist
- Ensure database user has proper permissions

## 🔒 Security

- ⚠️ **NEVER** commit `.env` file (contains bot token and API keys)
- 🔐 Keep bot token secure and regenerate if exposed
- 🛡️ Bot requires admin rights in channel/group to verify membership
- 🔒 DM-only mode protects user privacy and sensitive data
- 🚫 Never share MongoDB connection string publicly
- 🔑 Use strong passwords for database access

## 🛠️ Development

```bash
# Test bot token
node test-token.js

# Run with auto-restart (requires nodemon)
npm install -g nodemon
nodemon index.js

# View logs
npm start | tee bot.log
```

## 📦 Dependencies

- [telegraf](https://github.com/telegraf/telegraf) ^4.16.3 - Telegram Bot Framework
- [dotenv](https://github.com/motdotla/dotenv) ^16.4.5 - Environment Variables
- [mongodb](https://www.npmjs.com/package/mongodb) ^6.x - MongoDB Driver

## 🧪 Testing

Before deploying, run through the test checklist in `DM-ONLY-GUIDE.md`:

1. ✅ Test `/start` in group (should show DM button)
2. ✅ Test other messages in group (should be ignored)
3. ✅ Test `/start` in DM (should show full welcome)
4. ✅ Test task verification workflow
5. ✅ Test all commands in DM
6. ✅ Test callback buttons
7. ✅ Test referral links
8. ✅ Test admin commands

## 🤝 Contributing

This is a private project for GGRD community. For issues or suggestions, contact the project maintainer.

## 📄 License

ISC License - Copyright (c) 2025 EURO-TAX

## 🔗 Links

- GGRD Channel: [@GGRDofficial](https://t.me/GGRDofficial)
- GGRD Group: [@GGRDchat](https://t.me/GGRDchat)
- Website: [ggrd.me](https://ggrd.me)
- Buy on Jupiter: [GGRD/SOL](https://jup.ag/tokens/TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE)
- GeckoTerminal: [GGRD Chart](https://www.geckoterminal.com/solana/pools/HWzDBQcPpmGk5J9EXaLQnF4TfndP2pYAzCxBTyfjbnUb)

## ⚡ Project Info

- **Project**: Giggle Reloaded (GGRD)
- **Network**: Solana
- **Purpose**: Fair-launch memecoin with charitable components
- **Charity**: 10% of supply for Ukrainian war victims via Tabletochki Foundation
- **Developer**: EURO-TAX

---

Made with ❤️ for the GGRD community

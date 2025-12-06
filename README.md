# 🎉 GGRD Community Rewards Bot

![Node.js CI](https://github.com/Giggle-GGRD/GGRD-Rewards-Bot/workflows/Node.js%20CI/badge.svg)
![License](https://img.shields.io/github/license/Giggle-GGRD/GGRD-Rewards-Bot)
![Stars](https://img.shields.io/github/stars/Giggle-GGRD/GGRD-Rewards-Bot)

Telegram bot for verifying GGRD community members and managing rewards distribution with **DM-only privacy mode**.

## 🌟 Features

- 🔒 **DM-only mode** - All interactions happen in private chats for maximum privacy
- ✅ Automatic verification of channel membership (@GGRDofficial)
- ✅ Automatic verification of group membership (@GGRDchat)
- 💰 Solana wallet address collection with Base58 validation
- 🗄️ MongoDB database for scalable member records
- 🎁 Multi-tier rewards system (Tasks 1-3, Referrals, Lottery)
- 📊 Admin commands for snapshot management
- 🏆 TOP 100 holders tracking
- 💎 Biggest holder competition (30-day average)
- 👥 Referral program with 10,000 GGRD pool
- 📈 Comprehensive statistics and leaderboards

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

### 🌐 Deploy on Render.com (Recommended)

For 24/7 hosting, deploy on Render.com for free!

📖 **[Complete Deployment Guide → DEPLOYMENT.md](./DEPLOYMENT.md)**

**Quick steps:**
1. Push this repo to GitHub
2. Create account on [Render.com](https://render.com)
3. Connect GitHub repository
4. Add environment variables (see Configuration section)
5. Deploy! 🎉

### 💻 Local Installation

### Prerequisites

- Node.js 18+ ([Download](https://nodejs.org/))
- MongoDB database ([MongoDB Atlas](https://www.mongodb.com/cloud/atlas) - free tier)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- Bot must be admin in target channel and group
- Chanterspot API key for Solana balance checking

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

# Chanterspot API for Solana balance checking
CHANTERSPOT_API_KEY=your_chanterspot_api_key

# GGRD Token Mint Address on Solana
GGRD_TOKEN_MINT=TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE

# Task limits
TASK2_MAX_USERS=300
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

- `/start` - Begin verification and registration
- `/help` - Show help information
- `/tasks` - View all available tasks and rewards
- `/me` or `/profile` - View your profile and statistics
- `/top100` - View TOP 100 early holders list
- `/task3_status` - Detailed Task 3 (holder) status
- `/biggest_holder` - View biggest holder competition standings
- `/leaderboard` - View holder rankings
- `/invite` - Get your referral link and stats
- `/referrals` - View TOP 10 referral leaderboard

## 🛠️ Admin Commands

**Admin-only commands (require ADMIN_ID in .env):**

- `/export` - Export member database to JSON
- `/verify_purchase <telegram_id> <approved|rejected>` - Verify Task 2 purchases
- `/snapshot_day0` - Execute Day 0 snapshot (LP launch)
- `/snapshot_day7` - Execute Day 7 snapshot (lottery qualification)
- `/daily_snapshot` - Take daily snapshot for biggest holder tracking
- `/lottery <1|3>` - Execute lottery draw for Task 1 or 3
- `/award_biggest_holder` - Award biggest holder prize after 30 days
- `/pay_referrals` - Pay all referral rewards (Day 10)
- `/stats` - View comprehensive bot statistics

## 🎁 Rewards System

### Task 1 - Social Media Verification (10 GGRD)
- Join Telegram Channel
- Join Telegram Group
- Automatic verification
- **Bonus:** Lottery entry for 2,000 GGRD prize

### Task 2 - Purchase Proof (20 GGRD)
- Buy minimum $5 worth of GGRD
- Submit transaction hash
- Admin verification required
- Limited to first 300 verified users

### Task 3 - Holder Rewards
**TOP 100 (50 GGRD each):**
- First 100 holders with ≥2,500 GGRD
- Verified at Day 0 (LP launch)

**Lottery (10,000 GGRD):**
- Hold ≥2,500 GGRD on Day 0 (LP launch)
- Hold ≥2,500 GGRD on Day 7
- Random draw from qualified holders

### Biggest Holder Competition (20,000 GGRD)
- 30-day average balance tracking
- Highest average wins
- Minimum 2,500 GGRD to qualify

### Referral Program (5 GGRD per referral)
- Invite friends via referral link
- Friend must add wallet address
- Rewards paid on Day 10
- Global pool: 10,000 GGRD

## 🏗️ Project Structure

```
GGRD-Rewards-Bot/
├── index.js              # Main bot code with DM-only mode
├── test-token.js         # Token validation utility
├── .env                  # Configuration (NOT in repo)
├── .env.example          # Example configuration template
├── .gitignore           # Git ignore rules
├── package.json         # Dependencies
├── DEPLOYMENT.md        # Deployment guide for Render.com
├── DM-ONLY-GUIDE.md     # DM-only mode testing guide
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
- Check network access in MongoDB Atlas
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

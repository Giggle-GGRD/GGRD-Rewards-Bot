# 🎉 GGRD Community Rewards Bot

![Node.js CI](https://github.com/Giggle-GGRD/GGRD-Rewards-Bot/workflows/Node.js%20CI/badge.svg)
![License](https://img.shields.io/github/license/Giggle-GGRD/GGRD-Rewards-Bot)
![Stars](https://img.shields.io/github/stars/Giggle-GGRD/GGRD-Rewards-Bot)

Telegram bot for verifying GGRD community members and collecting Solana wallet addresses for rewards distribution.

## 🌟 Features

- ✅ Automatic verification of channel membership (@GGRDofficial)
- ✅ Automatic verification of group membership (@GGRDchat)
- 💰 Solana wallet address collection with Base58 validation
- 💾 JSON database for member records
- 📊 Export functionality for rewards distribution
- 👤 User profile viewing (/me command)

## 🚀 Quick Start

### 🌐 Deploy on Render.com (Recommended)

For 24/7 hosting, deploy on Render.com for free!

📖 **[Complete Deployment Guide → DEPLOYMENT.md](./DEPLOYMENT.md)**

**Quick steps:**
1. Push this repo to GitHub
2. Create account on [Render.com](https://render.com)
3. Connect GitHub repository
4. Add `BOT_TOKEN` as environment variable
5. Deploy! 🎉

### 💻 Local Installation

### Prerequisites

- Node.js 18+ ([Download](https://nodejs.org/))
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- Bot must be admin in target channel and group

### Installation

```bash
# Clone repository
git clone https://github.com/YOUR-USERNAME/GGRD-Rewards-Bot.git
cd GGRD-Rewards-Bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your BOT_TOKEN
```

### Configuration

Create `.env` file:

```env
BOT_TOKEN=your_bot_token_from_botfather
CHANNEL_ID=@GGRDofficial
GROUP_ID=@GGRDchat
```

### Run

```bash
npm start
# or
node index.js
```

## 📋 Commands

- `/start` - Begin verification process
- `/me` - View your registration profile
- `/export` - Export member database (JSON)

## 🏗️ Project Structure

```
GGRD-Rewards-Bot/
├── index.js              # Main bot code
├── test-token.js         # Token validation utility
├── .env                  # Configuration (NOT in repo)
├── .gitignore           # Git ignore rules
├── package.json         # Dependencies
└── ggrd_members.json    # User database (NOT in repo)
```

## 🔒 Security

- ⚠️ **NEVER** commit `.env` file (contains bot token)
- ⚠️ **NEVER** commit `ggrd_members.json` (contains user data)
- 🔐 Keep bot token secure and regenerate if exposed
- 🛡️ Bot requires admin rights in channel/group to verify membership

## 📊 Database Schema

Each member record contains:

```json
{
  "telegram_id": 123456789,
  "telegram_username": "username",
  "first_name": "John",
  "last_name": "Doe",
  "in_channel": true,
  "in_group": true,
  "wallet_address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
}
```

## 🐛 Troubleshooting

**Bot doesn't verify membership:**
- Ensure bot is admin in both channel and group
- Check permissions: bot needs "View Members" permission

**"401 Unauthorized" error:**
- Invalid bot token in `.env`
- Get new token from @BotFather

**Bot not responding:**
- Check if process is running
- Verify internet connection
- Test token: `node test-token.js`

## 🛠️ Development

```bash
# Test bot token
node test-token.js

# Run with auto-restart (requires nodemon)
npm install -g nodemon
nodemon index.js
```

## 📦 Dependencies

- [telegraf](https://github.com/telegraf/telegraf) ^4.16.3 - Telegram Bot Framework
- [dotenv](https://github.com/motdotla/dotenv) ^16.4.5 - Environment Variables

## 🤝 Contributing

This is a private project for GGRD community. For issues or suggestions, contact the project maintainer.

## 📄 License

ISC License - Copyright (c) 2025 EURO-TAX

## 🔗 Links

- GGRD Channel: [@GGRDofficial](https://t.me/GGRDofficial)
- GGRD Group: [@GGRDchat](https://t.me/GGRDchat)
- Website: [ggrd.me](https://ggrd.me)

## ⚡ Project Info

- **Project**: Giggle Reloaded (GGRD)
- **Network**: Solana
- **Purpose**: Fair-launch memecoin with charitable components
- **Developer**: EURO-TAX

---

Made with ❤️ for the GGRD community

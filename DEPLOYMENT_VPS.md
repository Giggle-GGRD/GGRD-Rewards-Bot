# VPS Deployment (Ubuntu / Debian)

This repo is designed to be deployed on a VPS via GitHub + PM2.
MongoDB is **self-hosted on the same VPS** via Docker Compose (recommended), so the bot does not depend on external DB providers.

## 1) Install system deps

```bash
sudo apt update
sudo apt install -y git curl ca-certificates gnupg
```

## 2) Install Node.js 18+ and pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

sudo npm i -g pm2
```

## 3) Install Docker + Compose plugin

```bash
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out and log in again (required for group change)
```

## 4) Clone and configure

```bash
git clone https://github.com/<YOUR_ORG>/<YOUR_REPO>.git
cd <YOUR_REPO>

cp .env.example .env
nano .env
```

**Important (.env):**
- Set `MONGO_ROOT_USER` + `MONGO_ROOT_PASS` (for backups/restore)
- Set `MONGODB_USER` + `MONGODB_PASS` (bot DB user)
- Keep `MONGODB_HOST=127.0.0.1` and `MONGODB_PORT=27017`

## 5) Start MongoDB locally

```bash
docker compose up -d mongo
docker ps
```

## 6) Install bot deps + start with PM2

```bash
npm install
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 7) Update bot after pushing to GitHub

```bash
cd <YOUR_REPO>
git pull
npm install
pm2 restart ggrd-rewards-bot
```

## Backups (recommended)

Daily backup:
```bash
./scripts/backup_mongo.sh
```

Restore from backup (overwrites DB):
```bash
./scripts/restore_mongo.sh backups/<FILE>.archive.gz
```

## Notes

* Use a **private Solana RPC** on VPS (`SOLANA_RPC_URL`) to avoid 429/403 errors.
* MongoDB is bound to **127.0.0.1** in docker-compose (not exposed publicly).


## First-run setup wizard

If `.env` does not exist, the bot will launch an interactive wizard on first start.
You can also run it explicitly:

```bash
npm run setup
```

Then start MongoDB and the bot:

```bash
docker compose up -d mongo
pm2 start ecosystem.config.js
pm2 save
```

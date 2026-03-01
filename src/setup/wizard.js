const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

function isTruthyYes(raw) {
  return ['1','true','yes','y','on'].includes(String(raw || '').trim().toLowerCase());
}

function generateSecret(len = 32) {
  // base64url without padding
  return crypto.randomBytes(Math.ceil(len * 0.75)).toString('base64url').slice(0, len);
}

function serializeEnvValue(v) {
  const s = String(v ?? '');
  // Quote if contains spaces or characters that dotenv may parse oddly.
  if (/[ \t\r\n]/.test(s) || s.includes('#') || s.includes('"')) {
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return s;
}

function createRl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Password masking support
  rl.stdoutMuted = false;
  rl._writeToOutput = function _writeToOutput(stringToWrite) {
    if (rl.stdoutMuted) {
      // Replace typed chars with *
      rl.output.write('*');
    } else {
      rl.output.write(stringToWrite);
    }
  };

  return rl;
}

function ask(rl, prompt, { def = null, required = false, secret = false } = {}) {
  const suffix = def !== null && def !== undefined && String(def).length
    ? ` [default: ${def}]`
    : '';
  const q = `${prompt}${suffix}: `;

  return new Promise((resolve) => {
    const askOnce = () => {
      if (secret) rl.stdoutMuted = true;
      rl.question(q, (answer) => {
        if (secret) {
          rl.stdoutMuted = false;
          rl.output.write('\n');
        }

        const raw = (answer ?? '').trim();
        const v = raw.length ? raw : (def ?? '');
        if (required && !String(v).trim()) {
          rl.output.write('Value is required.\n');
          return askOnce();
        }
        resolve(v);
      });
    };
    askOnce();
  });
}

async function runFirstRunWizard({ envPath, projectRoot }) {
  const rl = createRl();

  try {
    rl.output.write('\n=== GGRD Rewards Bot: first-run setup ===\n');
    rl.output.write('This wizard will create a local .env file for your VPS deployment.\n');
    rl.output.write('Nothing is sent anywhere; values are stored only on this server.\n\n');

    // Telegram
    const BOT_TOKEN = await ask(rl, 'Telegram BOT_TOKEN (from @BotFather)', { required: true, secret: true });
    const BOT_USERNAME = await ask(rl, 'Bot username (without @)', { required: true });

    const ADMIN_ID = await ask(rl, 'Admin Telegram ID (optional, leave empty to skip)', { def: '' });

    // Community
    const CHANNEL_ID = await ask(rl, 'Channel username (for join-check)', { def: '@GGRDofficial' });
    const GROUP_ID = await ask(rl, 'Group username (optional)', { def: '@GGRDchat' });

    // Solana
    const SOLANA_RPC_URL = await ask(rl, 'Solana RPC URL', { def: 'https://solana-mainnet.gateway.tatum.io/' });

    // Token mints
    const GGRD_TOKEN_MINT = await ask(rl, 'GGRD token mint', { def: 'TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE' });
    const USDC_MINT = await ask(rl, 'USDC mint', { def: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });

    // Mongo (self-hosted on VPS)
    rl.output.write('\n--- MongoDB (self-hosted on this VPS) ---\n');
    rl.output.write('Default setup uses docker-compose with MongoDB bound to 127.0.0.1 only.\n');

    const MONGODB_DB = await ask(rl, 'Mongo DB name', { def: 'ggrd_bot' });
    const MONGODB_HOST = await ask(rl, 'Mongo host', { def: '127.0.0.1' });
    const MONGODB_PORT = await ask(rl, 'Mongo port', { def: '27017' });

    const MONGODB_USER = await ask(rl, 'Mongo app user', { def: 'ggrd_bot_admin' });
    let MONGODB_PASS = await ask(rl, 'Mongo app password (leave empty to auto-generate)', { def: '', secret: true });
    if (!MONGODB_PASS) MONGODB_PASS = generateSecret(32);

    const MONGO_ROOT_USER = await ask(rl, 'Mongo ROOT user (docker init)', { def: 'root' });
    let MONGO_ROOT_PASS = await ask(rl, 'Mongo ROOT password (leave empty to auto-generate)', { def: '', secret: true });
    if (!MONGO_ROOT_PASS) MONGO_ROOT_PASS = generateSecret(32);

    const MONGODB_AUTHSOURCE = await ask(rl, 'Mongo authSource', { def: 'admin' });

    // Program params (defaults are fine; ask only if user wants)
    rl.output.write('\n--- Program parameters (defaults recommended) ---\n');
    const customize = await ask(rl, 'Customize program parameters now? (y/N)', { def: 'n' });

    let MIN_HOLD_GGRD = '100';
    let MIN_NET_BUY_USDC = '5';
    let HOLD_TIME_1_HOURS = '24';
    let HOLD_TIME_2_HOURS = '72';
    let MAX_VERIFIED_REFERRALS_PER_DAY = '10';
    let MAX_POINTS_PER_WALLET_PER_WEEK = '2000';
    let HOLD_CHECK_INTERVAL_MINUTES = '30';
    let HOLD_CHECK_ENABLED = 'true';

    if (isTruthyYes(customize)) {
      MIN_HOLD_GGRD = await ask(rl, 'MIN_HOLD_GGRD', { def: MIN_HOLD_GGRD });
      MIN_NET_BUY_USDC = await ask(rl, 'MIN_NET_BUY_USDC', { def: MIN_NET_BUY_USDC });
      HOLD_TIME_1_HOURS = await ask(rl, 'HOLD_TIME_1_HOURS', { def: HOLD_TIME_1_HOURS });
      HOLD_TIME_2_HOURS = await ask(rl, 'HOLD_TIME_2_HOURS', { def: HOLD_TIME_2_HOURS });
      MAX_VERIFIED_REFERRALS_PER_DAY = await ask(rl, 'MAX_VERIFIED_REFERRALS_PER_DAY', { def: MAX_VERIFIED_REFERRALS_PER_DAY });
      MAX_POINTS_PER_WALLET_PER_WEEK = await ask(rl, 'MAX_POINTS_PER_WALLET_PER_WEEK', { def: MAX_POINTS_PER_WALLET_PER_WEEK });
      HOLD_CHECK_INTERVAL_MINUTES = await ask(rl, 'HOLD_CHECK_INTERVAL_MINUTES', { def: HOLD_CHECK_INTERVAL_MINUTES });
      HOLD_CHECK_ENABLED = await ask(rl, 'HOLD_CHECK_ENABLED (true/false)', { def: HOLD_CHECK_ENABLED });
    }

    const LOG_LEVEL = await ask(rl, 'LOG_LEVEL', { def: 'info' });

    // Build .env
    const lines = [
      '# Auto-generated by first-run setup wizard',
      `BOT_TOKEN=${serializeEnvValue(BOT_TOKEN)}`,
      `BOT_USERNAME=${serializeEnvValue(BOT_USERNAME)}`,
      `ADMIN_ID=${serializeEnvValue(ADMIN_ID)}`,
      '',
      `CHANNEL_ID=${serializeEnvValue(CHANNEL_ID)}`,
      `GROUP_ID=${serializeEnvValue(GROUP_ID)}`,
      '',
      `SOLANA_RPC_URL=${serializeEnvValue(SOLANA_RPC_URL)}`,
      `GGRD_TOKEN_MINT=${serializeEnvValue(GGRD_TOKEN_MINT)}`,
      `USDC_MINT=${serializeEnvValue(USDC_MINT)}`,
      '',
      '# Mongo (self-hosted)',
      `MONGODB_DB=${serializeEnvValue(MONGODB_DB)}`,
      `MONGODB_HOST=${serializeEnvValue(MONGODB_HOST)}`,
      `MONGODB_PORT=${serializeEnvValue(MONGODB_PORT)}`,
      `MONGODB_USER=${serializeEnvValue(MONGODB_USER)}`,
      `MONGODB_PASS=${serializeEnvValue(MONGODB_PASS)}`,
      `MONGODB_AUTHSOURCE=${serializeEnvValue(MONGODB_AUTHSOURCE)}`,
      '',
      '# Docker Mongo init (required for docker-compose)',
      `MONGO_ROOT_USER=${serializeEnvValue(MONGO_ROOT_USER)}`,
      `MONGO_ROOT_PASS=${serializeEnvValue(MONGO_ROOT_PASS)}`,
      '',
      '# Program parameters',
      `MIN_HOLD_GGRD=${serializeEnvValue(MIN_HOLD_GGRD)}`,
      `MIN_NET_BUY_USDC=${serializeEnvValue(MIN_NET_BUY_USDC)}`,
      `HOLD_TIME_1_HOURS=${serializeEnvValue(HOLD_TIME_1_HOURS)}`,
      `HOLD_TIME_2_HOURS=${serializeEnvValue(HOLD_TIME_2_HOURS)}`,
      `MAX_VERIFIED_REFERRALS_PER_DAY=${serializeEnvValue(MAX_VERIFIED_REFERRALS_PER_DAY)}`,
      `MAX_POINTS_PER_WALLET_PER_WEEK=${serializeEnvValue(MAX_POINTS_PER_WALLET_PER_WEEK)}`,
      '',
      '# Ops',
      `HOLD_CHECK_INTERVAL_MINUTES=${serializeEnvValue(HOLD_CHECK_INTERVAL_MINUTES)}`,
      `HOLD_CHECK_ENABLED=${serializeEnvValue(HOLD_CHECK_ENABLED)}`,
      `LOG_LEVEL=${serializeEnvValue(LOG_LEVEL)}`,
      '',
    ];

    const dir = path.dirname(envPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Write with restrictive perms on Linux
    fs.writeFileSync(envPath, lines.join('\n'), { encoding: 'utf-8', mode: 0o600 });

    rl.output.write(`\n[OK] Created: ${envPath}\n`);
    rl.output.write('[NEXT] Start MongoDB:  docker compose up -d mongo\n');
    rl.output.write('[NEXT] Start bot:       npm start   (or pm2 start ecosystem.config.js)\n\n');

    return { ok: true };
  } finally {
    rl.close();
  }
}

module.exports = { runFirstRunWizard };

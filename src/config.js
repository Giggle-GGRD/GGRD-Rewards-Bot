require('dotenv').config();

/**
 * Centralized configuration for GGRD Rewards Bot.
 *
 * DESIGN: All publicly-known values are hardcoded as defaults below.
 * The .env file only needs to contain SECRETS:
 *   - BOT_TOKEN
 *   - MONGODB_PASS  (or MONGO_ROOT_PASS for docker-compose)
 *   - SOLANA_RPC_URL (if using a private RPC with API key)
 */

// ── helpers ──────────────────────────────────

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer env ${name}=${raw}`);
  return n;
}

function float(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Invalid number env ${name}=${raw}`);
  return n;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
}

/** Read first defined env var from a list of names (new → legacy fallback). */
function env(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

// ── public constants (override via .env only if needed) ──

const DEFAULTS = {
  BOT_USERNAME:       'GGRD_Rewards_Bot',
  ADMIN_ID:           '6191344175',

  CHANNEL_ID:         '@GGRDofficial',
  GROUP_ID:           '@GGRDchat',

  SOLANA_RPC_URL:     'https://solana-mainnet.gateway.tatum.io/',
  GGRD_TOKEN_MINT:    'TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE',
  USDC_MINT:          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',

  MONGODB_HOST:       '127.0.0.1',
  MONGODB_PORT:       27017,
  MONGODB_DB:         'ggrd_bot',
  MONGODB_USER:       'ggrd_bot_admin',
  MONGODB_AUTHSOURCE: 'admin',
  MONGO_ROOT_USER:    'root',
};

// ── config object ────────────────────────────

const config = {
  // ─ Telegram (only BOT_TOKEN is secret) ─
  BOT_TOKEN:    required('BOT_TOKEN'),
  BOT_USERNAME: process.env.BOT_USERNAME || DEFAULTS.BOT_USERNAME,
  ADMIN_ID:     process.env.ADMIN_ID     || DEFAULTS.ADMIN_ID,

  // Community
  CHANNEL_ID: process.env.CHANNEL_ID || DEFAULTS.CHANNEL_ID,
  GROUP_ID:   process.env.GROUP_ID   || DEFAULTS.GROUP_ID,

  // ─ MongoDB (only password is secret) ─
  MONGODB_URI: (() => {
    // Mode 1: explicit full URI (Atlas or custom)
    const uri = process.env.MONGODB_URI;
    if (uri && uri.trim()) return uri.trim();

    // Mode 2: build from components (VPS self-hosted)
    const host       = env('MONGODB_HOST', 'HOST')                        || DEFAULTS.MONGODB_HOST;
    const port       = parseInt(env('MONGODB_PORT', 'PORT') || String(DEFAULTS.MONGODB_PORT), 10);
    const dbName     = env('MONGODB_DB', 'DB')                            || DEFAULTS.MONGODB_DB;
    const user       = env('MONGODB_USER', 'USER')                        || DEFAULTS.MONGODB_USER;
    const pass       = env('MONGODB_PASS', 'MONGODB_PASSWORD', 'PASSWORD');
    const authSource = env('MONGODB_AUTHSOURCE', 'AUTHSOURCE')            || DEFAULTS.MONGODB_AUTHSOURCE;

    if (!pass) {
      throw new Error(
        'Missing required env: MONGODB_PASS (MongoDB password).\n' +
        'All other MongoDB settings have defaults. You only need to add:\n' +
        '  MONGODB_PASS=your_password\n' +
        'Or run: node src/index.js --setup'
      );
    }

    const u = encodeURIComponent(user);
    const p = encodeURIComponent(pass);
    return `mongodb://${u}:${p}@${host}:${port}/${dbName}?authSource=${encodeURIComponent(authSource)}`;
  })(),
  MONGODB_DB: env('MONGODB_DB', 'DB') || DEFAULTS.MONGODB_DB,

  // ─ Solana (RPC URL may contain API key → treat as secret) ─
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || DEFAULTS.SOLANA_RPC_URL,
  GGRD_MINT:      process.env.GGRD_TOKEN_MINT || DEFAULTS.GGRD_TOKEN_MINT,
  USDC_MINT:      process.env.USDC_MINT       || DEFAULTS.USDC_MINT,

  // ─ Program parameters (all have safe defaults) ─
  MIN_HOLD_GGRD:                 float('MIN_HOLD_GGRD', 100),
  MIN_NET_BUY_USDC:              float('MIN_NET_BUY_USDC', 5),

  HOLD_TIME_1_HOURS:             int('HOLD_TIME_1_HOURS', 24),
  HOLD_TIME_2_HOURS:             int('HOLD_TIME_2_HOURS', 72),

  MAX_VERIFIED_REFERRALS_PER_DAY: int('MAX_VERIFIED_REFERRALS_PER_DAY', 10),
  MAX_POINTS_PER_WALLET_PER_WEEK: int('MAX_POINTS_PER_WALLET_PER_WEEK', 2000),

  BUY_POINTS_MIN: int('BUY_POINTS_MIN', 50),
  BUY_POINTS_MAX: int('BUY_POINTS_MAX', 800),
  REF_POINTS_MAX: int('REF_POINTS_MAX', 400),

  HOLD_CHECK_INTERVAL_MINUTES: int('HOLD_CHECK_INTERVAL_MINUTES', 30),
  HOLD_CHECK_ENABLED:          bool('HOLD_CHECK_ENABLED', true),

  // Ops
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

module.exports = { config, DEFAULTS };

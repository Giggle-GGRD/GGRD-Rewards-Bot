require('dotenv').config();

/**
 * Centralized configuration for VPS deployment.
 * Keep values in .env and never commit secrets.
 */

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

// ──────────────────────────────────────────────
// FIX: Helper reads MONGODB_X first, then falls
//      back to legacy short names (HOST, USER …)
//      so both old and new .env files work.
// ──────────────────────────────────────────────
function env(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

const config = {
  // Telegram
  BOT_TOKEN: required('BOT_TOKEN'),
  BOT_USERNAME: required('BOT_USERNAME'), // WITHOUT @
  ADMIN_ID: process.env.ADMIN_ID ? String(process.env.ADMIN_ID) : null,

  // Community (optional)
  CHANNEL_ID: process.env.CHANNEL_ID || '@GGRDofficial',
  GROUP_ID: process.env.GROUP_ID || '@GGRDchat',

  // DB
  // Prefer explicit URI; otherwise build a localhost URI for VPS self-hosted Mongo.
  MONGODB_URI: (() => {
    const uri = process.env.MONGODB_URI;
    if (uri && uri.trim()) return uri.trim();

    const host = env('MONGODB_HOST', 'HOST') || '127.0.0.1';
    const port = parseInt(env('MONGODB_PORT', 'PORT') || '27017', 10);
    const dbName = env('MONGODB_DB', 'DB') || 'ggrd_bot';
    const user = env('MONGODB_USER', 'USER');
    const pass = env('MONGODB_PASS', 'MONGODB_PASSWORD', 'PASSWORD');

    if (!user || !pass) {
      throw new Error(
        'Missing required env: MONGODB_URI (or MONGODB_USER + MONGODB_PASS for self-hosted MongoDB).\n' +
        'Legacy env names USER + PASSWORD are also accepted.\n' +
        'Run: node src/index.js --setup   to generate a valid .env file.'
      );
    }

    const u = encodeURIComponent(user);
    const p = encodeURIComponent(pass);
    const authSource = env('MONGODB_AUTHSOURCE', 'AUTHSOURCE') || 'admin';
    return `mongodb://${u}:${p}@${host}:${port}/${dbName}?authSource=${encodeURIComponent(authSource)}`;
  })(),
  MONGODB_DB: env('MONGODB_DB', 'DB') || 'ggrd_bot',

  // Solana / program params
  SOLANA_RPC_URL: required('SOLANA_RPC_URL'),
  GGRD_MINT: required('GGRD_TOKEN_MINT'),
  USDC_MINT: process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',

  MIN_HOLD_GGRD: float('MIN_HOLD_GGRD', 100),
  MIN_NET_BUY_USDC: float('MIN_NET_BUY_USDC', 5),

  HOLD_TIME_1_HOURS: int('HOLD_TIME_1_HOURS', 24),
  HOLD_TIME_2_HOURS: int('HOLD_TIME_2_HOURS', 72),

  MAX_VERIFIED_REFERRALS_PER_DAY: int('MAX_VERIFIED_REFERRALS_PER_DAY', 10),
  MAX_POINTS_PER_WALLET_PER_WEEK: int('MAX_POINTS_PER_WALLET_PER_WEEK', 2000),

  BUY_POINTS_MIN: int('BUY_POINTS_MIN', 50),
  BUY_POINTS_MAX: int('BUY_POINTS_MAX', 800),
  REF_POINTS_MAX: int('REF_POINTS_MAX', 400),

  HOLD_CHECK_INTERVAL_MINUTES: int('HOLD_CHECK_INTERVAL_MINUTES', 30),
  HOLD_CHECK_ENABLED: bool('HOLD_CHECK_ENABLED', true),

  // Ops
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

module.exports = { config };

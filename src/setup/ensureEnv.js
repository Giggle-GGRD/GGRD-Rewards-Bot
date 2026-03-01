const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { runFirstRunWizard } = require('./wizard');

/**
 * Only truly required env vars — secrets that have NO defaults in config.js.
 * Public values (BOT_USERNAME, mints, channels, etc.) are hardcoded in config.js.
 */
const REQUIRED_SECRETS = [
  'BOT_TOKEN',
];

function hasDbPassword(env) {
  // Full URI bypasses the need for separate password
  if (env.MONGODB_URI && String(env.MONGODB_URI).trim()) return true;
  // Check all possible password var names
  return Boolean(
    env.MONGODB_PASS || env.MONGODB_PASSWORD || env.PASSWORD
  );
}

function missingKeys(env) {
  const missing = [];
  for (const k of REQUIRED_SECRETS) {
    if (!env[k] || !String(env[k]).trim()) missing.push(k);
  }
  if (!hasDbPassword(env)) {
    missing.push('MONGODB_PASS');
  }
  return missing;
}

async function ensureEnv({ projectRoot, forceSetup = false }) {
  const envPath = path.join(projectRoot, '.env');

  // Load existing .env if present
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf-8');
    const parsed = dotenv.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }

  const missing = missingKeys(process.env);

  if (!forceSetup && missing.length === 0) {
    return { didSetup: false, envPath };
  }

  if (!process.stdin.isTTY) {
    const msg = [
      'Missing required secrets and no TTY available for interactive setup.',
      `Missing: ${missing.join(', ')}`,
      `Create ${envPath} from .env.example or run: node src/index.js --setup`,
    ].join('\n');
    throw new Error(msg);
  }

  const res = await runFirstRunWizard({ envPath, projectRoot });
  dotenv.config({ path: envPath, override: true });

  const missingAfter = missingKeys(process.env);
  if (missingAfter.length) {
    throw new Error(`Setup incomplete. Missing: ${missingAfter.join(', ')}`);
  }

  return { didSetup: true, envPath, result: res };
}

module.exports = { ensureEnv };

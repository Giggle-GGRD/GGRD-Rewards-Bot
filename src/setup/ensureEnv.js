const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { runFirstRunWizard } = require('./wizard');

const REQUIRED_KEYS = [
  'BOT_TOKEN',
  'BOT_USERNAME',
  'SOLANA_RPC_URL',
  'GGRD_TOKEN_MINT',
];

function hasDbConfig(env) {
  if (env.MONGODB_URI && String(env.MONGODB_URI).trim()) return true;
  return Boolean(env.MONGODB_USER && env.MONGODB_PASS);
}

function hasDockerMongoConfig(env) {
  // Not strictly required if user uses MONGODB_URI, but required for the bundled docker-compose.
  return Boolean(env.MONGO_ROOT_USER && env.MONGO_ROOT_PASS);
}

function missingKeys(env) {
  const missing = [];
  for (const k of REQUIRED_KEYS) {
    if (!env[k] || !String(env[k]).trim()) missing.push(k);
  }
  if (!hasDbConfig(env)) missing.push('MONGODB_URI (or MONGODB_USER + MONGODB_PASS)');
  // Encourage having these when using VPS self-hosted mongo
  if (!hasDockerMongoConfig(env)) missing.push('MONGO_ROOT_USER + MONGO_ROOT_PASS (for docker-compose mongo)');
  return missing;
}

async function ensureEnv({ projectRoot, forceSetup = false }) {
  const envPath = path.join(projectRoot, '.env');

  // Load existing .env if present
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf-8');
    const parsed = dotenv.parse(raw);
    // do not override existing process.env values
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } else {
    // Load .env.example (for defaults if needed later)
  }

  const missing = missingKeys(process.env);

  if (!forceSetup && missing.length === 0) {
    return { didSetup: false, envPath };
  }

  if (!process.stdin.isTTY) {
    const msg = [
      'Missing required configuration and no TTY available for interactive setup.',
      `Missing: ${missing.join(', ')}`,
      `Create ${envPath} from .env.example or run: node src/index.js --setup`,
    ].join('\n');
    throw new Error(msg);
  }

  const res = await runFirstRunWizard({ envPath, projectRoot });
  // Reload env from the newly created file (override process.env)
  dotenv.config({ path: envPath, override: true });

  // Validate again
  const missingAfter = missingKeys(process.env);
  if (missingAfter.length) {
    throw new Error(`Setup incomplete. Missing: ${missingAfter.join(', ')}`);
  }

  return { didSetup: true, envPath, result: res };
}

module.exports = { ensureEnv };

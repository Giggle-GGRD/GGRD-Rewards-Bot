const path = require('path');
const { ensureEnv } = require('./setup/ensureEnv');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const forceSetup = process.argv.includes('--setup');

  // Ensure .env exists (first-run wizard) and load env vars BEFORE requiring config.
  const { didSetup } = await ensureEnv({ projectRoot, forceSetup });

  if (forceSetup) {
    // When running setup explicitly, exit after generating .env.
    // eslint-disable-next-line no-console
    console.log('[OK] Setup completed. You can now start the bot normally (npm start).');
    process.exit(0);
  }

  if (didSetup) {
    // eslint-disable-next-line no-console
    console.log('[OK] .env generated. Continuing with normal startup...');
  }

  // Require runtime modules AFTER env is loaded
  const { config } = require('./config');
  const { connectMongo } = require('./db');
  const { createConnection } = require('./solana');
  const { createBot } = require('./bot');

  // Mongo
  const { client, members, events } = await connectMongo({
    uri: config.MONGODB_URI,
    dbName: config.MONGODB_DB,
  });

  // Solana
  const connection = createConnection(config.SOLANA_RPC_URL);

  const { bot, runHoldCheckOnce } = createBot({
    cfg: config,
    members,
    events,
    connection,
  });

  // Launch
  await bot.launch({ dropPendingUpdates: true });
  // eslint-disable-next-line no-console
  console.log('[OK] Bot started.');

  // Hold worker
  let timer = null;
  if (config.HOLD_CHECK_ENABLED) {
    const intervalMs = config.HOLD_CHECK_INTERVAL_MINUTES * 60_000;
    timer = setInterval(async () => {
      try {
        await runHoldCheckOnce();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[HOLD_CHECK_ERROR]', e?.message || e);
      }
    }, intervalMs);
    timer.unref?.();
    // eslint-disable-next-line no-console
    console.log(`[OK] Hold-check worker enabled (${config.HOLD_CHECK_INTERVAL_MINUTES} min).`);
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[SHUTDOWN] ${signal}`);
    try {
      if (timer) clearInterval(timer);
      await bot.stop(signal);
    } catch {
      // ignore
    }
    try {
      await client.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL]', e);
  process.exit(1);
});

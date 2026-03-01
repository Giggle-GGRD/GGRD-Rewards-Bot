/**
 * MongoDB init script (docker-compose).
 * Creates an application user with readWrite permissions on the app DB.
 * Values are provided via environment variables:
 *  - MONGO_APP_USER
 *  - MONGO_APP_PASS
 *  - MONGO_APP_DB
 */
const appUser = process.env.MONGO_APP_USER;
const appPass = process.env.MONGO_APP_PASS;
const appDb   = process.env.MONGO_APP_DB || 'ggrd_bot';

if (!appUser || !appPass) {
  print('[mongo-init] Missing MONGO_APP_USER / MONGO_APP_PASS. Skipping app user creation.');
} else {
  print(`[mongo-init] Creating app user "${appUser}" on DB "${appDb}"`);
  const dbApp = db.getSiblingDB(appDb);
  dbApp.createUser({
    user: appUser,
    pwd: appPass,
    roles: [{ role: 'readWrite', db: appDb }],
  });
  print('[mongo-init] Done.');
}

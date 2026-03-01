const { MongoClient } = require('mongodb');

/**
 * MongoDB bootstrap with idempotent indexes.
 */

async function connectMongo({ uri, dbName }) {
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(dbName);

  const members = db.collection('members');
  const events = db.collection('events');

  // Core indexes
  await members.createIndex({ telegram_id: 1 }, { unique: true });
  await members.createIndex(
    { wallet_address: 1 },
    { unique: true, partialFilterExpression: { wallet_address: { $type: 'string' } } }
  );
  await members.createIndex({ referred_by: 1 });
  await members.createIndex({ 'program.verified24_at': 1 });
  await members.createIndex({ 'program.points.total': -1 });
  await members.createIndex({ 'program.referral.verified_total': -1 });

  // Idempotency / dedup
  // One unique "key" per logical event.
  await events.createIndex({ key: 1 }, { unique: true });
  await events.createIndex({ created_at: -1 });

  return { client, db, members, events };
}

module.exports = { connectMongo };

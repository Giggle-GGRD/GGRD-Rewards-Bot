const { ObjectId } = require('mongodb');

function now() {
  return new Date();
}

function startOfIsoWeek(d = new Date()) {
  // ISO week starts Monday
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1));
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfUtcDay(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function computeBuyPoints({ netBuyUsdc, minPoints, maxPoints }) {
  const base = Math.floor(100 * Math.sqrt(Math.max(0, netBuyUsdc)));
  return clamp(base, minPoints, maxPoints);
}

async function ensureMemberDefaults(members, telegramId, record = {}) {
  const id = String(telegramId);
  const existing = await members.findOne({ telegram_id: id });
  if (existing) {
    // Ensure program object exists (migrate in-place once)
    if (!existing.program) {
      await members.updateOne(
        { telegram_id: id },
        {
          $set: {
            program: defaultProgram(),
            updated_at: now(),
          },
        }
      );
      return await members.findOne({ telegram_id: id });
    }
    return existing;
  }

  const doc = {
    telegram_id: id,
    telegram_username: record.telegram_username || null,
    first_name: record.first_name || null,
    last_name: record.last_name || null,
    wallet_address: record.wallet_address || null,
    referred_by: record.referred_by || null,

    referrals: {
      clicks: 0,
      verified_total: 0,
    },

    program: defaultProgram(),
    created_at: now(),
    updated_at: now(),
  };

  await members.insertOne(doc);
  return doc;
}

function defaultProgram() {
  return {
    activated: false,
    wallet_linked: false,
    state: {
      awaiting_wallet: false,
      awaiting_txsig: false,
    },
    buy: {
      last_txsig: null,
      net_buy_usdc: 0,
      net_buy_ggrd: 0,
      buy_points: 0,
      buy_verified_at: null,
    },
    qualified_at: null,
    verified24_at: null,
    verified72_at: null,
    points: {
      buyer: 0,
      referral: 0,
      total: 0,
      week_start: startOfIsoWeek(),
      week_total: 0,
    },
    referral: {
      daily_reset_at: startOfUtcDay(),
      verified_today: 0,
      verified_total: 0,
    },
  };
}

async function createEvent(events, { event_type, telegram_id, wallet, txsig, payload }) {
  // Build a stable unique key for idempotency.
  // Priority: txsig > wallet > telegram_id.
  let key;
  if (txsig) key = `txsig:${txsig}:${event_type}`;
  else if (wallet) key = `wallet:${wallet}:${event_type}`;
  else if (telegram_id !== undefined && telegram_id !== null) key = `tg:${String(telegram_id)}:${event_type}`;
  else throw new Error('createEvent requires txsig, wallet or telegram_id');

  const doc = {
    _id: new ObjectId(),
    key,
    event_type,
    telegram_id: telegram_id ? String(telegram_id) : undefined,
    wallet: wallet || undefined,
    txsig: txsig || undefined,
    payload: payload || undefined,
    created_at: now(),
  };

  try {
    await events.insertOne(doc);
    return { inserted: true };
  } catch (e) {
    // Duplicate key => already processed
    if (String(e.code) === '11000') return { inserted: false, duplicate: true };
    throw e;
  }
}

async function addPointsWithWeeklyCap(members, telegramId, pointsToAdd, maxWeekly) {
  const id = String(telegramId);
  const member = await members.findOne({ telegram_id: id });
  if (!member) return { ok: false, reason: 'member_not_found' };

  const p = member.program?.points || {};
  const weekStart = p.week_start ? new Date(p.week_start) : startOfIsoWeek();
  const currentWeekStart = startOfIsoWeek();

  let weekTotal = p.week_total || 0;
  if (weekStart.getTime() !== currentWeekStart.getTime()) {
    weekTotal = 0;
  }

  const allowed = Math.max(0, maxWeekly - weekTotal);
  const add = Math.min(pointsToAdd, allowed);
  if (add <= 0) {
    // Still normalize week_start if needed
    if (weekStart.getTime() !== currentWeekStart.getTime()) {
      await members.updateOne(
        { telegram_id: id },
        {
          $set: {
            'program.points.week_start': currentWeekStart,
            'program.points.week_total': 0,
            updated_at: now(),
          },
        }
      );
    }
    return { ok: false, reason: 'weekly_cap' };
  }

  const update = {
    $inc: {
      'program.points.total': add,
      'program.points.week_total': add,
    },
    $set: {
      'program.points.week_start': currentWeekStart,
      updated_at: now(),
    },
  };

  await members.updateOne({ telegram_id: id }, update);
  return { ok: true, added: add, capped: add < pointsToAdd };
}

async function addBuyerPoints(members, telegramId, pointsToAdd, maxWeekly) {
  const id = String(telegramId);
  const base = await addPointsWithWeeklyCap(members, id, pointsToAdd, maxWeekly);
  if (!base.ok) return base;
  await members.updateOne(
    { telegram_id: id },
    {
      $inc: { 'program.points.buyer': base.added },
      $set: { updated_at: now() },
    }
  );
  return base;
}

async function addReferralPoints(members, telegramId, pointsToAdd, maxWeekly) {
  const id = String(telegramId);
  const base = await addPointsWithWeeklyCap(members, id, pointsToAdd, maxWeekly);
  if (!base.ok) return base;
  await members.updateOne(
    { telegram_id: id },
    {
      $inc: { 'program.points.referral': base.added },
      $set: { updated_at: now() },
    }
  );
  return base;
}

async function incrementReferralClick(members, referrerId) {
  await members.updateOne(
    { telegram_id: String(referrerId) },
    { $inc: { 'referrals.clicks': 1 }, $set: { updated_at: now() } }
  );
}

async function resetDailyReferralIfNeeded(members, referrerId) {
  const id = String(referrerId);
  const member = await members.findOne({ telegram_id: id });
  if (!member) return;
  const resetAt = member.program?.referral?.daily_reset_at
    ? new Date(member.program.referral.daily_reset_at)
    : startOfUtcDay();
  const today = startOfUtcDay();
  if (resetAt.getTime() !== today.getTime()) {
    await members.updateOne(
      { telegram_id: id },
      {
        $set: {
          'program.referral.daily_reset_at': today,
          'program.referral.verified_today': 0,
          updated_at: now(),
        },
      }
    );
  }
}

module.exports = {
  defaultProgram,
  ensureMemberDefaults,
  createEvent,
  computeBuyPoints,
  addBuyerPoints,
  addReferralPoints,
  incrementReferralClick,
  resetDailyReferralIfNeeded,
};

const { Telegraf, Markup } = require('telegraf');
const {
  isValidSolanaAddress,
  isValidSolanaTxSig,
  getTokenBalanceByOwner,
  verifyBuyTx,
} = require('./solana');

const {
  ensureMemberDefaults,
  createEvent,
  computeBuyPoints,
  addBuyerPoints,
  addReferralPoints,
  incrementReferralClick,
  resetDailyReferralIfNeeded,
} = require('./program');

function escapeMd(text) {
  if (!text) return '';
  return text.replace(/([_*[]()~`>#+\-=|{}.!])/g, '\\$1');
}

function buildMainKeyboard(cfg) {
  const jup = `https://jup.ag/tokens/${cfg.GGRD_MINT}`;
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Activate', 'activate')],
    [Markup.button.callback('🔗 Link wallet', 'link_wallet')],
    [Markup.button.callback('🧾 Submit buy TX', 'submit_txsig')],
    [Markup.button.callback('📊 Status', 'status')],
    [Markup.button.callback('👥 Invite (referral link)', 'invite')],
    [Markup.button.url('🟢 Buy GGRD (Jupiter)', jup)],
  ]);
}

function buildShareUrl(refLink) {
  const text = `Join GGRD and claim rewards 🎁\nStart here: ${refLink}`;
  return `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`;
}

async function sendStatus({ cfg, members, connection, ctx }) {
  const member = await ensureMemberDefaults(members, ctx.from.id, {
    telegram_username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
  });

  let bal = 0;
  if (member.wallet_address) {
    try {
      bal = await getTokenBalanceByOwner({
        connection,
        ownerAddress: member.wallet_address,
        mintAddress: cfg.GGRD_MINT,
      });
    } catch {
      // ignore
    }
  }
  const msg = await buildStatusMessage(cfg, member, bal);
  await ctx.reply(msg, { parse_mode: 'Markdown' });
}

async function sendInvite({ cfg, members, ctx }) {
  const id = String(ctx.from.id);
  const member = await ensureMemberDefaults(members, id, {
    telegram_username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
  });

  const refLink = `https://t.me/${cfg.BOT_USERNAME}?start=ref_${id}`;
  const shareUrl = buildShareUrl(refLink);
  const msg =
    `*Your referral link*\n${escapeMd(refLink)}\n\n` +
    `Clicks: ${member.referrals?.clicks || 0}\n` +
    `Verified buyers: ${member.referrals?.verified_total || 0}\n\n` +
    `_Referrals are credited only after the invited user becomes a verified buyer (holds ≥ ${cfg.MIN_HOLD_GGRD} for ${cfg.HOLD_TIME_1_HOURS}h)._`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.url('Share', shareUrl)],
      [Markup.button.callback('📊 Status', 'status')],
    ]),
    disable_web_page_preview: true,
  });
}

async function buildStatusMessage(cfg, member, ggrdBalance) {
  const p = member.program || {};
  const buy = p.buy || {};
  const points = p.points || {};

  const lines = [];
  lines.push(`*GGRD Rewards Bot — Status*`);
  lines.push('');
  lines.push(`• Activated: ${p.activated ? '✅' : '❌'}`);
  lines.push(`• Wallet: ${member.wallet_address ? `✅ ${escapeMd(member.wallet_address)}` : '❌ not linked'}`);
  lines.push(`• Buy verified: ${buy.buy_verified_at ? '✅' : '❌'}`);
  lines.push(`• Hold ≥ ${cfg.MIN_HOLD_GGRD} GGRD: ${ggrdBalance >= cfg.MIN_HOLD_GGRD ? '✅' : '❌'} (${ggrdBalance.toFixed(3)} GGRD)`);
  lines.push(`• Hold 24h: ${p.verified24_at ? '✅' : '❌'}`);
  lines.push(`• Hold 72h: ${p.verified72_at ? '✅' : '❌'}`);
  lines.push('');
  lines.push(`*Points*`);
  lines.push(`• Buyer points: ${Math.floor(points.buyer || 0)}`);
  lines.push(`• Referral points: ${Math.floor(points.referral || 0)}`);
  lines.push(`• Total: ${Math.floor(points.total || 0)}`);
  lines.push('');
  lines.push(`*Referral*`);
  lines.push(`• Clicks: ${member.referrals?.clicks || 0}`);
  lines.push(`• Verified buyers: ${member.referrals?.verified_total || 0}`);
  lines.push('');
  lines.push(`_Note: During DBC phase the bot accrues points. GGRD payouts start after migration._`);
  return lines.join('\n');
}

async function runHoldCheckOnce({ cfg, members, events, connection, bot }) {
  const now = new Date();
  const h1Ms = cfg.HOLD_TIME_1_HOURS * 3600 * 1000;
  const h2Ms = cfg.HOLD_TIME_2_HOURS * 3600 * 1000;

  const cursor = members.find({
    wallet_address: { $ne: null },
    'program.buy.buy_verified_at': { $ne: null },
    $or: [{ 'program.verified72_at': null }, { 'program.verified72_at': { $exists: false } }],
  });

  // eslint-disable-next-line no-restricted-syntax
  for await (const m of cursor) {
    const wallet = m.wallet_address;
    if (!wallet) continue;

    let bal = 0;
    try {
      bal = await getTokenBalanceByOwner({
        connection,
        ownerAddress: wallet,
        mintAddress: cfg.GGRD_MINT,
      });
    } catch {
      // ignore transient RPC errors
      // (next cycle will retry)
      continue;
    }

    const id = m.telegram_id;
    const p = m.program || {};
    const qualifiedAt = p.qualified_at ? new Date(p.qualified_at) : null;

    if (bal < cfg.MIN_HOLD_GGRD) {
      // If not yet verified24, reset qualification timer
      if (!p.verified24_at && qualifiedAt) {
        await members.updateOne(
          { telegram_id: id },
          {
            $set: { 'program.qualified_at': null, updated_at: new Date() },
          }
        );
      }
      continue;
    }

    // set qualified_at if missing
    let qAt = qualifiedAt;
    if (!qAt) {
      qAt = now;
      await members.updateOne(
        { telegram_id: id },
        { $set: { 'program.qualified_at': qAt, updated_at: new Date() } }
      );
    }

    const buyPoints = Number(p.buy?.buy_points || 0);

    // 24h verify
    if (!p.verified24_at && now - qAt >= h1Ms) {
      const ev = await createEvent(events, {
        event_type: 'hold_24h_verified',
        telegram_id: id,
        wallet,
      });
      if (ev.inserted) {
        const bonus = Math.floor(0.25 * buyPoints);
        if (bonus > 0) {
          await addBuyerPoints(members, id, bonus, cfg.MAX_POINTS_PER_WALLET_PER_WEEK);
        }
        await members.updateOne(
          { telegram_id: id },
          { $set: { 'program.verified24_at': now, updated_at: new Date() } }
        );

        // Credit referrer (once)
        if (m.referred_by && m.referred_by !== id) {
          await resetDailyReferralIfNeeded(members, m.referred_by);
          const ref = await members.findOne({ telegram_id: String(m.referred_by) });
          const verifiedToday = ref?.program?.referral?.verified_today || 0;
          if (verifiedToday < cfg.MAX_VERIFIED_REFERRALS_PER_DAY) {
            const refEvent = await createEvent(events, {
              event_type: 'referral_verified',
              telegram_id: id, // dedup by referee
            });
            if (refEvent.inserted) {
              const refPoints = Math.min(cfg.REF_POINTS_MAX, Math.floor(0.5 * buyPoints));
              if (refPoints > 0) {
                await addReferralPoints(members, m.referred_by, refPoints, cfg.MAX_POINTS_PER_WALLET_PER_WEEK);
              }
              await members.updateOne(
                { telegram_id: String(m.referred_by) },
                {
                  $inc: {
                    'program.referral.verified_today': 1,
                    'program.referral.verified_total': 1,
                    'referrals.verified_total': 1,
                  },
                  $set: { updated_at: new Date() },
                }
              );

              // Best-effort DM notification
              try {
                await bot.telegram.sendMessage(
                  m.referred_by,
                  `✅ New verified buyer from your referral!\n+${refPoints} points added.`
                );
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }

    // 72h verify
    if (!p.verified72_at && now - qAt >= h2Ms) {
      const ev = await createEvent(events, {
        event_type: 'hold_72h_verified',
        telegram_id: id,
        wallet,
      });
      if (ev.inserted) {
        const bonus = Math.floor(0.25 * buyPoints);
        if (bonus > 0) {
          await addBuyerPoints(members, id, bonus, cfg.MAX_POINTS_PER_WALLET_PER_WEEK);
        }
        await members.updateOne(
          { telegram_id: id },
          { $set: { 'program.verified72_at': now, updated_at: new Date() } }
        );
      }
    }
  }
}

function createBot({ cfg, members, events, connection }) {
  const bot = new Telegraf(cfg.BOT_TOKEN);

  // DM-only mode: ignore non-command group chatter.
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;
    if (chatType === 'group' || chatType === 'supergroup') {
      const isCommand = ctx.message?.text?.startsWith('/');
      const isMention = ctx.message?.text?.includes(`@${cfg.BOT_USERNAME}`);
      if (isCommand || isMention) {
        const deepLink = `https://t.me/${cfg.BOT_USERNAME}?start=from_group`;
        await ctx.reply(
          '👋 I work in private chat only.',
          Markup.inlineKeyboard([Markup.button.url('Continue in private chat', deepLink)])
        );
      }
      return;
    }
    return next();
  });

  bot.start(async (ctx) => {
    const startPayload = ctx.message.text.split(' ')[1];
    let referrerId = null;
    if (startPayload && startPayload.startsWith('ref_')) {
      referrerId = startPayload.replace('ref_', '');
    }

    const existing = await members.findOne({ telegram_id: String(ctx.from.id) });
    const isNew = !existing;

    // Create/update member
    const member = await ensureMemberDefaults(members, ctx.from.id, {
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      referred_by: isNew && referrerId && referrerId !== String(ctx.from.id) ? referrerId : null,
    });

    // Handle referral click counter once on new user
    if (isNew && referrerId && referrerId !== String(ctx.from.id)) {
      const ev = await createEvent(events, { event_type: 'start_ref', telegram_id: ctx.from.id });
      if (ev.inserted) {
        await incrementReferralClick(members, referrerId);
      }
    }

    const msg =
      `Welcome to *GGRD Rewards Bot*\n\n` +
      `Goal: maximize verified buyers & holders during DBC phase.\n` +
      `• Earn *points* now (no GGRD payouts during DBC).\n` +
      `• GGRD payouts begin after migration.\n\n` +
      `Steps:\n` +
      `1) Activate\n` +
      `2) Link wallet\n` +
      `3) Submit buy TX\n` +
      `4) Hold ≥ ${cfg.MIN_HOLD_GGRD} GGRD for 24h/72h\n\n` +
      `Use /status, /invite, /leaderboard, /rules.`;

    await ctx.reply(msg, { parse_mode: 'Markdown', ...buildMainKeyboard(cfg) });
  });

  bot.command(['rules'], async (ctx) => {
    const msg =
      `*Rules (v1)*\n\n` +
      `• Points accrue during DBC phase.\n` +
      `• To qualify: verify a buy TX and hold ≥ ${cfg.MIN_HOLD_GGRD} GGRD.\n` +
      `• Verification requires holding for ${cfg.HOLD_TIME_1_HOURS}h (main) and ${cfg.HOLD_TIME_2_HOURS}h (bonus).\n` +
      `• Referrals pay only for *verified buyers* (after ${cfg.HOLD_TIME_1_HOURS}h hold).\n` +
      `• Anti-farm: 1 wallet = 1 account, weekly point caps, daily referral caps.\n\n` +
      `_GGRD payouts start after migration (marketing pool unlock)._`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.help(async (ctx) => {
    const msg =
      `*GGRD Rewards Bot*\n\n` +
      `Commands:\n` +
      `• /status — your status & points\n` +
      `• /invite — referral link\n` +
      `• /leaderboard — top referrers\n` +
      `• /rules — program rules\n\n` +
      `Use /start to open the main menu.`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command(['status'], async (ctx) => {
    await sendStatus({ cfg, members, connection, ctx });
  });

  bot.command(['invite'], async (ctx) => {
    await sendInvite({ cfg, members, ctx });
  });

  bot.command(['leaderboard'], async (ctx) => {
    const top = await members
      .find({})
      .sort({ 'referrals.verified_total': -1, 'program.points.total': -1 })
      .limit(10)
      .toArray();

    let msg = '*Leaderboard (verified buyers via referrals)*\n\n';
    if (top.length === 0) {
      msg += '_No data yet._';
      await ctx.reply(msg, { parse_mode: 'Markdown' });
      return;
    }

    top.forEach((u, i) => {
      const name = u.telegram_username ? `@${u.telegram_username}` : `ID:${u.telegram_id}`;
      msg += `${i + 1}. ${escapeMd(name)} — ${u.referrals?.verified_total || 0} verified, ${Math.floor(u.program?.points?.total || 0)} pts\n`;
    });
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // Inline callbacks
  bot.action('activate', async (ctx) => {
    const id = String(ctx.from.id);
    await ensureMemberDefaults(members, id, {
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
    });
    const ev = await createEvent(events, { event_type: 'activated', telegram_id: id });
    if (ev.inserted) {
      await members.updateOne(
        { telegram_id: id },
        { $set: { 'program.activated': true, updated_at: new Date() } }
      );
    }
    await ctx.answerCbQuery('Activated');
    await ctx.reply('✅ Activated. Now link your wallet.', buildMainKeyboard(cfg));
  });

  bot.action('link_wallet', async (ctx) => {
    const id = String(ctx.from.id);
    await ensureMemberDefaults(members, id, {
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
    });
    await members.updateOne(
      { telegram_id: id },
      {
        $set: {
          'program.state.awaiting_wallet': true,
          'program.state.awaiting_txsig': false,
          updated_at: new Date(),
        },
      }
    );
    await ctx.answerCbQuery();
    await ctx.reply('Send your *Solana wallet address* (Base58).', { parse_mode: 'Markdown' });
  });

  bot.action('submit_txsig', async (ctx) => {
    const id = String(ctx.from.id);
    await ensureMemberDefaults(members, id, {
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
    });
    await members.updateOne(
      { telegram_id: id },
      {
        $set: {
          'program.state.awaiting_txsig': true,
          'program.state.awaiting_wallet': false,
          updated_at: new Date(),
        },
      }
    );
    await ctx.answerCbQuery();
    await ctx.reply('Paste your *buy transaction signature* (Solana tx).', { parse_mode: 'Markdown' });
  });

  bot.action('status', async (ctx) => {
    await ctx.answerCbQuery();
    await sendStatus({ cfg, members, connection, ctx });
  });

  bot.action('invite', async (ctx) => {
    await ctx.answerCbQuery();
    await sendInvite({ cfg, members, ctx });
  });

  // Text handler for wallet/txsig collection
  bot.on('text', async (ctx) => {
    const id = String(ctx.from.id);
    const member = await ensureMemberDefaults(members, id, {
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
    });

    const p = member.program || {};
    const state = p.state || {};
    const text = (ctx.message.text || '').trim();

    if (state.awaiting_wallet) {
      if (!isValidSolanaAddress(text)) {
        await ctx.reply('❌ Invalid Solana address. Please send a valid Base58 address.');
        return;
      }
      const ev = await createEvent(events, {
        event_type: 'wallet_linked',
        telegram_id: id,
        wallet: text,
      });
      try {
        if (ev.inserted) {
          await members.updateOne(
            { telegram_id: id },
            {
              $set: {
                wallet_address: text,
                'program.wallet_linked': true,
                'program.state.awaiting_wallet': false,
                updated_at: new Date(),
              },
            }
          );
        } else {
          // still clear state
          await members.updateOne(
            { telegram_id: id },
            { $set: { 'program.state.awaiting_wallet': false, updated_at: new Date() } }
          );
        }
      } catch (e) {
        if (String(e.code) === '11000') {
          await members.updateOne(
            { telegram_id: id },
            { $set: { 'program.state.awaiting_wallet': false, updated_at: new Date() } }
          );
          await ctx.reply('❌ This wallet is already linked to another account. Use a different wallet.');
          return;
        }
        throw e;
      }
      await ctx.reply('✅ Wallet saved. Now submit a buy TX.', buildMainKeyboard(cfg));
      return;
    }

    if (state.awaiting_txsig) {
      if (!member.wallet_address) {
        await ctx.reply('❌ Link wallet first (use the button: Link wallet).');
        return;
      }
      if (!isValidSolanaTxSig(text)) {
        await ctx.reply('❌ Invalid transaction signature. Paste a valid Solana tx signature.');
        return;
      }

      const txEv = await createEvent(events, {
        event_type: 'buy_proof_submitted',
        telegram_id: id,
        wallet: member.wallet_address,
        txsig: text,
      });
      if (!txEv.inserted) {
        await members.updateOne(
          { telegram_id: id },
          { $set: { 'program.state.awaiting_txsig': false, updated_at: new Date() } }
        );
        await ctx.reply('ℹ️ This TX was already processed. Use /status.');
        return;
      }

      // Verify TX on-chain
      let result;
      try {
        result = await verifyBuyTx({
          connection,
          txsig: text,
          ownerAddress: member.wallet_address,
          ggrdMint: cfg.GGRD_MINT,
          usdcMint: cfg.USDC_MINT,
        });
      } catch (e) {
        await ctx.reply('❌ RPC error while verifying. Try again later.');
        return;
      }

      if (!result.ok) {
        await members.updateOne(
          { telegram_id: id },
          { $set: { 'program.state.awaiting_txsig': false, updated_at: new Date() } }
        );
        await ctx.reply('❌ TX verification failed (not a valid buy or tx failed).');
        return;
      }

      // Determine net buy in USDC
      let netBuyUsdc = 0;
      if (typeof result.netBuyUsdc === 'number' && result.netBuyUsdc < 0) {
        netBuyUsdc = Math.abs(result.netBuyUsdc);
      }
      if (netBuyUsdc > 0 && netBuyUsdc < cfg.MIN_NET_BUY_USDC) {
        await members.updateOne(
          { telegram_id: id },
          { $set: { 'program.state.awaiting_txsig': false, updated_at: new Date() } }
        );
        await ctx.reply(`❌ Buy too small. Minimum is ${cfg.MIN_NET_BUY_USDC} USDC.`);
        return;
      }

      // If USDC not detected (routing), allow via hold threshold later
      if (netBuyUsdc === 0) {
        netBuyUsdc = cfg.MIN_NET_BUY_USDC;
      }

      const buyPoints = computeBuyPoints({
        netBuyUsdc,
        minPoints: cfg.BUY_POINTS_MIN,
        maxPoints: cfg.BUY_POINTS_MAX,
      });

      const pointsRes = await addBuyerPoints(members, id, buyPoints, cfg.MAX_POINTS_PER_WALLET_PER_WEEK);

      await members.updateOne(
        { telegram_id: id },
        {
          $set: {
            'program.buy.last_txsig': text,
            'program.buy.net_buy_usdc': netBuyUsdc,
            'program.buy.net_buy_ggrd': result.netBuyGgrd,
            'program.buy.buy_points': buyPoints,
            'program.buy.buy_verified_at': new Date(),
            'program.state.awaiting_txsig': false,
            updated_at: new Date(),
          },
        }
      );

      // Set qualified_at if already holding
      try {
        const bal = await getTokenBalanceByOwner({
          connection,
          ownerAddress: member.wallet_address,
          mintAddress: cfg.GGRD_MINT,
        });
        if (bal >= cfg.MIN_HOLD_GGRD) {
          await members.updateOne(
            { telegram_id: id, 'program.qualified_at': null },
            { $set: { 'program.qualified_at': new Date(), updated_at: new Date() } }
          );
        }
      } catch {
        // ignore
      }

      const capNote = pointsRes.capped ? ` (weekly cap applied)` : '';
      await ctx.reply(`✅ Buy verified. +${buyPoints} points${capNote}.\nNow hold ≥ ${cfg.MIN_HOLD_GGRD} GGRD for ${cfg.HOLD_TIME_1_HOURS}h to verify.`, buildMainKeyboard(cfg));
      return;
    }

    // Default message
    await ctx.reply('Use the buttons or commands: /status /invite /leaderboard /rules', buildMainKeyboard(cfg));
  });

  bot.catch((err) => {
    // Avoid crashing the process on handler errors
    // eslint-disable-next-line no-console
    console.error('[BOT_ERROR]', err);
  });

  return { bot, runHoldCheckOnce: () => runHoldCheckOnce({ cfg, members, events, connection, bot }) };
}

module.exports = { createBot };

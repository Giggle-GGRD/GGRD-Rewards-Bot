require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { MongoClient } = require("mongodb");

// === CONFIGURATION ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const GROUP_ID = process.env.GROUP_ID;
const TWITTER_HANDLE = process.env.TWITTER_HANDLE || "@GGRD_Official";
const ADMIN_ID = process.env.ADMIN_ID ? String(process.env.ADMIN_ID) : null;
const MONGODB_URI = process.env.MONGODB_URI;
const CHANTERSPOT_API_KEY = process.env.CHANTERSPOT_API_KEY;
const GGRD_TOKEN_MINT = process.env.GGRD_TOKEN_MINT;
const TASK2_MAX_USERS = parseInt(process.env.TASK2_MAX_USERS || "300");

if (!BOT_TOKEN || !CHANNEL_ID || !GROUP_ID) {
  console.error("[ERROR] Missing BOT_TOKEN, CHANNEL_ID or GROUP_ID in environment.");
  process.exit(1);
}

if (!MONGODB_URI) {
  console.error("[ERROR] Missing MONGODB_URI in environment.");
  console.error("[INFO] Add your MongoDB connection string to environment variables.");
  process.exit(1);
}

// === MONGODB CONNECTION ===
let db;
let membersCollection;
let snapshotsCollection;
let dailySnapshotsCollection;

async function connectToMongoDB() {
  try {
    console.log("[LOADING] Connecting to MongoDB...");
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    db = client.db("ggrd_bot");
    membersCollection = db.collection("members");
    snapshotsCollection = db.collection("snapshots");
    dailySnapshotsCollection = db.collection("daily_snapshots");
    
    console.log("[OK] Connected to MongoDB successfully!");
    
    // Create index on telegram_id for faster queries
    await membersCollection.createIndex({ telegram_id: 1 }, { unique: true });
    
    const count = await membersCollection.countDocuments();
    console.log(`[STATS] Current members in database: ${count}`);
    
    return client;
  } catch (error) {
    console.error("[ERROR] Failed to connect to MongoDB:", error.message);
    console.error("[INFO] Check your MONGODB_URI in environment variables.");
    process.exit(1);
  }
}

// === CHANTERSPOT API FUNCTIONS ===

async function getTokenBalance(walletAddress, tokenMint) {
  try {
    if (!CHANTERSPOT_API_KEY) {
      console.error("[ERROR] CHANTERSPOT_API_KEY not set");
      return null;
    }
    
    console.log(`[CHANTERSPOT] Fetching balance for ${walletAddress.substring(0, 8)}...`);
    
    const response = await fetch(
      `https://api.chanterspot.com/v1/wallet/${walletAddress}/tokens`,
      {
        headers: {
          'Authorization': `Bearer ${CHANTERSPOT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      console.error(`[ERROR] Chanterspot API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    // Find GGRD token in the list
    const ggrdToken = data.tokens?.find(t => t.mint === tokenMint);
    
    if (!ggrdToken) {
      console.log(`[CHANTERSPOT] No GGRD balance found for wallet`);
      return 0;
    }
    
    const balance = parseFloat(ggrdToken.amount || 0);
    console.log(`[CHANTERSPOT] Balance: ${balance} GGRD`);
    
    return balance;
  } catch (error) {
    console.error(`[ERROR] Failed to fetch balance:`, error.message);
    return null;
  }
}

// === DATABASE FUNCTIONS ===

async function upsertMember(telegramId, record) {
  try {
    const id = String(telegramId);
    
    // Check if member exists
    const existing = await membersCollection.findOne({ telegram_id: id });
    
    if (!existing) {
      // New member - create with full structure
      const newMember = {
        telegram_id: id,
        telegram_username: null,
        first_name: null,
        last_name: null,
        wallet_address: null,
        referred_by: null,
        referrals: {
          count: 0,
          count_with_wallet: 0,
          earned: 0,
          reward_paid: false
        },
        tasks: {
          tg_channel: false,
          tg_group: false
        },
        task1_completed: false,
        task1_reward: 0,
        task1_lottery_entry: null,
        task2_purchase: {
          submitted: false,
          tx_hash: null,
          amount_usd: 0,
          verified: false,
          reward_claimed: false
        },
        task2_reward: 0,
        task3_holder: {
          balance_ggrd: 0,
          snapshot_day0: false,
          snapshot_day7: false,
          qualified_lottery: false,
          top100_rank: null
        },
        task3_reward: 0,
        task3_lottery_entry: null,
        total_rewards: 0,
        disqualified: false,
        disqualified_reason: null,
        created_at: new Date(),
        updated_at: new Date(),
        ...record
      };
      
      await membersCollection.insertOne(newMember);
      console.log(`[+] Added new member ${id}`);
      return { upsertedCount: 1 };
    } else {
      // Existing member - update only provided fields
      const updateDoc = {
        ...record,
        updated_at: new Date()
      };
      
      // Migrate old structure to new if needed
      if (existing.in_channel !== undefined && !existing.tasks) {
        updateDoc.tasks = {
          tg_channel: existing.in_channel || false,
          tg_group: existing.in_group || false
        };
        // Remove old fields
        await membersCollection.updateOne(
          { telegram_id: id },
          { $unset: { in_channel: "", in_group: "" } }
        );
      }
      
      const result = await membersCollection.updateOne(
        { telegram_id: id },
        { $set: updateDoc }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`[UPDATE] Updated member ${id}`);
      }
      
      return result;
    }
  } catch (error) {
    console.error(`[ERROR] Error upserting member ${telegramId}:`, error.message);
    throw error;
  }
}

async function getMember(telegramId) {
  try {
    const id = String(telegramId);
    const member = await membersCollection.findOne({ telegram_id: id });
    return member;
  } catch (error) {
    console.error(`[ERROR] Error getting member ${telegramId}:`, error.message);
    return null;
  }
}

async function getAllMembers() {
  try {
    return await membersCollection.find({}).toArray();
  } catch (error) {
    console.error("[ERROR] Error getting all members:", error.message);
    return [];
  }
}

async function updateTaskStatus(telegramId, updates) {
  try {
    const id = String(telegramId);
    const member = await getMember(id);
    
    if (!member) {
      console.error(`[ERROR] Member ${id} not found for task update`);
      return;
    }
    
    // Merge updates with existing data
    const updateDoc = {};
    
    for (const [key, value] of Object.entries(updates)) {
      if (key.includes('.')) {
        // Handle dot notation (e.g., "tasks.twitter_follow")
        const [parent, child] = key.split('.');
        if (!updateDoc[parent]) {
          updateDoc[parent] = { ...member[parent] };
        }
        updateDoc[parent][child] = value;
      } else {
        updateDoc[key] = value;
      }
    }
    
    updateDoc.updated_at = new Date();
    
    await membersCollection.updateOne(
      { telegram_id: id },
      { $set: updateDoc }
    );
    console.log(`[UPDATE] Task status updated for ${id}`);
  } catch (error) {
    console.error(`[ERROR] Error updating task status for ${telegramId}:`, error.message);
  }
}

async function generateLotteryEntry(taskNumber) {
  try {
    // Generate unique lottery entry number
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${taskNumber}-${timestamp}-${random}`;
  } catch (error) {
    console.error("[ERROR] Error generating lottery entry:", error.message);
    return null;
  }
}

async function checkTask1Completion(member) {
  const tasks = member.tasks || {};
  return tasks.tg_channel && tasks.tg_group;
}

async function assignTask1Rewards(telegramId) {
  try {
    const member = await getMember(telegramId);
    if (!member) return;
    
    if (member.task1_completed) {
      console.log(`[SKIP] Task 1 already completed for ${telegramId}`);
      return;
    }
    
    const isCompleted = await checkTask1Completion(member);
    if (!isCompleted) {
      console.log(`[SKIP] Task 1 not completed yet for ${telegramId}`);
      return;
    }
    
    const lotteryEntry = await generateLotteryEntry(1);
    
    await updateTaskStatus(telegramId, {
      task1_completed: true,
      task1_reward: 10,
      task1_lottery_entry: lotteryEntry,
      total_rewards: (member.total_rewards || 0) + 10
    });
    
    console.log(`[REWARD] Task 1 completed for ${telegramId}: 10 GGRD + lottery entry ${lotteryEntry}`);
    
    return { reward: 10, lotteryEntry };
  } catch (error) {
    console.error(`[ERROR] Error assigning Task 1 rewards:`, error.message);
    return null;
  }
}

async function getTask2VerifiedCount() {
  try {
    const count = await membersCollection.countDocuments({
      "task2_purchase.verified": true
    });
    return count;
  } catch (error) {
    console.error("[ERROR] Error getting Task 2 count:", error.message);
    return 0;
  }
}

async function assignTask2Rewards(telegramId) {
  try {
    const member = await getMember(telegramId);
    if (!member) return null;
    
    if (member.task2_reward > 0) {
      console.log(`[SKIP] Task 2 already rewarded for ${telegramId}`);
      return null;
    }
    
    const verifiedCount = await getTask2VerifiedCount();
    if (verifiedCount >= TASK2_MAX_USERS) {
      console.log(`[LIMIT] Task 2 limit reached (${TASK2_MAX_USERS}/${TASK2_MAX_USERS})`);
      return { error: "limit_reached" };
    }
    
    await updateTaskStatus(telegramId, {
      task2_reward: 20,
      "task2_purchase.reward_claimed": true,
      total_rewards: (member.total_rewards || 0) + 20
    });
    
    console.log(`[REWARD] Task 2 completed for ${telegramId}: 20 GGRD (${verifiedCount + 1}/${TASK2_MAX_USERS})`);
    
    return { reward: 20, count: verifiedCount + 1 };
  } catch (error) {
    console.error(`[ERROR] Error assigning Task 2 rewards:`, error.message);
    return null;
  }
}

// === TASK 3 FUNCTIONS ===

async function getTokenBalance(walletAddress) {
  try {
    if (!CHANTERSPOT_API_KEY) {
      console.error("[ERROR] CHANTERSPOT_API_KEY not configured");
      return 0;
    }
    
    const url = `https://mainnet.helius-rpc.com/?api-key=${CHANTERSPOT_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          walletAddress,
          {
            mint: GGRD_TOKEN_MINT
          },
          {
            encoding: 'jsonParsed'
          }
        ]
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.error(`[ERROR] RPC error for ${walletAddress}:`, data.error.message);
      return 0;
    }
    
    if (!data.result || !data.result.value || data.result.value.length === 0) {
      // No token account found
      return 0;
    }
    
    const tokenAccount = data.result.value[0];
    const balance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
    
    console.log(`[BALANCE] Wallet ${walletAddress.substring(0, 8)}... has ${balance} GGRD`);
    
    return balance || 0;
  } catch (error) {
    console.error(`[ERROR] Error fetching token balance for ${walletAddress}:`, error.message);
    return 0;
  }
}

async function getTop100Count() {
  try {
    const count = await membersCollection.countDocuments({
      "task3_holder.top100_rank": { $ne: null }
    });
    return count;
  } catch (error) {
    console.error("[ERROR] Error getting TOP 100 count:", error.message);
    return 0;
  }
}

async function assignTop100Rank(telegramId) {
  try {
    const currentCount = await getTop100Count();
    
    if (currentCount >= 100) {
      console.log(`[LIMIT] TOP 100 is full (${currentCount}/100)`);
      return null;
    }
    
    const rank = currentCount + 1;
    
    await updateTaskStatus(telegramId, {
      "task3_holder.top100_rank": rank,
      task3_reward: 50,
      total_rewards: (await getMember(telegramId)).total_rewards + 50
    });
    
    console.log(`[TOP100] Assigned rank #${rank} to user ${telegramId}`);
    
    return rank;
  } catch (error) {
    console.error(`[ERROR] Error assigning TOP 100 rank:`, error.message);
    return null;
  }
}

async function assignTask3LotteryEntry(telegramId) {
  try {
    const lotteryEntry = await generateLotteryEntry(3);
    
    await updateTaskStatus(telegramId, {
      "task3_holder.qualified_lottery": true,
      task3_lottery_entry: lotteryEntry
    });
    
    console.log(`[LOTTERY] Task 3 lottery entry ${lotteryEntry} for user ${telegramId}`);
    
    return lotteryEntry;
  } catch (error) {
    console.error(`[ERROR] Error assigning Task 3 lottery:`, error.message);
    return null;
  }
}

async function getTop100Count() {
  try {
    const count = await membersCollection.countDocuments({
      "task3_holder.top100_rank": { $ne: null }
    });
    return count;
  } catch (error) {
    console.error("[ERROR] Error getting TOP 100 count:", error.message);
    return 0;
  }
}

async function assignTask3Top100Reward(telegramId, rank) {
  try {
    const member = await getMember(telegramId);
    if (!member) return null;
    
    if (member.task3_holder?.top100_rank) {
      console.log(`[SKIP] Already in TOP 100 at rank ${member.task3_holder.top100_rank}`);
      return null;
    }
    
    const currentTop100 = await getTop100Count();
    if (currentTop100 >= 100) {
      console.log(`[LIMIT] TOP 100 is full (${currentTop100}/100)`);
      return { error: "top100_full" };
    }
    
    await updateTaskStatus(telegramId, {
      task3_reward: 50,
      "task3_holder.top100_rank": rank || (currentTop100 + 1),
      total_rewards: (member.total_rewards || 0) + 50
    });
    
    console.log(`[REWARD] Task 3 TOP 100 for ${telegramId}: 50 GGRD (rank ${rank || currentTop100 + 1})`);
    
    return { reward: 50, rank: rank || (currentTop100 + 1) };
  } catch (error) {
    console.error(`[ERROR] Error assigning Task 3 TOP 100 reward:`, error.message);
    return null;
  }
}

async function assignTask3LotteryEntry(telegramId) {
  try {
    const member = await getMember(telegramId);
    if (!member) return null;
    
    if (member.task3_lottery_entry) {
      console.log(`[SKIP] Task 3 lottery entry already assigned: ${member.task3_lottery_entry}`);
      return null;
    }
    
    const lotteryEntry = await generateLotteryEntry(3);
    
    await updateTaskStatus(telegramId, {
      task3_lottery_entry: lotteryEntry,
      "task3_holder.qualified_lottery": true
    });
    
    console.log(`[LOTTERY] Task 3 lottery entry for ${telegramId}: ${lotteryEntry}`);
    
    return { lotteryEntry };
  } catch (error) {
    console.error(`[ERROR] Error assigning Task 3 lottery entry:`, error.message);
    return null;
  }
}

// === HELPERS ===

async function isUserMember(ctx, chatId, userId) {
  try {
    const member = await ctx.telegram.getChatMember(chatId, userId);
    const validStatuses = ["member", "administrator", "creator"];
    return validStatuses.includes(member.status);
  } catch (error) {
    console.error(`[ERROR] Error checking membership in ${chatId}:`, error.message);
    return false;
  }
}

function isValidSolanaAddress(address) {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

function isValidSolanaTxHash(hash) {
  // Solana transaction hash is base58 encoded, typically 87-88 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
  return base58Regex.test(hash);
}

function isAdmin(userId) {
  return ADMIN_ID && String(userId) === ADMIN_ID;
}

// Track users waiting for wallet
const waitingForWallet = new Set();
// Track users waiting for TX hash
const waitingForTxHash = new Set();

// === BOT INIT ===
const bot = new Telegraf(BOT_TOKEN);

// ========================================
// GLOBAL MIDDLEWARE: DM-ONLY MODE
// ========================================
// Bot responds ONLY in private chats
// Groups/supergroups are completely ignored
bot.use(async (ctx, next) => {
  const chatType = ctx.chat?.type;
  
  // Check if message is from a group or supergroup  
  if (chatType === 'group' || chatType === 'supergroup') {
    console.log(`[DM-ONLY] Ignoring message from ${chatType} chat (ID: ${ctx.chat.id})`);
    return; // Completely ignore - no response, no processing
  }
  
  // Private chat - process normally
  return next();
});

console.log("[INFO] DM-only mode: Bot will only respond in private chats");

// === COMMANDS & HANDLERS ===

// Commands FIRST - they must be registered before bot.on("text")

bot.start(async (ctx) => {
  console.log(`[START] /start from user ${ctx.from.id}`);
  
  // Check for referral parameter
  const startPayload = ctx.message.text.split(' ')[1];
  let referrerId = null;
  
  if (startPayload && startPayload.startsWith('ref_')) {
    referrerId = startPayload.replace('ref_', '');
    console.log(`[REFERRAL] User ${ctx.from.id} referred by ${referrerId}`);
  }
  
  // Check if user already exists
  const existingMember = await getMember(ctx.from.id);
  
  if (!existingMember && referrerId && referrerId !== String(ctx.from.id)) {
    // New user with valid referral
    await upsertMember(ctx.from.id, {
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      referred_by: referrerId
    });
    
    // Increment referrer's count
    const referrer = await getMember(referrerId);
    if (referrer) {
      await updateTaskStatus(referrerId, {
        "referrals.count": (referrer.referrals?.count || 0) + 1
      });
      console.log(`[REFERRAL] Incremented count for referrer ${referrerId}`);
    }
  } else if (!existingMember) {
    // New user without referral
    await upsertMember(ctx.from.id, {
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name
    });
  }
  
  const startMessage =
    "Welcome to the *GGRD Community Rewards Bot*\n\n" +
    "This bot helps you complete and verify community tasks so you can join future *GGRD* airdrops and raffles.\n\n" +
    "*How it works (3 simple steps):*\n" +
    "1. Join the official channel - " + CHANNEL_ID + "\n" +
    "2. Join the community chat - " + GROUP_ID + "\n" +
    "3. Click the button below to verify your tasks\n\n" +
    "*Quick Commands:*\n" +
    "/tasks - See all available rewards\n" +
    "/me - Check your status\n" +
    "/top100 - View TOP 100 holders\n" +
    "/task3\\_status - Detailed Task 3 status\n" +
    "/biggest\\_holder - Biggest holder competition\n" +
    "/leaderboard - Holder rankings\n" +
    "/invite - Get your referral link\n\n" +
    "*Buy GGRD:* Use buttons below to purchase on Jupiter or view on GeckoTerminal.\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  await ctx.reply(startMessage, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [
        Markup.button.url("Official Channel", "https://t.me/" + CHANNEL_ID.replace("@", "")),
        Markup.button.url("Community Chat", "https://t.me/" + GROUP_ID.replace("@", ""))
      ],
      [
        Markup.button.url("Buy on Jupiter", "https://jup.ag/tokens/TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE"),
        Markup.button.url("View on GeckoTerminal", "https://www.geckoterminal.com/solana/pools/HWzDBQcPpmGk5J9EXaLQnF4TfndP2pYAzCxBTyfjbnUb")
      ],
      [Markup.button.callback("Verify my tasks", "verify_tasks")]
    ])
  });
});

bot.help((ctx) => {
  console.log(`[HELP] /help from user ${ctx.from.id}`);
  
  const msg =
    "This is the official *GGRD Community Rewards Bot*\n\n" +
    "What you can do here:\n" +
    "- Verify if you joined " + CHANNEL_ID + " and " + GROUP_ID + "\n" +
    "- Register your Solana wallet address for GGRD rewards\n" +
    "- Check your status with /me or /profile\n" +
    "- View all tasks with /tasks\n\n" +
    "*Buy GGRD:*\n" +
    "- Jupiter: https://jup.ag/tokens/TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE\n" +
    "- GeckoTerminal: https://www.geckoterminal.com/solana/pools/HWzDBQcPpmGk5J9EXaLQnF4TfndP2pYAzCxBTyfjbnUb\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  ctx.reply(msg, { parse_mode: "Markdown" });
});

// Command: /tasks - show all tasks and their status
bot.command(["tasks"], async (ctx) => {
  const userId = ctx.from.id;
  console.log(`[TASKS] Command from user ${userId}`);
  
  try {
    const member = await getMember(userId);
    
    if (!member) {
      return ctx.reply(
        "No data found for your account.\n\n" +
        "Use /start to register."
      );
    }
    
    const tasks = member.tasks || {};
    const task1Complete = member.task1_completed || false;
    const task2Verified = member.task2_purchase?.verified || false;
    
    let message = "Your GGRD Rewards Tasks:\n\n";
    
    // TASK 1
    message += task1Complete ? "[OK] " : "[PENDING] ";
    message += "Task 1 - Social Media\n";
    message += (tasks.tg_channel ? "  [OK] " : "  [ ] ") + "Telegram Channel\n";
    message += (tasks.tg_group ? "  [OK] " : "  [ ] ") + "Telegram Group\n";
    
    if (task1Complete) {
      message += `  Reward: 10 GGRD\n`;
      message += `  Lottery: Entry ${member.task1_lottery_entry}\n`;
      message += `  Prize pool: 2,000 GGRD\n`;
    } else {
      message += "  Reward: 10 GGRD + lottery (2k pool)\n";
    }
    
    message += "\n";
    
    // TASK 2
    message += task2Verified ? "[OK] " : "[PENDING] ";
    message += "Task 2 - Purchase Proof\n";
    message += "  Buy minimum 5 USD worth of GGRD\n";
    
    if (member.task2_purchase?.submitted) {
      message += `  Status: ${task2Verified ? 'Verified' : 'Waiting verification'}\n`;
      if (task2Verified) {
        message += `  Reward: 20 GGRD\n`;
      }
    } else {
      message += "  Use /submit_purchase to submit proof\n";
      message += "  Reward: 20 GGRD\n";
    }
    
    message += "\n";
    
    // TASK 3
    const task3Top100 = member.task3_holder?.top100_rank || null;
    const task3Lottery = member.task3_holder?.qualified_lottery || false;
    const task3Day0 = member.task3_holder?.snapshot_day0 || false;
    const task3Day7 = member.task3_holder?.snapshot_day7 || false;
    
    message += (task3Top100 || task3Lottery) ? "[OK] " : "[PENDING] ";
    message += "Task 3 - Holder 2500+\n";
    
    if (task3Top100) {
      message += `  TOP 100: Rank #${task3Top100} - 50 GGRD\n`;
    } else {
      message += "  First 100 holders: 50 GGRD each\n";
    }
    
    if (task3Day0 && task3Day7 && task3Lottery) {
      message += `  Lottery: QUALIFIED (Entry ${member.task3_lottery_entry})\n`;
      message += "  Prize pool: 10,000 GGRD\n";
    } else if (task3Day0 && !task3Day7) {
      message += "  Lottery: Waiting for Day 7 snapshot\n";
      message += "  Prize pool: 10,000 GGRD\n";
    } else {
      message += "  All holders ≥2,500: Lottery (10k pool)\n";
      message += "  Status: Waiting for LP launch\n";
    }
    
    if (task3Top100 || task3Lottery) {
      message += "\nUse /task3_status for details.\n";
    }
    
    message += "\n";
    
    // REFERRAL PROGRAM
    const referralEarned = member.referrals?.earned || 0;
    const referralPaid = member.referrals?.reward_paid || false;
    
    message += referralEarned > 0 ? "[OK] " : "[INFO] ";
    message += "Referral Program\n";
    message += "  Invite friends (5 GGRD each)\n";
    message += "  Reward: Day 10 after LP launch\n";
    
    if (referralEarned > 0) {
      message += `  Earned: ${referralEarned} GGRD\n`;
      message += referralPaid ? "  Status: ✅ Paid\n" : "  Status: ⏳ Pending (Day 10)\n";
      message += "  Use /invite for your link\n";
    } else {
      message += "  Use /invite to get started\n";
    }
    
    message += "\n━━━━━━━━━━━━━━━━━━━━━━\n";
    message += `Total Rewards: ${member.total_rewards || 0} GGRD\n`;
    
    const buttons = [];
    
    if (!member.task2_purchase?.submitted) {
      buttons.push([Markup.button.callback("Submit Purchase", "submit_purchase_start")]);
    }
    
    // Add buy buttons
    buttons.push([
      Markup.button.url("Buy on Jupiter", "https://jup.ag/tokens/TR97dHmm8nXVndTcxew21138AchNgrk2BhEJGXMybdE"),
      Markup.button.url("GeckoTerminal", "https://www.geckoterminal.com/solana/pools/HWzDBQcPpmGk5J9EXaLQnF4TfndP2pYAzCxBTyfjbnUb")
    ]);
    
    if (buttons.length > 0) {
      await ctx.reply(message, Markup.inlineKeyboard(buttons));
    } else {
      await ctx.reply(message);
    }
    
  } catch (error) {
    console.error(`[ERROR] Error in tasks command:`, error.message);
    ctx.reply("Error displaying tasks. Please try again.");
  }
});

// Command: /me and /profile - show user status
bot.command(["me", "profile"], async (ctx) => {
  const userId = ctx.from.id;
  console.log(`[PROFILE] Command from user ${userId}`);
  
  try {
    const member = await getMember(userId);

    if (!member) {
      return ctx.reply(
        "No data found for your account.\n\n" +
        "Use /start and press the verify button to register."
      );
    }

    const fullName = ((member.first_name || "") + " " + (member.last_name || "")).trim();
    const tasks = member.tasks || {};

    let statusMessage =
      "Your GGRD Community Rewards profile:\n\n" +
      "Telegram ID: " + member.telegram_id + "\n" +
      "Username: " + (member.telegram_username ? "@" + member.telegram_username : "not set") + "\n" +
      "Name: " + (fullName || "not set") + "\n\n" +
      "Channel member: " + (tasks.tg_channel ? "YES" : "NO") + "\n" +
      "Group member: " + (tasks.tg_group ? "YES" : "NO") + "\n\n" +
      "Wallet address: " + (member.wallet_address || "NOT SET") + "\n\n";
    
    statusMessage += "━━━━━━━━━━━━━━━━━━━━━━\n";
    statusMessage += "REWARDS SUMMARY:\n\n";
    statusMessage += `Total Earned: ${member.total_rewards || 0} GGRD\n`;
    
    if (member.task1_completed) {
      statusMessage += `Task 1: 10 GGRD (lottery #${member.task1_lottery_entry})\n`;
    }
    if (member.task2_purchase?.verified) {
      statusMessage += `Task 2: 20 GGRD\n`;
    }
    if (member.task3_reward > 0) {
      statusMessage += `Task 3: ${member.task3_reward} GGRD\n`;
    }
    
    statusMessage += "\nUse /tasks to see detailed task status.";

    await ctx.reply(statusMessage);
    
    // Show referral stats if user has referrals
    if ((member.referrals?.count || 0) > 0) {
      const botUsername = (await ctx.telegram.getMe()).username;
      const referralLink = `https://t.me/${botUsername}?start=ref_${member.telegram_id}`;
      
      const referralMsg =
        "\n👥 REFERRAL STATS:\n\n" +
        `Total invites: ${member.referrals.count}\n` +
        `With wallet: ${member.referrals.count_with_wallet}\n` +
        `Earned: ${member.referrals.earned} GGRD\n` +
        (member.referrals.reward_paid ? "Status: ✅ Paid\n" : "Status: ⏳ Pending (Day 10)\n") +
        `\nYour link: ${referralLink}`;
      
      await ctx.reply(referralMsg);
    }
    console.log(`[OK] Profile sent successfully to user ${userId}`);
  } catch (error) {
    console.error(`[ERROR] Error in profile command for user ${userId}:`, error.message);
    ctx.reply("Error displaying profile. Please try /start again.");
  }
});

bot.command("export", async (ctx) => {
  const fromId = String(ctx.from.id);
  console.log(`[EXPORT] Request from user ${fromId}`);

  if (!isAdmin(fromId)) {
    console.log(`[DENIED] Unauthorized access attempt by user ${fromId}`);
    return ctx.reply("You are not allowed to use this command.");
  }

  try {
    const members = await getAllMembers();
    
    if (members.length === 0) {
      console.log(`[EMPTY] No members in database`);
      return ctx.reply("No members in database.");
    }

    const jsonData = JSON.stringify(members, null, 2);
    const buffer = Buffer.from(jsonData, 'utf-8');

    await ctx.replyWithDocument({
      source: buffer,
      filename: `ggrd_members_${new Date().toISOString().split('T')[0]}.json`
    }, {
      caption: `GGRD Members Export\nTotal members: ${members.length}\nDate: ${new Date().toLocaleDateString()}`
    });

    console.log(`[OK] Database exported successfully to ${fromId} (${members.length} members)`);
  } catch (err) {
    console.error(`[ERROR] Failed to export:`, err.message);
    ctx.reply("Failed to export database. Check server logs.");
  }
});

// Admin command: /verify_purchase - verify user's purchase
bot.command("verify_purchase", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  const args = ctx.message.text.split(" ");
  if (args.length < 3) {
    return ctx.reply(
      "Usage: /verify_purchase <telegram_id> <approved|rejected>\n\n" +
      "Example: /verify_purchase 123456789 approved"
    );
  }
  
  const targetUserId = args[1];
  const action = args[2].toLowerCase();
  
  if (action !== "approved" && action !== "rejected") {
    return ctx.reply("Action must be 'approved' or 'rejected'");
  }
  
  const member = await getMember(targetUserId);
  
  if (!member) {
    return ctx.reply(`User ${targetUserId} not found in database.`);
  }
  
  if (!member.task2_purchase?.submitted) {
    return ctx.reply(`User ${targetUserId} has not submitted a purchase proof.`);
  }
  
  if (action === "approved") {
    // Check limit
    const verifiedCount = await getTask2VerifiedCount();
    if (verifiedCount >= TASK2_MAX_USERS) {
      return ctx.reply(
        `[LIMIT REACHED] Cannot verify more purchases.\n` +
        `Current: ${verifiedCount}/${TASK2_MAX_USERS}\n\n` +
        `User ${targetUserId} will NOT receive rewards.`
      );
    }
    
    await updateTaskStatus(targetUserId, {
      "task2_purchase.verified": true
    });
    
    const result = await assignTask2Rewards(targetUserId);
    
    let responseMsg = `[OK] Purchase verified for user ${targetUserId}\n`;
    
    if (result && !result.error) {
      responseMsg += `\nTask 2 completed!\n`;
      responseMsg += `Reward: ${result.reward} GGRD\n`;
      responseMsg += `Count: ${result.count}/${TASK2_MAX_USERS}`;
      
      // Notify user
      try {
        await bot.telegram.sendMessage(
          targetUserId,
          "[OK] Your purchase has been verified!\n\n" +
          "Task 2 completed!\n" +
          `Reward: ${result.reward} GGRD\n\n` +
          "Use /tasks to see your status."
        );
      } catch (err) {
        console.log(`[WARN] Could not notify user ${targetUserId}`);
      }
    } else if (result?.error === "limit_reached") {
      responseMsg += "\n[WARNING] Limit was reached during processing!";
    }
    
    ctx.reply(responseMsg);
  } else {
    // Rejected
    await updateTaskStatus(targetUserId, {
      "task2_purchase.verified": false,
      "task2_purchase.submitted": false,
      "task2_purchase.tx_hash": null
    });
    
    ctx.reply(`[REJECTED] Purchase rejected for user ${targetUserId}`);
    
    // Notify user
    try {
      await bot.telegram.sendMessage(
        targetUserId,
        "[REJECTED] Your purchase verification was rejected.\n\n" +
        "Please submit a valid transaction hash using /tasks."
      );
    } catch (err) {
      console.log(`[WARN] Could not notify user ${targetUserId}`);
    }
  }
  
  console.log(`[ADMIN] Purchase ${action} for ${targetUserId} by admin ${userId}`);
});

// Admin command: /snapshot_day0 - execute Day 0 snapshot
bot.command("snapshot_day0", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  try {
    // Check if Day 0 snapshot already exists
    const existingSnapshot = await snapshotsCollection.findOne({ snapshot_type: "day0" });
    if (existingSnapshot) {
      return ctx.reply(
        "❌ Day 0 snapshot already executed!\n\n" +
        `Timestamp: ${existingSnapshot.timestamp.toISOString()}\n` +
        `Total qualified: ${existingSnapshot.total_qualified}\n` +
        `TOP 100 count: ${existingSnapshot.top100_count}`
      );
    }
    
    await ctx.reply("🔄 Starting Day 0 snapshot...\nThis may take a few minutes.");
    
    // Get all members with wallets
    const members = await membersCollection.find({
      wallet_address: { $ne: null },
      disqualified: false
    }).toArray();
    
    console.log(`[SNAPSHOT_DAY0] Processing ${members.length} members`);
    
    let qualified = 0;
    let top100Count = await getTop100Count();
    const results = [];
    
    for (const member of members) {
      const balance = await getTokenBalance(member.wallet_address);
      
      if (balance >= 2500) {
        qualified++;
        
        // Update balance
        await updateTaskStatus(member.telegram_id, {
          "task3_holder.balance_ggrd": balance,
          "task3_holder.snapshot_day0": true
        });
        
        // Assign TOP 100 if slots available
        if (top100Count < 100 && !member.task3_holder?.top100_rank) {
          const rank = await assignTop100Rank(member.telegram_id);
          if (rank) {
            top100Count++;
            results.push(`✅ User ${member.telegram_id}: ${balance} GGRD - TOP 100 rank #${rank}`);
          }
        } else {
          results.push(`✅ User ${member.telegram_id}: ${balance} GGRD`);
        }
        
        // Assign lottery entry if not already assigned
        if (!member.task3_lottery_entry) {
          await assignTask3LotteryEntry(member.telegram_id);
        }
      } else {
        results.push(`❌ User ${member.telegram_id}: ${balance} GGRD (below 2500)`);
      }
    }
    
    // Save snapshot record
    await snapshotsCollection.insertOne({
      snapshot_type: "day0",
      timestamp: new Date(),
      total_members: members.length,
      total_qualified: qualified,
      top100_count: top100Count,
      executed_by: userId
    });
    
    const msg =
      "✅ Day 0 Snapshot Complete!\n\n" +
      `Total members checked: ${members.length}\n` +
      `Qualified (≥2500 GGRD): ${qualified}\n` +
      `TOP 100 filled: ${top100Count}/100\n\n` +
      "Day 7 snapshot can be executed in 7 days using /snapshot_day7";
    
    await ctx.reply(msg);
    
    console.log(`[SNAPSHOT_DAY0] Complete: ${qualified} qualified, TOP 100: ${top100Count}/100`);
    
  } catch (error) {
    console.error(`[ERROR] Snapshot Day 0 failed:`, error.message);
    ctx.reply("❌ Error executing snapshot. Check server logs.");
  }
});

// Admin command: /snapshot_day7 - execute Day 7 snapshot
bot.command("snapshot_day7", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  try {
    // Check if Day 0 snapshot exists
    const day0Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day0" });
    if (!day0Snapshot) {
      return ctx.reply("❌ Day 0 snapshot must be executed first!");
    }
    
    // Check if Day 7 snapshot already exists
    const existingSnapshot = await snapshotsCollection.findOne({ snapshot_type: "day7" });
    if (existingSnapshot) {
      return ctx.reply(
        "❌ Day 7 snapshot already executed!\n\n" +
        `Timestamp: ${existingSnapshot.timestamp.toISOString()}\n` +
        `Total qualified for lottery: ${existingSnapshot.lottery_qualified}`
      );
    }
    
    await ctx.reply("🔄 Starting Day 7 snapshot...\nThis may take a few minutes.");
    
    // Get all members who qualified in Day 0
    const members = await membersCollection.find({
      "task3_holder.snapshot_day0": true,
      disqualified: false
    }).toArray();
    
    console.log(`[SNAPSHOT_DAY7] Processing ${members.length} Day 0 qualified members`);
    
    let lotteryQualified = 0;
    const results = [];
    
    for (const member of members) {
      const balance = await getTokenBalance(member.wallet_address);
      
      if (balance >= 2500) {
        // Still qualified - update for lottery
        lotteryQualified++;
        
        await updateTaskStatus(member.telegram_id, {
          "task3_holder.balance_ggrd": balance,
          "task3_holder.snapshot_day7": true,
          "task3_holder.qualified_lottery": true
        });
        
        results.push(`✅ User ${member.telegram_id}: ${balance} GGRD - LOTTERY QUALIFIED`);
        
        // Notify user
        try {
          await bot.telegram.sendMessage(
            member.telegram_id,
            "🎉 Congratulations!\n\n" +
            "You are qualified for the Task 3 lottery draw!\n\n" +
            `Your balance: ${balance} GGRD\n` +
            `Lottery entry: ${member.task3_lottery_entry}\n` +
            `Prize: 10,000 GGRD\n\n` +
            "Good luck!"
          );
        } catch (err) {
          console.log(`[WARN] Could not notify user ${member.telegram_id}`);
        }
      } else {
        // Disqualified - sold below 2500
        await updateTaskStatus(member.telegram_id, {
          "task3_holder.balance_ggrd": balance,
          "task3_holder.snapshot_day7": true,
          "task3_holder.qualified_lottery": false
        });
        
        results.push(`❌ User ${member.telegram_id}: ${balance} GGRD - DISQUALIFIED (sold)`);
        
        // Notify user
        try {
          await bot.telegram.sendMessage(
            member.telegram_id,
            "⚠️ Task 3 Lottery Status\n\n" +
            "Unfortunately, you are not qualified for the lottery.\n\n" +
            `Your balance: ${balance} GGRD\n` +
            "Required: 2,500+ GGRD on both Day 0 and Day 7\n\n" +
            "You can still participate in other tasks!"
          );
        } catch (err) {
          console.log(`[WARN] Could not notify user ${member.telegram_id}`);
        }
      }
    }
    
    // Save snapshot record
    await snapshotsCollection.insertOne({
      snapshot_type: "day7",
      timestamp: new Date(),
      total_checked: members.length,
      lottery_qualified: lotteryQualified,
      disqualified: members.length - lotteryQualified,
      executed_by: userId
    });
    
    const msg =
      "✅ Day 7 Snapshot Complete!\n\n" +
      `Total checked: ${members.length}\n` +
      `Lottery qualified: ${lotteryQualified}\n` +
      `Disqualified: ${members.length - lotteryQualified}\n\n` +
      "Use /lottery 3 to execute the lottery draw.";
    
    await ctx.reply(msg);
    
    console.log(`[SNAPSHOT_DAY7] Complete: ${lotteryQualified} qualified for lottery`);
    
  } catch (error) {
    console.error(`[ERROR] Snapshot Day 7 failed:`, error.message);
    ctx.reply("❌ Error executing snapshot. Check server logs.");
  }
});

// Command: /top100 - show TOP 100 holders list
bot.command("top100", async (ctx) => {
  try {
    const top100 = await membersCollection.find({
      "task3_holder.top100_rank": { $ne: null }
    }).sort({ "task3_holder.top100_rank": 1 }).toArray();
    
    if (top100.length === 0) {
      return ctx.reply(
        "📊 TOP 100 Holders\n\n" +
        "No holders yet. Waiting for LP launch and Day 0 snapshot.\n\n" +
        "First 100 holders with ≥2,500 GGRD receive 50 GGRD each!"
      );
    }
    
    let msg = "🏆 TOP 100 Early Holders (50 GGRD each)\n\n";
    msg += `Slots filled: ${top100.length}/100\n`;
    msg += `Remaining: ${100 - top100.length}\n\n`;
    
    // Show first 10, user's rank if in list, and last 5
    const userId = String(ctx.from.id);
    const userEntry = top100.find(m => m.telegram_id === userId);
    
    msg += "━━━ Top 10 ━━━\n";
    for (let i = 0; i < Math.min(10, top100.length); i++) {
      const m = top100[i];
      const rank = m.task3_holder.top100_rank;
      const wallet = m.wallet_address.substring(0, 4) + "..." + m.wallet_address.substring(m.wallet_address.length - 4);
      const balance = m.task3_holder.balance_ggrd || 0;
      const isYou = m.telegram_id === userId ? " ← YOU" : "";
      msg += `#${rank}. ${wallet} - ${balance.toFixed(0)} GGRD${isYou}\n`;
    }
    
    // Show user's rank if not in top 10
    if (userEntry && userEntry.task3_holder.top100_rank > 10) {
      msg += "\n━━━ Your Rank ━━━\n";
      const rank = userEntry.task3_holder.top100_rank;
      const wallet = userEntry.wallet_address.substring(0, 4) + "..." + userEntry.wallet_address.substring(userEntry.wallet_address.length - 4);
      const balance = userEntry.task3_holder.balance_ggrd || 0;
      msg += `#${rank}. ${wallet} - ${balance.toFixed(0)} GGRD ← YOU\n`;
    }
    
    // Show last 5
    if (top100.length > 15) {
      msg += "\n...\n\n";
      msg += "━━━ Last 5 ━━━\n";
      for (let i = Math.max(0, top100.length - 5); i < top100.length; i++) {
        const m = top100[i];
        const rank = m.task3_holder.top100_rank;
        const wallet = m.wallet_address.substring(0, 4) + "..." + m.wallet_address.substring(m.wallet_address.length - 4);
        const balance = m.task3_holder.balance_ggrd || 0;
        const isYou = m.telegram_id === userId ? " ← YOU" : "";
        msg += `#${rank}. ${wallet} - ${balance.toFixed(0)} GGRD${isYou}\n`;
      }
    }
    
    if (!userEntry) {
      msg += "\n⚠️ You are not in TOP 100 yet.\n";
      msg += "Hold ≥2,500 GGRD and wait for admin to run snapshot.";
    }
    
    await ctx.reply(msg);
    
  } catch (error) {
    console.error(`[ERROR] Error displaying TOP 100:`, error.message);
    ctx.reply("Error displaying TOP 100. Please try again.");
  }
});

// Admin command: /lottery - execute lottery draw
bot.command("lottery", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply(
      "Usage: /lottery <task_number>\n\n" +
      "Available lotteries:\n" +
      "/lottery 1 - Task 1 (2,000 GGRD)\n" +
      "/lottery 3 - Task 3 (10,000 GGRD)"
    );
  }
  
  const taskNum = parseInt(args[1]);
  
  if (taskNum !== 1 && taskNum !== 3) {
    return ctx.reply("Invalid task number. Use 1 or 3.");
  }
  
  try {
    // Check if lottery already executed
    const existingLottery = await snapshotsCollection.findOne({
      snapshot_type: `lottery_task${taskNum}`
    });
    
    if (existingLottery) {
      return ctx.reply(
        `❌ Task ${taskNum} lottery already executed!\n\n` +
        `Winner: ${existingLottery.winner_telegram_id}\n` +
        `Lottery entry: ${existingLottery.winner_entry}\n` +
        `Prize: ${existingLottery.prize_amount} GGRD\n` +
        `Executed: ${existingLottery.timestamp.toISOString()}`
      );
    }
    
    // Get eligible entries
    let entries;
    let prizeAmount;
    
    if (taskNum === 1) {
      // Task 1: all with lottery entry
      entries = await membersCollection.find({
        task1_lottery_entry: { $ne: null },
        disqualified: false
      }).toArray();
      prizeAmount = 2000;
    } else {
      // Task 3: only Day 7 qualified
      const day7Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day7" });
      if (!day7Snapshot) {
        return ctx.reply("❌ Day 7 snapshot must be executed first!");
      }
      
      entries = await membersCollection.find({
        "task3_holder.qualified_lottery": true,
        disqualified: false
      }).toArray();
      prizeAmount = 10000;
    }
    
    if (entries.length === 0) {
      return ctx.reply(`❌ No eligible entries for Task ${taskNum} lottery!`);
    }
    
    // Execute lottery
    const winner = entries[Math.floor(Math.random() * entries.length)];
    
    // Save lottery result
    await snapshotsCollection.insertOne({
      snapshot_type: `lottery_task${taskNum}`,
      timestamp: new Date(),
      winner_telegram_id: winner.telegram_id,
      winner_entry: taskNum === 1 ? winner.task1_lottery_entry : winner.task3_lottery_entry,
      winner_wallet: winner.wallet_address,
      total_entries: entries.length,
      prize_amount: prizeAmount,
      executed_by: userId
    });
    
    // Notify winner
    try {
      await bot.telegram.sendMessage(
        winner.telegram_id,
        `🎉🎉🎉 CONGRATULATIONS! 🎉🎉🎉\n\n` +
        `You WON the Task ${taskNum} lottery!\n\n` +
        `Prize: ${prizeAmount} GGRD\n` +
        `Your wallet: ${winner.wallet_address}\n\n` +
        `The prize will be sent to your wallet within 24 hours.\n\n` +
        "Thank you for being part of the GGRD community!"
      );
    } catch (err) {
      console.log(`[WARN] Could not notify winner ${winner.telegram_id}`);
    }
    
    const msg =
      `🎊 LOTTERY WINNER - TASK ${taskNum}\n\n` +
      `Winner: ${winner.telegram_id}\n` +
      `Username: @${winner.telegram_username || 'unknown'}\n` +
      `Wallet: ${winner.wallet_address}\n` +
      `Entry: ${taskNum === 1 ? winner.task1_lottery_entry : winner.task3_lottery_entry}\n` +
      `Prize: ${prizeAmount} GGRD\n\n` +
      `Total entries: ${entries.length}\n` +
      `Executed: ${new Date().toISOString()}`;
    
    await ctx.reply(msg);
    
    console.log(`[LOTTERY] Task ${taskNum} winner: ${winner.telegram_id} (${prizeAmount} GGRD)`);
    
  } catch (error) {
    console.error(`[ERROR] Lottery execution failed:`, error.message);
    ctx.reply("❌ Error executing lottery. Check server logs.");
  }
});

// Command: /leaderboard - public list of qualified holders
bot.command("leaderboard", async (ctx) => {
  try {
    // Get all qualified holders from Day 0 snapshot
    const qualified = await membersCollection.find({
      "task3_holder.snapshot_day0": true,
      disqualified: false
    }).sort({ "task3_holder.balance_ggrd": -1 }).toArray();
    
    if (qualified.length === 0) {
      return ctx.reply(
        "📊 GGRD Holder Leaderboard\n\n" +
        "No qualified holders yet.\n" +
        "Waiting for LP launch and Day 0 snapshot."
      );
    }
    
    const day7Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day7" });
    const lotteryExecuted = await snapshotsCollection.findOne({ snapshot_type: "lottery_task3" });
    
    let msg = "📊 GGRD Holder Leaderboard\n\n";
    msg += `Total qualified: ${qualified.length}\n`;
    
    if (day7Snapshot) {
      const stillQualified = qualified.filter(m => m.task3_holder?.qualified_lottery);
      msg += `Lottery qualified: ${stillQualified.length}\n`;
    }
    
    if (lotteryExecuted) {
      msg += `\n🎉 Lottery winner: ${lotteryExecuted.winner_telegram_id}\n`;
    }
    
    msg += "\n━━━ Top 10 Holders ━━━\n";
    
    const userId = String(ctx.from.id);
    
    for (let i = 0; i < Math.min(10, qualified.length); i++) {
      const m = qualified[i];
      const wallet = m.wallet_address.substring(0, 4) + "..." + m.wallet_address.substring(m.wallet_address.length - 4);
      const balance = m.task3_holder?.balance_ggrd || 0;
      const isYou = m.telegram_id === userId ? " ← YOU" : "";
      msg += `${i + 1}. ${wallet} - ${balance.toFixed(0)} GGRD${isYou}\n`;
    }
    
    await ctx.reply(msg);
    
  } catch (error) {
    console.error(`[ERROR] Error displaying leaderboard:`, error.message);
    ctx.reply("Error displaying leaderboard. Please try again.");
  }
});

// Admin command: /stats - comprehensive statistics
bot.command("stats", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  try {
    const totalMembers = await membersCollection.countDocuments();
    const withWallet = await membersCollection.countDocuments({ wallet_address: { $ne: null } });
    const task1Complete = await membersCollection.countDocuments({ task1_completed: true });
    const task2Submitted = await membersCollection.countDocuments({ "task2_purchase.submitted": true });
    const task2Verified = await membersCollection.countDocuments({ "task2_purchase.verified": true });
    const top100Count = await getTop100Count();
    
    const day0Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day0" });
    const day7Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day7" });
    const lottery1 = await snapshotsCollection.findOne({ snapshot_type: "lottery_task1" });
    const lottery3 = await snapshotsCollection.findOne({ snapshot_type: "lottery_task3" });
    const biggestHolderAwarded = await snapshotsCollection.findOne({ snapshot_type: "biggest_holder_award" });
    
    let msg = "📊 GGRD Bot Statistics\n\n";
    
    msg += "━━━ MEMBERS ━━━\n";
    msg += `Total registered: ${totalMembers}\n`;
    msg += `With wallet: ${withWallet}\n\n`;
    
    msg += "━━━ TASK 1 ━━━\n";
    msg += `Completed: ${task1Complete}\n`;
    msg += `Rewards paid: ${task1Complete * 10} GGRD\n`;
    msg += `Lottery: ${lottery1 ? 'Executed' : 'Pending'}\n`;
    if (lottery1) {
      msg += `Winner: ${lottery1.winner_telegram_id} (${lottery1.prize_amount} GGRD)\n`;
    }
    msg += "\n";
    
    msg += "━━━ TASK 2 ━━━\n";
    msg += `Submitted: ${task2Submitted}\n`;
    msg += `Verified: ${task2Verified}/${TASK2_MAX_USERS}\n`;
    msg += `Rewards paid: ${task2Verified * 20} GGRD\n\n`;
    
    msg += "━━━ TASK 3 ━━━\n";
    msg += `TOP 100: ${top100Count}/100\n`;
    msg += `TOP 100 rewards: ${top100Count * 50} GGRD\n`;
    
    if (day0Snapshot) {
      msg += `Day 0 qualified: ${day0Snapshot.total_qualified}\n`;
    }
    
    if (day7Snapshot) {
      msg += `Day 7 qualified: ${day7Snapshot.lottery_qualified}\n`;
      msg += `Lottery: ${lottery3 ? 'Executed' : 'Pending'}\n`;
      if (lottery3) {
        msg += `Winner: ${lottery3.winner_telegram_id} (${lottery3.prize_amount} GGRD)\n`;
      }
    } else if (day0Snapshot) {
      const day0Time = new Date(day0Snapshot.timestamp);
      const day7Time = new Date(day0Time.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      const timeLeft = day7Time - now;
      
      if (timeLeft > 0) {
        const days = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
        const hours = Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        msg += `Day 7 snapshot in: ${days}d ${hours}h\n`;
      } else {
        msg += "Day 7 snapshot: Overdue\n";
      }
    }
    
    msg += "\n━━━ BIGGEST HOLDER ━━━\n";
    const dailySnapshots = await dailySnapshotsCollection.countDocuments();
    msg += `Daily snapshots: ${dailySnapshots}/30\n`;
    
    if (dailySnapshots > 0) {
      const latestSnapshot = await dailySnapshotsCollection.findOne({}, { sort: { day: -1 } });
      if (latestSnapshot && latestSnapshot.biggest_holder) {
        msg += `Current leader: ${latestSnapshot.biggest_holder.telegram_id}\n`;
        msg += `Balance: ${latestSnapshot.biggest_holder.balance} GGRD\n`;
      }
    }
    
    if (biggestHolderAwarded) {
      msg += `Award: Executed (${biggestHolderAwarded.winner_telegram_id})\n`;
    } else if (dailySnapshots >= 30) {
      msg += "Award: Ready to execute!\n";
    } else {
      msg += `Days until award: ${30 - dailySnapshots}\n`;
    }
    
    msg += "\n━━━ REFERRAL PROGRAM ━━━\n";
    const totalReferrals = await membersCollection.countDocuments({ "referrals.count": { $gt: 0 } });
    const totalWithWallet = await membersCollection.countDocuments({ "referrals.count_with_wallet": { $gt: 0 } });
    const referralPayouts = await snapshotsCollection.findOne({ snapshot_type: "referral_payout" });
    
    const totalReferralRewards = await membersCollection.aggregate([
      { $group: { _id: null, total: { $sum: "$referrals.earned" } } }
    ]).toArray();
    const referralEarned = totalReferralRewards[0]?.total || 0;
    
    msg += `Referrers: ${totalReferrals}\n`;
    msg += `Successful referrals: ${totalWithWallet}\n`;
    msg += `Total earned: ${referralEarned}/10,000 GGRD\n`;
    
    if (referralPayouts) {
      msg += `Payout: Executed (${referralPayouts.recipients_count} users)\n`;
    } else {
      msg += "Payout: Pending (Day 10)\n";
    }
    
    msg += "\n━━━ TOTAL REWARDS ━━━\n";
    const totalRewards = (task1Complete * 10) + (task2Verified * 20) + (top100Count * 50) +
      (lottery1 ? lottery1.prize_amount : 0) + (lottery3 ? lottery3.prize_amount : 0) +
      (biggestHolderAwarded ? 20000 : 0) + (referralPayouts ? referralPayouts.total_paid : 0);
    msg += `Distributed: ${totalRewards} GGRD\n`;
    
    await ctx.reply(msg);
    
  } catch (error) {
    console.error(`[ERROR] Error displaying stats:`, error.message);
    ctx.reply("Error displaying statistics. Please try again.");
  }
});

// Admin command: /daily_snapshot - take daily snapshot for biggest holder tracking
bot.command("daily_snapshot", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  try {
    // Check if Day 0 snapshot exists (LP must be launched)
    const day0Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day0" });
    if (!day0Snapshot) {
      return ctx.reply("❌ LP must be launched first! Execute /snapshot_day0");
    }
    
    // Calculate current day number
    const day0Time = new Date(day0Snapshot.timestamp);
    const now = new Date();
    const daysPassed = Math.floor((now - day0Time) / (24 * 60 * 60 * 1000));
    const currentDay = daysPassed + 1;
    
    if (currentDay > 30) {
      return ctx.reply("❌ 30-day tracking period has ended. Use /award_biggest_holder");
    }
    
    // Check if snapshot already exists for today
    const existingSnapshot = await dailySnapshotsCollection.findOne({ day: currentDay });
    if (existingSnapshot) {
      return ctx.reply(
        `❌ Daily snapshot already executed for Day ${currentDay}!\n\n` +
        `Biggest holder: ${existingSnapshot.biggest_holder.telegram_id}\n` +
        `Balance: ${existingSnapshot.biggest_holder.balance} GGRD`
      );
    }
    
    await ctx.reply(`🔄 Taking daily snapshot (Day ${currentDay}/30)...\nThis may take a few minutes.`);
    
    // Get all holders with ≥2500 GGRD from Day 0
    const holders = await membersCollection.find({
      "task3_holder.snapshot_day0": true,
      disqualified: false
    }).toArray();
    
    let biggestHolder = null;
    let maxBalance = 0;
    const holderData = [];
    
    for (const holder of holders) {
      const balance = await getTokenBalance(holder.wallet_address);
      
      holderData.push({
        telegram_id: holder.telegram_id,
        wallet_address: holder.wallet_address,
        balance: balance
      });
      
      if (balance > maxBalance) {
        maxBalance = balance;
        biggestHolder = {
          telegram_id: holder.telegram_id,
          wallet_address: holder.wallet_address,
          balance: balance
        };
      }
    }
    
    // Save daily snapshot
    await dailySnapshotsCollection.insertOne({
      day: currentDay,
      timestamp: new Date(),
      biggest_holder: biggestHolder,
      total_holders: holders.length,
      holders_data: holderData,
      executed_by: userId
    });
    
    const msg =
      `✅ Daily Snapshot Complete (Day ${currentDay}/30)\n\n` +
      `Biggest holder today:\n` +
      `User: ${biggestHolder.telegram_id}\n` +
      `Balance: ${biggestHolder.balance.toFixed(0)} GGRD\n\n` +
      `Total holders tracked: ${holders.length}\n\n` +
      (currentDay < 30 ? `Next snapshot: Day ${currentDay + 1}` : "30 days complete! Use /award_biggest_holder");
    
    await ctx.reply(msg);
    
    console.log(`[DAILY_SNAPSHOT] Day ${currentDay}: Biggest holder ${biggestHolder.telegram_id} with ${biggestHolder.balance} GGRD`);
    
  } catch (error) {
    console.error(`[ERROR] Daily snapshot failed:`, error.message);
    ctx.reply("❌ Error taking daily snapshot. Check server logs.");
  }
});

// Command: /biggest_holder - show current biggest holder leader
bot.command(["biggest_holder", "top_holder"], async (ctx) => {
  try {
    const dailySnapshots = await dailySnapshotsCollection.find({}).sort({ day: 1 }).toArray();
    
    if (dailySnapshots.length === 0) {
      return ctx.reply(
        "📊 Biggest Holder Tracking\n\n" +
        "No snapshots yet. Waiting for admin to start daily tracking.\n\n" +
        "Prize: 20,000 GGRD for highest average balance over 30 days!"
      );
    }
    
    // Calculate average balance for each holder
    const holderStats = {};
    
    for (const snapshot of dailySnapshots) {
      if (!snapshot.holders_data) continue;
      
      for (const holder of snapshot.holders_data) {
        if (!holderStats[holder.telegram_id]) {
          holderStats[holder.telegram_id] = {
            telegram_id: holder.telegram_id,
            wallet_address: holder.wallet_address,
            total_balance: 0,
            days_tracked: 0,
            daily_balances: []
          };
        }
        
        holderStats[holder.telegram_id].total_balance += holder.balance;
        holderStats[holder.telegram_id].days_tracked++;
        holderStats[holder.telegram_id].daily_balances.push(holder.balance);
      }
    }
    
    // Calculate averages and sort
    const rankedHolders = Object.values(holderStats)
      .map(h => ({
        ...h,
        average_balance: h.total_balance / h.days_tracked
      }))
      .sort((a, b) => b.average_balance - a.average_balance);
    
    const latestSnapshot = dailySnapshots[dailySnapshots.length - 1];
    const currentLeader = rankedHolders[0];
    
    let msg = "📊 Biggest Holder Competition\n\n";
    msg += `Days tracked: ${dailySnapshots.length}/30\n`;
    msg += `Prize: 20,000 GGRD\n\n`;
    
    msg += "━━━ Current Leader ━━━\n";
    msg += `User: ${currentLeader.telegram_id}\n`;
    msg += `Avg balance: ${currentLeader.average_balance.toFixed(0)} GGRD\n`;
    msg += `Days tracked: ${currentLeader.days_tracked}\n\n`;
    
    msg += "━━━ Top 5 Contenders ━━━\n";
    const userId = String(ctx.from.id);
    let userRank = null;
    let userStats = null;
    
    for (let i = 0; i < Math.min(5, rankedHolders.length); i++) {
      const h = rankedHolders[i];
      const wallet = h.wallet_address.substring(0, 4) + "..." + h.wallet_address.substring(h.wallet_address.length - 4);
      const isYou = h.telegram_id === userId ? " ← YOU" : "";
      msg += `${i + 1}. ${wallet} - ${h.average_balance.toFixed(0)} GGRD avg${isYou}\n`;
      
      if (h.telegram_id === userId) {
        userRank = i + 1;
        userStats = h;
      }
    }
    
    // Show user's rank if not in TOP 5
    if (!userRank) {
      for (let i = 0; i < rankedHolders.length; i++) {
        if (rankedHolders[i].telegram_id === userId) {
          userRank = i + 1;
          userStats = rankedHolders[i];
          break;
        }
      }
      
      if (userRank) {
        msg += "\n━━━ Your Position ━━━\n";
        const wallet = userStats.wallet_address.substring(0, 4) + "..." + userStats.wallet_address.substring(userStats.wallet_address.length - 4);
        msg += `Rank: #${userRank} of ${rankedHolders.length}\n`;
        msg += `${wallet} - ${userStats.average_balance.toFixed(0)} GGRD avg\n`;
      }
    }
    
    if (dailySnapshots.length < 30) {
      msg += `\n⏰ ${30 - dailySnapshots.length} days remaining`;
    } else {
      msg += "\n✅ 30 days complete! Winner will be announced soon.";
    }
    
    await ctx.reply(msg);
    
  } catch (error) {
    console.error(`[ERROR] Error displaying biggest holder:`, error.message);
    ctx.reply("Error displaying biggest holder. Please try again.");
  }
});

// Admin command: /award_biggest_holder - award prize after 30 days
bot.command("award_biggest_holder", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  try {
    // Check if already awarded
    const existingAward = await snapshotsCollection.findOne({ snapshot_type: "biggest_holder_award" });
    if (existingAward) {
      return ctx.reply(
        "❌ Biggest holder award already given!\n\n" +
        `Winner: ${existingAward.winner_telegram_id}\n` +
        `Average balance: ${existingAward.average_balance.toFixed(0)} GGRD\n` +
        `Prize: ${existingAward.prize_amount} GGRD`
      );
    }
    
    // Get all daily snapshots
    const dailySnapshots = await dailySnapshotsCollection.find({}).sort({ day: 1 }).toArray();
    
    if (dailySnapshots.length < 30) {
      return ctx.reply(
        `❌ Need 30 daily snapshots to award prize!\n\n` +
        `Current: ${dailySnapshots.length}/30\n` +
        `Missing: ${30 - dailySnapshots.length} days`
      );
    }
    
    // Calculate average balance for each holder over 30 days
    const holderStats = {};
    
    for (const snapshot of dailySnapshots) {
      if (!snapshot.holders_data) continue;
      
      for (const holder of snapshot.holders_data) {
        if (!holderStats[holder.telegram_id]) {
          holderStats[holder.telegram_id] = {
            telegram_id: holder.telegram_id,
            wallet_address: holder.wallet_address,
            total_balance: 0,
            days_tracked: 0
          };
        }
        
        holderStats[holder.telegram_id].total_balance += holder.balance;
        holderStats[holder.telegram_id].days_tracked++;
      }
    }
    
    // Find winner (highest average)
    let winner = null;
    let maxAverage = 0;
    
    for (const holder of Object.values(holderStats)) {
      const average = holder.total_balance / holder.days_tracked;
      if (average > maxAverage) {
        maxAverage = average;
        winner = { ...holder, average_balance: average };
      }
    }
    
    if (!winner) {
      return ctx.reply("❌ No eligible holders found!");
    }
    
    // Save award record
    await snapshotsCollection.insertOne({
      snapshot_type: "biggest_holder_award",
      timestamp: new Date(),
      winner_telegram_id: winner.telegram_id,
      winner_wallet: winner.wallet_address,
      average_balance: winner.average_balance,
      days_tracked: winner.days_tracked,
      prize_amount: 20000,
      executed_by: userId
    });
    
    // Notify winner
    try {
      await bot.telegram.sendMessage(
        winner.telegram_id,
        "🎉🎉🎉 BIGGEST HOLDER CHAMPION! 🎉🎉🎉\n\n" +
        "You held the highest average GGRD balance over 30 days!\n\n" +
        `Average balance: ${winner.average_balance.toFixed(0)} GGRD\n` +
        `Prize: 20,000 GGRD\n` +
        `Wallet: ${winner.wallet_address}\n\n` +
        "The prize will be sent to your wallet within 24 hours.\n\n" +
        "Thank you for being a dedicated GGRD holder!"
      );
    } catch (err) {
      console.log(`[WARN] Could not notify winner ${winner.telegram_id}`);
    }
    
    const msg =
      "🏆 BIGGEST HOLDER AWARD\n\n" +
      `Winner: ${winner.telegram_id}\n` +
      `Wallet: ${winner.wallet_address}\n` +
      `Average balance: ${winner.average_balance.toFixed(0)} GGRD\n` +
      `Days tracked: ${winner.days_tracked}/30\n` +
      `Prize: 20,000 GGRD\n\n` +
      `Executed: ${new Date().toISOString()}`;
    
    await ctx.reply(msg);
    
    console.log(`[BIGGEST_HOLDER] Winner: ${winner.telegram_id} with avg ${winner.average_balance} GGRD`);
    
  } catch (error) {
    console.error(`[ERROR] Award biggest holder failed:`, error.message);
    ctx.reply("❌ Error awarding biggest holder. Check server logs.");
  }
});

// Command: /invite - show referral link and stats
bot.command("invite", async (ctx) => {
  const userId = String(ctx.from.id);
  
  try {
    const member = await getMember(userId);
    
    if (!member) {
      return ctx.reply("Please use /start first to register.");
    }
    
    const botUsername = (await ctx.telegram.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=ref_${userId}`;
    
    // Check global pool status
    const totalReferralRewards = await membersCollection.aggregate([
      { $group: { _id: null, total: { $sum: "$referrals.earned" } } }
    ]).toArray();
    
    const currentTotal = totalReferralRewards[0]?.total || 0;
    const remaining = 10000 - currentTotal;
    
    let msg = "👥 Referral Program\n\n";
    
    if (remaining > 0) {
      msg += "*How it works:*\n";
      msg += "1. Share your link\n";
      msg += "2. Friend joins + adds wallet\n";
      msg += "3. You earn 5 GGRD\n\n";
      msg += `⚠️ Rewards paid on *Day 10* after LP launch\n\n`;
    } else {
      msg += "❌ Pool limit reached (10,000 GGRD)\n\n";
    }
    
    msg += "━━━ Your Stats ━━━\n";
    msg += `Total referrals: ${member.referrals?.count || 0}\n`;
    msg += `With wallet: ${member.referrals?.count_with_wallet || 0}\n`;
    msg += `Earned: ${member.referrals?.earned || 0} GGRD\n`;
    
    if (member.referrals?.reward_paid) {
      msg += "Status: ✅ Paid\n";
    } else if ((member.referrals?.earned || 0) > 0) {
      msg += "Status: ⏳ Pending (Day 10)\n";
    }
    
    msg += "\n━━━ Global Pool ━━━\n";
    msg += `Distributed: ${currentTotal.toFixed(0)} / 10,000 GGRD\n`;
    msg += `Remaining: ${remaining.toFixed(0)} GGRD\n\n`;
    
    if (remaining > 0) {
      msg += `*Your link:*\n\`${referralLink}\`\n\n`;
      msg += "Use /referrals to see TOP recruiters";
    }
    
    await ctx.reply(msg, { parse_mode: "Markdown" });
    
  } catch (error) {
    console.error(`[ERROR] Error in invite command:`, error.message);
    ctx.reply("Error displaying referral info. Please try again.");
  }
});

// Command: /referrals - show TOP 10 referrers leaderboard
bot.command("referrals", async (ctx) => {
  try {
    const topReferrers = await membersCollection.find({
      "referrals.count_with_wallet": { $gt: 0 }
    }).sort({ "referrals.earned": -1 }).limit(10).toArray();
    
    if (topReferrers.length === 0) {
      return ctx.reply(
        "📊 Referral Leaderboard\n\n" +
        "No referrals yet. Be the first!\n\n" +
        "Use /invite to get your referral link."
      );
    }
    
    let msg = "📊 TOP 10 Referral Champions\n\n";
    
    const userId = String(ctx.from.id);
    let userRank = null;
    
    for (let i = 0; i < topReferrers.length; i++) {
      const r = topReferrers[i];
      const username = r.telegram_username ? `@${r.telegram_username}` : `User ${r.telegram_id}`;
      const isYou = r.telegram_id === userId ? " ← YOU" : "";
      msg += `${i + 1}. ${username}\n`;
      msg += `   👥 ${r.referrals.count_with_wallet} referrals • 💰 ${r.referrals.earned} GGRD${isYou}\n`;
      
      if (r.telegram_id === userId) {
        userRank = i + 1;
      }
    }
    
    // Show user's rank if not in TOP 10
    if (!userRank) {
      const member = await getMember(userId);
      if (member && (member.referrals?.count_with_wallet || 0) > 0) {
        const allReferrers = await membersCollection.find({
          "referrals.count_with_wallet": { $gt: 0 }
        }).sort({ "referrals.earned": -1 }).toArray();
        
        const rank = allReferrers.findIndex(r => r.telegram_id === userId) + 1;
        if (rank > 0) {
          msg += "\n━━━ Your Position ━━━\n";
          msg += `Rank: #${rank} of ${allReferrers.length}\n`;
          msg += `👥 ${member.referrals.count_with_wallet} referrals • 💰 ${member.referrals.earned} GGRD\n`;
        }
      }
    }
    
    msg += "\n⚠️ Rewards paid on Day 10 after LP launch";
    
    await ctx.reply(msg);
    
  } catch (error) {
    console.error(`[ERROR] Error in referrals command:`, error.message);
    ctx.reply("Error displaying referral leaderboard. Please try again.");
  }
});

// Admin command: /pay_referrals - pay all referral rewards on Day 10
bot.command("pay_referrals", async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply("You are not authorized to use this command.");
  }
  
  try {
    // Check if Day 0 snapshot exists
    const day0Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day0" });
    if (!day0Snapshot) {
      return ctx.reply("❌ LP must be launched first! Execute /snapshot_day0");
    }
    
    // Calculate current day
    const day0Time = new Date(day0Snapshot.timestamp);
    const now = new Date();
    const daysPassed = Math.floor((now - day0Time) / (24 * 60 * 60 * 1000));
    const currentDay = daysPassed + 1;
    
    if (currentDay < 10) {
      return ctx.reply(
        `❌ Too early! Referral rewards are paid on Day 10.\n\n` +
        `Current: Day ${currentDay}\n` +
        `Wait: ${10 - currentDay} more days`
      );
    }
    
    // Check if already paid
    const paymentRecord = await snapshotsCollection.findOne({ snapshot_type: "referral_payout" });
    if (paymentRecord) {
      return ctx.reply(
        "❌ Referral rewards already paid!\n\n" +
        `Date: ${paymentRecord.timestamp.toISOString()}\n` +
        `Total paid: ${paymentRecord.total_paid} GGRD\n` +
        `Recipients: ${paymentRecord.recipients_count}`
      );
    }
    
    await ctx.reply("🔄 Processing referral payouts...\nThis may take a few minutes.");
    
    // Get all users with referral earnings
    const referrers = await membersCollection.find({
      "referrals.earned": { $gt: 0 },
      "referrals.reward_paid": false
    }).toArray();
    
    let totalPaid = 0;
    let recipientsCount = 0;
    
    for (const referrer of referrers) {
      const earned = referrer.referrals.earned;
      
      // Mark as paid
      await updateTaskStatus(referrer.telegram_id, {
        "referrals.reward_paid": true,
        total_rewards: (referrer.total_rewards || 0) + earned
      });
      
      totalPaid += earned;
      recipientsCount++;
      
      // Notify user
      try {
        await bot.telegram.sendMessage(
          referrer.telegram_id,
          `🎉 Referral Rewards Paid!\n\n` +
          `You earned: ${earned} GGRD\n` +
          `Successful referrals: ${referrer.referrals.count_with_wallet}\n` +
          `Wallet: ${referrer.wallet_address}\n\n` +
          "The rewards will be sent to your wallet within 24 hours.\n\n" +
          "Thank you for growing the GGRD community!"
        );
      } catch (err) {
        console.log(`[WARN] Could not notify referrer ${referrer.telegram_id}`);
      }
    }
    
    // Save payout record
    await snapshotsCollection.insertOne({
      snapshot_type: "referral_payout",
      timestamp: new Date(),
      day: currentDay,
      total_paid: totalPaid,
      recipients_count: recipientsCount,
      executed_by: userId
    });
    
    const msg =
      "✅ Referral Payouts Complete!\n\n" +
      `Total paid: ${totalPaid} GGRD\n` +
      `Recipients: ${recipientsCount}\n` +
      `Day: ${currentDay} (Day 10)\n\n` +
      `Executed: ${new Date().toISOString()}`;
    
    await ctx.reply(msg);
    
    console.log(`[REFERRAL_PAYOUT] Paid ${totalPaid} GGRD to ${recipientsCount} referrers`);
    
  } catch (error) {
    console.error(`[ERROR] Referral payout failed:`, error.message);
    ctx.reply("❌ Error processing referral payouts. Check server logs.");
  }
});

// Command: /task3_status - show Task 3 detailed status
bot.command("task3_status", async (ctx) => {
  const userId = String(ctx.from.id);
  
  try {
    const member = await getMember(userId);
    
    if (!member) {
      return ctx.reply("Please use /start first to register.");
    }
    
    const day0Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day0" });
    const day7Snapshot = await snapshotsCollection.findOne({ snapshot_type: "day7" });
    const top100Count = await getTop100Count();
    
    let msg = "📊 TASK 3 - Holder 2500+ Status\n\n";
    
    // TOP 100 Section
    msg += "━━━ TOP 100 REWARD ━━━\n";
    msg += `Slots filled: ${top100Count}/100\n`;
    
    if (member.task3_holder?.top100_rank) {
      msg += `Your rank: #${member.task3_holder.top100_rank}\n`;
      msg += `Status: ✅ EARNED 50 GGRD\n`;
    } else if (top100Count >= 100) {
      msg += `Your status: ❌ TOP 100 is full\n`;
    } else {
      msg += `Your status: ⏳ Waiting for snapshot\n`;
      msg += `Remaining slots: ${100 - top100Count}\n`;
    }
    
    msg += "\n━━━ LOTTERY 10k GGRD ━━━\n";
    
    if (!day0Snapshot) {
      msg += "Status: ⏳ Waiting for LP launch (Day 0)\n";
      msg += "\nRequirements:\n";
      msg += "• Hold ≥2,500 GGRD on Day 0 (LP launch)\n";
      msg += "• Hold ≥2,500 GGRD on Day 7 (lottery draw)\n";
    } else {
      const lotteryQualified = await membersCollection.countDocuments({
        "task3_holder.qualified_lottery": true
      });
      
      msg += `Total qualified: ${lotteryQualified} holders\n\n`;
      msg += "Your status:\n";
      
      const balance = member.task3_holder?.balance_ggrd || 0;
      const hasDay0 = member.task3_holder?.snapshot_day0 || false;
      const hasDay7 = member.task3_holder?.snapshot_day7 || false;
      const qualified = member.task3_holder?.qualified_lottery || false;
      
      if (hasDay0) {
        msg += `├─ Day 0 (LP launch): ${balance} GGRD ✅\n`;
      } else {
        msg += `├─ Day 0 (LP launch): Not qualified ❌\n`;
      }
      
      if (day7Snapshot) {
        if (hasDay7 && qualified) {
          msg += `└─ Day 7 (lottery): ${balance} GGRD ✅\n\n`;
          msg += `🎟️ Lottery Entry: ${member.task3_lottery_entry}\n`;
          msg += "🎁 Prize: 10,000 GGRD\n";
          msg += "\n✅ You are qualified for the lottery!";
        } else {
          msg += `└─ Day 7 (lottery): ${balance} GGRD ❌\n\n`;
          msg += "❌ Not qualified (balance below 2,500)";
        }
      } else {
        const day0Time = new Date(day0Snapshot.timestamp);
        const day7Time = new Date(day0Time.getTime() + 7 * 24 * 60 * 60 * 1000);
        const now = new Date();
        const timeLeft = day7Time - now;
        
        if (timeLeft > 0) {
          const days = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
          const hours = Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
          msg += `└─ Day 7 (lottery): Pending\n\n`;
          msg += `⏰ Next snapshot in: ${days}d ${hours}h\n\n`;
          msg += "⚠️ Keep ≥2,500 GGRD until Day 7 to stay qualified!";
        } else {
          msg += `└─ Day 7 (lottery): Snapshot overdue\n\n`;
          msg += "⏳ Waiting for admin to execute Day 7 snapshot";
        }
      }
    }
    
    await ctx.reply(msg);
    
  } catch (error) {
    console.error(`[ERROR] Error displaying Task 3 status:`, error.message);
    ctx.reply("Error displaying Task 3 status. Please try again.");
  }
});

// Action handler for button
bot.action("verify_tasks", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const username = ctx.from.username || null;
  const firstName = ctx.from.first_name || null;
  const lastName = ctx.from.last_name || null;

  console.log(`[VERIFY] verify_tasks from user ${userId}`);

  const inChannel = await isUserMember(ctx, CHANNEL_ID, userId);
  const inGroup = await isUserMember(ctx, GROUP_ID, userId);

  console.log(`[CHECK] User ${userId}: channel=${inChannel}, group=${inGroup}`);

  if (!inChannel || !inGroup) {
    const missing = [];
    if (!inChannel) missing.push(`- Channel: ${CHANNEL_ID}`);
    if (!inGroup) missing.push(`- Group: ${GROUP_ID}`);

    console.log(`[FAILED] User ${userId} verification failed: ${missing.join(', ')}`);

    const errorMessage =
      "*Verification failed*\n\n" +
      "You need to join the following chats to participate in rewards:\n\n" +
      missing.join("\n") +
      "\n\n" +
      "*Please:*\n" +
      "1. Join the channel: " + CHANNEL_ID + "\n" +
      "2. Join the group: " + GROUP_ID + "\n" +
      "3. Click the button again to verify";

    return ctx.editMessageText(errorMessage, { parse_mode: "Markdown" });
  }

  await upsertMember(userId, {
    telegram_username: username,
    first_name: firstName,
    last_name: lastName,
    tasks: {
      tg_channel: inChannel,
      tg_group: inGroup
    }
  });

  const member = await getMember(userId);

  if (member && member.wallet_address) {
    console.log(`[OK] User ${userId} already has wallet registered`);
    
    // Check if Task 1 can be completed
    const result = await assignTask1Rewards(userId);
    
    let msg = "You're already verified!\n\n";
    
    if (result) {
      msg += `Task 1 completed!\n`;
      msg += `Reward: ${result.reward} GGRD\n`;
      msg += `Lottery entry: ${result.lotteryEntry}\n\n`;
    }
    
    msg += "Your wallet for GGRD Community Rewards is:\n" +
      member.wallet_address +
      "\n\nUse /me or /profile to see your full profile.";
    
    return ctx.editMessageText(msg);
  }

  waitingForWallet.add(userId);
  console.log(`[WAITING] User ${userId} added to waitingForWallet`);

  const walletRequestMessage =
    "*Verification successful!*\n\n" +
    "You are now a verified member of the GGRD community.\n\n" +
    "*Next step:* please send your Solana wallet address.\n\n" +
    "*Important:*\n" +
    "- Send ONLY your wallet address (32-44 characters)\n" +
    "- Make sure it's correct - you can't change it later\n" +
    "- This address will be used for reward distributions\n\n" +
    "Example: Fz2w9g...x9a";

  ctx.editMessageText(walletRequestMessage, { parse_mode: "Markdown" });
});

// Action handler: submit_purchase_start
bot.action("submit_purchase_start", async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from.id;
  const member = await getMember(userId);
  
  if (!member) {
    return ctx.reply("Please use /start first to register.");
  }
  
  if (member.task2_purchase?.submitted) {
    const status = member.task2_purchase.verified ? "verified" : "pending verification";
    return ctx.reply(
      `You have already submitted a purchase proof.\n` +
      `TX Hash: ${member.task2_purchase.tx_hash}\n` +
      `Status: ${status}\n\n` +
      `Use /tasks to check your status.`
    );
  }
  
  const verifiedCount = await getTask2VerifiedCount();
  if (verifiedCount >= TASK2_MAX_USERS) {
    return ctx.reply(
      "Sorry, Task 2 limit has been reached.\n\n" +
      `Verified purchases: ${verifiedCount}/${TASK2_MAX_USERS}\n\n` +
      "You can still participate in other tasks!"
    );
  }
  
  waitingForTxHash.add(userId);
  
  const msg =
    "*Submit Purchase Proof (Task 2)*\n\n" +
    "Please send your Solana transaction hash from your GGRD purchase.\n\n" +
    "*Requirements:*\n" +
    "- Purchase must be minimum 5 USD worth of GGRD\n" +
    "- Transaction must be from Jupiter, Raydium or other DEX\n" +
    "- TX hash is 87-88 characters long\n\n" +
    "*Example TX hash:*\n" +
    "5a8d9f2b3c4e6h7j8k9m1n2p3q4r5s6t7u8v9w1x2y3z4a5b6c7d8e9f1g2h3j4k5m6n7p8q9r1s2t3u4v5w6x7y8z9";
  
  ctx.reply(msg, { parse_mode: "Markdown" });
  console.log(`[PURCHASE] User ${userId} started submit purchase flow`);
});

// Text handler for wallet input and TX hash - MUST be registered AFTER commands
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = (ctx.message.text || "").trim();

  // Ignore commands - they are handled above
  if (text.startsWith("/")) {
    console.log(`[SKIP] Ignoring command in text handler: ${text}`);
    return;
  }

  // Check if waiting for TX hash (Task 2)
  if (waitingForTxHash.has(userId)) {
    console.log(`[TX_HASH] Received potential TX hash from user ${userId}: ${text.substring(0, 15)}...`);

    if (!isValidSolanaTxHash(text)) {
      console.log(`[INVALID] Invalid TX hash format from user ${userId}`);
      return ctx.reply(
        "This does not look like a valid Solana transaction hash.\n\n" +
          "Please send a correct Solana TX hash (87-88 characters)."
      );
    }

    await updateTaskStatus(userId, {
      "task2_purchase.submitted": true,
      "task2_purchase.tx_hash": text,
      "task2_purchase.verified": false
    });

    waitingForTxHash.delete(userId);

    const msg =
      "Thank you! Your purchase proof has been submitted.\n\n" +
      `TX Hash: ${text}\n\n` +
      "Status: Waiting for admin verification\n\n" +
      "You will be notified once your purchase is verified.\n" +
      "Reward: 20 GGRD (upon verification)";

    ctx.reply(msg);

    console.log(`[OK] TX hash submitted for user ${userId}: ${text}`);
    
    // Notify admin
    if (ADMIN_ID) {
      try {
        const member = await getMember(userId);
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `[NEW PURCHASE SUBMISSION]\n` +
          `User ID: ${userId}\n` +
          `Username: @${member.telegram_username || 'unknown'}\n` +
          `TX Hash: ${text}\n\n` +
          `Verify at: https://solscan.io/tx/${text}\n\n` +
          `To approve: /verify_purchase ${userId} approved\n` +
          `To reject: /verify_purchase ${userId} rejected`
        );
      } catch (err) {
        console.log(`[WARN] Could not notify admin`);
      }
    }
    return;
  }

  // Check if waiting for wallet
  if (!waitingForWallet.has(userId)) {
    return;
  }

  console.log(`[WALLET] Received potential wallet from user ${userId}: ${text.substring(0, 10)}...`);

  if (!isValidSolanaAddress(text)) {
    console.log(`[INVALID] Invalid wallet format from user ${userId}`);
    return ctx.reply(
      "This does not look like a valid Solana wallet address.\n\n" +
        "Please send a correct Solana address (base58, 32-44 characters)."
    );
  }

  await upsertMember(userId, {
    wallet_address: text
  });

  waitingForWallet.delete(userId);
  
  // Check if user was referred - credit referrer
  const member = await getMember(userId);
  if (member.referred_by) {
    const referrer = await getMember(member.referred_by);
    if (referrer) {
      // Check global pool limit
      const totalReferralRewards = await membersCollection.aggregate([
        { $group: { _id: null, total: { $sum: "$referrals.earned" } } }
      ]).toArray();
      
      const currentTotal = totalReferralRewards[0]?.total || 0;
      
      if (currentTotal < 10000) {
        // Credit referrer
        await updateTaskStatus(member.referred_by, {
          "referrals.count_with_wallet": (referrer.referrals?.count_with_wallet || 0) + 1,
          "referrals.earned": (referrer.referrals?.earned || 0) + 5
        });
        
        console.log(`[REFERRAL] Credited 5 GGRD to referrer ${member.referred_by}`);
        
        // Notify referrer
        try {
          await bot.telegram.sendMessage(
            member.referred_by,
            `🎉 Referral Success!\n\n` +
            `Your referral just added their wallet!\n` +
            `Earned: 5 GGRD\n` +
            `Total referral earnings: ${(referrer.referrals?.earned || 0) + 5} GGRD\n\n` +
            `⚠️ Rewards will be paid on Day 10 after LP launch.\n\n` +
            `Use /invite to get more referrals!`
          );
        } catch (err) {
          console.log(`[WARN] Could not notify referrer ${member.referred_by}`);
        }
      } else {
        console.log(`[REFERRAL] Pool limit reached (${currentTotal}/10000)`);
      }
    }
  }
  
  // Try to complete Task 1
  const result = await assignTask1Rewards(userId);

  let msg = "All set!\n\n" +
    "Your wallet has been registered for *GGRD Community Rewards*.\n\n";
  
  if (result) {
    msg += `Task 1 completed!\n`;
    msg += `Reward: ${result.reward} GGRD\n`;
    msg += `Lottery entry: ${result.lotteryEntry}\n`;
    msg += `Prize pool: 2,000 GGRD\n\n`;
  }
  
  msg += "You can check your status anytime with /me or /profile.";

  ctx.reply(msg, { parse_mode: "Markdown" });

  console.log(`[OK] Wallet registered for user ${userId}: ${text}`);
});

// === START BOT ===
async function startBot() {
  try {
    // Connect to MongoDB first
    await connectToMongoDB();
    
    // Then launch bot
    await bot.launch();
    
    console.log("[OK] Connected to Telegram!");
    console.log("[OK] GGRD Community Rewards Bot started successfully!");
    console.log(`[INFO] Monitoring channel: ${CHANNEL_ID}`);
    console.log(`[INFO] Monitoring group: ${GROUP_ID}`);
    console.log(`[INFO] Admin ID: ${ADMIN_ID || 'Not set'}`);
    console.log(`[INFO] Token mint: ${GGRD_TOKEN_MINT}`);
    
    const count = await membersCollection.countDocuments();
    console.log(`[STATS] Current members in database: ${count}`);
  } catch (error) {
    console.error("\n[ERROR] Failed to start bot:", error.message);
    console.error("[INFO] Check BOT_TOKEN, MONGODB_URI and internet connection.");
    process.exit(1);
  }
}

// Graceful stop
process.once("SIGINT", () => {
  console.log("\n[SIGINT] Stopping bot...");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  console.log("\n[SIGTERM] Stopping bot...");
  bot.stop("SIGTERM");
});

// Start the bot
startBot();


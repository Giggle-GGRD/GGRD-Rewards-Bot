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

async function connectToMongoDB() {
  try {
    console.log("[LOADING] Connecting to MongoDB...");
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    db = client.db("ggrd_bot");
    membersCollection = db.collection("members");
    
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

// === COMMANDS & HANDLERS ===

// Commands FIRST - they must be registered before bot.on("text")

bot.start(async (ctx) => {
  console.log(`[START] /start from user ${ctx.from.id}`);
  
  const startMessage =
    "Welcome to the *GGRD Community Rewards Bot*\n\n" +
    "This bot helps you complete and verify community tasks so you can join future *GGRD* airdrops and raffles.\n\n" +
    "*How it works (3 simple steps):*\n" +
    "1. Join the official channel - " + CHANNEL_ID + "\n" +
    "2. Join the community chat - " + GROUP_ID + "\n" +
    "3. Click the button below to verify your tasks\n\n" +
    "Use /tasks to see all available rewards.\n\n" +
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
    message += "[PENDING] Task 3 - Holder 2500+\n";
    message += "  Hold 2,500+ GGRD tokens\n";
    message += "  First 100 holders: 50 GGRD each\n";
    message += "  All holders: Lottery entry (10k pool)\n";
    message += "  Status: Waiting for LP launch\n";
    
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

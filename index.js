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

function isAdmin(userId) {
  return ADMIN_ID && String(userId) === ADMIN_ID;
}

// Track users waiting for wallet
const waitingForWallet = new Set();

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

// Text handler for wallet input - MUST be registered AFTER commands
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = (ctx.message.text || "").trim();

  // Ignore commands - they are handled above
  if (text.startsWith("/")) {
    console.log(`[SKIP] Ignoring command in text handler: ${text}`);
    return;
  }

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

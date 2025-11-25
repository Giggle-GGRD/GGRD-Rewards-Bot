require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { MongoClient } = require("mongodb");

// === CONFIGURATION ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const GROUP_ID = process.env.GROUP_ID;
const ADMIN_ID = process.env.ADMIN_ID ? String(process.env.ADMIN_ID) : null;
const MONGODB_URI = process.env.MONGODB_URI;

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
    const result = await membersCollection.updateOne(
      { telegram_id: id },
      { 
        $set: { 
          ...record,
          telegram_id: id,
          updated_at: new Date()
        }
      },
      { upsert: true }
    );
    
    if (result.upsertedCount > 0) {
      console.log(`[+] Added new member ${id}`);
    } else if (result.modifiedCount > 0) {
      console.log(`[UPDATE] Updated member ${id}`);
    }
    
    return result;
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
    "*How it works (4 simple steps):*\n" +
    "1. Join the official channel - @GGRDofficial\n" +
    "2. Join the community chat - @GGRDchat\n" +
    "3. Click the button below to verify your tasks\n" +
    "4. Send your Solana wallet address for rewards\n\n" +
    "You can always check your status with /me or /profile.\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  await ctx.reply(startMessage, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [
        Markup.button.url("Official Channel", "https://t.me/GGRDofficial"),
        Markup.button.url("Community Chat", "https://t.me/GGRDchat")
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
    "- Verify if you joined @GGRDofficial and @GGRDchat\n" +
    "- Register your Solana wallet address for GGRD rewards\n" +
    "- Check your status with /me or /profile\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  ctx.reply(msg, { parse_mode: "Markdown" });
});

// Command: /me and /profile - show user status
bot.command(["me", "profile"], async (ctx) => {
  const userId = ctx.from.id;
  console.log(`[PROFILE] Command from user ${userId}`);
  
  try {
    const member = await getMember(userId);

    if (!member) {
      const count = await membersCollection.countDocuments();
      console.log(`[NOT FOUND] User ${userId} not found in database (DB has ${count} members)`);
      return ctx.reply(
        "No data found for your account.\n\n" +
          "Use /start and press the verify button to register."
      );
    }

    console.log(`[OK] Found member: ${JSON.stringify(member)}`);

    const fullName = ((member.first_name || "") + " " + (member.last_name || "")).trim();

    const statusMessage =
      "Your GGRD Community Rewards profile:\n\n" +
      "Telegram ID: " + member.telegram_id + "\n" +
      "Username: " + (member.telegram_username ? "@" + member.telegram_username : "not set") + "\n" +
      "Name: " + (fullName || "not set") + "\n\n" +
      "Channel member: " + (member.in_channel ? "YES" : "NO") + "\n" +
      "Group member: " + (member.in_group ? "YES" : "NO") + "\n\n" +
      "Wallet address: " + (member.wallet_address || "NOT SET");

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

  if (ADMIN_ID && fromId !== ADMIN_ID) {
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
      "1. Join the channel: @GGRDofficial\n" +
      "2. Join the group: @GGRDchat\n" +
      "3. Click the button again to verify";

    return ctx.editMessageText(errorMessage, { parse_mode: "Markdown" });
  }

  await upsertMember(userId, {
    telegram_username: username,
    first_name: firstName,
    last_name: lastName,
    in_channel: inChannel,
    in_group: inGroup
  });

  const member = await getMember(userId);

  if (member && member.wallet_address) {
    console.log(`[OK] User ${userId} already has wallet registered`);
    const msg =
      "You're already verified!\n\n" +
      "Your wallet for GGRD Community Rewards is:\n" +
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

  const msg =
    "All set!\n\n" +
    "Your wallet has been registered for *GGRD Community Rewards*.\n\n" +
    "You can check your status anytime with /me or /profile.";

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

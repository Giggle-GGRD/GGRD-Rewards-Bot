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
  console.error("❌ Missing BOT_TOKEN, CHANNEL_ID or GROUP_ID in environment.");
  process.exit(1);
}

if (!MONGODB_URI) {
  console.error("❌ Missing MONGODB_URI in environment.");
  console.error("💡 Add your MongoDB connection string to environment variables.");
  process.exit(1);
}

// === MONGODB CONNECTION ===
let db;
let membersCollection;

async function connectToMongoDB() {
  try {
    console.log("🔄 Connecting to MongoDB...");
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    db = client.db("ggrd_bot");
    membersCollection = db.collection("members");
    
    console.log("✅ Connected to MongoDB successfully!");
    
    // Create index on telegram_id for faster queries
    await membersCollection.createIndex({ telegram_id: 1 }, { unique: true });
    
    const count = await membersCollection.countDocuments();
    console.log(`📊 Current members in database: ${count}`);
    
    return client;
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error.message);
    console.error("💡 Check your MONGODB_URI in environment variables.");
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
      console.log(`➕ Added new member ${id}`);
    } else if (result.modifiedCount > 0) {
      console.log(`🔄 Updated member ${id}`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Error upserting member ${telegramId}:`, error.message);
    throw error;
  }
}

async function getMember(telegramId) {
  try {
    const id = String(telegramId);
    const member = await membersCollection.findOne({ telegram_id: id });
    return member;
  } catch (error) {
    console.error(`❌ Error getting member ${telegramId}:`, error.message);
    return null;
  }
}

async function getAllMembers() {
  try {
    return await membersCollection.find({}).toArray();
  } catch (error) {
    console.error("❌ Error getting all members:", error.message);
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
    console.error(`❌ Error checking membership in ${chatId}:`, error.message);
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

bot.start(async (ctx) => {
  console.log(`🆕 /start from user ${ctx.from.id}`);
  
  const startMessage =
    "Welcome to the *GGRD Community Rewards Bot* 🏹\n\n" +
    "This bot helps you complete and verify community tasks so you can join future *GGRD* airdrops and raffles.\n\n" +
    "*How it works (4 simple steps):*\n" +
    "1️⃣ Join the official channel – @GGRDofficial\n" +
    "2️⃣ Join the community chat – @GGRDchat\n" +
    "3️⃣ Click "✅ Verify my tasks" below\n" +
    "4️⃣ Send your Solana wallet address for rewards\n\n" +
    "You can always check your status with /me.\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  await ctx.reply(startMessage, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [
        Markup.button.url("📢 Official Channel", "https://t.me/GGRDofficial"),
        Markup.button.url("💬 Community Chat", "https://t.me/GGRDchat")
      ],
      [Markup.button.callback("✅ Verify my tasks", "verify_tasks")]
    ])
  });
});

bot.help((ctx) => {
  console.log(`❓ /help from user ${ctx.from.id}`);
  
  const msg =
    "This is the official *GGRD Community Rewards Bot* 🏹\n\n" +
    "What you can do here:\n" +
    "• Verify if you joined @GGRDofficial and @GGRDchat\n" +
    "• Register your Solana wallet address for GGRD rewards\n" +
    "• Check your status with /me\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.action("verify_tasks", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const username = ctx.from.username || null;
  const firstName = ctx.from.first_name || null;
  const lastName = ctx.from.last_name || null;

  console.log(`🔍 verify_tasks from user ${userId}`);

  const inChannel = await isUserMember(ctx, CHANNEL_ID, userId);
  const inGroup = await isUserMember(ctx, GROUP_ID, userId);

  console.log(`📊 User ${userId}: channel=${inChannel}, group=${inGroup}`);

  if (!inChannel || !inGroup) {
    const missing = [];
    if (!inChannel) missing.push(`• Channel: ${CHANNEL_ID}`);
    if (!inGroup) missing.push(`• Group: ${GROUP_ID}`);

    console.log(`❌ User ${userId} verification failed: ${missing.join(', ')}`);

    const errorMessage =
      "❌ *Verification failed*\n\n" +
      "You need to join the following chats to participate in rewards:\n\n" +
      missing.join("\n") +
      "\n\n" +
      "*Please:*\n" +
      "1️⃣ Join the channel: @GGRDofficial\n" +
      "2️⃣ Join the group: @GGRDchat\n" +
      "3️⃣ Click the "✅ Verify my tasks" button again";

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
    console.log(`✅ User ${userId} already has wallet registered`);
    const msg =
      "✅ You're already verified!\n\n" +
      "Your wallet for GGRD Community Rewards is:\n" +
      member.wallet_address +
      "\n\nUse /me to see your full profile.";
    return ctx.editMessageText(msg);
  }

  waitingForWallet.add(userId);
  console.log(`⏳ User ${userId} added to waitingForWallet`);

  const walletRequestMessage =
    "✅ *Verification successful!*\n\n" +
    "You are now a verified member of the GGRD community.\n\n" +
    "*Next step:* please send your Solana wallet address.\n\n" +
    "⚠️ *Important:*\n" +
    "• Send ONLY your wallet address (32–44 characters)\n" +
    "• Make sure it's correct – you can't change it later\n" +
    "• This address will be used for reward distributions\n\n" +
    "💡 Example:\nFz2w9g...x9a";

  ctx.editMessageText(walletRequestMessage, { parse_mode: "Markdown" });
});

bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;

  if (!waitingForWallet.has(userId)) {
    return;
  }

  console.log(`💰 Received potential wallet from user ${userId}: ${text.substring(0, 10)}...`);

  if (!isValidSolanaAddress(text)) {
    console.log(`❌ Invalid wallet format from user ${userId}`);
    return ctx.reply(
      "❌ This does not look like a valid Solana wallet address.\n\n" +
        "Please send a correct Solana address (base58, 32–44 characters)."
    );
  }

  await upsertMember(userId, {
    wallet_address: text
  });

  waitingForWallet.delete(userId);

  const msg =
    "🎉 All set!\n\n" +
    "Your wallet has been registered for *GGRD Community Rewards*.\n\n" +
    "You can check your status anytime with /me.";

  ctx.reply(msg, { parse_mode: "Markdown" });

  console.log(`✅ Wallet registered for user ${userId}: ${text}`);
});

bot.command("me", async (ctx) => {
  const userId = ctx.from.id;
  console.log(`🔍 [/me] User ${userId} requested profile`);
  
  const member = await getMember(userId);

  if (!member) {
    const count = await membersCollection.countDocuments();
    console.log(`❌ [/me] User ${userId} not found in database (DB has ${count} members)`);
    return ctx.reply(
      "No data found for your account.\n\n" +
        "Use /start and press \"✅ Verify my tasks\" to register."
    );
  }

  console.log(`✅ [/me] Found member: ${JSON.stringify(member)}`);

  const fullName = ((member.first_name || "") + " " + (member.last_name || "")).trim();

  const statusMessage =
    "Your GGRD Community Rewards profile:\n\n" +
    "Telegram ID: " + member.telegram_id + "\n" +
    "Username: " + (member.telegram_username ? "@" + member.telegram_username : "not set") + "\n" +
    "Name: " + (fullName || "not set") + "\n\n" +
    "Channel member: " + (member.in_channel ? "YES" : "NO") + "\n" +
    "Group member: " + (member.in_group ? "YES" : "NO") + "\n\n" +
    "Wallet address: " + (member.wallet_address || "NOT SET");

  ctx.reply(statusMessage)
    .then(() => {
      console.log(`✅ [/me] Profile sent successfully to user ${userId}`);
    })
    .catch((error) => {
      console.error(`❌ [/me] Error sending profile to user ${userId}:`, error.message);
      ctx.reply("❌ Error displaying profile. Please try /start again.");
    });
});

bot.command("export", async (ctx) => {
  const fromId = String(ctx.from.id);
  console.log(`📤 [/export] Request from user ${fromId}`);

  if (ADMIN_ID && fromId !== ADMIN_ID) {
    console.log(`❌ [/export] Unauthorized access attempt by user ${fromId}`);
    return ctx.reply("❌ You are not allowed to use this command.");
  }

  try {
    const members = await getAllMembers();
    
    if (members.length === 0) {
      console.log(`❌ [/export] No members in database`);
      return ctx.reply("❌ No members in database.");
    }

    const jsonData = JSON.stringify(members, null, 2);
    const buffer = Buffer.from(jsonData, 'utf-8');

    await ctx.replyWithDocument({
      source: buffer,
      filename: `ggrd_members_${new Date().toISOString().split('T')[0]}.json`
    }, {
      caption: `📊 GGRD Members Export\nTotal members: ${members.length}\nDate: ${new Date().toLocaleDateString()}`
    });

    console.log(`✅ [/export] Database exported successfully to ${fromId} (${members.length} members)`);
  } catch (err) {
    console.error(`❌ [/export] Failed to export:`, err.message);
    ctx.reply("❌ Failed to export database. Check server logs.");
  }
});

// === START BOT ===
async function startBot() {
  try {
    // Connect to MongoDB first
    await connectToMongoDB();
    
    // Then launch bot
    await bot.launch();
    
    console.log("✅ Connected to Telegram!");
    console.log("🤖 GGRD Community Rewards Bot started successfully!");
    console.log(`📢 Monitoring channel: ${CHANNEL_ID}`);
    console.log(`💬 Monitoring group: ${GROUP_ID}`);
    
    const count = await membersCollection.countDocuments();
    console.log(`📊 Current members in database: ${count}`);
  } catch (error) {
    console.error("\n❌ Failed to start bot:", error.message);
    console.error("💡 Check BOT_TOKEN, MONGODB_URI and internet connection.");
    process.exit(1);
  }
}

// Graceful stop
process.once("SIGINT", () => {
  console.log("\n⚠️ SIGINT received, stopping bot...");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  console.log("\n⚠️ SIGTERM received, stopping bot...");
  bot.stop("SIGTERM");
});

// Start the bot
startBot();

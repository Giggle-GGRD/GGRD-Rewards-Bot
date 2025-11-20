require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const GROUP_ID = process.env.GROUP_ID;
const DB_FILE = path.join(__dirname, "ggrd_members.json");

if (!BOT_TOKEN || !CHANNEL_ID || !GROUP_ID) {
  console.error("❌ Missing required environment variables in .env file");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// In-memory database
let members = [];

// Set of users waiting for wallet address
const waitingForWallet = new Set();

// Load database from file
function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf8");
      members = JSON.parse(data);
      console.log(`✅ Loaded database, ${members.length} members`);
      return members;
    } else {
      members = [];
      console.log("✅ Created new empty database");
      return members;
    }
  } catch (error) {
    console.error("❌ Error loading database:", error.message);
    members = [];
    console.log("✅ Created new empty database");
    return members;
  }
}

// Save database to file
function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(members, null, 2), "utf8");
  } catch (error) {
    console.error("❌ Error saving database:", error.message);
  }
}

// Upsert member record
function upsertMember(record) {
  const index = members.findIndex(m => m.telegram_id === record.telegram_id);
  
  if (index !== -1) {
    members[index] = { ...members[index], ...record };
  } else {
    members.push(record);
  }
  
  saveDb();
}

// Get member by telegram_id
function getMember(telegramId) {
  return members.find(m => m.telegram_id === telegramId);
}

// Check if user is member of a chat
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

// Validate Solana wallet address
function isValidSolanaAddress(address) {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address.trim());
}

// Command: /start
bot.start((ctx) => {
  const welcomeMessage = 
    "🎉 **Welcome to GGRD Community Rewards Bot!**\n\n" +
    "This bot will verify your participation in the GGRD community and record your Solana wallet address for rewards distribution.\n\n" +
    "**How it works:**\n" +
    "1️⃣ Click the button below to verify your tasks\n" +
    "2️⃣ Make sure you're a member of our channel and group\n" +
    "3️⃣ Provide your Solana wallet address\n" +
    "4️⃣ Done! You're registered for rewards\n\n" +
    "Click the button below to get started! 👇";

  ctx.replyWithMarkdown(
    welcomeMessage,
    Markup.inlineKeyboard([
      [
        Markup.button.url("📢 Join Channel", "https://t.me/GGRDofficial"),
        Markup.button.url("💬 Join Group", "https://t.me/GGRDchat")
      ],
      [
        Markup.button.callback("✅ Zweryfikuj moje zadania", "verify_tasks")
      ]
    ])
  );
});

// Action: verify_tasks
bot.action("verify_tasks", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const username = ctx.from.username || null;
  const firstName = ctx.from.first_name || null;
  const lastName = ctx.from.last_name || null;

  const inChannel = await isUserMember(ctx, CHANNEL_ID, userId);
  const inGroup = await isUserMember(ctx, GROUP_ID, userId);

  if (!inChannel || !inGroup) {
    const missingChats = [];
    if (!inChannel) missingChats.push(`Channel: ${CHANNEL_ID}`);
    if (!inGroup) missingChats.push(`Group: ${GROUP_ID}`);

    const errorMessage =
      "❌ **Verification Failed**\n\n" +
      "You need to join the following chats to participate in rewards:\n\n" +
      missingChats.map(chat => `• ${chat}`).join("\n") + "\n\n" +
      "**Please:**\n" +
      "1️⃣ Join the channel: " + CHANNEL_ID + "\n" +
      "2️⃣ Join the group: " + GROUP_ID + "\n" +
      "3️⃣ Click 'Verify my tasks' button again\n\n" +
      "👇 Click below to verify again after joining:";

    return ctx.editMessageText(
      errorMessage,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.url("📢 Join Channel", "https://t.me/GGRDofficial"),
            Markup.button.url("💬 Join Group", "https://t.me/GGRDchat")
          ],
          [
            Markup.button.callback("✅ Zweryfikuj moje zadania", "verify_tasks")
          ]
        ])
      }
    );
  }

  upsertMember({
    telegram_id: userId,
    telegram_username: username,
    first_name: firstName,
    last_name: lastName,
    in_channel: true,
    in_group: true
  });

  const member = getMember(userId);
  if (member && member.wallet_address) {
    return ctx.editMessageText(
      "✅ **You're already verified!**\n\n" +
      `💰 Your wallet: \`${member.wallet_address}\`\n\n` +
      "Use /me to see your full profile.",
      { parse_mode: "Markdown" }
    );
  }

  waitingForWallet.add(userId);
  
  const walletRequestMessage =
    "✅ **Verification Successful!**\n\n" +
    "You are a verified member of GGRD community!\n\n" +
    "📝 **Next Step:** Please send your Solana wallet address.\n\n" +
    "⚠️ **Important:**\n" +
    "• Send ONLY your wallet address (32-44 characters)\n" +
    "• Make sure it's correct - you can't change it later\n" +
    "• This address will be used for reward distributions\n\n" +
    "💡 Example format: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`";

  ctx.editMessageText(walletRequestMessage, { parse_mode: "Markdown" });
});

// Handler for text messages (wallet addresses)
bot.on("text", (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) {
    return;
  }

  if (!waitingForWallet.has(userId)) {
    return;
  }

  if (!isValidSolanaAddress(text)) {
    return ctx.reply(
      "❌ **Invalid Solana address format!**\n\n" +
      "Please send a valid Solana wallet address (32-44 Base58 characters).\n\n" +
      "💡 Example: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`",
      { parse_mode: "Markdown" }
    );
  }

  upsertMember({
    telegram_id: userId,
    wallet_address: text
  });

  waitingForWallet.delete(userId);

  const confirmationMessage =
    "✅ **Wallet Address Saved!**\n\n" +
    "Your Solana wallet has been successfully registered in the GGRD rewards program.\n\n" +
    `💰 Wallet: \`${text}\`\n\n` +
    "🎉 You're all set! Use /me to view your complete profile.\n\n" +
    "Thank you for being part of the GGRD community! 🚀";

  ctx.replyWithMarkdown(confirmationMessage);

  console.log(`✅ Wallet registered for user ${userId}: ${text}`);
});

// Command: /me
bot.command("me", (ctx) => {
  const userId = ctx.from.id;
  const member = getMember(userId);

  if (!member) {
    return ctx.reply(
      "❌ No data found. Please use /start and click 'Verify my tasks' button to register."
    );
  }

  const statusMessage =
    "📋 **Your GGRD Profile**\n\n" +
    `🆔 Telegram ID: \`${member.telegram_id}\`\n` +
    `👤 Username: ${member.telegram_username ? "@" + member.telegram_username : "not set"}\n` +
    `📛 Name: ${member.first_name || ""} ${member.last_name || ""}\n\n` +
    `📢 Channel Member: ${member.in_channel ? "✅ Yes" : "❌ No"}\n` +
    `💬 Group Member: ${member.in_group ? "✅ Yes" : "❌ No"}\n\n` +
    `💰 Wallet Address: ${member.wallet_address ? `\`${member.wallet_address}\`` : "❌ Not set"}`;

  ctx.replyWithMarkdown(statusMessage);
});

// Command: /export
bot.command("export", async (ctx) => {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return ctx.reply("❌ Database file not found.");
    }

    await ctx.replyWithDocument(
      { source: DB_FILE, filename: "ggrd_members.json" },
      { caption: `📊 GGRD Members Database\nTotal members: ${members.length}` }
    );
  } catch (error) {
    console.error("❌ Error sending export file:", error);
    ctx.reply("❌ Error exporting database. Please try again.");
  }
});

// Load database on startup
loadDb();

// Launch bot
console.log("⏳ Connecting to Telegram API...");
bot.launch()
  .then(() => {
    console.log("✅ Connected to Telegram!");
    console.log("🤖 GGRD Community Rewards Bot started successfully!");
    console.log(`📢 Monitoring channel: ${CHANNEL_ID}`);
    console.log(`💬 Monitoring group: ${GROUP_ID}`);
    console.log(`📊 Current members in database: ${members.length}`);
  })
  .catch((error) => {
    console.error("\n❌ Failed to start bot:");
    console.error("Error:", error.message);
    console.error("\n💡 Possible reasons:");
    console.error("   1. Invalid BOT_TOKEN in .env file");
    console.error("   2. No internet connection");
    console.error("   3. Bot already running in another process");
    console.error("   4. Telegram API is down");
    console.error("\n🔧 Try:");
    console.error("   - Check token in @BotFather with /mybots");
    console.error("   - Run: Stop-Process -Name node -Force");
    console.error("   - Then restart: node index.js");
    process.exit(1);
  });

// Graceful stop
process.once("SIGINT", () => {
  console.log("\n⚠️ SIGINT received, stopping bot...");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  console.log("\n⚠️ SIGTERM received, stopping bot...");
  bot.stop("SIGTERM");
});

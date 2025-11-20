require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

// === CONFIGURATION ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; // e.g. @GGRDofficial
const GROUP_ID = process.env.GROUP_ID;     // e.g. @GGRDchat
const DB_FILE = path.join(__dirname, "ggrd_members.json");

// Optional – tylko admin może /export, jeśli ustawisz ADMIN_ID w .env
const ADMIN_ID = process.env.ADMIN_ID ? String(process.env.ADMIN_ID) : null;

if (!BOT_TOKEN || !CHANNEL_ID || !GROUP_ID) {
  console.error("❌ Missing required environment variables in .env file");
  process.exit(1);
}

// === DATABASE HANDLING ===
let members = [];

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      members = JSON.parse(raw);
      if (!Array.isArray(members)) members = [];
    } else {
      members = [];
    }
  } catch (err) {
    console.error("❌ Failed to load database:", err.message);
    members = [];
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(members, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Failed to save database:", err.message);
  }
}

function upsertMember(telegramId, record) {
  const id = String(telegramId);
  const index = members.findIndex((m) => String(m.telegram_id) === id);

  if (index !== -1) {
    members[index] = { ...members[index], ...record };
  } else {
    members.push({ telegram_id: id, ...record });
  }
  saveDb();
}

function getMember(telegramId) {
  const id = String(telegramId);
  return members.find((m) => String(m.telegram_id) === id) || null;
}

// === HELPERS ===

// Sprawdzenie członkostwa w kanale / grupie
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

// Walidacja adresu Solana
function isValidSolanaAddress(address) {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

// Zbiór użytkowników, od których czekamy na adres portfela
const waitingForWallet = new Set();

// === BOT INIT ===
const bot = new Telegraf(BOT_TOKEN);

loadDb();
console.log(`📊 Loaded members: ${members.length}`);

// === COMMANDS & HANDLERS ===

// /start – ekran główny
bot.start(async (ctx) => {
  const startMessage =
    "Welcome to the *GGRD Community Rewards Bot* 🏹\n\n" +
    "This bot helps you complete and verify community tasks so you can join future *GGRD* airdrops and raffles.\n\n" +
    "*How it works (4 simple steps):*\n" +
    "1️⃣ Join the official channel – @GGRDofficial\n" +
    "2️⃣ Join the community chat – @GGRDchat\n" +
    "3️⃣ Click “✅ Verify my tasks” below\n" +
    "4️⃣ Send your Solana wallet address for rewards\n\n" +
    "You can always check your status with /me.\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  await ctx.reply(startMessage, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [
        Markup.button.url("📢 Official Channel", "https://t.me/GGRDofficial"),
        Markup.button.url("💬 Community Chat", "https://t.me/GGRDchat"),
      ],
      [Markup.button.callback("✅ Verify my tasks", "verify_tasks")],
    ]),
  });
});

// /help – krótka pomoc
bot.help((ctx) => {
  const msg =
    "This is the official *GGRD Community Rewards Bot* 🏹\n\n" +
    "What you can do here:\n" +
    "• Verify if you joined @GGRDofficial and @GGRDchat\n" +
    "• Register your Solana wallet address for GGRD rewards\n" +
    "• Check your status with /me\n\n" +
    "10% of total GGRD supply is reserved for charity supporting war victims in Ukraine.\n\n" +
    "_High-risk Solana meme experiment. Not financial advice._";

  ctx.replyWithMarkdown(msg);
});

// ACTION: verify_tasks – weryfikacja kanału/grupy
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
    if (!inChannel) missingChats.push(`• Channel: ${CHANNEL_ID}`);
    if (!inGroup) missingChats.push(`• Group: ${GROUP_ID}`);

    const errorMessage =
      "❌ *Verification failed*\n\n" +
      "You need to join the following chats to participate in rewards:\n\n" +
      missingChats.join("\n") +
      "\n\n" +
      "*Please:*\n" +
      "1️⃣ Join the channel: @GGRDofficial\n" +
      "2️⃣ Join the group: @GGRDchat\n" +
      "3️⃣ Click the “✅ Verify my tasks” button again";

    return ctx.editMessageText(errorMessage, { parse_mode: "Markdown" });
  }

  // Zapisz/aktualizuj użytkownika – etap weryfikacji TG
  upsertMember(userId, {
    telegram_username: username,
    first_name: firstName,
    last_name: lastName,
    in_channel: inChannel,
    in_group: inGroup,
  });

  const member = getMember(userId);

  // Jeśli portfel już jest zapisany – nie prosimy ponownie
  if (member && member.wallet_address) {
    const msg =
      "✅ *You're already verified!*\n\n" +
      `💰 Your wallet: \`${member.wallet_address}\`\n\n` +
      "Use /me to see your full profile.";
    return ctx.editMessageText(msg, { parse_mode: "Markdown" });
  }

  // Oczekujemy na adres portfela
  waitingForWallet.add(userId);

  const walletRequestMessage =
    "✅ *Verification successful!*\n\n" +
    "You are now a verified member of the GGRD community.\n\n" +
    "*Next step:* please send your Solana wallet address.\n\n" +
    "⚠️ *Important:*\n" +
    "• Send ONLY your wallet address (32–44 characters)\n" +
    "• Make sure it’s correct – you can’t change it later\n" +
    "• This address will be used for reward distributions\n\n" +
    "💡 Example:\n`Fz2w9g...x9a`";

  ctx.editMessageText(walletRequestMessage, { parse_mode: "Markdown" });
});

// Obsługa wiadomości tekstowych – zapis portfela
bot.on("text", (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Komendy obsługuje Telegraf osobno
  if (text.startsWith("/")) return;

  if (!waitingForWallet.has(userId)) {
    // Użytkownik nie jest w trybie podawania portfela – ignorujemy
    return;
  }

  if (!isValidSolanaAddress(text)) {
    return ctx.reply(
      "❌ This does not look like a valid Solana wallet address.\n\n" +
        "Please send a correct Solana address (base58, 32–44 characters)."
    );
  }

  upsertMember(userId, {
    wallet_address: text,
    updated_at: new Date().toISOString(),
  });

  waitingForWallet.delete(userId);

  ctx.reply(
    "🎉 All set!\n\n" +
      "Your wallet has been registered for *GGRD Community Rewards*.\n\n" +
      "You can check your status anytime with /me.",
    { parse_mode: "Markdown" }
  );

  console.log(`✅ Wallet registered for user ${userId}: ${text}`);
});

// /me – status użytkownika
bot.command("me", (ctx) => {
  const userId = ctx.from.id;
  const member = getMember(userId);

  if (!member) {
    return ctx.reply(
      "❌ No data found. Please use /start and click “✅ Verify my tasks” to register."
    );
  }

  const statusMessage =
    "📋 *Your GGRD Profile*\n\n" +
    `🆔 Telegram ID: \`${member.telegram_id}\`\n` +
    `👤 Username: ${
      member.telegram_username ? "@" + member.telegram_username : "not set"
    }\n` +
    `📛 Name: ${(member.first_name || "") + " " + (member.last_name || "")}\n\n` +
    `📢 Channel member: ${member.in_channel ? "✅ Yes" : "❌ No"}\n` +
    `💬 Group member: ${member.in_group ? "✅ Yes" : "❌ No"}\n\n` +
    `💰 Wallet address: ${
      member.wallet_address ? "`" + member.wallet_address + "`" : "❌ Not set"
    }`;

  ctx.replyWithMarkdown(statusMessage);
});

// /export – eksport bazy (dla admina)
bot.command("export", async (ctx) => {
  const fromId = String(ctx.from.id);

  if (ADMIN_ID && fromId !== ADMIN_ID) {
    return ctx.reply("❌ You are not allowed to use this command.");
  }

  try {
    if (!fs.existsSync(DB_FILE)) {
      return ctx.reply("❌ No database file found.");
    }

    await ctx.replyWithDocument({
      source: DB_FILE,
      filename: "ggrd_members.json",
    });

    console.log(`📤 Export sent to ${fromId}`);
  } catch (err) {
    console.error("❌ Failed to export database:", err.message);
    ctx.reply("❌ Failed to export database. Check server logs.");
  }
});

// === START BOT ===
bot
  .launch()
  .then(() => {
    console.log("✅ Connected to Telegram!");
    console.log("🤖 GGRD Community Rewards Bot started successfully!");
    console.log(`📢 Monitoring channel: ${CHANNEL_ID}`);
    console.log(`💬 Monitoring group: ${GROUP_ID}`);
    console.log(`📊 Current members in database: ${members.length}`);
  })
  .catch((error) => {
    console.error("\n❌ Failed to start bot:", error.message);
    console.error(
      "💡 Check BOT_TOKEN, internet connection and whether the bot is not running in another process."
    );
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

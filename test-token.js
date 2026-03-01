require("dotenv").config();
const https = require("https");

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN not found in .env");
  process.exit(1);
}

console.log("🔍 Testing bot token...");
console.log(`Token: ${BOT_TOKEN.substring(0, 10)}...${BOT_TOKEN.substring(BOT_TOKEN.length - 10)}`);

const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;

https.get(url, (res) => {
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const response = JSON.parse(data);
      
      if (response.ok) {
        console.log("\n✅ Token is VALID!");
        console.log(`🤖 Bot name: ${response.result.username}`);
        console.log(`📛 Bot ID: ${response.result.id}`);
        console.log(`✨ Bot can receive messages: ${response.result.can_read_all_group_messages || false}`);
        console.log("\n🎉 You can now run: node index.js");
      } else {
        console.log("\n❌ Token is INVALID!");
        console.log(`Error: ${response.description}`);
        console.log("\n🔧 Get new token from @BotFather:");
        console.log("   1. Open @BotFather in Telegram");
        console.log("   2. Send: /mybots");
        console.log("   3. Select your bot");
        console.log("   4. API Token → Copy token");
        console.log("   5. Paste in .env file");
      }
    } catch (error) {
      console.error("\n❌ Error parsing response:", error.message);
    }
  });
}).on("error", (error) => {
  console.error("\n❌ Network error:", error.message);
  console.error("\n💡 Check your internet connection");
});

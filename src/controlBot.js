const TelegramBot = require("node-telegram-bot-api");
const EventEmitter = require("events");
const config = require("./config");
const store = require("./store");

const COOLDOWN_OPTIONS = [
  { label: "1 daqiqa ⏱", seconds: 60 },
  { label: "2 daqiqa ⏱", seconds: 120 },
  { label: "3 daqiqa ⏱", seconds: 180 },
  { label: "4 daqiqa ⏱", seconds: 240 },
  { label: "5 daqiqa ⏱", seconds: 300 },
  { label: "10 daqiqa ⏱", seconds: 600 },
  { label: "30 daqiqa ⏱", seconds: 1800 },
  { label: "1 soat ⏱", seconds: 3600 },
];

function createControlBot() {
  const bot = new TelegramBot(config.botToken, { polling: true });

  // chatId -> "reply_text" | "reaction_emoji"  (matn kutilayotgan amallar)
  const pending = {};

  // Login oqimi uchun bitta faol so'rovni ushlab turamiz.
  // Bu noto'g'ri joyga ketib qolgan javoblar va promptlar "aralashib" ketishini kamaytiradi.
  let loginRequest = null;
  const ownerEvents = new EventEmitter();

  function isOwner(fromUser) {
    if (!fromUser) return false;
    const settings = store.getSettings();
    if (settings.ownerChatId && fromUser.id === settings.ownerChatId) return true;
    if (config.ownerUsername && fromUser.username === config.ownerUsername) return true;
    return false;
  }

  function mainMenu() {
    const s = store.getSettings();
    const modeLabel = s.mode === "online" ? "🟢 Online" : "🔴 Offline";
    return {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: `🔁 Rejim: ${modeLabel} (bosib o'zgartirish)`, callback_data: "toggle_mode" }],
          [{ text: "✏️ Avto-javob matnini o'zgartirish", callback_data: "edit_reply" }],
          [{ text: "⏱ Kutish vaqti (cooldown)", callback_data: "cooldown_menu" }],
          [{ text: "😀 Reaksiya sozlamalari", callback_data: "reaction_menu" }],
          [{ text: "📊 Holatni ko'rish", callback_data: "status" }],
        ],
      },
    };
  }

  function cooldownMenuMarkup() {
    const rows = [];
    for (let i = 0; i < COOLDOWN_OPTIONS.length; i += 2) {
      const row = [COOLDOWN_OPTIONS[i]];
      if (COOLDOWN_OPTIONS[i + 1]) row.push(COOLDOWN_OPTIONS[i + 1]);
      rows.push(row.map((opt) => ({ text: opt.label, callback_data: `set_cooldown_${opt.seconds}` })));
    }
    rows.push([{ text: "🔂 Faqat 1 marta (online↔offline sikli uchun)", callback_data: "set_cooldown_once" }]);
    rows.push([{ text: "⬅️ Orqaga", callback_data: "back_main" }]);
    return { reply_markup: { inline_keyboard: rows } };
  }

  function reactionMenuMarkup() {
    const s = store.getSettings();
    return {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: s.autoReactEnabled ? "✅ Avto-reaksiya: Yoqilgan" : "❌ Avto-reaksiya: O'chirilgan",
              callback_data: "toggle_react_enabled",
            },
          ],
          [{ text: "🎲 Random reaksiya rejimi", callback_data: "set_reaction_random" }],
          [{ text: "✍️ Doimiy emoji belgilash", callback_data: "set_reaction_custom" }],
          [{ text: "⬅️ Orqaga", callback_data: "back_main" }],
        ],
      },
    };
  }

  function statusText() {
    const s = store.getSettings();
    const cooldownLabel =
      s.cooldownMode === "once"
        ? "Faqat 1 marta (sikl uchun) 🔂"
        : `${Math.round(s.cooldownSeconds / 60)} daqiqa ⏱`;
    const reactionLabel = s.reactionMode === "fixed" ? s.fixedReaction : "🎲 Random";

    return (
      `📊 <b>Joriy sozlamalar</b>\n\n` +
      `🔁 Rejim: ${s.mode === "online" ? "🟢 Online" : "🔴 Offline"}\n` +
      `💬 Avto-javob matni:\n<i>${s.autoReplyText}</i>\n\n` +
      `⏱ Kutish vaqti: ${cooldownLabel}\n` +
      `😀 Avto-reaksiya: ${s.autoReactEnabled ? "✅ Yoqilgan" : "❌ O'chirilgan"} (${reactionLabel})`
    );
  }

  function clearLoginRequest() {
    loginRequest = null;
  }

  // ------------------------------------------------------------------
  // /start
  // ------------------------------------------------------------------
  bot.onText(/\/start/, async (msg) => {
    if (!isOwner(msg.from)) {
      return bot.sendMessage(msg.chat.id, "⛔️ Bu bot faqat o'z egasiga xizmat qiladi.");
    }
    const firstTime = !store.getSettings().ownerChatId;
    if (firstTime) {
      store.saveSettings({ ownerChatId: msg.from.id });
      ownerEvents.emit("owner_ready");
    }
    await bot.sendMessage(
      msg.chat.id,
      "👋 <b>Salom!</b> Men sizning shaxsiy akkauntingizni boshqaruvchi botman 🤖✨\n\n" +
        "Quyidagi menyudan kerakli bo'limni tanlang 👇",
      mainMenu()
    );
  });

  // ------------------------------------------------------------------
  // Inline tugmalar
  // ------------------------------------------------------------------
  bot.on("callback_query", async (query) => {
    if (!isOwner(query.from)) {
      return bot.answerCallbackQuery(query.id, { text: "⛔️ Ruxsat yo'q" });
    }

    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const settings = store.getSettings();

    try {
      if (data === "toggle_mode") {
        const newMode = settings.mode === "online" ? "offline" : "online";
        store.saveSettings({ mode: newMode });
        if (newMode === "offline") store.resetAllCycles();
        await bot.editMessageText(
          `✅ Rejim o'zgartirildi: ${newMode === "online" ? "🟢 Online" : "🔴 Offline"}\n\n📋 Asosiy menyu:`,
          { chat_id: chatId, message_id: messageId, ...mainMenu() }
        );
      } else if (data === "edit_reply") {
        pending[query.from.id] = "reply_text";
        await bot.sendMessage(chatId, "✏️ Yangi avto-javob matnini yuboring 📝👇");
      } else if (data === "cooldown_menu") {
        await bot.editMessageText("⏱ Kutish vaqtini tanlang:", {
          chat_id: chatId,
          message_id: messageId,
          ...cooldownMenuMarkup(),
        });
      } else if (data.startsWith("set_cooldown_")) {
        const value = data.replace("set_cooldown_", "");
        if (value === "once") {
          store.saveSettings({ cooldownMode: "once" });
          store.resetAllCycles();
        } else {
          store.saveSettings({ cooldownMode: "interval", cooldownSeconds: parseInt(value, 10) });
        }
        await bot.editMessageText("✅ Kutish vaqti yangilandi! 🎉\n\n📋 Asosiy menyu:", {
          chat_id: chatId,
          message_id: messageId,
          ...mainMenu(),
        });
      } else if (data === "reaction_menu") {
        await bot.editMessageText("😀 Reaksiya sozlamalari:", {
          chat_id: chatId,
          message_id: messageId,
          ...reactionMenuMarkup(),
        });
      } else if (data === "toggle_react_enabled") {
        store.saveSettings({ autoReactEnabled: !settings.autoReactEnabled });
        await bot.editMessageText("😀 Reaksiya sozlamalari:", {
          chat_id: chatId,
          message_id: messageId,
          ...reactionMenuMarkup(),
        });
      } else if (data === "set_reaction_random") {
        store.saveSettings({ reactionMode: "random" });
        await bot.answerCallbackQuery(query.id, { text: "🎲 Random reaksiya rejimi tanlandi!" });
        await bot.editMessageText("😀 Reaksiya sozlamalari:", {
          chat_id: chatId,
          message_id: messageId,
          ...reactionMenuMarkup(),
        });
      } else if (data === "set_reaction_custom") {
        pending[query.from.id] = "reaction_emoji";
        await bot.sendMessage(chatId, "✍️ Doimiy ishlatiladigan emojini yuboring (masalan: ❤️):");
      } else if (data === "status") {
        await bot.editMessageText(statusText(), {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: mainMenu().reply_markup,
        });
      } else if (data === "back_main") {
        await bot.editMessageText("📋 Asosiy menyu:", {
          chat_id: chatId,
          message_id: messageId,
          ...mainMenu(),
        });
      }
    } catch (err) {
      console.log("⚠️ Callback xatoligi:", err.message);
    }

    bot.answerCallbackQuery(query.id).catch(() => {});
  });

  // ------------------------------------------------------------------
  // Owner'dan kutilayotgan matnli javoblar (login / sozlamalar)
  // ------------------------------------------------------------------
  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;
    if (!isOwner(msg.from)) return;

    // 1️⃣ Login oqimi uchun so'ralgan navbatdagi javob
    if (loginRequest) {
      const resolve = loginRequest.resolve;
      clearLoginRequest();
      resolve(msg.text.trim());
      return;
    }

    // 2️⃣ Oddiy sozlama kutuvlari
    const state = pending[msg.from.id];
    if (!state) return;

    if (state === "reply_text") {
      store.saveSettings({ autoReplyText: msg.text });
      delete pending[msg.from.id];
      await bot.sendMessage(msg.chat.id, "✅ Avto-javob matni muvaffaqiyatli yangilandi! 🎉", mainMenu());
    } else if (state === "reaction_emoji") {
      store.saveSettings({ reactionMode: "fixed", fixedReaction: msg.text.trim() });
      delete pending[msg.from.id];
      await bot.sendMessage(
        msg.chat.id,
        `✅ Doimiy reaksiya o'rnatildi: ${msg.text.trim()} 🎉`,
        mainMenu()
      );
    }
  });

  bot.on("polling_error", (err) => console.log("⚠️ Bot polling xatoligi:", err.message));

  async function notifyOwner(html) {
    const settings = store.getSettings();
    if (!settings.ownerChatId) {
      console.log("ℹ️ Owner hali botga /start bosmagan, bildirishnoma yuborilmadi.");
      return;
    }
    try {
      await bot.sendMessage(settings.ownerChatId, html, { parse_mode: "HTML" });
    } catch (err) {
      console.log("⚠️ Owner'ga xabar yuborishda xatolik:", err.message);
    }
  }

  function askOwner(promptText) {
    return new Promise((resolve, reject) => {
      const settings = store.getSettings();
      if (!settings.ownerChatId) {
        reject(new Error("Owner hali botga /start bosmagan"));
        return;
      }

      if (loginRequest) {
        reject(new Error("Login so'rovi allaqachon faol. Avvalgi prompt yakunlanishini kuting."));
        return;
      }

      loginRequest = { resolve, promptText, startedAt: Date.now() };
      bot.sendMessage(settings.ownerChatId, promptText, { parse_mode: "HTML" }).catch((err) => {
        clearLoginRequest();
        reject(err);
      });
    });
  }

  function waitForOwnerReady() {
    return new Promise((resolve) => {
      if (store.getSettings().ownerChatId) return resolve();
      ownerEvents.once("owner_ready", resolve);
    });
  }

  console.log("🤖 Boshqaruv bot ishga tushdi! Telegramda botingizga /start yozing.");

  return { bot, notifyOwner, askOwner, waitForOwnerReady };
}

module.exports = { createControlBot };

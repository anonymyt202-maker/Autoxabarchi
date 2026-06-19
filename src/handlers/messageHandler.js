const { Api } = require("telegram");
const store = require("../store");

function buildDisplayName(sender) {
  if (!sender) return "Noma'lum 🙈";
  if (sender.username) return `@${sender.username}`;
  const fullName = [sender.firstName, sender.lastName].filter(Boolean).join(" ");
  return fullName || `ID:${sender.id}`;
}

function pickReaction(settings) {
  if (settings.reactionMode === "fixed" && settings.fixedReaction) {
    return settings.fixedReaction;
  }
  const list = store.RANDOM_REACTIONS;
  return list[Math.floor(Math.random() * list.length)];
}

async function sendAutoReaction(client, message) {
  const settings = store.getSettings();
  if (!settings.autoReactEnabled) return;

  try {
    const emoji = pickReaction(settings);
    await client.invoke(
      new Api.messages.SendReaction({
        peer: message.chatId,
        msgId: message.id,
        reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
      })
    );
  } catch (err) {
    console.log("⚠️ Avto-reaksiya yuborishda xatolik:", err.message);
  }
}

function shouldAutoReply(settings, chatId) {
  if (settings.mode !== "offline") return false;

  const state = store.getUserState(chatId);

  if (settings.cooldownMode === "once") {
    // 🔂 Offline davomida shu chat uchun faqat 1 marta javob beriladi
    return !state.repliedThisCycle;
  }

  const cooldownMs = (settings.cooldownSeconds || 300) * 1000;
  const now = Date.now();
  return now - (state.lastReplyAt || 0) >= cooldownMs;
}

async function handleNewMessage(client, event, notifyOwner) {
  const message = event.message;
  if (!message || message.out) return; // 🙅 o'zimiz yuborgan xabarlarni e'tiborsiz qoldiramiz

  const chatId = (event.chatId || message.chatId).toString();
  const sender = await message.getSender().catch(() => null);
  const senderName = buildDisplayName(sender);

  // 🗂 Edit/delete kuzatish uchun xabarni keshga yozamiz
  store.cacheMessage(message.id, {
    chatId,
    text: message.message || "",
    senderId: sender?.id ? sender.id.toString() : null,
    senderName,
    isPrivate: !!event.isPrivate,
    date: message.date,
  });

  // 😀 Avto-reaksiya (barcha xabarlarga, shaxsiy yoki guruh bo'lishidan qat'i nazar)
  await sendAutoReaction(client, message);

  // 💬 Avto-javob faqat shaxsiy xabarlar uchun ishlaydi
  if (!event.isPrivate) return;

  const settings = store.getSettings();
  if (!shouldAutoReply(settings, chatId)) return;

  try {
    await client.sendMessage(message.chatId, { message: settings.autoReplyText });
    store.setUserState(chatId, { lastReplyAt: Date.now(), repliedThisCycle: true });
    console.log(`🤖 Avto-javob yuborildi → ${senderName}`);
  } catch (err) {
    console.log("⚠️ Avto-javob yuborishda xatolik:", err.message);
  }
}

module.exports = { handleNewMessage, buildDisplayName };

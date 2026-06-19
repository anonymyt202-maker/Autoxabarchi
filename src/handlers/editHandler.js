const store = require("../store");
const { buildDisplayName } = require("./messageHandler");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleEditedMessage(event, notifyOwner) {
  const message = event.message;
  if (!message || message.out) return; // o'zimiz tahrirlagan xabarni e'tiborsiz qoldiramiz

  const cached = store.getCachedMessage(message.id);
  const sender = await message.getSender().catch(() => null);
  const senderName = buildDisplayName(sender);

  const newText = message.message || "(matnsiz xabar) 📎";
  const oldText = cached?.text || "(eski matn topilmadi — bot ishga tushgandan keyingi xabarlar saqlanadi) ❔";

  await notifyOwner(
    `✏️ <b>${escapeHtml(senderName)}</b> chatda xabarni tahrirladi!\n\n` +
      `🔻 <b>Oldingi xabar:</b>\n${escapeHtml(oldText)}\n\n` +
      `🔺 <b>Hozirgi xabar:</b>\n${escapeHtml(newText)}`
  );

  // Keshni yangi matn bilan yangilab qo'yamiz (keyingi tahrir/o'chirish uchun)
  store.cacheMessage(message.id, {
    chatId: cached?.chatId || (event.chatId ? event.chatId.toString() : null),
    text: newText,
    senderId: sender?.id ? sender.id.toString() : null,
    senderName,
    isPrivate: !!event.isPrivate,
    date: message.date,
  });
}

module.exports = { handleEditedMessage };

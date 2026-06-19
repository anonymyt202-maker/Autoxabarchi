const store = require("../store");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ⚠️ Eslatma: Telegram shaxsiy/guruh chatlarida o'chirilgan xabar haqida
// qaysi chatga tegishli ekanini yubormaydi (faqat msgId keladi).
// Shu sababli faqat avvaldan bizning keshimizda (cache.json) bor bo'lgan,
// ya'ni bot ishlayotgan vaqtda ko'rgan xabarlar uchun bildirishnoma yuboramiz.
async function handleDeletedMessage(event, notifyOwner) {
  const ids = event.deletedIds || [];

  for (const id of ids) {
    const cached = store.getCachedMessage(id);
    if (!cached) continue; // bizda bu xabar haqida ma'lumot yo'q — o'tkazib yuboramiz

    await notifyOwner(
      `🗑 <b>${escapeHtml(cached.senderName || "Noma'lum")}</b> chatda xabarni o'chirdi!\n\n` +
        `📝 <b>O'chirilgan xabar:</b>\n${escapeHtml(cached.text || "(matnsiz xabar) 📎")}`
    );

    store.deleteCachedMessage(id);
  }
}

module.exports = { handleDeletedMessage };

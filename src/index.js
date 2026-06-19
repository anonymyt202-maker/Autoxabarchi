console.log("🚀 Loyiha ishga tushirilmoqda...\n");

const { createUserClient, events } = require("./userClient");
const { createControlBot } = require("./controlBot");
const { handleNewMessage } = require("./handlers/messageHandler");
const { handleEditedMessage } = require("./handlers/editHandler");
const { handleDeletedMessage } = require("./handlers/deleteHandler");

(async () => {
  try {
    // 1️⃣ Boshqaruv botini ishga tushiramiz (online/offline, sozlamalar, bildirishnomalar, login so'rovlari)
    const { notifyOwner, askOwner, waitForOwnerReady } = createControlBot();

    // 2️⃣ Shaxsiy akkauntga ulanamiz (GramJS / "telegram" npm paketi orqali).
    //    ⚠️ Login terminal orqali EMAS — telefon/kod/parol Telegram bot chatida so'raladi,
    //    shu sababli bu hosting/deploy muhitlarida ham muammosiz ishlaydi.
    const client = await createUserClient({ askOwner, notifyOwner, waitForOwnerReady });

    // 3️⃣ Yangi xabarlar — avto-javob + avto-reaksiya
    client.addEventHandler(
      (event) =>
        handleNewMessage(client, event, notifyOwner).catch((err) =>
          console.log("❌ NewMessage xatoligi:", err.message)
        ),
      new events.NewMessage({})
    );

    // 4️⃣ Tahrirlangan xabarlar — owner'ga bildirishnoma
    client.addEventHandler(
      (event) =>
        handleEditedMessage(event, notifyOwner).catch((err) =>
          console.log("❌ EditedMessage xatoligi:", err.message)
        ),
      new events.EditedMessage({})
    );

    // 5️⃣ O'chirilgan xabarlar — owner'ga bildirishnoma
    client.addEventHandler(
      (event) =>
        handleDeletedMessage(event, notifyOwner).catch((err) =>
          console.log("❌ DeletedMessage xatoligi:", err.message)
        ),
      new events.DeletedMessage({})
    );

    console.log("\n✅ Hammasi tayyor! Bot to'liq ishlayapti 🎉🤖");
    console.log("ℹ️  Boshqaruv uchun Telegramda botingizga /start yuboring.\n");

    process.on("SIGINT", () => {
      console.log("\n👋 Bot to'xtatildi. Xayr!");
      process.exit(0);
    });
  } catch (err) {
    console.error("❌ Ishga tushirishda jiddiy xatolik:", err);
    process.exit(1);
  }
})();

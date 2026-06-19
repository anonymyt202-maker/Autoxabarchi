const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage, EditedMessage, DeletedMessage } = require("telegram/events");

const config = require("./config");
const store = require("./store");

function createTelegramClient(sessionString) {
  return new TelegramClient(new StringSession(sessionString), config.apiId, config.apiHash, {
    connectionRetries: 5,
  });
}

// ⚠️ Bu yerda hech qachon terminal (stdin/"input" paketi) ishlatilmaydi!
// Sabab: hosting/deploy muhitlarida interaktiv konsol bo'lmaydi va bot
// "kod kiriting" deb kutib qolib, deploy xato beradi yoki jarayon osilib qoladi.
// Shu sababli telefon/kod/parol HAMMASI Telegram bot chat orqali so'raladi.

async function createUserClient({ askOwner, notifyOwner, waitForOwnerReady }) {
  // 1️⃣ Avval mavjud sessiyani tekshiramiz: env (SESSION_STRING) > data/session.txt
  let existingSession = config.sessionString || store.loadSession();
  let client = createTelegramClient(existingSession);

  if (existingSession) {
    console.log("🔐 Saqlangan sessiya topildi, login so'ramasdan ulanmoqda...");
    try {
      await client.connect();
      const me = await client.getMe();
      if (me) {
        store.saveSession(client.session.save()); // har doim diskka ham yangilab qo'yamiz
        console.log(`✅ Akkaunt ulandi: ${me.firstName || ""} (@${me.username || "username yo'q"}) 🎉`);
        return client;
      }
    } catch (err) {
      console.log("⚠️ Saqlangan sessiya yaroqsiz ekan, qaytadan login qilish kerak bo'ladi:", err.message);
      try {
        store.saveSession("");
      } catch (_) {}
      existingSession = "";
      client = createTelegramClient("");
    }
  }

  // 2️⃣ Sessiya yo'q/yaroqsiz — endi bot orqali login boshlaymiz.
  // Buning uchun owner kamida bir marta botga /start bosgan bo'lishi kerak
  // (Telegram bot faqat o'ziga /start bosgan foydalanuvchiga birinchi xabarni yuborishi mumkin).
  console.log("⏳ Sessiya topilmadi. Telegramda boshqaruv botiga /start yuborilishini kutmoqdamiz...");
  await waitForOwnerReady();

  await notifyOwner(
    "🔐 <b>Akkauntga ulanish boshlandi!</b>\n\nQuyidagi savollarga shaxsiy akkauntingiz ma'lumotlari bilan javob bering 👇"
  );

  const safeStart = async () => {
    await client.start({
      phoneNumber: async () => await askOwner("📱 Telefon raqamingizni yuboring (masalan: +998901234567):"),
      phoneCode: async () => await askOwner("✉️ Telegramdan SMS/xabar orqali kelgan kodni yuboring:"),
      password: async () => await askOwner("🔑 Akkauntingizning ikki bosqichli (2FA) parolini yuboring:"),
      onError: (err) => console.log("⚠️ Login xatoligi:", err.message || err),
    });
  };

  try {
    await safeStart();
  } catch (err) {
    const msg = String(err?.message || err);
    console.log("❌ Login jarayonida xatolik:", msg);

    // Stale/yarim sessiya qolib ketgan bo'lsa, uni tozalab qayta urinib ko'ramiz.
    if (msg.toLowerCase().includes("session") || msg.toLowerCase().includes("auth")) {
      try {
        store.saveSession("");
      } catch (_) {}
      client = createTelegramClient("");
      await notifyOwner("⚠️ Oldingi sessiya yaroqsiz edi. Login qayta boshlandi — telefon raqam/kodni qayta yuboring.");
      await safeStart();
    } else {
      throw err;
    }
  }

  const sessionString = client.session.save();
  store.saveSession(sessionString);

  const me = await client.getMe();
  console.log(
    `✅ Akkaunt muvaffaqiyatli ulandi: ${me.firstName || ""} ${me.lastName || ""} (@${me.username || "username yo'q"}) 🎉`
  );

  await notifyOwner(
    "✅ <b>Muvaffaqiyatli ulandi!</b> 🎉\n\n" +
      "💾 Quyidagi qiymatni nusxalab, hosting platformangizning <b>Environment Variables</b> bo'limiga " +
      "<b>SESSION_STRING</b> nomi bilan saqlab qo'ying.\n\n" +
      "Shunda fayl tizimi tozalansa ham (qayta deploy qilinganda), bot login so'ramasdan to'g'ridan-to'g'ri ulanadi 👇\n\n" +
      `<code>${sessionString}</code>\n\n` +
      "⚠️ Bu qiymatni hech kim bilan baham ko'rmang — u orqali akkauntingizga to'liq kirish mumkin!"
  );

  return client;
}

module.exports = {
  createUserClient,
  events: { NewMessage, EditedMessage, DeletedMessage },
  Api,
};

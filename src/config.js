require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(`❌ .env faylida "${name}" topilmadi! Iltimos to'ldiring va qayta urinib ko'ring.`);
    process.exit(1);
  }
  return value.trim();
}

const apiId = parseInt(required("API_ID"), 10);
if (Number.isNaN(apiId)) {
  console.error("❌ API_ID raqam bo'lishi kerak!");
  process.exit(1);
}

module.exports = {
  apiId,
  apiHash: required("API_HASH"),
  botToken: required("BOT_TOKEN"),
  ownerUsername: (process.env.OWNER_USERNAME || "").trim().replace(/^@/, ""),
  // 💾 Agar bu to'ldirilgan bo'lsa (masalan hosting Environment Variables'ida),
  // bot hech qachon login so'ramaydi — to'g'ridan-to'g'ri shu sessiya bilan ulanadi.
  // Bo'sh qoldirsangiz, birinchi marta login Telegram bot chat orqali so'raladi
  // va oxirida sizga shu SESSION_STRING qiymati beriladi.
  sessionString: (process.env.SESSION_STRING || "").trim(),
};

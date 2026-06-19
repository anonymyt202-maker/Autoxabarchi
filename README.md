# 🤖 Telegram Avto-javob Userbot

Shaxsiy Telegram akkauntingiz uchun to'liq avtomatlashtirish tizimi: 🟢 online/🔴 offline rejim, avto-javob, avto-reaksiya va xabar tahrirlash/o'chirishni kuzatish.

> ⚠️ **Muhim:** Bu loyiha **`telegram`** npm paketidan (GramJS) foydalanadi, **`gramjs`** paketidan EMAS — chunki npm registrida `gramjs` nomli paket mavjud emas (404 xato beradi). To'g'ri o'rnatish: `npm install telegram`.

## ✨ Imkoniyatlar

- 🟢🔴 **Online / Offline rejim** — boshqaruv boti orqali bir tugma bilan almashtiriladi
- 💬 **Avto-javob** — offline bo'lganda kimdir yozsa, sozlangan matn avtomatik yuboriladi (matnni bot orqali istalgan vaqt tahrirlash mumkin)
- ⏱ **Moslashuvchan kutish vaqti (cooldown)** — 1, 2, 3, 4, 5, 10, 30 daqiqa, 1 soat yoki **"faqat 1 marta"** (har bir online↔offline sikli uchun bir marta) — har bir foydalanuvchi (chat) uchun **alohida** hisoblanadi
- ✏️🗑 **Tahrirlash/o'chirish kuzatuvi** — kimdir xabarini tahrirlasa yoki o'chirsa, sizga botdan "oldingi xabar / hozirgi xabar" bilan bildirishnoma keladi
- 😀 **Avto-reaksiya** — kelgan xabarlarga avtomatik emoji bosiladi (🎲 random yoki ✍️ siz belgilagan doimiy emoji)
- 💾 **Sessiya va foydalanuvchilar saqlanadi** — bir marta login qilsangiz bo'ldi, qayta so'ralmaydi

## 📦 Texnologiyalar

- Node.js
- [`telegram`](https://www.npmjs.com/package/telegram) — GramJS (shaxsiy akkauntga MTProto orqali ulanish uchun)
- [`node-telegram-bot-api`](https://www.npmjs.com/package/node-telegram-bot-api) — boshqaruv boti (Bot API)
- `dotenv`

## 🚀 O'rnatish

### 1-usul: avtomatik skript (tavsiya etiladi)

```bash
bash setup.sh
```

Skript sizdan `API_ID`, `API_HASH`, `BOT_TOKEN` va boshqaruvchi `USERNAME`ni so'raydi, `.env` faylini yaratadi va `npm install` qiladi. Telefon raqam/kod/parol esa keyinroq **bot chatida** so'raladi (pastdagi "Login va deploy" bo'limiga qarang).

### 2-usul: qo'lda

```bash
cp .env.example .env
# .env faylini o'zingizning ma'lumotlaringiz bilan to'ldiring
npm install
npm start
```

## 🔑 Kerakli ma'lumotlar

| O'zgaruvchi      | Qayerdan olinadi                                    |
| ---------------- | ---------------------------------------------------- |
| `API_ID`         | https://my.telegram.org/apps                         |
| `API_HASH`       | https://my.telegram.org/apps                         |
| `BOT_TOKEN`      | [@BotFather](https://t.me/BotFather)                 |
| `OWNER_USERNAME` | Botni boshqaradigan sizning Telegram username'ingiz  |
| `SESSION_STRING` | Ixtiyoriy — pastdagi "Login va deploy" bo'limiga qarang |

## 🔐 Login va deploy (MUHIM)

Bu loyiha login uchun **terminalga (stdin) hech qachon murojaat qilmaydi** — ko'p hosting/deploy platformalarida interaktiv konsol bo'lmaydi va shu sabab eski yondashuv xato berardi. Endi:

1. `npm start` bilan botni ishga tushirasiz (lokal yoki hosting'da).
2. Telegramda boshqaruv botingizga **`/start`** yuborasiz.
3. Agar saqlangan sessiya bo'lmasa, bot sizdan **telefon raqam → SMS kod → (agar bor bo'lsa) 2FA parol**ni xuddi shu bot chatida so'raydi. Terminalda hech narsa kiritilmaydi.
4. Login tugagach, bot sizga **`SESSION_STRING`** qiymatini yuboradi.

### 💾 Doimiy (persistent) deploy uchun tavsiya

Ko'pchilik hosting platformalarida fayl tizimi vaqtinchalik (har deployda tozalanadi). Shu sababli:

- Bot bergan `SESSION_STRING` qiymatini nusxalab oling.
- Hosting platformangizning **Environment Variables** bo'limiga `SESSION_STRING` nomi bilan qo'shing.
- Shundan keyin har qanday qayta deployda bot **hech qachon login so'ramaydi** — to'g'ridan-to'g'ri shu sessiya bilan ulanadi.

> 🔒 `SESSION_STRING` qiymati akkauntingizga to'liq kirish huquqi beradi — uni hech kim bilan baham ko'rmang, faqat o'zingizning hosting platformangiz sozlamalarida saqlang.

## 🎛 Boshqaruv

Telegramda boshqaruv botingizga `/start` yuboring — chiqadigan menyu orqali:

- 🔁 Online ↔ Offline rejimni almashtirish
- ✏️ Avto-javob matnini o'zgartirish (shunchaki yangi matnni botga yozib yuborasiz)
- ⏱ Kutish vaqtini tanlash
- 😀 Reaksiyani random yoki doimiy emojiga sozlash (emojini yuborib belgilaysiz)
- 📊 Joriy sozlamalarni ko'rish

## 📁 Loyiha tuzilmasi

```
telegram-autoreply-bot/
├── setup.sh              # avtomatik o'rnatish skripti
├── package.json
├── .env.example
├── src/
│   ├── index.js          # asosiy ishga tushirish fayli
│   ├── config.js         # .env o'qish
│   ├── store.js          # sozlamalar/sessiya/foydalanuvchilarni saqlash
│   ├── userClient.js     # GramJS klient (shaxsiy akkaunt)
│   ├── controlBot.js     # boshqaruv boti (Bot API)
│   └── handlers/
│       ├── messageHandler.js  # avto-javob + avto-reaksiya
│       ├── editHandler.js     # tahrirlash kuzatuvi
│       └── deleteHandler.js   # o'chirish kuzatuvi
└── data/                 # avtomatik yaratiladi (sessiya, sozlamalar, kesh)
```

## ⚠️ Eslatmalar

- Bu skript shaxsiy akkauntingizni avtomatlashtiradi (userbot). Telegram qoidalariga muvofiq foydalaning va akkauntingizni spam yoki ko'plab avtomatik harakatlar uchun ishlatmang.
- O'chirilgan xabar haqida bildirishnoma faqat bot ishga tushgandan keyin **kelgan va keshga yozilgan** xabarlar uchun ishlaydi — Telegram texnik sabablarga ko'ra eski xabarlarning kontentini qayta yubormaydi.
- `data/` papkasidagi fayllar (sessiya, sozlamalar) maxfiy — `.gitignore` orqali Git'ga tushmaydi.

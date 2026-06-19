#!/usr/bin/env bash
set -e

# 🎨 Ranglar
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "============================================================"
echo "   🤖  TELEGRAM AVTO-JAVOB USERBOT — O'RNATISH SKRIPTI  🤖"
echo "============================================================"
echo -e "${NC}"

# ------------------------------------------------------------------
# 1. Node.js mavjudligini tekshiramiz
# ------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}❌ Node.js topilmadi! Avval Node.js (v18+) o'rnating: https://nodejs.org${NC}"
  exit 1
fi
echo -e "✅ Node.js topildi: $(node -v)"

# ------------------------------------------------------------------
# 2. .env faylini tayyorlaymiz (agar mavjud bo'lmasa)
# ------------------------------------------------------------------
if [ -f ".env" ]; then
  echo -e "${YELLOW}ℹ️  .env fayli allaqachon mavjud, sozlashni o'tkazib yuboramiz.${NC}"
else
  echo ""
  echo -e "${CYAN}📋 Botni ishga tushirish uchun quyidagi ma'lumotlar kerak bo'ladi.${NC}"
  echo -e "${CYAN}   API_ID va API_HASH ni https://my.telegram.org/apps dan olishingiz mumkin.${NC}"
  echo ""

  read -rp "🆔 API_ID: " API_ID
  read -rp "🔑 API_HASH: " API_HASH
  echo ""
  echo -e "${CYAN}🤖 Endi @BotFather dan olingan BOT_TOKEN va botni boshqaradigan${NC}"
  echo -e "${CYAN}   Telegram USERNAME'ingizni kiriting (faqat shu username botni boshqara oladi).${NC}"
  echo ""
  read -rp "👤 Telegram USERNAME (@ belgisiz): " OWNER_USERNAME
  read -rp "🔐 BOT_TOKEN: " BOT_TOKEN

  cat > .env <<EOF2
API_ID=${API_ID}
API_HASH=${API_HASH}
BOT_TOKEN=${BOT_TOKEN}
OWNER_USERNAME=${OWNER_USERNAME}
SESSION_STRING=
EOF2

  echo -e "${GREEN}✅ .env fayli yaratildi!${NC}"
fi

# ------------------------------------------------------------------
# 3. Bog'liqliklarni o'rnatamiz
# ------------------------------------------------------------------
echo ""
echo -e "${CYAN}📦 Paketlar o'rnatilmoqda (npm install)...${NC}"
npm install

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}🎉 O'rnatish yakunlandi!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "▶️  Botni ishga tushirish uchun:   ${YELLOW}npm start${NC}"
echo ""
echo -e "${CYAN}🔐 LOGIN HAQIDA MUHIM:${NC}"
echo -e "   1. ${YELLOW}npm start${NC} buyrug'ini bering."
echo -e "   2. Telegramda boshqaruv botingizga ${YELLOW}/start${NC} yuboring."
echo -e "   3. Telefon raqam, SMS kod va (agar bor bo'lsa) 2FA parol ${YELLOW}botning o'zida${NC} so'raladi —"
echo -e "      terminalda HECH NARSA kiritish kerak emas."
echo -e "   4. Login tugagach, bot sizga ${YELLOW}SESSION_STRING${NC} yuboradi — uni hosting"
echo -e "      platformangizning Environment Variables bo'limiga saqlab qo'ysangiz,"
echo -e "      keyingi deploylarda umuman login so'ralmaydi."
echo ""

read -rp "🚀 Hozir botni ishga tushiramizmi? (ha/yo'q): " RUN_NOW
if [[ "$RUN_NOW" == "ha" || "$RUN_NOW" == "h" || "$RUN_NOW" == "y" || "$RUN_NOW" == "yes" ]]; then
  npm start
else
  echo -e "${CYAN}👍 Tushunarli. Keyin '${YELLOW}npm start${CYAN}' buyrug'i bilan ishga tushirishingiz mumkin.${NC}"
fi

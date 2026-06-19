const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const CACHE_FILE = path.join(DATA_DIR, "cache.json");
const SESSION_FILE = path.join(DATA_DIR, "session.txt");

const DEFAULT_SETTINGS = {
  mode: "online", // "online" | "offline"
  autoReplyText: "Salom! 👋 Hozir band ekanman, tez orada javob beraman ⏳",
  cooldownMode: "interval", // "interval" | "once"
  cooldownSeconds: 300, // 5 daqiqa (faqat cooldownMode === "interval" bo'lsa ishlatiladi)
  autoReactEnabled: true,
  reactionMode: "random", // "random" | "fixed"
  fixedReaction: "❤️",
  ownerChatId: null,
};

// Random reaksiya tanlanganda shu ro'yxatdan biri tasodifiy bosiladi 🎲
const RANDOM_REACTIONS = ["❤️", "🔥", "👍", "😁", "🎉", "🥰", "👏", "😍", "🤩", "💯"];

const MAX_CACHE_SIZE = 800;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`⚠️  ${path.basename(file)} o'qishda xatolik: ${err.message}`);
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// ⚙️ Sozlamalar (settings.json)
// ---------------------------------------------------------------------------
let settingsCache = null;

function getSettings() {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
  }
  return settingsCache;
}

function saveSettings(partial) {
  settingsCache = { ...getSettings(), ...partial };
  writeJson(SETTINGS_FILE, settingsCache);
  return settingsCache;
}

// ---------------------------------------------------------------------------
// 👤 Har bir suhbat (chat) bo'yicha alohida holat (users.json)
// ---------------------------------------------------------------------------
let usersCache = null;

function getUsers() {
  if (!usersCache) usersCache = readJson(USERS_FILE, {});
  return usersCache;
}

function getUserState(chatId) {
  const users = getUsers();
  return users[String(chatId)] || { lastReplyAt: 0, repliedThisCycle: false };
}

function setUserState(chatId, partialState) {
  const users = getUsers();
  const key = String(chatId);
  users[key] = { ...getUserState(chatId), ...partialState };
  writeJson(USERS_FILE, users);
  return users[key];
}

// Online -> Offline o'tganda "faqat 1 marta" siklini hammaga qaytadan ochamiz
function resetAllCycles() {
  const users = getUsers();
  for (const key of Object.keys(users)) {
    users[key].repliedThisCycle = false;
  }
  writeJson(USERS_FILE, users);
}

// ---------------------------------------------------------------------------
// 🗂 Xabarlar keshi — tahrirlash/o'chirishni aniqlash uchun (cache.json)
// ---------------------------------------------------------------------------
let cacheStore = null;

function getCache() {
  if (!cacheStore) cacheStore = readJson(CACHE_FILE, {});
  return cacheStore;
}

function cacheMessage(msgId, data) {
  const cache = getCache();
  cache[String(msgId)] = { ...data, cachedAt: Date.now() };

  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_SIZE) {
    keys
      .sort((a, b) => cache[a].cachedAt - cache[b].cachedAt)
      .slice(0, keys.length - MAX_CACHE_SIZE)
      .forEach((k) => delete cache[k]);
  }
  writeJson(CACHE_FILE, cache);
}

function getCachedMessage(msgId) {
  return getCache()[String(msgId)] || null;
}

function deleteCachedMessage(msgId) {
  const cache = getCache();
  delete cache[String(msgId)];
  writeJson(CACHE_FILE, cache);
}

// ---------------------------------------------------------------------------
// 🔐 Sessiya (session.txt) — login bir marta, keyin avtomatik ulanadi
// ---------------------------------------------------------------------------
function loadSession() {
  ensureDataDir();
  if (!fs.existsSync(SESSION_FILE)) return "";
  return fs.readFileSync(SESSION_FILE, "utf-8").trim();
}

function saveSession(sessionString) {
  ensureDataDir();
  fs.writeFileSync(SESSION_FILE, sessionString || "", "utf-8");
}

module.exports = {
  getSettings,
  saveSettings,
  getUserState,
  setUserState,
  resetAllCycles,
  cacheMessage,
  getCachedMessage,
  deleteCachedMessage,
  loadSession,
  saveSession,
  RANDOM_REACTIONS,
};

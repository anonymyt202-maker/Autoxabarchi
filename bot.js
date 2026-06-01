/**
 * ╔══════════════════════════════════════════════╗
 * ║          MAKER BOT — Marketplace v1.0        ║
 * ║   Telegram Bot Deploy & Marketplace System   ║
 * ╚══════════════════════════════════════════════╝
 *
 * Stack: Node.js · Telegraf · PM2 · JSON · dotenv
 * Author: MAKER BOT System
 */

'use strict';

require('dotenv').config();

const { Telegraf, Markup, session } = require('telegraf');
const fs   = require('fs');
const path = require('path');
const { execSync, exec, spawnSync } = require('child_process');

// ─────────────────────────────────────────────
//  ENV CONFIG
// ─────────────────────────────────────────────
const BOT_TOKEN       = process.env.BOT_TOKEN;
const ADMIN_IDS       = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(Boolean);
const REFERRAL_BONUS  = parseInt(process.env.REFERRAL_BONUS  || '5000');
const DEPLOY_TIMEOUT  = parseInt(process.env.DEPLOY_TIMEOUT  || '60000');   // ms
const RESTART_LIMIT   = parseInt(process.env.RESTART_LIMIT   || '5');
const STORAGE_LIMIT   = parseInt(process.env.STORAGE_LIMIT   || '200');     // MB per user
const RATE_LIMIT_SEC  = parseInt(process.env.RATE_LIMIT_SEC  || '2');       // seconds between msgs
const CHANNEL_ID      = process.env.CHANNEL_ID || null;                     // mandatory sub channel

if (!BOT_TOKEN) { console.error('❌  BOT_TOKEN topilmadi .env faylida!'); process.exit(1); }

// ─────────────────────────────────────────────
//  PATHS
// ─────────────────────────────────────────────
const ROOT        = __dirname;
const DATA_DIR    = path.join(ROOT, 'data');
const TEMPLATES   = path.join(ROOT, 'templates');
const INSTANCES   = path.join(ROOT, 'instances');
const LOGS_DIR    = path.join(ROOT, 'logs');

[DATA_DIR, TEMPLATES, INSTANCES, LOGS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const DB = {
  users    : path.join(DATA_DIR, 'users.json'),
  bots     : path.join(DATA_DIR, 'bots.json'),
  payments : path.join(DATA_DIR, 'payments.json'),
  referrals: path.join(DATA_DIR, 'referrals.json'),
  tickets  : path.join(DATA_DIR, 'tickets.json'),
  settings : path.join(DATA_DIR, 'settings.json'),
};

// ─────────────────────────────────────────────
//  JSON DATABASE HELPERS
// ─────────────────────────────────────────────
function readDB(file) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '{}');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return {}; }
}

function writeDB(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getUser(id) {
  const users = readDB(DB.users);
  return users[id] || null;
}

function saveUser(user) {
  const users = readDB(DB.users);
  users[user.id] = user;
  writeDB(DB.users, users);
}

function ensureUser(ctx) {
  const id = ctx.from.id;
  let user = getUser(id);
  if (!user) {
    user = {
      id,
      username  : ctx.from.username || '',
      firstName : ctx.from.first_name || '',
      balance   : 0,
      botCount  : 0,
      referrer  : null,
      referrals : [],
      joinedAt  : Date.now(),
      blocked   : false,
    };
    saveUser(user);

    // Referral check
    const start = ctx.startPayload;
    if (start && start.startsWith('ref_')) {
      const refId = parseInt(start.replace('ref_', ''));
      if (refId && refId !== id) {
        processReferral(refId, id);
        user.referrer = refId;
        saveUser(user);
      }
    }
  }
  return user;
}

function getSettings() {
  const defaults = {
    stars_price    : 350,   // 1 star = 350 UZS
    referral_bonus : REFERRAL_BONUS,
    min_deposit    : 10000,
    channel_id     : CHANNEL_ID,
    maintenance    : false,
  };
  const s = readDB(DB.settings);
  return { ...defaults, ...s };
}

function saveSettings(data) {
  writeDB(DB.settings, data);
}

// ─────────────────────────────────────────────
//  REFERRAL
// ─────────────────────────────────────────────
function processReferral(referrerId, newUserId) {
  const refs = readDB(DB.referrals);
  if (!refs[referrerId]) refs[referrerId] = [];
  if (refs[referrerId].includes(newUserId)) return;

  refs[referrerId].push(newUserId);
  writeDB(DB.referrals, refs);

  // Bonus to referrer
  const referrer = getUser(referrerId);
  if (referrer) {
    const settings = getSettings();
    referrer.balance += settings.referral_bonus;
    if (!referrer.referrals) referrer.referrals = [];
    referrer.referrals.push(newUserId);
    saveUser(referrer);
  }
}

// ─────────────────────────────────────────────
//  TEMPLATES
// ─────────────────────────────────────────────
function getTemplates() {
  if (!fs.existsSync(TEMPLATES)) return [];
  return fs.readdirSync(TEMPLATES).map(name => {
    const manifestPath = path.join(TEMPLATES, name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return { ...manifest, folder: name };
    } catch { return null; }
  }).filter(Boolean);
}

function getTemplate(folder) {
  const manifestPath = path.join(TEMPLATES, folder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { ...manifest, folder };
  } catch { return null; }
}

// ─────────────────────────────────────────────
//  BOTS DB
// ─────────────────────────────────────────────
function getUserBots(userId) {
  const bots = readDB(DB.bots);
  return Object.values(bots).filter(b => b.userId === userId);
}

function getBot(botId) {
  const bots = readDB(DB.bots);
  return bots[botId] || null;
}

function saveBot(bot) {
  const bots = readDB(DB.bots);
  bots[bot.id] = bot;
  writeDB(DB.bots, bots);
}

function deleteBot(botId) {
  const bots = readDB(DB.bots);
  delete bots[botId];
  writeDB(DB.bots, bots);
}

function generateBotId(userId) {
  const bots = readDB(DB.bots);
  let i = 1;
  while (bots[`${userId}_bot${String(i).padStart(3,'0')}`]) i++;
  return `${userId}_bot${String(i).padStart(3,'0')}`;
}

// ─────────────────────────────────────────────
//  DEPLOY ENGINE
// ─────────────────────────────────────────────
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 50);
}

function getUserStorageMB(userId) {
  const dir = INSTANCES;
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith(String(userId))) continue;
    const full = path.join(dir, entry);
    try { total += getFolderSizeMB(full); } catch {}
  }
  return total;
}

function getFolderSizeMB(folder) {
  let total = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) total += getFolderSizeMB(full);
    else total += fs.statSync(full).size;
  }
  return total / (1024 * 1024);
}

function pm2Start(instanceDir, botId) {
  const res = spawnSync('pm2', ['start', 'bot.js', '--name', botId, '--no-autorestart'], {
    cwd: instanceDir, timeout: DEPLOY_TIMEOUT, encoding: 'utf8',
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function pm2Stop(botId) {
  try { execSync(`pm2 stop ${botId}`, { timeout: 10000 }); return true; } catch { return false; }
}

function pm2Restart(botId) {
  try { execSync(`pm2 restart ${botId}`, { timeout: 10000 }); return true; } catch { return false; }
}

function pm2Delete(botId) {
  try { execSync(`pm2 delete ${botId}`, { timeout: 10000 }); return true; } catch { return false; }
}

function pm2Status(botId) {
  try {
    const out = execSync(`pm2 jlist`, { timeout: 5000, encoding: 'utf8' });
    const list = JSON.parse(out);
    const entry = list.find(p => p.name === botId);
    if (!entry) return 'stopped';
    return entry.pm2_env.status; // online | stopped | errored
  } catch { return 'unknown'; }
}

function pm2RestartCount(botId) {
  try {
    const out = execSync(`pm2 jlist`, { timeout: 5000, encoding: 'utf8' });
    const list = JSON.parse(out);
    const entry = list.find(p => p.name === botId);
    return entry ? (entry.pm2_env.restart_time || 0) : 0;
  } catch { return 0; }
}

async function deployBot(userId, templateFolder, envData) {
  const botId    = generateBotId(userId);
  const instDir  = path.join(INSTANCES, botId);
  const tmplDir  = path.join(TEMPLATES, templateFolder);

  // Storage limit
  const usedMB = getUserStorageMB(userId);
  if (usedMB >= STORAGE_LIMIT) throw new Error(`Saqlash limiti (${STORAGE_LIMIT}MB) to'ldi!`);

  // Copy template
  copyDir(tmplDir, instDir);

  // Write .env
  const envContent = Object.entries(envData).map(([k, v]) => `${k}=${v}`).join('\n');
  fs.writeFileSync(path.join(instDir, '.env'), envContent);

  // npm install
  const install = spawnSync('npm', ['install', '--production'], {
    cwd: instDir, timeout: DEPLOY_TIMEOUT, encoding: 'utf8',
  });
  if (install.status !== 0) {
    fs.rmSync(instDir, { recursive: true, force: true });
    throw new Error('npm install muvaffaqiyatsiz: ' + (install.stderr || ''));
  }

  // pm2 start
  const start = pm2Start(instDir, botId);
  if (start.code !== 0) {
    fs.rmSync(instDir, { recursive: true, force: true });
    throw new Error('pm2 start muvaffaqiyatsiz: ' + (start.stderr || ''));
  }

  return botId;
}

// ─────────────────────────────────────────────
//  VALIDATORS
// ─────────────────────────────────────────────
function validateBotToken(token) {
  return /^\d{8,12}:[A-Za-z0-9_\-]{35,}$/.test(token);
}

function validateAdminId(id) {
  return /^\d{5,15}$/.test(id);
}

function validateEnvField(key, value) {
  if (key === 'BOT_TOKEN')   return validateBotToken(value);
  if (key === 'ADMIN_ID')    return validateAdminId(value);
  if (key === 'BOT_USERNAME') return /^[a-zA-Z][a-zA-Z0-9_]{4,31}bot$/i.test(value);
  return value.trim().length > 0;
}

// ─────────────────────────────────────────────
//  ANTI-SPAM / RATE LIMIT
// ─────────────────────────────────────────────
const lastMsg = new Map();

function isRateLimited(userId) {
  const now  = Date.now();
  const last = lastMsg.get(userId) || 0;
  if (now - last < RATE_LIMIT_SEC * 1000) return true;
  lastMsg.set(userId, now);
  return false;
}

// ─────────────────────────────────────────────
//  LOGGER
// ─────────────────────────────────────────────
function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  try {
    const logFile = path.join(LOGS_DIR, `${new Date().toISOString().slice(0,10)}.log`);
    fs.appendFileSync(logFile, line + '\n');
  } catch {}
}

// ─────────────────────────────────────────────
//  PAYMENTS
// ─────────────────────────────────────────────
function createPayment(userId, amount, method, extra = {}) {
  const payments = readDB(DB.payments);
  const id = `pay_${Date.now()}_${userId}`;
  payments[id] = { id, userId, amount, method, status: 'pending', createdAt: Date.now(), ...extra };
  writeDB(DB.payments, payments);
  return id;
}

function getPayment(id) {
  return readDB(DB.payments)[id] || null;
}

function updatePayment(id, data) {
  const payments = readDB(DB.payments);
  if (payments[id]) { payments[id] = { ...payments[id], ...data }; writeDB(DB.payments, payments); }
}

function getPendingPayments() {
  const payments = readDB(DB.payments);
  return Object.values(payments).filter(p => p.status === 'pending');
}

// ─────────────────────────────────────────────
//  TICKETS
// ─────────────────────────────────────────────
function createTicket(userId, message) {
  const tickets = readDB(DB.tickets);
  const id = `tkt_${Date.now()}_${userId}`;
  tickets[id] = { id, userId, status: 'open', messages: [{ from: 'user', text: message, at: Date.now() }], createdAt: Date.now() };
  writeDB(DB.tickets, tickets);
  return id;
}

function getTicket(id) { return readDB(DB.tickets)[id] || null; }

function updateTicket(id, data) {
  const tickets = readDB(DB.tickets);
  if (tickets[id]) { tickets[id] = { ...tickets[id], ...data }; writeDB(DB.tickets, tickets); }
}

function getOpenTickets() {
  return Object.values(readDB(DB.tickets)).filter(t => t.status === 'open');
}

// ─────────────────────────────────────────────
//  KEYBOARDS
// ─────────────────────────────────────────────
const mainMenu = Markup.keyboard([
  ['🤖 Bot yaratish', '📁 Botlarim'],
  ['👤 Profil', '💳 Pul kiritish'],
  ['🎁 Referal', 'ℹ️ Bot haqida'],
  ['📞 Adminga murojat'],
]).resize();

const adminMenu = Markup.keyboard([
  ['📦 Bot qo\'shish', '📢 Broadcast'],
  ['💰 Balans boshqarish', '👥 Userlar'],
  ['🎁 Referal sozlash', '💳 To\'lovlar'],
  ['🧾 Ticketlar', '⚙️ Sozlamalar'],
  ['🏠 Asosiy menyu'],
]).resize();

function botActionsKeyboard(botId, status) {
  const isOnline = status === 'online';
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Status', `bot_status:${botId}`),
      Markup.button.callback('🔁 Restart', `bot_restart:${botId}`),
    ],
    [
      isOnline
        ? Markup.button.callback('🛑 Stop', `bot_stop:${botId}`)
        : Markup.button.callback('▶️ Start', `bot_start:${botId}`),
      Markup.button.callback('📄 ENV', `bot_env:${botId}`),
    ],
    [Markup.button.callback('🗑 O\'chirish', `bot_delete:${botId}`)],
    [Markup.button.callback('« Orqaga', 'my_bots')],
  ]);
}

const cancelBtn = Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]]);

// ─────────────────────────────────────────────
//  CHANNEL SUBSCRIPTION CHECK
// ─────────────────────────────────────────────
async function checkSubscription(ctx) {
  const settings = getSettings();
  if (!settings.channel_id) return true;
  try {
    const member = await ctx.telegram.getChatMember(settings.channel_id, ctx.from.id);
    return ['member','administrator','creator'].includes(member.status);
  } catch { return true; }
}

// ─────────────────────────────────────────────
//  BOT INIT
// ─────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

bot.use(session());

// ─── Middleware: ensure user + rate limit ───
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const user = ensureUser(ctx);

  if (user.blocked) return ctx.reply('🚫 Siz bloklangansiz.');

  if (isRateLimited(ctx.from.id)) return; // silent drop

  const settings = getSettings();
  if (settings.maintenance && !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🔧 Bot texnik xizmat ko\'rsatmoqda. Kuting...');
  }

  return next();
});

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────
bot.start(async ctx => {
  const user = ensureUser(ctx);
  const isAdmin = ADMIN_IDS.includes(ctx.from.id);

  const subscribed = await checkSubscription(ctx);
  if (!subscribed) {
    const settings = getSettings();
    return ctx.reply(
      '📢 Davom etish uchun kanalga a\'zo bo\'ling:',
      Markup.inlineKeyboard([
        [Markup.button.url('📢 Kanalga o\'tish', `https://t.me/${settings.channel_id?.replace('@','')}`)],
        [Markup.button.callback('✅ Tekshirish', 'check_sub')],
      ])
    );
  }

  await ctx.replyWithPhoto(
    { source: fs.existsSync(path.join(ROOT, 'assets', 'banner.jpg'))
        ? fs.createReadStream(path.join(ROOT, 'assets', 'banner.jpg'))
        : 'https://via.placeholder.com/800x400?text=MAKER+BOT' },
    {
      caption:
        `👋 Xush kelibsiz, *${ctx.from.first_name}*!\n\n` +
        `🤖 *MAKER BOT* — Telegram bot marketplace\n\n` +
        `• Bot shablonlarini sotib oling\n` +
        `• Avtomatik deploy qiling\n` +
        `• Botlaringizni boshqaring\n\n` +
        `💰 Balansingiz: *${user.balance.toLocaleString()} UZS*`,
      parse_mode: 'Markdown',
      ...( isAdmin ? adminMenu : mainMenu ),
    }
  ).catch(() => ctx.reply(
    `👋 Xush kelibsiz, *${ctx.from.first_name}*!\n\n` +
    `🤖 *MAKER BOT* — Telegram bot marketplace\n\n` +
    `💰 Balansingiz: *${user.balance.toLocaleString()} UZS*`,
    { parse_mode: 'Markdown', ...( isAdmin ? adminMenu : mainMenu ) }
  ));
});

bot.action('check_sub', async ctx => {
  const subscribed = await checkSubscription(ctx);
  if (subscribed) {
    await ctx.answerCbQuery('✅ Tasdiqlandi!');
    await ctx.deleteMessage().catch(() => {});
    return ctx.reply('✅ A\'zolik tasdiqlandi!', mainMenu);
  }
  return ctx.answerCbQuery('❌ Hali a\'zo emassiz!', { show_alert: true });
});

// ─────────────────────────────────────────────
//  ℹ️ BOT HAQIDA
// ─────────────────────────────────────────────
bot.hears('ℹ️ Bot haqida', ctx => {
  ctx.reply(
    `ℹ️ *MAKER BOT v1.0*\n\n` +
    `📦 Bot deploy tizimi\n` +
    `🔐 Xavfsiz ENV saqlash\n` +
    `⚡ PM2 avtomatik restart\n` +
    `💳 Karta va Stars orqali to'lov\n` +
    `🎁 Referal tizimi\n` +
    `📞 24/7 qo'llab-quvvatlash\n\n` +
    `🛠 Stack: Node.js · Telegraf · PM2`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
//  👤 PROFIL
// ─────────────────────────────────────────────
bot.hears('👤 Profil', async ctx => {
  const user    = getUser(ctx.from.id);
  const myBots  = getUserBots(ctx.from.id);
  const refs    = (user.referrals || []).length;

  ctx.reply(
    `👤 *Profil*\n\n` +
    `🆔 ID: \`${user.id}\`\n` +
    `👤 Ism: ${user.firstName}\n` +
    `📛 Username: @${user.username || 'yo\'q'}\n\n` +
    `💰 Balans: *${user.balance.toLocaleString()} UZS*\n` +
    `🤖 Botlar: ${myBots.length} ta\n` +
    `🎁 Takliflar: ${refs} ta\n\n` +
    `📅 Ro'yxatdan o'tgan: ${new Date(user.joinedAt).toLocaleDateString('uz-UZ')}`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
//  💳 PUL KIRITISH
// ─────────────────────────────────────────────
bot.hears('💳 Pul kiritish', ctx => {
  ctx.reply(
    '💳 *Pul kiritish usulini tanlang:*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💳 Karta orqali', 'pay_card')],
        [Markup.button.callback('⭐ Stars orqali',  'pay_stars')],
      ]),
    }
  );
});

// ─── Karta orqali to'lov ───
bot.action('pay_card', async ctx => {
  await ctx.answerCbQuery();
  const settings = getSettings();
  if (!ctx.session) ctx.session = {};
  ctx.session.paymentMethod = 'card';
  ctx.session.step = 'enter_amount';

  const admins = readDB(DB.users);
  const adminList = ADMIN_IDS.map(id => admins[id]).filter(Boolean);

  let cardInfo = '❌ Karta ma\'lumoti kiritilmagan.';
  const s = getSettings();
  if (s.card_number) {
    cardInfo = `💳 Karta raqami: \`${s.card_number}\`\n👤 Ism: ${s.card_name || 'Admin'}`;
  }

  ctx.reply(
    `💳 *Karta orqali to'lov*\n\n` +
    `${cardInfo}\n\n` +
    `📌 Minimum: *${settings.min_deposit.toLocaleString()} UZS*\n\n` +
    `💬 To'lov miqdorini kiriting (UZS):`,
    { parse_mode: 'Markdown', ...cancelBtn }
  );
});

// ─── Stars orqali ───
bot.action('pay_stars', async ctx => {
  await ctx.answerCbQuery();
  if (!ctx.session) ctx.session = {};
  ctx.session.paymentMethod = 'stars';
  ctx.session.step = 'enter_amount';
  const settings = getSettings();
  ctx.reply(
    `⭐ *Stars orqali to'lov*\n\n` +
    `📌 1 Star = *${settings.stars_price} UZS*\n\n` +
    `💬 Necha Stars yubormoqchisiz?`,
    { parse_mode: 'Markdown', ...cancelBtn }
  );
});

// ─────────────────────────────────────────────
//  🎁 REFERAL
// ─────────────────────────────────────────────
bot.hears('🎁 Referal', ctx => {
  const user = getUser(ctx.from.id);
  const settings = getSettings();
  const link = `https://t.me/${ctx.botInfo.username}?start=ref_${ctx.from.id}`;
  const refs = (user.referrals || []).length;

  ctx.reply(
    `🎁 *Referal tizimi*\n\n` +
    `🔗 Sizning havolangiz:\n\`${link}\`\n\n` +
    `👥 Takliflar: *${refs} ta*\n` +
    `🎁 Har taklif uchun: *${settings.referral_bonus.toLocaleString()} UZS*\n` +
    `💰 Jami daromad: *${(refs * settings.referral_bonus).toLocaleString()} UZS*`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
//  📞 ADMINGA MUROJAT (TICKET)
// ─────────────────────────────────────────────
bot.hears('📞 Adminga murojat', ctx => {
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'ticket_message';
  ctx.reply(
    '📞 *Adminga murojat*\n\nXabaringizni yozing:',
    { parse_mode: 'Markdown', ...cancelBtn }
  );
});

// ─────────────────────────────────────────────
//  🤖 BOT YARATISH
// ─────────────────────────────────────────────
bot.hears('🤖 Bot yaratish', async ctx => {
  const templates = getTemplates();
  if (templates.length === 0) {
    return ctx.reply('😔 Hozircha hech qanday shablon mavjud emas.');
  }

  const buttons = templates.map(t =>
    [Markup.button.callback(`🤖 ${t.name} — ${t.price.toLocaleString()} UZS`, `buy_template:${t.folder}`)]
  );
  buttons.push([Markup.button.callback('❌ Bekor qilish', 'cancel')]);

  ctx.reply(
    '🤖 *Bot shablonini tanlang:*\n\n' +
    templates.map(t =>
      `📦 *${t.name}*\n💬 ${t.description}\n💰 ${t.price.toLocaleString()} UZS`
    ).join('\n\n'),
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
});

bot.action(/^buy_template:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const folder   = ctx.match[1];
  const template = getTemplate(folder);
  if (!template) return ctx.reply('❌ Shablon topilmadi.');

  const user = getUser(ctx.from.id);
  if (user.balance < template.price) {
    return ctx.reply(
      `❌ *Balansingiz yetarli emas!*\n\n` +
      `💰 Narxi: *${template.price.toLocaleString()} UZS*\n` +
      `💳 Balansingiz: *${user.balance.toLocaleString()} UZS*\n` +
      `📉 Yetishmovchi: *${(template.price - user.balance).toLocaleString()} UZS*`,
      { parse_mode: 'Markdown' }
    );
  }

  if (!ctx.session) ctx.session = {};
  ctx.session.step        = 'env_input';
  ctx.session.template    = folder;
  ctx.session.envFields   = template.env || [];
  ctx.session.envIndex    = 0;
  ctx.session.envData     = {};

  ctx.reply(
    `📦 *${template.name}*\n\n` +
    `💰 Narxi: ${template.price.toLocaleString()} UZS\n\n` +
    `⚙️ Kerakli ENV ma'lumotlarini kiriting:`,
    { parse_mode: 'Markdown' }
  );
  askNextEnv(ctx);
});

function askNextEnv(ctx) {
  const { envFields, envIndex } = ctx.session;
  if (envIndex >= envFields.length) {
    return confirmDeploy(ctx);
  }
  const field = envFields[envIndex];
  let hint = '';
  if (field === 'BOT_TOKEN')    hint = 'Format: `123456:ABCdef...`';
  if (field === 'ADMIN_ID')     hint = 'Telegram ID raqam (masalan: `123456789`)';
  if (field === 'BOT_USERNAME') hint = 'Format: `mybot` (bot deb tugashi kerak)';

  ctx.reply(
    `📝 *${field}* kiriting:\n${hint ? `💡 ${hint}` : ''}`,
    { parse_mode: 'Markdown', ...cancelBtn }
  );
}

function confirmDeploy(ctx) {
  const template = getTemplate(ctx.session.template);
  const envLines = Object.entries(ctx.session.envData)
    .map(([k, v]) => `• \`${k}\`: \`${v}\``)
    .join('\n');

  ctx.reply(
    `✅ *Tasdiqlang:*\n\n` +
    `📦 Shablon: *${template.name}*\n` +
    `💰 Narxi: *${template.price.toLocaleString()} UZS*\n\n` +
    `⚙️ ENV ma'lumotlari:\n${envLines}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Yaratish', 'confirm_deploy')],
        [Markup.button.callback('❌ Bekor qilish', 'cancel')],
      ]),
    }
  );
}

bot.action('confirm_deploy', async ctx => {
  await ctx.answerCbQuery();
  const { template: folder, envData } = ctx.session;
  const templateObj = getTemplate(folder);
  if (!templateObj) return ctx.reply('❌ Shablon topilmadi.');

  const user = getUser(ctx.from.id);
  if (user.balance < templateObj.price) return ctx.reply('❌ Balans yetarli emas.');

  await ctx.reply('⏳ Bot yaratilmoqda... Bir oz kuting...');

  try {
    const botId   = await deployBot(ctx.from.id, folder, envData);
    const status  = pm2Status(botId);

    // Deduct balance
    user.balance  -= templateObj.price;
    user.botCount  = (user.botCount || 0) + 1;
    saveUser(user);

    // Save bot record
    saveBot({
      id        : botId,
      userId    : ctx.from.id,
      template  : folder,
      name      : templateObj.name,
      envData,
      status,
      createdAt : Date.now(),
      restarts  : 0,
    });

    ctx.session = {};
    log('INFO', `Bot deployed: ${botId} by user ${ctx.from.id}`);

    ctx.reply(
      `🎉 *Bot muvaffaqiyatli yaratildi!*\n\n` +
      `🆔 Bot ID: \`${botId}\`\n` +
      `📦 Shablon: ${templateObj.name}\n` +
      `📊 Holat: ${status === 'online' ? '🟢 Ishlamoqda' : '🔴 To\'xtatilgan'}\n\n` +
      `💰 Balansingiz: *${user.balance.toLocaleString()} UZS*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    log('ERROR', `Deploy failed for user ${ctx.from.id}: ${err.message}`);
    ctx.reply(`❌ *Deploy xatosi:*\n\n${err.message}`, { parse_mode: 'Markdown' });
  }
});

// ─────────────────────────────────────────────
//  📁 BOTLARIM
// ─────────────────────────────────────────────
bot.hears('📁 Botlarim', ctx => showMyBots(ctx));
bot.action('my_bots', ctx => { ctx.answerCbQuery(); showMyBots(ctx); });

async function showMyBots(ctx) {
  const myBots = getUserBots(ctx.from.id);
  if (myBots.length === 0) {
    return ctx.reply('😔 Sizda hali bot yo\'q.\n\n🤖 Bot yaratish tugmasini bosing!');
  }

  const buttons = myBots.map(b => {
    const status = pm2Status(b.id);
    const icon   = status === 'online' ? '🟢' : '🔴';
    return [Markup.button.callback(`${icon} ${b.name} — ${b.id}`, `bot_detail:${b.id}`)];
  });

  ctx.reply(
    `📁 *Botlarim* (${myBots.length} ta):`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

bot.action(/^bot_detail:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId  = ctx.match[1];
  const botObj = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return ctx.reply('❌ Bot topilmadi.');

  const status   = pm2Status(botId);
  const restarts = pm2RestartCount(botId);
  const icon     = status === 'online' ? '🟢' : '🔴';

  ctx.reply(
    `🤖 *${botObj.name}*\n\n` +
    `🆔 ID: \`${botId}\`\n` +
    `📊 Holat: ${icon} ${status}\n` +
    `🔄 Restartlar: ${restarts}\n` +
    `📅 Yaratilgan: ${new Date(botObj.createdAt).toLocaleDateString('uz-UZ')}`,
    { parse_mode: 'Markdown', ...botActionsKeyboard(botId, status) }
  );
});

bot.action(/^bot_status:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId  = ctx.match[1];
  const botObj = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return ctx.answerCbQuery('❌ Ruxsat yo\'q', { show_alert: true });

  const status   = pm2Status(botId);
  const restarts = pm2RestartCount(botId);
  const icon     = status === 'online' ? '🟢' : '🔴';

  ctx.answerCbQuery(`${icon} ${status} | Restartlar: ${restarts}`, { show_alert: true });
});

bot.action(/^bot_restart:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId  = ctx.match[1];
  const botObj = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return;

  const restarts = pm2RestartCount(botId);
  if (restarts >= RESTART_LIMIT) {
    return ctx.answerCbQuery(`❌ Restart limiti (${RESTART_LIMIT}) oshdi!`, { show_alert: true });
  }

  const ok = pm2Restart(botId);
  ctx.answerCbQuery(ok ? '🔁 Restart berildi!' : '❌ Restart muvaffaqiyatsiz', { show_alert: true });
});

bot.action(/^bot_stop:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId  = ctx.match[1];
  const botObj = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return;

  const ok = pm2Stop(botId);
  ctx.answerCbQuery(ok ? '🛑 Bot to\'xtatildi!' : '❌ Xato', { show_alert: true });
  if (ok) {
    ctx.editMessageReplyMarkup(botActionsKeyboard(botId, 'stopped').reply_markup);
  }
});

bot.action(/^bot_start:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId   = ctx.match[1];
  const botObj  = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return;

  const instDir = path.join(INSTANCES, botId);
  const res     = pm2Start(instDir, botId);
  const ok      = res.code === 0;
  ctx.answerCbQuery(ok ? '▶️ Bot ishga tushdi!' : '❌ Xato: ' + res.stderr, { show_alert: true });
  if (ok) {
    ctx.editMessageReplyMarkup(botActionsKeyboard(botId, 'online').reply_markup);
  }
});

bot.action(/^bot_env:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId  = ctx.match[1];
  const botObj = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return;

  const envLines = Object.keys(botObj.envData || {})
    .map(k => `🔑 \`${k}\`: \`****\``)
    .join('\n');

  ctx.reply(
    `📄 *ENV kalitlari* (${botId}):\n\n${envLines || 'Mavjud emas'}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('👁 Ko\'rsatish (shaxsiy)', `bot_env_show:${botId}`)]]),
    }
  );
});

bot.action(/^bot_env_show:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId  = ctx.match[1];
  const botObj = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return;

  const envLines = Object.entries(botObj.envData || {})
    .map(([k, v]) => `🔑 \`${k}\`: \`${v}\``)
    .join('\n');

  // Send as private message and delete after 30s
  const msg = await ctx.reply(
    `🔐 *ENV ma'lumotlari* (30 soniyada o'chadi):\n\n${envLines}`,
    { parse_mode: 'Markdown' }
  );
  setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {}), 30000);
});

bot.action(/^bot_delete:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId = ctx.match[1];
  ctx.reply(
    `🗑 *${botId}* ni o'chirishni tasdiqlaysizmi?\n\n⚠️ Bu amalni qaytarib bo'lmaydi!`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha, o\'chirish', `bot_delete_confirm:${botId}`)],
        [Markup.button.callback('❌ Yo\'q', 'my_bots')],
      ]),
    }
  );
});

bot.action(/^bot_delete_confirm:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const botId  = ctx.match[1];
  const botObj = getBot(botId);
  if (!botObj || botObj.userId !== ctx.from.id) return;

  pm2Stop(botId);
  pm2Delete(botId);
  const instDir = path.join(INSTANCES, botId);
  if (fs.existsSync(instDir)) fs.rmSync(instDir, { recursive: true, force: true });
  deleteBot(botId);

  const user = getUser(ctx.from.id);
  user.botCount = Math.max(0, (user.botCount || 1) - 1);
  saveUser(user);

  log('INFO', `Bot deleted: ${botId} by user ${ctx.from.id}`);
  ctx.reply('✅ Bot muvaffaqiyatli o\'chirildi!');
});

// ─────────────────────────────────────────────
//  CANCEL
// ─────────────────────────────────────────────
bot.action('cancel', ctx => {
  ctx.answerCbQuery();
  ctx.session = {};
  ctx.reply('❌ Bekor qilindi.', mainMenu);
});

// ─────────────────────────────────────────────
//  ADMIN PANEL
// ─────────────────────────────────────────────
bot.hears('🏠 Asosiy menyu', ctx => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  ctx.reply('🏠 Asosiy menyu', mainMenu);
});

// ─── Admin check middleware ───
function adminOnly(ctx, next) {
  if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply('❌ Ruxsat yo\'q!');
  return next();
}

// ─────────────────────────────────────────────
//  📦 BOT QO'SHISH (Admin)
// ─────────────────────────────────────────────
bot.hears('📦 Bot qo\'shish', adminOnly, ctx => {
  if (!ctx.session) ctx.session = {};
  ctx.session.step        = 'admin_add_bot_name';
  ctx.session.newTemplate = {};
  ctx.reply(
    '📦 *Yangi shablon qo\'shish*\n\nBot papka nomini kiriting (lotin, _ mumkin):',
    { parse_mode: 'Markdown', ...cancelBtn }
  );
});

// ─────────────────────────────────────────────
//  📢 BROADCAST
// ─────────────────────────────────────────────
bot.hears('📢 Broadcast', adminOnly, ctx => {
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'broadcast_msg';
  ctx.reply('📢 *Broadcast xabarini yuboring:*\n\n(Matn, rasm, video yoki forward)', {
    parse_mode: 'Markdown', ...cancelBtn
  });
});

// ─────────────────────────────────────────────
//  💰 BALANS BOSHQARISH
// ─────────────────────────────────────────────
bot.hears('💰 Balans boshqarish', adminOnly, ctx => {
  ctx.reply(
    '💰 *Balans boshqarish*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Qo\'shish',    'admin_balance_add')],
        [Markup.button.callback('➖ Ayirish',       'admin_balance_sub')],
        [Markup.button.callback('📢 Hammaga tarqatish', 'admin_balance_all')],
      ]),
    }
  );
});

bot.action('admin_balance_add', adminOnly, ctx => {
  ctx.answerCbQuery();
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'admin_bal_add_id';
  ctx.reply('👤 Foydalanuvchi ID sini kiriting:', cancelBtn);
});

bot.action('admin_balance_sub', adminOnly, ctx => {
  ctx.answerCbQuery();
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'admin_bal_sub_id';
  ctx.reply('👤 Foydalanuvchi ID sini kiriting:', cancelBtn);
});

bot.action('admin_balance_all', adminOnly, ctx => {
  ctx.answerCbQuery();
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'admin_bal_all_amount';
  ctx.reply('💰 Miqdorni kiriting (UZS):', cancelBtn);
});

// ─────────────────────────────────────────────
//  👥 USERLAR
// ─────────────────────────────────────────────
bot.hears('👥 Userlar', adminOnly, ctx => {
  const users = readDB(DB.users);
  const list  = Object.values(users);
  ctx.reply(
    `👥 *Foydalanuvchilar: ${list.length} ta*\n\n` +
    list.slice(0,20).map(u =>
      `• [${u.id}](tg://user?id=${u.id}) @${u.username || '-'} | 💰${u.balance.toLocaleString()}`
    ).join('\n') +
    (list.length > 20 ? `\n\n...va yana ${list.length - 20} ta` : ''),
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
//  🎁 REFERAL SOZLASH
// ─────────────────────────────────────────────
bot.hears('🎁 Referal sozlash', adminOnly, ctx => {
  const settings = getSettings();
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'admin_set_ref_bonus';
  ctx.reply(
    `🎁 *Referal sozlamalari*\n\nHozirgi bonus: *${settings.referral_bonus.toLocaleString()} UZS*\n\nYangi bonusni kiriting:`,
    { parse_mode: 'Markdown', ...cancelBtn }
  );
});

// ─────────────────────────────────────────────
//  💳 TO'LOVLAR
// ─────────────────────────────────────────────
bot.hears('💳 To\'lovlar', adminOnly, ctx => {
  const pending = getPendingPayments();
  if (pending.length === 0) return ctx.reply('✅ Kutilayotgan to\'lovlar yo\'q.');

  const buttons = pending.map(p => [
    Markup.button.callback(
      `💰 ${p.amount.toLocaleString()} UZS — #${p.id.slice(-6)}`,
      `admin_pay_detail:${p.id}`
    ),
  ]);
  ctx.reply(`💳 *Kutilayotgan to'lovlar: ${pending.length} ta*`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
});

bot.action(/^admin_pay_detail:(.+)$/, adminOnly, async ctx => {
  await ctx.answerCbQuery();
  const payId = ctx.match[1];
  const pay   = getPayment(payId);
  if (!pay) return ctx.reply('❌ To\'lov topilmadi.');

  const user = getUser(pay.userId);
  ctx.reply(
    `💳 *To'lov #${payId.slice(-8)}*\n\n` +
    `👤 User: [${pay.userId}](tg://user?id=${pay.userId}) @${user?.username || '-'}\n` +
    `💰 Miqdor: *${pay.amount.toLocaleString()} UZS*\n` +
    `💳 Usul: ${pay.method}\n` +
    `📅 Vaqt: ${new Date(pay.createdAt).toLocaleString('uz-UZ')}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Tasdiqlash', `admin_pay_approve:${payId}`),
          Markup.button.callback('❌ Rad etish',   `admin_pay_reject:${payId}`),
        ],
      ]),
    }
  );
});

bot.action(/^admin_pay_approve:(.+)$/, adminOnly, async ctx => {
  await ctx.answerCbQuery();
  const payId = ctx.match[1];
  const pay   = getPayment(payId);
  if (!pay || pay.status !== 'pending') return ctx.reply('❌ To\'lov topilmadi yoki allaqachon ko\'rib chiqilgan.');

  const user = getUser(pay.userId);
  if (user) {
    user.balance += pay.amount;
    saveUser(user);
    await ctx.telegram.sendMessage(
      pay.userId,
      `✅ *To'lovingiz tasdiqlandi!*\n\n💰 Hisobingizga *${pay.amount.toLocaleString()} UZS* qo'shildi.\n💳 Joriy balans: *${user.balance.toLocaleString()} UZS*`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  updatePayment(payId, { status: 'approved', approvedAt: Date.now() });
  ctx.reply('✅ To\'lov tasdiqlandi!');
  log('INFO', `Payment approved: ${payId}`);
});

bot.action(/^admin_pay_reject:(.+)$/, adminOnly, async ctx => {
  await ctx.answerCbQuery();
  const payId = ctx.match[1];
  const pay   = getPayment(payId);
  if (!pay || pay.status !== 'pending') return;

  updatePayment(payId, { status: 'rejected', rejectedAt: Date.now() });
  await ctx.telegram.sendMessage(
    pay.userId,
    `❌ *To'lovingiz rad etildi.*\n\nBatafsil ma'lumot uchun adminlar bilan bog'laning.`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  ctx.reply('❌ To\'lov rad etildi.');
});

// ─────────────────────────────────────────────
//  🧾 TICKETLAR (Admin)
// ─────────────────────────────────────────────
bot.hears('🧾 Ticketlar', adminOnly, ctx => {
  const open = getOpenTickets();
  if (open.length === 0) return ctx.reply('✅ Ochiq ticketlar yo\'q.');

  const buttons = open.slice(0,10).map(t => [
    Markup.button.callback(`🎫 #${t.id.slice(-6)} — User ${t.userId}`, `admin_ticket:${t.id}`)
  ]);
  ctx.reply(`🧾 *Ochiq ticketlar: ${open.length} ta*`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
});

bot.action(/^admin_ticket:(.+)$/, adminOnly, async ctx => {
  await ctx.answerCbQuery();
  const ticketId = ctx.match[1];
  const ticket   = getTicket(ticketId);
  if (!ticket) return ctx.reply('❌ Ticket topilmadi.');

  const msgs = ticket.messages.map(m =>
    `${m.from === 'user' ? '👤' : '🔧'} ${m.text}`
  ).join('\n\n');

  if (!ctx.session) ctx.session = {};
  ctx.session.replyingTicket = ticketId;
  ctx.session.step           = 'admin_ticket_reply';

  ctx.reply(
    `🎫 *Ticket #${ticketId.slice(-8)}*\n👤 User: ${ticket.userId}\n\n${msgs}\n\n📝 Javob yozing:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yopish', `admin_ticket_close:${ticketId}`)],
        [Markup.button.callback('❌ Bekor', 'cancel')],
      ]),
    }
  );
});

bot.action(/^admin_ticket_close:(.+)$/, adminOnly, async ctx => {
  await ctx.answerCbQuery();
  const ticketId = ctx.match[1];
  updateTicket(ticketId, { status: 'closed', closedAt: Date.now() });
  const ticket = getTicket(ticketId);
  if (ticket) {
    await ctx.telegram.sendMessage(ticket.userId,
      `✅ *Ticketingiz yopildi.*\n\nMuammo hal bo'ldi deb hisoblaymiz. Yana murojaat qilishingiz mumkin.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
  ctx.session = {};
  ctx.reply('✅ Ticket yopildi.');
});

// ─────────────────────────────────────────────
//  ⚙️ SOZLAMALAR
// ─────────────────────────────────────────────
bot.hears('⚙️ Sozlamalar', adminOnly, ctx => {
  const s = getSettings();
  ctx.reply(
    `⚙️ *Sozlamalar*\n\n` +
    `💳 Karta nomi: ${s.card_name || 'kiritilmagan'}\n` +
    `💳 Karta raqami: ${s.card_number || 'kiritilmagan'}\n` +
    `⭐ 1 Star = ${s.stars_price} UZS\n` +
    `📌 Min deposit: ${s.min_deposit.toLocaleString()} UZS\n` +
    `🎁 Referal bonus: ${s.referral_bonus.toLocaleString()} UZS\n` +
    `📢 Kanal: ${s.channel_id || 'yo\'q'}\n` +
    `🔧 Texnik xizmat: ${s.maintenance ? 'Ha' : 'Yo\'q'}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💳 Karta sozlash',      'settings_card')],
        [Markup.button.callback('⭐ Stars narxi',          'settings_stars')],
        [Markup.button.callback('📢 Kanal sozlash',       'settings_channel')],
        [Markup.button.callback('🔧 Texnik xizmat on/off','settings_maintenance')],
      ]),
    }
  );
});

bot.action('settings_card', adminOnly, ctx => {
  ctx.answerCbQuery();
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'settings_card_name';
  ctx.reply('Karta egasining ismini kiriting:', cancelBtn);
});

bot.action('settings_stars', adminOnly, ctx => {
  ctx.answerCbQuery();
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'settings_stars_price';
  ctx.reply('1 Star uchun UZS miqdorini kiriting:', cancelBtn);
});

bot.action('settings_channel', adminOnly, ctx => {
  ctx.answerCbQuery();
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'settings_channel_id';
  ctx.reply('Kanal ID yoki @username kiriting (o\'chirish uchun "none"):', cancelBtn);
});

bot.action('settings_maintenance', adminOnly, ctx => {
  ctx.answerCbQuery();
  const s = getSettings();
  s.maintenance = !s.maintenance;
  saveSettings(s);
  ctx.reply(`🔧 Texnik xizmat: ${s.maintenance ? 'Yoqildi ✅' : 'O\'chirildi ❌'}`);
});

// ─────────────────────────────────────────────
//  TEXT MESSAGE HANDLER (State Machine)
// ─────────────────────────────────────────────
bot.on('message', async ctx => {
  if (!ctx.session) ctx.session = {};
  const step = ctx.session.step;
  const text = ctx.message.text;

  // ─── ENV input for bot creation ───
  if (step === 'env_input') {
    const { envFields, envIndex } = ctx.session;
    const field = envFields[envIndex];

    if (!validateEnvField(field, text)) {
      return ctx.reply(
        `❌ *Noto'g'ri format!*\n\nMaydon: \`${field}\`\n\nQaytadan kiriting:`,
        { parse_mode: 'Markdown', ...cancelBtn }
      );
    }

    ctx.session.envData[field]  = text.trim();
    ctx.session.envIndex += 1;
    return askNextEnv(ctx);
  }

  // ─── Payment amount input ───
  if (step === 'enter_amount') {
    const amount = parseInt(text.replace(/\D/g, ''));
    if (isNaN(amount) || amount < getSettings().min_deposit) {
      return ctx.reply(`❌ Minimum miqdor: ${getSettings().min_deposit.toLocaleString()} UZS`);
    }
    ctx.session.paymentAmount = amount;
    ctx.session.step          = 'upload_screenshot';

    if (ctx.session.paymentMethod === 'stars') {
      const uzs = amount * getSettings().stars_price;
      ctx.session.paymentAmount = uzs;
      return ctx.reply(
        `⭐ ${amount} Stars = *${uzs.toLocaleString()} UZS*\n\n📸 Screenshot yuboring:`,
        { parse_mode: 'Markdown', ...cancelBtn }
      );
    }

    const s = getSettings();
    ctx.reply(
      `💰 Miqdor: *${amount.toLocaleString()} UZS*\n\n` +
      `💳 Kartaga o'tkazing:\n\`${s.card_number || '?'}\` (${s.card_name || '?'})\n\n` +
      `📸 To'lov screenshotini yuboring:`,
      { parse_mode: 'Markdown', ...cancelBtn }
    );
    return;
  }

  // ─── Screenshot upload ───
  if (step === 'upload_screenshot') {
    const photo = ctx.message.photo || ctx.message.document;
    const payId = createPayment(
      ctx.from.id,
      ctx.session.paymentAmount,
      ctx.session.paymentMethod,
      { fileId: photo ? (ctx.message.photo ? ctx.message.photo.slice(-1)[0].file_id : ctx.message.document.file_id) : null }
    );

    // Notify admins
    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `💳 *Yangi to'lov so'rovi!*\n\n` +
        `👤 User: [${ctx.from.id}](tg://user?id=${ctx.from.id}) @${ctx.from.username || '-'}\n` +
        `💰 Miqdor: *${ctx.session.paymentAmount.toLocaleString()} UZS*\n` +
        `💳 Usul: ${ctx.session.paymentMethod}\n` +
        `🆔 ID: \`${payId}\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Tasdiqlash', `admin_pay_approve:${payId}`),
              Markup.button.callback('❌ Rad etish',   `admin_pay_reject:${payId}`),
            ],
          ]),
        }
      ).catch(() => {});

      if (photo && ctx.message.photo) {
        await ctx.telegram.sendPhoto(adminId, ctx.message.photo.slice(-1)[0].file_id, {
          caption: `Screenshot — #${payId.slice(-8)}`,
        }).catch(() => {});
      }
    }

    ctx.session = {};
    ctx.reply('✅ *To\'lovingiz qabul qilindi!*\n\n⏳ Admin tasdiqlashini kuting. (Odatda 5-30 daqiqa)', { parse_mode: 'Markdown' });
    return;
  }

  // ─── Ticket message ───
  if (step === 'ticket_message') {
    const ticketId = createTicket(ctx.from.id, text);
    ctx.session    = {};

    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `🎫 *Yangi ticket!*\n\n👤 [${ctx.from.id}](tg://user?id=${ctx.from.id})\n💬 ${text}\n🆔 \`${ticketId}\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('💬 Javob berish', `admin_ticket:${ticketId}`)]]),
        }
      ).catch(() => {});
    }

    return ctx.reply('✅ *Ticketingiz yuborildi!*\n\nAdmin tez orada javob beradi.', { parse_mode: 'Markdown' });
  }

  // ─── Admin ticket reply ───
  if (step === 'admin_ticket_reply' && ADMIN_IDS.includes(ctx.from.id)) {
    const ticketId = ctx.session.replyingTicket;
    const ticket   = getTicket(ticketId);
    if (!ticket) return ctx.reply('❌ Ticket topilmadi.');

    ticket.messages.push({ from: 'admin', text, at: Date.now() });
    updateTicket(ticketId, { messages: ticket.messages });

    await ctx.telegram.sendMessage(
      ticket.userId,
      `💬 *Admin javob berdi:*\n\n${text}\n\n_Ticket #${ticketId.slice(-8)}_`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    ctx.session = {};
    return ctx.reply('✅ Javob yuborildi!');
  }

  // ─── Admin: add bot (template) ───
  if (step === 'admin_add_bot_name' && ADMIN_IDS.includes(ctx.from.id)) {
    ctx.session.newTemplate.folder = sanitizeName(text);
    ctx.session.step = 'admin_add_bot_display_name';
    return ctx.reply('Bot ko\'rsatma nomini kiriting:', cancelBtn);
  }

  if (step === 'admin_add_bot_display_name' && ADMIN_IDS.includes(ctx.from.id)) {
    ctx.session.newTemplate.name = text;
    ctx.session.step = 'admin_add_bot_price';
    return ctx.reply('Narxini kiriting (UZS):', cancelBtn);
  }

  if (step === 'admin_add_bot_price' && ADMIN_IDS.includes(ctx.from.id)) {
    const price = parseInt(text.replace(/\D/g, ''));
    if (isNaN(price)) return ctx.reply('❌ Raqam kiriting!');
    ctx.session.newTemplate.price = price;
    ctx.session.step = 'admin_add_bot_desc';
    return ctx.reply('Tavsifini kiriting:', cancelBtn);
  }

  if (step === 'admin_add_bot_desc' && ADMIN_IDS.includes(ctx.from.id)) {
    ctx.session.newTemplate.description = text;
    ctx.session.step = 'admin_add_bot_env';
    return ctx.reply(
      'ENV kalitlarini kiriting (vergul bilan, masalan: BOT_TOKEN,ADMIN_ID,BOT_USERNAME):',
      cancelBtn
    );
  }

  if (step === 'admin_add_bot_env' && ADMIN_IDS.includes(ctx.from.id)) {
    const envKeys = text.split(',').map(k => k.trim().toUpperCase()).filter(Boolean);
    const { newTemplate } = ctx.session;
    ctx.session = {};

    const tmplDir      = path.join(TEMPLATES, newTemplate.folder);
    const manifestPath = path.join(tmplDir, 'manifest.json');

    if (!fs.existsSync(tmplDir)) fs.mkdirSync(tmplDir, { recursive: true });

    const manifest = {
      name        : newTemplate.name,
      price       : newTemplate.price,
      description : newTemplate.description,
      env         : envKeys,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Create placeholder bot.js if not exists
    const botJsPath = path.join(tmplDir, 'bot.js');
    if (!fs.existsSync(botJsPath)) {
      fs.writeFileSync(botJsPath, `// ${newTemplate.name} placeholder\nrequire('dotenv').config();\nconsole.log('Bot started!');\n`);
    }
    const pkgPath = path.join(tmplDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      fs.writeFileSync(pkgPath, JSON.stringify({ name: newTemplate.folder, version: '1.0.0', main: 'bot.js' }, null, 2));
    }

    return ctx.reply(
      `✅ *Shablon qo'shildi!*\n\n` +
      `📦 Nom: ${newTemplate.name}\n` +
      `📁 Papka: ${newTemplate.folder}\n` +
      `💰 Narx: ${newTemplate.price.toLocaleString()} UZS\n` +
      `🔑 ENV: ${envKeys.join(', ')}\n\n` +
      `⚠️ Papkaga haqiqiy bot.js faylini yuklashni unutmang:\n\`${tmplDir}\``,
      { parse_mode: 'Markdown' }
    );
  }

  // ─── Admin balans add ───
  if (step === 'admin_bal_add_id' && ADMIN_IDS.includes(ctx.from.id)) {
    const uid = parseInt(text);
    if (!uid || !getUser(uid)) return ctx.reply('❌ User topilmadi!');
    ctx.session.targetUserId = uid;
    ctx.session.step = 'admin_bal_add_amount';
    return ctx.reply('💰 Miqdorni kiriting (UZS):', cancelBtn);
  }

  if (step === 'admin_bal_add_amount' && ADMIN_IDS.includes(ctx.from.id)) {
    const amount = parseInt(text.replace(/\D/g, ''));
    if (isNaN(amount)) return ctx.reply('❌ Raqam kiriting!');
    const target = getUser(ctx.session.targetUserId);
    target.balance += amount;
    saveUser(target);
    await ctx.telegram.sendMessage(
      target.id,
      `💰 *Adminlar tomonidan balans to'ldirildi.*\nHisobingizga *${amount.toLocaleString()} UZS* qo'shildi.\n💳 Joriy balans: *${target.balance.toLocaleString()} UZS*`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    ctx.session = {};
    return ctx.reply(`✅ ${target.id} ga ${amount.toLocaleString()} UZS qo'shildi.`);
  }

  if (step === 'admin_bal_sub_id' && ADMIN_IDS.includes(ctx.from.id)) {
    const uid = parseInt(text);
    if (!uid || !getUser(uid)) return ctx.reply('❌ User topilmadi!');
    ctx.session.targetUserId = uid;
    ctx.session.step = 'admin_bal_sub_amount';
    return ctx.reply('💰 Ayiriladigan miqdorni kiriting:', cancelBtn);
  }

  if (step === 'admin_bal_sub_amount' && ADMIN_IDS.includes(ctx.from.id)) {
    const amount = parseInt(text.replace(/\D/g, ''));
    if (isNaN(amount)) return ctx.reply('❌ Raqam kiriting!');
    const target   = getUser(ctx.session.targetUserId);
    target.balance = Math.max(0, target.balance - amount);
    saveUser(target);
    ctx.session = {};
    return ctx.reply(`✅ ${target.id} dan ${amount.toLocaleString()} UZS ayirildi.`);
  }

  if (step === 'admin_bal_all_amount' && ADMIN_IDS.includes(ctx.from.id)) {
    const amount = parseInt(text.replace(/\D/g, ''));
    if (isNaN(amount)) return ctx.reply('❌ Raqam kiriting!');
    const users = readDB(DB.users);
    let count = 0;
    for (const user of Object.values(users)) {
      user.balance += amount;
      saveUser(user);
      await ctx.telegram.sendMessage(
        user.id,
        `🎁 *Adminlar tomonidan balans tarqatildi.*\nHisobingizga *${amount.toLocaleString()} UZS* qo'shildi.\n💳 Joriy balans: *${user.balance.toLocaleString()} UZS*`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      count++;
    }
    ctx.session = {};
    return ctx.reply(`✅ ${count} ta foydalanuvchiga ${amount.toLocaleString()} UZS tarqatildi.`);
  }

  // ─── Broadcast ───
  if (step === 'broadcast_msg' && ADMIN_IDS.includes(ctx.from.id)) {
    const users = readDB(DB.users);
    const userList = Object.values(users);
    ctx.session = {};

    let sent = 0, failed = 0;
    await ctx.reply(`📢 Broadcast boshlandi... (${userList.length} ta user)`);

    for (const u of userList) {
      try {
        if (ctx.message.photo) {
          await ctx.telegram.sendPhoto(u.id, ctx.message.photo.slice(-1)[0].file_id, { caption: ctx.message.caption || '' });
        } else if (ctx.message.video) {
          await ctx.telegram.sendVideo(u.id, ctx.message.video.file_id, { caption: ctx.message.caption || '' });
        } else if (ctx.message.text) {
          await ctx.telegram.sendMessage(u.id, ctx.message.text, { parse_mode: 'Markdown' });
        } else {
          await ctx.telegram.forwardMessage(u.id, ctx.chat.id, ctx.message.message_id);
        }
        sent++;
      } catch { failed++; }
      // small delay to avoid flood
      await new Promise(r => setTimeout(r, 50));
    }

    return ctx.reply(`✅ Broadcast tugadi!\n✅ Yuborildi: ${sent}\n❌ Xato: ${failed}`);
  }

  // ─── Settings ───
  if (step === 'settings_card_name' && ADMIN_IDS.includes(ctx.from.id)) {
    ctx.session.cardName = text;
    ctx.session.step = 'settings_card_number';
    return ctx.reply('Karta raqamini kiriting:', cancelBtn);
  }

  if (step === 'settings_card_number' && ADMIN_IDS.includes(ctx.from.id)) {
    const s = getSettings();
    s.card_name   = ctx.session.cardName;
    s.card_number = text.replace(/\s/g, '');
    saveSettings(s);
    ctx.session = {};
    return ctx.reply(`✅ Karta saqlandi: ${s.card_number} (${s.card_name})`);
  }

  if (step === 'settings_stars_price' && ADMIN_IDS.includes(ctx.from.id)) {
    const price = parseInt(text);
    if (isNaN(price)) return ctx.reply('❌ Raqam kiriting!');
    const s = getSettings();
    s.stars_price = price;
    saveSettings(s);
    ctx.session = {};
    return ctx.reply(`✅ 1 Star = ${price} UZS qilib belgilandi.`);
  }

  if (step === 'settings_channel_id' && ADMIN_IDS.includes(ctx.from.id)) {
    const s = getSettings();
    s.channel_id = text === 'none' ? null : text;
    saveSettings(s);
    ctx.session = {};
    return ctx.reply(`✅ Kanal: ${s.channel_id || 'o\'chirildi'}`);
  }

  if (step === 'admin_set_ref_bonus' && ADMIN_IDS.includes(ctx.from.id)) {
    const bonus = parseInt(text.replace(/\D/g, ''));
    if (isNaN(bonus)) return ctx.reply('❌ Raqam kiriting!');
    const s = getSettings();
    s.referral_bonus = bonus;
    saveSettings(s);
    ctx.session = {};
    return ctx.reply(`✅ Referal bonus: ${bonus.toLocaleString()} UZS qilib belgilandi.`);
  }

  // ─── Admin commands ───
  if (text && text.startsWith('/user') && ADMIN_IDS.includes(ctx.from.id)) {
    const uid = parseInt(text.split(' ')[1]);
    const u   = getUser(uid);
    if (!u) return ctx.reply('❌ User topilmadi.');
    return ctx.reply(
      `👤 *User ${uid}*\n\n` +
      `📛 @${u.username || '-'}\n` +
      `💰 Balans: ${u.balance.toLocaleString()} UZS\n` +
      `🤖 Botlar: ${getUserBots(uid).length}\n` +
      `🚫 Bloklangan: ${u.blocked ? 'Ha' : 'Yo\'q'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(u.blocked ? '✅ Blokdan chiqarish' : '🚫 Bloklash', `toggle_block:${uid}`)],
        ]),
      }
    );
  }
});

// ─────────────────────────────────────────────
//  BLOCK / UNBLOCK
// ─────────────────────────────────────────────
bot.action(/^toggle_block:(\d+)$/, adminOnly, ctx => {
  ctx.answerCbQuery();
  const uid  = parseInt(ctx.match[1]);
  const user = getUser(uid);
  if (!user) return;
  user.blocked = !user.blocked;
  saveUser(user);
  ctx.reply(`✅ User ${uid}: ${user.blocked ? '🚫 Bloklandi' : '✅ Blokdan chiqarildi'}`);
});

// ─────────────────────────────────────────────
//  BOT STATUS MONITOR (every 5 min)
// ─────────────────────────────────────────────
setInterval(() => {
  const bots = readDB(DB.bots);
  for (const bot of Object.values(bots)) {
    try {
      const status = pm2Status(bot.id);
      if (status !== bots[bot.id]?.lastStatus) {
        bots[bot.id].lastStatus = status;
        bots[bot.id].statusCheckedAt = Date.now();
        writeDB(DB.bots, bots);

        if (status === 'errored') {
          log('WARN', `Bot ${bot.id} errored. Auto-restarting...`);
          const restarts = pm2RestartCount(bot.id);
          if (restarts < RESTART_LIMIT) {
            pm2Restart(bot.id);
          } else {
            log('ERROR', `Bot ${bot.id} exceeded restart limit. Stopped.`);
          }
        }
      }
    } catch {}
  }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────
//  BACKUP (every 24h)
// ─────────────────────────────────────────────
setInterval(() => {
  try {
    const backupDir = path.join(ROOT, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    const date     = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(backupDir, `backup_${date}.json`);
    const data = {
      users    : readDB(DB.users),
      bots     : readDB(DB.bots),
      payments : readDB(DB.payments),
      tickets  : readDB(DB.tickets),
    };
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
    log('INFO', `Backup created: ${backupPath}`);
    // Keep last 7 backups
    const files = fs.readdirSync(backupDir).sort();
    while (files.length > 7) {
      fs.unlinkSync(path.join(backupDir, files.shift()));
    }
  } catch (e) { log('ERROR', 'Backup failed: ' + e.message); }
}, 24 * 60 * 60 * 1000);

// ─────────────────────────────────────────────
//  ERROR HANDLING
// ─────────────────────────────────────────────
bot.catch((err, ctx) => {
  log('ERROR', `Update ${ctx.update.update_id}: ${err.message}\n${err.stack}`);
  ctx.reply('⚠️ Xato yuz berdi. Iltimos qayta urinib ko\'ring.').catch(() => {});
});

process.on('unhandledRejection', err => log('ERROR', 'Unhandled: ' + err.message));
process.on('uncaughtException',  err => { log('ERROR', 'Uncaught: ' + err.message); });

// ─────────────────────────────────────────────
//  LAUNCH
// ─────────────────────────────────────────────
bot.launch({
  allowedUpdates: ['message', 'callback_query', 'inline_query'],
}).then(() => {
  log('INFO', '🤖 MAKER BOT ishga tushdi!');
}).catch(err => {
  log('ERROR', 'Launch failed: ' + err.message);
  process.exit(1);
});

process.once('SIGINT',  () => { bot.stop('SIGINT');  log('INFO', 'Bot to\'xtatildi (SIGINT)'); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); log('INFO', 'Bot to\'xtatildi (SIGTERM)'); });

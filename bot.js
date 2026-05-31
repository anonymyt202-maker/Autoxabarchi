'use strict';
require('dotenv').config();

/* ═══════════════════════════════════════════════════════
   AUTO XABAR BOT  —  Yagona fayl: bot.js
   npm i telegraf telegram dotenv
   node bot.js
═══════════════════════════════════════════════════════ */

const { Telegraf, Markup }    = require('telegraf');
const { TelegramClient, Api } = require('telegram');
const { StringSession }       = require('telegram/sessions');
const { NewMessage }          = require('telegram/events');
const fs   = require('fs');
const path = require('path');

/* ════════════════════ KONFIGURATSIYA ════════════════════ */
const BOT_TOKEN  = process.env.BOT_TOKEN  || '';
const API_ID     = parseInt(process.env.API_ID  || '0', 10);
const API_HASH   = process.env.API_HASH   || '';
const ADMIN_IDS  = (process.env.ADMIN_IDS || '')
  .split(',').map(x => parseInt(x.trim(), 10)).filter(Boolean);

/* ════════════════════ FAYL YO'LLARI ════════════════════ */
const USERS_FILE    = path.resolve(__dirname, 'users.json');
const ACCOUNTS_FILE = path.resolve(__dirname, 'accounts.json');
const CHANNELS_FILE = path.resolve(__dirname, 'channels.json');
const SESSION_FILE  = path.resolve(__dirname, 'user.session');

/* ════════════════════ FAYLLLARNI YARATISH ════════════════════ */
function initFiles() {
  const defaults = [
    [USERS_FILE,    {}],
    [ACCOUNTS_FILE, {}],
    [CHANNELS_FILE, { forceJoin: [] }],
  ];
  for (const [file, def] of defaults) {
    if (!fs.existsSync(file)) writeJSON(file, def);
  }
  if (!fs.existsSync(SESSION_FILE)) fs.writeFileSync(SESSION_FILE, '');
}

/* ════════════════════ JSON YORDAMCHILARI ════════════════════ */
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('[writeJSON]', e.message); }
}

const getUsers     = ()  => readJSON(USERS_FILE);
const saveUsers    = (d) => writeJSON(USERS_FILE, d);
const getAccounts  = ()  => readJSON(ACCOUNTS_FILE);
const saveAccounts = (d) => writeJSON(ACCOUNTS_FILE, d);
const getChannels  = ()  => readJSON(CHANNELS_FILE);
const saveChannels = (d) => writeJSON(CHANNELS_FILE, d);

function registerUser(userId, username) {
  const users = getUsers();
  if (!users[userId]) {
    users[userId] = { created: new Date().toISOString(), username: username || '' };
    saveUsers(users);
  }
}

function getAccount(userId) {
  return getAccounts()[String(userId)] || null;
}

function patchAccount(userId, patch) {
  const accounts = getAccounts();
  const uid = String(userId);
  accounts[uid] = { ...(accounts[uid] || {}), ...patch };
  saveAccounts(accounts);
}

function deepPatch(userId, key, patch) {
  const acc = getAccount(userId) || {};
  patchAccount(userId, { [key]: { ...(acc[key] || {}), ...patch } });
}

/* ════════════════════ XOTIRA HOLATI ════════════════════ */
/** @type {Map<number, { action: string, data?: any }>} */
const states   = new Map();
/** @type {Map<number, TelegramClient>} */
const clients  = new Map();
/** @type {Map<number, { status: string, timer: NodeJS.Timeout|null }>} */
const tasks    = new Map();
/** @type {Map<number, Function>} */
const replyHnd = new Map();

/* ════════════════════ TELEGRAM USERBOT KLIYENTI ════════════════════ */
async function makeClient(sessionStr = '') {
  const client = new TelegramClient(
    new StringSession(sessionStr),
    API_ID,
    API_HASH,
    {
      connectionRetries: 5,
      retryDelay: 1500,
      autoReconnect: true,
      useWSS: false,
    }
  );
  await client.connect();
  return client;
}

async function getClient(userId) {
  if (clients.has(userId)) {
    const c = clients.get(userId);
    if (!c.connected) { try { await c.connect(); } catch {} }
    return c;
  }
  const acc = getAccount(userId);
  if (!acc?.session) return null;
  try {
    const c = await makeClient(acc.session);
    if (!await c.isUserAuthorized()) return null;
    clients.set(userId, c);
    return c;
  } catch { return null; }
}

/* ════════════════════ BOT ════════════════════ */
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN .env faylida topilmadi!');
  process.exit(1);
}
if (!API_ID || !API_HASH) {
  console.warn('⚠️  API_ID yoki API_HASH yo\'q — profil ulash ishlamaydi!');
}

const bot = new Telegraf(BOT_TOKEN);

/* ════════════════════ KLAVIATURALAR ════════════════════ */
const mainKbd = () =>
  Markup.keyboard([
    ['⚡ Autohabar yuborish', '✨ Autoreply'],
    ['📝 Xabar matni',        "⏳ Tsikl oralig'i"],
    ['👥 Guruhlarni sozlash', '📂 Profillar'],
    ['📊 Kabinet',            "📖 Qo'llanma"],
    ['⚙ Sozlamalar'],
  ]).resize();

const backKbd   = (cb = 'back_main') =>
  Markup.inlineKeyboard([[btn('🔙 Orqaga', cb)]]);

const cancelKbd = () =>
  Markup.inlineKeyboard([[btn('❌ Bekor qilish', 'cancel')]]);

const btn = (label, data) => Markup.button.callback(label, data);

/* ════════════════════ YORDAMCHI FUNKSIYALAR ════════════════════ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fmtMs = (ms) =>
  ms < 3_600_000 ? `${ms / 60_000} daqiqa` : `${ms / 3_600_000} soat`;

const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from?.id);

async function send(ctx, text, kbd) {
  const opts = { parse_mode: 'Markdown', ...kbd };
  if (ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, opts); } catch {}
  }
  return ctx.reply(text, opts);
}

/* ════════════════════ MAJBURIY OBUNA ════════════════════ */
async function checkForceJoin(ctx) {
  const uid  = ctx.from?.id;
  const data = getChannels();
  const list = data.forceJoin || [];
  if (!list.length) return true;

  const notJoined = [];
  for (const ch of list) {
    try {
      const m = await ctx.telegram.getChatMember(ch, uid);
      if (['left', 'kicked'].includes(m.status)) notJoined.push(ch);
    } catch { /* bot kanal adminı emas yoki kanal noto'g'ri */ }
  }
  if (!notJoined.length) return true;

  const btns = notJoined.map((ch) => [
    Markup.button.url(`📢 ${ch}`, `https://t.me/${ch.replace('@', '')}`),
  ]);
  btns.push([btn('✅ Tekshirish', 'check_join')]);

  await ctx.reply(
    "⚠️ Botdan foydalanish uchun quyidagi kanallarga a'zo bo'ling:",
    Markup.inlineKeyboard(btns)
  );
  return false;
}

/* ════════════════════ MIDDLEWARE ════════════════════ */
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const uid = ctx.from.id;
  registerUser(uid, ctx.from.username);
  if (ADMIN_IDS.includes(uid)) return next();
  if (ctx.message || ctx.callbackQuery) {
    const ok = await checkForceJoin(ctx).catch(() => true);
    if (!ok) return;
  }
  return next();
});

/* ════════════════════ /start ════════════════════ */
bot.start(async (ctx) => {
  await ctx.reply(
    `👋 *Auto Xabar* botiga xush kelibsiz!\n\nTelegram guruhlaringizga avtomatik xabar yuborish botiga.\nQuyidagi menyudan foydalaning:`,
    { parse_mode: 'Markdown', ...mainKbd() }
  );
});

/* ════════════════════ /admin ════════════════════ */
bot.command('admin', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id))
    return ctx.reply("❌ Sizda admin huquqi yo'q.");
  await showAdmin(ctx);
});

/* ════════════════════ ASOSIY MENYU ════════════════════ */
bot.hears('📂 Profillar',           (ctx) => showProfiles(ctx));
bot.hears('👥 Guruhlarni sozlash',  (ctx) => showGroups(ctx));
bot.hears('⚡ Autohabar yuborish',  (ctx) => showAutoMsg(ctx));
bot.hears('✨ Autoreply',           (ctx) => showAutoReply(ctx));
bot.hears('📊 Kabinet',             (ctx) => showKabinet(ctx));
bot.hears("📖 Qo'llanma",          (ctx) => showGuide(ctx));
bot.hears('⚙ Sozlamalar',          (ctx) => showSettings(ctx));

bot.hears('📝 Xabar matni', async (ctx) => {
  states.set(ctx.from.id, { action: 'msg_text' });
  await ctx.reply(
    "📝 Yubormoqchi bo'lgan xabar matnini kiriting:",
    cancelKbd()
  );
});

bot.hears("⏳ Tsikl oralig'i", async (ctx) => {
  await ctx.reply("⏳ *Tsikl oralig'ini tanlang:*", {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [btn('5 daqiqa', 'int_5'),  btn('10 daqiqa', 'int_10'), btn('15 daqiqa', 'int_15')],
      [btn('20 daqiqa', 'int_20'), btn('30 daqiqa', 'int_30'), btn('1 soat', 'int_60')],
      [btn('🔙 Orqaga', 'back_main')],
    ]),
  });
});

/* ════════════════════ PROFILLAR ════════════════════ */
async function showProfiles(ctx) {
  const uid    = ctx.from.id;
  const acc    = getAccount(uid);
  const online = clients.has(uid) ? '🟢 Online' : '🔴 Offline';
  const text   = acc?.phone
    ? `📂 *Profillar*\n\n✅ ${acc.phone} — ${online}\n👥 Guruhlar: ${(acc.groups || []).length} ta`
    : "📂 *Profillar*\n\n❌ Hech qanday profil ulanmagan";

  const kbd = Markup.inlineKeyboard([
    [btn('➕ Profil ulash',          'add_profile')],
    [btn("🗑 Profil o'chirish",      'del_profile')],
    [btn('🔁 Profil almashtirish',   'switch_profile')],
    [btn("📋 Profil ro'yxati",       'list_profiles')],
    [btn('🔙 Orqaga',                'back_main')],
  ]);
  await send(ctx, text, kbd);
}

bot.action('add_profile',    (ctx) => startAddProfile(ctx));
bot.action('switch_profile', (ctx) => startAddProfile(ctx));

bot.action('del_profile', async (ctx) => {
  await ctx.answerCbQuery();
  const uid      = ctx.from.id;
  const accounts = getAccounts();

  if (!accounts[uid]?.phone)
    return ctx.editMessageText("❌ O'chiriladigan profil yo'q.", backKbd());

  if (clients.has(uid)) {
    try { await clients.get(uid).disconnect(); } catch {}
    clients.delete(uid);
  }
  stopTask(uid);
  removeReply(uid);
  delete accounts[uid];
  saveAccounts(accounts);
  await ctx.editMessageText("✅ Profil o'chirildi.", backKbd());
});

bot.action('list_profiles', async (ctx) => {
  await ctx.answerCbQuery();
  const uid    = ctx.from.id;
  const acc    = getAccount(uid);
  const status = clients.has(uid) ? '🟢 Online' : '🔴 Offline';
  const text   = acc?.phone
    ? `📋 *Profillar ro'yxati*\n\n${status} ${acc.phone}`
    : "📋 *Profillar ro'yxati*\n\nProfil yo'q";
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...backKbd() });
});

bot.action('open_profiles', async (ctx) => {
  await ctx.answerCbQuery();
  await showProfiles(ctx);
});

async function startAddProfile(ctx) {
  await ctx.answerCbQuery();
  states.set(ctx.from.id, { action: 'phone' });
  await ctx.editMessageText(
    '📱 Telefon raqamingizni kiriting:\n\nMisol: *+998901234567*',
    { parse_mode: 'Markdown', ...cancelKbd() }
  );
}

/* ════════════════════ GURUHLAR ════════════════════ */
async function showGroups(ctx) {
  const uid = ctx.from.id;
  const c   = await getClient(uid);

  if (!c) {
    return ctx.reply(
      "❌ Avval profil ulang!",
      Markup.inlineKeyboard([[btn('📂 Profillar', 'open_profiles')]])
    );
  }

  const loadMsg = await ctx.reply('⏳ Guruhlar yuklanmoqda...');

  try {
    const dialogs = await c.getDialogs({ limit: 200 });
    const groups  = dialogs.filter(
      (d) => d.isGroup || d.isChannel || d.entity?.megagroup
    );

    try { await bot.telegram.deleteMessage(ctx.chat.id, loadMsg.message_id); } catch {}

    if (!groups.length)
      return ctx.reply("❌ Guruhlar topilmadi.");

    states.set(uid, { action: 'groups', data: { groups, page: 0 } });
    const acc = getAccount(uid) || {};
    await renderGroups(ctx, uid, groups, 0, acc.groups || [], false);
  } catch (e) {
    console.error('[showGroups]', e.message);
    await ctx.reply('❌ Guruhlarni olishda xato: ' + e.message);
  }
}

async function renderGroups(ctx, uid, groups, page, selected, editMode) {
  const PAGE_SIZE = 7;
  const start     = page * PAGE_SIZE;
  const slice     = groups.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(groups.length / PAGE_SIZE);

  const rows = slice.map((g, i) => {
    const idx    = start + i;
    const isOn   = selected.some((s) => String(s) === String(g.id));
    const label  = (g.title || 'Nomsiz').slice(0, 22);
    return [btn(`${isOn ? '✅' : '⬜'} ${label}`, `g_${idx}`)];
  });

  const nav = [];
  if (page > 0)                      nav.push(btn('◀️', `gp_${page - 1}`));
  if (start + PAGE_SIZE < groups.length) nav.push(btn('▶️', `gp_${page + 1}`));
  if (nav.length) rows.push(nav);

  rows.push([
    btn('✅ Hammasini tanlash',       'g_all'),
    btn("🗑 Barchani olib tashlash", 'g_none'),
  ]);
  rows.push([btn('💾 Saqlash', 'g_save')]);

  const text = `👥 *Guruhlarni tanlang*\n✅ Tanlangan: ${selected.length} ta  |  📄 ${page + 1}/${totalPages}`;
  const opts = { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) };

  if (editMode || ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, opts); } catch {}
  }
  return ctx.reply(text, opts);
}

bot.action(/^g_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const uid   = ctx.from.id;
  const st    = states.get(uid);
  if (!st || st.action !== 'groups') return;

  const idx   = parseInt(ctx.match[1], 10);
  const group = st.data.groups[idx];
  if (!group) return;

  const gid = String(group.id);
  const acc = getAccount(uid) || {};
  let sel   = (acc.groups || []).map(String);

  sel = sel.includes(gid) ? sel.filter((id) => id !== gid) : [...sel, gid];
  patchAccount(uid, { groups: sel });
  await renderGroups(ctx, uid, st.data.groups, st.data.page, sel, true);
});

bot.action(/^gp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  const st  = states.get(uid);
  if (!st || st.action !== 'groups') return;

  st.data.page = parseInt(ctx.match[1], 10);
  const acc    = getAccount(uid) || {};
  await renderGroups(ctx, uid, st.data.groups, st.data.page, acc.groups || [], true);
});

bot.action('g_all', async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  const st  = states.get(uid);
  if (!st || st.action !== 'groups') return;

  const sel = st.data.groups.map((g) => String(g.id));
  patchAccount(uid, { groups: sel });
  await renderGroups(ctx, uid, st.data.groups, st.data.page, sel, true);
});

bot.action('g_none', async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  const st  = states.get(uid);
  if (!st || st.action !== 'groups') return;

  patchAccount(uid, { groups: [] });
  await renderGroups(ctx, uid, st.data.groups, st.data.page, [], true);
});

bot.action('g_save', async (ctx) => {
  await ctx.answerCbQuery('✅ Saqlandi!');
  const acc = getAccount(ctx.from.id) || {};
  await ctx.editMessageText(
    `✅ ${(acc.groups || []).length} ta guruh saqlandi!`,
    backKbd()
  );
});

/* ════════════════════ AVTO XABAR ════════════════════ */
async function showAutoMsg(ctx) {
  const uid  = ctx.from.id;
  const acc  = getAccount(uid) || {};
  const task = tasks.get(uid);

  const stLabel =
    task?.status === 'running' ? '▶️ Ishlayapti' :
    task?.status === 'paused'  ? '⏸ Pauza'       : "⏹ To'xtatilgan";

  const msgPrev = (acc.autoTask?.message || '—').slice(0, 45);
  const ivl     = fmtMs(acc.autoTask?.interval || 300_000);
  const grpCnt  = (acc.groups || []).length;

  const text =
    `⚡ *Autohabar yuborish*\n\n` +
    `📝 Xabar: ${msgPrev}\n` +
    `⏱ Interval: ${ivl}\n` +
    `👥 Guruhlar: ${grpCnt} ta\n` +
    `📊 Holat: ${stLabel}`;

  const kbd = Markup.inlineKeyboard([
    [
      btn('▶ Boshlash',   't_start'),
      btn('⏸ Pauza',     't_pause'),
      btn("⏹ To'xtatish", 't_stop'),
    ],
    [btn('🔙 Orqaga', 'back_main')],
  ]);
  await send(ctx, text, kbd);
}

bot.action(/^int_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const min = parseInt(ctx.match[1], 10);
  deepPatch(ctx.from.id, 'autoTask', { interval: min * 60_000 });
  await ctx.editMessageText(
    `✅ Interval ${fmtMs(min * 60_000)} ga o'rnatildi.`,
    backKbd()
  );
});

bot.action('t_start', async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  const acc = getAccount(uid) || {};

  if (!acc.autoTask?.message)
    return ctx.answerCbQuery('❌ Avval xabar matnini kiriting!', { show_alert: true });
  if (!(acc.groups || []).length)
    return ctx.answerCbQuery('❌ Avval guruhlarni tanlang!', { show_alert: true });

  const c = await getClient(uid);
  if (!c)
    return ctx.answerCbQuery('❌ Profil ulanmagan!', { show_alert: true });

  startTask(uid, c, acc);
  deepPatch(uid, 'autoTask', { active: true, paused: false });
  await showAutoMsg(ctx);
});

bot.action('t_pause', async (ctx) => {
  await ctx.answerCbQuery();
  const uid  = ctx.from.id;
  const task = tasks.get(uid);
  if (!task)
    return ctx.answerCbQuery("❌ Faol task yo'q", { show_alert: true });

  task.status = task.status === 'paused' ? 'running' : 'paused';
  await showAutoMsg(ctx);
});

bot.action('t_stop', async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  stopTask(uid);
  deepPatch(uid, 'autoTask', { active: false });
  await showAutoMsg(ctx);
});

/* ──── Task ishga tushiruvchi ──── */
function startTask(uid, client, acc) {
  stopTask(uid);

  const groups   = [...(acc.groups || [])].map(String);
  const message  = acc.autoTask.message;
  const interval = acc.autoTask.interval || 300_000;
  let   gIdx     = 0;

  const task = { status: 'running', timer: null };
  tasks.set(uid, task);

  const run = async () => {
    const t = tasks.get(uid);
    if (!t || t.status === 'stopped') return;

    if (t.status === 'paused') {
      t.timer = setTimeout(run, 3_000);
      return;
    }

    const gid = groups[gIdx];
    if (gid) {
      try {
        await client.sendMessage(gid, { message });
        console.log(`[Task ${uid}] ✅ Yuborildi → ${gid}`);
      } catch (e) {
        const fw = (e.message || '').match(/FLOOD_WAIT_?(\d+)/i);
        if (fw) {
          const wait = parseInt(fw[1], 10) * 1_000 + 1_000;
          console.log(`[Task ${uid}] FloodWait ${fw[1]}s`);
          await sleep(wait);
        } else {
          console.error(`[Task ${uid}] Xato ${gid}:`, e.message);
        }
      }
    }

    gIdx = (gIdx + 1) % groups.length;

    // Barcha guruhlardan o'tgach — asosiy intervalda kut
    // Guruhlar orasida tasodifiy kichik kechikish
    const delay = gIdx === 0
      ? interval
      : Math.floor(Math.random() * 3_000) + 2_000;

    t.timer = setTimeout(run, delay);
  };

  task.timer = setTimeout(run, 500);
}

function stopTask(uid) {
  const t = tasks.get(uid);
  if (!t) return;
  if (t.timer) clearTimeout(t.timer);
  t.status = 'stopped';
  tasks.delete(uid);
}

/* ════════════════════ AUTOREPLY ════════════════════ */
async function showAutoReply(ctx) {
  const uid  = ctx.from.id;
  const acc  = getAccount(uid) || {};
  const rep  = acc.autoReply   || {};
  const enSt = rep.enabled
    ? '🟢 Yoqilgan'
    : "🔴 O'chirilgan";
  const modeTxt =
    rep.mode === 'exact'    ? 'Aniq matn'   :
    rep.mode === 'contains' ? "So'z ichida" : 'Barcha xabar';

  const text =
    `✨ *Autoreply*\n\n` +
    `📊 Holat: ${enSt}\n` +
    `⚙️ Rejim: ${modeTxt}\n` +
    `📝 Javob: ${(rep.text || '—').slice(0, 40)}`;

  const kbd = Markup.inlineKeyboard([
    [btn(rep.enabled ? "🔴 O'chirish" : '🟢 Yoqish', 'rep_toggle')],
    [btn('📝 Javob matni', 'rep_text'), btn('⚙️ Rejim', 'rep_mode')],
    [btn('🔙 Orqaga', 'back_main')],
  ]);
  await send(ctx, text, kbd);
}

bot.action('rep_toggle', async (ctx) => {
  await ctx.answerCbQuery();
  const uid = ctx.from.id;
  const acc = getAccount(uid) || {};
  const was = acc.autoReply?.enabled || false;
  deepPatch(uid, 'autoReply', { enabled: !was });
  if (!was) await setupReply(uid);
  else      removeReply(uid);
  await showAutoReply(ctx);
});

bot.action('rep_text', async (ctx) => {
  await ctx.answerCbQuery();
  states.set(ctx.from.id, { action: 'reply_text' });
  await ctx.editMessageText('📝 Autoreply javob matnini kiriting:', cancelKbd());
});

bot.action('rep_mode', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("⚙️ *Autoreply rejimini tanlang:*", {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [btn('📨 Barcha xabar',     'rm_all')],
      [btn('🎯 Aniq matn',        'rm_exact')],
      [btn("🔍 So'z ichida",     'rm_contains')],
      [btn('🔙 Orqaga', 'autoreply_back')],
    ]),
  });
});

bot.action('autoreply_back', async (ctx) => {
  await ctx.answerCbQuery();
  await showAutoReply(ctx);
});

bot.action(/^rm_(all|exact|contains)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const mode = ctx.match[1];
  deepPatch(ctx.from.id, 'autoReply', { mode });

  if (mode !== 'all') {
    states.set(ctx.from.id, { action: 'reply_trigger', data: { mode } });
    const label = mode === 'exact' ? 'Aniq trigger matnini' : "Trigger so'zini";
    await ctx.editMessageText(`🎯 ${label} kiriting:`, cancelKbd());
  } else {
    await ctx.editMessageText('✅ Rejim: Barcha xabar', backKbd('autoreply_back'));
  }
});

/* ──── AutoReply ishga tushiruvchi ──── */
async function setupReply(uid) {
  const c = await getClient(uid);
  if (!c) return;
  removeReply(uid);

  const handler = async (event) => {
    try {
      const acc = getAccount(uid);
      const rep = acc?.autoReply;
      if (!rep?.enabled || !rep?.text) return;

      const msg = event.message;
      if (!msg || msg.out) return;

      // O'z xabarlariga javob bermaslik (anti-loop)
      const me = await c.getMe().catch(() => null);
      if (me && String(msg.senderId) === String(me.id)) return;

      // Faqat tanlangan guruhlarda ishlash
      const grps  = (acc.groups || []).map(String);
      const chatId = String(
        msg.chatId || msg.peerId?.channelId || msg.peerId?.chatId || ''
      );
      if (grps.length && !grps.some((g) => chatId.includes(g.replace('-100', '')))) return;

      const txt    = (msg.text || msg.message || '').trim();
      const mode   = rep.mode || 'all';
      const trig   = (rep.trigger || '').trim();

      const should =
        mode === 'all'      ? true :
        mode === 'exact'    ? txt === trig :
        mode === 'contains' ? txt.toLowerCase().includes(trig.toLowerCase()) : false;

      if (should) {
        await sleep(Math.random() * 1_500 + 500);
        await msg.reply(rep.text);
      }
    } catch (e) {
      console.error('[AutoReply]', e.message);
    }
  };

  c.addEventHandler(handler, new NewMessage({}));
  replyHnd.set(uid, handler);
}

function removeReply(uid) {
  if (!replyHnd.has(uid)) return;
  const c = clients.get(uid);
  if (c) {
    try { c.removeEventHandler(replyHnd.get(uid), new NewMessage({})); } catch {}
  }
  replyHnd.delete(uid);
}

/* ════════════════════ MAJBURIY OBUNA (ADMIN) ════════════════════ */
async function showForceJoin(ctx) {
  const data = getChannels();
  const list = data.forceJoin || [];
  let text   = '📢 *Majburiy obuna kanallar*\n\n';
  if (list.length) {
    list.forEach((ch, i) => { text += `${i + 1}. ${ch}\n`; });
  } else {
    text += "Kanallar yo'q";
  }

  const kbd = Markup.inlineKeyboard([
    [btn("➕ Kanal qo'shish", 'fj_add')],
    [btn("🗑 Barchani o'chirish", 'fj_clear')],
    [btn('🔙 Orqaga', 'admin_panel')],
  ]);
  await send(ctx, text, kbd);
}

bot.action('force_join', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;
  await showForceJoin(ctx);
});

bot.action('fj_add', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;
  states.set(ctx.from.id, { action: 'fj_channel' });
  await ctx.editMessageText(
    '📢 Kanal username kiriting:\nMisol: @mychannel',
    cancelKbd()
  );
});

bot.action('fj_clear', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;
  saveChannels({ forceJoin: [] });
  await ctx.editMessageText(
    '✅ Barcha kanallar tozalandi.',
    backKbd('admin_panel')
  );
});

bot.action('check_join', async (ctx) => {
  await ctx.answerCbQuery('⏳ Tekshirilmoqda...');
  const ok = await checkForceJoin(ctx).catch(() => true);
  if (ok) {
    try { await ctx.editMessageText("✅ Barcha kanallarga obuna bo'lgansiz!"); } catch {}
    await ctx.reply('🏠 Asosiy menyu:', mainKbd());
  }
});

/* ════════════════════ BROADCAST ════════════════════ */
bot.action('broadcast', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;
  states.set(ctx.from.id, { action: 'broadcast' });
  await ctx.editMessageText(
    '📢 Broadcast xabarini kiriting:\n_(❌ Bekor qilish tugmasi)_',
    { parse_mode: 'Markdown', ...cancelKbd() }
  );
});

async function doBroadcast(ctx, message) {
  const users   = Object.keys(getUsers());
  const statusMsg = await ctx.reply(
    `📢 Broadcast boshlandi...\n👥 Jami: ${users.length} ta`
  );

  let ok = 0, fail = 0;
  for (const uid of users) {
    try {
      await bot.telegram.sendMessage(uid, message);
      ok++;
    } catch {
      fail++;
    }
    await sleep(65); // Telegram rate limit
  }

  try {
    await bot.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
  } catch {}

  await ctx.reply(
    `✅ *Broadcast yakunlandi!*\n\n✅ Yuborildi: ${ok}\n❌ Xato: ${fail}`,
    { parse_mode: 'Markdown' }
  );
}

/* ════════════════════ ADMIN PANEL ════════════════════ */
async function showAdmin(ctx) {
  const users    = getUsers();
  const accounts = getAccounts();

  const text =
    `🛠 *Admin Panel*\n\n` +
    `👥 Foydalanuvchilar: ${Object.keys(users).length}\n` +
    `📱 Ulangan profillar: ${Object.values(accounts).filter((a) => a.session).length}\n` +
    `⚡ Faol tasklar: ${tasks.size}\n` +
    `💬 Faol replylar: ${replyHnd.size}`;

  const kbd = Markup.inlineKeyboard([
    [btn('👥 Foydalanuvchilar', 'admin_users'), btn('📢 Broadcast', 'broadcast')],
    [btn('📊 Statistika', 'admin_stats'),       btn('🔒 Majburiy obuna', 'force_join')],
    [btn('🔙 Orqaga', 'back_main')],
  ]);
  await send(ctx, text, kbd);
}

bot.action('admin_panel', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;
  await showAdmin(ctx);
});

bot.action('admin_users', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;

  const users = getUsers();
  const lines = Object.entries(users)
    .slice(0, 30)
    .map(([id, u]) => {
      const un = u.username ? `@${u.username}` : '—';
      const dt = (u.created || '').slice(0, 10);
      return `👤 \`${id}\`  ${un}  ${dt}`;
    });

  await ctx.editMessageText(
    `👥 *Foydalanuvchilar (${Object.keys(users).length} ta)*\n\n${lines.join('\n') || "Yo'q"}`,
    { parse_mode: 'Markdown', ...backKbd('admin_panel') }
  );
});

bot.action('admin_stats', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;

  const text =
    `📊 *Statistika*\n\n` +
    `👥 Jami foydalanuvchilar: ${Object.keys(getUsers()).length}\n` +
    `📱 Ulangan profillar: ${Object.values(getAccounts()).filter((a) => a.session).length}\n` +
    `⚡ Faol tasklar: ${tasks.size}\n` +
    `💬 Faol replylar: ${replyHnd.size}`;

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...backKbd('admin_panel'),
  });
});

/* ════════════════════ KABINET ════════════════════ */
async function showKabinet(ctx) {
  const uid  = ctx.from.id;
  const acc  = getAccount(uid) || {};
  const task = tasks.get(uid);

  const tSt =
    task?.status === 'running' ? '▶️ Ishlayapti' :
    task?.status === 'paused'  ? '⏸ Pauza'       : "—";

  const text =
    `📊 *Kabinet*\n\n` +
    `🆔 ID: \`${uid}\`\n` +
    `📱 Profil: ${acc.phone || 'Ulanmagan'}\n` +
    `👥 Guruhlar: ${(acc.groups || []).length} ta\n` +
    `⚡ Task: ${tSt || "Yo'q"}\n` +
    `✨ Autoreply: ${acc.autoReply?.enabled ? '🟢 Yoqilgan' : "🔴 O'chirilgan"}`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainKbd() });
}

/* ════════════════════ QO'LLANMA ════════════════════ */
async function showGuide(ctx) {
  const text =
    `📖 *Qo'llanma*\n\n` +
    `*1️⃣ Profil ulash*\n` +
    `📂 Profillar ➜ ➕ Profil ulash\n` +
    `Telefon raqam ➜ SMS kod ➜ Login\n\n` +
    `*2️⃣ Guruh tanlash*\n` +
    `👥 Guruhlarni sozlash ➜ Guruhni belgilang ➜ 💾 Saqlash\n\n` +
    `*3️⃣ Xabar matni*\n` +
    `📝 Xabar matni ➜ Matn kiriting\n\n` +
    `*4️⃣ Interval o'rnatish*\n` +
    `⏳ Tsikl oralig'i ➜ Vaqt tanlang\n\n` +
    `*5️⃣ Autohabarni boshlash*\n` +
    `⚡ Autohabar yuborish ➜ ▶ Boshlash\n\n` +
    `*6️⃣ Autoreply*\n` +
    `✨ Autoreply ➜ Rejim ➜ Yoqish\n\n` +
    `*📌 Eslatma*\n` +
    `— Bot faqat tanlangan guruhlarga xabar yuboradi\n` +
    `— FloodWait avtomatik boshqariladi\n` +
    `— Bot qayta ishga tushsa task davom etadi`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainKbd() });
}

/* ════════════════════ SOZLAMALAR ════════════════════ */
async function showSettings(ctx) {
  const uid = ctx.from.id;
  const acc = getAccount(uid) || {};

  const text =
    `⚙️ *Sozlamalar*\n\n` +
    `📱 Hisob: ${acc.phone || "Yo'q"}\n` +
    `⏱ Interval: ${fmtMs(acc.autoTask?.interval || 300_000)}\n` +
    `✨ Autoreply rejim: ${acc.autoReply?.mode || 'all'}\n` +
    `👥 Tanlangan guruhlar: ${(acc.groups || []).length} ta`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainKbd() });
}

/* ════════════════════ ORQAGA / BEKOR ════════════════════ */
bot.action('back_main', async (ctx) => {
  await ctx.answerCbQuery();
  states.delete(ctx.from.id);
  try { await ctx.editMessageText('🏠 Asosiy menyu', mainKbd()); }
  catch { await ctx.reply('🏠 Asosiy menyu', mainKbd()); }
});

bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  states.delete(ctx.from.id);
  try { await ctx.editMessageText('❌ Bekor qilindi.'); } catch {}
  await ctx.reply('🏠 Asosiy menyu', mainKbd());
});

/* ════════════════════ MATN XABARLARI HANDLERı ════════════════════ */
bot.on('text', async (ctx) => {
  const uid  = ctx.from.id;
  const text = ctx.message.text?.trim();
  const st   = states.get(uid);

  if (!st || !text || text.startsWith('/')) return;

  switch (st.action) {
    // ── Login oqimi
    case 'phone':
      await handlePhone(ctx, text);
      break;

    case 'code':
      await handleCode(ctx, text);
      break;

    case '2fa':
      if (st.data?.resolve2fa) {
        st.data.resolve2fa(text);
        states.delete(uid);
      }
      break;

    // ── Xabar matni
    case 'msg_text':
      deepPatch(uid, 'autoTask', { message: text });
      states.delete(uid);
      await ctx.reply('✅ Xabar matni saqlandi!', mainKbd());
      break;

    // ── Autoreply
    case 'reply_text':
      deepPatch(uid, 'autoReply', { text });
      states.delete(uid);
      await ctx.reply('✅ Javob matni saqlandi!', mainKbd());
      break;

    case 'reply_trigger':
      deepPatch(uid, 'autoReply', { trigger: text });
      states.delete(uid);
      await ctx.reply('✅ Trigger so\'z saqlandi!', mainKbd());
      break;

    // ── Broadcast
    case 'broadcast':
      if (!ADMIN_IDS.includes(uid)) { states.delete(uid); break; }
      states.delete(uid);
      await doBroadcast(ctx, text);
      break;

    // ── Force join kanal
    case 'fj_channel':
      if (!ADMIN_IDS.includes(uid)) { states.delete(uid); break; }
      const ch       = text.startsWith('@') ? text : '@' + text;
      const channels = getChannels();
      if (!channels.forceJoin.includes(ch)) channels.forceJoin.push(ch);
      saveChannels(channels);
      states.delete(uid);
      await ctx.reply(`✅ ${ch} kanali qo'shildi!`, mainKbd());
      break;
  }
});

/* ════════════════════ LOGIN OQIMI ════════════════════ */
async function handlePhone(ctx, phone) {
  const uid = ctx.from.id;

  if (!/^\+\d{7,15}$/.test(phone)) {
    return ctx.reply(
      "❌ Noto'g'ri format.\nMisol: *+998901234567*",
      { parse_mode: 'Markdown', ...cancelKbd() }
    );
  }

  const loadMsg = await ctx.reply('⏳ Ulanmoqda...');

  try {
    const client = await makeClient('');
    const result = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);

    states.set(uid, {
      action: 'code',
      data: { client, phone, hash: result.phoneCodeHash },
    });

    try { await bot.telegram.deleteMessage(ctx.chat.id, loadMsg.message_id); } catch {}
    await ctx.reply(
      '📲 Telegram sizga kod yubordi.\nKodni kiriting:',
      cancelKbd()
    );
  } catch (e) {
    console.error('[handlePhone]', e);
    states.delete(uid);
    try { await bot.telegram.deleteMessage(ctx.chat.id, loadMsg.message_id); } catch {}
    await ctx.reply(`❌ Xato: ${e.message}`, mainKbd());
  }
}

async function handleCode(ctx, code) {
  const uid = ctx.from.id;
  const st  = states.get(uid);
  if (!st?.data) return;

  const { client, phone, hash } = st.data;

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash: hash,
        phoneCode: code,
      })
    );
    await finalizeLogin(ctx, uid, client, phone);
  } catch (e) {
    const msg = e.errorMessage || e.message || '';
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      await ask2FA(ctx, uid, client, phone);
    } else {
      console.error('[handleCode]', e);
      states.delete(uid);
      await ctx.reply(`❌ Xato: ${msg}`, mainKbd());
    }
  }
}

function ask2FA(ctx, uid, client, phone) {
  return new Promise((outerResolve) => {
    let resolve2fa;
    const passwordPromise = new Promise((res) => { resolve2fa = res; });

    states.set(uid, {
      action: '2fa',
      data: {
        client,
        phone,
        resolve2fa: (pw) => {
          resolve2fa(pw);
          outerResolve();
        },
      },
    });

    ctx.reply(
      '🔐 Ikki bosqichli himoya yoqilgan.\nParolingizni kiriting:',
      cancelKbd()
    );

    passwordPromise.then(async (password) => {
      try {
        await client.signInWithPassword(
          { apiId: API_ID, apiHash: API_HASH },
          {
            onError: async () => false,
            password: async () => password,
          }
        );
        await finalizeLogin(ctx, uid, client, phone);
      } catch (e) {
        console.error('[2FA]', e.message);
        states.delete(uid);
        await ctx.reply(`❌ Xato parol: ${e.message}`, mainKbd());
      }
    }).catch(() => {});
  });
}

async function finalizeLogin(ctx, uid, client, phone) {
  const session = client.session.save();

  patchAccount(uid, { phone, session, groups: [] });
  clients.set(uid, client);
  states.delete(uid);

  // user.session fayliga yoz
  try {
    fs.appendFileSync(
      SESSION_FILE,
      `${uid}|${phone}|${new Date().toISOString()}\n`
    );
  } catch {}

  await ctx.reply(
    `✅ *Muvaffaqiyatli ulandi!*\n\n📱 Telefon: ${phone}`,
    { parse_mode: 'Markdown', ...mainKbd() }
  );
}

/* ════════════════════ QAYTA ISHGA TUSHISHDAN TIKLASH ════════════════════ */
async function restore() {
  const accounts = getAccounts();
  console.log(`[Restore] ${Object.keys(accounts).length} ta hisob tekshirilmoqda...`);

  for (const [uidStr, acc] of Object.entries(accounts)) {
    if (!acc.session) continue;
    const uid = parseInt(uidStr, 10);

    let client = null;
    try {
      client = await makeClient(acc.session);
      if (!await client.isUserAuthorized()) {
        console.warn(`[Restore ${uid}] Avtorizatsiya yo'q`);
        continue;
      }
      clients.set(uid, client);
      console.log(`[Restore ${uid}] ✅ Kliyent yuklandi`);
    } catch (e) {
      console.warn(`[Restore ${uid}] Kliyent xato: ${e.message}`);
      continue;
    }

    if (acc.autoTask?.active) {
      try {
        startTask(uid, client, acc);
        console.log(`[Restore ${uid}] ✅ Task boshlandi`);
      } catch (e) {
        console.warn(`[Restore ${uid}] Task xato: ${e.message}`);
      }
    }

    if (acc.autoReply?.enabled) {
      try {
        await setupReply(uid);
        console.log(`[Restore ${uid}] ✅ AutoReply boshlandi`);
      } catch (e) {
        console.warn(`[Restore ${uid}] AutoReply xato: ${e.message}`);
      }
    }
  }
}

/* ════════════════════ XATO BOSHQARUVI ════════════════════ */
bot.catch((err, ctx) => {
  console.error('[BotError]', err?.message || err);
  try {
    ctx.reply("❌ Xato yuz berdi. Qayta urinib ko'ring.").catch(() => {});
  } catch {}
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

/* ════════════════════ ISHGA TUSHIRISH ════════════════════ */
initFiles();

bot.launch().then(async () => {
  console.log('');
  console.log('🤖 ═══════════════════════════════════════');
  console.log('   AUTO XABAR BOT — Ishga tushdi!');
  console.log(`   Admin IDs: ${ADMIN_IDS.join(', ') || 'none'}`);
  console.log('═══════════════════════════════════════════');
  console.log('');
  await restore().catch((e) => console.error('[Restore error]', e));
}).catch((err) => {
  console.error('[Launch xato]', err);
  process.exit(1);
});

process.once('SIGINT',  () => { console.log('\n⏹ Bot to\'xtatilmoqda...'); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { console.log('\n⏹ Bot to\'xtatilmoqda...'); bot.stop('SIGTERM'); });

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const db      = require('./database');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const MINIAPP_URL  = process.env.MINIAPP_URL; // https://your-app.vercel.app
const PORT         = process.env.PORT || 3000;

if (!BOT_TOKEN || !BOT_USERNAME || !MINIAPP_URL) {
  console.error('❌ .env da BOT_TOKEN, BOT_USERNAME, MINIAPP_URL kerak!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());

// ════════════════════════════════════════════════════════════
//           TELEGRAM initData VERIFICATION
// ════════════════════════════════════════════════════════════
function verifyTelegramData(initData) {
  try {
    const params   = new URLSearchParams(initData);
    const hash     = params.get('hash');
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return calculatedHash === hash;
  } catch (e) {
    return false;
  }
}

function parseInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const user   = JSON.parse(params.get('user') || '{}');
    return user;
  } catch (e) {
    return null;
  }
}

// Auth middleware
function authMiddleware(req, res, next) {
  const initData = req.headers['x-init-data'];
  if (!initData) return res.status(401).json({ ok: false, error: 'No initData' });

  // Dev mode bypass
  if (process.env.NODE_ENV === 'development') {
    req.tgUser = parseInitData(initData) || { id: 0, username: 'dev' };
    return next();
  }

  if (!verifyTelegramData(initData)) {
    return res.status(403).json({ ok: false, error: 'Invalid initData' });
  }

  const user = parseInitData(initData);
  if (!user) return res.status(403).json({ ok: false, error: 'No user data' });

  req.tgUser = user;
  next();
}

// Rate limit (simple in-memory)
const rateLimitMap = {};
function rateLimit(req, res, next) {
  const id  = req.tgUser?.id || req.ip;
  const now = Date.now();
  if (!rateLimitMap[id]) rateLimitMap[id] = [];
  rateLimitMap[id] = rateLimitMap[id].filter(t => now - t < 10000);
  if (rateLimitMap[id].length > 15) {
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
  }
  rateLimitMap[id].push(now);
  next();
}

// ════════════════════════════════════════════════════════════
//                     REST API ENDPOINTS
// ════════════════════════════════════════════════════════════

// ── GET /api/user ──────────────────────────────────────────
app.get('/api/user', authMiddleware, rateLimit, (req, res) => {
  const { id, username, first_name, photo_url } = req.tgUser;

  let user = db.getUser(id);
  if (!user) {
    user = db.upsertUser(id, { id, username, firstName: first_name, photoUrl: photo_url });
  } else {
    user = db.upsertUser(id, { username, firstName: first_name, photoUrl: photo_url });
  }

  const battles = db.getUserBattles(id);
  res.json({
    ok: true,
    user: {
      ...user,
      createdBattles: battles.length,
      activeBattles:  battles.filter(b => b.active && !b.finished).length,
    }
  });
});

// ── GET /api/battles ───────────────────────────────────────
app.get('/api/battles', authMiddleware, rateLimit, (req, res) => {
  const battles = db.getUserBattles(req.tgUser.id);
  res.json({ ok: true, battles });
});

// ── GET /api/stats ─────────────────────────────────────────
app.get('/api/stats', authMiddleware, rateLimit, (req, res) => {
  res.json({ ok: true, stats: db.getStats() });
});

// ── POST /api/channel/check ────────────────────────────────
app.post('/api/channel/check', authMiddleware, rateLimit, async (req, res) => {
  const { channel } = req.body;
  if (!channel) return res.status(400).json({ ok: false, error: 'channel required' });

  let ch = channel.trim();
  if (!ch.startsWith('@')) ch = '@' + ch;

  try {
    const me = await bot.telegram.getChatMember(ch, (await bot.telegram.getMe()).id);
    if (!['administrator', 'creator'].includes(me.status)) {
      return res.json({ ok: false, isAdmin: false, error: 'Bot kanalda admin emas' });
    }
    const info = await bot.telegram.getChat(ch);
    res.json({ ok: true, isAdmin: true, channelTitle: info.title, channelUsername: ch });
  } catch (e) {
    res.json({ ok: false, isAdmin: false, error: 'Kanal topilmadi: ' + e.message });
  }
});

// ── POST /api/battle/create ────────────────────────────────
app.post('/api/battle/create', authMiddleware, rateLimit, async (req, res) => {
  const { name, channel, target, reward, buttonText, imageUrl } = req.body;

  if (!name || !channel || !target || !reward) {
    return res.status(400).json({ ok: false, error: 'Barcha maydonlar to\'ldirilishi kerak' });
  }

  if (typeof target !== 'number' || target < 1 || target > 10000) {
    return res.status(400).json({ ok: false, error: 'Target 1-10000 orasida bo\'lishi kerak' });
  }

  const user  = req.tgUser;
  const dbUser = db.getUser(user.id);
  if (dbUser?.banned) return res.status(403).json({ ok: false, error: 'Siz ban qilingansiz' });

  let ch = channel.trim();
  if (!ch.startsWith('@')) ch = '@' + ch;

  // Bot admin tekshiruvi
  try {
    const me = await bot.telegram.getChatMember(ch, (await bot.telegram.getMe()).id);
    if (!['administrator', 'creator'].includes(me.status)) {
      return res.json({ ok: false, error: 'Bot kanalda admin emas' });
    }
  } catch (e) {
    return res.json({ ok: false, error: 'Kanal topilmadi: ' + e.message });
  }

  // Create battle in DB
  const battle = db.createBattle({
    ownerId:       user.id,
    ownerUsername: user.username,
    name:          name.trim().substring(0, 100),
    channel:       ch,
    target:        Number(target),
    reward:        reward.trim().substring(0, 200),
    buttonText:    (buttonText || 'Ovoz berish').substring(0, 50),
    imageUrl:      imageUrl || null,
  });

  // Post to channel
  try {
    const postText = buildBattlePost(battle);
    const keyboard = buildBattleKeyboard(battle);
    let msg;
    if (imageUrl) {
      msg = await bot.telegram.sendPhoto(ch, imageUrl, {
        caption: postText, parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup
      });
    } else {
      msg = await bot.telegram.sendMessage(ch, postText, {
        parse_mode: 'HTML', reply_markup: keyboard.reply_markup
      });
    }
    db.updateBattle(battle.battleId, { messageId: msg.message_id });
    battle.messageId = msg.message_id;
  } catch (e) {
    db.deleteBattle(battle.battleId);
    return res.json({ ok: false, error: 'Kanalga post yubora olmadi: ' + e.message });
  }

  res.json({ ok: true, battle });
});

// ── POST /api/vote ─────────────────────────────────────────
app.post('/api/vote', authMiddleware, rateLimit, async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ ok: false, error: 'battleId required' });

  const user   = req.tgUser;
  const battle = db.getBattle(battleId);
  if (!battle)        return res.json({ ok: false, error: 'Battle topilmadi' });
  if (!battle.active) return res.json({ ok: false, error: 'Battle tugagan' });

  if (db.hasVoted(battleId, user.id)) {
    return res.json({ ok: false, error: 'Siz allaqachon ovoz bergansiz' });
  }

  const result = db.castVote(battleId, user.id, user.username);
  if (!result.ok) return res.json({ ok: false, error: 'Ovoz berib bo\'lmadi' });

  const updated = db.getBattle(battleId);
  await updateChannelPost(updated);

  let finished = false;
  if (updated.voteCount >= updated.target) {
    finished = true;
    await finishBattle(updated, user);
  }

  res.json({ ok: true, voteCount: updated.voteCount, finished });
});

// ── DELETE /api/battle/:id (Admin) ─────────────────────────
app.delete('/api/battle/:id', authMiddleware, rateLimit, (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) {
    return res.status(403).json({ ok: false, error: 'Admin emas' });
  }
  const ok = db.deleteBattle(req.params.id);
  res.json({ ok });
});

// ── POST /api/admin/close (Admin) ─────────────────────────
app.post('/api/admin/close', authMiddleware, rateLimit, async (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) return res.status(403).json({ ok: false, error: 'Admin emas' });
  const { battleId } = req.body;
  const battle = db.getBattle(battleId);
  if (!battle) return res.json({ ok: false, error: 'Battle topilmadi' });

  db.updateBattle(battleId, { active: false, finished: true });
  try {
    await bot.telegram.sendMessage(battle.channel,
      `⛔ <b>Battle to'xtatildi</b>\n\n🎁 Sovrin: ${battle.reward}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {}
  res.json({ ok: true });
});

// ── POST /api/admin/ban (Admin) ────────────────────────────
app.post('/api/admin/ban', authMiddleware, rateLimit, (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) return res.status(403).json({ ok: false, error: 'Admin emas' });
  const { userId, banned } = req.body;
  db.banUser(userId, banned !== false);
  res.json({ ok: true });
});

// ── POST /api/admin/broadcast (Admin) ─────────────────────
app.post('/api/admin/broadcast', authMiddleware, rateLimit, async (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) return res.status(403).json({ ok: false, error: 'Admin emas' });
  const { text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });

  const users = db.getAllUsers();
  let sent = 0, failed = 0;

  for (const u of users) {
    try {
      await bot.telegram.sendMessage(u.id, text, { parse_mode: 'HTML' });
      sent++;
    } catch (e) { failed++; }
    await new Promise(r => setTimeout(r, 55));
  }

  res.json({ ok: true, sent, failed });
});

// ── GET /api/admin/stats (Admin) ──────────────────────────
app.get('/api/admin/stats', authMiddleware, rateLimit, (req, res) => {
  if (!db.isAdmin(req.tgUser.id)) return res.status(403).json({ ok: false, error: 'Admin emas' });
  const stats   = db.getStats();
  const battles = db.getAllBattles().slice(0, 50);
  const users   = db.getAllUsers().slice(0, 50);
  res.json({ ok: true, stats, battles, users });
});

// ── GET /api/battle/:id/check-vote ────────────────────────
app.get('/api/battle/:id/check-vote', authMiddleware, rateLimit, (req, res) => {
  const voted = db.hasVoted(req.params.id, req.tgUser.id);
  res.json({ ok: true, voted });
});

// ════════════════════════════════════════════════════════════
//                  CHANNEL POST HELPERS
// ════════════════════════════════════════════════════════════
function buildBattlePost(battle) {
  const bar = buildProgressBar(battle.voteCount, battle.target);
  return (
    `🏆 <b>${battle.name}</b>\n\n` +
    `🎁 <b>Sovrin:</b> ${battle.reward}\n` +
    `🎯 <b>Maqsad:</b> ${battle.target} ta ovoz\n\n` +
    `📊 <b>Holat:</b>\n${bar}\n` +
    `<b>${battle.voteCount}</b> / ${battle.target} ovoz\n\n` +
    `❗ <b>Shartlar:</b>\n• Kanalga obuna bo'lish\n• Pastdagi tugmani bosish`
  );
}

function buildProgressBar(current, target) {
  const pct    = Math.min(Math.floor((current / target) * 10), 10);
  const filled = '🟦'.repeat(pct);
  const empty  = '⬜'.repeat(10 - pct);
  return filled + empty + ` ${Math.floor((current / target) * 100)}%`;
}

function buildBattleKeyboard(battle) {
  const voteUrl = `https://t.me/${BOT_USERNAME}?start=vote_${battle.battleId}`;
  return Markup.inlineKeyboard([
    [Markup.button.url(`🗳 ${battle.buttonText}`, voteUrl)],
    [Markup.button.url('📊 Natijalar', `https://t.me/${BOT_USERNAME}?start=res_${battle.battleId}`)]
  ]);
}

async function updateChannelPost(battle) {
  if (!battle.messageId) return;
  try {
    const text = buildBattlePost(battle);
    if (battle.imageUrl) {
      await bot.telegram.editMessageCaption(battle.channel, battle.messageId, null, text, {
        parse_mode: 'HTML', reply_markup: buildBattleKeyboard(battle).reply_markup
      });
    } else {
      await bot.telegram.editMessageText(battle.channel, battle.messageId, null, text, {
        parse_mode: 'HTML', reply_markup: buildBattleKeyboard(battle).reply_markup
      });
    }
  } catch (e) { console.log('[POST]', e.message); }
}

async function finishBattle(battle, lastVoter) {
  db.updateBattle(battle.battleId, {
    active: false, finished: true,
    winner: { userId: lastVoter.id, username: lastVoter.username }
  });

  // Update owner stats
  const owner = db.getUser(battle.ownerId);
  if (owner) {
    db.upsertUser(battle.ownerId, {
      activeBattles: Math.max(0, (owner.activeBattles || 1) - 1),
      wins: (owner.wins || 0) + 1,
    });
  }

  try {
    await bot.telegram.sendMessage(
      battle.channel,
      `🏆 <b>BATTLE YAKUNLANDI!</b>\n\n` +
      `🎉 <b>Maqsadga yetildi!</b>\n\n` +
      `📊 Jami ovozlar: <b>${battle.voteCount}</b>\n` +
      `🥇 So'nggi ovoz: @${lastVoter.username || lastVoter.id}\n\n` +
      `🎁 Sovrin: ${battle.reward}\n\n` +
      `Barcha ishtirokchilarga rahmat!`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {}

  try {
    await bot.telegram.sendMessage(
      battle.ownerId,
      `🏆 <b>Battleingiz yakunlandi!</b>\n\n` +
      `📊 Ovozlar: ${battle.voteCount}/${battle.target}\n` +
      `🎁 Sovrin: ${battle.reward}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════
//                      TELEGRAM BOT
// ════════════════════════════════════════════════════════════
const states     = {};
const setState   = (id, s) => { states[String(id)] = s; };
const getState   = (id)    => states[String(id)] || null;
const clearState = (id)    => { delete states[String(id)]; };

const mainMenu = () => Markup.keyboard([
  [Markup.button.webApp('🎤 Battle yaratish', `${MINIAPP_URL}`)],
  ['📋 Battlelarim', '📊 Statistika'],
  ['ℹ️ Yordam']
]).resize();

const cancelMenu = () => Markup.keyboard([['❌ Bekor qilish']]).resize();

// ── /start ─────────────────────────────────────────────────
bot.start(async (ctx) => {
  const payload = ctx.startPayload || '';
  const u       = ctx.from;

  db.upsertUser(u.id, {
    id: u.id, username: u.username || null,
    firstName: u.first_name, joinedAt: Date.now()
  });

  const user = db.getUser(u.id);
  if (user?.banned) return ctx.reply('🚫 Siz ban qilingansiz.');

  // vote_{battleId}
  if (payload.startsWith('vote_')) {
    const battleId = payload.slice(5);
    const battle   = db.getBattle(battleId);
    if (!battle || !battle.active) return ctx.reply('❌ Battle topilmadi yoki tugagan.');

    if (db.hasVoted(battleId, u.id)) {
      return ctx.reply(
        `❌ Siz allaqachon ovoz bergansiz!\n\n📊 Hozirgi ovozlar: <b>${battle.voteCount}</b>/${battle.target}`,
        { parse_mode: 'HTML' }
      );
    }

    const result = db.castVote(battleId, u.id, u.username);
    if (!result.ok) return ctx.reply('❌ Ovoz berib bo\'lmadi.');

    const updated = db.getBattle(battleId);
    await updateChannelPost(updated);

    if (updated.voteCount >= updated.target) {
      await finishBattle(updated, u);
      return ctx.reply(
        `✅ <b>Ovoz berdingiz va BATTLE YAKUNLANDI!</b>\n\n🏆 Maqsadga yetildi!\n📊 Jami: ${updated.voteCount} ovoz`,
        { parse_mode: 'HTML' }
      );
    }

    return ctx.reply(
      `✅ <b>Ovozingiz qabul qilindi!</b>\n\n📊 Hozirgi: <b>${updated.voteCount}</b>/${updated.target}\n🎁 Sovrin: ${battle.reward}`,
      { parse_mode: 'HTML' }
    );
  }

  // res_{battleId}
  if (payload.startsWith('res_')) {
    const battleId = payload.slice(4);
    const battle   = db.getBattle(battleId);
    if (!battle) return ctx.reply('❌ Battle topilmadi.');

    const bar = buildProgressBar(battle.voteCount, battle.target);
    return ctx.reply(
      `📊 <b>${battle.name}</b>\n\n` +
      `${bar}\n<b>${battle.voteCount}</b>/${battle.target} ovoz\n\n` +
      `📌 Holat: ${battle.finished ? '✅ Yakunlandi' : '🟢 Aktiv'}\n` +
      `🎁 Sovrin: ${battle.reward}`,
      { parse_mode: 'HTML' }
    );
  }

  await ctx.reply(
    `👋 Salom, <b>${u.first_name}</b>!\n\n` +
    `🎤 <b>Ovoz Battle Bot</b>ga xush kelibsiz!\n\n` +
    `📱 Mini App orqali battle yarating va boshqaring!`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

// ── Battlelarim ────────────────────────────────────────────
bot.hears('📋 Battlelarim', async (ctx) => {
  const battles = db.getUserBattles(ctx.from.id);
  if (battles.length === 0) return ctx.reply('📋 Sizda hali battle yo\'q.\n\nMini App orqali yarating!', mainMenu());

  const active   = battles.filter(b => b.active && !b.finished);
  const finished = battles.filter(b => b.finished);

  const btns = [
    ...active.slice(0, 5).map(b => [
      Markup.button.callback(`🟢 ${b.name.substring(0, 25)} (${b.voteCount}/${b.target})`, `bv_${b.battleId}`)
    ]),
    ...finished.slice(0, 3).map(b => [
      Markup.button.callback(`✅ ${b.name.substring(0, 25)}`, `bv_${b.battleId}`)
    ])
  ];

  await ctx.reply(
    `📋 <b>Battlelarim</b>\n\n🟢 Aktiv: ${active.length}\n✅ Yakunlangan: ${finished.length}`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) }
  );
});

bot.action(/^bv_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battle = db.getBattle(ctx.match[1]);
  if (!battle) return;
  const bar = buildProgressBar(battle.voteCount, battle.target);
  await ctx.editMessageText(
    `📊 <b>${battle.name}</b>\n\n` +
    `${bar}\n<b>${battle.voteCount}</b>/${battle.target} ovoz\n\n` +
    `📢 Kanal: ${battle.channel}\n🎁 Sovrin: ${battle.reward}\n` +
    `📌 Holat: ${battle.finished ? '✅ Yakunlandi' : '🟢 Aktiv'}`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⛔ Battle yopish', `bclose_${battle.battleId}`)],
        [Markup.button.callback('◀️ Orqaga', 'back_battles')]
      ]).reply_markup
    }
  );
});

bot.action(/^bclose_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battle = db.getBattle(ctx.match[1]);
  if (!battle || battle.ownerId !== ctx.from.id) return;
  db.updateBattle(battle.battleId, { active: false, finished: true });
  try {
    await bot.telegram.sendMessage(
      battle.channel,
      `⛔ <b>Battle to'xtatildi</b>\n\n🎁 Sovrin: ${battle.reward}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {}
  await ctx.editMessageText('⛔ Battle to\'xtatildi.');
});

bot.action('back_battles', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
});

// ── Statistika ─────────────────────────────────────────────
bot.hears('📊 Statistika', async (ctx) => {
  const stats   = db.getStats();
  const user    = db.getUser(ctx.from.id);
  const battles = db.getUserBattles(ctx.from.id);
  await ctx.reply(
    `📊 <b>Statistika</b>\n\n` +
    `👤 <b>Mening:</b>\n` +
    `🎤 Yaratgan battlelar: ${battles.length}\n` +
    `🟢 Aktiv battlelar: ${battles.filter(b => !b.finished).length}\n\n` +
    `🌍 <b>Umumiy:</b>\n` +
    `🎤 Jami battlelar: ${stats.totalBattles}\n` +
    `🟢 Faol battlelar: ${stats.activeBattles}\n` +
    `✅ Tugagan: ${stats.finishedBattles}\n` +
    `👥 Foydalanuvchilar: ${stats.totalUsers}\n` +
    `📦 Jami ovozlar: ${stats.totalVotes}`,
    { parse_mode: 'HTML' }
  );
});

// ── Yordam ─────────────────────────────────────────────────
bot.hears('ℹ️ Yordam', async (ctx) => {
  await ctx.reply(
    `ℹ️ <b>Qo'llanma</b>\n\n` +
    `1️⃣ <b>Battle yaratish:</b>\n   Mini App ni oching → formani to'ldiring\n\n` +
    `2️⃣ <b>Ovoz berish:</b>\n   Kanal postidagi tugmani bosing\n\n` +
    `3️⃣ <b>Battle tugashi:</b>\n   Maqsad ovozga yetganda avto yakunlanadi\n\n` +
    `📱 Mini Appni ochish uchun:\n<b>🎤 Battle yaratish</b> tugmasini bosing`,
    { parse_mode: 'HTML' }
  );
});

// ── Admin panel ─────────────────────────────────────────────
bot.command('admin', async (ctx) => {
  if (!db.isAdmin(ctx.from.id)) return ctx.reply('❌ Ruxsat yo\'q.');
  const stats = db.getStats();
  await ctx.reply(
    `⚙️ <b>Admin Panel</b>\n\n` +
    `👥 Foydalanuvchilar: ${stats.totalUsers}\n` +
    `🎤 Jami battlelar: ${stats.totalBattles}\n` +
    `🟢 Aktiv: ${stats.activeBattles}\n` +
    `📦 Jami ovozlar: ${stats.totalVotes}`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('📱 Admin Mini App', `${MINIAPP_URL}?admin=1`)],
        [Markup.button.callback('📢 Broadcast', 'adm_bc'),
         Markup.button.callback('📊 Statistika', 'adm_stats')],
        [Markup.button.callback('📋 Battlelar', 'adm_battles')]
      ])
    }
  );
});

bot.action('adm_bc', async (ctx) => {
  await ctx.answerCbQuery();
  setState(ctx.from.id, { step: 'broadcast' });
  await ctx.reply('📢 Broadcast xabarini yuboring:', cancelMenu());
});

bot.action('adm_stats', async (ctx) => {
  await ctx.answerCbQuery();
  const s = db.getStats();
  await ctx.editMessageText(
    `📊 <b>Bot Statistikasi</b>\n\n` +
    `👥 Foydalanuvchilar: ${s.totalUsers}\n🚫 Banlangan: ${s.bannedUsers}\n` +
    `🎤 Jami battlelar: ${s.totalBattles}\n🟢 Aktiv: ${s.activeBattles}\n` +
    `✅ Tugagan: ${s.finishedBattles}\n📦 Ovozlar: ${s.totalVotes}`,
    { parse_mode: 'HTML' }
  );
});

bot.action('adm_battles', async (ctx) => {
  await ctx.answerCbQuery();
  const battles = db.getAllBattles().slice(0, 20);
  let text = `📋 <b>Battlelar (${battles.length})</b>\n\n`;
  battles.forEach(b => {
    text += `${b.finished ? '✅' : '🟢'} ${b.name.substring(0, 20)} | ${b.voteCount}/${b.target}\n`;
  });
  await ctx.editMessageText(text || 'Yo\'q.', { parse_mode: 'HTML' });
});

bot.on('text', async (ctx) => {
  const state = getState(ctx.from.id);
  if (!state) return;
  const text = ctx.message.text.trim();

  if (text === '❌ Bekor qilish') { clearState(ctx.from.id); return ctx.reply('❌ Bekor.', mainMenu()); }

  if (state.step === 'broadcast' && db.isAdmin(ctx.from.id)) {
    clearState(ctx.from.id);
    const users = db.getAllUsers();
    let sent = 0, failed = 0;
    await ctx.reply(`📢 ${users.length} ta foydalanuvchiga yuborilmoqda...`);
    for (const u of users) {
      try { await bot.telegram.sendMessage(u.id, text, { parse_mode: 'HTML' }); sent++; }
      catch (e) { failed++; }
      await new Promise(r => setTimeout(r, 55));
    }
    return ctx.reply(`✅ Yuborildi: ${sent}\n❌ Xato: ${failed}`, mainMenu());
  }
});

bot.catch((err, ctx) => {
  console.error('[BOT ERROR]', err.message);
  try {
    if (ctx.callbackQuery) ctx.answerCbQuery('❌ Xato.').catch(() => {});
  } catch (_) {}
});

// ════════════════════════════════════════════════════════════
//                    START SERVERS
// ════════════════════════════════════════════════════════════
async function main() {
  // Start Express API
  app.listen(PORT, () => {
    console.log(`✅ API server: http://localhost:${PORT}`);
  });

  // Start Bot
  await bot.launch({ allowedUpdates: ['message', 'callback_query'] });
  console.log(`✅ Bot ishga tushdi! @${BOT_USERNAME}`);
  console.log(`📱 Mini App: ${MINIAPP_URL}`);
}

main().catch(err => {
  console.error('❌ Start xato:', err.message);
  process.exit(1);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

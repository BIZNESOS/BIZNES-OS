/**
 * BIZNES OS — Telegram bot
 * ---------------------------------------------------------------
 * Handles:
 *  - phone verification during registration (/start <phoneKey>)
 *  - tariff payment requisites (/start pay_<phoneKey>_<tariffCode>)
 *  - receiving payment receipts (photos) and forwarding them to the admin
 *  - admin approve/reject buttons that activate the subscription in Firebase
 *  - a daily job that reminds users 1 day before expiry and marks expired ones
 *
 * This process must run continuously on a server (VPS, Railway, Render, etc.) —
 * it CANNOT run inside the static BIZNES_OS.html file, which has no backend.
 *
 * Setup: see README.md in this folder.
 * ---------------------------------------------------------------
 */

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const cron = require('node-cron');

/* ---------------------------- Config ---------------------------- */
const BOT_TOKEN = process.env.BOT_TOKEN || 'PUT_YOUR_BOT_TOKEN_HERE'; // from @BotFather
const ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || ''; // fill in after running /myid once, see README
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
const DATABASE_URL = process.env.DATABASE_URL || 'https://biznesos-default-rtdb.firebaseio.com';

const TARIFFS = {
  standard: { name: 'Стандарт', months: 1, price: 399 },
  plus:     { name: 'Плюс',     months: 6, price: 288 },
  pro:      { name: 'Про',      months: 12, price: 199 }
};
function tariffTotal(t) { return t.price * t.months; }
function firstPurchasePrice(t) { return Math.round(tariffTotal(t) * 0.5); }
function renewalPrice(t) { return tariffTotal(t) * 2; }

// TODO: replace with your real payment details
const PAYMENT_REQUISITES =
  'Карта: 0000 0000 0000 0000\n' +
  'Получатель: [Имя Фамилия]\n' +
  'Банк: [Название банка]\n' +
  'Телефон для перевода: [+992 ...]';

/* ---------------------------- Init ---------------------------- */
let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error('Could not load service account JSON at', SERVICE_ACCOUNT_PATH);
  console.error('Download it from Firebase console → Project settings → Service accounts → Generate new private key.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL
});
const db = admin.database();

if (!BOT_TOKEN || BOT_TOKEN === 'PUT_YOUR_BOT_TOKEN_HERE') {
  console.error('Set BOT_TOKEN (env var) to the token you got from @BotFather.');
  process.exit(1);
}
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('BIZNES OS Telegram bot started (polling mode).');

/* ---------------------------- Helpers ---------------------------- */
async function getUser(phoneKey) {
  const snap = await db.ref('users/' + phoneKey).get();
  return snap.exists() ? snap.val() : null;
}
async function updateUser(phoneKey, patch) {
  return db.ref('users/' + phoneKey).update(patch);
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function money(n) { return Math.round(n).toLocaleString('ru-RU') + ' с.'; }

/* ---------------------------- /myid — helper to find your own chat id ---------------------------- */
bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Ваш chat_id: `' + msg.chat.id + '`\nУкажите его в переменной окружения ADMIN_TELEGRAM_CHAT_ID.', { parse_mode: 'Markdown' });
});

/* ---------------------------- /start — verification & payment entry points ---------------------------- */
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const payload = (match && match[1]) ? match[1].trim() : '';

  if (!payload) {
    bot.sendMessage(chatId, 'Здравствуйте! Это бот BIZNES OS. Откройте ссылку из приложения, чтобы подтвердить номер или оплатить тариф.');
    return;
  }

  // Payment flow: pay_<phoneKey>_<tariffCode>
  if (payload.startsWith('pay_')) {
    const parts = payload.split('_');
    const phoneKey = parts[1];
    const tariffCode = parts[2];
    const tariff = TARIFFS[tariffCode];
    const user = await getUser(phoneKey);
    if (!user || !tariff) { bot.sendMessage(chatId, 'Заявка не найдена. Вернитесь в приложение и попробуйте снова.'); return; }

    const firstPurchase = !(user.subscription && user.subscription.firstPurchaseUsed);
    const wasActiveBefore = user.subscription && user.subscription.tariff && user.subscription.status !== 'active';
    const price = firstPurchase ? firstPurchasePrice(tariff) : (wasActiveBefore ? renewalPrice(tariff) : tariffTotal(tariff));

    // remember which chat is paying, so a later photo can be matched to the user
    await db.ref('chatIndex/' + chatId).set(phoneKey);

    bot.sendMessage(chatId,
      'Тариф «' + tariff.name + '» (' + tariff.months + ' мес.)\n' +
      'К оплате: *' + money(price) + '*\n\n' +
      'Реквизиты для оплаты:\n' + PAYMENT_REQUISITES + '\n\n' +
      'После оплаты пришлите сюда *фото или скан чека* — мы проверим и активируем доступ.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Verification flow: payload is the phoneKey
  const phoneKey = payload;
  const user = await getUser(phoneKey);
  if (!user) { bot.sendMessage(chatId, 'Аккаунт не найден. Проверьте, что регистрация в приложении завершена.'); return; }
  if (user.telegram && user.telegram.verified) { bot.sendMessage(chatId, 'Этот номер уже подтверждён. Возвращайтесь в приложение.'); return; }

  await db.ref('chatIndex/' + chatId).set(phoneKey);
  bot.sendMessage(chatId,
    'Здравствуйте, ' + (user.fio || '') + '!\n' +
    'Компания: ' + (user.company || '—') + '\n\n' +
    'Нажмите «Подтвердить», чтобы завершить регистрацию в BIZNES OS.',
    { reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: 'verify_' + phoneKey }]] } }
  );
});

/* ---------------------------- Inline button callbacks ---------------------------- */
bot.on('callback_query', async (query) => {
  const data = query.data || '';
  const chatId = query.message.chat.id;

  if (data.startsWith('verify_')) {
    const phoneKey = data.slice('verify_'.length);
    await updateUser(phoneKey, { 'telegram/verified': true, 'telegram/chatId': chatId });
    bot.answerCallbackQuery(query.id, { text: 'Подтверждено!' });
    bot.editMessageText('✅ Номер подтверждён. Возвращайтесь в приложение — он обновится автоматически.', {
      chat_id: chatId, message_id: query.message.message_id
    });
    return;
  }

  if (data.startsWith('approve_') || data.startsWith('reject_')) {
    // format: approve_<phoneKey>_<tariffCode>  /  reject_<phoneKey>
    const isApprove = data.startsWith('approve_');
    const rest = data.slice(data.indexOf('_') + 1);
    const [phoneKey, tariffCode] = rest.split('_');
    const user = await getUser(phoneKey);
    if (!user) { bot.answerCallbackQuery(query.id, { text: 'Пользователь не найден' }); return; }
    const payerChatId = (user.telegram && user.telegram.chatId) || null;

    if (isApprove) {
      const tariff = TARIFFS[tariffCode];
      const now = new Date();
      const expires = new Date(now);
      expires.setMonth(expires.getMonth() + (tariff ? tariff.months : 1));
      await updateUser(phoneKey, {
        subscription: { tariff: tariffCode, status: 'active', startAt: now.toISOString(), expiresAt: expires.toISOString(), firstPurchaseUsed: true },
        pendingPayment: null,
        remindedExpiry: null
      });
      bot.answerCallbackQuery(query.id, { text: 'Оплата подтверждена' });
      bot.editMessageCaption('✅ Подтверждено — доступ открыт до ' + fmtDate(expires.toISOString()), { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
      if (payerChatId) bot.sendMessage(payerChatId, '✅ Оплата подтверждена! Тариф «' + (tariff ? tariff.name : tariffCode) + '» активен до ' + fmtDate(expires.toISOString()) + '. Возвращайтесь в приложение.');
    } else {
      await updateUser(phoneKey, { pendingPayment: null });
      bot.answerCallbackQuery(query.id, { text: 'Отклонено' });
      bot.editMessageCaption('❌ Чек отклонён', { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
      if (payerChatId) bot.sendMessage(payerChatId, 'К сожалению, чек отклонён. Свяжитесь с поддержкой или отправьте чек ещё раз.');
    }
  }
});

/* ---------------------------- Receipt photos ---------------------------- */
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const idxSnap = await db.ref('chatIndex/' + chatId).get();
  const phoneKey = idxSnap.exists() ? idxSnap.val() : null;
  if (!phoneKey) { bot.sendMessage(chatId, 'Не удалось определить ваш аккаунт. Откройте ссылку оплаты из приложения ещё раз.'); return; }

  const user = await getUser(phoneKey);
  const pending = user && user.pendingPayment;
  const tariffCode = pending ? pending.tariff : null;
  const tariff = tariffCode ? TARIFFS[tariffCode] : null;

  if (!ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, 'Чек получен, но администратор ещё не настроен ботом. Свяжитесь с поддержкой напрямую.');
    console.warn('ADMIN_TELEGRAM_CHAT_ID is not set — cannot forward receipt.');
    return;
  }

  const photoId = msg.photo[msg.photo.length - 1].file_id;
  const caption =
    'Чек об оплате\n' +
    'Компания: ' + (user ? user.company : '—') + '\n' +
    'ФИО: ' + (user ? user.fio : '—') + '\n' +
    'Телефон: ' + (user ? user.phone : phoneKey) + '\n' +
    'Тариф: ' + (tariff ? tariff.name + ' (' + tariff.months + ' мес.)' : (tariffCode || 'не указан'));

  bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption: caption,
    reply_markup: { inline_keyboard: [[
      { text: '✅ Подтвердить', callback_data: 'approve_' + phoneKey + '_' + (tariffCode || '') },
      { text: '❌ Отклонить', callback_data: 'reject_' + phoneKey }
    ]] }
  });
  bot.sendMessage(chatId, 'Чек отправлен администратору на проверку. Вы получите уведомление здесь, как только оплата будет подтверждена.');
});

/* ---------------------------- Daily job: expiry reminders + auto-expire ---------------------------- */
// Runs every day at 09:00 server time.
cron.schedule('0 9 * * *', async () => {
  console.log('Running daily subscription check...');
  const snap = await db.ref('users').get();
  const users = snap.exists() ? snap.val() : {};
  const now = Date.now();
  for (const phoneKey of Object.keys(users)) {
    const u = users[phoneKey];
    const sub = u.subscription;
    if (!sub || sub.status !== 'active' || !sub.expiresAt) continue;
    const expiresAt = new Date(sub.expiresAt).getTime();
    const chatId = u.telegram && u.telegram.chatId;

    if (expiresAt <= now) {
      // subscription period is over — mark expired (the web app also checks the timestamp itself)
      await updateUser(phoneKey, { 'subscription/status': 'expired' });
      if (chatId) bot.sendMessage(chatId, 'Срок вашей подписки истёк. Продлите тариф в приложении BIZNES OS, чтобы восстановить доступ.').catch(() => {});
      continue;
    }
    const oneDayMs = 24 * 3600 * 1000;
    if (expiresAt - now <= oneDayMs && !u.remindedExpiry) {
      await updateUser(phoneKey, { remindedExpiry: new Date().toISOString() });
      if (chatId) bot.sendMessage(chatId, 'Напоминаем: подписка BIZNES OS заканчивается завтра (' + fmtDate(sub.expiresAt) + '). Продлите тариф в приложении.').catch(() => {});
    }
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

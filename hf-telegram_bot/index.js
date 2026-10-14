const TelegramBot = require('node-telegram-bot-api');
const token = '8893755046:AAGKuI-77GPw_yztoXChrTN7KoQPGwZtdxg';
const bot = new TelegramBot(token, { polling: true });

let activeCheckins = {};

bot.onText(/\/start|\/menu/, (msg) => {
  const chatId = msg.chat.id;
  const opts = {
    reply_markup: {
      keyboard: [
        ['🍚 吃饭', '🚻 WC'],
        ['🚬 抽烟', '☕ 休息']
      ],
      resize_keyboard: true,
      persistent: true
    }
  };
  bot.sendMessage(chatId, "📌 请点击下方按钮进行状态打卡：", opts);
});

bot.on('message', (msg) => {
  if (!msg.text) return;
  const text = msg.text;
  const chatId = msg.chat.id;
  const user = msg.from;
  const username = user.username ? `@${user.username}` : user.first_name;

  const limits = {
    '🍚 吃饭': { type: '吃饭', minutes: 30 },
    '🚻 WC': { type: 'WC', minutes: 15 },
    '🚬 抽烟': { type: '抽烟', minutes: 8 },
    '☕ 休息': { type: '休息', minutes: 5 }
  };

  if (limits[text]) {
    const config = limits[text];
    const startTime = new Date();
    const timeStr = startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    if (activeCheckins[user.id]) {
      clearInterval(activeCheckins[user.id].timer);
    }

    bot.sendMessage(chatId, `📌 <b>${username}</b> 开始 <b>${config.type}</b>\n⏰ 出发时间：<code>${timeStr}</code>（限时 ${config.minutes} 分钟）`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🟢 我已回来', callback_data: `returned_${user.id}` }]
        ]
      }
    }).then((sentMsg) => {
      let timer = setInterval(() => {
        const now = new Date();
        const diffMinutes = Math.floor((now - startTime) / 60000);
        const overdueMinutes = diffMinutes - config.minutes;

        if (overdueMinutes > 0) {
          bot.sendMessage(chatId, `⚠️ ${username} 您进行中的【${config.type}】已超时！\n⏰ 目前已超时 <b>${overdueMinutes} 分钟</b>，请尽快点击下方按钮打卡！`, {
            reply_to_message_id: sentMsg.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🟢 我已回来', callback_data: `returned_${user.id}` }]
              ]
            }
          });
        }
      }, 60000);

      activeCheckins[user.id] = {
        type: config.type,
        startTime: startTime,
        messageId: sentMsg.message_id,
        chatId: chatId,
        timer: timer
      };
    });
  }
});

bot.on('callback_query', (query) => {
  const data = query.data;
  const user = query.from;
  const chatId = query.message.chat.id;

  if (data.startsWith('returned_')) {
    const targetUserId = parseInt(data.split('_')[1]);

    if (user.id !== targetUserId) {
      bot.answerCallbackQuery(query.id, { text: '❌ 这不是你的打卡状态哦！', show_alert: true });
      return;
    }

    if (activeCheckins[targetUserId]) {
      const record = activeCheckins[targetUserId];
      clearInterval(record.timer);

      const endTime = new Date();
      const durationMinutes = Math.round((endTime - record.startTime) / 60000);
      const username = user.username ? `@${user.username}` : user.first_name;

      bot.editMessageText(`✅ <b>${username}</b> 的 <b>${record.type}</b> 已结束\n⏱️ 总耗时：<code>${durationMinutes} 分钟</code>`, {
        chat_id: chatId,
        message_id: record.messageId,
        parse_mode: 'HTML'
      });

      bot.answerCallbackQuery(query.id, { text: '✨ 打卡成功，欢迎回来！' });
      delete activeCheckins[targetUserId];
    } else {
      bot.answerCallbackQuery(query.id, { text: '⚠️ 你当前没有进行中的打卡或已经打卡过了。' });
    }
  }
});
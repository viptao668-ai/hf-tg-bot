const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

const TelegramBot = require('node-telegram-bot-api');
const token = '8893755046:AAGWhodz6B9tgFXNhwBMbxhN3D_DhcwQsuc';
const bot = new TelegramBot(token, { polling: true });

let activeCheckins = {};

// 管理员白名单配置（你可以把你的 Telegram 数字用户 ID 填进去，或者写死多个管理员）
// 如果不知道自己的 ID，可以让管理员在群里发个消息查看，或者先留空通过群权限判断
const ADMIN_USER_IDS = []; // 例如: [123456789]

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
      let lastNotifiedMinute = 0;

      let timer = setInterval(() => {
        const now = new Date();
        const diffMinutes = Math.floor((now - startTime) / 60000);
        const overdueMinutes = diffMinutes - config.minutes;

        if (overdueMinutes > 0 && overdueMinutes !== lastNotifiedMinute) {
          lastNotifiedMinute = overdueMinutes;

          bot.sendMessage(chatId, `⚠️ ${username} 您进行中的【${config.type}】已超时！\n⏰ 目前已超时 <b>${overdueMinutes} 分钟</b>，请尽快打卡！`, {
            reply_to_message_id: sentMsg.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🟢 我已回来', callback_data: `returned_${user.id}` }]
              ]
            }
          });
        }
      }, 10000);

      activeCheckins[user.id] = {
        type: config.type,
        startTime: startTime,
        messageId: sentMsg.message_id,
        chatId: chatId,
        timer: timer,
        config: config,
        username: username
      };
    });
  }
});

bot.on('callback_query', async (query) => {
  const data = query.data;
  const user = query.from;
  const chatId = query.message.chat.id;

  if (data.startsWith('returned_')) {
    const targetUserId = parseInt(data.split('_')[1]);

    if (user.id !== targetUserId) {
      bot.answerCallbackQuery(query.id, { text: '❌ 这不是你的打卡哦！', show_alert: true });
      return;
    }

    if (activeCheckins[targetUserId]) {
      const record = activeCheckins[targetUserId];
      clearInterval(record.timer);

      const endTime = new Date();
      const totalMinutes = Math.round((endTime - record.startTime) / 60000);
      const overdueMinutes = totalMinutes - record.config.minutes;

      // 如果没有超时，正常显示结束
      if (overdueMinutes <= 0) {
        bot.editMessageText(`✅ <b>${record.username}</b> 的 <b>${record.type}</b> 已结束\n⏱️ 总耗时：<code>${totalMinutes} 分钟</code>`, {
          chat_id: chatId,
          message_id: record.messageId,
          parse_mode: 'HTML'
        });
        bot.answerCallbackQuery(query.id, { text: '✨ 打卡成功，欢迎回来！' });
      } 
      else {
        // 如果超时了才回卡，自动发送超时警告并 @ 管理员
        // 获取群管理员列表
        let adminMention = "管理员";
        try {
          const admins = await bot.getChatAdministrators(chatId);
          // 过滤掉机器人本身，找出真正的管理员并拼接 @
          const adminNames = admins
            .filter(admin => !admin.user.is_bot)
            .map(admin => admin.user.username ? `@${admin.user.username}` : admin.user.first_name);
          
          if (adminNames.length > 0) {
            adminMention = adminNames.join(' ');
          }
        } catch (e) {
          console.log("获取管理员列表失败", e);
        }

        // 修改原打卡消息为超时状态
        bot.editMessageText(`❌ <b>${record.username}</b> 的 <b>${record.type}</b> 已超时回卡！\n⏱️ 总耗时：${totalMinutes} 分钟（超标）\n🚨 <b>超时时间：${overdueMinutes} 分钟</b>`, {
          chat_id: chatId,
          message_id: record.messageId,
          parse_mode: 'HTML'
        });

        // 另外在群里发一条新消息 @ 管理员
        bot.sendMessage(chatId, `📢 <b>考勤异常提醒</b>\n👤 用户：${record.username}\n📌 类型：${record.type}\n⏰ <b>超时时间：${overdueMinutes} 分钟</b>\n\n请 ${adminMention} 注意处理扣分或记录！`, {
          parse_mode: 'HTML'
        });

        bot.answerCallbackQuery(query.id, { text: `⚠️ 已超时 ${overdueMinutes} 分钟，已通知管理员！`, show_alert: true });
      }

      delete activeCheckins[targetUserId];
    } else {
      bot.answerCallbackQuery(query.id, { text: '⚠️ 你当前没有进行中的打卡。' });
    }
  }
});
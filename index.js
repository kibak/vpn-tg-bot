require("dotenv").config();
const { Telegraf } = require('telegraf');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    }
});
const { BOT_API_KEY, BOT_ADMIN_IDS, BOT_USERS_GROUP_ID } = process.env;
const ovpnPath = path.join(__dirname, "ovpn");

if (! BOT_API_KEY) {
    return logger.error("Startup error: env BOT_API_KEY is empty!");
}
const bot = new Telegraf(BOT_API_KEY, {
    telegram: { privateChat: true }
});

if (! BOT_ADMIN_IDS) {
    return logger.error("Startup error: env BOT_ADMIN_IDS is empty!");
}
const adminIds = BOT_ADMIN_IDS.split(',').map(v => Number(v)).filter(v => v);
logger.info("Bot admins: " + adminIds);

function getFilename(ctx) {
    return `${ctx.from.username}_${ctx.from.first_name || ''}_${ctx.from.last_name || ''}`
        .replace(/[^0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-]/g, '_');
}
async function log(ctx, next) {
    logger.info(`${ctx.message.text} | ${ctx.from.first_name || ''} ${ctx.from.last_name || ''} #${ctx.from.id} @${ctx.from.username}`);
    await next();
}
async function adminAuth(ctx, next) {
    if (ctx.chat.type === 'private' && adminIds.includes(ctx.from.id)) {
        await next();
    }
}
async function userAuth(ctx, next) {
    if (ctx.chat.type === 'private') {
        if (adminIds.includes(ctx.from.id)) {
            await next();
        } else {
            try {
                const member = await ctx.telegram.getChatMember(BOT_USERS_GROUP_ID, ctx.from.id);
                if (member) {
                    await next();
                }
            } catch (e) {}
        }
    }
}

if (! fs.existsSync(ovpnPath)) {
    fs.mkdirSync(ovpnPath);
}

bot.command('start', log, userAuth, async (ctx) => {
    const userReply = 'Available commands:\n---\n' +
        '/guide - installation guide\n---\n' +
        '/ovpn - get your .ovpn file\n---\n';
    const adminReply = userReply +
        '/list - all clients\n---\n' +
        '/revoke {num} - remove client by number\n---\n---\n' +
        '/install - install openvpn on server\n---\n';

    ctx.reply(adminIds.includes(ctx.from.id) ? adminReply : userReply);
});
bot.command('ovpn', log, userAuth, async (ctx) => {
    try {
        const filename = getFilename(ctx);
        if (! fs.existsSync(path.join(ovpnPath, filename + '.ovpn'))) {
            childProcess.execSync(`MENU_OPTION="1" CLIENT="${filename}" PASS="1" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
        }
        await ctx.replyWithDocument({ source: path.join(ovpnPath, filename + '.ovpn'), caption: filename });
    } catch (err) {
        ctx.reply("failed");
        logger.error(err);
    }
});
bot.command('guide', log, userAuth,  async (ctx) => {
    ctx.reply(
        'OpenVPN client and guide\n' +
        'https://openvpn.net/vpn-client/'
    );
});
bot.command('list', log, adminAuth, async (ctx) => {
    try {
        const files = fs.readdirSync(ovpnPath);
        if (files.length) {
            ctx.reply(files.map((v,i) => `${i}. ${v}`).join('\n'));
        } else {
            ctx.reply("no clients");
        }
    } catch (err) {
        ctx.reply("failed");
        logger.error(err);
    }
});
bot.command('revoke', log, adminAuth, async (ctx) => {
    try {
        const num = Number(ctx.message.text.split(" ").pop());
        const files = fs.readdirSync(ovpnPath);
        const filename = files[num];
        childProcess.execSync(`MENU_OPTION="2" CLIENT="${filename}" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
        ctx.reply(filename + " revoked.");
    } catch (err) {
        ctx.reply("failed");
        logger.error(err);
    }
});
bot.command('install', log, adminAuth, async (ctx) => {
    try {
        childProcess.execSync(`AUTO_INSTALL=y DNS="9" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
        ctx.reply("installed");
    } catch (err) {
        ctx.reply("failed");
        logger.error(err);
    }
});


bot.launch();

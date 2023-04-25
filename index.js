require("dotenv").config();
const { Telegraf } = require('telegraf');
const childProcess = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const pino = require('pino');
const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    }
});
const {
    BOT_API_KEY, BOT_ADMIN_IDS, BOT_USERS_GROUP_ID,
    BOT_DOMAIN, BOT_PORT
} = process.env;
const ovpnPath = path.join(__dirname, "ovpn");

if (! BOT_API_KEY) {
    return logger.error("Startup error: env BOT_API_KEY is empty!");
}
const bot = new Telegraf(BOT_API_KEY);

if (! BOT_ADMIN_IDS) {
    return logger.error("Startup error: env BOT_ADMIN_IDS is empty!");
}
const adminIds = BOT_ADMIN_IDS.split(',').map(v => Number(v)).filter(v => v);
logger.info("Bot admins: " + adminIds);

function fixFilename(str) {
    return str.replace(/[^0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-]/g, '_');
}
async function log(ctx, next) {
    logger.info(`${ctx.message.text} | ${ctx.from.first_name || ''} ${ctx.from.last_name || ''} #${ctx.from.id} @${ctx.from.username}`);
    await next();
}
async function adminAuth(ctx, next) {
    if (ctx.chat.type !== 'private') return await ctx.reply("пиши в личку бота");
    if (adminIds.includes(ctx.from.id)) {
        await next();
    } else {
        return await ctx.reply("deprecated bot");
    }
}
async function userAuth(ctx, next) {
    if (ctx.chat.type !== 'private') return await ctx.reply("пиши в личку бота");
    if (adminIds.includes(ctx.from.id)) {
        await next();
    } else {
        try {
            const member = await ctx.telegram.getChatMember(BOT_USERS_GROUP_ID, ctx.from.id);
            if (member) {
                await next();
            } else {
                await ctx.reply("deprecated bot");
            }
        } catch (e) {
            await ctx.reply("deprecated bot");
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

    await ctx.reply(adminIds.includes(ctx.from.id) ? adminReply : userReply);
});
bot.command('ovpn', log, userAuth, async (ctx) => {
    try {
        const filenames = fs.readdirSync(ovpnPath);
        const oldFilename = filenames.find(f => f.startsWith("id" + ctx.from.id));

        if (oldFilename) {
            if ((Date.now() - Date.parse(fs.statSync(path.join(ovpnPath,oldFilename)).birthtime)) < 864000000) {
                return await ctx.replyWithDocument({
                    source: path.join(ovpnPath, oldFilename),
                    filename: `${ctx.from.username}.ovpn`
                });
            }
            childProcess.execSync(`MENU_OPTION="2" CLIENT="${oldFilename.slice(0,-5)}" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
        }

        const filename = `id${ctx.from.id}_${ctx.from.username}_${ctx.from.first_name || ''}_${ctx.from.last_name || ''}_${Date.now()}`;
        childProcess.execSync(`MENU_OPTION="1" CLIENT="${filename}" PASS="1" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);

        await ctx.replyWithDocument({
            source: path.join(ovpnPath, filename + '.ovpn'),
            filename: `${ctx.from.username}.ovpn`
        });
    } catch (err) {
        await ctx.reply("failed");
        logger.error(err);
    }
});
bot.command('guide', log, userAuth,  async (ctx) => {
    await ctx.reply(
        'OpenVPN client and guide\n' +
        'https://openvpn.net/vpn-client/'
    );
});
bot.command('list', log, adminAuth, async (ctx) => {
    try {
        const files = fs.readdirSync(ovpnPath);
        if (files.length) {
            await ctx.reply(files.map((v,i) => `${i}. ${v}`).join('\n'));
        } else {
            await ctx.reply("no clients");
        }
    } catch (err) {
        await ctx.reply("failed");
        logger.error(err);
    }
});
bot.command('revoke', log, adminAuth, async (ctx) => {
    try {
        const num = Number(ctx.message.text.split(" ").pop());
        const files = fs.readdirSync(ovpnPath);
        const filename = files[num];
        if (filename) {
            childProcess.execSync(`MENU_OPTION="2" CLIENT="${filename.slice(0,-5)}" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
            await ctx.reply(filename + " revoked.");
        } else {
            await ctx.reply("wrong command");
        }
    } catch (err) {
        await ctx.reply("failed");
        logger.error(err);
    }
});
bot.command('install', log, adminAuth, async (ctx) => {
    try {
        childProcess.execSync(`AUTO_INSTALL=y DNS="9" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
        await ctx.reply("installed");
    } catch (err) {
        await ctx.reply("failed");
        logger.error(err);
    }
});

if (BOT_DOMAIN) {
    bot.telegram.setWebhook(`https://${BOT_DOMAIN}/h`).catch(logger.error);
    bot.startWebhook('/h', null, BOT_PORT || 8080);
}

bot.launch().catch((err) => {
    logger.error("Bot launch error: " + err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

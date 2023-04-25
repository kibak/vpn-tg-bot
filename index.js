require("dotenv").config();
const { Telegraf } = require('telegraf');
const util = require('node:util');
const exec = util.promisify(require('node:child_process').exec);
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
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
    if (ctx.chat.type !== 'private') return await ctx.reply("write in private");
    if (adminIds.includes(ctx.from.id)) {
        await next();
    } else {
        return await ctx.reply("deprecated bot");
    }
}
async function userAuth(ctx, next) {
    if (ctx.chat.type !== 'private') return await ctx.reply("write in private");
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

if (! fsSync.existsSync(ovpnPath)) {
    fsSync.mkdirSync(ovpnPath);
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
        const filenames = await fs.readdir(ovpnPath);
        const oldFilename = filenames.find(f => f.startsWith("id" + ctx.from.id));

        if (oldFilename) {
            if ((Date.now() - Date.parse((await fs.stat(path.join(ovpnPath,oldFilename))).birthtime)) < 864000000) {
                return await ctx.replyWithDocument({
                    source: path.join(ovpnPath, oldFilename),
                    filename: `${ctx.from.username || ctx.from.id}.ovpn`
                });
            }
            await exec(`MENU_OPTION="2" CLIENT="${oldFilename.slice(0,-5)}" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
        }

        const filename = fixFilename(`id${ctx.from.id}_${ctx.from.username}_${ctx.from.first_name || ''}_${ctx.from.last_name || ''}_${Date.now()}`);
        await exec(`MENU_OPTION="1" CLIENT="${filename}" PASS="1" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);

        await ctx.replyWithDocument({
            source: path.join(ovpnPath, filename + '.ovpn'),
            filename: `${ctx.from.username || ctx.from.id}.ovpn`
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
        const files = await fs.readdir(ovpnPath);
        if (files.length) {
            await ctx.reply(files.map((v,i) => `--- ${i} ---\n${v}`).join('\n'));
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
        const files = await fs.readdir(ovpnPath);
        const filename = files[num];
        if (filename) {
            await exec(`MENU_OPTION="2" CLIENT="${filename.slice(0,-5)}" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
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
        await exec(`AUTO_INSTALL=y DNS="9" OVPN_PATH="${ovpnPath}" bash ./openvpn-install.sh`);
        await ctx.reply("installed");
    } catch (err) {
        await ctx.reply("failed");
        logger.error(err);
    }
});
bot.launch({ dropPendingUpdates: true }).catch((err) => {
    console.error("Bot launch error", err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

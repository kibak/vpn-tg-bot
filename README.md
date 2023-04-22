# vpn-tg-bot
Telegram bot to manage vpn server

App use https://github.com/angristan/openvpn-install script to work with openvpn

Required .env file variables:
- BOT_API_KEY=xxxxxx:ssssssssss
- BOT_ADMINS=111111,222222,3333333
- BOT_USERS_GROUP_ID=-1000000 (app uses group to manage access to bot, bot must be a member of this group)

Available commands:
- /start - show all commands
- /guide - openvpn client installation guide
- /ovpn - get .ovpn file (NOTICE: after 10 days by this command app automatically revoke old certificate and create new)

Only for admin:
- /list - show all clients
- /revoke {num} - revoke client by number from /list command
- /install - auto install openvpn server

# Echelon Configuration Examples

Sample configurations for common use cases.

## Files

### `minimal.json`
Bare minimum config - uses all defaults.
- Sonnet for all layers
- 3 parallel engineers
- $50 total budget
- Destructive approval mode

**Usage:**
```bash
cp examples/minimal.json echelon.config.json
# Edit repo and path
echelon
```

### `full-featured.json`
Production-ready config with all features enabled.
- Opus for strategy (2IC)
- Sonnet for execution (Eng Lead, Team Lead)
- Multi-engine support with fallbacks
- GitHub Project Board integration
- Fine-tuned timeouts and retry logic

**Usage:**
```bash
cp examples/full-featured.json echelon.config.json
# Edit repo, path, and projectNumber
echelon
```

### `telegram-bot.json`
Telegram bot mode for mobile-first operation.
- Health monitoring enabled
- User authentication via allowedUserIds
- Same layer config as minimal

**Setup:**
1. Create bot via [@BotFather](https://t.me/BotFather)
2. Get chat ID: message your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Copy `telegram-bot.json` and update `token`, `chatId`, `allowedUserIds`
4. Run: `echelon --telegram`

**Usage:**
```bash
cp examples/telegram-bot.json echelon.config.json
# Edit repo, path, and telegram credentials
echelon --telegram
```

## Field Reference

See main [README.md](../README.md#configuration) for full documentation of all config fields.

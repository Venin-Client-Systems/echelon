# Migration Guide

This guide helps you upgrade Echelon configurations and workflows across versions.

---

## Upgrading from Pre-Telegram Configs (v0.0.x → v0.1.0)

**What changed:**
- Added Telegram bot mode with health monitoring
- Added Cheenoski engine configuration (multi-backend support)
- Added project board integration (GitHub Projects v2)
- Added billing mode (`api` vs `max`)

**Old config (still works):**
```json
{
  "project": {
    "repo": "owner/repo",
    "path": "/path/to/repo",
    "baseBranch": "main"
  },
  "layers": {
    "2ic": { "model": "opus", "maxBudgetUsd": 10.0 },
    "eng-lead": { "model": "sonnet", "maxBudgetUsd": 5.0 },
    "team-lead": { "model": "sonnet", "maxBudgetUsd": 5.0 }
  },
  "engineers": {
    "maxParallel": 3,
    "createPr": true,
    "prDraft": true
  },
  "approvalMode": "destructive",
  "maxTotalBudgetUsd": 50.0
}
```

**New config (recommended):**
```json
{
  "project": {
    "repo": "owner/repo",
    "path": "/path/to/repo",
    "baseBranch": "main"
  },
  "layers": {
    "2ic": { "model": "opus", "maxBudgetUsd": 10.0 },
    "eng-lead": { "model": "sonnet", "maxBudgetUsd": 5.0 },
    "team-lead": { "model": "sonnet", "maxBudgetUsd": 5.0 }
  },
  "engineers": {
    "engine": "claude",
    "fallbackEngines": ["opencode", "cursor"],
    "maxParallel": 3,
    "createPr": true,
    "prDraft": true,
    "projectBoard": {
      "projectNumber": 1,
      "statusField": "Status",
      "batchField": "Batch"
    }
  },
  "approvalMode": "destructive",
  "billing": "api",
  "maxTotalBudgetUsd": 50.0,
  "telegram": {
    "token": "123456:ABC...",
    "chatId": "123456789",
    "allowedUserIds": [123456789],
    "health": {
      "enabled": true,
      "port": 3000
    }
  }
}
```

**Breaking changes:** None. Old configs are fully backward-compatible.

**New fields (all optional):**
- `engineers.engine` — Default: `"claude"`
- `engineers.fallbackEngines` — Default: `[]`
- `engineers.projectBoard` — Default: `undefined` (disabled)
- `billing` — Default: `"api"`
- `telegram` — Default: `undefined` (disabled)

**Migration steps:**

1. **Add Telegram support (optional):**
   ```bash
   # Run init wizard to configure Telegram
   echelon init
   # Choose "Yes" for Step 5 (Telegram Bot)
   ```

2. **Enable project board tracking (optional):**
   - Find your GitHub project number: Settings → Projects → URL has `/projects/:number`
   - Add to config:
     ```json
     "engineers": {
       "projectBoard": {
         "projectNumber": 1,
         "statusField": "Status",
         "batchField": "Batch"
       }
     }
     ```

3. **Configure fallback engines (optional):**
   ```json
   "engineers": {
     "engine": "claude",
     "fallbackEngines": ["opencode", "cursor"]
   }
   ```

4. **Set billing mode:**
   - If you have Claude Pro/Max: `"billing": "max"`
   - If using API credits: `"billing": "api"` (default)

---

## Upgrading from Legacy Engineers Config

**Old format (deprecated but still supported):**
```json
{
  "engineers": {
    "maxParallel": 3,
    "createPr": true,
    "prDraft": true
  }
}
```

**New format (Cheenoski-powered):**
```json
{
  "engineers": {
    "engine": "claude",
    "fallbackEngines": [],
    "maxParallel": 3,
    "createPr": true,
    "prDraft": true,
    "stuckWarningMs": 120000,
    "hardTimeoutMs": 600000,
    "maxRetries": 2
  }
}
```

**New fields:**
- `engine` — Primary AI backend (`claude`, `opencode`, `codex`, `cursor`, `qwen`)
- `fallbackEngines` — Fallback backends on failure
- `stuckWarningMs` — Warn when task takes longer than 2 minutes (default: 120000)
- `hardTimeoutMs` — Kill task after 10 minutes (default: 600000)
- `maxRetries` — Retry failed tasks up to N times (default: 2)

**No action required** — Old config works with new defaults applied.

---

## Model Aliases (Always Up-to-Date)

**Before (hardcoded versions):**
```json
{
  "layers": {
    "2ic": { "model": "claude-opus-4-6", "maxBudgetUsd": 10.0 }
  }
}
```

**After (auto-updating aliases):**
```json
{
  "layers": {
    "2ic": { "model": "opus", "maxBudgetUsd": 10.0 }
  }
}
```

**Migration:**
- Replace `claude-opus-4-6` → `opus`
- Replace `claude-sonnet-4-5-*` → `sonnet`
- Replace `claude-haiku-4-5-*` → `haiku`

**Why:** Aliases automatically resolve to the latest Claude version. You'll get Opus 4.7, Sonnet 4.6, etc. as they're released.

---

## Environment Variable Changes

**Old (inconsistent naming):**
```bash
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
```

**New (consistent ECHELON_ prefix):**
```bash
export ECHELON_TELEGRAM_BOT_TOKEN="..."
export ECHELON_TELEGRAM_CHAT_ID="..."
export ECHELON_TELEGRAM_ALLOWED_USERS="123,456"
export ECHELON_HEALTH_ENABLED="true"
export ECHELON_HEALTH_PORT="3000"
```

**Migration:**
- Update your `.env` or systemd service files
- Old env vars are **not supported** (will cause bot to silently fail)

---

## Session Directory Structure

**Old (flat structure):**
```
~/.echelon/
  state.json
  transcript.md
```

**New (timestamped sessions):**
```
~/.echelon/
  sessions/
    project-owner-repo-2025-01-15T10-30-00/
      state.json
      transcript.md
  logs/
    echelon-2025-01-15T10-30-00.log
```

**Migration:** No action needed. Old sessions are migrated automatically on first run.

---

## CLI Flag Changes

**New flags:**
- `--yolo` — Full autonomous mode (replaces `--approval-mode none` + skip prompts)
- `--telegram` — Start in Telegram bot mode
- `--approval-mode <mode>` — Override approval mode at runtime

**Deprecated flags:** None.

**Examples:**
```bash
# Old way (still works)
echelon -d "..." --approval-mode none --headless

# New shorthand
echelon -d "..." --yolo --headless
```

---

## Troubleshooting Migration Issues

**"Invalid config: unknown field 'telegram'"**
- You're running an old version of Echelon
- Update: `npm install -g echelon@latest`

**"Telegram bot not responding after migration"**
- Check env vars use `ECHELON_` prefix (not `TELEGRAM_`)
- Verify `chatId` is a string in config, not a number
- Test: `curl https://api.telegram.org/bot<TOKEN>/getUpdates`

**"Engineers config validation failed"**
- Remove any custom fields not in the schema
- Valid fields: `engine`, `fallbackEngines`, `maxParallel`, `createPr`, `prDraft`, `projectBoard`, `stuckWarningMs`, `hardTimeoutMs`, `maxRetries`, `maxSlotDurationMs`

**"Session not found after upgrade"**
- Old sessions use flat directory structure
- New sessions use `~/.echelon/sessions/<project-timestamp>/`
- Manually migrate:
  ```bash
  mkdir -p ~/.echelon/sessions/my-project-$(date +%Y-%m-%dT%H-%M-%S)
  mv ~/.echelon/state.json ~/.echelon/sessions/my-project-*/
  mv ~/.echelon/transcript.md ~/.echelon/sessions/my-project-*/
  ```

---

## Rolling Back

If you encounter issues after upgrading:

**1. Downgrade Echelon:**
```bash
npm install -g echelon@0.0.9  # Replace with last known good version
```

**2. Restore old config:**
```bash
cp echelon.config.json.backup echelon.config.json
```

**3. Restore old sessions:**
```bash
cp -r ~/.echelon.backup ~/.echelon
```

**4. Report issues:**
- GitHub: https://github.com/Venin-Client-Systems/echelon/issues
- Include: Echelon version, error logs, config (redact secrets!)

---

## Version History

| Version | Date | Breaking Changes | Migration Required? |
|---------|------|------------------|---------------------|
| v0.1.0 | 2025-01-15 | Telegram env vars renamed | Yes (if using Telegram) |
| v0.0.9 | 2025-01-10 | None | No |
| v0.0.8 | 2025-01-05 | Model aliases introduced | Recommended |
| v0.0.7 | 2024-12-20 | Session directory restructure | Automatic |

# Echelon Quick Reference

## 🚀 The Only Command You Need

```bash
echelon
```

That's it! Interactive mode handles everything.

---

## ⚡ Quick Commands

| Command | What It Does |
|---------|-------------|
| `echelon` | Start interactive session (recommended) |
| `echelon --yolo` | Full autonomous mode (no approvals) |
| `echelon status` | Check current cascade state |
| `echelon --help` | Show all commands |

---

## 📋 All Commands

### Interactive Mode (Recommended)
```bash
echelon              # Smart interactive mode
echelon --yolo       # Full autonomous (auto-approves all)
```

### Status & Sessions
```bash
echelon status          # Check cascade state (alias: s)
echelon sessions        # List all sessions
echelon sessions list   # List all sessions
echelon sessions prune  # Delete completed/failed sessions
```

### Headless Mode
```bash
echelon -d "Add JWT auth" --headless    # Non-interactive
echelon -d "Fix bugs" --dry-run         # Preview only
echelon --resume                         # Resume last session
```

### Setup & Config
```bash
echelon init                              # Full setup wizard
echelon --config path/to/config.json     # Use specific config
```

### Help & Info
```bash
echelon --help       # Show help
echelon --version    # Show version
echelon help init    # Help for specific command
```

---

## 🎯 Common Workflows

### First Time Setup
```bash
cd ~/projects/my-app
echelon
# Follow the prompts - takes 30 seconds
```

### Start a Cascade
```bash
echelon
# Type your directive when prompted
# Example: "Implement dark mode for the dashboard"
```

### Check Progress
```bash
echelon status
# Shows: session, cost, progress, agent states
```

### Resume After Ctrl+C
```bash
echelon
# Automatically offers to resume paused session
```

### Full Autonomous Mode
```bash
echelon --yolo
# No approval prompts - full speed ahead!
```

---

## ⚙️ Configuration Flags

### Approval Modes
```bash
--approval-mode destructive   # Approve destructive actions only (default)
--approval-mode all           # Approve everything
--approval-mode none          # Auto-approve all (same as --yolo)
```

### Execution Modes
```bash
--headless      # Non-interactive (for CI/CD)
--dry-run       # Preview without executing
--resume        # Resume most recent session
--verbose       # Debug logging
--telegram      # Telegram bot mode
```

### Config Options
```bash
-c, --config <path>           # Custom config file
-d, --directive <text>        # Directive (required in headless)
```

---

## 💡 Pro Tips

### Fastest Way to Start
```bash
echelon
```
Just press Enter at prompts to use smart defaults.

### Check What's Running
```bash
echelon status
```
Shows real-time cascade state, cost, and progress.

### Emergency Stop
Press `Ctrl+C` - state is saved automatically. Resume anytime with `echelon`.

### See All Options
```bash
echelon --help
```
Complete command reference with examples.

### Clean Up Old Sessions
```bash
echelon sessions prune
```
Deletes completed/failed sessions to save disk space.

---

## 🎨 Interactive Mode Flow

```
$ echelon

1. Detects git repository ✓
2. Loads or creates config ✓
3. Checks for active session
4. Asks for directive (with examples)
5. Shows pre-flight checklist
6. Confirms before launch
7. Starts cascade!
```

---

## 📊 Status Output

```bash
$ echelon status

Echelon Status
──────────────────────────────────────────────────────
Session:     my-repo-2026-02-19T12-00-00
Status:      ● running
Directive:   Implement JWT authentication
Total Cost:  $2.45
Elapsed:     5m 23s
──────────────────────────────────────────────────────
Messages:    12
Issues:      3
Pending:     0 approval(s)
──────────────────────────────────────────────────────
Agent States:
  ✓ 2ic          $1.20      3 turns
  ● eng-lead     $0.85      2 turns
  ○ team-lead    --         --
──────────────────────────────────────────────────────
```

---

## 🔐 Budget Safety

Echelon automatically:
- ⚠️ Warns at **75%** budget
- ⚠️ Warns at **90%** budget
- 🚨 **Pauses at 95%** budget (unless `--yolo`)

Check current cost anytime:
```bash
echelon status
```

---

## 🆘 Troubleshooting

### "Not in a git repository"
```bash
cd /path/to/your/project
echelon
```

### "Missing directive in headless mode"
```bash
echelon -d "Your directive here" --headless
```

### "TUI mode requires an interactive terminal"
```bash
# Use headless mode in CI/CD:
echelon -d "Your directive" --headless
```

### Check prerequisites
```bash
# Echelon requires:
which gh      # GitHub CLI
which claude  # Claude CLI (or use --dry-run)
```

---

## 📧 Get Help

- **Documentation:** [README.md](../README.md)
- **Issues:** [GitHub Issues](https://github.com/Venin-Client-Systems/echelon/issues)
- **Contact:** george.atkinson@venin.space

**Built by George Atkinson & Claude Opus 4.6**

---

## 🎯 One-Line Summary

```bash
echelon              # That's all you need! 🚀
```

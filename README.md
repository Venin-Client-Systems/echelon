<p align="center">
  <h1 align="center">Echelon</h1>
  <p align="center">
    <strong>A hierarchical multi-agent AI orchestrator that turns a single directive into a full engineering org.</strong>
  </p>
  <p align="center">
    <a href="#installation">Installation</a> &middot;
    <a href="#quick-start">Quick Start</a> &middot;
    <a href="#how-it-works">How It Works</a> &middot;
    <a href="#configuration">Configuration</a> &middot;
    <a href="#cli-reference">CLI Reference</a>
  </p>
</p>

---

You give a directive. Echelon builds the team, plans the work, creates GitHub issues, writes the code, opens PRs, and asks you to approve along the way.

```
CEO (you)
  "Build JWT auth with refresh tokens"
    └─ 2IC          → breaks directive into workstreams
        └─ Eng Lead  → designs architecture, defines tasks
            └─ Team Lead → creates GitHub issues, invokes engineers
                └─ Engineers (parallel) → write code, open PRs
```

No agents to configure. No prompt chains to debug. One command, one config file.

## What It Does

- **Hierarchical planning** &mdash; A directive cascades through AI management layers (2IC &rarr; Eng Lead &rarr; Team Lead) before any code is written. Each layer adds specificity.
- **Parallel code execution** &mdash; Engineers run in isolated git worktrees with a sliding-window scheduler. Three engineers by default, configurable.
- **GitHub-native** &mdash; Issues are created, branches are cut, PRs are opened and reviewed. Everything lives in your repo.
- **Human-in-the-loop** &mdash; Approval gates let you review destructive actions (issue creation, code execution) before they happen. Or go full auto.
- **Budget controls** &mdash; Per-layer and total spending limits. The system stops when the budget runs out, not when your wallet does.
- **Terminal UI** &mdash; Real-time org chart, activity feed, issue tracker, and cost dashboard. Or run headless for CI/automation.
- **Session persistence** &mdash; Save state, resume later. Agent context carries over via Claude session IDs.

## Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| **Node.js** | v20+ | [nodejs.org](https://nodejs.org) |
| **Claude CLI** | Authenticated | `npm i -g @anthropic-ai/claude-code && claude login` |
| **GitHub CLI** | Authenticated | [cli.github.com](https://cli.github.com) &rarr; `gh auth login` |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com) |

## Installation

```bash
# Clone the repo
git clone https://github.com/Venin-Client-Systems/echelon.git
cd echelon

# Install dependencies and build
npm install
npm run build

# Link globally (optional — makes `echelon` available anywhere)
npm link
```

## Quick Start

### 1. Initialize

Run the setup wizard from inside your project repo:

```bash
echelon init
```

This walks you through:
- Prerequisite checks (Node, Git, Claude CLI, GitHub CLI)
- Project detection (auto-reads your git remote)
- Model selection per management layer
- Budget and safety configuration

Outputs `echelon.config.json` in your project root.

### 2. Dry Run

See what Echelon *would* do without side effects:

```bash
echelon -c echelon.config.json -d "analyze the codebase and suggest improvements" --dry-run
```

### 3. Headless Run

Execute a safe, read-only directive:

```bash
echelon -c echelon.config.json -d "list the top 3 architectural improvements" --headless
```

### 4. Launch the TUI

Full interactive mode with real-time dashboard:

```bash
echelon -c echelon.config.json
```

Type your directive, watch it cascade through the org chart, approve actions as they surface.

## How It Works

### The Cascade

```
Layer 0: CEO (Human)     ─── TUI input, approvals, overrides
Layer 1: 2IC (AI)        ─── Strategy, prioritization, workstream planning
Layer 2: Eng Lead (AI)   ─── Architecture, technical design, task breakdown
Layer 3: Team Lead (AI)  ─── Issue creation, sprint management, PR review
Layer 4: Engineers (AI)  ─── Code execution in parallel git worktrees
```

Each management layer (1-3) is a Claude Code headless session. They reason in natural language and emit structured JSON action blocks:

```json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT authentication with refresh tokens",
      "body": "## Overview\n...",
      "labels": ["backend", "ralphy-1"]
    }
  ]
}
```

Engineers (Layer 4) use [Ralphy](https://github.com/Venin-Client-Systems/echelon/tree/develop/ralphy) — a parallel code execution engine that processes GitHub issues in isolated git worktrees, one branch per task, automatic PR creation.

### Approval Modes

| Mode | Behavior |
|------|----------|
| `destructive` (default) | CEO approves issue creation, code execution, and branch creation |
| `all` | CEO approves every action |
| `none` | Fully autonomous — no human approval required |

### Actions

| Action | Who | What |
|--------|-----|------|
| `update_plan` | 2IC, Eng Lead | Update strategic plan with workstreams |
| `create_issues` | Team Lead | Create GitHub issues via `gh` |
| `invoke_ralphy` | Team Lead | Start parallel code execution |
| `create_branch` | Eng Lead | Cut a new git branch |
| `request_review` | Team Lead | Request PR review |
| `request_info` | Any layer | Ask another layer a question |
| `escalate` | Any layer | Bubble a decision to a higher layer |

## Configuration

`echelon.config.json`:

```json
{
  "project": {
    "repo": "owner/repo",
    "path": "/absolute/path/to/repo",
    "baseBranch": "main"
  },
  "layers": {
    "2ic":       { "model": "opus",   "maxBudgetUsd": 10.0 },
    "eng-lead":  { "model": "sonnet", "maxBudgetUsd": 5.0 },
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

### Models

| Model | Best For | Cost |
|-------|----------|------|
| `opus` | Strategy, complex reasoning (2IC) | $$$ |
| `sonnet` | Architecture, task breakdown (Eng Lead, Team Lead) | $$ |
| `haiku` | Fast iteration, simple tasks | $ |

## CLI Reference

```
Usage: echelon [options] [command]

Options:
  -c, --config <path>          Path to echelon.config.json
  -d, --directive <text>       CEO directive to execute
  --headless                   Run without TUI (headless mode)
  --dry-run                    Show planned cascade without executing
  --resume                     Resume the most recent session
  -v, --verbose                Enable debug logging
  --approval-mode <mode>       Override approval mode (destructive, all, none)
  -V, --version                Output version number
  -h, --help                   Display help

Commands:
  init                         Interactive config generator
  sessions list                List all saved sessions
  sessions prune               Delete completed/failed sessions
  sessions delete <id>         Delete a specific session
```

### TUI Commands

Once inside the TUI, type these at the CEO prompt:

| Command | Description |
|---------|-------------|
| *free text* | Send a new directive to the 2IC |
| `/approve` | Approve all pending actions |
| `/reject [reason]` | Reject pending actions with optional reason |
| `/pause` | Pause the current cascade |
| `/status` | Show current org status |
| `/cost` | Show spending breakdown |
| `/quit` | Save state and exit |

## TUI Layout

```
┌─ Echelon ──────────────────────── project ────┐
│ ┌─ Org ──────────┐  ┌─ Feed ────────────────┐ │
│ │ CEO     ● you  │  │ [2IC] Breaking down.. │ │
│ │ 2IC     ◆ plan │  │ [Lead] JWT + refresh  │ │
│ │ Lead    ○ idle │  │ [TL] Created #42...   │ │
│ │ TL      ○ idle │  │ [Eng#1] Working #42   │ │
│ │ Eng #1  ▶ code │  │ [Eng#2] PR #12 open   │ │
│ └────────────────┘  └───────────────────────┘ │
│ ┌─ Issues ───────┐  Cost: $2.40 | Time: 8m   │
│ │ #42 JWT    ▶  │                             │
│ │ #43 RBAC   ○  │                             │
│ └────────────────┘                             │
│ CEO > _                                        │
└────────────────────────────────────────────────┘
```

## Session Persistence

Sessions are saved to `~/.echelon/sessions/<project-timestamp>/`:

- `state.json` — Full state (agent sessions, messages, issues, costs)
- `transcript.md` — Human-readable activity log

Resume your last session:

```bash
echelon --resume
```

Agent context carries over — Claude sessions are resumed with `claude -r <session-id>`, so the AI remembers what it was doing.

## Architecture

```
src/
  index.ts                    # Entry point — routes to TUI or headless
  cli.ts                      # Commander arg parsing
  commands/init.ts            # Setup wizard

  core/
    orchestrator.ts           # Main hierarchical cascade loop
    agent.ts                  # Claude Code session spawn/resume
    message-bus.ts            # EventEmitter routing between layers
    action-parser.ts          # Extract JSON action blocks from agent text
    action-executor.ts        # Execute or queue actions for approval
    state.ts                  # Persistent state load/save/resume
    session.ts                # Session management (list, prune, delete)

  actions/
    github-issues.ts          # gh issue create/update/close
    ralphy.ts                 # Invoke Ralphy as subprocess
    git.ts                    # Branch management
    review.ts                 # PR review

  ui/                         # Ink (React for CLI) components
    App.tsx                   # Root layout
    OrgChart.tsx              # Agent status sidebar
    Feed.tsx                  # Scrollable activity log
    IssuePanel.tsx            # GitHub issues tracker
    Input.tsx                 # CEO command input
    StatusBar.tsx             # Cost, time, project info
    ApprovalPrompt.tsx        # Inline approval UI
    hooks/useEchelon.ts       # Bridge orchestrator state to React

  lib/
    types.ts                  # Zod schemas for config, actions, state
    paths.ts                  # Atomic JSON writes
    logger.ts                 # Structured logging
    config.ts                 # Config loader/validator
    transcript.ts             # Markdown transcript writer
    prompts.ts                # System prompts for each layer

ralphy/                       # Bundled parallel execution engine
```

## Contributing

Issues and PRs are welcome. This is early-stage software — expect rough edges.

```bash
# Development
npm run dev -- -c echelon.config.json --headless -d "your directive"

# Type checking
npm run typecheck
```

## License

[MIT](LICENSE) &copy; Venin Client Systems

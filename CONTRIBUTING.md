# Contributing to Echelon

Thank you for your interest in contributing to Echelon! This guide covers everything you need to get started with local development, testing, and submitting pull requests.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [PR Guidelines](#pr-guidelines)
- [Project Structure](#project-structure)
- [Common Tasks](#common-tasks)
- [Getting Help](#getting-help)

---

## Prerequisites

Before you begin, ensure you have the following tools installed and authenticated:

| Tool | Required Version | Installation |
|------|------------------|--------------|
| **Node.js** | v20+ | [nodejs.org](https://nodejs.org) |
| **Claude CLI** | Latest | `npm i -g @anthropic-ai/claude-code` |
| **GitHub CLI** | Latest | [cli.github.com](https://cli.github.com) |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com) |

### Authentication

After installing, authenticate the required tools:

```bash
# Authenticate Claude CLI
claude login

# Authenticate GitHub CLI
gh auth login
```

Verify your setup:

```bash
node --version    # Should be v20 or higher
claude --version  # Should show version number
gh auth status    # Should show authenticated account
git --version     # Should show version number
```

---

## Local Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Venin-Client-Systems/echelon.git
cd echelon
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory and makes the CLI executable.

### 4. Link Globally (Optional)

To use the `echelon` command anywhere on your system:

```bash
npm link
```

You can now run `echelon` from any directory. To unlink later:

```bash
npm unlink -g echelon
```

### 5. Verify Installation

Test that everything works:

```bash
# If linked globally
echelon --version

# Or run directly via npm
npm run dev -- --version
```

---

## Development Workflow

### Running Locally

Use `npm run dev` to test changes without rebuilding:

```bash
npm run dev -- -d "Your test directive" --headless
```

This uses `tsx` to run TypeScript directly, bypassing the build step. Great for rapid iteration.

### Before Committing

Always run these checks before creating a commit:

```bash
# Type checking
npm run typecheck

# Run all tests
npm test
```

Both commands must pass without errors.

### Commit Message Format

Use **conventional commits** with the following format:

```
<type>(<scope>): <description> (#issue)
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `refactor` — Code restructuring (no behavior change)
- `test` — Add or update tests
- `docs` — Documentation changes
- `chore` — Build, deps, tooling

**Examples:**
```
feat(orchestrator): add session resumption (#12)
fix(action-parser): handle embedded backticks in JSON (#23)
test(config): add validation tests (#24)
docs(readme): add TUI layout diagram (#30)
chore(deps): update Claude CLI to v0.76.0 (#45)
```

**Always reference the issue number** if your PR relates to one.

### Pushing Changes

**DO NOT push directly to `main` or `develop`.** All changes must go through pull requests.

```bash
# Create a feature branch
git checkout -b feat/your-feature-name

# Make your changes and commit
git add .
git commit -m "feat(scope): description (#issue)"

# Push to your fork or the repo
git push origin feat/your-feature-name
```

---

## Testing

Echelon uses [Vitest](https://vitest.dev/) for testing. We aim for **80%+ coverage** on new code.

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (auto-rerun on changes)
npm test:watch

# Run Vitest tests only (excludes Node.js test runner tests)
npm run test:vitest

# Run Node.js test runner tests only
npm run test:node-only

# Run a specific test file
npm test -- src/lib/__tests__/config.test.ts
```

### Writing Tests

#### Test Structure

Place tests in `__tests__/` directories next to the code they test:

```
src/
  core/
    action-parser.ts
    __tests__/
      action-parser.test.ts
```

Use Vitest conventions:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { myFunction } from '../my-module.js';

describe('MyFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', () => {
    // Arrange
    const input = { ... };

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

#### Mocking External Dependencies

**Always mock external API calls** to avoid hitting real services during tests.

**Example: Mocking the agent module**

```typescript
import { vi } from 'vitest';
import * as agent from '../core/agent.js';

vi.spyOn(agent, 'spawnAgent').mockResolvedValue({
  sessionId: 'test-session',
  content: 'Test response\n```json\n{"action": "update_plan", "plan": "Test"}\n```',
  costUsd: 0.01,
  durationMs: 100,
});
```

**Example: Mocking the logger**

```typescript
vi.mock('../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));
```

**Example: Mocking GitHub CLI**

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

vi.mock('node:child_process');
const execAsync = promisify(exec);

vi.mocked(execAsync).mockResolvedValue({
  stdout: 'https://github.com/owner/repo/issues/42',
  stderr: '',
});
```

#### Testing Action Parsing

Action parsing must handle edge cases like:
- Multiple action blocks in one response
- Narrative text mixed with actions
- Embedded backticks in JSON strings
- Malformed JSON (should skip, not crash)
- Non-action JSON blocks (no `action` field)

See `src/core/__tests__/action-parser.test.ts` for examples.

#### Coverage Goals

- **New features:** 80%+ coverage required
- **Bug fixes:** Add a regression test
- **Refactoring:** Ensure existing tests still pass

Run coverage reports:

```bash
npm test -- --coverage
```

---

## PR Guidelines

### Before Submitting

- [ ] **One feature per PR** — Keep PRs focused and reviewable
- [ ] **Tests included** — All new actions, layers, or features need tests
- [ ] **Type checking passes** — Run `npm run typecheck`
- [ ] **All tests pass** — Run `npm test`
- [ ] **Conventional commit messages** — Use `feat:`, `fix:`, etc.
- [ ] **Link to issue** — Reference the issue number in commits and PR description
- [ ] **Update CLAUDE.md** — If adding new architecture, document it

### Submitting a PR

1. **Fork the repository** (if you're not a core contributor)
2. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
3. **Make your changes** and commit with conventional commit messages
4. **Push to your fork**:
   ```bash
   git push origin feat/your-feature
   ```
5. **Open a pull request** on GitHub
6. **Fill out the PR template** (if provided)
7. **Link the related issue** using `Closes #N` or `Fixes #N`

### PR Review Process

- A maintainer will review your PR within a few days
- Address any requested changes
- Once approved, a maintainer will merge your PR

### First-Time Contributors

If this is your first contribution:

1. Check the [GitHub Issues](https://github.com/Venin-Client-Systems/echelon/issues) for issues labeled `good first issue`
2. Comment on the issue to let others know you're working on it
3. Follow the guidelines above
4. Don't hesitate to ask questions in the issue or PR comments

---

## Project Structure

Here's a brief overview of the codebase:

```
echelon/
├── src/
│   ├── index.ts                    # Entry point — auto-discovery, routes to TUI or headless
│   ├── cli.ts                      # Commander CLI argument parsing
│   ├── commands/
│   │   └── init.ts                 # Setup wizard + quick init
│   │
│   ├── core/                       # Core orchestration logic
│   │   ├── orchestrator.ts         # Main hierarchical cascade loop
│   │   ├── agent.ts                # Claude Code session spawn/resume
│   │   ├── message-bus.ts          # EventEmitter routing between layers
│   │   ├── action-parser.ts        # Extract JSON action blocks from agent text
│   │   ├── action-executor.ts      # Execute or queue actions for approval
│   │   ├── state.ts                # Persistent state load/save/resume
│   │   └── session.ts              # Session management (list, prune, delete)
│   │
│   ├── actions/                    # Action implementations
│   │   ├── github-issues.ts        # gh issue create/update/close
│   │   ├── cheenoski.ts            # Invoke Cheenoski as subprocess
│   │   ├── git.ts                  # Branch management
│   │   └── review.ts               # PR review
│   │
│   ├── cheenoski/                  # Parallel code execution engine
│   │   ├── index.ts                # Main entry point
│   │   ├── scheduler.ts            # Sliding-window task scheduler
│   │   ├── engine/                 # Engine implementations (Claude, Cursor, etc.)
│   │   ├── git/                    # Git worktree and branch management
│   │   └── github/                 # GitHub issue fetching
│   │
│   ├── ui/                         # Terminal UI (Ink/React)
│   │   ├── App.tsx                 # Root layout
│   │   ├── OrgChart.tsx            # Agent status sidebar
│   │   ├── Feed.tsx                # Scrollable activity log
│   │   ├── IssuePanel.tsx          # GitHub issues tracker
│   │   └── hooks/useEchelon.ts     # Bridge orchestrator state to React
│   │
│   └── lib/                        # Shared libraries
│       ├── types.ts                # Zod schemas for config, actions, state
│       ├── logger.ts               # Structured logging
│       ├── config.ts               # Config loader, auto-discovery
│       ├── prompts.ts              # System prompts for each layer
│       └── transcript.ts           # Markdown transcript writer
│
├── ralphy/                         # Legacy bash-based parallel execution (deprecated)
├── dist/                           # Compiled JavaScript output (TypeScript → JS)
└── CLAUDE.md                       # Project-specific AI assistant instructions
```

**Key directories for contributors:**

- **`src/core/`** — Core orchestration logic (cascade, actions, agents)
- **`src/actions/`** — Action implementations (GitHub, Git, Cheenoski)
- **`src/cheenoski/`** — Parallel code execution engine
- **`src/lib/`** — Shared utilities and schemas
- **`src/ui/`** — Terminal UI components

**Important files:**

- **`src/lib/types.ts`** — All Zod schemas (actions, config, state)
- **`src/lib/prompts.ts`** — System prompts for each management layer
- **`src/core/action-executor.ts`** — Action dispatch logic
- **`CLAUDE.md`** — Detailed architecture documentation

---

## Common Tasks

### Adding a New Action Type

Actions are how management layers communicate what they want to do (e.g., create issues, invoke engineers, create branches).

**1. Define the action schema in `src/lib/types.ts`**

```typescript
export const MergePrActionSchema = z.object({
  action: z.literal('merge_pr'),  // Must be literal for discriminated union
  pr_number: z.number().int().positive(),
  method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
});
```

**2. Add to the discriminated union**

```typescript
export const ActionSchema = z.discriminatedUnion('action', [
  CreateIssuesActionSchema,
  InvokeCheenoskiActionSchema,
  // ... other actions
  MergePrActionSchema,  // Add here
]);
```

**3. Implement the handler in `src/core/action-executor.ts`**

```typescript
private async dispatch(action: Action): Promise<string> {
  switch (action.action) {
    // ... existing cases
    case 'merge_pr': {
      const result = await mergePr(action.pr_number, action.method, this.config.project.repo);
      return result;
    }
  }
}
```

**4. Create the implementation (e.g., in `src/actions/pr.ts`)**

```typescript
export async function mergePr(
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase',
  repo: string,
): Promise<string> {
  const { stdout } = await execAsync(`gh pr merge ${prNumber} --${method} --repo ${repo}`);
  return `PR #${prNumber} merged via ${method}`;
}
```

**5. Update system prompts in `src/lib/prompts.ts`**

Add the action to the relevant layer's prompt (e.g., Team Lead):

```typescript
case 'team-lead':
  return base + [
    // ...
    '- merge_pr: {"action": "merge_pr", "pr_number": 123, "method": "squash"}',
    // ...
  ].join('\n');
```

**6. Add to destructive actions if needed**

If the action is destructive (e.g., modifies shared state):

```typescript
// src/core/action-executor.ts
const DESTRUCTIVE_ACTIONS = new Set([
  'create_issues',
  'invoke_cheenoski',
  'create_branch',
  'merge_pr',  // Add here
]);
```

**7. Write tests**

Add tests for action parsing and execution:

```typescript
// src/core/__tests__/action-parser.test.ts
it('should parse a valid merge_pr action', () => {
  const text = `
\`\`\`json
{
  "action": "merge_pr",
  "pr_number": 42,
  "method": "squash"
}
\`\`\`
  `;

  const { actions, errors } = parseActions(text);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    action: 'merge_pr',
    pr_number: 42,
    method: 'squash',
  });
});
```

### Adding a New Management Layer

Management layers are AI agents that handle specific parts of the cascade (e.g., 2IC handles strategy, Eng Lead handles architecture).

**Note:** This is a rare change. Most contributions will add actions, not layers.

**1. Update types in `src/lib/types.ts`**

```typescript
export type LayerId = '2ic' | 'eng-lead' | 'team-lead' | 'architect';  // Add new layer

export const LAYER_ORDER: readonly AgentRole[] = [
  'ceo',
  '2ic',
  'architect',  // Insert in cascade order
  'eng-lead',
  'team-lead',
  'engineer',
] as const;

export const LAYER_LABELS: Record<AgentRole, string> = {
  // ...
  architect: 'Architect',
};
```

**2. Update config schema**

```typescript
export const EchelonConfigSchema = z.object({
  // ...
  layers: z.object({
    '2ic': LayerConfigSchema.default({}),
    'architect': LayerConfigSchema.default({}),  // Add here
    'eng-lead': LayerConfigSchema.default({}),
    'team-lead': LayerConfigSchema.default({}),
  }).default({}),
});
```

**3. Add system prompt in `src/lib/prompts.ts`**

```typescript
export function getSystemPrompt(role: AgentRole): string {
  switch (role) {
    // ... existing cases
    case 'architect':
      return base + `
You are the Architect in a hierarchical AI software org.

Responsibilities:
- Receive technical direction from 2IC
- Design system architecture and technical patterns
- Pass detailed specs to Eng Lead
...
`;
  }
}
```

**4. Update orchestrator in `src/core/orchestrator.ts`**

Add the new layer to the cascade flow.

**5. Write tests**

Test the new layer's integration into the cascade.

### Adding a New Cheenoski Engine

Cheenoski engines are the code execution backends (e.g., Claude Code, Cursor, Codex). Each engine implements the `EngineRunner` interface.

**1. Create a new engine file in `src/cheenoski/engine/`**

```typescript
// src/cheenoski/engine/my-engine.ts
import type { EngineRunner, EngineResult } from './base.js';

export const myEngineRunner: EngineRunner = {
  name: 'my-engine',
  async run(task, config) {
    // Implement task execution logic
    const output = await executeTask(task, config);
    return {
      status: 'success',
      prUrl: output.prUrl,
      exitCode: 0,
    };
  },
};
```

**2. Register the engine in `src/cheenoski/engine/index.ts`**

```typescript
import { myEngineRunner } from './my-engine.js';

export const ENGINES: Record<string, EngineRunner> = {
  claude: claudeEngineRunner,
  cursor: cursorEngineRunner,
  'my-engine': myEngineRunner,  // Add here
  // ...
};
```

**3. Update the config schema**

Allow users to select your engine:

```typescript
// src/cheenoski/types.ts
export const CheenoskiEngineConfigSchema = z.object({
  engine: z.enum(['claude', 'cursor', 'my-engine']).default('claude'),  // Add here
  // ...
});
```

**4. Write tests**

Test your engine's behavior with mocked tasks.

---

## Getting Help

### Documentation

- **README.md** — High-level overview and quick start
- **CLAUDE.md** — Detailed architecture and development patterns
- **CONTRIBUTING.md** — This file (setup, workflow, testing)

### Community

- **GitHub Issues** — [Report bugs or request features](https://github.com/Venin-Client-Systems/echelon/issues)
- **GitHub Discussions** — [Ask questions or discuss ideas](https://github.com/Venin-Client-Systems/echelon/discussions)
- **Pull Requests** — Review others' work or get feedback on your own

### Tips

- **Read the code** — This is a small codebase. Most files are < 300 lines.
- **Check existing tests** — See `src/core/__tests__/` for examples
- **Start small** — Fix a typo, add a test, improve documentation
- **Ask questions** — Comment on issues or open a discussion

---

## Migration Notes

### Ralphy → Cheenoski

Echelon is migrating from the legacy **Ralphy** bash-based execution engine to **Cheenoski**, a native TypeScript engine with support for multiple AI code execution backends (Claude Code, Cursor, Codex, etc.).

**What this means for contributors:**

- **`ralphy/` directory** — Legacy bash scripts, still bundled for backward compatibility but deprecated
- **`src/cheenoski/` directory** — New TypeScript-based execution engine
- **`invoke_ralphy` action** — Now an alias for `invoke_cheenoski`, handled in `action-executor.ts`
- **Future work** — The `ralphy/` directory will be removed once migration is complete

If you're working on code execution features, focus on Cheenoski, not Ralphy.

---

## License

By contributing to Echelon, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

**Thank you for contributing!** Your work makes Echelon better for everyone.

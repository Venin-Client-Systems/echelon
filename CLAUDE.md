# Echelon Project Guide

This document guides AI-assisted development on Echelon, a hierarchical multi-agent orchestrator.

---

## Architecture Overview

Echelon simulates a software engineering organization with AI agents at each management layer:

```
CEO (Human)          ─── Directive input, approval gates
  ↓
2IC (AI)             ─── Strategic breakdown, workstream planning
  ↓
Eng Lead (AI)        ─── Technical design, architecture decisions
  ↓
Team Lead (AI)       ─── GitHub issue creation, execution coordination
  ↓
Engineers (AI)       ─── Parallel code execution via Cheenoski
```

### Layer Responsibilities

**CEO (Human)**
- Provides high-level directives
- Approves destructive actions (issue creation, code execution, branch creation)
- Can override or pause the cascade at any point

**2IC (Second in Command)**
- Receives CEO directives
- Breaks them into strategic workstreams
- Prioritizes work
- Passes technical direction to Eng Lead

**Eng Lead (Engineering Lead)**
- Designs technical architecture
- Breaks workstreams into concrete tasks
- Defines task specifications with domain labels
- Creates branches if needed

**Team Lead**
- Creates GitHub issues with full specifications
- Invokes Cheenoski for parallel code execution
- Monitors progress and requests PR reviews

**Engineers (via Cheenoski)**
- Execute tasks in isolated git worktrees
- Write code based on issue specifications
- Create pull requests when complete

---

## Key Concepts

### Actions (Structured JSON Blocks)

Agents communicate by emitting **action blocks** embedded in their natural language responses:

```json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT authentication",
      "body": "## Overview\n...",
      "labels": ["backend", "ralphy-1"]
    }
  ]
}
```

**CRITICAL:** Action blocks MUST use ` ```json ` fences, NOT ` ```typescript ` or any other language tag. The parser specifically looks for JSON blocks.

All actions are defined in `src/lib/types.ts` using Zod discriminated unions. The `action` field is the discriminator.

Available actions:
- `create_issues` — Team Lead creates GitHub issues
- `invoke_cheenoski` — Team Lead starts parallel code execution
- `update_plan` — 2IC/Eng Lead updates the strategic plan
- `create_branch` — Eng Lead creates a new branch
- `request_review` — Team Lead requests PR review
- `request_info` — Any layer asks another layer a question
- `escalate` — Any layer escalates a decision to higher layer

### MessageBus (Event-Driven Communication)

The `MessageBus` is a sync `EventEmitter` that routes messages between layers. It enforces **hierarchical adjacency** — layers can only communicate with immediate neighbors (CEO ↔ 2IC, 2IC ↔ Eng Lead, etc.).

**Important:** The MessageBus is synchronous. If you add async event handlers, they must `await` internally and handle their own errors.

All system events flow through `bus.emitEchelon()`:
- `agent_status` — Agent state changes (thinking, done, error)
- `message` — Inter-layer communication
- `action_pending` — Action awaiting CEO approval
- `action_executed` — Action completed
- `issue_created` — GitHub issue created
- `ralphy_progress` — Live output from Cheenoski runner
- `cost_update` — Budget tracking
- `error` — Agent errors

### State Persistence

All orchestrator state is saved to `~/.echelon/sessions/<project-timestamp>/state.json`:

```typescript
{
  sessionId: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  agents: Record<AgentRole, AgentState>;
  messages: LayerMessage[];
  issues: TrackedIssue[];
  totalCost: number;
  directive: string;
  // ...
}
```

State is saved after every agent turn. Use `saveState(state)` immediately after mutations.

### Session Resumption

Agent sessions persist via Claude Code session IDs:

```typescript
// First run
const response = await spawnAgent(input, { model, maxBudgetUsd, systemPrompt });
agentState.sessionId = response.sessionId; // Save this!

// Resume
const response = await resumeAgent(agentState.sessionId, newInput, { maxTurns });
```

When a session is resumed (`echelon --resume`), each agent picks up where it left off with full context.

### Cheenoski

**Cheenoski** is the parallel code execution engine bundled with Echelon (in `cheenoski/`). It processes GitHub issues in isolated git worktrees with domain-aware scheduling and multiple AI backend support.

Echelon invokes Cheenoski via TypeScript (`src/actions/cheenoski.ts` and `src/cheenoski/index.ts`).

---

## Development Patterns

### Always Read Before Editing

**Never modify files without reading them first.** Use the Read tool to understand existing patterns:

```typescript
// ✅ Correct
const file = await read('src/core/orchestrator.ts');
// ... analyze the file ...
await edit('src/core/orchestrator.ts', { old: '...', new: '...' });

// ❌ Wrong
await edit('src/core/orchestrator.ts', { old: '...', new: '...' }); // You don't know what's there!
```

### Use Dedicated Tools

Prefer dedicated file tools over bash commands:

- **Read files:** Use `Read`, not `cat`, `head`, `tail`
- **Edit files:** Use `Edit`, not `sed`, `awk`
- **Write files:** Use `Write`, not `echo >` or `cat <<EOF`
- **Search files:** Use `Glob`, not `find` or `ls`
- **Search content:** Use `Grep`, not `grep` or `rg`

Bash is for system commands (git, npm, processes), not file operations.

### Test New Features

Run tests before committing:

```bash
npm test                # All tests
npm test -- src/lib/__tests__/config.test.ts  # Specific test
```

Use Vitest conventions:
- Mock external dependencies (especially `agent.ts` — avoid real API calls)
- Use `vi.fn()` for MessageBus event verification
- Put tests in `__tests__/` directories
- Name tests `*.test.ts`

Example test structure:

```typescript
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('MyFeature', () => {
  it('should do something', () => {
    // Arrange
    const input = { ... };

    // Act
    const result = myFunction(input);

    // Assert
    assert.equal(result, expected);
  });
});
```

### Update Types for New Actions

All actions are defined in `src/lib/types.ts` using Zod discriminated unions.

To add a new action type:

1. Define the action schema:

```typescript
export const MyNewActionSchema = z.object({
  action: z.literal('my_new_action'),  // Discriminator — must be literal
  param1: z.string(),
  param2: z.number().optional(),
});
```

2. Add to the discriminated union:

```typescript
export const ActionSchema = z.discriminatedUnion('action', [
  CreateIssuesActionSchema,
  InvokeCheenoskiActionSchema,
  // ...
  MyNewActionSchema,  // Add here
]);
```

3. Update action executor (`src/core/action-executor.ts`):

```typescript
private async dispatch(action: Action): Promise<string> {
  switch (action.action) {
    // ...
    case 'my_new_action': {
      // Handle the action
      return 'Action result';
    }
  }
}
```

4. Add to system prompts (`src/lib/prompts.ts`) for relevant layers.

**Important:** Use the `action: 'literal'` pattern, not `action: z.enum(['...'])`. Discriminated unions require literals for type narrowing.

---

## Critical Files

### `src/core/orchestrator.ts`
The main cascade loop. Runs each layer sequentially:
1. CEO → 2IC (strategy)
2. 2IC → Eng Lead (technical design)
3. Eng Lead → Team Lead (issue creation + execution)

Handles budget checks, state persistence, signal handling (SIGINT/SIGTERM), and error recovery.

**Key methods:**
- `runCascade(directive)` — Starts the cascade
- `runLayer(role, from, input)` — Executes a single layer
- `shutdown()` — Graceful shutdown, kills Cheenoski runneres

### `src/core/action-parser.ts`
JSON extraction from agent responses. Uses regex to find ` ```json ... ``` ` blocks.

**Why it's complex:** Agent responses can contain:
- Narrative text mixed with action blocks
- Multiple action blocks in one response
- Embedded backticks in JSON strings
- Malformed JSON (skipped gracefully)

The parser uses a progressive matcher:
1. Extract all ````json ... ```` blocks with regex
2. Parse each block with `JSON.parse()`
3. Validate with `ActionSchema.safeParse()`
4. Skip blocks that aren't actions (no `action` field)
5. Collect validation errors without throwing

**Key functions:**
- `parseActions(text)` — Extract and validate actions
- `stripActionBlocks(text)` — Remove action blocks, return narrative only

### `src/core/action-executor.ts`
Action dispatch and approval queue management.

**Approval modes:**
- `none` — Auto-execute all actions
- `destructive` — Require approval for `create_issues`, `invoke_cheenoski`, `create_branch`
- `all` — Require approval for every action

**Key methods:**
- `executeOrQueue(action, from, dryRun)` — Check approval, execute or queue
- `approve(approvalId)` — CEO approves a pending action
- `approveAll()` — Approve all pending (for headless mode)
- `killAllCheenoski()` — Terminate Cheenoski runners

### `src/cheenoski/git/branch-ledger.ts`
**Note:** This file doesn't exist yet. When implementing, it will track branch creation for audit trails.

Planned structure:
```typescript
{
  branches: [
    { name: 'feature/jwt-auth', created: '2025-01-15T10:00:00Z', issue: 42, status: 'active' }
  ]
}
```

---

## Gotchas

### Action Blocks MUST Use ```json Fences

The action parser looks for ` ```json ` specifically. Using ` ```typescript ` or ` ```js ` will cause actions to be silently ignored.

**Correct:**
```json
{"action": "create_issues", "issues": [...]}
```

**Incorrect:**
```typescript
{"action": "create_issues", "issues": [...]}  // Won't parse!
```

### Action Schema is a Discriminated Union

Use `action: 'literal'` pattern, not enums:

**Correct:**
```typescript
z.object({
  action: z.literal('create_issues'),
  issues: z.array(IssuePayloadSchema),
})
```

**Incorrect:**
```typescript
z.object({
  action: z.enum(['create_issues']),  // Breaks discriminated union!
  issues: z.array(IssuePayloadSchema),
})
```

### MessageBus is Sync — Async Handlers Must Await Internally

The EventEmitter is synchronous. If your handler is async:

**Correct:**
```typescript
bus.onEchelon(async (event) => {
  try {
    await someAsyncWork();
  } catch (err) {
    logger.error('Handler failed', err);
  }
});
```

**Incorrect:**
```typescript
bus.onEchelon(async (event) => {
  await someAsyncWork();  // Unhandled promise rejection if it throws!
});
```

### Worktrees Are Ephemeral — Always Clean Up

Cheenoski uses `git worktree add` to create isolated workdirs. These MUST be cleaned up in `finally` blocks:

```typescript
const worktree = await createWorktree(branch);
try {
  await doWork(worktree.path);
} finally {
  await cleanupWorktree(worktree);  // CRITICAL
}
```

Orphaned worktrees will cause "already exists" errors on the next run.

### Budget Checks Happen at Layer Start

Budget is checked *before* calling the agent, not after:

```typescript
// orchestrator.ts:152
if (agentState.totalCost >= layerConfig.maxBudgetUsd) {
  logger.warn('Budget exceeded');
  return null;  // Skip this layer
}
```

If you're near the limit, the agent may not run at all. Plan budget headroom accordingly.

---

## Testing

### Run Tests Before Committing

```bash
npm test
```

### Mock `agent.ts` for Orchestrator Tests

Avoid real API calls in tests. Mock the agent spawn/resume functions:

```typescript
import { mock } from 'node:test';
import * as agent from '../core/agent.js';

const mockSpawn = mock.fn(agent, 'spawnAgent', async () => ({
  sessionId: 'test-session',
  content: 'Test response\n```json\n{"action": "update_plan", "plan": "Test"}\n```',
  costUsd: 0.01,
  durationMs: 100,
}));
```

### Use `vi.fn()` for MessageBus Event Verification

When testing event emission:

```typescript
let emittedEvents: EchelonEvent[] = [];
bus.onEchelon((event) => emittedEvents.push(event));

// ... trigger action ...

assert.ok(emittedEvents.some(e => e.type === 'action_executed'));
```

### Test Action Parsing Edge Cases

The action parser must handle:
- Multiple action blocks in one response
- Narrative text before/after actions
- Embedded backticks in JSON strings
- Malformed JSON (should skip, not crash)
- Non-action JSON blocks (no `action` field)

Example test:

```typescript
const text = `
Here's my plan:

\`\`\`json
{"action": "update_plan", "plan": "Implement auth"}
\`\`\`

I'll also create issues:

\`\`\`json
{"action": "create_issues", "issues": [...]}
\`\`\`
`;

const { actions } = parseActions(text);
assert.equal(actions.length, 2);
```

---

## Adding a New Action Type (Example)

Let's add a `merge_pr` action:

**1. Define the schema in `src/lib/types.ts`:**

```typescript
export const MergePrActionSchema = z.object({
  action: z.literal('merge_pr'),
  pr_number: z.number().int().positive(),
  method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
});

export const ActionSchema = z.discriminatedUnion('action', [
  // ... existing actions
  MergePrActionSchema,
]);
```

**2. Add handler in `src/core/action-executor.ts`:**

```typescript
case 'merge_pr': {
  const result = await mergePr(action.pr_number, action.method, this.config.project.repo);
  return result;
}
```

**3. Implement the function in `src/actions/pr.ts`:**

```typescript
export async function mergePr(
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase',
  repo: string,
): Promise<string> {
  const result = await execAsync(`gh pr merge ${prNumber} --${method} --repo ${repo}`);
  return `PR #${prNumber} merged via ${method}`;
}
```

**4. Update system prompts in `src/lib/prompts.ts`:**

```typescript
case 'team-lead':
  return base + [
    // ...
    '- merge_pr: {"action": "merge_pr", "pr_number": 123, "method": "squash"}',
    // ...
  ].join('\n');
```

**5. Add to destructive actions if needed:**

```typescript
// src/core/action-executor.ts
const DESTRUCTIVE_ACTIONS = new Set(['create_issues', 'invoke_cheenoski', 'create_branch', 'merge_pr']);
```

Done! The Team Lead can now merge PRs.

---

## Domain Labels and Cheenoski Integration

### Domain Title Tags

Every task title should start with a domain tag:

- `[Backend]` — API, services, business logic
- `[Frontend]` — UI, components, client code
- `[Database]` — Schema, migrations, queries
- `[Infra]` — CI/CD, deployment, DevOps
- `[Security]` — Auth, encryption, audit
- `[Tests]` — Test coverage, QA
- `[Docs]` — Documentation, README

### Domain Labels

Each issue should have a matching label:

- `backend`
- `frontend`
- `database`
- `infrastructure`
- `security`
- `testing`
- `documentation`

### Cheenoski Batch Labels

Issues are grouped by execution priority:

- `ralphy-0` — Critical, blockers, security
- `ralphy-1` — Foundation, infrastructure
- `ralphy-2` — Tech debt, refactoring
- `ralphy-3` — Testing, QA
- `ralphy-4` — Core features
- `ralphy-5+` — Future phases

**Example:**

```json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT authentication",
      "body": "...",
      "labels": ["backend", "ralphy-1"]
    }
  ]
}
```

Cheenoski uses these labels to:
1. **Parallelize by domain** — `backend` and `frontend` tasks run concurrently
2. **Sequence by priority** — `ralphy-0` completes before `ralphy-1`

---

## Commit Message Format

Use conventional commits:

```
<type>(<scope>): <description> (#issue)
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `refactor` — Code restructuring
- `test` — Add/update tests
- `docs` — Documentation changes
- `chore` — Build, deps, tooling

**Examples:**
- `feat(orchestrator): add session resumption (#12)`
- `fix(action-parser): handle embedded backticks in JSON (#23)`
- `test(config): add validation tests (#24)`
- `docs(readme): add TUI layout diagram (#30)`

---

## Debugging Tips

### Enable Verbose Logging

```bash
echelon -c config.json -d "..." --verbose
```

Logs go to `~/.echelon/logs/echelon-<timestamp>.log`.

### Inspect Session State

```bash
cat ~/.echelon/sessions/<project-timestamp>/state.json | jq .
```

### Check Cheenoski Output

Ralphy logs are captured in real-time via `bus.emitEchelon({ type: 'ralphy_progress', ... })`.

Watch for:
- `Processing issue #42`
- `Starting task: [Backend] JWT auth`
- `PR created: #123`
- `All tasks completed`

### Common Errors

**"No downstream role for: team-lead"**
- The cascade tried to go past Team Lead. Engineers are invoked via Cheenoski, not as a layer.

**"Invalid message route: 2ic → ceo"**
- Messages must flow downward or to adjacent layers. Use `escalate` action to go upward.

**"Action validation failed"**
- Check the action JSON against the schema in `types.ts`.
- Ensure `action` field matches a literal in the discriminated union.

**"Cheenoski not found"**
- The `cheenoski/` directory is missing. It should be bundled with the package.

---

## File Structure Quick Reference

```
echelon/
├── src/
│   ├── index.ts                    # Entry point
│   ├── cli.ts                      # Commander CLI
│   ├── commands/
│   │   └── init.ts                 # Config wizard
│   ├── core/
│   │   ├── orchestrator.ts         # Main cascade loop
│   │   ├── agent.ts                # Claude Code spawn/resume
│   │   ├── message-bus.ts          # Event routing
│   │   ├── action-parser.ts        # JSON extraction
│   │   ├── action-executor.ts      # Action dispatch
│   │   ├── state.ts                # Persistence
│   │   └── session.ts              # Session management
│   ├── actions/
│   │   ├── github-issues.ts        # gh issue create
│   │   ├── cheenoski.ts               # Cheenoski runner
│   │   ├── git.ts                  # Branch management
│   │   └── review.ts               # PR review
│   ├── ui/                         # Ink components (TUI)
│   │   ├── App.tsx
│   │   ├── OrgChart.tsx
│   │   ├── Feed.tsx
│   │   └── ...
│   └── lib/
│       ├── types.ts                # Zod schemas (actions, config, state)
│       ├── prompts.ts              # System prompts per layer
│       ├── logger.ts               # Structured logging
│       ├── config.ts               # Config loader
│       └── transcript.ts           # Markdown transcript
├── cheenoski/                         # Bundled parallel execution engine
│   ├── ralphy.sh                   # Main script
│   └── lib/                        # Bash modules
└── dist/                           # Compiled output (TypeScript → JS)
```

---

## Questions?

If something is unclear:
1. Check the README for high-level architecture
2. Read `src/lib/prompts.ts` for layer system prompts
3. Examine `src/lib/types.ts` for all schemas
4. Look at `src/lib/__tests__/*.test.ts` for usage examples
5. Ask in GitHub issues or PRs

**When in doubt, read the code.** This is a small codebase — most files are < 300 lines.

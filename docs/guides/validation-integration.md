# End-to-End Validation Integration Guide

Complete walkthrough of how validation flows through the Echelon cascade, from directive input to action execution.

---

## Table of Contents

- [Overview](#overview)
- [Validation Flow Architecture](#validation-flow-architecture)
- [Validation Checkpoints](#validation-checkpoints)
  - [1. Directive Input Validation](#1-directive-input-validation)
  - [2. Budget Pre-Check](#2-budget-pre-check)
  - [3. Agent Spawn Validation](#3-agent-spawn-validation)
  - [4. Agent Output Parsing](#4-agent-output-parsing)
  - [5. Action Schema Validation](#5-action-schema-validation)
  - [6. Action Execution Approval](#6-action-execution-approval)
  - [7. Layer Output Validation](#7-layer-output-validation)
- [End-to-End Example](#end-to-end-example)
- [Validation Checkpoints Summary](#validation-checkpoints-summary)
- [Error Handling Integration](#error-handling-integration)
- [Related Documentation](#related-documentation)

---

## Overview

Echelon validates data at every stage of the cascade to ensure:
- **Early failure** — Invalid inputs are caught before expensive operations
- **Type safety** — All data conforms to expected schemas
- **Budget enforcement** — Costs stay within limits at layer and cascade levels
- **Graceful degradation** — Errors are classified and handled with appropriate recovery strategies

**Key principle:** Validation is layered, with each checkpoint handling a specific concern. No single failure point can bring down the entire cascade.

**Core modules:**
- [`src/core/agent-validation.ts`](../../src/core/agent-validation.ts) — Agent input parameter validation
- [`src/core/agent.ts`](../../src/core/agent.ts) — Agent spawn/resume with error boundaries
- [`src/core/action-parser.ts`](../../src/core/action-parser.ts) — Action extraction and schema validation
- [`src/core/action-executor.ts`](../../src/core/action-executor.ts) — Action execution and approval management
- [`src/core/orchestrator.ts`](../../src/core/orchestrator.ts) — Cascade orchestration and budget checks

---

## Validation Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ CEO (User)                                                      │
│ ↓ Directive: "Implement JWT authentication"                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 1: Directive Input Validation                       │
│ • Non-empty string check                                        │
│ • Length validation (max 100k chars)                            │
│ • File: orchestrator.ts:123                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 2: Budget Pre-Check (Per Layer)                     │
│ • Layer budget check (2IC, Eng Lead, Team Lead)                │
│ • Total cascade budget check                                    │
│ • Skip layer if budget exceeded                                 │
│ • File: orchestrator.ts:324-340                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 3: Agent Spawn Validation                            │
│ • Model validation (opus/sonnet/haiku)                          │
│ • Budget validation (min 0.01 USD)                              │
│ • Prompt validation (non-empty, max 100k)                       │
│ • System prompt validation                                      │
│ • Timeout validation (5s to 1 hour)                             │
│ • Working directory validation (absolute path)                  │
│ • Error boundary wrap (retry + circuit breaker)                 │
│ • File: agent.ts:207-268, agent-validation.ts                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Agent Response (Claude CLI)                                     │
│ ↓ JSON output with result, session_id, cost_usd                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 4: Agent Output Parsing                              │
│ • Parse JSON envelope from stdout                               │
│ • Extract result, session_id, cost_usd                          │
│ • Check is_error flag                                           │
│ • File: agent.ts:168-204                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 5: Action Schema Validation                          │
│ • Extract ```json blocks from response                          │
│ • Parse JSON with progressive matcher                           │
│ • Validate against ActionSchema (Zod)                           │
│ • Collect parse errors                                          │
│ • Strip action blocks to extract narrative                      │
│ • File: action-parser.ts:29-103                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 6: Action Execution Approval                         │
│ • Filter actions by role permissions                            │
│ • Check approval mode (none/destructive/all)                    │
│ • Queue for CEO approval if required                            │
│ • Execute approved actions                                      │
│ • File: action-executor.ts:80-99, orchestrator.ts:421-424       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 7: Layer Output Validation                           │
│ • Non-empty content check                                       │
│ • Cost validation (>= 0)                                        │
│ • Proceed to next layer or fail cascade                         │
│ • File: orchestrator.ts:682-693                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Next Layer (2IC → Eng Lead → Team Lead)                        │
│ ↓ Repeat checkpoints 2-7 for each layer                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Validation Checkpoints

### 1. Directive Input Validation

**When:** Before cascade starts
**Where:** [`src/core/orchestrator.ts:123`](../../src/core/orchestrator.ts#L123)

#### Validation Rules

The directive is validated implicitly by the agent spawn validation (it becomes the prompt for the 2IC layer):

```typescript
// orchestrator.ts:158
let strategyMsg = await this.runLayer('2ic', 'ceo', directive);

// runLayer passes directive as prompt to spawnAgent
// agent.ts:214 validates the prompt
validatePrompt(prompt, 'prompt');
```

**Validation rules** (from [`agent-validation.ts:61-70`](../../src/core/agent-validation.ts#L61-L70)):
- ✅ Non-empty string
- ✅ Non-whitespace-only
- ✅ Max 100,000 characters

#### Error Handling

**Error type:** `PromptValidationError`
**Recovery:**
```typescript
throw new PromptValidationError('prompt is empty or whitespace-only');
// Recovery hint: "Prompt must be a non-empty string (max 100,000 characters)"
```

**Impact:** Cascade fails immediately before spawning any agents.

#### Code Reference

```typescript
// src/core/agent-validation.ts:61-70
export function validatePrompt(prompt: string, label = 'prompt'): void {
  if (!prompt || prompt.trim().length === 0) {
    throw new PromptValidationError(`${label} is empty or whitespace-only`);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new PromptValidationError(
      `${label} exceeds ${MAX_PROMPT_LENGTH.toLocaleString()} characters`
    );
  }
}
```

---

### 2. Budget Pre-Check

**When:** Before each layer spawns
**Where:** [`src/core/orchestrator.ts:324-340`](../../src/core/orchestrator.ts#L324-L340)

#### Validation Rules

Two budget checks are performed before spawning an agent:

1. **Layer budget check** — Has this layer exceeded its individual budget?
2. **Total budget check** — Has the entire cascade exceeded the total budget?

**Exception:** Budget checks are skipped when `config.billing === 'max'` (estimated costs only).

#### Error Handling

**On budget exceeded:**
- ❌ Layer is skipped (returns `null`)
- ⚠️ Warning logged with cost details
- 🛑 Cascade stops at this layer

**Impact:** Prevents runaway costs but may leave cascade incomplete.

#### Code Reference

```typescript
// src/core/orchestrator.ts:324-340
if (this.config.billing !== 'max') {
  // Layer budget check
  if (agentState.totalCost >= layerConfig.maxBudgetUsd) {
    this.logger.warn(`${LAYER_LABELS[role]} budget exceeded`, {
      spent: agentState.totalCost,
      limit: layerConfig.maxBudgetUsd,
    });
    return null;
  }

  // Total cascade budget check
  if (this.state.totalCost >= this.config.maxTotalBudgetUsd) {
    this.logger.warn('Total budget exceeded', {
      spent: this.state.totalCost,
      limit: this.config.maxTotalBudgetUsd,
    });
    return null;
  }
}
```

**Recovery strategy:**
1. Increase layer budget in config: `layers['2ic'].maxBudgetUsd`
2. Increase total cascade budget: `maxTotalBudgetUsd`
3. Resume session with `--resume` flag to continue from last successful layer

---

### 3. Agent Spawn Validation

**When:** Before spawning Claude CLI process
**Where:** [`src/core/agent.ts:207-268`](../../src/core/agent.ts#L207-L268)

#### Validation Rules

All agent spawn parameters are validated before the Claude CLI process starts:

| Parameter | Validator | Rules | Error Type |
|-----------|-----------|-------|------------|
| `prompt` | `validatePrompt()` | Non-empty, max 100k chars | `PromptValidationError` |
| `model` | `validateModel()` | Must be 'opus', 'sonnet', or 'haiku' | `ModelValidationError` |
| `maxBudgetUsd` | `validateBudget()` | Min 0.01 USD | `BudgetValidationError` |
| `systemPrompt` | `validatePrompt()` | Non-empty, max 100k chars | `PromptValidationError` |
| `timeoutMs` | `validateTimeout()` | 5s to 1 hour | `TimeoutValidationError` |
| `cwd` | `validateCwd()` | Absolute path | `WorkingDirectoryValidationError` |

**Source:** [`src/core/agent-validation.ts`](../../src/core/agent-validation.ts)

#### Error Boundary Wrap

After validation, the spawn operation is wrapped with an error boundary:

```typescript
// src/core/agent.ts:211-267
return withErrorBoundary(
  async () => {
    // Validate all inputs
    validatePrompt(prompt, 'prompt');
    validateModel(opts.model);
    validateBudget(opts.maxBudgetUsd);
    validatePrompt(opts.systemPrompt, 'systemPrompt');
    // ... validation continues

    // Spawn Claude CLI
    const stdout = await runClaude(args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.cwd);
    const output = parseOutput(stdout);
    return { content, sessionId, costUsd, durationMs };
  },
  `spawnAgent(${opts.model})`,
  {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 32000,
  },
  agentCircuitBreaker,
);
```

**Error boundary features:**
- ✅ Error classification (rate_limit, timeout, network, crash, quota, unknown)
- ✅ Exponential backoff with jitter (3 retries)
- ✅ Circuit breaker (opens after 5 consecutive failures)

**Source:** [`src/core/error-boundaries.ts`](../../src/core/error-boundaries.ts)

#### Error Handling

**Validation errors** (thrown immediately):
```typescript
try {
  await spawnAgent('', { model: 'sonnet', maxBudgetUsd: 1.0, systemPrompt: '' });
} catch (err) {
  if (err instanceof PromptValidationError) {
    console.error(err.message);      // "Invalid prompt: prompt is empty or whitespace-only"
    console.error(err.recoveryHint); // "Prompt must be a non-empty string (max 100,000 characters)"
  }
}
```

**Runtime errors** (classified and retried):
```typescript
try {
  await spawnAgent(...);
} catch (err) {
  // Error boundary classifies and retries automatically
  // Only thrown if all retries exhausted
}
```

**Impact:** Invalid inputs fail fast before API calls. Runtime errors are retried with backoff.

---

### 4. Agent Output Parsing

**When:** After Claude CLI process completes
**Where:** [`src/core/agent.ts:168-204`](../../src/core/agent.ts#L168-L204)

#### Validation Rules

The Claude CLI output is parsed to extract the JSON envelope:

```typescript
// Expected output format (--output-format json)
{
  "result": "Agent's response text",
  "session_id": "claude-session-abc123",
  "total_cost_usd": 0.0023,
  "duration_ms": 1243,
  "is_error": false
}
```

**Parsing strategy:**
1. Search from end of stdout for last JSON line
2. Parse JSON and verify `result` field exists
3. Handle `error_max_turns` and other subtypes
4. Fallback to parsing entire stdout if line search fails

**Source:** [`src/core/agent.ts:168-204`](../../src/core/agent.ts#L168-L204)

#### Error Handling

**On parse failure:**
```typescript
throw new Error(`Failed to parse Claude JSON output. Got: ${stdout.slice(0, 300)}`);
```

**On agent error:**
```typescript
if (output.is_error === true) {
  throw new Error(`Claude agent error: ${output.result}`);
}
```

**Impact:** Parse failures are caught by error boundary and retried (classified as `unknown` error type).

#### Code Reference

```typescript
// src/core/agent.ts:168-204
function parseOutput(stdout: string): ClaudeJsonOutput {
  const lines = stdout.trim().split('\n');
  // Search from the end for the JSON envelope
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (typeof parsed.result === 'string') return parsed;
      // Handle error_max_turns or other cases
      if (parsed.type === 'result' && parsed.session_id) {
        return {
          result: parsed.result ?? `[Agent stopped: ${parsed.subtype ?? 'unknown'}]`,
          session_id: parsed.session_id,
          total_cost_usd: parsed.total_cost_usd,
          duration_ms: parsed.duration_ms,
          is_error: parsed.is_error ?? true,
        };
      }
    } catch { /* not JSON, keep looking */ }
  }
  throw new Error(`Failed to parse Claude JSON output`);
}
```

---

### 5. Action Schema Validation

**When:** After agent response is parsed
**Where:** [`src/core/action-parser.ts:29-103`](../../src/core/action-parser.ts#L29-L103)

#### Validation Rules

Action blocks are extracted from the agent's response and validated against the `ActionSchema`:

**Step 1: Extract JSON blocks**
- Find all ` ```json ... ``` ` fenced code blocks
- Handle embedded backticks using progressive matcher
- Parse each block as JSON

**Step 2: Validate against schema**
```typescript
// src/core/action-parser.ts:60-67
const result = ActionSchema.safeParse(item);
if (result.success) {
  actions.push(result.data);
} else {
  const errMsg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
  errors.push(`Invalid action "${item.action}": ${errMsg}`);
  logger.warn('Action validation failed', { action: item.action, error: errMsg });
}
```

**Step 3: Strip action blocks**
- Remove all action blocks from response text
- Clean up excessive newlines
- Return narrative portion

**Source:** [`src/core/action-parser.ts`](../../src/core/action-parser.ts)

#### Error Handling

**Validation errors are collected, not thrown:**

```typescript
const { actions, narrative, errors } = parseActions(response.content);

// Valid actions are returned
console.log(actions); // [{ action: 'update_plan', plan: '...' }]

// Errors are logged and returned
console.log(errors); // ["Invalid action 'create_issues': issues.0.title: Required"]
```

**Impact:** Invalid actions are skipped, but valid actions in the same response are still executed.

#### Code Reference

```typescript
// src/core/action-parser.ts:29-103
export function parseActions(text: string): { actions: Action[]; narrative: string; errors: string[] } {
  const actions: Action[] = [];
  const errors: string[] = [];
  const actionBlockRanges: Array<[number, number]> = [];

  // Find all ```json openers
  const openerRegex = /```json\s*\n/gi;
  let openerMatch: RegExpExecArray | null;

  while ((openerMatch = openerRegex.exec(text)) !== null) {
    const contentStart = openerMatch.index + openerMatch[0].length;

    // Progressive matcher: try each ``` closer until JSON.parse succeeds
    const closerRegex = /```/g;
    closerRegex.lastIndex = contentStart;
    let closerMatch: RegExpExecArray | null;

    while ((closerMatch = closerRegex.exec(text)) !== null) {
      const block = text.slice(contentStart, closerMatch.index).trim();
      try {
        const json = JSON.parse(block);
        const items = Array.isArray(json) ? json : [json];

        for (const item of items) {
          if (!item || typeof item !== 'object' || !('action' in item)) continue;

          // Validate against ActionSchema
          const result = ActionSchema.safeParse(item);
          if (result.success) {
            actions.push(result.data);
          } else {
            const errMsg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
            errors.push(`Invalid action "${item.action}": ${errMsg}`);
          }
        }

        // Record range for narrative extraction
        actionBlockRanges.push([openerMatch.index, closerMatch.index + closerMatch[0].length]);
        break;
      } catch {
        continue; // Try next closer
      }
    }
  }

  // Build narrative by removing action blocks
  let narrative = text;
  for (let i = actionBlockRanges.length - 1; i >= 0; i--) {
    narrative = narrative.slice(0, actionBlockRanges[i][0]) + narrative.slice(actionBlockRanges[i][1]);
  }
  narrative = narrative.replace(/\n{3,}/g, '\n\n').trim();

  return { actions, narrative, errors };
}
```

---

### 6. Action Execution Approval

**When:** After actions are parsed and validated
**Where:** [`src/core/action-executor.ts:80-99`](../../src/core/action-executor.ts#L80-L99)

#### Validation Rules

**Step 1: Filter by role permissions**

Each layer can only execute specific actions:

```typescript
// src/core/orchestrator.ts:636-644
const ROLE_ALLOWED_ACTIONS: Record<LayerId, Set<string>> = {
  '2ic': new Set(['update_plan', 'request_info', 'escalate']),
  'eng-lead': new Set(['update_plan', 'create_branch', 'request_info', 'escalate']),
  'team-lead': new Set(['create_issues', 'invoke_cheenoski', 'request_info', 'request_review']),
};
```

**Filtered out actions emit error events:**
```typescript
// src/core/orchestrator.ts:649-656
const errorMsg = `Action "${action.action}" not allowed for ${LAYER_LABELS[role]} role`;
this.logger.error(errorMsg);
this.bus.emitEchelon({ type: 'error', role, error: errorMsg });
```

**Step 2: Check approval mode**

Based on `config.approvalMode`:

| Mode | Behavior | Destructive Actions | Non-Destructive Actions |
|------|----------|---------------------|------------------------|
| `none` | Auto-execute all | ✅ Execute | ✅ Execute |
| `destructive` | Require approval for specific actions | ⏸ Queue for approval | ✅ Execute |
| `all` | Require approval for everything | ⏸ Queue for approval | ⏸ Queue for approval |

**Destructive actions:** `create_issues`, `invoke_cheenoski`, `create_branch`

**Source:** [`src/core/action-executor.ts:14`](../../src/core/action-executor.ts#L14)

**Step 3: Queue or execute**

```typescript
// src/core/action-executor.ts:80-99
async executeOrQueue(action: Action, from: AgentRole, dryRun: boolean) {
  if (dryRun) {
    logger.info(`[DRY RUN] Would execute: ${describeAction(action)}`);
    return { executed: false, result: `[DRY RUN] ${desc}` };
  }

  if (this.needsApproval(action)) {
    const approval = this.queueForApproval(action, from);
    this.bus.emitEchelon({ type: 'action_pending', approval });
    return { executed: false, result: `Queued for CEO approval: ${approval.id}` };
  }

  return this.execute(action);
}
```

#### Error Handling

**Execution errors:**
```typescript
// src/core/action-executor.ts:109-119
async execute(action: Action): Promise<{ executed: boolean; result: string }> {
  try {
    const result = await this.dispatch(action);
    this.bus.emitEchelon({ type: 'action_executed', action, result });
    return { executed: true, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Action execution failed', { action: action.action, error: msg });
    return { executed: false, result: `Error: ${msg}` };
  }
}
```

**Impact:** Execution errors are logged but don't crash the cascade. The layer continues with remaining actions.

---

### 7. Layer Output Validation

**When:** After layer completes and before proceeding to next layer
**Where:** [`src/core/orchestrator.ts:682-693`](../../src/core/orchestrator.ts#L682-L693)

#### Validation Rules

Before passing the layer's output to the next layer, validate:

1. **Content is non-empty**
2. **Cost is valid** (>= 0)

```typescript
// src/core/orchestrator.ts:682-693
private validateLayerOutput(msg: LayerMessage): boolean {
  if (!msg.content || msg.content.trim().length === 0) {
    this.logger.warn(`Empty content from ${msg.from}`);
    return false;
  }
  if (msg.costUsd < 0) {
    this.logger.warn(`Invalid cost from ${msg.from}: ${msg.costUsd}`);
    return false;
  }
  return true;
}
```

#### Error Handling

**On validation failure:**
```typescript
// src/core/orchestrator.ts:173-178
if (!this.validateLayerOutput(strategyMsg)) {
  this.logger.error('Strategy message validation failed — aborting cascade');
  this.state.status = 'failed';
  saveState(this.state);
  return;
}
```

**Impact:** Cascade is aborted immediately. Session can be resumed after investigating the root cause.

---

## End-to-End Example

Let's trace validation through a complete cascade for the directive: **"Implement JWT authentication"**

### Phase 1: CEO → 2IC (Strategy)

**Input:** `directive = "Implement JWT authentication"`

#### Checkpoint 1: Directive Input Validation
```typescript
// orchestrator.ts:158 passes directive as prompt to runLayer
await this.runLayer('2ic', 'ceo', directive);

// runLayer → spawnAgent → validatePrompt
validatePrompt('Implement JWT authentication', 'prompt');
// ✅ Pass: Non-empty, < 100k chars
```

#### Checkpoint 2: Budget Pre-Check
```typescript
// orchestrator.ts:324-340
const agentState = this.state.agents['2ic'];
const layerConfig = this.config.layers['2ic'];

// Layer budget: $0.00 / $1.00 ✅
if (agentState.totalCost >= layerConfig.maxBudgetUsd) { /* skip */ }

// Total budget: $0.00 / $5.00 ✅
if (this.state.totalCost >= this.config.maxTotalBudgetUsd) { /* skip */ }
```

#### Checkpoint 3: Agent Spawn Validation
```typescript
// agent.ts:207-268 (inside withErrorBoundary)
validatePrompt('Implement JWT authentication', 'prompt');  // ✅
validateModel('sonnet');                                    // ✅
validateBudget(1.0);                                        // ✅
validatePrompt(buildSystemPrompt('2ic', config), 'systemPrompt'); // ✅
validateTimeout(600_000);                                   // ✅ (10 min)
validateCwd('/path/to/project');                            // ✅ (absolute)

// Spawn Claude CLI
const stdout = await runClaude(['--model', 'sonnet', ...], 600000, '/path/to/project');
```

#### Checkpoint 4: Agent Output Parsing
```typescript
// agent.ts:168-204
const output = parseOutput(stdout);
// {
//   result: "I'll break down JWT authentication into workstreams:\n\n```json\n{\"action\":\"update_plan\",...}\n```",
//   session_id: "claude-session-2ic-abc",
//   total_cost_usd: 0.0023,
//   is_error: false
// }
// ✅ Valid JSON envelope
```

#### Checkpoint 5: Action Schema Validation
```typescript
// orchestrator.ts:394 → action-parser.ts:29
const { actions, narrative, errors } = parseActions(response.content);

// Extract ```json blocks
const block = `{"action":"update_plan","plan":"...","workstreams":["Backend API","Frontend UI"]}`;

// Validate against ActionSchema
const result = ActionSchema.safeParse(JSON.parse(block));
// ✅ Valid: { action: 'update_plan', plan: '...', workstreams: [...] }

console.log(actions); // [{ action: 'update_plan', ... }]
console.log(errors);  // []
```

#### Checkpoint 6: Action Execution Approval
```typescript
// orchestrator.ts:421-424
const allowedActions = this.filterActionsByRole(actions, '2ic');
// ✅ '2ic' can execute 'update_plan'

for (const action of allowedActions) {
  await this.executor.executeOrQueue(action, '2ic', this.dryRun);
}

// action-executor.ts:80-99
if (this.needsApproval(action)) { /* approvalMode = 'destructive', update_plan not destructive */ }
return this.execute(action);

// action-executor.ts:109-119 → dispatch
this.state.plan = action.plan; // Update state
return `Plan updated with 2 workstreams`;
// ✅ Action executed
```

#### Checkpoint 7: Layer Output Validation
```typescript
// orchestrator.ts:173-178
if (!this.validateLayerOutput(strategyMsg)) { /* abort */ }

// orchestrator.ts:682-693
validateLayerOutput({
  content: "I'll break down JWT authentication...",  // ✅ Non-empty
  costUsd: 0.0023,                                    // ✅ Valid
});
// ✅ Pass
```

**Result:** 2IC layer completes successfully. Total cost: $0.0023.

---

### Phase 2: 2IC → Eng Lead (Technical Design)

**Input:** `buildDownwardPrompt(strategyMsg)`

```typescript
// orchestrator.ts:204
const designInput = await this.buildDownwardPrompt(strategyMsg);
// "The 2IC has provided the following direction:
//
// I'll break down JWT authentication into workstreams:
// - Backend API (token generation, validation)
// - Frontend UI (login form, token storage)
//
// ## Plan
// [Plan text from update_plan action]
//
// Based on this, proceed with your responsibilities."
```

**Validation flow:**
- Checkpoint 2: Budget pre-check (Eng Lead: $0.00 / $1.50) ✅
- Checkpoint 3: Agent spawn validation ✅
- Checkpoint 4: Agent output parsing ✅
- Checkpoint 5: Action schema validation
  - Actions: `[{ action: 'update_plan', ... }, { action: 'create_branch', branch_name: 'feature/jwt-auth', from: 'main' }]`
  - ✅ Both valid
- Checkpoint 6: Action execution
  - `update_plan` → Auto-execute ✅
  - `create_branch` → **Queue for approval** (destructive action in mode='destructive') ⏸
- Checkpoint 7: Layer output validation ✅

**Result:** Eng Lead layer completes. 1 action pending approval. Total cost: $0.0048.

---

### Phase 3: Team Lead → Engineers (Execution)

**Input:** `buildDownwardPrompt(designMsg, 'team-lead')`

**Validation flow:**
- Checkpoint 2: Budget pre-check (Team Lead: $0.00 / $2.00) ✅
- Checkpoint 3: Agent spawn validation ✅
- Checkpoint 4: Agent output parsing ✅
- Checkpoint 5: Action schema validation
  - Actions:
    ```json
    [
      {
        "action": "create_issues",
        "issues": [
          { "title": "[Backend] JWT token generation endpoint", "body": "...", "labels": ["backend", "cheenoski-0"] },
          { "title": "[Frontend] Login form component", "body": "...", "labels": ["frontend", "cheenoski-0"] }
        ]
      },
      {
        "action": "invoke_cheenoski",
        "label": "cheenoski-0",
        "maxParallel": 2
      }
    ]
    ```
  - ✅ Both valid
- Checkpoint 6: Action execution
  - `create_issues` → **Queue for approval** (destructive) ⏸
  - `invoke_cheenoski` → **Queue for approval** (destructive) ⏸
- Checkpoint 7: Layer output validation ✅

**Result:** Team Lead layer completes. 2 actions pending approval. Total cost: $0.0071.

---

### Approval and Execution

**Pending approvals:**
1. `create_branch` (Eng Lead) — Approval ID: `abc12345`
2. `create_issues` (Team Lead) — Approval ID: `def67890`
3. `invoke_cheenoski` (Team Lead) — Approval ID: `ghi11223`

**CEO approves all:**
```typescript
// Via TUI or programmatically
await orchestrator.approveAllPending();
// Or individually:
await executor.approve('abc12345'); // Create branch: feature/jwt-auth
await executor.approve('def67890'); // Create 2 issues
await executor.approve('ghi11223'); // Invoke Cheenoski for cheenoski-0
```

**Final state:**
- ✅ Branch created: `feature/jwt-auth`
- ✅ Issues created: #42, #43
- ✅ Cheenoski spawned: Processing issues in parallel
- 💰 Total cost: $0.0071

---

## Validation Checkpoints Summary

| # | Checkpoint | Location | Validates | Error Handling | Impact |
|---|-----------|----------|-----------|----------------|--------|
| 1 | Directive Input | `orchestrator.ts:158` → `agent.ts:214` | Non-empty, max 100k chars | `PromptValidationError` — Fail immediately | Cascade never starts |
| 2 | Budget Pre-Check | `orchestrator.ts:324-340` | Layer budget, total budget | Log warning, return `null` | Layer skipped, cascade stops |
| 3 | Agent Spawn | `agent.ts:207-268` | Model, budget, prompts, timeout, cwd | Custom validation errors, retry with backoff | Early failure or automatic retry |
| 4 | Output Parsing | `agent.ts:168-204` | JSON envelope structure | Parse error, retry as `unknown` type | Automatic retry |
| 5 | Action Schema | `action-parser.ts:29-103` | ActionSchema (Zod) | Collect errors, continue with valid actions | Invalid actions skipped |
| 6 | Action Execution | `action-executor.ts:80-99` | Role permissions, approval mode | Log error, skip unauthorized actions | Only authorized actions execute |
| 7 | Layer Output | `orchestrator.ts:682-693` | Non-empty content, valid cost | Abort cascade, save state | Cascade fails, can resume |

**Key insight:** Validation is progressive and layered. Early checkpoints (1-3) fail fast to prevent wasted work. Later checkpoints (5-7) are more forgiving, allowing partial success.

---

## Error Handling Integration

Validation errors integrate with the error recovery infrastructure:

### Validation Errors (Fail Fast)

**Thrown by:** Checkpoints 1-3 (input validation)
**Errors:** `PromptValidationError`, `ModelValidationError`, `BudgetValidationError`, etc.
**Behavior:** Fail immediately without retry
**Recovery:** User must fix input and re-run

**Example:**
```typescript
try {
  await spawnAgent('', { model: 'sonnet', maxBudgetUsd: 1.0, systemPrompt: '' });
} catch (err) {
  console.error(err.message);      // "Invalid prompt: prompt is empty or whitespace-only"
  console.error(err.recoveryHint); // "Prompt must be a non-empty string (max 100,000 characters)"
  process.exit(1); // Cannot proceed
}
```

### Runtime Errors (Retry with Backoff)

**Thrown by:** Checkpoint 3 (agent spawn runtime), Checkpoint 4 (output parsing)
**Errors:** Rate limit, timeout, network, crash, unknown
**Behavior:** Automatic retry with exponential backoff (3 attempts)
**Recovery:** Most errors resolve automatically; manual intervention if retries exhausted

**Example:**
```typescript
// Wrapped by withErrorBoundary
try {
  await spawnAgent(...); // May hit rate limit
} catch (err) {
  // Only thrown if all 3 retries fail
  console.error('Agent spawn failed after retries:', err.message);
  // Check recovery hint for manual intervention
}
```

**See:** [Error Scenario Recovery Patterns](./error-recovery.md) for complete error handling guide.

### Action Validation Errors (Collect and Continue)

**Thrown by:** Checkpoint 5 (action schema validation)
**Errors:** Zod validation errors (missing fields, wrong types)
**Behavior:** Collect errors, continue with valid actions
**Recovery:** Invalid actions are skipped; layer proceeds normally

**Example:**
```typescript
const { actions, errors } = parseActions(response.content);

if (errors.length > 0) {
  logger.warn('Some actions failed validation', { errors });
  // Continue with valid actions
}

for (const action of actions) {
  await executor.executeOrQueue(action, role, dryRun);
}
```

### Circuit Breaker (System Protection)

**Triggered by:** 5 consecutive failures (any error type)
**Behavior:** Fail fast for 60 seconds, then auto-reset
**Recovery:** Wait for auto-reset or manually reset circuit breaker

**Example:**
```typescript
try {
  await spawnAgent(...);
} catch (err) {
  if (err.message.includes('Circuit breaker open')) {
    console.error('System overload — waiting 60s for auto-reset');
    await new Promise(resolve => setTimeout(resolve, 60000));
    // Retry after reset
  }
}
```

**See:** [Error Scenario Recovery Patterns: Circuit Breaker](./error-recovery.md#6-circuit-breaker-trip) for details.

---

## Related Documentation

- **[Agent API Reference](../api/validation/agent-api.md)** — Agent spawn/resume validation rules
- **[Action Parser Validation](../api/validation/action-parser.md)** — Action extraction and schema validation
- **[Error Boundaries and Circuit Breaker](../api/validation/error-boundaries.md)** — Error classification and retry logic
- **[Error Scenario Recovery Patterns](./error-recovery.md)** — Complete error handling guide
- **[Agent Validation](../../src/core/agent-validation.ts)** — Input validation implementation
- **[Action Executor](../../src/core/action-executor.ts)** — Action dispatch and approval management
- **[Orchestrator](../../src/core/orchestrator.ts)** — Cascade orchestration and budget checks

---

## Summary

Echelon's validation architecture ensures **robust, fail-safe operation** through:

✅ **Layered validation** — Each checkpoint handles a specific concern (input, budget, schema, permissions)
✅ **Fail fast** — Invalid inputs are caught before expensive operations
✅ **Progressive recovery** — Runtime errors are retried automatically; validation errors fail immediately
✅ **Graceful degradation** — Invalid actions are skipped; valid actions proceed
✅ **Budget enforcement** — Costs are checked before each layer to prevent runaway spending
✅ **Circuit breaker protection** — System self-protects after repeated failures

**Key design principles:**
1. **Validate early** — Catch errors at the boundary (input validation)
2. **Fail safely** — Validation errors provide recovery hints
3. **Retry transient errors** — Network/rate limit errors resolve with backoff
4. **Continue on partial failure** — Invalid actions don't block valid ones
5. **Protect the system** — Circuit breaker prevents cascading failures

For implementation details, see the source files referenced throughout this guide.

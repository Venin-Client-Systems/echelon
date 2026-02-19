# Agent API Reference

The agent API (`src/core/agent.ts`) provides functions to spawn and resume Claude Code agent sessions. These functions handle process management, timeout control, output parsing, error recovery, and circuit breaking.

---

## Table of Contents

- [Overview](#overview)
- [Core Functions](#core-functions)
  - [spawnAgent()](#spawnagent)
  - [resumeAgent()](#resumeagent)
- [Interfaces](#interfaces)
  - [SpawnOptions](#spawnoptions)
  - [AgentResponse](#agentresponse)
  - [ClaudeJsonOutput](#claudejsonoutput)
- [Validation Lifecycle](#validation-lifecycle)
  - [1. Binary Resolution](#1-binary-resolution)
  - [2. Input Validation](#2-input-validation)
  - [3. Process Execution](#3-process-execution)
  - [4. Output Parsing](#4-output-parsing)
  - [5. Error Flag Check](#5-error-flag-check)
  - [6. Error Boundary Wrapper](#6-error-boundary-wrapper)
- [Error Handling](#error-handling)
- [Examples](#examples)
- [Integration](#integration)

---

## Overview

The agent API wraps the `claude` CLI to spawn and resume agent sessions with:

- **Automatic retries** — 3 retries with exponential backoff (1s → 2s → 4s + jitter)
- **Circuit breaking** — Shared circuit breaker (5 failures in 60s trips circuit)
- **Timeout control** — Graceful shutdown with SIGTERM → SIGKILL escalation
- **Output validation** — Parses JSON envelope from stdout, validates schema
- **Cost tracking** — Returns total cost in USD from Claude CLI
- **Session persistence** — Returns session ID for resuming conversations

**File:** [`src/core/agent.ts`](../../../src/core/agent.ts)

---

## Core Functions

### spawnAgent()

Spawns a new Claude Code agent session.

**Signature:**
```typescript
async function spawnAgent(
  prompt: string,
  opts: SpawnOptions,
): Promise<AgentResponse>
```

**Parameters:**
- `prompt` (string) — Initial prompt for the agent
- `opts` ([SpawnOptions](#spawnoptions)) — Configuration options

**Returns:**
[AgentResponse](#agentresponse) — Agent output with session ID, cost, and duration

**Throws:**
- `'claude CLI not found. Install from https://claude.ai/cli'` — Binary not in PATH
- `'Claude timed out after <ms>ms'` — Process exceeded timeout
- `'Claude exited <code>: <stderr>'` — Process exited with non-zero code
- `'Failed to parse Claude JSON output'` — Invalid JSON envelope
- `'Claude agent error: <result>'` — Agent reported error (max turns, API error, etc.)

**Source:** [`src/core/agent.ts:144-191`](../../../src/core/agent.ts#L144-L191)

**Example:**
```typescript
import { spawnAgent } from './core/agent.js';

const response = await spawnAgent(
  'Analyze the codebase and suggest improvements',
  {
    model: 'sonnet',
    maxBudgetUsd: 1.0,
    systemPrompt: 'You are a code review expert.',
    maxTurns: 5,
    timeoutMs: 300_000, // 5 minutes
    cwd: '/path/to/project',
    yolo: false,
  },
);

console.log('Session ID:', response.sessionId);
console.log('Cost:', response.costUsd);
console.log('Response:', response.content);
```

---

### resumeAgent()

Resumes an existing Claude Code agent session.

**Signature:**
```typescript
async function resumeAgent(
  sessionId: string,
  prompt: string,
  opts: {
    maxTurns?: number;
    timeoutMs?: number;
    cwd?: string;
    maxBudgetUsd?: number;
    yolo?: boolean;
  },
): Promise<AgentResponse>
```

**Parameters:**
- `sessionId` (string) — Session ID from previous `spawnAgent()` or `resumeAgent()` call
- `prompt` (string) — Follow-up prompt for the agent
- `opts` (object) — Configuration options (all optional)
  - `maxTurns` (number) — Max agentic turns (default: 8)
  - `timeoutMs` (number) — Process timeout in ms (default: 600,000 = 10 min)
  - `cwd` (string) — Working directory for agent
  - `maxBudgetUsd` (number) — Budget limit in USD
  - `yolo` (boolean) — Skip permission prompts (default: false)

**Returns:**
[AgentResponse](#agentresponse) — Agent output with session ID, cost, and duration

**Throws:**
Same errors as [spawnAgent()](#spawnagent)

**Source:** [`src/core/agent.ts:194-241`](../../../src/core/agent.ts#L194-L241)

**Example:**
```typescript
import { resumeAgent } from './core/agent.js';

// Resume the session
const response = await resumeAgent(
  'claude-session-abc123',
  'Now implement the authentication module',
  {
    maxTurns: 10,
    maxBudgetUsd: 2.0,
  },
);

console.log('Response:', response.content);
```

---

## Interfaces

### SpawnOptions

Configuration options for spawning a new agent session.

**Source:** [`src/core/agent.ts:30-38`](../../../src/core/agent.ts#L30-L38)

```typescript
interface SpawnOptions {
  model: string;                          // Required: 'opus', 'sonnet', 'haiku'
  maxBudgetUsd: number;                   // Required: Budget limit (>0)
  systemPrompt: string;                   // Required: Appended to agent prompt
  maxTurns?: number;                      // Optional: Defaults from DEFAULT_MAX_TURNS
  timeoutMs?: number;                     // Optional: Default 600_000 (10 min)
  cwd?: string;                           // Optional: Working directory
  yolo?: boolean;                         // Optional: Skip permission prompts
}
```

**Parameter Details:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | `string` | ✅ | — | Claude model: `'opus'`, `'sonnet'`, or `'haiku'` |
| `maxBudgetUsd` | `number` | ✅ | — | Budget limit in USD (must be > 0) |
| `systemPrompt` | `string` | ✅ | — | System prompt appended to agent context |
| `maxTurns` | `number` | ❌ | `DEFAULT_MAX_TURNS[model]` | Max agentic turns (opus: 20, sonnet: 15, haiku: 8) |
| `timeoutMs` | `number` | ❌ | `600_000` | Process timeout in milliseconds |
| `cwd` | `string` | ❌ | `process.cwd()` | Working directory for agent process |
| `yolo` | `boolean` | ❌ | `false` | Pass `--dangerously-skip-permissions` to Claude CLI |

**Validation Rules:**
- `model` — Must be valid enum (not validated in TypeScript, passed to CLI)
- `maxBudgetUsd` — Must be positive number (CLI rejects if ≤ 0)
- `systemPrompt` — Must be non-empty string
- `maxTurns` — Must be positive integer if provided
- `timeoutMs` — Must be positive integer if provided

---

### AgentResponse

Response object returned by `spawnAgent()` and `resumeAgent()`.

**Source:** [`src/core/agent.ts:40-45`](../../../src/core/agent.ts#L40-L45)

```typescript
interface AgentResponse {
  content: string;       // Agent's response text
  sessionId: string;     // Session ID for resume
  costUsd: number;       // Total cost in USD
  durationMs: number;    // Execution time in ms
}
```

**Field Details:**

| Field | Type | Description |
|-------|------|-------------|
| `content` | `string` | Agent's natural language response (may contain action blocks) |
| `sessionId` | `string` | Unique session ID — save this to resume the conversation |
| `costUsd` | `number` | Total cost in USD for this operation (from `total_cost_usd` in CLI output) |
| `durationMs` | `number` | Execution time in milliseconds (measured from start to end of operation) |

**Example:**
```typescript
const response = await spawnAgent('Hello', { model: 'haiku', maxBudgetUsd: 0.5, systemPrompt: '' });

console.log(response);
// {
//   content: 'Hello! How can I help you today?',
//   sessionId: 'claude-session-f3a2b1c0',
//   costUsd: 0.0023,
//   durationMs: 1243
// }
```

---

### ClaudeJsonOutput

Internal interface for Claude CLI JSON output (from `--output-format json`).

**Source:** [`src/lib/types.ts:324-330`](../../../src/lib/types.ts#L324-L330)

```typescript
interface ClaudeJsonOutput {
  result: string;
  session_id: string;
  total_cost_usd?: number;
  duration_ms?: number;
  is_error?: boolean;
}
```

**Field Details:**

| Field | Type | Description |
|-------|------|-------------|
| `result` | `string` | Agent's response text (required) |
| `session_id` | `string` | Session ID for resuming (required) |
| `total_cost_usd` | `number` | Total cost in USD (optional, defaults to 0) |
| `duration_ms` | `number` | Duration in milliseconds (optional) |
| `is_error` | `boolean` | `true` if agent reported error (e.g., max turns exceeded) |

**Notes:**
- This is an **internal interface** — users interact with `AgentResponse`, not `ClaudeJsonOutput`
- The parser (`parseOutput()`) searches the last 100 lines of stdout for this JSON envelope
- If `is_error === true`, the agent throws an error with the `result` message

---

## Validation Lifecycle

The agent API validates inputs and outputs at 6 checkpoints:

### 1. Binary Resolution

**Function:** `getClaudeBin()` ([`src/core/agent.ts:19-28`](../../../src/core/agent.ts#L19-L28))

**What it does:**
- Resolves the `claude` CLI binary path using `which claude`
- Caches the path globally to avoid repeated `which` calls
- Throws if binary not found in PATH

**Validation:**
```typescript
const { stdout } = await execFileAsync('which', ['claude'], { encoding: 'utf-8' });
claudeBin = stdout.trim();
```

**Error:**
```
Error: claude CLI not found. Install from https://claude.ai/cli
```

**Example:**
```bash
# User hasn't installed Claude CLI
$ npm start
Error: claude CLI not found. Install from https://claude.ai/cli

# Fix
$ brew install claude-ai/tap/claude
$ claude --version
claude 1.2.3
```

---

### 2. Input Validation

**Function:** `spawnAgent()` / `resumeAgent()`

**What it does:**
- Implicitly validates parameters via TypeScript types
- No explicit runtime validation — relies on CLI to reject invalid inputs

**Validation Rules:**
- `prompt` — Must be non-empty string (TypeScript type)
- `sessionId` — Must be non-empty string (TypeScript type)
- `opts.model` — Must be valid string (CLI validates enum)
- `opts.maxBudgetUsd` — Must be positive number (CLI validates > 0)
- `opts.systemPrompt` — Must be string (TypeScript type)

**Why no runtime validation?**
The Claude CLI provides comprehensive validation and error messages. Duplicating validation in TypeScript would:
- Add maintenance burden (keep in sync with CLI)
- Reduce error message quality (CLI errors are more detailed)
- Add unnecessary overhead

**Example (invalid model):**
```typescript
// TypeScript allows this (model is just `string`)
await spawnAgent('Hello', { model: 'invalid', maxBudgetUsd: 1, systemPrompt: '' });

// CLI rejects it:
// Error: Claude exited 1: Invalid model "invalid". Valid models: opus, sonnet, haiku
```

---

### 3. Process Execution

**Function:** `runClaude()` ([`src/core/agent.ts:47-103`](../../../src/core/agent.ts#L47-L103))

**What it does:**
- Spawns `claude` CLI subprocess with timeout
- Collects stdout/stderr
- Handles timeout with graceful shutdown (SIGTERM → SIGKILL)
- Validates exit code

**Timeout Handling:**
```typescript
const timer = setTimeout(() => {
  proc.kill('SIGTERM');
  // Follow up with SIGKILL if SIGTERM doesn't work
  killTimer = setTimeout(() => {
    proc.kill('SIGKILL');
  }, 5_000); // 5s grace period
  reject(new Error(`Claude timed out after ${timeoutMs}ms`));
}, timeoutMs);
```

**Exit Code Validation:**
```typescript
if (code !== 0) {
  logger.error('Claude process failed', { code, stderr: stderr.slice(0, 500) });
  reject(new Error(`Claude exited ${code}: ${stderr.slice(0, 500)}`));
}
```

**Errors:**
- `'Claude timed out after <ms>ms'` — Process exceeded timeout
- `'Claude exited <code>: <stderr>'` — Non-zero exit code
- `'Failed to spawn claude: <message>'` — Spawn error (e.g., ENOENT)

**Example:**
```typescript
// Timeout after 1 second
await spawnAgent('Complex analysis task', {
  model: 'opus',
  maxBudgetUsd: 1,
  systemPrompt: '',
  timeoutMs: 1000, // Too short!
});

// Error: Claude timed out after 1000ms
```

---

### 4. Output Parsing

**Function:** `parseOutput()` ([`src/core/agent.ts:105-141`](../../../src/core/agent.ts#L105-L141))

**What it does:**
- Searches last 100 lines of stdout for JSON envelope
- Handles malformed JSON gracefully (skips non-JSON lines)
- Handles `error_max_turns` and other error cases
- Falls back to parsing entire stdout if no JSON found in tail

**Parsing Algorithm:**
```typescript
const lines = stdout.trim().split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const parsed = JSON.parse(lines[i]);
    if (typeof parsed.result === 'string') return parsed;
    // Handle error_max_turns or other cases
    if (parsed.type === 'result' && parsed.session_id) {
      return {
        result: parsed.result ?? `[Agent stopped: ${parsed.subtype ?? 'unknown'}]`,
        session_id: parsed.session_id,
        is_error: parsed.is_error ?? true,
      };
    }
  } catch { /* not JSON, keep looking */ }
}
```

**Why search from the end?**
- Claude CLI may emit progress messages before final JSON
- Final JSON envelope is always the last structured output
- Searching backwards is more efficient (usually finds JSON on first line)

**Error:**
```
Error: Failed to parse Claude JSON output (expected {result: string}). Got: <preview>
```

**Example (corrupted output):**
```bash
# Claude CLI crashes mid-output
$ claude -p "Hello" --output-format json
Processing...
{"result": "Hell
# Process killed

# Parser throws:
# Error: Failed to parse Claude JSON output (expected {result: string}). Got: Processing...\n{"result": "Hell
```

---

### 5. Error Flag Check

**Function:** `spawnAgent()` / `resumeAgent()`

**What it does:**
- Checks `output.is_error === true` after parsing
- Throws error with agent's error message
- Catches Claude-reported errors (max turns, API errors, budget exceeded)

**Validation:**
```typescript
const output = parseOutput(stdout);

if (output.is_error === true) {
  throw new Error(`Claude agent error: ${output.result}`);
}
```

**When does Claude set `is_error: true`?**
- Max turns exceeded (`error_max_turns`)
- API errors (rate limits, network failures)
- Budget exceeded
- User cancellation (Ctrl+C)

**Example:**
```typescript
// Agent exceeds max turns
await spawnAgent('Complex multi-step task', {
  model: 'haiku',
  maxBudgetUsd: 1,
  systemPrompt: '',
  maxTurns: 2, // Too few!
});

// Error: Claude agent error: [Agent stopped: error_max_turns]
```

**Source:** [`src/core/agent.ts:172-174`](../../../src/core/agent.ts#L172-L174) (spawnAgent), [`src/core/agent.ts:222-224`](../../../src/core/agent.ts#L222-L224) (resumeAgent)

---

### 6. Error Boundary Wrapper

**Function:** `withErrorBoundary()` (from `src/core/error-boundaries.ts`)

**What it does:**
- Wraps entire operation in retry logic
- Implements exponential backoff (1s → 2s → 4s + jitter)
- Uses shared circuit breaker (5 failures in 60s trips circuit)
- Labels operation for observability

**Configuration:**
```typescript
return withErrorBoundary(
  async () => { /* spawn/resume logic */ },
  `spawnAgent(${opts.model})`,  // Label for logging
  {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 32000,
  },
  agentCircuitBreaker,  // Shared circuit breaker
);
```

**Circuit Breaker:**
- **Threshold:** 5 failures within 60s window
- **Scope:** Shared across ALL agent operations (spawn + resume)
- **Recovery:** Auto-resets after 60s without failures
- **Effect:** Fails fast if circuit is open (avoids cascading failures)

**Retry Logic:**
- **Attempt 1:** Run immediately
- **Attempt 2:** Wait 1s + jitter (0-200ms)
- **Attempt 3:** Wait 2s + jitter (0-400ms)
- **Attempt 4:** Wait 4s + jitter (0-800ms)
- **Failure:** Throw error after 3 retries

**Example:**
```typescript
// Transient network error
await spawnAgent('Hello', { model: 'sonnet', maxBudgetUsd: 1, systemPrompt: '' });

// Logs:
// [retry] Attempt 1/4 failed: ECONNRESET
// [retry] Waiting 1234ms before retry
// [retry] Attempt 2/4 failed: ECONNRESET
// [retry] Waiting 2567ms before retry
// [retry] Attempt 3/4 succeeded
```

**Source:** [`src/core/agent.ts:148-190`](../../../src/core/agent.ts#L148-L190) (spawnAgent), [`src/core/agent.ts:199-240`](../../../src/core/agent.ts#L199-L240) (resumeAgent)

---

## Error Handling

### Error Scenarios

| Error | Checkpoint | Retryable? | Recovery |
|-------|-----------|------------|----------|
| `claude CLI not found` | [1. Binary Resolution](#1-binary-resolution) | ❌ | Install Claude CLI |
| `Claude timed out after <ms>ms` | [3. Process Execution](#3-process-execution) | ✅ | Increase `timeoutMs` |
| `Claude exited <code>` | [3. Process Execution](#3-process-execution) | ✅ | Check CLI args, model, budget |
| `Failed to parse Claude JSON output` | [4. Output Parsing](#4-output-parsing) | ✅ | Check stdout for corruption |
| `Claude agent error: <result>` | [5. Error Flag Check](#5-error-flag-check) | ❌ | Fix task, increase maxTurns, budget |
| `Circuit breaker open` | [6. Error Boundary](#6-error-boundary-wrapper) | ❌ | Wait 60s for auto-reset |

### Error Examples

**Binary not found:**
```typescript
try {
  await spawnAgent('Hello', { model: 'sonnet', maxBudgetUsd: 1, systemPrompt: '' });
} catch (err) {
  console.error(err.message);
  // claude CLI not found. Install from https://claude.ai/cli
}
```

**Timeout:**
```typescript
try {
  await spawnAgent('Long task', {
    model: 'opus',
    maxBudgetUsd: 1,
    systemPrompt: '',
    timeoutMs: 1000, // Too short
  });
} catch (err) {
  console.error(err.message);
  // Claude timed out after 1000ms
}
```

**Max turns exceeded:**
```typescript
try {
  await spawnAgent('Complex multi-step task', {
    model: 'haiku',
    maxBudgetUsd: 1,
    systemPrompt: '',
    maxTurns: 2, // Too few
  });
} catch (err) {
  console.error(err.message);
  // Claude agent error: [Agent stopped: error_max_turns]
}
```

**Circuit breaker open:**
```typescript
// After 5 failures in 60s
try {
  await spawnAgent('Hello', { model: 'sonnet', maxBudgetUsd: 1, systemPrompt: '' });
} catch (err) {
  console.error(err.message);
  // Circuit breaker open for spawnAgent(sonnet)
}
```

---

## Examples

### Basic Spawn

```typescript
import { spawnAgent } from './core/agent.js';

const response = await spawnAgent(
  'Review the codebase and suggest improvements',
  {
    model: 'sonnet',
    maxBudgetUsd: 1.0,
    systemPrompt: 'You are a senior software engineer specializing in code quality.',
  },
);

console.log('Session:', response.sessionId);
console.log('Cost:', response.costUsd);
console.log('Response:', response.content);
```

### Spawn with Custom Config

```typescript
const response = await spawnAgent(
  'Implement authentication module',
  {
    model: 'opus',
    maxBudgetUsd: 5.0,
    systemPrompt: 'You are an expert in secure authentication systems.',
    maxTurns: 20,
    timeoutMs: 900_000, // 15 minutes
    cwd: '/path/to/project',
    yolo: true, // Skip permission prompts
  },
);
```

### Resume Session

```typescript
import { resumeAgent } from './core/agent.js';

// First spawn
const spawn = await spawnAgent('Create a user service', {
  model: 'sonnet',
  maxBudgetUsd: 2.0,
  systemPrompt: '',
});

console.log('First response:', spawn.content);

// Resume with follow-up
const resume = await resumeAgent(
  spawn.sessionId,
  'Now add input validation to the user service',
  {
    maxTurns: 10,
    maxBudgetUsd: 1.0,
  },
);

console.log('Second response:', resume.content);
```

### Error Handling

```typescript
import { spawnAgent } from './core/agent.js';

async function runAgent() {
  try {
    const response = await spawnAgent('Hello', {
      model: 'sonnet',
      maxBudgetUsd: 1.0,
      systemPrompt: '',
      timeoutMs: 300_000,
    });
    return response;
  } catch (err) {
    if (err.message.includes('timed out')) {
      console.error('Agent timed out — increase timeoutMs');
    } else if (err.message.includes('not found')) {
      console.error('Claude CLI not installed');
    } else if (err.message.includes('error_max_turns')) {
      console.error('Agent exceeded max turns — increase maxTurns');
    } else if (err.message.includes('Circuit breaker')) {
      console.error('Too many failures — wait 60s for reset');
    } else {
      console.error('Unknown error:', err.message);
    }
    throw err;
  }
}
```

### Multi-Turn Conversation

```typescript
import { spawnAgent, resumeAgent } from './core/agent.js';

async function conversation() {
  // Turn 1: Initial request
  const turn1 = await spawnAgent('Analyze the authentication module', {
    model: 'sonnet',
    maxBudgetUsd: 1.0,
    systemPrompt: 'You are a security expert.',
  });
  console.log('Turn 1:', turn1.content);

  // Turn 2: Ask for details
  const turn2 = await resumeAgent(turn1.sessionId, 'What are the main vulnerabilities?', {
    maxTurns: 5,
  });
  console.log('Turn 2:', turn2.content);

  // Turn 3: Request fixes
  const turn3 = await resumeAgent(turn2.sessionId, 'Fix the vulnerabilities you found', {
    maxTurns: 10,
    maxBudgetUsd: 2.0,
  });
  console.log('Turn 3:', turn3.content);

  return {
    sessionId: turn3.sessionId,
    totalCost: turn1.costUsd + turn2.costUsd + turn3.costUsd,
  };
}
```

---

## Integration

### Orchestrator Integration

The orchestrator uses `spawnAgent()` and `resumeAgent()` to manage hierarchical agents:

**Source:** [`src/core/orchestrator.ts`](../../../src/core/orchestrator.ts)

```typescript
import { spawnAgent, resumeAgent } from './agent.js';

// First run — spawn new agent
if (!agentState.sessionId) {
  const response = await spawnAgent(input, {
    model: layerConfig.model,
    maxBudgetUsd: layerConfig.maxBudgetUsd,
    systemPrompt: layerPrompt,
    maxTurns: layerConfig.maxTurns,
  });
  agentState.sessionId = response.sessionId; // Save for resume
  agentState.totalCost += response.costUsd;
  return response.content;
}

// Resume existing session
const response = await resumeAgent(agentState.sessionId, input, {
  maxTurns: layerConfig.maxTurns,
});
agentState.totalCost += response.costUsd;
return response.content;
```

### Action Executor Integration

The action executor uses session state to manage agent resumption:

**Source:** [`src/core/action-executor.ts`](../../../src/core/action-executor.ts)

```typescript
import { resumeAgent } from './agent.js';

// Resume agent after action execution
const result = await resumeAgent(
  agentState.sessionId,
  `Action result: ${actionResult}`,
  { maxTurns: 5 },
);

return result.content;
```

### Testing Integration

Mock the agent API in tests to avoid real API calls:

```typescript
import { test, mock } from 'node:test';
import * as agent from './core/agent.js';

test('orchestrator spawns agents', async () => {
  const mockSpawn = mock.fn(agent, 'spawnAgent', async () => ({
    content: 'Test response',
    sessionId: 'test-session-123',
    costUsd: 0.01,
    durationMs: 100,
  }));

  // Test code here...

  assert.strictEqual(mockSpawn.mock.calls.length, 1);
});
```

---

## Best Practices

### 1. Save Session IDs for Resumption

Always save the session ID if you plan to resume:

```typescript
const spawn = await spawnAgent('Initial task', opts);
const sessionId = spawn.sessionId; // SAVE THIS!

// Later...
const resume = await resumeAgent(sessionId, 'Follow-up task', opts);
```

### 2. Set Appropriate Timeouts

- **Quick tasks (haiku):** 60-120s
- **Medium tasks (sonnet):** 300-600s (5-10 min)
- **Complex tasks (opus):** 600-1800s (10-30 min)

```typescript
await spawnAgent('Quick task', {
  model: 'haiku',
  maxBudgetUsd: 0.5,
  systemPrompt: '',
  timeoutMs: 120_000, // 2 minutes
});
```

### 3. Set Realistic Max Turns

- **Haiku:** 5-10 turns (fast, focused tasks)
- **Sonnet:** 10-20 turns (moderate complexity)
- **Opus:** 20-50 turns (complex, multi-step tasks)

```typescript
await spawnAgent('Complex analysis', {
  model: 'opus',
  maxBudgetUsd: 5.0,
  systemPrompt: '',
  maxTurns: 30, // Plenty of room
});
```

### 4. Track Costs

Accumulate costs across multiple operations:

```typescript
let totalCost = 0;

const spawn = await spawnAgent('Task 1', opts);
totalCost += spawn.costUsd;

const resume = await resumeAgent(spawn.sessionId, 'Task 2', opts);
totalCost += resume.costUsd;

console.log('Total cost:', totalCost);
```

### 5. Handle Errors Gracefully

Don't assume success — always wrap in try/catch:

```typescript
try {
  const response = await spawnAgent('Task', opts);
  return response;
} catch (err) {
  logger.error('Agent failed', { error: err.message });
  // Fallback logic here
}
```

### 6. Use Circuit Breaker Awareness

If you're spawning many agents, be aware of the shared circuit breaker:

```typescript
// After 5 failures, circuit opens
for (let i = 0; i < 10; i++) {
  try {
    await spawnAgent(`Task ${i}`, opts);
  } catch (err) {
    if (err.message.includes('Circuit breaker')) {
      console.log('Circuit open — waiting 60s');
      await new Promise(resolve => setTimeout(resolve, 60_000));
    }
  }
}
```

---

## See Also

- [Action Parser Validation](./action-parser.md) — Extracting actions from agent responses
- [Error Boundaries](../core/error-boundaries.md) — Retry logic and circuit breaking
- [Orchestrator](../core/orchestrator.md) — Hierarchical agent cascade
- [Types](../../lib/types.md) — Zod schemas for all interfaces

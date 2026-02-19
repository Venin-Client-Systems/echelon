# Error Boundaries and Circuit Breaker Infrastructure

The error handling infrastructure (`src/core/error-boundaries.ts`) provides foundational validation for all agent operations through error classification, exponential backoff, and circuit breaker patterns.

---

## Table of Contents

- [Overview](#overview)
- [Core Components](#core-components)
  - [AgentErrorClassifier](#agenterrorclassifier)
  - [ExponentialBackoff](#exponentialbackoff)
  - [CircuitBreaker](#circuitbreaker)
  - [withErrorBoundary()](#witherrorboundary)
- [Error Classification](#error-classification)
- [Retry Strategies](#retry-strategies)
- [Circuit Breaker State Machine](#circuit-breaker-state-machine)
- [Examples](#examples)
- [Integration](#integration)

---

## Overview

The error boundaries infrastructure wraps all agent spawn/resume operations with robust error handling:

- **Error classification** — Categorizes errors by type with recovery hints
- **Exponential backoff** — Progressive retry delays with jitter to prevent thundering herd
- **Circuit breaker** — Fails fast after threshold to prevent cascading failures
- **Observability** — Structured logging with labels and recovery hints

**File:** [`src/core/error-boundaries.ts`](../../../src/core/error-boundaries.ts)

**Usage in agent operations:**
```typescript
// Both spawnAgent and resumeAgent wrap operations with error boundaries
const response = await withErrorBoundary(
  async () => { /* agent operation */ },
  'spawnAgent(sonnet)',           // Label for logging
  { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 32000 },
  agentCircuitBreaker,            // Shared circuit breaker
);
```

**Source:** [`src/core/agent.ts:148-190`](../../../src/core/agent.ts#L148-L190) (spawnAgent), [`src/core/agent.ts:199-240`](../../../src/core/agent.ts#L199-L240) (resumeAgent)

---

## Core Components

### AgentErrorClassifier

Classifies errors to determine retry strategy and recovery hints.

**Source:** [`src/core/error-boundaries.ts:26-102`](../../../src/core/error-boundaries.ts#L26-L102)

#### Type Definitions

```typescript
type AgentErrorType =
  | 'rate_limit'      // API rate limit (HTTP 429)
  | 'quota_exceeded'  // API quota exceeded (HTTP 403)
  | 'timeout'         // Operation timeout
  | 'crash'           // Agent process crash
  | 'network'         // Network connectivity issue
  | 'unknown';        // Unknown error type

interface ClassifiedError {
  type: AgentErrorType;
  message: string;
  retryable: boolean;
  recoveryHint: string;
  originalError: Error;
}
```

#### Classification Logic

**Method:**
```typescript
static classify(error: Error): ClassifiedError
```

**Algorithm:**
1. Convert error message to lowercase for case-insensitive matching
2. Check for error type signatures in order of specificity
3. Return first match with appropriate recovery hint
4. Default to `'unknown'` type with retryable=true

**Detection Patterns:**

| Error Type | Detection Patterns | Retryable | Recovery Hint |
|-----------|-------------------|-----------|---------------|
| `rate_limit` | `'429'`, `'rate limit'`, `'too many requests'` | ✅ | "API rate limit reached. Waiting before retry. Consider reducing maxTurns or spacing out requests." |
| `quota_exceeded` | `'403'`, `'quota'`, `'insufficient_quota'` | ❌ | "API quota exceeded. Check your API key limits at console.anthropic.com/settings/limits" |
| `timeout` | `'timeout'`, `'timed out'`, `'504'` | ✅ | "Agent operation timed out. Increase timeoutMs in layer config or reduce task complexity." |
| `crash` | `'exited'`, `'crashed'`, `'killed'`, `'signal'` | ✅ | "Agent process crashed unexpectedly. This may indicate a bug or resource constraint." |
| `network` | `'econnrefused'`, `'enotfound'`, `'econnreset'`, `'enetunreach'`, `'network unreachable'`, `'connection refused'`, `'connection reset'` | ✅ | "Network connectivity issue. Check internet connection and API endpoint availability." |
| `unknown` | Fallback (no match) | ✅ | "Unexpected error occurred. Check logs for details." |

**Example:**
```typescript
import { AgentErrorClassifier } from './core/error-boundaries.js';

try {
  await someOperation();
} catch (err) {
  const classified = AgentErrorClassifier.classify(err);

  console.log('Error type:', classified.type);
  console.log('Retryable:', classified.retryable);
  console.log('Recovery hint:', classified.recoveryHint);

  // Example output:
  // Error type: rate_limit
  // Retryable: true
  // Recovery hint: API rate limit reached. Waiting before retry...
}
```

---

### ExponentialBackoff

Implements exponential backoff with jitter for retry delays.

**Source:** [`src/core/error-boundaries.ts:107-148`](../../../src/core/error-boundaries.ts#L107-L148)

#### Configuration

```typescript
class ExponentialBackoff {
  constructor(
    private readonly maxRetries: number = 3,
    private readonly baseDelayMs: number = 1000,
    private readonly maxDelayMs: number = 32000,
  )
}
```

**Default values:**
- `maxRetries`: 3 attempts
- `baseDelayMs`: 1000ms (1 second)
- `maxDelayMs`: 32000ms (32 seconds)

#### Delay Calculation

**Formula:**
```
delay = min(baseDelay × 2^attempt, maxDelay) + jitter

where:
  attempt = current attempt number (0-indexed)
  jitter = delay × 0.25 × random(0, 1)
```

**Delay Progression:**

| Attempt | Formula | Base Delay | With 25% Jitter |
|---------|---------|-----------|-----------------|
| 0 | `1000 × 2^0` | 1000ms | 1000-1250ms |
| 1 | `1000 × 2^1` | 2000ms | 2000-2500ms |
| 2 | `1000 × 2^2` | 4000ms | 4000-5000ms |
| 3 | `1000 × 2^3` | 8000ms | 8000-10000ms |
| 4 | `1000 × 2^4` | 16000ms | 16000-20000ms |
| 5+ | `min(1000 × 2^n, 32000)` | 32000ms (capped) | 32000-40000ms |

**Why jitter?**
- Prevents "thundering herd" — multiple retries hitting the server simultaneously
- Spreads out retry attempts across time
- Reduces load spikes on recovery

#### Methods

**getNextDelay()**
```typescript
getNextDelay(): number | null
```

Returns the next delay in milliseconds, or `null` if max retries exceeded.

**Example:**
```typescript
const backoff = new ExponentialBackoff(3, 1000, 32000);

console.log(backoff.getNextDelay()); // 1000-1250ms (attempt 0)
console.log(backoff.getNextDelay()); // 2000-2500ms (attempt 1)
console.log(backoff.getNextDelay()); // 4000-5000ms (attempt 2)
console.log(backoff.getNextDelay()); // null (max retries reached)
```

**reset()**
```typescript
reset(): void
```

Resets attempt counter to 0. Call after successful operation.

**attemptsRemaining**
```typescript
get attemptsRemaining(): number
```

Returns number of retry attempts remaining.

**currentAttempt**
```typescript
get currentAttempt(): number
```

Returns current attempt number (0-indexed).

**Example:**
```typescript
const backoff = new ExponentialBackoff(3, 1000, 32000);

console.log(backoff.currentAttempt);    // 0
console.log(backoff.attemptsRemaining); // 3

backoff.getNextDelay();

console.log(backoff.currentAttempt);    // 1
console.log(backoff.attemptsRemaining); // 2
```

---

### CircuitBreaker

Prevents cascading failures by failing fast after threshold.

**Source:** [`src/core/error-boundaries.ts:154-234`](../../../src/core/error-boundaries.ts#L154-L234)

#### Configuration

```typescript
class CircuitBreaker {
  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60000,
  )
}
```

**Default values:**
- `threshold`: 5 consecutive failures
- `resetTimeMs`: 60000ms (60 seconds)

**Shared instance:**
```typescript
// src/core/agent.ts:17
const agentCircuitBreaker = new CircuitBreaker(5, 60000);
```

This instance is **shared across ALL agent operations** (spawn + resume) to prevent cascading failures system-wide.

#### State Machine

```
┌─────────┐
│ CLOSED  │  ← Normal operation
│         │    Tracks failures
└────┬────┘
     │
     │ ≥ threshold failures
     ↓
┌─────────┐
│  OPEN   │  ← Failing fast
│         │    No calls go through
└────┬────┘
     │
     │ After resetTimeMs
     ↓
┌─────────┐
│HALF_OPEN│  ← Testing recovery
│         │    First call attempts
└────┬────┘
     │
     ├── Success → CLOSED
     └── Failure → OPEN
```

#### States

**CLOSED (Normal)**
- All operations proceed normally
- Failures are counted
- Transitions to OPEN after `threshold` consecutive failures

**OPEN (Failing Fast)**
- All operations fail immediately without execution
- Prevents cascading failures
- Automatically transitions to HALF_OPEN after `resetTimeMs`

**HALF_OPEN (Testing)**
- First operation is allowed through as a "probe"
- Success → transitions to CLOSED, resets failure count
- Failure → transitions back to OPEN, starts new reset timer

#### Methods

**isOpen()**
```typescript
isOpen(): boolean
```

Returns `true` if circuit is open (failing fast). Automatically transitions from OPEN → HALF_OPEN after reset time.

**Example:**
```typescript
const breaker = new CircuitBreaker(5, 60000);

if (breaker.isOpen()) {
  throw new Error('Circuit breaker open — failing fast');
}

// Proceed with operation...
```

**recordSuccess()**
```typescript
recordSuccess(): void
```

Records a successful operation. Resets failure count and transitions HALF_OPEN → CLOSED.

**recordFailure()**
```typescript
recordFailure(): void
```

Records a failed operation. Increments failure count and opens circuit if threshold reached.

**Behavior by state:**
- CLOSED: Increments count, opens if `failureCount >= threshold`
- HALF_OPEN: Immediately re-opens (probe failed)
- OPEN: No effect (already open)

**getState()**
```typescript
getState(): {
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  threshold: number;
}
```

Returns current circuit state for observability.

**reset()**
```typescript
reset(): void
```

Force reset to CLOSED state with zero failures. Use for testing or manual intervention.

#### Example Usage

```typescript
import { CircuitBreaker } from './core/error-boundaries.js';

const breaker = new CircuitBreaker(3, 30000); // 3 failures, 30s reset

async function callAPI() {
  if (breaker.isOpen()) {
    throw new Error('Circuit breaker open — failing fast');
  }

  try {
    const result = await fetch('/api/endpoint');
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure();
    throw err;
  }
}

// Usage
for (let i = 0; i < 10; i++) {
  try {
    await callAPI();
  } catch (err) {
    console.error(`Attempt ${i} failed:`, err.message);
  }
}

// After 3 failures:
// Attempt 3 failed: Circuit breaker open — failing fast
// Attempt 4 failed: Circuit breaker open — failing fast
// ...
// (After 30s, circuit transitions to half_open and retries)
```

---

### withErrorBoundary()

Enhanced retry wrapper with error classification, exponential backoff, and circuit breaker.

**Source:** [`src/core/error-boundaries.ts:253-336`](../../../src/core/error-boundaries.ts#L253-L336)

#### Signature

```typescript
async function withErrorBoundary<T>(
  fn: () => Promise<T>,
  label: string,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {},
  circuitBreaker?: CircuitBreaker,
): Promise<T>
```

**Parameters:**
- `fn` — The async function to execute
- `label` — Human-readable label for logging (e.g., `"spawnAgent(sonnet)"`)
- `options` — Retry configuration (all optional)
  - `maxRetries` (default: 3)
  - `baseDelayMs` (default: 1000)
  - `maxDelayMs` (default: 32000)
- `circuitBreaker` — Optional circuit breaker instance

**Returns:**
The result of `fn()` if successful

**Throws:**
The last error if all retries exhausted or circuit is open

#### Execution Flow

```
START
  ↓
┌─────────────────────┐
│ Check circuit       │
│ breaker.isOpen()?   │
└──────┬──────────────┘
       │
       ├── Yes → Throw circuit open error
       ↓
       No
       ↓
┌─────────────────────┐
│ Execute fn()        │
└──────┬──────────────┘
       │
       ├── Success → recordSuccess(), return result
       ↓
       Failure
       ↓
┌─────────────────────┐
│ Classify error      │
│ (AgentErrorClassifier)│
└──────┬──────────────┘
       │
       ├── Non-retryable → recordFailure(), throw
       ↓
       Retryable
       ↓
┌─────────────────────┐
│ Get next delay      │
│ (ExponentialBackoff)│
└──────┬──────────────┘
       │
       ├── null (max retries) → recordFailure(), throw
       ↓
       delay value
       ↓
┌─────────────────────┐
│ Sleep(delay)        │
└──────┬──────────────┘
       │
       └─→ Loop back to circuit breaker check
```

#### Logging

**Successful operation:**
```
(No logs — silent on success)
```

**Failed operation (retrying):**
```
[WARN] spawnAgent(sonnet): operation failed {
  errorType: 'rate_limit',
  retryable: true,
  attempt: 1,
  attemptsRemaining: 2,
  message: 'HTTP 429: Too Many Requests',
  recoveryHint: 'API rate limit reached. Waiting before retry...'
}

[INFO] spawnAgent(sonnet): retrying after 1.2s {
  errorType: 'rate_limit',
  attempt: 2,
  maxRetries: 3,
  recoveryHint: 'API rate limit reached. Waiting before retry...'
}
```

**Max retries exhausted:**
```
[ERROR] spawnAgent(sonnet): max retries exhausted {
  errorType: 'network',
  attempts: 3,
  recoveryHint: 'Network connectivity issue. Check internet connection...'
}
```

**Circuit breaker open:**
```
[ERROR] spawnAgent(sonnet): circuit breaker open, failing fast {
  state: { state: 'open', failureCount: 5, threshold: 5 }
}
```

#### Example

```typescript
import { withErrorBoundary, CircuitBreaker } from './core/error-boundaries.js';

const breaker = new CircuitBreaker(5, 60000);

async function unreliableOperation() {
  // Simulates API call that may fail
  if (Math.random() < 0.5) {
    throw new Error('HTTP 429: Too Many Requests');
  }
  return 'Success!';
}

const result = await withErrorBoundary(
  unreliableOperation,
  'unreliableOperation',
  {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 32000,
  },
  breaker,
);

console.log(result); // 'Success!' (after retries if needed)
```

---

## Error Classification

### Classification Matrix

| Error Type | HTTP Codes | Keywords | Retryable | Recovery Action |
|-----------|-----------|----------|-----------|----------------|
| **rate_limit** | 429 | `rate limit`, `too many requests` | ✅ | Wait with backoff, reduce request rate |
| **quota_exceeded** | 403 | `quota`, `insufficient_quota` | ❌ | Check API limits, upgrade plan |
| **timeout** | 504 | `timeout`, `timed out` | ✅ | Increase timeout, reduce complexity |
| **crash** | — | `exited`, `crashed`, `killed`, `signal` | ✅ | Investigate logs, check resources |
| **network** | — | `econnrefused`, `enotfound`, `econnreset`, `network` | ✅ | Check connectivity, retry |
| **unknown** | — | (no match) | ✅ | Review logs, investigate |

### Examples by Error Type

#### 1. Rate Limit Error

**Trigger:**
```typescript
const err = new Error('HTTP 429: Too Many Requests');
```

**Classification:**
```typescript
const classified = AgentErrorClassifier.classify(err);
// {
//   type: 'rate_limit',
//   message: 'HTTP 429: Too Many Requests',
//   retryable: true,
//   recoveryHint: 'API rate limit reached. Waiting before retry. Consider reducing maxTurns or spacing out requests.',
//   originalError: err
// }
```

**Behavior:**
- ✅ Retryable
- Waits with exponential backoff: 1s → 2s → 4s
- After 3 retries, throws original error

---

#### 2. Quota Exceeded Error

**Trigger:**
```typescript
const err = new Error('HTTP 403: insufficient_quota');
```

**Classification:**
```typescript
const classified = AgentErrorClassifier.classify(err);
// {
//   type: 'quota_exceeded',
//   message: 'HTTP 403: insufficient_quota',
//   retryable: false,
//   recoveryHint: 'API quota exceeded. Check your API key limits at console.anthropic.com/settings/limits',
//   originalError: err
// }
```

**Behavior:**
- ❌ Not retryable
- Records failure in circuit breaker
- Throws immediately (no retries)

---

#### 3. Timeout Error

**Trigger:**
```typescript
const err = new Error('Claude timed out after 600000ms');
```

**Classification:**
```typescript
const classified = AgentErrorClassifier.classify(err);
// {
//   type: 'timeout',
//   message: 'Claude timed out after 600000ms',
//   retryable: true,
//   recoveryHint: 'Agent operation timed out. Increase timeoutMs in layer config or reduce task complexity.',
//   originalError: err
// }
```

**Behavior:**
- ✅ Retryable
- Retries up to 3 times
- Consider increasing `timeoutMs` if retries also timeout

---

#### 4. Process Crash Error

**Trigger:**
```typescript
const err = new Error('Claude process exited with signal SIGKILL');
```

**Classification:**
```typescript
const classified = AgentErrorClassifier.classify(err);
// {
//   type: 'crash',
//   message: 'Claude process exited with signal SIGKILL',
//   retryable: true,
//   recoveryHint: 'Agent process crashed unexpectedly. This may indicate a bug or resource constraint.',
//   originalError: err
// }
```

**Behavior:**
- ✅ Retryable
- May indicate memory/CPU constraint
- Check system resources if recurring

---

#### 5. Network Error

**Trigger:**
```typescript
const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
```

**Classification:**
```typescript
const classified = AgentErrorClassifier.classify(err);
// {
//   type: 'network',
//   message: 'connect ECONNREFUSED 127.0.0.1:443',
//   retryable: true,
//   recoveryHint: 'Network connectivity issue. Check internet connection and API endpoint availability.',
//   originalError: err
// }
```

**Behavior:**
- ✅ Retryable
- Waits with backoff to allow network recovery
- Check internet connection if persistent

---

#### 6. Unknown Error

**Trigger:**
```typescript
const err = new Error('Something went wrong');
```

**Classification:**
```typescript
const classified = AgentErrorClassifier.classify(err);
// {
//   type: 'unknown',
//   message: 'Something went wrong',
//   retryable: true,
//   recoveryHint: 'Unexpected error occurred. Check logs for details.',
//   originalError: err
// }
```

**Behavior:**
- ✅ Retryable (default to safe behavior)
- Retries up to 3 times
- Investigate logs for root cause

---

## Retry Strategies

### Default Strategy

**Configuration:**
```typescript
{
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 32000
}
```

**Timeline:**
```
Attempt 1: Execute immediately
  ↓ Failure
  Wait 1000-1250ms
  ↓
Attempt 2: Retry
  ↓ Failure
  Wait 2000-2500ms
  ↓
Attempt 3: Retry
  ↓ Failure
  Wait 4000-5000ms
  ↓
Attempt 4: Final retry
  ↓ Failure
  ↓
Throw error
```

**Total time (worst case):** ~8-10 seconds

---

### Custom Strategy (Aggressive)

**Configuration:**
```typescript
{
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 16000
}
```

**Timeline:**
```
Attempt 1: 0ms
Attempt 2: 500-625ms delay
Attempt 3: 1000-1250ms delay
Attempt 4: 2000-2500ms delay
Attempt 5: 4000-5000ms delay
Attempt 6: 8000-10000ms delay
```

**Total time (worst case):** ~16-20 seconds

**Use case:** Quick operations where fast feedback is critical

---

### Custom Strategy (Conservative)

**Configuration:**
```typescript
{
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 64000
}
```

**Timeline:**
```
Attempt 1: 0ms
Attempt 2: 2000-2500ms delay
Attempt 3: 4000-5000ms delay
```

**Total time (worst case):** ~6-8 seconds

**Use case:** Operations with high cost where retries should be minimal

---

## Circuit Breaker State Machine

### Visual Diagram

```
                ┌─────────────┐
                │   CLOSED    │
                │             │
                │ • Normal    │
                │ • Track     │
                │   failures  │
                └──────┬──────┘
                       │
              failures < threshold
                       │
                ┌──────┴───────┐
                │              │
                │    Success   │
                └──────┬───────┘
                       │
                       └──────┐
                              │
                    failures ≥ threshold
                              ↓
                       ┌──────────────┐
                       │     OPEN     │
                       │              │
                       │ • Fail fast  │
                       │ • No calls   │
                       │   through    │
                       └──────┬───────┘
                              │
                    After resetTimeMs
                              ↓
                       ┌──────────────┐
                       │  HALF_OPEN   │
                       │              │
                       │ • First call │
                       │   attempts   │
                       └──┬────────┬──┘
                          │        │
                    Success│        │Failure
                          │        │
                          ↓        ↓
                      CLOSED      OPEN
```

### State Transition Examples

#### Scenario 1: Gradual Recovery

```
t=0s:  CLOSED (failures=0)
       Operation 1 → Fail (failures=1)
       Operation 2 → Fail (failures=2)
       Operation 3 → Fail (failures=3)
       Operation 4 → Fail (failures=4)
       Operation 5 → Fail (failures=5) → OPEN

t=10s: OPEN (failing fast)
       Operation 6 → Rejected immediately
       Operation 7 → Rejected immediately

t=60s: OPEN → HALF_OPEN (auto-transition)
       Operation 8 → Attempt (first probe)

t=61s: Success → HALF_OPEN → CLOSED (failures=0)
       Operation 9 → Proceed normally
```

---

#### Scenario 2: Persistent Failure

```
t=0s:  CLOSED (failures=0)
       Operation 1 → Fail (failures=1)
       ...
       Operation 5 → Fail (failures=5) → OPEN

t=60s: OPEN → HALF_OPEN
       Operation 6 → Fail (probe failed) → OPEN

t=120s: OPEN → HALF_OPEN
        Operation 7 → Fail (probe failed) → OPEN

t=180s: OPEN → HALF_OPEN
        Operation 8 → Success → CLOSED
```

---

#### Scenario 3: Manual Reset

```
t=0s:  CLOSED (failures=0)
       Operation 1 → Fail (failures=1)
       ...
       Operation 5 → Fail (failures=5) → OPEN

t=10s: OPEN (failing fast)
       Admin calls: breaker.reset()
       State: CLOSED (failures=0)

       Operation 6 → Proceed normally
```

---

### Configuration Trade-offs

| Threshold | Reset Time | Behavior | Use Case |
|-----------|-----------|----------|----------|
| Low (3) | Short (30s) | Aggressive | Protect against rapid failures |
| High (10) | Long (120s) | Conservative | Tolerate transient issues |
| Medium (5) | Medium (60s) | **Default** | Balanced protection |

**Current configuration:**
```typescript
// src/core/agent.ts:17
const agentCircuitBreaker = new CircuitBreaker(5, 60000);
```

- **5 failures** → Opens circuit
- **60 seconds** → Reset time before half-open probe

This provides balanced protection for agent operations.

---

## Examples

### Example 1: Basic Error Boundary Usage

```typescript
import { withErrorBoundary } from './core/error-boundaries.js';

async function fetchData() {
  const response = await fetch('https://api.example.com/data');
  return response.json();
}

// Wrap with error boundary
const data = await withErrorBoundary(
  fetchData,
  'fetchData',
  { maxRetries: 3, baseDelayMs: 1000 },
);

console.log(data);
```

**Logs on transient failure:**
```
[WARN] fetchData: operation failed {
  errorType: 'network',
  retryable: true,
  attempt: 1,
  attemptsRemaining: 2,
  message: 'connect ECONNREFUSED',
  recoveryHint: 'Network connectivity issue. Check internet connection...'
}

[INFO] fetchData: retrying after 1.1s { errorType: 'network', attempt: 2, maxRetries: 3 }

(Success on retry)
```

---

### Example 2: Circuit Breaker with Multiple Operations

```typescript
import { withErrorBoundary, CircuitBreaker } from './core/error-boundaries.js';

const breaker = new CircuitBreaker(3, 30000); // 3 failures, 30s reset

async function callAPI(endpoint: string) {
  return withErrorBoundary(
    async () => {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    `callAPI(${endpoint})`,
    { maxRetries: 2 },
    breaker,
  );
}

// Simulate multiple calls
for (let i = 0; i < 10; i++) {
  try {
    const result = await callAPI('/api/endpoint');
    console.log(`Call ${i}: Success`);
  } catch (err) {
    console.error(`Call ${i}: Failed - ${err.message}`);
  }
}

// Output:
// Call 0: Failed - HTTP 500
// Call 1: Failed - HTTP 500
// Call 2: Failed - HTTP 500
// Call 3: Failed - Circuit breaker open after 3 consecutive failures
// Call 4: Failed - Circuit breaker open after 3 consecutive failures
// ...
```

---

### Example 3: Custom Error Classification

```typescript
import { AgentErrorClassifier } from './core/error-boundaries.js';

// Test different error types
const errors = [
  new Error('HTTP 429: Too Many Requests'),
  new Error('HTTP 403: quota exceeded'),
  new Error('Operation timed out after 30s'),
  new Error('Process exited with code 137'),
  new Error('connect ENOTFOUND api.example.com'),
  new Error('Unknown database error'),
];

for (const err of errors) {
  const classified = AgentErrorClassifier.classify(err);
  console.log(`
Type: ${classified.type}
Retryable: ${classified.retryable}
Hint: ${classified.recoveryHint}
---`);
}

// Output:
// Type: rate_limit
// Retryable: true
// Hint: API rate limit reached. Waiting before retry...
// ---
// Type: quota_exceeded
// Retryable: false
// Hint: API quota exceeded. Check your API key limits...
// ---
// (etc.)
```

---

### Example 4: Manual Backoff Control

```typescript
import { ExponentialBackoff } from './core/error-boundaries.js';

const backoff = new ExponentialBackoff(5, 500, 16000);

while (true) {
  try {
    await riskyOperation();
    backoff.reset(); // Success — reset for next time
    break;
  } catch (err) {
    const delay = backoff.getNextDelay();

    if (delay === null) {
      console.error('Max retries exhausted');
      throw err;
    }

    console.log(`Retry in ${delay}ms (attempt ${backoff.currentAttempt}/${backoff.currentAttempt + backoff.attemptsRemaining})`);
    await sleep(delay);
  }
}
```

---

## Integration

### Agent Operations

Both `spawnAgent()` and `resumeAgent()` wrap their core logic with `withErrorBoundary()`:

**Source:** [`src/core/agent.ts`](../../../src/core/agent.ts)

```typescript
// spawnAgent (lines 148-190)
export async function spawnAgent(prompt: string, opts: SpawnOptions) {
  return withErrorBoundary(
    async () => {
      // ... spawn logic ...
    },
    `spawnAgent(${opts.model})`,
    { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 32000 },
    agentCircuitBreaker,
  );
}

// resumeAgent (lines 199-240)
export async function resumeAgent(sessionId: string, prompt: string, opts: {...}) {
  return withErrorBoundary(
    async () => {
      // ... resume logic ...
    },
    `resumeAgent(${sessionId.slice(0, 8)})`,
    { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 32000 },
    agentCircuitBreaker,
  );
}
```

**Shared circuit breaker:**
```typescript
// src/core/agent.ts:17
const agentCircuitBreaker = new CircuitBreaker(5, 60000);
```

This ensures that if **any** agent operation fails 5 times in 60 seconds, **all** agent operations fail fast until recovery.

---

### Orchestrator Integration

The orchestrator benefits from error boundaries transparently:

**Source:** [`src/core/orchestrator.ts`](../../../src/core/orchestrator.ts)

```typescript
import { spawnAgent, resumeAgent } from './agent.js';

// Orchestrator doesn't need to implement retry logic
// Error boundaries handle it automatically
const response = agentState.sessionId
  ? await resumeAgent(agentState.sessionId, input, { maxTurns })
  : await spawnAgent(input, { model, maxBudgetUsd, systemPrompt, maxTurns });

// If circuit breaker trips, orchestrator catches and logs
try {
  const response = await spawnAgent(...);
} catch (err) {
  if (err.message.includes('Circuit breaker')) {
    logger.error('Agent circuit breaker tripped — system overload');
    // Graceful degradation...
  }
}
```

---

### Testing

Mock error boundaries for deterministic tests:

```typescript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as errorBoundaries from './core/error-boundaries.js';

describe('Error handling', () => {
  it('retries on transient errors', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('Transient failure');
      return 'Success';
    };

    const result = await errorBoundaries.withErrorBoundary(
      fn,
      'test',
      { maxRetries: 3, baseDelayMs: 10 },
    );

    assert.equal(result, 'Success');
    assert.equal(attempts, 3);
  });
});
```

---

## Best Practices

### 1. Use Descriptive Labels

Labels appear in logs — make them actionable:

**Good:**
```typescript
withErrorBoundary(fn, 'spawnAgent(2ic, sonnet)', opts);
withErrorBoundary(fn, 'resumeAgent(team-lead, session-abc)', opts);
```

**Bad:**
```typescript
withErrorBoundary(fn, 'operation', opts); // Too vague
```

---

### 2. Set Appropriate Max Retries

- **Quick operations:** 2-3 retries
- **Long operations:** 1-2 retries (each retry is expensive)
- **Critical operations:** 3-5 retries

```typescript
// Quick API call
withErrorBoundary(fn, 'fetchConfig', { maxRetries: 3 });

// Expensive agent spawn
withErrorBoundary(fn, 'spawnAgent(opus)', { maxRetries: 2 });
```

---

### 3. Share Circuit Breakers by Domain

Don't create per-operation circuit breakers — share them across related operations:

**Good:**
```typescript
const agentBreaker = new CircuitBreaker(5, 60000);

spawnAgent(..., agentBreaker);
resumeAgent(..., agentBreaker);
```

**Bad:**
```typescript
const breaker1 = new CircuitBreaker(5, 60000);
const breaker2 = new CircuitBreaker(5, 60000);

spawnAgent(..., breaker1); // Isolated protection
resumeAgent(..., breaker2);
```

---

### 4. Log Recovery Hints

Always log `recoveryHint` for actionable debugging:

```typescript
try {
  await withErrorBoundary(fn, 'operation', opts);
} catch (err) {
  const classified = AgentErrorClassifier.classify(err);
  logger.error('Operation failed', {
    type: classified.type,
    hint: classified.recoveryHint,
  });
}
```

---

### 5. Monitor Circuit Breaker State

Expose circuit breaker state in health checks:

```typescript
app.get('/health', (req, res) => {
  const cbState = agentCircuitBreaker.getState();
  res.json({
    status: cbState.state === 'closed' ? 'healthy' : 'degraded',
    circuitBreaker: cbState,
  });
});
```

---

## See Also

- [Agent API Reference](./agent-api.md) — Agent spawn/resume operations
- [Action Parser Validation](./action-parser.md) — Action extraction and validation
- [Orchestrator](../core/orchestrator.md) — Hierarchical agent cascade
- [Types](../../lib/types.md) — Zod schemas

---

## Summary

The error boundaries infrastructure provides **robust, production-ready error handling** for agent operations:

✅ **Automatic classification** — Categorizes errors with recovery hints
✅ **Exponential backoff** — Progressive delays with jitter prevent thundering herd
✅ **Circuit breaking** — Shared protection prevents cascading failures
✅ **Observability** — Structured logging with labels and hints
✅ **Type-safe** — Full TypeScript support with generic error boundary

**Key principles:**
- Fail fast after threshold (circuit breaker)
- Retry with backoff (exponential backoff)
- Log actionable recovery hints (error classifier)
- Share circuit breakers across related operations

For implementation details, see [`src/core/error-boundaries.ts`](../../../src/core/error-boundaries.ts).

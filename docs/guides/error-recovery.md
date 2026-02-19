# Error Scenario Recovery Patterns

Comprehensive guide to common error scenarios when working with agents and their recovery strategies.

---

## Table of Contents

- [Overview](#overview)
- [Error Scenarios](#error-scenarios)
  - [1. Rate Limit (HTTP 429)](#1-rate-limit-http-429)
  - [2. Quota Exhausted (HTTP 403)](#2-quota-exhausted-http-403)
  - [3. Timeout](#3-timeout)
  - [4. Network Error](#4-network-error)
  - [5. Process Crash](#5-process-crash)
  - [6. Circuit Breaker Trip](#6-circuit-breaker-trip)
  - [7. Unknown Error](#7-unknown-error)
- [Recovery Strategy Priorities](#recovery-strategy-priorities)
- [Related Documentation](#related-documentation)

---

## Overview

Echelon's error handling infrastructure automatically classifies errors and applies appropriate recovery strategies. This guide documents each error scenario, how it's detected, and what recovery actions are taken.

**Core principle:** Retryable errors are handled automatically with exponential backoff. Non-retryable errors fail fast with actionable recovery hints.

**Source:** [`src/core/error-boundaries.ts`](../../src/core/error-boundaries.ts)

**Agent integration:** All agent spawn/resume operations are wrapped with error boundaries:
- [`src/core/agent.ts:148-190`](../../src/core/agent.ts#L148-L190) (spawnAgent)
- [`src/core/agent.ts:199-240`](../../src/core/agent.ts#L199-L240) (resumeAgent)

---

## Error Scenarios

### 1. Rate Limit (HTTP 429)

**Classification:** `rate_limit`

#### Detection

The error classifier detects rate limit errors by matching any of these patterns in the error message (case-insensitive):
- `'429'` (HTTP status code)
- `'rate limit'`
- `'too many requests'`

**Source:** [`src/core/error-boundaries.ts:31-38`](../../src/core/error-boundaries.ts#L31-L38)

#### Error Response

```typescript
{
  type: 'rate_limit',
  message: 'HTTP 429: Too Many Requests',
  retryable: true,
  recoveryHint: 'API rate limit reached. Waiting before retry. Consider reducing maxTurns or spacing out requests.',
  originalError: Error
}
```

#### Recovery Strategy

**Automatic:**
- ✅ Retryable
- Exponential backoff with jitter (default: 3 retries)
- Retry timeline:
  1. Initial attempt
  2. Wait 1000-1250ms → Retry
  3. Wait 2000-2500ms → Retry
  4. Wait 4000-5000ms → Final retry
  5. If all retries fail → Throw error

**Manual intervention (if automatic retry fails):**
1. Reduce `maxTurns` in layer config to decrease request frequency
2. Add delays between agent spawns
3. Check API rate limits at [console.anthropic.com/settings/limits](https://console.anthropic.com/settings/limits)
4. Consider upgrading API plan for higher rate limits

#### Example Logs

```
[WARN] spawnAgent(sonnet): operation failed {
  errorType: 'rate_limit',
  retryable: true,
  attempt: 1,
  attemptsRemaining: 2,
  message: 'HTTP 429: Too Many Requests',
  recoveryHint: 'API rate limit reached. Waiting before retry. Consider reducing maxTurns or spacing out requests.'
}

[INFO] spawnAgent(sonnet): retrying after 1.2s {
  errorType: 'rate_limit',
  attempt: 2,
  maxRetries: 3,
  recoveryHint: 'API rate limit reached. Waiting before retry. Consider reducing maxTurns or spacing out requests.'
}
```

#### Code Example

```typescript
import { spawnAgent } from './core/agent.js';

try {
  // Rate limit is handled automatically by withErrorBoundary wrapper
  const response = await spawnAgent(
    'Analyze this codebase',
    {
      model: 'sonnet',
      maxBudgetUsd: 1.0,
      systemPrompt: '...',
      maxTurns: 8,  // Reduce if rate limits persist
    }
  );
} catch (err) {
  // Only thrown if all retries fail
  console.error('Agent spawn failed after retries:', err.message);
}
```

---

### 2. Quota Exhausted (HTTP 403)

**Classification:** `quota_exceeded`

#### Detection

The error classifier detects quota exhaustion by matching any of these patterns (case-insensitive):
- `'403'` (HTTP status code)
- `'quota'`
- `'insufficient_quota'`

**Source:** [`src/core/error-boundaries.ts:42-50`](../../src/core/error-boundaries.ts#L42-L50)

#### Error Response

```typescript
{
  type: 'quota_exceeded',
  message: 'HTTP 403: insufficient_quota',
  retryable: false,
  recoveryHint: 'API quota exceeded. Check your API key limits at console.anthropic.com/settings/limits',
  originalError: Error
}
```

#### Recovery Strategy

**Automatic:**
- ❌ Not retryable
- Fails immediately (no backoff retries)
- Records failure in circuit breaker

**Manual intervention (required):**
1. Check API quota at [console.anthropic.com/settings/limits](https://console.anthropic.com/settings/limits)
2. Verify your API key has sufficient credits
3. Upgrade API plan or add credits
4. Wait for quota reset (if usage-based limits)
5. Restart Echelon after quota is restored

#### Example Logs

```
[WARN] spawnAgent(sonnet): operation failed {
  errorType: 'quota_exceeded',
  retryable: false,
  attempt: 1,
  attemptsRemaining: 0,
  message: 'HTTP 403: insufficient_quota',
  recoveryHint: 'API quota exceeded. Check your API key limits at console.anthropic.com/settings/limits'
}

[ERROR] spawnAgent(sonnet): non-retryable error {
  errorType: 'quota_exceeded',
  recoveryHint: 'API quota exceeded. Check your API key limits at console.anthropic.com/settings/limits'
}
```

#### Code Example

```typescript
import { spawnAgent } from './core/agent.js';
import { AgentErrorClassifier } from './core/error-boundaries.js';

try {
  const response = await spawnAgent(...);
} catch (err) {
  const classified = AgentErrorClassifier.classify(err);

  if (classified.type === 'quota_exceeded') {
    console.error('API quota exceeded!');
    console.error('Recovery:', classified.recoveryHint);
    // User must manually resolve quota issue
    process.exit(1);
  }
}
```

---

### 3. Timeout

**Classification:** `timeout`

#### Detection

The error classifier detects timeouts by matching any of these patterns (case-insensitive):
- `'timeout'`
- `'timed out'`
- `'504'` (HTTP Gateway Timeout)

**Source:** [`src/core/error-boundaries.ts:53-61`](../../src/core/error-boundaries.ts#L53-L61)

#### Error Response

```typescript
{
  type: 'timeout',
  message: 'Claude timed out after 600000ms',
  retryable: true,
  recoveryHint: 'Agent operation timed out. Increase timeoutMs in layer config or reduce task complexity.',
  originalError: Error
}
```

#### Recovery Strategy

**Automatic:**
- ✅ Retryable
- Exponential backoff (default: 3 retries)
- Each retry uses the same timeout value

**Manual intervention (if automatic retry fails):**
1. Increase `timeoutMs` in layer config:
   ```typescript
   const layerConfig = {
     '2ic': {
       model: 'sonnet',
       maxBudgetUsd: 1.0,
       timeoutMs: 900_000,  // Increase from 600s to 900s (15 min)
     },
   };
   ```
2. Reduce task complexity by breaking into smaller prompts
3. Reduce `maxTurns` to limit thinking time
4. Check if the agent is stuck in a loop (review logs)

#### Example Logs

```
[WARN] spawnAgent(opus): operation failed {
  errorType: 'timeout',
  retryable: true,
  attempt: 1,
  attemptsRemaining: 2,
  message: 'Claude timed out after 600000ms',
  recoveryHint: 'Agent operation timed out. Increase timeoutMs in layer config or reduce task complexity.'
}

[INFO] spawnAgent(opus): retrying after 1.1s {
  errorType: 'timeout',
  attempt: 2,
  maxRetries: 3
}
```

#### Code Example

```typescript
import { spawnAgent } from './core/agent.js';

// Configure longer timeout for complex operations
const response = await spawnAgent(
  'Design the complete architecture for this system',
  {
    model: 'opus',
    maxBudgetUsd: 5.0,
    systemPrompt: '...',
    maxTurns: 10,
    timeoutMs: 1_200_000,  // 20 minutes for complex thinking
  }
);
```

**Default timeout:** 600,000ms (10 minutes) — defined in [`src/core/agent.ts:9`](../../src/core/agent.ts#L9)

---

### 4. Network Error

**Classification:** `network`

#### Detection

The error classifier detects network errors by matching any of these patterns (case-insensitive):
- `'econnrefused'` (Connection refused)
- `'enotfound'` (DNS resolution failed)
- `'econnreset'` (Connection reset by peer)
- `'enetunreach'` (Network unreachable)
- `'network unreachable'`
- `'connection refused'`
- `'connection reset'`

**Source:** [`src/core/error-boundaries.ts:64-80`](../../src/core/error-boundaries.ts#L64-L80)

#### Error Response

```typescript
{
  type: 'network',
  message: 'connect ECONNREFUSED 127.0.0.1:443',
  retryable: true,
  recoveryHint: 'Network connectivity issue. Check internet connection and API endpoint availability.',
  originalError: Error
}
```

#### Recovery Strategy

**Automatic:**
- ✅ Retryable
- Exponential backoff (default: 3 retries)
- Allows time for network recovery between retries

**Manual intervention (if automatic retry fails):**
1. Check internet connection
2. Verify API endpoint is reachable:
   ```bash
   curl -I https://api.anthropic.com/health
   ```
3. Check firewall/proxy settings
4. Verify DNS resolution:
   ```bash
   nslookup api.anthropic.com
   ```
5. Check for network infrastructure issues (ISP, cloud provider)

#### Example Logs

```
[WARN] spawnAgent(sonnet): operation failed {
  errorType: 'network',
  retryable: true,
  attempt: 1,
  attemptsRemaining: 2,
  message: 'connect ECONNREFUSED api.anthropic.com:443',
  recoveryHint: 'Network connectivity issue. Check internet connection and API endpoint availability.'
}

[INFO] spawnAgent(sonnet): retrying after 2.3s {
  errorType: 'network',
  attempt: 2,
  maxRetries: 3
}
```

#### Code Example

```typescript
import { spawnAgent } from './core/agent.js';
import { AgentErrorClassifier } from './core/error-boundaries.js';

try {
  const response = await spawnAgent(...);
} catch (err) {
  const classified = AgentErrorClassifier.classify(err);

  if (classified.type === 'network') {
    console.error('Network error after all retries');
    console.error('Recovery:', classified.recoveryHint);
    // Check network connectivity before retrying manually
  }
}
```

---

### 5. Process Crash

**Classification:** `crash`

#### Detection

The error classifier detects process crashes by matching any of these patterns (case-insensitive):
- `'exited'`
- `'crashed'`
- `'killed'`
- `'signal'` (e.g., SIGKILL, SIGTERM)

**Source:** [`src/core/error-boundaries.ts:83-91`](../../src/core/error-boundaries.ts#L83-L91)

#### Error Response

```typescript
{
  type: 'crash',
  message: 'Claude process exited with signal SIGKILL',
  retryable: true,
  recoveryHint: 'Agent process crashed unexpectedly. This may indicate a bug or resource constraint.',
  originalError: Error
}
```

#### Recovery Strategy

**Automatic:**
- ✅ Retryable
- Exponential backoff (default: 3 retries)
- Assumes crash was transient

**Manual intervention (if crashes persist):**
1. Check system resources:
   ```bash
   # Check memory usage
   free -h

   # Check CPU usage
   top

   # Check disk space
   df -h
   ```
2. Review agent logs for error patterns:
   ```bash
   tail -100 ~/.echelon/logs/echelon-*.log
   ```
3. Check for memory leaks or runaway processes
4. Reduce `maxTurns` to limit agent runtime
5. Split complex tasks into smaller operations
6. Report bug if crash is reproducible

#### Example Logs

```
[WARN] spawnAgent(opus): operation failed {
  errorType: 'crash',
  retryable: true,
  attempt: 1,
  attemptsRemaining: 2,
  message: 'Claude process exited with code 137',
  recoveryHint: 'Agent process crashed unexpectedly. This may indicate a bug or resource constraint.'
}

[INFO] spawnAgent(opus): retrying after 1.4s {
  errorType: 'crash',
  attempt: 2,
  maxRetries: 3
}
```

#### Code Example

```typescript
import { spawnAgent } from './core/agent.js';
import { AgentErrorClassifier } from './core/error-boundaries.js';

try {
  const response = await spawnAgent(...);
} catch (err) {
  const classified = AgentErrorClassifier.classify(err);

  if (classified.type === 'crash') {
    console.error('Agent process crashed after all retries');
    console.error('Recovery:', classified.recoveryHint);

    // Log system resources for debugging
    const { execSync } = require('child_process');
    console.error('Memory usage:', execSync('free -h').toString());
  }
}
```

**Common crash signals:**
- `SIGKILL (137)` — Killed by OS (usually OOM)
- `SIGSEGV (139)` — Segmentation fault (memory corruption)
- `SIGTERM (143)` — Graceful termination requested

---

### 6. Circuit Breaker Trip

**Classification:** Special case (not classified by `AgentErrorClassifier`)

#### Detection

The circuit breaker trips when:
1. **5 consecutive failures** occur (any error type)
2. All failures happen within the reset window
3. Circuit breaker state transitions to `open`

**Source:** [`src/core/error-boundaries.ts:154-234`](../../src/core/error-boundaries.ts#L154-L234)

**Shared circuit breaker:** [`src/core/agent.ts:17`](../../src/core/agent.ts#L17)
```typescript
const agentCircuitBreaker = new CircuitBreaker(5, 60000);
```

**Configuration:**
- Threshold: 5 consecutive failures
- Reset time: 60,000ms (60 seconds)

#### State Transitions

```
CLOSED (Normal)
  ↓ (5 consecutive failures)
OPEN (Failing fast)
  ↓ (After 60 seconds)
HALF_OPEN (Testing recovery)
  ↓
  ├── Success → CLOSED
  └── Failure → OPEN
```

**Source:** Full state machine documented in [`docs/api/validation/error-boundaries.md:259-281`](../api/validation/error-boundaries.md#L259-L281)

#### Error Response

```typescript
Error: Circuit breaker open after 5 consecutive failures. Failing fast to prevent cascading failures.
```

This error is thrown by `withErrorBoundary()` before attempting the operation.

**Source:** [`src/core/error-boundaries.ts:270-278`](../../src/core/error-boundaries.ts#L270-L278)

#### Recovery Strategy

**Automatic:**
- ✅ Auto-reset after 60 seconds
- Circuit transitions to `half_open` state
- First operation is allowed as a "probe"
  - Success → Circuit closes, normal operation resumes
  - Failure → Circuit re-opens for another 60 seconds

**Manual intervention:**

1. **Wait for auto-reset** (recommended):
   - Circuit will test recovery after 60 seconds
   - Monitor logs for state transitions:
     ```
     [INFO] Circuit breaker transitioning to half-open state
     [INFO] Circuit breaker reset to closed state after successful operation
     ```

2. **Manual reset** (advanced):
   ```typescript
   import { agentCircuitBreaker } from './core/agent.js';

   // Force reset (use with caution)
   agentCircuitBreaker.reset();
   ```

3. **Investigate root cause:**
   - Review logs for repeated error patterns
   - Check API status at [status.anthropic.com](https://status.anthropic.com)
   - Verify network connectivity
   - Check system resources (memory, CPU)

4. **Adjust circuit breaker threshold** (if needed):
   ```typescript
   // src/core/agent.ts
   const agentCircuitBreaker = new CircuitBreaker(
     10,      // Increase threshold to tolerate more failures
     120000,  // Increase reset time to 2 minutes
   );
   ```

#### Example Logs

**Circuit opens:**
```
[WARN] Circuit breaker opened after 5 consecutive failures
[ERROR] spawnAgent(sonnet): circuit breaker open, failing fast {
  state: { state: 'open', failureCount: 5, threshold: 5 }
}
```

**Auto-reset to half-open:**
```
[INFO] Circuit breaker transitioning to half-open state
```

**Half-open probe succeeds:**
```
[INFO] Circuit breaker reset to closed state after successful operation
```

**Half-open probe fails:**
```
[WARN] Circuit breaker re-opened after half-open probe failure
```

#### Code Example

```typescript
import { spawnAgent } from './core/agent.js';
import { agentCircuitBreaker } from './core/agent.js';

// Check circuit state before spawning
const state = agentCircuitBreaker.getState();
console.log('Circuit breaker state:', state);
// { state: 'closed', failureCount: 0, threshold: 5 }

try {
  const response = await spawnAgent(...);
} catch (err) {
  if (err.message.includes('Circuit breaker open')) {
    console.error('Circuit breaker tripped — system overload detected');
    console.error('Waiting 60s for auto-reset...');

    // Option 1: Wait for auto-reset
    await new Promise(resolve => setTimeout(resolve, 60000));

    // Option 2: Manual reset (use with caution)
    // agentCircuitBreaker.reset();

    // Retry after reset
    const retryResponse = await spawnAgent(...);
  }
}
```

#### Monitoring Circuit State

Expose circuit breaker state in health checks or status endpoints:

```typescript
import { agentCircuitBreaker } from './core/agent.js';

function getHealthStatus() {
  const cbState = agentCircuitBreaker.getState();

  return {
    status: cbState.state === 'closed' ? 'healthy' : 'degraded',
    circuitBreaker: {
      state: cbState.state,
      failureCount: cbState.failureCount,
      threshold: cbState.threshold,
    },
  };
}

console.log(getHealthStatus());
// { status: 'healthy', circuitBreaker: { state: 'closed', failureCount: 0, threshold: 5 } }
```

---

### 7. Unknown Error

**Classification:** `unknown`

#### Detection

The `unknown` error type is the **fallback** when no other error patterns match.

**Source:** [`src/core/error-boundaries.ts:94-101`](../../src/core/error-boundaries.ts#L94-L101)

#### Error Response

```typescript
{
  type: 'unknown',
  message: 'Something went wrong',
  retryable: true,
  recoveryHint: 'Unexpected error occurred. Check logs for details.',
  originalError: Error
}
```

#### Recovery Strategy

**Automatic:**
- ✅ Retryable (defaults to safe behavior)
- Exponential backoff (default: 3 retries)
- Assumes error may be transient

**Manual intervention (if retries fail):**
1. Review full error logs:
   ```bash
   tail -200 ~/.echelon/logs/echelon-*.log
   ```
2. Check error stack trace for root cause
3. Search for similar issues in GitHub issues
4. Reproduce the error with verbose logging:
   ```bash
   echelon --verbose -c config.json -d "..."
   ```
5. Report bug with reproduction steps

#### Example Logs

```
[WARN] spawnAgent(sonnet): operation failed {
  errorType: 'unknown',
  retryable: true,
  attempt: 1,
  attemptsRemaining: 2,
  message: 'Unexpected internal error',
  recoveryHint: 'Unexpected error occurred. Check logs for details.'
}

[INFO] spawnAgent(sonnet): retrying after 1.3s {
  errorType: 'unknown',
  attempt: 2,
  maxRetries: 3
}

[ERROR] spawnAgent(sonnet): max retries exhausted {
  errorType: 'unknown',
  attempts: 3,
  recoveryHint: 'Unexpected error occurred. Check logs for details.'
}
```

#### Code Example

```typescript
import { spawnAgent } from './core/agent.js';
import { AgentErrorClassifier } from './core/error-boundaries.js';
import { logger } from './lib/logger.js';

try {
  const response = await spawnAgent(...);
} catch (err) {
  const classified = AgentErrorClassifier.classify(err);

  if (classified.type === 'unknown') {
    logger.error('Unknown error after all retries', {
      message: err.message,
      stack: err.stack,
      hint: classified.recoveryHint,
    });

    // Log full error details for debugging
    console.error('Full error:', err);

    // Consider escalating to monitoring/alerting
  }
}
```

---

## Recovery Strategy Priorities

Errors are handled in this order of priority:

### 1. Non-Retryable (Fail Fast)

**Error type:** `quota_exceeded`

**Action:** Throw immediately, no retries
**Reason:** Retrying won't help — user must manually resolve

### 2. Circuit Breaker (System Protection)

**Error type:** All types (after 5 consecutive failures)

**Action:** Fail fast until circuit resets
**Reason:** Prevent cascading failures, allow system recovery

### 3. Retryable with Backoff (Automatic Recovery)

**Error types:** `rate_limit`, `timeout`, `network`, `crash`, `unknown`

**Action:** Retry up to 3 times with exponential backoff
**Reason:** Transient errors often resolve with time

### Summary Table

| Priority | Error Type | Strategy | Manual Action Required |
|----------|-----------|----------|----------------------|
| 1 | `quota_exceeded` | Fail immediately | ✅ Yes — Add API credits |
| 2 | Circuit breaker trip | Fail fast → Auto-reset (60s) | ⚠️ Optional — Wait or manual reset |
| 3 | `rate_limit` | Retry with backoff | ⚠️ If retries fail — Reduce request rate |
| 3 | `timeout` | Retry with backoff | ⚠️ If retries fail — Increase timeout |
| 3 | `network` | Retry with backoff | ⚠️ If retries fail — Check connectivity |
| 3 | `crash` | Retry with backoff | ⚠️ If retries fail — Check resources |
| 3 | `unknown` | Retry with backoff | ⚠️ If retries fail — Investigate logs |

### Exponential Backoff Timeline

**Default configuration:**
- Max retries: 3
- Base delay: 1000ms
- Max delay: 32000ms
- Jitter: 0-25%

**Retry timeline:**
```
Attempt 1: 0ms (immediate)
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
Throw error (total time: ~8-10 seconds)
```

**Source:** [`src/core/error-boundaries.ts:107-148`](../../src/core/error-boundaries.ts#L107-L148)

---

## Related Documentation

- **[Error Boundaries and Circuit Breaker Infrastructure](../api/validation/error-boundaries.md)** — Complete technical reference for error handling infrastructure
- **[Agent API Reference](../api/validation/agent-api.md)** — Agent spawn/resume operations
- **[Action Parser Validation](../api/validation/action-parser.md)** — Action extraction and validation
- **[Orchestrator](../../src/core/orchestrator.ts)** — Hierarchical agent cascade implementation

---

## Summary

Echelon provides **robust error recovery** through automatic classification and retry strategies:

✅ **Automatic recovery** — Retryable errors are handled transparently with exponential backoff
✅ **System protection** — Circuit breaker prevents cascading failures
✅ **Actionable hints** — Every error includes recovery guidance
✅ **Observability** — Structured logging with error types and retry attempts

**Key principles:**
1. **Fail fast** for non-retryable errors (quota exhausted)
2. **Retry with backoff** for transient errors (rate limits, network, timeouts)
3. **Circuit break** after threshold to prevent system overload
4. **Log actionable hints** for manual intervention

For implementation details, see [`src/core/error-boundaries.ts`](../../src/core/error-boundaries.ts).

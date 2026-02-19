# Agent Validation Pattern Examples

Practical, runnable examples demonstrating common validation patterns when using `spawnAgent()` and `resumeAgent()`.

---

## Table of Contents

- [Overview](#overview)
- [Example 1: Basic Spawn with Validation](#example-1-basic-spawn-with-validation)
- [Example 2: Resume with Budget Validation](#example-2-resume-with-budget-validation)
- [Example 3: Graceful Error Handling with AgentErrorClassifier](#example-3-graceful-error-handling-with-agenterrorclassifier)
- [Example 4: Circuit Breaker Behavior](#example-4-circuit-breaker-behavior)
- [Example 5: Real-Time Progress Streaming](#example-5-real-time-progress-streaming)
- [Example 6: Timeout Handling with Custom Recovery](#example-6-timeout-handling-with-custom-recovery)
- [Example 7: Budget Exhaustion Handling](#example-7-budget-exhaustion-handling)
- [Running These Examples](#running-these-examples)
- [Related Documentation](#related-documentation)

---

## Overview

All examples follow these conventions:
- ✅ **ESM imports** with `.js` extensions (Echelon uses TypeScript with ESM modules)
- ✅ **Proper error handling** with try-catch blocks and error classification
- ✅ **Runnable TypeScript** — Copy these examples into your project and execute them
- ✅ **Real-world scenarios** — Patterns you'll encounter in production

**Core modules used:**
- `src/core/agent.ts` — `spawnAgent()` and `resumeAgent()` functions
- `src/core/agent-errors.ts` — Validation error types
- `src/core/error-boundaries.ts` — Error classification and circuit breaker
- `src/core/agent-validation.ts` — Input validators

---

## Example 1: Basic Spawn with Validation

**Use case:** Spawn an agent with proper validation and error handling.

**What this demonstrates:**
- Input validation (model, budget, prompts)
- Handling validation errors with recovery hints
- Successful agent spawn and response handling

```typescript
import { spawnAgent } from './core/agent.js';
import type { AgentResponse } from './core/agent.js';
import {
  ModelValidationError,
  BudgetValidationError,
  PromptValidationError,
} from './core/agent-errors.js';
import { logger } from './lib/logger.js';

async function basicSpawnExample(): Promise<void> {
  try {
    // Valid configuration
    const response: AgentResponse = await spawnAgent(
      'Review the authentication module and identify security vulnerabilities',
      {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'You are a security expert specializing in authentication systems.',
        maxTurns: 5,
        timeoutMs: 300_000, // 5 minutes
        cwd: process.cwd(),
      }
    );

    logger.info('Agent spawn successful', {
      sessionId: response.sessionId,
      costUsd: response.costUsd,
      durationMs: response.durationMs,
      contentLength: response.content.length,
    });

    // Process the response
    console.log('Agent response:', response.content);

    // Save session ID for later resumption
    const sessionId = response.sessionId;
    console.log('Session can be resumed with ID:', sessionId);

  } catch (err) {
    if (err instanceof ModelValidationError) {
      // Model name is invalid
      logger.error('Invalid model:', err.message);
      logger.info('Recovery:', err.recoveryHint);
      // Fix: Use 'opus', 'sonnet', or 'haiku'
    } else if (err instanceof BudgetValidationError) {
      // Budget is too low
      logger.error('Invalid budget:', err.message);
      logger.info('Recovery:', err.recoveryHint);
      // Fix: Set maxBudgetUsd >= 0.01
    } else if (err instanceof PromptValidationError) {
      // Prompt is empty or too long
      logger.error('Invalid prompt:', err.message);
      logger.info('Recovery:', err.recoveryHint);
      // Fix: Provide non-empty prompt (max 100k chars)
    } else {
      // Runtime error (network, timeout, etc.)
      logger.error('Agent spawn failed:', err instanceof Error ? err.message : String(err));
      // These are automatically retried by error boundary
      // Only thrown if all retries exhausted
    }
  }
}

// Example with invalid inputs to demonstrate validation
async function invalidInputExample(): Promise<void> {
  const invalidConfigs = [
    {
      name: 'Invalid model',
      prompt: 'Hello',
      opts: { model: 'gpt-4', maxBudgetUsd: 1.0, systemPrompt: 'Test' },
      // Expected: ModelValidationError
    },
    {
      name: 'Budget too low',
      prompt: 'Hello',
      opts: { model: 'sonnet', maxBudgetUsd: 0.001, systemPrompt: 'Test' },
      // Expected: BudgetValidationError
    },
    {
      name: 'Empty prompt',
      prompt: '',
      opts: { model: 'sonnet', maxBudgetUsd: 1.0, systemPrompt: 'Test' },
      // Expected: PromptValidationError
    },
    {
      name: 'Relative path for cwd',
      prompt: 'Hello',
      opts: { model: 'sonnet', maxBudgetUsd: 1.0, systemPrompt: 'Test', cwd: './relative/path' },
      // Expected: WorkingDirectoryValidationError
    },
  ];

  for (const config of invalidConfigs) {
    try {
      await spawnAgent(config.prompt, config.opts as any);
      console.error(`❌ ${config.name}: Should have thrown validation error`);
    } catch (err) {
      if (err instanceof Error && 'recoveryHint' in err) {
        console.log(`✅ ${config.name}: Caught validation error`);
        console.log(`   Error: ${err.message}`);
        console.log(`   Recovery: ${(err as any).recoveryHint}`);
      } else {
        console.error(`❌ ${config.name}: Unexpected error:`, err);
      }
    }
  }
}

// Run examples
await basicSpawnExample();
await invalidInputExample();
```

**Key takeaways:**
- Validation errors provide `recoveryHint` for remediation
- Validation happens before API calls (fail fast)
- Runtime errors are handled by error boundary with automatic retry

---

## Example 2: Resume with Budget Validation

**Use case:** Resume an existing agent session with budget checks.

**What this demonstrates:**
- Resuming a previous session
- Budget validation on resume
- Session ID validation
- Cumulative cost tracking across resume operations

```typescript
import { spawnAgent, resumeAgent } from './core/agent.js';
import type { AgentResponse } from './core/agent.js';
import { BudgetValidationError, SessionValidationError } from './core/agent-errors.js';
import { logger } from './lib/logger.js';

async function resumeWithBudgetExample(): Promise<void> {
  let sessionId: string | null = null;
  let totalCost = 0;

  try {
    // Step 1: Spawn initial agent
    console.log('Step 1: Spawning initial agent...');
    const initialResponse: AgentResponse = await spawnAgent(
      'Start implementing JWT authentication. Begin with the token generation endpoint.',
      {
        model: 'sonnet',
        maxBudgetUsd: 2.0,
        systemPrompt: 'You are an expert backend engineer.',
        maxTurns: 3,
      }
    );

    sessionId = initialResponse.sessionId;
    totalCost += initialResponse.costUsd;

    console.log(`Initial spawn complete. Cost: $${initialResponse.costUsd.toFixed(4)}`);
    console.log(`Session ID: ${sessionId}`);
    console.log(`Response preview: ${initialResponse.content.slice(0, 100)}...`);

    // Step 2: Resume with budget check
    console.log('\nStep 2: Resuming agent to continue work...');

    // Calculate remaining budget
    const remainingBudget = 2.0 - totalCost;
    console.log(`Remaining budget: $${remainingBudget.toFixed(4)}`);

    if (remainingBudget < 0.01) {
      throw new BudgetValidationError(remainingBudget);
    }

    const resumeResponse: AgentResponse = await resumeAgent(
      sessionId,
      'Now implement the token validation middleware.',
      {
        maxTurns: 3,
        maxBudgetUsd: remainingBudget, // Use remaining budget
      }
    );

    totalCost += resumeResponse.costUsd;

    console.log(`Resume complete. Cost: $${resumeResponse.costUsd.toFixed(4)}`);
    console.log(`Total cost so far: $${totalCost.toFixed(4)}`);
    console.log(`Response preview: ${resumeResponse.content.slice(0, 100)}...`);

    // Step 3: Final resume with budget exhaustion check
    console.log('\nStep 3: Final resume operation...');

    const finalRemainingBudget = 2.0 - totalCost;
    console.log(`Final remaining budget: $${finalRemainingBudget.toFixed(4)}`);

    if (finalRemainingBudget < 0.01) {
      console.log('⚠️  Budget exhausted — cannot resume further');
      console.log('Total spent: $' + totalCost.toFixed(4));
      return;
    }

    const finalResponse: AgentResponse = await resumeAgent(
      sessionId,
      'Add error handling to both endpoints.',
      {
        maxTurns: 2,
        maxBudgetUsd: finalRemainingBudget,
      }
    );

    totalCost += finalResponse.costUsd;

    console.log(`Final resume complete. Cost: $${finalResponse.costUsd.toFixed(4)}`);
    console.log(`Total cost: $${totalCost.toFixed(4)}`);

  } catch (err) {
    if (err instanceof SessionValidationError) {
      logger.error('Invalid session ID:', err.message);
      logger.info('Recovery:', err.recoveryHint);
      // Fix: Use a valid session ID from previous spawn/resume
    } else if (err instanceof BudgetValidationError) {
      logger.error('Budget exhausted:', err.message);
      logger.info('Recovery:', err.recoveryHint);
      logger.info('Total cost so far: $' + totalCost.toFixed(4));
      // Fix: Increase maxBudgetUsd in config
    } else {
      logger.error('Resume failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

// Example: Attempting to resume with invalid session ID
async function invalidSessionIdExample(): Promise<void> {
  const invalidSessionIds = [
    { value: 'abc', reason: 'Too short (min 5 chars)' },
    { value: '', reason: 'Empty string' },
    { value: '   ', reason: 'Whitespace only' },
    { value: 'session#123', reason: 'Invalid characters' },
  ];

  for (const { value, reason } of invalidSessionIds) {
    try {
      await resumeAgent(value, 'Continue task', { maxTurns: 1 });
      console.error(`❌ Should have rejected: ${reason}`);
    } catch (err) {
      if (err instanceof SessionValidationError) {
        console.log(`✅ Correctly rejected: ${reason}`);
        console.log(`   Error: ${err.message}`);
      } else {
        console.error(`❌ Unexpected error for "${reason}":`, err);
      }
    }
  }
}

// Run examples
await resumeWithBudgetExample();
await invalidSessionIdExample();
```

**Key takeaways:**
- Budget checks prevent overspending across multiple resume operations
- Session IDs must be valid (min 5 chars, alphanumeric + `-_`)
- Each resume operation returns cumulative cost via `costUsd`
- Budget validation happens before Claude CLI spawn

---

## Example 3: Graceful Error Handling with AgentErrorClassifier

**Use case:** Handle different error types with specific recovery strategies.

**What this demonstrates:**
- Error classification by type (rate_limit, timeout, network, etc.)
- Conditional recovery based on error type
- Using recovery hints for user feedback

```typescript
import { spawnAgent, resumeAgent } from './core/agent.js';
import type { AgentResponse } from './core/agent.js';
import { AgentErrorClassifier } from './core/error-boundaries.js';
import type { ClassifiedError, AgentErrorType } from './core/error-boundaries.js';
import { logger } from './lib/logger.js';

async function classifiedErrorHandlingExample(): Promise<void> {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response: AgentResponse = await spawnAgent(
        'Analyze the codebase for performance bottlenecks',
        {
          model: 'sonnet',
          maxBudgetUsd: 1.0,
          systemPrompt: 'You are a performance optimization expert.',
          maxTurns: 8,
          timeoutMs: 600_000, // 10 minutes
        }
      );

      logger.info('Agent completed successfully', {
        costUsd: response.costUsd,
        durationMs: response.durationMs,
      });

      console.log('Analysis:', response.content);
      return; // Success

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const classified: ClassifiedError = AgentErrorClassifier.classify(error);

      logger.warn('Agent operation failed', {
        errorType: classified.type,
        retryable: classified.retryable,
        attempt: attempt + 1,
        maxRetries,
        message: classified.message,
        recoveryHint: classified.recoveryHint,
      });

      // Handle based on error type
      const recovered = await handleError(classified, attempt, maxRetries);

      if (recovered) {
        attempt++;
        continue; // Retry
      } else {
        // Non-recoverable — fail immediately
        throw error;
      }
    }
  }

  throw new Error('Agent spawn failed after max retries');
}

async function handleError(
  classified: ClassifiedError,
  attempt: number,
  maxRetries: number
): Promise<boolean> {
  switch (classified.type) {
    case 'validation':
      // Non-retryable — user must fix input
      console.error('❌ Validation error:', classified.message);
      console.error('Recovery hint:', classified.recoveryHint);
      return false;

    case 'rate_limit':
      // Retryable — wait with exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 32000);
        console.log(`⏳ Rate limit hit — waiting ${delay}ms before retry...`);
        await sleep(delay);
        return true;
      }
      console.error('❌ Rate limit persists after retries');
      console.error('Recovery hint:', classified.recoveryHint);
      return false;

    case 'quota_exceeded':
      // Non-retryable — user must add credits
      console.error('❌ API quota exceeded:', classified.message);
      console.error('Recovery hint:', classified.recoveryHint);
      console.error('Check your limits at: https://console.anthropic.com/settings/limits');
      return false;

    case 'timeout':
      // Retryable — but may need config change
      if (attempt < maxRetries - 1) {
        console.log(`⏳ Timeout — retrying with same timeout...`);
        return true;
      }
      console.error('❌ Timeout persists after retries');
      console.error('Recovery hint:', classified.recoveryHint);
      console.error('Consider increasing timeoutMs in config');
      return false;

    case 'network':
      // Retryable — network may recover
      if (attempt < maxRetries - 1) {
        const delay = 2000; // Fixed 2s delay for network errors
        console.log(`⏳ Network error — waiting ${delay}ms before retry...`);
        await sleep(delay);
        return true;
      }
      console.error('❌ Network error persists after retries');
      console.error('Recovery hint:', classified.recoveryHint);
      return false;

    case 'crash':
      // Retryable — process crash may be transient
      if (attempt < maxRetries - 1) {
        console.log(`⏳ Process crash — retrying...`);
        return true;
      }
      console.error('❌ Process crash persists after retries');
      console.error('Recovery hint:', classified.recoveryHint);
      return false;

    case 'unknown':
      // Retryable — cautious retry
      if (attempt < maxRetries - 1) {
        console.log(`⏳ Unknown error — retrying cautiously...`);
        await sleep(1000);
        return true;
      }
      console.error('❌ Unknown error persists after retries');
      console.error('Recovery hint:', classified.recoveryHint);
      return false;

    default:
      const _exhaustive: never = classified.type;
      return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Example: Simulating different error types
async function errorTypeExamples(): Promise<void> {
  const errorScenarios = [
    { type: 'rate_limit', message: 'HTTP 429: Too Many Requests' },
    { type: 'quota_exceeded', message: 'HTTP 403: insufficient_quota' },
    { type: 'timeout', message: 'Agent timed out after 600000ms' },
    { type: 'network', message: 'ECONNREFUSED: Connection refused' },
    { type: 'crash', message: 'Agent process exited with code 1' },
  ];

  console.log('Error Classification Examples:\n');

  for (const scenario of errorScenarios) {
    const error = new Error(scenario.message);
    const classified = AgentErrorClassifier.classify(error);

    console.log(`Type: ${classified.type}`);
    console.log(`  Message: ${classified.message}`);
    console.log(`  Retryable: ${classified.retryable}`);
    console.log(`  Recovery: ${classified.recoveryHint}`);
    console.log('');
  }
}

// Run examples
await classifiedErrorHandlingExample();
await errorTypeExamples();
```

**Key takeaways:**
- `AgentErrorClassifier.classify()` categorizes errors by type
- Each error type has specific `retryable` flag and `recoveryHint`
- Validation and quota errors are non-retryable
- Rate limit, timeout, network, and crash errors are retryable
- Error boundary in `agent.ts` already does this automatically

---

## Example 4: Circuit Breaker Behavior

**Use case:** Demonstrate circuit breaker protection against cascading failures.

**What this demonstrates:**
- Circuit breaker opens after N consecutive failures
- Fail-fast behavior when circuit is open
- Automatic reset after timeout
- Manual reset capability

```typescript
import { spawnAgent } from './core/agent.js';
import type { AgentResponse } from './core/agent.js';
import { CircuitBreaker } from './core/error-boundaries.js';
import { logger } from './lib/logger.js';

async function circuitBreakerExample(): Promise<void> {
  // Create a circuit breaker (threshold: 5 failures, reset: 60s)
  const breaker = new CircuitBreaker(5, 60_000);

  console.log('Circuit Breaker Example: Simulating consecutive failures\n');

  // Simulate 7 consecutive spawn attempts
  for (let i = 0; i < 7; i++) {
    console.log(`\nAttempt ${i + 1}:`);

    // Check circuit state
    if (breaker.isOpen()) {
      console.error('❌ Circuit is OPEN — failing fast');
      const state = breaker.getState();
      console.log(`   State: ${state.state}`);
      console.log(`   Failures: ${state.failureCount}/${state.threshold}`);
      console.log('   Recovery: Wait for auto-reset (60s) or manually reset circuit');
      break;
    }

    try {
      // This would fail in reality if API is down
      // For demo purposes, we simulate a failure
      const shouldFail = i < 6; // First 6 attempts fail

      if (shouldFail) {
        throw new Error('Simulated API failure');
      }

      const response: AgentResponse = await spawnAgent(
        'Test prompt',
        {
          model: 'sonnet',
          maxBudgetUsd: 0.1,
          systemPrompt: 'Test',
          maxTurns: 1,
        }
      );

      console.log('✅ Success');
      breaker.recordSuccess();

    } catch (err) {
      console.error('❌ Failed:', err instanceof Error ? err.message : String(err));
      breaker.recordFailure();

      const state = breaker.getState();
      console.log(`   Failures recorded: ${state.failureCount}/${state.threshold}`);
      console.log(`   Circuit state: ${state.state}`);

      if (state.state === 'open') {
        console.log('   ⚠️  Circuit breaker OPENED after threshold reached');
      }
    }
  }

  // Demonstrate manual reset
  console.log('\n--- Manual Reset ---');
  breaker.reset();
  const resetState = breaker.getState();
  console.log(`Circuit state after reset: ${resetState.state}`);
  console.log(`Failure count: ${resetState.failureCount}`);
}

async function circuitBreakerAutoResetExample(): Promise<void> {
  // Create breaker with short reset time for demo (5 seconds)
  const breaker = new CircuitBreaker(3, 5_000);

  console.log('\nCircuit Breaker Auto-Reset Example:\n');

  // Trigger 3 failures to open circuit
  for (let i = 0; i < 3; i++) {
    breaker.recordFailure();
    console.log(`Failure ${i + 1}/3 recorded`);
  }

  let state = breaker.getState();
  console.log(`Circuit opened: ${state.state === 'open'}`);

  // Wait for auto-reset (half-open state)
  console.log('\nWaiting 5 seconds for auto-reset...');
  await sleep(5_000);

  // Check if circuit transitioned to half-open
  const isOpen = breaker.isOpen(); // This call triggers auto-transition
  state = breaker.getState();
  console.log(`Circuit state after timeout: ${state.state}`);
  console.log(`Is open: ${isOpen}`);

  if (state.state === 'half_open') {
    console.log('✅ Circuit auto-transitioned to half-open');
    console.log('   Next operation will probe if system recovered');

    // Simulate successful probe
    breaker.recordSuccess();
    state = breaker.getState();
    console.log(`Circuit state after success: ${state.state}`);
    console.log('✅ Circuit fully reset to closed state');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Integration with agent spawn (automatic)
async function circuitBreakerIntegrationExample(): Promise<void> {
  console.log('\nCircuit Breaker Integration with Agent Spawn:\n');

  // Note: agent.ts already has a global circuit breaker
  // This example shows how it's used internally

  try {
    // The circuit breaker is checked inside withErrorBoundary wrapper
    // If circuit is open, spawn fails immediately with:
    // "Circuit breaker open after N consecutive failures"
    const response = await spawnAgent(
      'Test prompt',
      {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
      }
    );

    console.log('✅ Agent spawned successfully');
  } catch (err) {
    if (err instanceof Error && err.message.includes('Circuit breaker open')) {
      console.error('❌ Circuit breaker prevented spawn (fail fast)');
      console.error('   This protects against cascading failures');
      console.error('   Wait for auto-reset or investigate root cause');
    } else {
      console.error('❌ Other error:', err);
    }
  }
}

// Run examples
await circuitBreakerExample();
await circuitBreakerAutoResetExample();
await circuitBreakerIntegrationExample();
```

**Key takeaways:**
- Circuit breaker prevents cascading failures by failing fast
- Opens after N consecutive failures (default: 5)
- Auto-resets to half-open after timeout (default: 60s)
- Half-open state probes if system recovered
- Global circuit breaker in `agent.ts` protects all spawn/resume operations

---

## Example 5: Real-Time Progress Streaming

**Use case:** Monitor agent progress in real-time with custom callbacks.

**What this demonstrates:**
- Streaming agent output as it arrives (simulated via polling)
- Progress callbacks for UI updates
- Cost tracking during execution
- Graceful cancellation

**Note:** The Claude CLI `--output-format json` mode doesn't currently support streaming. This example shows the pattern for when streaming becomes available, or for wrapping agent operations with progress tracking.

```typescript
import { spawnAgent } from './core/agent.js';
import type { AgentResponse } from './core/agent.js';
import { logger } from './lib/logger.js';

interface ProgressEvent {
  type: 'started' | 'thinking' | 'tool_use' | 'completed' | 'error';
  timestamp: number;
  costUsd?: number;
  message?: string;
}

type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Wrapper for spawnAgent with progress tracking.
 *
 * Note: Actual streaming requires Claude CLI support. This demonstrates
 * the pattern using before/after callbacks.
 */
async function spawnWithProgress(
  prompt: string,
  opts: {
    model: string;
    maxBudgetUsd: number;
    systemPrompt: string;
    maxTurns?: number;
    timeoutMs?: number;
  },
  onProgress: ProgressCallback
): Promise<AgentResponse> {
  // Emit started event
  onProgress({
    type: 'started',
    timestamp: Date.now(),
    message: 'Agent spawn initiated',
  });

  try {
    // Simulate periodic progress updates (in real implementation, this would
    // come from Claude CLI streaming output)
    const progressInterval = setInterval(() => {
      onProgress({
        type: 'thinking',
        timestamp: Date.now(),
        message: 'Agent is processing...',
      });
    }, 1000);

    // Spawn agent
    const response = await spawnAgent(prompt, opts);

    // Clear interval
    clearInterval(progressInterval);

    // Emit completion event
    onProgress({
      type: 'completed',
      timestamp: Date.now(),
      costUsd: response.costUsd,
      message: 'Agent completed successfully',
    });

    return response;

  } catch (err) {
    // Emit error event
    onProgress({
      type: 'error',
      timestamp: Date.now(),
      message: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}

async function progressStreamingExample(): Promise<void> {
  console.log('Real-Time Progress Streaming Example:\n');

  let progressCount = 0;
  let totalCost = 0;

  const onProgress: ProgressCallback = (event) => {
    const timestamp = new Date(event.timestamp).toISOString();
    progressCount++;

    switch (event.type) {
      case 'started':
        console.log(`[${timestamp}] 🚀 ${event.message}`);
        break;

      case 'thinking':
        // Only log every 3rd thinking event to reduce noise
        if (progressCount % 3 === 0) {
          console.log(`[${timestamp}] 🤔 ${event.message}`);
        }
        break;

      case 'tool_use':
        console.log(`[${timestamp}] 🔧 ${event.message}`);
        break;

      case 'completed':
        totalCost = event.costUsd ?? 0;
        console.log(`[${timestamp}] ✅ ${event.message}`);
        console.log(`   Cost: $${totalCost.toFixed(4)}`);
        break;

      case 'error':
        console.error(`[${timestamp}] ❌ ${event.message}`);
        break;
    }
  };

  try {
    const response = await spawnWithProgress(
      'Implement a rate limiter for the API with Redis backend',
      {
        model: 'sonnet',
        maxBudgetUsd: 2.0,
        systemPrompt: 'You are an expert backend engineer.',
        maxTurns: 10,
      },
      onProgress
    );

    console.log('\n--- Final Result ---');
    console.log(`Session ID: ${response.sessionId}`);
    console.log(`Duration: ${response.durationMs}ms`);
    console.log(`Total progress events: ${progressCount}`);
    console.log(`Response length: ${response.content.length} chars`);

  } catch (err) {
    console.error('Failed to spawn agent with progress tracking');
  }
}

// Example: Progress tracking with cost budget monitoring
async function progressWithBudgetMonitoring(): Promise<void> {
  console.log('\nProgress with Budget Monitoring Example:\n');

  const maxBudget = 1.0;
  let currentCost = 0;

  const onProgress: ProgressCallback = (event) => {
    if (event.type === 'completed' && event.costUsd) {
      currentCost = event.costUsd;

      const percentUsed = (currentCost / maxBudget) * 100;
      console.log(`Budget usage: $${currentCost.toFixed(4)} / $${maxBudget.toFixed(2)} (${percentUsed.toFixed(1)}%)`);

      if (percentUsed > 80) {
        console.warn('⚠️  Warning: Budget usage exceeded 80%');
      }

      if (currentCost >= maxBudget) {
        console.error('❌ Budget exhausted!');
      }
    }
  };

  try {
    await spawnWithProgress(
      'Quick code review task',
      {
        model: 'haiku', // Use cheaper model
        maxBudgetUsd: maxBudget,
        systemPrompt: 'You are a code reviewer.',
        maxTurns: 3,
      },
      onProgress
    );
  } catch (err) {
    console.error('Progress tracking failed:', err);
  }
}

// Run examples
await progressStreamingExample();
await progressWithBudgetMonitoring();
```

**Key takeaways:**
- Progress callbacks enable real-time UI updates
- Cost can be tracked incrementally
- Pattern shown works for future streaming support
- Current implementation uses before/after callbacks
- Useful for long-running agent operations (10+ turns)

---

## Example 6: Timeout Handling with Custom Recovery

**Use case:** Handle agent timeouts with custom recovery strategies.

**What this demonstrates:**
- Timeout validation (min 5s, max 1 hour)
- Detecting timeout errors
- Custom retry logic with increased timeout
- Fallback to simpler prompts

```typescript
import { spawnAgent, resumeAgent } from './core/agent.js';
import type { AgentResponse } from './core/agent.js';
import { TimeoutValidationError } from './core/agent-errors.js';
import { AgentErrorClassifier } from './core/error-boundaries.js';
import { logger } from './lib/logger.js';

async function timeoutHandlingExample(): Promise<void> {
  const baseTimeout = 60_000; // 1 minute
  const maxRetries = 3;

  console.log('Timeout Handling Example:\n');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Exponentially increase timeout on each retry
    const timeoutMs = baseTimeout * Math.pow(2, attempt);
    console.log(`Attempt ${attempt + 1}/${maxRetries} with timeout: ${timeoutMs / 1000}s`);

    try {
      const response: AgentResponse = await spawnAgent(
        'Perform a comprehensive security audit of the entire codebase, including all dependencies',
        {
          model: 'opus', // More capable but slower
          maxBudgetUsd: 5.0,
          systemPrompt: 'You are a security auditor.',
          maxTurns: 20, // Complex task needs many turns
          timeoutMs,
        }
      );

      console.log('✅ Task completed successfully');
      console.log(`   Duration: ${response.durationMs}ms`);
      console.log(`   Cost: $${response.costUsd.toFixed(4)}`);
      return; // Success

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const classified = AgentErrorClassifier.classify(error);

      if (classified.type === 'timeout') {
        console.error(`❌ Attempt ${attempt + 1} timed out after ${timeoutMs}ms`);
        console.log(`   Recovery hint: ${classified.recoveryHint}`);

        if (attempt < maxRetries - 1) {
          console.log(`   Retrying with increased timeout: ${(timeoutMs * 2) / 1000}s\n`);
          continue;
        } else {
          console.error('❌ All retries exhausted — trying fallback strategy');
          return await fallbackStrategy();
        }
      } else {
        // Different error type
        console.error(`❌ Non-timeout error: ${classified.type}`);
        throw err;
      }
    }
  }
}

async function fallbackStrategy(): Promise<void> {
  console.log('\n--- Fallback Strategy: Simplified Task ---');

  try {
    // Break down the complex task into smaller pieces
    const response = await spawnAgent(
      'Perform a security audit focusing ONLY on authentication and authorization code',
      {
        model: 'sonnet', // Faster model
        maxBudgetUsd: 2.0,
        systemPrompt: 'You are a security auditor. Focus on authentication/authorization only.',
        maxTurns: 8, // Fewer turns
        timeoutMs: 180_000, // 3 minutes
      }
    );

    console.log('✅ Fallback task completed');
    console.log(`   Duration: ${response.durationMs}ms`);
    console.log(`   Cost: $${response.costUsd.toFixed(4)}`);
    console.log('\n💡 Tip: Break large tasks into smaller subtasks to avoid timeouts');

  } catch (err) {
    console.error('❌ Fallback strategy also failed:', err);
    throw err;
  }
}

// Example: Timeout validation
async function timeoutValidationExample(): Promise<void> {
  console.log('\nTimeout Validation Example:\n');

  const invalidTimeouts = [
    { value: 1000, reason: 'Too short (< 5s)' },
    { value: 4000, reason: 'Too short (< 5s)' },
    { value: 4_000_000, reason: 'Too long (> 1 hour)' },
  ];

  for (const { value, reason } of invalidTimeouts) {
    try {
      await spawnAgent(
        'Test',
        {
          model: 'sonnet',
          maxBudgetUsd: 1.0,
          systemPrompt: 'Test',
          timeoutMs: value,
        }
      );
      console.error(`❌ Should have rejected: ${reason}`);
    } catch (err) {
      if (err instanceof TimeoutValidationError) {
        console.log(`✅ Correctly rejected: ${reason}`);
        console.log(`   Error: ${err.message}`);
        console.log(`   Recovery: ${err.recoveryHint}`);
      } else {
        console.error(`❌ Unexpected error:`, err);
      }
    }
  }

  // Valid timeout
  console.log('\nValid timeouts: 5,000ms to 3,600,000ms (5s to 1 hour)');
}

// Example: Adaptive timeout based on task complexity
async function adaptiveTimeoutExample(): Promise<void> {
  console.log('\nAdaptive Timeout Example:\n');

  interface Task {
    description: string;
    complexity: 'low' | 'medium' | 'high';
  }

  const tasks: Task[] = [
    { description: 'Add a console.log statement', complexity: 'low' },
    { description: 'Implement input validation', complexity: 'medium' },
    { description: 'Refactor authentication system', complexity: 'high' },
  ];

  for (const task of tasks) {
    // Adjust timeout based on complexity
    const timeoutMs = {
      low: 30_000,      // 30 seconds
      medium: 120_000,  // 2 minutes
      high: 600_000,    // 10 minutes
    }[task.complexity];

    console.log(`Task: ${task.description}`);
    console.log(`  Complexity: ${task.complexity}`);
    console.log(`  Timeout: ${timeoutMs / 1000}s`);

    try {
      const response = await spawnAgent(
        task.description,
        {
          model: 'sonnet',
          maxBudgetUsd: 1.0,
          systemPrompt: 'You are a software engineer.',
          maxTurns: task.complexity === 'low' ? 2 : task.complexity === 'medium' ? 5 : 10,
          timeoutMs,
        }
      );

      console.log(`  ✅ Completed in ${response.durationMs}ms\n`);
    } catch (err) {
      const classified = AgentErrorClassifier.classify(err instanceof Error ? err : new Error(String(err)));
      console.error(`  ❌ Failed: ${classified.type}\n`);
    }
  }
}

// Run examples
await timeoutHandlingExample();
await timeoutValidationExample();
await adaptiveTimeoutExample();
```

**Key takeaways:**
- Timeout must be between 5s and 1 hour
- Exponential backoff increases timeout on retries
- Complex tasks may need longer timeouts or task decomposition
- Adaptive timeouts based on task complexity improve success rate
- Fallback to simpler prompts if timeouts persist

---

## Example 7: Budget Exhaustion Handling

**Use case:** Gracefully handle budget exhaustion across multiple agent operations.

**What this demonstrates:**
- Pre-flight budget validation
- Budget tracking across spawn and resume operations
- Budget exhaustion detection
- Recovery strategies (upgrade plan, split tasks)

```typescript
import { spawnAgent, resumeAgent } from './core/agent.js';
import type { AgentResponse } from './core/agent.js';
import { BudgetValidationError } from './core/agent-errors.js';
import { logger } from './lib/logger.js';

interface BudgetTracker {
  allocated: number;
  spent: number;
  remaining: number;
}

class BudgetManager {
  private tracker: BudgetTracker;

  constructor(totalBudget: number) {
    this.tracker = {
      allocated: totalBudget,
      spent: 0,
      remaining: totalBudget,
    };
  }

  canSpend(amount: number): boolean {
    return this.tracker.remaining >= amount;
  }

  recordSpend(amount: number): void {
    this.tracker.spent += amount;
    this.tracker.remaining = this.tracker.allocated - this.tracker.spent;
  }

  getStatus(): BudgetTracker {
    return { ...this.tracker };
  }

  getPercentUsed(): number {
    return (this.tracker.spent / this.tracker.allocated) * 100;
  }
}

async function budgetExhaustionExample(): Promise<void> {
  const totalBudget = 1.0; // $1.00 total budget
  const budget = new BudgetManager(totalBudget);

  console.log('Budget Exhaustion Handling Example:');
  console.log(`Total budget: $${totalBudget.toFixed(2)}\n`);

  const tasks = [
    'Implement user registration endpoint',
    'Add input validation to registration',
    'Write unit tests for registration',
    'Add integration tests',
    'Write API documentation',
  ];

  for (let i = 0; i < tasks.length; i++) {
    const taskBudget = 0.25; // Allocate $0.25 per task
    console.log(`\nTask ${i + 1}/${tasks.length}: ${tasks[i]}`);

    // Pre-flight budget check
    if (!budget.canSpend(taskBudget)) {
      const status = budget.getStatus();
      console.error(`❌ Insufficient budget for task ${i + 1}`);
      console.error(`   Spent: $${status.spent.toFixed(4)}`);
      console.error(`   Remaining: $${status.remaining.toFixed(4)}`);
      console.error(`   Required: $${taskBudget.toFixed(2)}`);

      console.log('\n--- Recovery Strategies ---');
      console.log('1. Increase total budget allocation');
      console.log('2. Reduce scope (skip remaining tasks)');
      console.log('3. Use cheaper model (haiku instead of sonnet)');
      console.log('4. Resume in next budget period');

      break;
    }

    try {
      const response: AgentResponse = await spawnAgent(
        tasks[i],
        {
          model: 'sonnet',
          maxBudgetUsd: taskBudget,
          systemPrompt: 'You are a backend engineer.',
          maxTurns: 3,
        }
      );

      budget.recordSpend(response.costUsd);
      const status = budget.getStatus();

      console.log(`✅ Task completed`);
      console.log(`   Cost: $${response.costUsd.toFixed(4)}`);
      console.log(`   Budget remaining: $${status.remaining.toFixed(4)} (${(100 - budget.getPercentUsed()).toFixed(1)}%)`);

      // Warn if budget usage is high
      if (budget.getPercentUsed() > 80) {
        console.warn(`⚠️  Warning: Budget ${budget.getPercentUsed().toFixed(1)}% depleted`);
      }

    } catch (err) {
      if (err instanceof BudgetValidationError) {
        console.error(`❌ Budget validation failed: ${err.message}`);
        console.error(`   Recovery: ${err.recoveryHint}`);
        break;
      } else {
        console.error(`❌ Task failed:`, err);
        // Continue to next task
      }
    }
  }

  // Final budget report
  const finalStatus = budget.getStatus();
  console.log('\n--- Final Budget Report ---');
  console.log(`Allocated: $${finalStatus.allocated.toFixed(2)}`);
  console.log(`Spent: $${finalStatus.spent.toFixed(4)}`);
  console.log(`Remaining: $${finalStatus.remaining.toFixed(4)}`);
  console.log(`Utilization: ${budget.getPercentUsed().toFixed(1)}%`);
}

// Example: Dynamic budget adjustment based on model
async function modelBasedBudgetExample(): Promise<void> {
  console.log('\nModel-Based Budget Allocation Example:\n');

  interface ModelCostEstimate {
    model: 'haiku' | 'sonnet' | 'opus';
    estimatedCostPerTurn: number;
  }

  const costEstimates: ModelCostEstimate[] = [
    { model: 'haiku', estimatedCostPerTurn: 0.001 },
    { model: 'sonnet', estimatedCostPerTurn: 0.005 },
    { model: 'opus', estimatedCostPerTurn: 0.020 },
  ];

  const totalBudget = 0.50;
  const targetTurns = 10;

  console.log(`Total budget: $${totalBudget.toFixed(2)}`);
  console.log(`Target turns: ${targetTurns}\n`);

  for (const { model, estimatedCostPerTurn } of costEstimates) {
    const estimatedTotal = estimatedCostPerTurn * targetTurns;
    const withinBudget = estimatedTotal <= totalBudget;

    console.log(`Model: ${model}`);
    console.log(`  Est. cost/turn: $${estimatedCostPerTurn.toFixed(4)}`);
    console.log(`  Est. total (${targetTurns} turns): $${estimatedTotal.toFixed(4)}`);
    console.log(`  Within budget: ${withinBudget ? '✅' : '❌'}`);

    if (!withinBudget) {
      const affordableTurns = Math.floor(totalBudget / estimatedCostPerTurn);
      console.log(`  Recommended: Reduce to ${affordableTurns} turns or increase budget\n`);
    } else {
      console.log(`  Recommended: Safe to use\n`);
    }
  }
}

// Example: Budget exhaustion with resume strategy
async function budgetExhaustionWithResumeExample(): Promise<void> {
  console.log('\nBudget Exhaustion with Resume Strategy:\n');

  const sessionBudget = 0.20;
  let sessionId: string | null = null;
  let totalSpent = 0;
  const maxTotalBudget = 1.0;

  for (let session = 1; session <= 5; session++) {
    console.log(`\n--- Session ${session} (Budget: $${sessionBudget.toFixed(2)}) ---`);

    // Check if we can afford another session
    if (totalSpent + sessionBudget > maxTotalBudget) {
      console.error(`❌ Cannot start session ${session} — would exceed max budget`);
      console.error(`   Spent so far: $${totalSpent.toFixed(4)}`);
      console.error(`   Session budget: $${sessionBudget.toFixed(2)}`);
      console.error(`   Max total: $${maxTotalBudget.toFixed(2)}`);
      break;
    }

    try {
      let response: AgentResponse;

      if (sessionId === null) {
        // First session — spawn
        response = await spawnAgent(
          'Start implementing the feature',
          {
            model: 'sonnet',
            maxBudgetUsd: sessionBudget,
            systemPrompt: 'You are a software engineer.',
            maxTurns: 3,
          }
        );
        sessionId = response.sessionId;
        console.log(`Spawned new session: ${sessionId.slice(0, 12)}...`);
      } else {
        // Subsequent sessions — resume
        response = await resumeAgent(
          sessionId,
          'Continue with the next part',
          {
            maxBudgetUsd: sessionBudget,
            maxTurns: 3,
          }
        );
        console.log(`Resumed session: ${sessionId.slice(0, 12)}...`);
      }

      totalSpent += response.costUsd;

      console.log(`Session cost: $${response.costUsd.toFixed(4)}`);
      console.log(`Total spent: $${totalSpent.toFixed(4)} / $${maxTotalBudget.toFixed(2)}`);
      console.log(`Remaining: $${(maxTotalBudget - totalSpent).toFixed(4)}`);

    } catch (err) {
      if (err instanceof BudgetValidationError) {
        console.error(`❌ Session ${session} hit budget limit`);
        console.error(`   Error: ${err.message}`);
        break;
      } else {
        console.error(`❌ Session ${session} failed:`, err);
        break;
      }
    }
  }

  console.log('\n--- Final Report ---');
  console.log(`Total spent: $${totalSpent.toFixed(4)} / $${maxTotalBudget.toFixed(2)}`);
  console.log(`Budget utilization: ${((totalSpent / maxTotalBudget) * 100).toFixed(1)}%`);
}

// Run examples
await budgetExhaustionExample();
await modelBasedBudgetExample();
await budgetExhaustionWithResumeExample();
```

**Key takeaways:**
- Pre-flight budget checks prevent starting tasks that will fail
- Budget tracking across operations requires manual accounting
- Different models have vastly different costs (haiku vs opus)
- Budget can be allocated per-task or per-session
- Resume operations allow incremental progress within budget limits
- Budget exhaustion is non-retryable — requires user action

---

## Running These Examples

All examples are written as ESM modules with TypeScript. To run them:

### Option 1: Run directly with tsx

```bash
# Install tsx if not already installed
npm install -g tsx

# Run an example
tsx docs/guides/validation-examples.md
```

**Note:** Markdown code blocks aren't executable. Extract the TypeScript code into a `.ts` file first.

### Option 2: Extract and run

```bash
# Create a test file
cat > test-validation.ts << 'EOF'
import { spawnAgent } from './src/core/agent.js';
// ... copy example code here
EOF

# Run with tsx
tsx test-validation.ts
```

### Option 3: Add to test suite

Add examples to the test suite in `src/__tests__/validation-examples.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// ... import example functions

describe('Validation Examples', () => {
  it('should handle basic spawn with validation', async () => {
    await basicSpawnExample();
  });

  it('should resume with budget validation', async () => {
    await resumeWithBudgetExample();
  });

  // ... more tests
});
```

### Prerequisites

All examples require:
- Claude CLI installed (`claude` binary in PATH)
- Valid Anthropic API key (set in `~/.claude/config.json` or `ANTHROPIC_API_KEY` env var)
- Node.js 18+ with ESM support
- TypeScript 5.0+

---

## Related Documentation

- **[Agent Validation Integration Guide](./validation-integration.md)** — End-to-end validation flow through the cascade
- **[Error Scenario Recovery Patterns](./error-recovery.md)** — Comprehensive error handling guide
- **[Agent API Reference](../api/validation/agent-api.md)** — Detailed agent spawn/resume validation rules
- **[Error Boundaries and Circuit Breaker](../api/validation/error-boundaries.md)** — Error classification and retry logic

---

## Summary

These examples demonstrate the complete validation lifecycle:

1. **Basic Spawn** — Input validation (model, budget, prompts)
2. **Resume** — Session ID validation and budget tracking
3. **Error Handling** — Error classification and recovery strategies
4. **Circuit Breaker** — System protection against cascading failures
5. **Progress Streaming** — Real-time monitoring (pattern for future support)
6. **Timeout** — Adaptive timeouts and fallback strategies
7. **Budget Exhaustion** — Pre-flight checks and incremental progress

**Best practices:**
- ✅ Validate inputs before expensive operations
- ✅ Handle validation errors with recovery hints
- ✅ Track budget across multiple operations
- ✅ Use error classification for conditional retry
- ✅ Implement circuit breakers for system protection
- ✅ Adjust timeouts based on task complexity
- ✅ Break large tasks into smaller chunks to avoid timeouts and budget overruns

For production usage, combine these patterns with the error boundary infrastructure in `src/core/error-boundaries.ts` and the validation layer in `src/core/agent-validation.ts`.

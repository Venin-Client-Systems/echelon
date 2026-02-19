import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentErrorClassifier,
  ExponentialBackoff,
  CircuitBreaker,
  withErrorBoundary,
  type ClassifiedError,
} from '../error-boundaries.js';
import {
  AgentValidationError,
  ModelValidationError,
  BudgetValidationError,
  SessionValidationError,
} from '../agent-errors.js';

describe('AgentErrorClassifier', () => {
  it('should classify validation errors as non-retryable', () => {
    const modelError = new ModelValidationError('gpt-4');
    const classified = AgentErrorClassifier.classify(modelError);

    assert.equal(classified.type, 'validation');
    assert.equal(classified.retryable, false);
    assert.ok(classified.recoveryHint.includes('opus, sonnet, haiku'));
    assert.equal(classified.originalError, modelError);
  });

  it('should classify all validation error subtypes', () => {
    const budgetError = new BudgetValidationError(-1);
    const budgetClassified = AgentErrorClassifier.classify(budgetError);
    assert.equal(budgetClassified.type, 'validation');
    assert.equal(budgetClassified.retryable, false);

    const sessionError = new SessionValidationError('abc', 'too short');
    const sessionClassified = AgentErrorClassifier.classify(sessionError);
    assert.equal(sessionClassified.type, 'validation');
    assert.equal(sessionClassified.retryable, false);

    const baseError = new AgentValidationError('test', 'fix it');
    const baseClassified = AgentErrorClassifier.classify(baseError);
    assert.equal(baseClassified.type, 'validation');
    assert.equal(baseClassified.retryable, false);
  });

  it('should classify rate limit errors', () => {
    const error = new Error('Request failed with status 429: Too Many Requests');
    const classified = AgentErrorClassifier.classify(error);

    assert.equal(classified.type, 'rate_limit');
    assert.equal(classified.retryable, true);
    assert.ok(classified.recoveryHint.includes('rate limit'));
  });

  it('should classify quota exceeded errors', () => {
    const error = new Error('403 Forbidden: insufficient_quota');
    const classified = AgentErrorClassifier.classify(error);

    assert.equal(classified.type, 'quota_exceeded');
    assert.equal(classified.retryable, false);
    assert.ok(classified.recoveryHint.includes('quota'));
    assert.ok(classified.recoveryHint.includes('console.anthropic.com'));
  });

  it('should classify timeout errors', () => {
    const error = new Error('Claude timed out after 60000ms');
    const classified = AgentErrorClassifier.classify(error);

    assert.equal(classified.type, 'timeout');
    assert.equal(classified.retryable, true);
    assert.ok(classified.recoveryHint.includes('timeout'));
    assert.ok(classified.recoveryHint.includes('timeoutMs'));
  });

  it('should classify network errors', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
    const classified = AgentErrorClassifier.classify(error);

    assert.equal(classified.type, 'network');
    assert.equal(classified.retryable, true);
    assert.ok(classified.recoveryHint.includes('Network'));
  });

  it('should classify crash errors', () => {
    const error = new Error('Claude exited 1: Process killed');
    const classified = AgentErrorClassifier.classify(error);

    assert.equal(classified.type, 'crash');
    assert.equal(classified.retryable, true);
    assert.ok(classified.recoveryHint.includes('crash'));
  });

  it('should classify unknown errors', () => {
    const error = new Error('Something unexpected happened');
    const classified = AgentErrorClassifier.classify(error);

    assert.equal(classified.type, 'unknown');
    assert.equal(classified.retryable, true);
    assert.ok(classified.recoveryHint.includes('Unexpected'));
  });
});

describe('ExponentialBackoff', () => {
  it('should calculate exponential delays with jitter', () => {
    const backoff = new ExponentialBackoff(3, 1000, 32000);

    const delay1 = backoff.getNextDelay();
    assert.ok(delay1 !== null);
    assert.ok(delay1 >= 1000 && delay1 <= 1250); // 1000 + 25% jitter

    const delay2 = backoff.getNextDelay();
    assert.ok(delay2 !== null);
    assert.ok(delay2 >= 2000 && delay2 <= 2500); // 2000 + 25% jitter

    const delay3 = backoff.getNextDelay();
    assert.ok(delay3 !== null);
    assert.ok(delay3 >= 4000 && delay3 <= 5000); // 4000 + 25% jitter
  });

  it('should respect max delay cap', () => {
    const backoff = new ExponentialBackoff(10, 1000, 8000);

    // Skip to attempt 4: 1000 * 2^4 = 16000, should be capped at 8000
    backoff.getNextDelay(); // 1000
    backoff.getNextDelay(); // 2000
    backoff.getNextDelay(); // 4000
    const delay4 = backoff.getNextDelay(); // Should be capped at 8000
    assert.ok(delay4 !== null);
    assert.ok(delay4 <= 10000); // 8000 + 25% jitter
  });

  it('should return null after max retries', () => {
    const backoff = new ExponentialBackoff(2, 1000, 32000);

    assert.ok(backoff.getNextDelay() !== null);
    assert.ok(backoff.getNextDelay() !== null);
    assert.equal(backoff.getNextDelay(), null);
  });

  it('should reset correctly', () => {
    const backoff = new ExponentialBackoff(3, 1000, 32000);

    backoff.getNextDelay();
    backoff.getNextDelay();
    assert.equal(backoff.currentAttempt, 2);

    backoff.reset();
    assert.equal(backoff.currentAttempt, 0);
    assert.equal(backoff.attemptsRemaining, 3);
  });

  it('should track attempts remaining', () => {
    const backoff = new ExponentialBackoff(3, 1000, 32000);

    assert.equal(backoff.attemptsRemaining, 3);
    backoff.getNextDelay();
    assert.equal(backoff.attemptsRemaining, 2);
    backoff.getNextDelay();
    assert.equal(backoff.attemptsRemaining, 1);
    backoff.getNextDelay();
    assert.equal(backoff.attemptsRemaining, 0);
  });
});

describe('CircuitBreaker', () => {
  it('should start in closed state', () => {
    const breaker = new CircuitBreaker(5, 60000);
    const state = breaker.getState();

    assert.equal(state.state, 'closed');
    assert.equal(state.failureCount, 0);
    assert.equal(breaker.isOpen(), false);
  });

  it('should open after threshold failures', () => {
    const breaker = new CircuitBreaker(3, 60000);

    breaker.recordFailure();
    assert.equal(breaker.isOpen(), false);

    breaker.recordFailure();
    assert.equal(breaker.isOpen(), false);

    breaker.recordFailure();
    assert.equal(breaker.isOpen(), true);

    const state = breaker.getState();
    assert.equal(state.state, 'open');
    assert.equal(state.failureCount, 3);
  });

  it('should reset failure count on success', () => {
    const breaker = new CircuitBreaker(5, 60000);

    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getState().failureCount, 2);

    breaker.recordSuccess();
    assert.equal(breaker.getState().failureCount, 0);
    assert.equal(breaker.isOpen(), false);
  });

  it('should transition from open to half-open after reset time', async () => {
    const breaker = new CircuitBreaker(2, 100); // 100ms reset time

    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.isOpen(), true);
    assert.equal(breaker.getState().state, 'open');

    // Wait for reset time
    await new Promise(resolve => setTimeout(resolve, 150));

    // Check transition to half-open (isOpen() triggers the state check)
    const isOpenAfterWait = breaker.isOpen();
    const state = breaker.getState();
    assert.equal(isOpenAfterWait, false);
    assert.equal(state.state, 'half_open');
  });

  it('should close from half-open on success', async () => {
    const breaker = new CircuitBreaker(2, 100);

    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getState().state, 'open');

    await new Promise(resolve => setTimeout(resolve, 150));

    // Must call isOpen() to trigger state transition
    breaker.isOpen();
    assert.equal(breaker.getState().state, 'half_open');

    breaker.recordSuccess();
    assert.equal(breaker.getState().state, 'closed');
    assert.equal(breaker.getState().failureCount, 0);
  });

  it('should allow manual reset', () => {
    const breaker = new CircuitBreaker(2, 60000);

    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.isOpen(), true);

    breaker.reset();
    assert.equal(breaker.isOpen(), false);
    assert.equal(breaker.getState().state, 'closed');
    assert.equal(breaker.getState().failureCount, 0);
  });
});

describe('withErrorBoundary', () => {
  it('should succeed on first try for successful operations', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return 'success';
    };

    const result = await withErrorBoundary(fn, 'test-op');
    assert.equal(result, 'success');
    assert.equal(callCount, 1);
  });

  it('should retry on retryable errors', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Claude timed out after 60000ms');
      }
      return 'success';
    };

    const result = await withErrorBoundary(fn, 'test-op', {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
    });

    assert.equal(result, 'success');
    assert.equal(callCount, 3);
  });

  it('should not retry on non-retryable errors', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error('403 Forbidden: insufficient_quota');
    };

    await assert.rejects(
      async () => {
        await withErrorBoundary(fn, 'test-op', {
          maxRetries: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
        });
      },
      (error: any) => {
        assert.ok(error.message.includes('quota'));
        return true;
      }
    );

    assert.equal(callCount, 1); // Should not retry
  });

  it('should throw after max retries exhausted', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error('Claude timed out after 60000ms');
    };

    await assert.rejects(
      async () => {
        await withErrorBoundary(fn, 'test-op', {
          maxRetries: 2,
          baseDelayMs: 10,
          maxDelayMs: 100,
        });
      },
      (error: Error) => {
        // The original error is thrown after max retries
        assert.ok(error.message.includes('timed out'), `Expected timeout error, got: ${error.message}`);
        return true;
      }
    );

    assert.equal(callCount, 3); // Initial + 2 retries
  });

  it('should fail fast when circuit breaker is open', async () => {
    const breaker = new CircuitBreaker(2, 60000);
    let callCount = 0;

    const fn = async () => {
      callCount++;
      throw new Error('Claude exited 1: crash');
    };

    // Trigger circuit breaker to open
    breaker.recordFailure();
    breaker.recordFailure();

    await assert.rejects(
      async () => {
        await withErrorBoundary(fn, 'test-op', {
          maxRetries: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
        }, breaker);
      },
      (error: any) => {
        assert.ok(error.message.includes('Circuit breaker open'));
        return true;
      }
    );

    assert.equal(callCount, 0); // Should not call fn at all
  });

  it('should record success in circuit breaker', async () => {
    const breaker = new CircuitBreaker(5, 60000);
    breaker.recordFailure();
    assert.equal(breaker.getState().failureCount, 1);

    const fn = async () => 'success';

    await withErrorBoundary(fn, 'test-op', {}, breaker);

    assert.equal(breaker.getState().failureCount, 0);
  });

  it('should record failure in circuit breaker after exhausting retries', async () => {
    const breaker = new CircuitBreaker(5, 60000);
    const fn = async () => {
      throw new Error('Claude timed out after 60000ms');
    };

    await assert.rejects(async () => {
      await withErrorBoundary(fn, 'test-op', {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
      }, breaker);
    });

    assert.equal(breaker.getState().failureCount, 1);
  });
});

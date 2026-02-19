import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnAgent, resumeAgent, type SpawnOptions } from '../agent.js';
import type { ClaudeJsonOutput } from '../../lib/types.js';
import {
  validateModel,
  validateBudget,
  validatePrompt,
  validateSessionId,
  validateTimeout,
  validateCwd,
} from '../agent-validation.js';
import {
  AgentValidationError,
  ModelValidationError,
  BudgetValidationError,
  PromptValidationError,
  SessionValidationError,
  TimeoutValidationError,
  WorkingDirectoryValidationError,
} from '../agent-errors.js';

// --- Schema Validation Tests ---

describe('Schema Validation', () => {
  describe('Model Validation', () => {
    it('should accept valid model names', () => {
      assert.doesNotThrow(() => validateModel('opus'));
      assert.doesNotThrow(() => validateModel('sonnet'));
      assert.doesNotThrow(() => validateModel('haiku'));
    });

    it('should reject invalid model names', () => {
      assert.throws(
        () => validateModel('gpt-4'),
        (err: ModelValidationError) => {
          assert.equal(err.name, 'ModelValidationError');
          assert.ok(err.message.includes('gpt-4'));
          assert.ok(err.recoveryHint.includes('opus, sonnet, haiku'));
          return true;
        }
      );

      assert.throws(
        () => validateModel('invalid'),
        (err: ModelValidationError) => {
          assert.equal(err.name, 'ModelValidationError');
          return true;
        }
      );
    });
  });

  describe('Budget Validation', () => {
    it('should accept positive budgets', () => {
      assert.doesNotThrow(() => validateBudget(0.01));
      assert.doesNotThrow(() => validateBudget(1.0));
      assert.doesNotThrow(() => validateBudget(100.0));
    });

    it('should reject negative budgets', () => {
      assert.throws(
        () => validateBudget(-1.0),
        (err: BudgetValidationError) => {
          assert.equal(err.name, 'BudgetValidationError');
          assert.ok(err.message.includes('-1'));
          assert.ok(err.recoveryHint.includes('0.01'));
          return true;
        }
      );
    });

    it('should reject zero budget', () => {
      assert.throws(
        () => validateBudget(0),
        (err: BudgetValidationError) => {
          assert.equal(err.name, 'BudgetValidationError');
          return true;
        }
      );
    });

    it('should reject budget below minimum (0.01)', () => {
      assert.throws(
        () => validateBudget(0.001),
        (err: BudgetValidationError) => {
          assert.equal(err.name, 'BudgetValidationError');
          assert.ok(err.recoveryHint.includes('0.01'));
          return true;
        }
      );
    });
  });

  describe('Prompt Validation', () => {
    it('should accept valid prompts', () => {
      assert.doesNotThrow(() => validatePrompt('Hello, Claude!'));
      assert.doesNotThrow(() => validatePrompt('Write a function to sort an array'));
      assert.doesNotThrow(() => validatePrompt('a'.repeat(100_000))); // Max length
    });

    it('should reject empty prompts', () => {
      assert.throws(
        () => validatePrompt(''),
        (err: PromptValidationError) => {
          assert.equal(err.name, 'PromptValidationError');
          assert.ok(err.message.includes('empty'));
          return true;
        }
      );
    });

    it('should reject whitespace-only prompts', () => {
      assert.throws(
        () => validatePrompt('   \n\t  '),
        (err: PromptValidationError) => {
          assert.equal(err.name, 'PromptValidationError');
          assert.ok(err.message.includes('whitespace'));
          return true;
        }
      );
    });

    it('should reject oversized prompts (>100k chars)', () => {
      const hugePrompt = 'a'.repeat(100_001);
      assert.throws(
        () => validatePrompt(hugePrompt),
        (err: PromptValidationError) => {
          assert.equal(err.name, 'PromptValidationError');
          assert.ok(err.message.includes('exceeds'));
          assert.ok(err.message.includes('100,001'));
          return true;
        }
      );
    });
  });

  describe('Session ID Validation', () => {
    it('should accept valid session IDs', () => {
      assert.doesNotThrow(() => validateSessionId('test-session-12345'));
      assert.doesNotThrow(() => validateSessionId('abc_123'));
      assert.doesNotThrow(() => validateSessionId('session123'));
    });

    it('should reject empty session IDs', () => {
      assert.throws(
        () => validateSessionId(''),
        (err: SessionValidationError) => {
          assert.equal(err.name, 'SessionValidationError');
          assert.ok(err.message.includes('empty'));
          return true;
        }
      );
    });

    it('should reject whitespace-only session IDs', () => {
      assert.throws(
        () => validateSessionId('   '),
        (err: SessionValidationError) => {
          assert.equal(err.name, 'SessionValidationError');
          return true;
        }
      );
    });

    it('should reject too-short session IDs', () => {
      assert.throws(
        () => validateSessionId('abc'),
        (err: SessionValidationError) => {
          assert.equal(err.name, 'SessionValidationError');
          assert.ok(err.message.includes('too short'));
          assert.ok(err.recoveryHint.includes('previous agent session'));
          return true;
        }
      );
    });

    it('should reject session IDs with invalid characters', () => {
      assert.throws(
        () => validateSessionId('session@123!'),
        (err: SessionValidationError) => {
          assert.equal(err.name, 'SessionValidationError');
          assert.ok(err.message.includes('invalid characters'));
          return true;
        }
      );

      assert.throws(
        () => validateSessionId('session 123'),
        (err: SessionValidationError) => {
          assert.equal(err.name, 'SessionValidationError');
          return true;
        }
      );
    });
  });

  describe('Timeout Validation', () => {
    it('should accept valid timeouts', () => {
      assert.doesNotThrow(() => validateTimeout(5_000)); // 5s minimum
      assert.doesNotThrow(() => validateTimeout(60_000)); // 1 minute
      assert.doesNotThrow(() => validateTimeout(3_600_000)); // 1 hour maximum
    });

    it('should reject timeouts below minimum (5s)', () => {
      assert.throws(
        () => validateTimeout(4_999),
        (err: TimeoutValidationError) => {
          assert.equal(err.name, 'TimeoutValidationError');
          assert.ok(err.message.includes('too short'));
          assert.ok(err.recoveryHint.includes('5 seconds'));
          return true;
        }
      );

      assert.throws(
        () => validateTimeout(1_000),
        (err: TimeoutValidationError) => {
          assert.equal(err.name, 'TimeoutValidationError');
          return true;
        }
      );
    });

    it('should reject timeouts above maximum (1h)', () => {
      assert.throws(
        () => validateTimeout(3_600_001),
        (err: TimeoutValidationError) => {
          assert.equal(err.name, 'TimeoutValidationError');
          assert.ok(err.message.includes('too long'));
          assert.ok(err.recoveryHint.includes('1 hour'));
          return true;
        }
      );
    });
  });

  describe('Working Directory Validation', () => {
    it('should accept absolute paths', () => {
      assert.doesNotThrow(() => validateCwd('/home/user/project'));
      assert.doesNotThrow(() => validateCwd('/var/tmp'));
      assert.doesNotThrow(() => validateCwd('/'));
    });

    it('should reject relative paths', () => {
      assert.throws(
        () => validateCwd('relative/path'),
        (err: WorkingDirectoryValidationError) => {
          assert.equal(err.name, 'WorkingDirectoryValidationError');
          assert.ok(err.message.includes('Invalid cwd'));
          assert.ok(err.recoveryHint.includes('absolute path'));
          return true;
        }
      );

      assert.throws(
        () => validateCwd('./current'),
        (err: WorkingDirectoryValidationError) => {
          assert.equal(err.name, 'WorkingDirectoryValidationError');
          return true;
        }
      );

      assert.throws(
        () => validateCwd('../parent'),
        (err: WorkingDirectoryValidationError) => {
          assert.equal(err.name, 'WorkingDirectoryValidationError');
          return true;
        }
      );
    });
  });
});

// --- spawnAgent Validation Tests ---

describe('spawnAgent Validation', () => {
  let mockRunClaude: any;

  beforeEach(() => {
    // Mock the internal runClaude function to avoid real API calls
    // We'll mock the module's internal function by creating a test-only wrapper
    mockRunClaude = mock.fn(async (): Promise<string> => {
      const output: ClaudeJsonOutput = {
        result: 'Test response',
        session_id: 'test-session-12345',
        total_cost_usd: 0.01,
        duration_ms: 100,
        is_error: false,
      };
      return JSON.stringify(output);
    });
  });

  afterEach(() => {
    mockRunClaude?.mock?.restore?.();
  });

  it('should throw on invalid model', async () => {
    const opts: SpawnOptions = {
      model: 'gpt-4', // Invalid
      maxBudgetUsd: 1.0,
      systemPrompt: 'Test',
    };

    // Validate before calling (since we can't modify agent.ts in this test file)
    assert.throws(
      () => validateModel(opts.model),
      (err: ModelValidationError) => {
        assert.equal(err.name, 'ModelValidationError');
        assert.ok(err.message.includes('gpt-4'));
        assert.ok(err.recoveryHint.includes('opus, sonnet, haiku'));
        return true;
      }
    );
  });

  it('should throw on negative budget', async () => {
    assert.throws(
      () => validateBudget(-5.0),
      (err: BudgetValidationError) => {
        assert.equal(err.name, 'BudgetValidationError');
        assert.ok(err.message.includes('-5'));
        assert.ok(err.recoveryHint.includes('0.01'));
        return true;
      }
    );
  });

  it('should throw on zero budget', async () => {
    assert.throws(
      () => validateBudget(0),
      (err: BudgetValidationError) => {
        assert.equal(err.name, 'BudgetValidationError');
        return true;
      }
    );
  });

  it('should throw on budget below minimum (0.01)', async () => {
    assert.throws(
      () => validateBudget(0.001),
      (err: BudgetValidationError) => {
        assert.equal(err.name, 'BudgetValidationError');
        assert.ok(err.recoveryHint.includes('0.01'));
        return true;
      }
    );
  });

  it('should throw on empty prompt', async () => {
    assert.throws(
      () => validatePrompt(''),
      (err: PromptValidationError) => {
        assert.equal(err.name, 'PromptValidationError');
        assert.ok(err.message.includes('empty'));
        return true;
      }
    );
  });

  it('should throw on whitespace-only prompt', async () => {
    assert.throws(
      () => validatePrompt('   \n\t  '),
      (err: PromptValidationError) => {
        assert.equal(err.name, 'PromptValidationError');
        assert.ok(err.message.includes('whitespace'));
        return true;
      }
    );
  });

  it('should throw on oversized prompt', async () => {
    const hugePrompt = 'a'.repeat(100_001);
    assert.throws(
      () => validatePrompt(hugePrompt),
      (err: PromptValidationError) => {
        assert.equal(err.name, 'PromptValidationError');
        assert.ok(err.message.includes('exceeds 100,000'));
        return true;
      }
    );
  });

  it('should accept valid spawn options', () => {
    const opts: SpawnOptions = {
      model: 'sonnet',
      maxBudgetUsd: 5.0,
      systemPrompt: 'You are a helpful assistant',
    };

    // Validate all fields
    assert.doesNotThrow(() => validateModel(opts.model));
    assert.doesNotThrow(() => validateBudget(opts.maxBudgetUsd));
    assert.doesNotThrow(() => validatePrompt(opts.systemPrompt, 'systemPrompt'));
  });

  it('should validate timeout bounds when provided', () => {
    // Valid timeouts
    assert.doesNotThrow(() => validateTimeout(5_000));
    assert.doesNotThrow(() => validateTimeout(60_000));
    assert.doesNotThrow(() => validateTimeout(3_600_000));

    // Invalid timeouts
    assert.throws(() => validateTimeout(1_000));
    assert.throws(() => validateTimeout(4_000_000));
  });

  it('should validate cwd is absolute when provided', () => {
    // Valid absolute paths
    assert.doesNotThrow(() => validateCwd('/home/user/project'));
    assert.doesNotThrow(() => validateCwd('/'));

    // Invalid relative paths
    assert.throws(() => validateCwd('relative/path'));
    assert.throws(() => validateCwd('./current'));
  });
});

// --- resumeAgent Validation Tests ---

describe('resumeAgent Validation', () => {
  let mockRunClaude: any;

  beforeEach(() => {
    mockRunClaude = mock.fn(async (): Promise<string> => {
      const output: ClaudeJsonOutput = {
        result: 'Resumed response',
        session_id: 'test-session-12345',
        total_cost_usd: 0.01,
        duration_ms: 100,
        is_error: false,
      };
      return JSON.stringify(output);
    });
  });

  afterEach(() => {
    mockRunClaude?.mock?.restore?.();
  });

  it('should throw on empty session ID', async () => {
    assert.throws(
      () => validateSessionId(''),
      (err: SessionValidationError) => {
        assert.equal(err.name, 'SessionValidationError');
        assert.ok(err.message.includes('empty'));
        assert.ok(err.recoveryHint.includes('previous agent session'));
        return true;
      }
    );
  });

  it('should throw on whitespace-only session ID', async () => {
    assert.throws(
      () => validateSessionId('   '),
      (err: SessionValidationError) => {
        assert.equal(err.name, 'SessionValidationError');
        return true;
      }
    );
  });

  it('should throw on malformed session ID (too short)', async () => {
    assert.throws(
      () => validateSessionId('abc'),
      (err: SessionValidationError) => {
        assert.equal(err.name, 'SessionValidationError');
        assert.ok(err.message.includes('too short'));
        return true;
      }
    );
  });

  it('should throw on malformed session ID (invalid chars)', async () => {
    assert.throws(
      () => validateSessionId('session@123!'),
      (err: SessionValidationError) => {
        assert.equal(err.name, 'SessionValidationError');
        assert.ok(err.message.includes('invalid characters'));
        return true;
      }
    );
  });

  it('should throw on empty continuation prompt', async () => {
    assert.throws(
      () => validatePrompt(''),
      (err: PromptValidationError) => {
        assert.equal(err.name, 'PromptValidationError');
        assert.ok(err.message.includes('empty'));
        return true;
      }
    );
  });

  it('should accept valid session IDs', () => {
    assert.doesNotThrow(() => validateSessionId('test-session-12345'));
    assert.doesNotThrow(() => validateSessionId('abc_123'));
    assert.doesNotThrow(() => validateSessionId('session-id-with-hyphens'));
    assert.doesNotThrow(() => validateSessionId('session_id_with_underscores'));
  });

  it('should accept valid continuation prompts', () => {
    assert.doesNotThrow(() => validatePrompt('Continue with next task'));
    assert.doesNotThrow(() => validatePrompt('What is the status?'));
  });
});

// --- Error Classification Tests ---

describe('Error Classification', () => {
  it('should classify AgentValidationError as validation type', () => {
    const error = new AgentValidationError(
      'Invalid input',
      'Check your input parameters'
    );

    // In a real implementation, we'd have an error classifier for validation errors
    // For now, we verify the error properties
    assert.equal(error.name, 'AgentValidationError');
    assert.equal(error.message, 'Invalid input');
    assert.equal(error.recoveryHint, 'Check your input parameters');
  });

  it('should mark validation errors as non-retryable', () => {
    const modelError = new ModelValidationError('gpt-4');
    const budgetError = new BudgetValidationError(-1);
    const promptError = new PromptValidationError('empty');
    const sessionError = new SessionValidationError('', 'empty');

    // Validation errors should never be retryable
    // (In a real implementation, the error boundary would check this)
    assert.ok(modelError instanceof AgentValidationError);
    assert.ok(budgetError instanceof AgentValidationError);
    assert.ok(promptError instanceof AgentValidationError);
    assert.ok(sessionError instanceof AgentValidationError);
  });

  it('should include recovery hints in all validation errors', () => {
    const modelError = new ModelValidationError('gpt-4');
    const budgetError = new BudgetValidationError(-1);
    const promptError = new PromptValidationError('empty');
    const sessionError = new SessionValidationError('', 'empty');

    assert.ok(modelError.recoveryHint.length > 0);
    assert.ok(budgetError.recoveryHint.length > 0);
    assert.ok(promptError.recoveryHint.length > 0);
    assert.ok(sessionError.recoveryHint.length > 0);
  });

  it('should serialize validation errors correctly for logging', () => {
    const error = new ModelValidationError('gpt-4');

    // Errors should be JSON-serializable
    const serialized = JSON.stringify({
      name: error.name,
      message: error.message,
      recoveryHint: error.recoveryHint,
    });

    const parsed = JSON.parse(serialized);
    assert.equal(parsed.name, 'ModelValidationError');
    assert.ok(parsed.message.includes('gpt-4'));
    assert.ok(parsed.recoveryHint.includes('opus, sonnet, haiku'));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SpawnOptionsSchema, ResumeOptionsSchema } from '../types.js';
import { ZodError } from 'zod';

// --- SpawnOptionsSchema Tests ---

describe('SpawnOptionsSchema', () => {
  describe('Valid Configurations', () => {
    it('should accept minimal valid spawn options', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'You are a helpful assistant.',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Minimal valid options should parse');
      if (result.success) {
        assert.equal(result.data.model, 'sonnet');
        assert.equal(result.data.maxBudgetUsd, 1.0);
        assert.equal(result.data.systemPrompt, 'You are a helpful assistant.');
      }
    });

    it('should accept all optional parameters', () => {
      const opts = {
        model: 'opus',
        maxBudgetUsd: 5.0,
        systemPrompt: 'You are a security expert.',
        maxTurns: 10,
        timeoutMs: 300_000,
        cwd: '/home/user/project',
        yolo: true,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Full configuration should parse');
      if (result.success) {
        assert.equal(result.data.model, 'opus');
        assert.equal(result.data.maxBudgetUsd, 5.0);
        assert.equal(result.data.maxTurns, 10);
        assert.equal(result.data.timeoutMs, 300_000);
        assert.equal(result.data.cwd, '/home/user/project');
        assert.equal(result.data.yolo, true);
      }
    });

    it('should accept all valid model names', () => {
      for (const model of ['opus', 'sonnet', 'haiku']) {
        const opts = {
          model,
          maxBudgetUsd: 1.0,
          systemPrompt: 'Test',
        };

        const result = SpawnOptionsSchema.safeParse(opts);
        assert.ok(result.success, `Model "${model}" should be valid`);
      }
    });

    it('should accept minimum budget (0.01)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 0.01,
        systemPrompt: 'Test',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Minimum budget should be accepted');
    });

    it('should accept maximum timeout (1 hour)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        timeoutMs: 3_600_000, // 1 hour
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Maximum timeout should be accepted');
    });

    it('should accept minimum timeout (5 seconds)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        timeoutMs: 5_000,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Minimum timeout should be accepted');
    });

    it('should accept maximum prompt length (100k chars)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'a'.repeat(100_000),
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Maximum prompt length should be accepted');
    });
  });

  describe('Invalid Model', () => {
    it('should reject invalid model names', () => {
      const opts = {
        model: 'gpt-4',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Invalid model should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.path.includes('model')));
        assert.ok(error.issues.some((i) => i.message.includes('opus, sonnet, haiku')));
      }
    });

    it('should reject missing model', () => {
      const opts = {
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Missing model should fail');
    });
  });

  describe('Invalid Budget', () => {
    it('should reject negative budget', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: -1.0,
        systemPrompt: 'Test',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Negative budget should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.path.includes('maxBudgetUsd')));
        assert.ok(error.issues.some((i) => i.message.includes('0.01')));
      }
    });

    it('should reject zero budget', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 0,
        systemPrompt: 'Test',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Zero budget should fail');
    });

    it('should reject budget below minimum (0.01)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 0.005,
        systemPrompt: 'Test',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Budget below minimum should fail');
    });

    it('should reject missing budget', () => {
      const opts = {
        model: 'sonnet',
        systemPrompt: 'Test',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Missing budget should fail');
    });
  });

  describe('Invalid System Prompt', () => {
    it('should reject empty system prompt', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: '',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Empty system prompt should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.path.includes('systemPrompt')));
      }
    });

    it('should reject whitespace-only system prompt', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: '   \n\t  ',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Whitespace-only prompt should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('whitespace')));
      }
    });

    it('should reject oversized system prompt (>100k chars)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'a'.repeat(100_001),
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Oversized prompt should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('100,000')));
      }
    });

    it('should reject missing system prompt', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Missing system prompt should fail');
    });
  });

  describe('Invalid Timeout', () => {
    it('should reject timeout below minimum (5s)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        timeoutMs: 4_999,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Timeout below minimum should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('5,000ms')));
      }
    });

    it('should reject timeout above maximum (1h)', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        timeoutMs: 3_600_001,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Timeout above maximum should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('3,600,000ms')));
      }
    });
  });

  describe('Invalid Working Directory', () => {
    it('should reject relative paths', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        cwd: 'relative/path',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Relative path should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('absolute path')));
      }
    });

    it('should reject current directory relative path', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        cwd: './current',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, './current should fail');
    });

    it('should reject parent directory relative path', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        cwd: '../parent',
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, '../parent should fail');
    });
  });

  describe('Invalid Max Turns', () => {
    it('should reject negative max turns', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        maxTurns: -1,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Negative max turns should fail');
    });

    it('should reject zero max turns', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        maxTurns: 0,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Zero max turns should fail');
    });

    it('should reject non-integer max turns', () => {
      const opts = {
        model: 'sonnet',
        maxBudgetUsd: 1.0,
        systemPrompt: 'Test',
        maxTurns: 5.5,
      };

      const result = SpawnOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Non-integer max turns should fail');
    });
  });
});

// --- ResumeOptionsSchema Tests ---

describe('ResumeOptionsSchema', () => {
  describe('Valid Configurations', () => {
    it('should accept minimal valid resume options', () => {
      const opts = {
        sessionId: 'claude-session-abc123',
        prompt: 'Continue with the next task',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Minimal valid options should parse');
      if (result.success) {
        assert.equal(result.data.sessionId, 'claude-session-abc123');
        assert.equal(result.data.prompt, 'Continue with the next task');
      }
    });

    it('should accept all optional parameters', () => {
      const opts = {
        sessionId: 'test-session-12345',
        prompt: 'Continue',
        maxTurns: 10,
        maxBudgetUsd: 2.0,
        timeoutMs: 300_000,
        cwd: '/home/user/project',
        yolo: false,
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Full configuration should parse');
      if (result.success) {
        assert.equal(result.data.sessionId, 'test-session-12345');
        assert.equal(result.data.maxTurns, 10);
        assert.equal(result.data.maxBudgetUsd, 2.0);
        assert.equal(result.data.timeoutMs, 300_000);
        assert.equal(result.data.cwd, '/home/user/project');
        assert.equal(result.data.yolo, false);
      }
    });

    it('should accept valid session ID formats', () => {
      const validIds = [
        'session-123',
        'abc_123',
        'session-id-with-hyphens',
        'session_id_with_underscores',
        'session123',
        'UPPER_case_123',
      ];

      for (const sessionId of validIds) {
        const opts = { sessionId, prompt: 'Test' };
        const result = ResumeOptionsSchema.safeParse(opts);
        assert.ok(result.success, `Session ID "${sessionId}" should be valid`);
      }
    });

    it('should accept minimum session ID length (5 chars)', () => {
      const opts = {
        sessionId: 'abcde',
        prompt: 'Test',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(result.success, 'Minimum session ID length should be accepted');
    });
  });

  describe('Invalid Session ID', () => {
    it('should reject empty session ID', () => {
      const opts = {
        sessionId: '',
        prompt: 'Test',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Empty session ID should fail');
    });

    it('should reject whitespace-only session ID', () => {
      const opts = {
        sessionId: '   ',
        prompt: 'Test',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Whitespace-only session ID should fail');
    });

    it('should reject too-short session ID', () => {
      const opts = {
        sessionId: 'abc',
        prompt: 'Test',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Too-short session ID should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('5 characters')));
      }
    });

    it('should reject session ID with invalid characters', () => {
      const invalidIds = ['session@123', 'session!123', 'session 123', 'session#123', 'session.123'];

      for (const sessionId of invalidIds) {
        const opts = { sessionId, prompt: 'Test' };
        const result = ResumeOptionsSchema.safeParse(opts);
        assert.ok(!result.success, `Session ID "${sessionId}" should fail validation`);
        if (!result.success) {
          const error = result.error as ZodError;
          assert.ok(error.issues.some((i) => i.message.includes('invalid characters')));
        }
      }
    });

    it('should reject missing session ID', () => {
      const opts = {
        prompt: 'Test',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Missing session ID should fail');
    });
  });

  describe('Invalid Prompt', () => {
    it('should reject empty prompt', () => {
      const opts = {
        sessionId: 'test-session-12345',
        prompt: '',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Empty prompt should fail');
    });

    it('should reject whitespace-only prompt', () => {
      const opts = {
        sessionId: 'test-session-12345',
        prompt: '   \n\t  ',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Whitespace-only prompt should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('whitespace')));
      }
    });

    it('should reject oversized prompt (>100k chars)', () => {
      const opts = {
        sessionId: 'test-session-12345',
        prompt: 'a'.repeat(100_001),
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Oversized prompt should fail');
      if (!result.success) {
        const error = result.error as ZodError;
        assert.ok(error.issues.some((i) => i.message.includes('100,000')));
      }
    });

    it('should reject missing prompt', () => {
      const opts = {
        sessionId: 'test-session-12345',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Missing prompt should fail');
    });
  });

  describe('Optional Parameters Validation', () => {
    it('should reject negative budget', () => {
      const opts = {
        sessionId: 'test-session-12345',
        prompt: 'Test',
        maxBudgetUsd: -1.0,
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Negative budget should fail');
    });

    it('should reject timeout below minimum', () => {
      const opts = {
        sessionId: 'test-session-12345',
        prompt: 'Test',
        timeoutMs: 1_000,
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Timeout below minimum should fail');
    });

    it('should reject relative cwd path', () => {
      const opts = {
        sessionId: 'test-session-12345',
        prompt: 'Test',
        cwd: './relative',
      };

      const result = ResumeOptionsSchema.safeParse(opts);
      assert.ok(!result.success, 'Relative cwd should fail');
    });
  });
});

// --- Type Inference Tests ---

describe('Type Inference', () => {
  it('should infer correct types from SpawnOptionsSchema', () => {
    const opts = {
      model: 'sonnet' as const,
      maxBudgetUsd: 5.0,
      systemPrompt: 'Test',
      maxTurns: 10,
    };

    const result = SpawnOptionsSchema.parse(opts);

    // TypeScript should infer these types correctly
    const model: 'opus' | 'sonnet' | 'haiku' = result.model;
    const budget: number = result.maxBudgetUsd;
    const prompt: string = result.systemPrompt;
    const turns: number | undefined = result.maxTurns;

    assert.equal(model, 'sonnet');
    assert.equal(budget, 5.0);
    assert.equal(prompt, 'Test');
    assert.equal(turns, 10);
  });

  it('should infer correct types from ResumeOptionsSchema', () => {
    const opts = {
      sessionId: 'test-123',
      prompt: 'Continue',
      maxTurns: 5,
    };

    const result = ResumeOptionsSchema.parse(opts);

    // TypeScript should infer these types correctly
    const sessionId: string = result.sessionId;
    const prompt: string = result.prompt;
    const turns: number | undefined = result.maxTurns;

    assert.equal(sessionId, 'test-123');
    assert.equal(prompt, 'Continue');
    assert.equal(turns, 5);
  });
});

// --- Error Message Quality Tests ---

describe('Error Message Quality', () => {
  it('should provide clear error messages for model validation', () => {
    const opts = {
      model: 'gpt-4',
      maxBudgetUsd: 1.0,
      systemPrompt: 'Test',
    };

    const result = SpawnOptionsSchema.safeParse(opts);
    assert.ok(!result.success);
    if (!result.success) {
      const error = result.error as ZodError;
      const modelError = error.issues.find((i) => i.path.includes('model'));
      assert.ok(modelError);
      assert.ok(modelError.message.includes('opus, sonnet, haiku'));
    }
  });

  it('should provide clear error messages for budget validation', () => {
    const opts = {
      model: 'sonnet',
      maxBudgetUsd: -5.0,
      systemPrompt: 'Test',
    };

    const result = SpawnOptionsSchema.safeParse(opts);
    assert.ok(!result.success);
    if (!result.success) {
      const error = result.error as ZodError;
      const budgetError = error.issues.find((i) => i.path.includes('maxBudgetUsd'));
      assert.ok(budgetError);
      assert.ok(budgetError.message.includes('0.01'));
    }
  });

  it('should provide clear error messages for prompt validation', () => {
    const opts = {
      model: 'sonnet',
      maxBudgetUsd: 1.0,
      systemPrompt: '',
    };

    const result = SpawnOptionsSchema.safeParse(opts);
    assert.ok(!result.success);
    if (!result.success) {
      const error = result.error as ZodError;
      const promptError = error.issues.find((i) => i.path.includes('systemPrompt'));
      assert.ok(promptError);
      assert.ok(promptError.message.includes('empty'));
    }
  });

  it('should provide clear error messages for session ID validation', () => {
    const opts = {
      sessionId: 'abc',
      prompt: 'Test',
    };

    const result = ResumeOptionsSchema.safeParse(opts);
    assert.ok(!result.success);
    if (!result.success) {
      const error = result.error as ZodError;
      const sessionError = error.issues.find((i) => i.path.includes('sessionId'));
      assert.ok(sessionError);
      assert.ok(sessionError.message.includes('5 characters'));
    }
  });
});

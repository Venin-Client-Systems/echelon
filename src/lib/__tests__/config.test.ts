import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { logger } from '../logger.ts';

const TEST_DIR = join(process.cwd(), '.test-tmp');
const TEST_CONFIG_PATH = join(TEST_DIR, 'test-config.json');

describe('loadConfig', () => {
  beforeEach(() => {
    // Create test directory
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should load and validate a valid config file', () => {
    const validConfig = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
        baseBranch: 'main',
      },
      layers: {
        '2ic': { model: 'sonnet', maxBudgetUsd: 5.0, timeoutMs: 300000 },
        'eng-lead': { model: 'opus', maxBudgetUsd: 10.0, timeoutMs: 300000 },
        'team-lead': { model: 'haiku', maxBudgetUsd: 3.0, timeoutMs: 300000 },
      },
      engineers: {
        maxParallel: 3,
        createPr: true,
        prDraft: true,
      },
      approvalMode: 'destructive',
      maxTotalBudgetUsd: 50.0,
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(validConfig, null, 2), 'utf-8');

    const config = loadConfig(TEST_CONFIG_PATH);

    assert.equal(config.project.repo, 'owner/repo');
    assert.equal(config.project.path, '/path/to/repo');
    assert.equal(config.project.baseBranch, 'main');
    assert.equal(config.layers['2ic'].model, 'sonnet');
    assert.equal(config.layers['eng-lead'].model, 'opus');
    assert.equal(config.layers['team-lead'].model, 'haiku');
    assert.equal(config.engineers.maxParallel, 3);
    assert.equal(config.approvalMode, 'destructive');
    assert.equal(config.maxTotalBudgetUsd, 50.0);
  });

  it('should apply defaults for optional fields', () => {
    const minimalConfig = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(minimalConfig, null, 2), 'utf-8');

    const config = loadConfig(TEST_CONFIG_PATH);

    // Check defaults are applied
    assert.equal(config.project.baseBranch, 'main');
    assert.equal(config.layers['2ic'].model, 'sonnet');
    assert.equal(config.layers['2ic'].maxBudgetUsd, 5.0);
    assert.equal(config.layers['2ic'].timeoutMs, 300000);
    assert.equal(config.engineers.maxParallel, 3);
    assert.equal(config.engineers.createPr, true);
    assert.equal(config.engineers.prDraft, true);
    assert.equal(config.approvalMode, 'destructive');
    assert.equal(config.maxTotalBudgetUsd, 50.0);
  });

  it('should throw on invalid config - missing required fields', () => {
    const invalidConfig = {
      // Missing required 'project' field
      approvalMode: 'all',
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig, null, 2), 'utf-8');

    assert.throws(
      () => loadConfig(TEST_CONFIG_PATH),
      (error: any) => {
        assert.ok(error.message.includes('Required') || error.issues);
        return true;
      },
      'Should throw validation error for missing required fields'
    );
  });

  it('should throw on invalid config - invalid repo format', () => {
    const invalidConfig = {
      project: {
        repo: 'invalid-repo-format', // Should be 'owner/repo'
        path: '/path/to/repo',
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig, null, 2), 'utf-8');

    assert.throws(
      () => loadConfig(TEST_CONFIG_PATH),
      (error: any) => {
        assert.ok(error.message.includes('owner/repo') || error.issues);
        return true;
      },
      'Should throw validation error for invalid repo format'
    );
  });

  it('should throw on invalid config - invalid model', () => {
    const invalidConfig = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
      layers: {
        '2ic': { model: 'gpt-4' }, // Invalid model
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig, null, 2), 'utf-8');

    assert.throws(
      () => loadConfig(TEST_CONFIG_PATH),
      (error: any) => {
        return true;
      },
      'Should throw validation error for invalid model'
    );
  });

  it('should throw on invalid config - negative budget', () => {
    const invalidConfig = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
      maxTotalBudgetUsd: -10, // Must be positive
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig, null, 2), 'utf-8');

    assert.throws(
      () => loadConfig(TEST_CONFIG_PATH),
      (error: any) => {
        return true;
      },
      'Should throw validation error for negative budget'
    );
  });

  it('should log warning when haiku model is used', () => {
    const configWithHaiku = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
      layers: {
        '2ic': { model: 'haiku' },
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithHaiku, null, 2), 'utf-8');

    // Mock logger.warn to capture warning
    const originalWarn = logger.warn;
    let warnCalled = false;
    let warnMessage = '';

    logger.warn = (msg: string) => {
      warnCalled = true;
      warnMessage = msg;
    };

    try {
      loadConfig(TEST_CONFIG_PATH);

      assert.ok(warnCalled, 'logger.warn should be called when haiku is used');
      assert.ok(
        warnMessage.toLowerCase().includes('haiku'),
        'Warning message should mention haiku'
      );
    } finally {
      // Restore original logger
      logger.warn = originalWarn;
    }
  });

  it('should handle config without telegram (backwards compatible)', () => {
    const configWithoutTelegram = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithoutTelegram, null, 2), 'utf-8');

    const config = loadConfig(TEST_CONFIG_PATH);

    assert.equal(config.telegram, undefined, 'Telegram config should be undefined when not provided');
  });

  it('should load telegram config with defaults', () => {
    const configWithTelegram = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
      telegram: {
        token: 'test-token',
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithTelegram, null, 2), 'utf-8');

    const config = loadConfig(TEST_CONFIG_PATH);

    assert.ok(config.telegram);
    assert.equal(config.telegram.token, 'test-token');
    assert.deepEqual(config.telegram.allowedUserIds, []);
    assert.equal(config.telegram.health, undefined, 'Health should be undefined when not provided');
  });

  it('should load telegram health config with defaults', () => {
    const configWithHealth = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
      telegram: {
        token: 'test-token',
        health: {},
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithHealth, null, 2), 'utf-8');

    const config = loadConfig(TEST_CONFIG_PATH);

    assert.ok(config.telegram?.health);
    assert.equal(config.telegram.health.enabled, false);
    assert.equal(config.telegram.health.port, 3000);
    assert.equal(config.telegram.health.bindAddress, '0.0.0.0');
  });

  it('should override telegram health config from environment variables', () => {
    const originalEnv = {
      ECHELON_HEALTH_ENABLED: process.env.ECHELON_HEALTH_ENABLED,
      ECHELON_HEALTH_PORT: process.env.ECHELON_HEALTH_PORT,
      ECHELON_HEALTH_BIND: process.env.ECHELON_HEALTH_BIND,
    };

    try {
      process.env.ECHELON_HEALTH_ENABLED = 'true';
      process.env.ECHELON_HEALTH_PORT = '8080';
      process.env.ECHELON_HEALTH_BIND = '127.0.0.1';

      const configWithHealth = {
        project: {
          repo: 'owner/repo',
          path: '/path/to/repo',
        },
        telegram: {
          token: 'test-token',
          health: {
            enabled: false,
            port: 3000,
            bindAddress: '0.0.0.0',
          },
        },
      };

      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithHealth, null, 2), 'utf-8');

      const config = loadConfig(TEST_CONFIG_PATH);

      assert.ok(config.telegram?.health);
      assert.equal(config.telegram.health.enabled, true, 'Should override enabled from env');
      assert.equal(config.telegram.health.port, 8080, 'Should override port from env');
      assert.equal(config.telegram.health.bindAddress, '127.0.0.1', 'Should override bindAddress from env');
    } finally {
      // Restore original environment
      process.env.ECHELON_HEALTH_ENABLED = originalEnv.ECHELON_HEALTH_ENABLED;
      process.env.ECHELON_HEALTH_PORT = originalEnv.ECHELON_HEALTH_PORT;
      process.env.ECHELON_HEALTH_BIND = originalEnv.ECHELON_HEALTH_BIND;
    }
  });

  it('should throw on invalid health port - too low', () => {
    const invalidConfig = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
      telegram: {
        token: 'test-token',
        health: {
          port: 0,
        },
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig, null, 2), 'utf-8');

    assert.throws(
      () => loadConfig(TEST_CONFIG_PATH),
      (error: any) => {
        return true;
      },
      'Should throw validation error for port < 1'
    );
  });

  it('should throw on invalid health port - too high', () => {
    const invalidConfig = {
      project: {
        repo: 'owner/repo',
        path: '/path/to/repo',
      },
      telegram: {
        token: 'test-token',
        health: {
          port: 65536,
        },
      },
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig, null, 2), 'utf-8');

    assert.throws(
      () => loadConfig(TEST_CONFIG_PATH),
      (error: any) => {
        return true;
      },
      'Should throw validation error for port > 65535'
    );
  });

  it('should allow valid health port range', () => {
    // Clean up any environment variables from previous tests
    const originalEnv = {
      ECHELON_HEALTH_ENABLED: process.env.ECHELON_HEALTH_ENABLED,
      ECHELON_HEALTH_PORT: process.env.ECHELON_HEALTH_PORT,
      ECHELON_HEALTH_BIND: process.env.ECHELON_HEALTH_BIND,
    };

    try {
      delete process.env.ECHELON_HEALTH_ENABLED;
      delete process.env.ECHELON_HEALTH_PORT;
      delete process.env.ECHELON_HEALTH_BIND;

      const validConfig = {
        project: {
          repo: 'owner/repo',
          path: '/path/to/repo',
        },
        telegram: {
          token: 'test-token',
          health: {
            enabled: true,
            port: 8080,
            bindAddress: 'localhost',
          },
        },
      };

      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(validConfig, null, 2), 'utf-8');

      const config = loadConfig(TEST_CONFIG_PATH);

      assert.ok(config.telegram?.health);
      assert.equal(config.telegram.health.enabled, true);
      assert.equal(config.telegram.health.port, 8080);
      assert.equal(config.telegram.health.bindAddress, 'localhost');
    } finally {
      // Restore original environment
      if (originalEnv.ECHELON_HEALTH_ENABLED !== undefined) {
        process.env.ECHELON_HEALTH_ENABLED = originalEnv.ECHELON_HEALTH_ENABLED;
      }
      if (originalEnv.ECHELON_HEALTH_PORT !== undefined) {
        process.env.ECHELON_HEALTH_PORT = originalEnv.ECHELON_HEALTH_PORT;
      }
      if (originalEnv.ECHELON_HEALTH_BIND !== undefined) {
        process.env.ECHELON_HEALTH_BIND = originalEnv.ECHELON_HEALTH_BIND;
      }
    }
  });
});

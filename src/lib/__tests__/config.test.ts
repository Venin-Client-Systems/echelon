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
});

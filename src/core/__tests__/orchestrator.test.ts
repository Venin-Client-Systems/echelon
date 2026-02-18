import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import { spawnAgent, resumeAgent } from '../agent.js';
import { ActionExecutor } from '../action-executor.js';
import { saveState, createState } from '../state.js';
import type { EchelonConfig, EchelonState, CliOptions } from '../../lib/types.js';
import type { AgentResponse } from '../agent.js';
import { logger } from '../../lib/logger.js';

// Mock all dependencies
vi.mock('../agent.js', () => ({
  spawnAgent: vi.fn(),
  resumeAgent: vi.fn(),
}));

vi.mock('../state.js', async () => {
  const actual = await vi.importActual<typeof import('../state.js')>('../state.js');
  return {
    ...actual,
    saveState: vi.fn(),
  };
});

vi.mock('../../lib/logger.js', () => {
  const mockLogger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    errorWithType: vi.fn(),
    child: vi.fn(),
  };
  // child() returns the same logger so calls are captured on the parent ref
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    logger: mockLogger,
    generateCorrelationId: vi.fn(() => 'mock-correlation-id'),
  };
});

vi.mock('../../cheenoski/github/issues.js', () => ({
  fetchIssuesByLabel: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/transcript.js', () => ({
  TranscriptWriter: class MockTranscriptWriter {
    writeHeader = vi.fn();
    appendMessage = vi.fn();
    appendEvent = vi.fn();
    writeSummary = vi.fn();
  },
}));

describe('Orchestrator', () => {
  let mockConfig: EchelonConfig;
  let mockCliOptions: CliOptions;
  let mockSpawnAgent: ReturnType<typeof vi.fn>;
  let mockResumeAgent: ReturnType<typeof vi.fn>;
  let mockSaveState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default config for tests
    mockConfig = {
      project: {
        repo: 'test/repo',
        path: '/test/path',
        baseBranch: 'main',
      },
      layers: {
        '2ic': {
          model: 'sonnet',
          maxBudgetUsd: 5.0,
          maxTurns: 8,
          timeoutMs: 300_000,
        },
        'eng-lead': {
          model: 'sonnet',
          maxBudgetUsd: 5.0,
          maxTurns: 8,
          timeoutMs: 300_000,
        },
        'team-lead': {
          model: 'sonnet',
          maxBudgetUsd: 5.0,
          maxTurns: 8,
          timeoutMs: 300_000,
        },
      },
      engineers: {
        maxParallel: 3,
        createPr: true,
        prDraft: true,
      },
      approvalMode: 'destructive',
      maxTotalBudgetUsd: 50.0,
      billing: 'api',
    };

    mockCliOptions = {
      config: 'test-config.json',
      directive: 'Test directive',
      headless: true,
      dryRun: false,
      resume: false,
      verbose: false,
      telegram: false,
      yolo: false,
    };

    mockSpawnAgent = vi.mocked(spawnAgent);
    mockResumeAgent = vi.mocked(resumeAgent);
    mockSaveState = vi.mocked(saveState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Cascade flow - success path', () => {
    it('should complete full cascade: CEO → 2IC → Eng Lead → Team Lead', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      // Mock agent responses for each layer
      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response\n```json\n{"action":"update_plan","plan":"Strategic plan"}\n```',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response\n```json\n{"action":"update_plan","plan":"Technical design"}\n```',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response\n```json\n{"action":"update_plan","plan":"Execution plan"}\n```',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // Verify all three layers were called
      expect(mockSpawnAgent).toHaveBeenCalledTimes(3);

      // Verify state was saved after cascade
      expect(mockSaveState).toHaveBeenCalled();

      // Verify state is marked as completed
      expect(orchestrator.state.status).toBe('completed');

      // Verify total cost is tracked
      expect(orchestrator.state.totalCost).toBe(1.5);

      // Verify all messages were recorded
      expect(orchestrator.state.messages).toHaveLength(3);
    });

    it('should pass messages between layers correctly', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const directive = 'Implement JWT authentication';

      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC strategic breakdown',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead technical design',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead execution',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade(directive);

      // First spawn should get the directive from CEO
      expect(mockSpawnAgent).toHaveBeenNthCalledWith(1, directive, expect.any(Object));

      // Second spawn should get 2IC's response as input
      const engLeadCall = mockSpawnAgent.mock.calls[1];
      expect(engLeadCall[0]).toContain('2IC strategic breakdown');

      // Third spawn should get Eng Lead's response
      const teamLeadCall = mockSpawnAgent.mock.calls[2];
      expect(teamLeadCall[0]).toContain('Eng Lead technical design');
    });
  });

  describe('Budget enforcement', () => {
    it('should stop layer when layer budget is exceeded', async () => {
      // Set a very low budget for 2IC
      mockConfig.layers['2ic'].maxBudgetUsd = 0.3;

      const state = createState(mockConfig, 'Test directive');
      state.agents['2ic'].totalCost = 0.4; // Already over budget

      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
        state,
      });

      await orchestrator.runCascade('Build authentication system');

      // Should not call spawnAgent because 2IC is over budget
      expect(mockSpawnAgent).not.toHaveBeenCalled();

      // Should log warning
      expect(logger.warn).toHaveBeenCalledWith(
        '2IC budget exceeded',
        expect.objectContaining({
          spent: 0.4,
          limit: 0.3,
        })
      );
    });

    it('should stop cascade mid-flow when total budget is exceeded', async () => {
      // Set low total budget
      mockConfig.maxTotalBudgetUsd = 1.0;

      const state = createState(mockConfig, 'Test directive');
      state.totalCost = 0.6; // Start at 0.6

      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
        state,
      });

      // First agent call costs 0.5 (total 1.1, over limit)
      mockSpawnAgent.mockResolvedValueOnce({
        content: '2IC response',
        sessionId: '2ic-session',
        costUsd: 0.5,
        durationMs: 1000,
      } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // Should call 2IC (under budget before call)
      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);

      // State should reflect the cost
      expect(orchestrator.state.totalCost).toBe(1.1);

      // Should log total budget warning after 2IC completes
      // The next layer (eng-lead) should not be called
      expect(logger.warn).toHaveBeenCalledWith(
        'Total budget exceeded',
        expect.objectContaining({
          spent: 1.1,
          limit: 1.0,
        })
      );
    });

    it('should enforce layer budget even if total budget has room', async () => {
      mockConfig.layers['eng-lead'].maxBudgetUsd = 0.3;
      mockConfig.maxTotalBudgetUsd = 50.0; // Plenty of total budget

      const state = createState(mockConfig, 'Test directive');
      state.agents['eng-lead'].totalCost = 0.4; // Eng Lead over budget
      state.agents['2ic'].totalCost = 0.5; // 2IC fine
      state.totalCost = 0.9; // Total fine

      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
        state,
      });

      // 2IC succeeds
      mockSpawnAgent.mockResolvedValueOnce({
        content: '2IC response',
        sessionId: '2ic-session',
        costUsd: 0.1,
        durationMs: 1000,
      } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // Should only call 2IC, not Eng Lead (over budget)
      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);

      expect(logger.warn).toHaveBeenCalledWith(
        'Eng Lead budget exceeded',
        expect.objectContaining({
          spent: 0.4,
          limit: 0.3,
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should set status to error and stop cascade when layer fails', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      // 2IC fails
      mockSpawnAgent.mockRejectedValueOnce(new Error('API timeout'));

      await orchestrator.runCascade('Build authentication system');

      // Should only attempt 2IC
      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);

      // Should save error state
      expect(orchestrator.state.agents['2ic'].status).toBe('error');
      expect(orchestrator.state.agents['2ic'].lastError).toBe('API timeout');

      // Should not proceed to next layers
      expect(orchestrator.state.agents['eng-lead'].status).toBe('idle');

      // Should save state with error
      expect(mockSaveState).toHaveBeenCalled();
    });

    it('should emit error event when layer fails', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const errorEvents: any[] = [];
      orchestrator.bus.onEchelon((event) => {
        if (event.type === 'error') {
          errorEvents.push(event);
        }
      });

      mockSpawnAgent.mockRejectedValueOnce(new Error('Network failure'));

      await orchestrator.runCascade('Build authentication system');

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        type: 'error',
        role: '2ic',
        error: 'Network failure',
      });
    });

    it('should continue from last successful layer after error recovery', async () => {
      // First run: 2IC succeeds, Eng Lead fails
      const state = createState(mockConfig, 'Test directive');
      state.agents['2ic'].sessionId = '2ic-session';
      state.agents['2ic'].totalCost = 0.5;
      state.agents['2ic'].turnsCompleted = 1;
      state.agents['2ic'].status = 'done';
      state.totalCost = 0.5;

      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
        state,
      });

      // Resume 2IC and spawn Eng Lead
      mockResumeAgent.mockResolvedValueOnce({
        content: '2IC continued response',
        sessionId: '2ic-session',
        costUsd: 0.1,
        durationMs: 500,
      } as AgentResponse);

      mockSpawnAgent.mockResolvedValueOnce({
        content: 'Eng Lead response',
        sessionId: 'eng-lead-session',
        costUsd: 0.6,
        durationMs: 1500,
      } as AgentResponse);

      mockSpawnAgent.mockResolvedValueOnce({
        content: 'Team Lead response',
        sessionId: 'team-lead-session',
        costUsd: 0.4,
        durationMs: 1200,
      } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // Should resume 2IC (has sessionId)
      expect(mockResumeAgent).toHaveBeenCalledTimes(1);

      // Should spawn new sessions for Eng Lead and Team Lead
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe('Shutdown signal handling', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Mock process.exit to prevent actually exiting during tests
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    });

    afterEach(() => {
      exitSpy.mockRestore();
    });

    it('should handle SIGINT gracefully and save state', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      // Mock that completes quickly
      mockSpawnAgent.mockResolvedValueOnce({
        content: '2IC response',
        sessionId: '2ic-session',
        costUsd: 0.5,
        durationMs: 1000,
      } as AgentResponse);

      // Trigger shutdown immediately (before cascade completes)
      orchestrator.shutdown();

      await orchestrator.runCascade('Build authentication system');

      // Should set status to paused
      expect(orchestrator.state.status).toBe('paused');

      // Should save state
      expect(mockSaveState).toHaveBeenCalled();
    });

    it('should kill Cheenoski subprocesses on shutdown', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const killSpy = vi.spyOn(orchestrator['executor'], 'killAll');

      orchestrator.shutdown();

      expect(killSpy).toHaveBeenCalled();
    });

    it('should not double-shutdown when called multiple times', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const killSpy = vi.spyOn(orchestrator['executor'], 'killAll');

      orchestrator.shutdown();
      orchestrator.shutdown();
      orchestrator.shutdown();

      // Should only kill once
      expect(killSpy).toHaveBeenCalledTimes(1);
      // saveState called once (in shutdown) + the mock tracks only shutdown's call
      expect(mockSaveState).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dry-run mode', () => {
    it('should print plan but not execute when dryRun is true', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: { ...mockCliOptions, dryRun: true },
      });

      await orchestrator.runCascade('Build authentication system');

      // Should not spawn any agents
      expect(mockSpawnAgent).not.toHaveBeenCalled();

      // Should print dry run info
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Build authentication system'));

      consoleSpy.mockRestore();
    });

    it('should show cascade plan in dry-run mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: { ...mockCliOptions, dryRun: true },
      });

      await orchestrator.runCascade('Build authentication system');

      const allLogs = consoleSpy.mock.calls.map(call => call[0]).join('\n');

      expect(allLogs).toContain('CEO → 2IC: Strategy breakdown');
      expect(allLogs).toContain('2IC → Eng Lead: Technical design');
      expect(allLogs).toContain('Eng Lead → Team Lead: Issue creation + execution');

      consoleSpy.mockRestore();
    });
  });

  describe('State persistence', () => {
    it('should save state after each layer completes', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // Should save after each layer + final save
      expect(mockSaveState).toHaveBeenCalled();
      expect(mockSaveState.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('should save state with error when layer fails', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      mockSpawnAgent.mockRejectedValueOnce(new Error('Test error'));

      await orchestrator.runCascade('Build authentication system');

      // Should save state after error
      expect(mockSaveState).toHaveBeenCalled();

      // Check the orchestrator state directly (mock captures references, not snapshots)
      expect(orchestrator.state.agents['2ic'].status).toBe('error');
      expect(orchestrator.state.agents['2ic'].lastError).toBe('Test error');
    });

    it('should call saveState after state changes', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      // Mock all three layers
      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // saveState is called multiple times during cascade
      expect(mockSaveState).toHaveBeenCalled();
      expect(mockSaveState.mock.calls.length).toBeGreaterThanOrEqual(3);

      // Verify state was passed to saveState
      const savedState = mockSaveState.mock.calls[0][0];
      expect(savedState).toHaveProperty('sessionId');
      expect(savedState).toHaveProperty('updatedAt');
    });
  });

  describe('Message bus routing', () => {
    it('should route messages to correct downstream targets', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const messageEvents: any[] = [];
      orchestrator.bus.onEchelon((event) => {
        if (event.type === 'message') {
          messageEvents.push(event.message);
        }
      });

      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      expect(messageEvents).toHaveLength(3);

      // 2IC -> Eng Lead
      expect(messageEvents[0]).toMatchObject({
        from: '2ic',
        to: 'eng-lead',
      });

      // Eng Lead -> Team Lead
      expect(messageEvents[1]).toMatchObject({
        from: 'eng-lead',
        to: 'team-lead',
      });

      // Team Lead -> Engineer
      expect(messageEvents[2]).toMatchObject({
        from: 'team-lead',
        to: 'engineer',
      });
    });

    it('should emit agent_status events as layers progress', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const statusEvents: any[] = [];
      orchestrator.bus.onEchelon((event) => {
        if (event.type === 'agent_status') {
          statusEvents.push(event);
        }
      });

      // Mock all three layers
      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // Should emit thinking and done for 2IC
      const ic2Events = statusEvents.filter(e => e.role === '2ic');
      expect(ic2Events.length).toBeGreaterThanOrEqual(2);
      expect(ic2Events[0]).toMatchObject({ role: '2ic', status: 'thinking' });
      expect(ic2Events[ic2Events.length - 1]).toMatchObject({ role: '2ic', status: 'done' });
    });

    it('should emit cost_update events for each layer', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const costEvents: any[] = [];
      orchestrator.bus.onEchelon((event) => {
        if (event.type === 'cost_update') {
          costEvents.push(event);
        }
      });

      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      expect(costEvents.length).toBeGreaterThanOrEqual(2);

      expect(costEvents[0]).toMatchObject({
        type: 'cost_update',
        role: '2ic',
        costUsd: 0.5,
        totalUsd: 0.5,
      });

      expect(costEvents[1]).toMatchObject({
        type: 'cost_update',
        role: 'eng-lead',
        costUsd: 0.6,
        totalUsd: 1.1,
      });
    });

    it('should emit cascade_complete event on successful cascade', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const completeEvents: any[] = [];
      orchestrator.bus.onEchelon((event) => {
        if (event.type === 'cascade_complete') {
          completeEvents.push(event);
        }
      });

      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      const directive = 'Build authentication system';
      await orchestrator.runCascade(directive);

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0]).toMatchObject({
        type: 'cascade_complete',
        directive,
      });
    });
  });

  describe('Action execution', () => {
    it('should parse and execute actions from agent responses', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      const executedActions: any[] = [];
      orchestrator.bus.onEchelon((event) => {
        if (event.type === 'action_executed') {
          executedActions.push(event.action);
        }
      });

      // Mock all three layers
      mockSpawnAgent
        .mockResolvedValueOnce({
          content: '2IC response\n```json\n{"action":"update_plan","plan":"Strategic plan"}\n```',
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      expect(executedActions).toHaveLength(1);
      expect(executedActions[0]).toMatchObject({
        action: 'update_plan',
        plan: 'Strategic plan',
      });
    });

    it('should handle multiple actions in single response', async () => {
      // Use 'none' approval mode so actions execute immediately
      const testConfig = { ...mockConfig, approvalMode: 'none' as const };
      const orchestrator = new Orchestrator({
        config: testConfig,
        cliOptions: mockCliOptions,
      });

      const executedActions: any[] = [];
      orchestrator.bus.onEchelon((event) => {
        if (event.type === 'action_executed') {
          executedActions.push(event.action);
        }
      });

      // 2IC is allowed update_plan actions (team-lead is not)
      const multiActionResponse = `
2IC strategic analysis complete.

\`\`\`json
{"action":"update_plan","plan":"Phase 1"}
\`\`\`

Now updating plan again:

\`\`\`json
{"action":"update_plan","plan":"Phase 2"}
\`\`\`
`;

      // Mock all three layers - 2IC has multiple actions
      mockSpawnAgent
        .mockResolvedValueOnce({
          content: multiActionResponse,
          sessionId: '2ic-session',
          costUsd: 0.5,
          durationMs: 1000,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead response',
          sessionId: 'eng-lead-session',
          costUsd: 0.6,
          durationMs: 1500,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Team Lead response',
          sessionId: 'team-lead-session',
          costUsd: 0.4,
          durationMs: 1200,
        } as AgentResponse);

      await orchestrator.runCascade('Build authentication system');

      // Both update_plan actions from 2IC should be executed
      expect(executedActions.length).toBeGreaterThanOrEqual(2);
      expect(executedActions[0]).toMatchObject({ action: 'update_plan', plan: 'Phase 1' });
      expect(executedActions[1]).toMatchObject({ action: 'update_plan', plan: 'Phase 2' });
    });
  });

  describe('Session resumption', () => {
    it('should resume agents with existing sessionIds', async () => {
      const state = createState(mockConfig, 'Test directive');
      state.agents['2ic'].sessionId = 'existing-2ic-session';
      state.agents['eng-lead'].sessionId = 'existing-eng-lead-session';

      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
        state,
      });

      mockResumeAgent
        .mockResolvedValueOnce({
          content: '2IC resumed',
          sessionId: 'existing-2ic-session',
          costUsd: 0.2,
          durationMs: 800,
        } as AgentResponse)
        .mockResolvedValueOnce({
          content: 'Eng Lead resumed',
          sessionId: 'existing-eng-lead-session',
          costUsd: 0.3,
          durationMs: 900,
        } as AgentResponse);

      mockSpawnAgent.mockResolvedValueOnce({
        content: 'Team Lead new session',
        sessionId: 'new-team-lead-session',
        costUsd: 0.4,
        durationMs: 1000,
      } as AgentResponse);

      await orchestrator.runCascade('Continue authentication system');

      // Should resume 2IC and Eng Lead
      expect(mockResumeAgent).toHaveBeenCalledTimes(2);
      expect(mockResumeAgent).toHaveBeenNthCalledWith(
        1,
        'existing-2ic-session',
        expect.any(String),
        expect.any(Object)
      );
      expect(mockResumeAgent).toHaveBeenNthCalledWith(
        2,
        'existing-eng-lead-session',
        expect.any(String),
        expect.any(Object)
      );

      // Should spawn new Team Lead session
      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Duplicate cascade prevention', () => {
    it('should prevent concurrent cascades', async () => {
      const orchestrator = new Orchestrator({
        config: mockConfig,
        cliOptions: mockCliOptions,
      });

      let callCount = 0;
      mockSpawnAgent.mockImplementation(() => {
        callCount++;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              content: '2IC response',
              sessionId: '2ic-session',
              costUsd: 0.5,
              durationMs: 1000,
            } as AgentResponse);
          }, 100);
        });
      });

      // Start first cascade
      const cascade1 = orchestrator.runCascade('Directive 1');

      // Wait a tiny bit to ensure cascade1 starts
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to start second cascade while first is running
      const cascade2 = orchestrator.runCascade('Directive 2');

      await Promise.all([cascade1, cascade2]);

      // Should warn about duplicate
      expect(logger.warn).toHaveBeenCalledWith(
        'Cascade already running — ignoring duplicate call'
      );

      // First cascade completes all 3 layers (3 calls)
      // Second cascade should be rejected immediately (0 additional calls)
      expect(callCount).toBe(3);
    });
  });
});

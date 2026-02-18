import { nanoid } from 'nanoid';
import { logger } from '../lib/logger.js';
import { buildSystemPrompt } from '../lib/prompts.js';
import { TranscriptWriter } from '../lib/transcript.js';
import type {
  EchelonConfig, EchelonState, LayerMessage,
  AgentRole, LayerId, Action, CliOptions,
} from '../lib/types.js';
import { LAYER_LABELS, DEFAULT_MAX_TURNS } from '../lib/types.js';
import { spawnAgent, resumeAgent } from './agent.js';
import { MessageBus } from './message-bus.js';
import { parseActions, stripActionBlocks } from './action-parser.js';
import { ActionExecutor } from './action-executor.js';
import { createState, saveState, loadState, updateAgentStatus } from './state.js';
import { withRetry, checkLayerBudget, checkTotalBudget, budgetSummary } from './recovery.js';

interface OrchestratorOptions {
  config: EchelonConfig;
  cliOptions: CliOptions;
  state?: EchelonState;
}

export class Orchestrator {
  readonly config: EchelonConfig;
  readonly bus: MessageBus;
  readonly state: EchelonState;
  readonly executor: ActionExecutor;
  readonly transcript: TranscriptWriter;
  private shuttingDown = false;
  private cascadeRunning = false;
  private readonly dryRun: boolean;
  private signalHandlersInstalled = false;
  private readonly boundShutdown = () => this.shutdown();

  constructor(opts: OrchestratorOptions) {
    this.config = opts.config;
    this.dryRun = opts.cliOptions.dryRun;
    this.bus = new MessageBus();

    // Create or restore state
    this.state = opts.state ?? createState(opts.config, opts.cliOptions.directive ?? '');

    // Load message history into bus
    this.bus.loadHistory(this.state.messages);

    this.executor = new ActionExecutor(opts.config, this.state, this.bus);
    this.transcript = new TranscriptWriter(this.state.sessionId);

    // Wire up event logging
    this.bus.onEchelon((event) => {
      switch (event.type) {
        case 'action_executed':
          logger.info(`Action executed: ${event.action.action}`, { result: event.result.slice(0, 100) });
          this.transcript.appendEvent(`Action: ${event.action.action} — ${event.result}`);
          break;
        case 'action_pending':
          logger.info(`Awaiting approval: ${event.approval.description}`);
          break;
        case 'issue_created':
          logger.info(`Issue #${event.issue.number}: ${event.issue.title}`);
          break;
        case 'ralphy_progress':
          logger.debug(`[Ralphy:${event.label}] ${event.line}`);
          break;
        case 'error':
          logger.error(`[${event.role}] ${event.error}`);
          break;
      }
    });
  }

  /** Run the full hierarchical cascade for a directive */
  async runCascade(directive: string): Promise<void> {
    if (this.cascadeRunning) {
      logger.warn('Cascade already running — ignoring duplicate call');
      return;
    }
    this.cascadeRunning = true;
    this.state.directive = directive;

    if (this.dryRun) {
      this.printDryRun(directive);
      this.cascadeRunning = false;
      return;
    }

    // Write transcript header on new sessions
    if (this.state.messages.length === 0) {
      this.transcript.writeHeader(this.config, directive);
    }

    logger.info('Starting cascade', { directive: directive.slice(0, 80), repo: this.config.project.repo });

    // Install signal handlers once
    if (!this.signalHandlersInstalled) {
      process.once('SIGINT', this.boundShutdown);
      process.once('SIGTERM', this.boundShutdown);
      this.signalHandlersInstalled = true;
    }

    try {
      // Phase 1: CEO → 2IC (strategy)
      const strategyMsg = await this.runLayer('2ic', 'ceo', directive);
      if (this.shuttingDown || !strategyMsg) return;

      // Phase 2: 2IC → Eng Lead (technical design)
      const designInput = this.buildDownwardPrompt(strategyMsg);
      const designMsg = await this.runLayer('eng-lead', '2ic', designInput);
      if (this.shuttingDown || !designMsg) return;

      // Phase 3: Eng Lead → Team Lead (issue creation + execution)
      const execInput = this.buildDownwardPrompt(designMsg);
      const execMsg = await this.runLayer('team-lead', 'eng-lead', execInput);
      if (this.shuttingDown || !execMsg) return;

      // Process any pending approvals in headless mode
      if (this.executor.getPending().length > 0) {
        logger.info('Pending approvals:', {
          count: this.executor.getPending().length,
          actions: this.executor.getPending().map(a => a.description),
        });
      }

      this.state.status = 'completed';
      saveState(this.state);
      this.bus.emitEchelon({ type: 'cascade_complete', directive });

      logger.info('Cascade complete', {
        messages: this.state.messages.length,
        issues: this.state.issues.length,
        cost: `$${this.state.totalCost.toFixed(2)}`,
        pending: this.executor.getPending().length,
      });
      logger.info(`Budget: ${budgetSummary(this.state, this.config)}`);

      this.transcript.writeSummary(this.state.totalCost, new Date(this.state.startedAt));
    } finally {
      this.cascadeRunning = false;
    }
  }

  /** Run a single management layer */
  private async runLayer(
    role: LayerId,
    from: AgentRole,
    input: string,
  ): Promise<LayerMessage | null> {
    const layerConfig = this.config.layers[role];
    const agentState = this.state.agents[role];

    // Budget check
    if (agentState.totalCost >= layerConfig.maxBudgetUsd) {
      logger.warn(`${LAYER_LABELS[role]} budget exceeded`, {
        spent: agentState.totalCost,
        limit: layerConfig.maxBudgetUsd,
      });
      return null;
    }

    // Total budget check
    if (this.state.totalCost >= this.config.maxTotalBudgetUsd) {
      logger.warn('Total budget exceeded', {
        spent: this.state.totalCost,
        limit: this.config.maxTotalBudgetUsd,
      });
      return null;
    }

    updateAgentStatus(this.state, role, 'thinking');
    this.bus.emitEchelon({ type: 'agent_status', role, status: 'thinking' });

    try {
      const systemPrompt = buildSystemPrompt(role, this.config);
      const maxTurns = layerConfig.maxTurns ?? DEFAULT_MAX_TURNS[layerConfig.model] ?? 8;
      const response = await withRetry(
        () => agentState.sessionId
          ? resumeAgent(agentState.sessionId, input, {
              maxTurns,
              timeoutMs: layerConfig.timeoutMs,
              cwd: this.config.project.path,
            })
          : spawnAgent(input, {
              model: layerConfig.model,
              maxBudgetUsd: layerConfig.maxBudgetUsd - agentState.totalCost,
              systemPrompt,
              maxTurns,
              timeoutMs: layerConfig.timeoutMs,
              cwd: this.config.project.path,
            }),
        `${LAYER_LABELS[role]} agent call`,
      );

      // Update agent state
      agentState.sessionId = response.sessionId;
      agentState.totalCost += response.costUsd;
      agentState.turnsCompleted++;
      this.state.totalCost += response.costUsd;

      this.bus.emitEchelon({
        type: 'cost_update',
        role,
        costUsd: response.costUsd,
        totalUsd: this.state.totalCost,
      });

      // Parse actions from response
      const { actions, errors } = parseActions(response.content);
      if (errors.length > 0) {
        logger.warn(`${LAYER_LABELS[role]} had action parse errors`, { errors });
      }

      // Determine message target (next layer down or same layer for info requests)
      const target = this.getDownstreamRole(role);

      // Build layer message
      const msg: LayerMessage = {
        id: nanoid(12),
        from: role,
        to: target,
        content: response.content,
        actions,
        timestamp: new Date().toISOString(),
        costUsd: response.costUsd,
        durationMs: response.durationMs,
      };

      // Record message
      this.state.messages.push(msg);
      this.bus.routeMessage(msg);
      this.transcript.appendMessage(msg);
      saveState(this.state);

      // Execute actions
      for (const action of actions) {
        await this.executor.executeOrQueue(action, role, this.dryRun);
      }

      updateAgentStatus(this.state, role, 'done');
      this.bus.emitEchelon({ type: 'agent_status', role, status: 'done' });

      // Log summary
      const narrative = stripActionBlocks(response.content);
      logger.info(`[${LAYER_LABELS[role]}] ${narrative.slice(0, 150)}...`, {
        cost: `$${response.costUsd.toFixed(4)}`,
        duration: `${(response.durationMs / 1000).toFixed(1)}s`,
        actions: actions.length,
      });

      return msg;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      agentState.lastError = errMsg;
      updateAgentStatus(this.state, role, 'error');
      this.bus.emitEchelon({ type: 'error', role, error: errMsg });
      saveState(this.state);
      return null;
    }
  }

  /** Build prompt for downstream layer using upstream response */
  private buildDownwardPrompt(upstreamMsg: LayerMessage): string {
    const narrative = stripActionBlocks(upstreamMsg.content);
    const fromLabel = LAYER_LABELS[upstreamMsg.from];
    return [
      `The ${fromLabel} has provided the following direction:`,
      '',
      narrative,
      '',
      upstreamMsg.actions.length > 0
        ? `They have also initiated these actions: ${upstreamMsg.actions.map(a => a.action).join(', ')}`
        : null,
      '',
      'Based on this, proceed with your responsibilities. Be thorough and specific.',
    ].filter(s => s !== null && s !== undefined).join('\n');
  }

  /** Get the downstream role for a given layer */
  private getDownstreamRole(role: LayerId): AgentRole {
    switch (role) {
      case '2ic': return 'eng-lead';
      case 'eng-lead': return 'team-lead';
      case 'team-lead': return 'engineer';
      default: throw new Error(`No downstream role for: ${role}`);
    }
  }

  /** Print dry-run information */
  private printDryRun(directive: string): void {
    console.log('\n=== DRY RUN ===\n');
    console.log(`Project: ${this.config.project.repo}`);
    console.log(`Directive: ${directive}`);
    console.log(`Approval Mode: ${this.config.approvalMode}`);
    console.log(`Max Budget: $${this.config.maxTotalBudgetUsd}`);
    console.log('\nCascade Plan:');
    console.log('  1. CEO → 2IC: Strategy breakdown');
    console.log(`     Model: ${this.config.layers['2ic'].model}, Budget: $${this.config.layers['2ic'].maxBudgetUsd}`);
    console.log('  2. 2IC → Eng Lead: Technical design');
    console.log(`     Model: ${this.config.layers['eng-lead'].model}, Budget: $${this.config.layers['eng-lead'].maxBudgetUsd}`);
    console.log('  3. Eng Lead → Team Lead: Issue creation + execution');
    console.log(`     Model: ${this.config.layers['team-lead'].model}, Budget: $${this.config.layers['team-lead'].maxBudgetUsd}`);
    console.log(`  4. Team Lead → Engineers: Ralphy (max ${this.config.engineers.maxParallel} parallel)`);
    console.log('\n=== END DRY RUN ===\n');
  }

  /** Graceful shutdown — kills Ralphy subprocesses, saves state */
  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    logger.info('Shutting down — killing subprocesses, saving state...');

    // Kill Cheenoski subprocesses
    this.executor.killAll();

    this.state.status = 'paused';
    saveState(this.state);
    this.transcript.writeSummary(this.state.totalCost, new Date(this.state.startedAt));
    this.bus.emitEchelon({ type: 'shutdown', reason: 'user' });
    logger.info('State saved. Resume with --resume flag.', {
      session: this.state.sessionId,
      cost: `$${this.state.totalCost.toFixed(2)}`,
    });

    // Remove handlers
    process.removeListener('SIGINT', this.boundShutdown);
    process.removeListener('SIGTERM', this.boundShutdown);
    this.signalHandlersInstalled = false;
  }

  /** For headless approval: approve all pending */
  async approveAllPending(): Promise<string[]> {
    return this.executor.approveAll();
  }
}

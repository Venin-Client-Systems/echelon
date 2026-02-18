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
        case 'cheenoski_progress':
          logger.debug(`[Cheenoski:${event.label}] ${event.line}`);
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
    this.state.status = 'running';
    saveState(this.state);

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
      process.on('SIGINT', this.boundShutdown);
      process.on('SIGTERM', this.boundShutdown);
      this.signalHandlersInstalled = true;
    }

    try {
      // Phase 1: CEO → 2IC (strategy)
      const strategyMsg = await this.runLayer('2ic', 'ceo', directive);
      if (this.shuttingDown || !strategyMsg) {
        this.state.status = 'paused';
        saveState(this.state);
        return;
      }

      // Validate layer output before proceeding
      if (!this.validateLayerOutput(strategyMsg)) {
        logger.error('Strategy message validation failed — aborting cascade');
        this.state.status = 'failed';
        saveState(this.state);
        return;
      }

      // Phase 2: 2IC → Eng Lead (technical design)
      const designInput = this.buildDownwardPrompt(strategyMsg);
      let designMsg = await this.runLayer('eng-lead', '2ic', designInput);
      if (this.shuttingDown || !designMsg) {
        this.state.status = 'paused';
        saveState(this.state);
        return;
      }

      if (!this.validateLayerOutput(designMsg)) {
        logger.error('Design message validation failed — aborting cascade');
        this.state.status = 'failed';
        saveState(this.state);
        return;
      }

      // Loopback: if Eng Lead asked 2IC questions, answer them
      designMsg = await this.resolveInfoRequests(designMsg, 'eng-lead');
      if (this.shuttingDown || !designMsg) {
        this.state.status = 'paused';
        saveState(this.state);
        return;
      }

      // Phase 3: Eng Lead → Team Lead (issue creation + execution)
      const execInput = this.buildDownwardPrompt(designMsg, 'team-lead');
      let execMsg = await this.runLayer('team-lead', 'eng-lead', execInput);
      if (this.shuttingDown || !execMsg) {
        this.state.status = 'paused';
        saveState(this.state);
        return;
      }

      if (!this.validateLayerOutput(execMsg)) {
        logger.error('Execution message validation failed — aborting cascade');
        this.state.status = 'failed';
        saveState(this.state);
        return;
      }

      // Loopback: if Team Lead asked Eng Lead questions, answer them
      execMsg = await this.resolveInfoRequests(execMsg, 'team-lead');
      if (this.shuttingDown || !execMsg) {
        this.state.status = 'paused';
        saveState(this.state);
        return;
      }

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
              maxBudgetUsd: layerConfig.maxBudgetUsd - agentState.totalCost,
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

      // Execute actions — filter by role permissions
      const allowedActions = this.filterActionsByRole(actions, role);
      for (const action of allowedActions) {
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
      this.state.status = 'failed';
      saveState(this.state);
      logger.error(`Layer ${LAYER_LABELS[role]} failed, cascade aborted`, { error: errMsg });
      return null;
    }
  }

  /** Build prompt for downstream layer using upstream response */
  private buildDownwardPrompt(upstreamMsg: LayerMessage, targetRole?: LayerId): string {
    const narrative = stripActionBlocks(upstreamMsg.content);
    const fromLabel = LAYER_LABELS[upstreamMsg.from];

    const parts = [
      `The ${fromLabel} has provided the following direction:`,
      '',
      narrative,
    ];

    // Include update_plan content so downstream layers see the actual plan
    for (const action of upstreamMsg.actions) {
      if (action.action === 'update_plan') {
        parts.push('', '## Plan', '', action.plan);
        if (action.workstreams && action.workstreams.length > 0) {
          parts.push('', '## Workstreams');
          for (const ws of action.workstreams) {
            parts.push(`- ${ws}`);
          }
        }
      }
    }

    if (upstreamMsg.actions.length > 0) {
      const nonPlanActions = upstreamMsg.actions.filter(a => a.action !== 'update_plan');
      if (nonPlanActions.length > 0) {
        parts.push('', `They have also initiated these actions: ${nonPlanActions.map(a => a.action).join(', ')}`);
      }
    }

    // Specific instructions for the Team Lead
    if (targetRole === 'team-lead') {
      parts.push(
        '',
        'INSTRUCTION: Convert the above task specifications into a create_issues action block.',
        'Put ALL issues in a single create_issues action, then invoke_cheenoski for the highest-priority batch.',
        'Do this NOW — emit the JSON action blocks immediately.',
      );
    } else {
      parts.push('', 'Based on this, proceed with your responsibilities. Be thorough and specific.');
    }

    return parts.join('\n');
  }

  /**
   * Resolve request_info actions by looping back to the target layer.
   * If a layer asked questions, resume the target layer with those questions,
   * then resume the requesting layer with the answers.
   * Max 2 rounds to prevent infinite loops.
   */
  private async resolveInfoRequests(
    msg: LayerMessage,
    requestingRole: LayerId,
    round = 0,
  ): Promise<LayerMessage | null> {
    const MAX_LOOPBACK_ROUNDS = 2;
    if (round >= MAX_LOOPBACK_ROUNDS) return msg;

    // Collect request_info actions targeting upstream layers
    const infoRequests = msg.actions.filter(
      (a): a is Action & { action: 'request_info' } =>
        a.action === 'request_info',
    );

    if (infoRequests.length === 0) return msg;

    // Group questions by target
    const questionsByTarget = new Map<string, string[]>();
    for (const req of infoRequests) {
      const existing = questionsByTarget.get(req.target) ?? [];
      existing.push(req.question);
      questionsByTarget.set(req.target, existing);
    }

    // For each target, resume their session with the questions
    const answers: string[] = [];
    for (const [target, questions] of questionsByTarget) {
      // Only handle upstream layers that have sessions (skip 'ceo')
      if (target === 'ceo') continue;
      const targetRole = target as LayerId;
      const targetState = this.state.agents[targetRole];
      if (!targetState?.sessionId) continue;

      const questionPrompt = [
        `The ${LAYER_LABELS[requestingRole]} has the following questions before proceeding:`,
        '',
        ...questions.map((q, i) => `${i + 1}. ${q}`),
        '',
        'Please provide clear, specific answers so they can proceed immediately.',
        'Be decisive — give concrete recommendations, not options.',
      ].join('\n');

      logger.info(`Loopback: ${LAYER_LABELS[requestingRole]} → ${LAYER_LABELS[targetRole]}`, {
        questions: questions.length,
        round: round + 1,
      });

      const answerMsg = await this.runLayer(targetRole, requestingRole, questionPrompt);
      if (this.shuttingDown || !answerMsg) return null;

      answers.push(stripActionBlocks(answerMsg.content));
    }

    if (answers.length === 0) return msg;

    // Feed answers back to the requesting layer
    const answerPrompt = [
      'Your questions have been answered:',
      '',
      ...answers,
      '',
      'Now proceed with your primary responsibilities IMMEDIATELY.',
      'Create issues and invoke cheenoski. Do not ask further questions.',
    ].join('\n');

    logger.info(`Loopback: feeding answers back to ${LAYER_LABELS[requestingRole]}`, {
      round: round + 1,
    });

    // Determine the correct upstream role to pass as 'from' parameter
    const upstreamRole = this.getUpstreamRole(requestingRole);
    const updatedMsg = await this.runLayer(requestingRole, upstreamRole, answerPrompt);
    if (this.shuttingDown || !updatedMsg) return null;

    // Recursively resolve if new questions were asked (up to MAX_LOOPBACK_ROUNDS)
    return this.resolveInfoRequests(updatedMsg, requestingRole, round + 1);
  }

  /** Filter actions to only those allowed for a given role */
  private filterActionsByRole(actions: Action[], role: LayerId): Action[] {
    const ROLE_ALLOWED_ACTIONS: Record<LayerId, Set<string>> = {
      '2ic': new Set(['update_plan', 'request_info', 'escalate']),
      'eng-lead': new Set(['update_plan', 'create_branch', 'request_info', 'escalate']),
      'team-lead': new Set(['create_issues', 'invoke_cheenoski', 'invoke_ralphy', 'request_info', 'request_review']),
    };

    const allowed = ROLE_ALLOWED_ACTIONS[role];
    if (!allowed) return actions;

    return actions.filter((action) => {
      if (allowed.has(action.action)) return true;
      logger.warn(`Dropping "${action.action}" from ${LAYER_LABELS[role]} — not in allowed actions for this role`);
      return false;
    });
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

  /** Get the upstream role for a given layer */
  private getUpstreamRole(role: LayerId): AgentRole {
    switch (role) {
      case 'eng-lead': return '2ic';
      case 'team-lead': return 'eng-lead';
      default: throw new Error(`No upstream role for: ${role}`);
    }
  }

  /** Validate layer output before passing downstream */
  private validateLayerOutput(msg: LayerMessage): boolean {
    if (!msg.content || msg.content.trim().length === 0) {
      logger.warn(`Empty content from ${msg.from}`);
      return false;
    }
    if (msg.costUsd < 0) {
      logger.warn(`Invalid cost from ${msg.from}: ${msg.costUsd}`);
      return false;
    }
    return true;
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
    console.log(`  4. Team Lead → Engineers: Cheenoski (max ${this.config.engineers.maxParallel} parallel)`);
    console.log('\n=== END DRY RUN ===\n');
  }

  /** Graceful shutdown — kills Cheenoski subprocesses, saves state */
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

    // Exit the process — without this, Node stays alive after SIGTERM/SIGINT
    process.exit(0);
  }

  /** For headless approval: approve all pending */
  async approveAllPending(): Promise<string[]> {
    return this.executor.approveAll();
  }
}

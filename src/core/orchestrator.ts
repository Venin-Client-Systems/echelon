import { nanoid } from 'nanoid';
import { logger, generateCorrelationId, type Logger } from '../lib/logger.js';
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
import { checkLayerBudget, checkTotalBudget, budgetSummary } from './recovery.js';
import { fetchIssuesByLabel } from '../cheenoski/github/issues.js';

/**
 * Options for creating an Orchestrator instance.
 */
interface OrchestratorOptions {
  /** Echelon configuration (layers, budget, approval mode) */
  config: EchelonConfig;
  /** CLI flags (dryRun, yolo, verbose, etc.) */
  cliOptions: CliOptions;
  /** Optional pre-existing state for session resumption */
  state?: EchelonState;
}

/**
 * Main hierarchical cascade orchestrator for Echelon.
 *
 * The Orchestrator runs the full hierarchical cascade:
 * CEO → 2IC → Eng Lead → Team Lead → Engineers (via Cheenoski).
 *
 * It manages budget checks, state persistence, signal handling (SIGINT/SIGTERM),
 * error recovery, and graceful shutdown. All system events flow through the MessageBus.
 *
 * @category Core
 * @example
 * ```typescript
 * const orchestrator = new Orchestrator({
 *   config: loadConfig('echelon.json'),
 *   cliOptions: { dryRun: false, yolo: false, directive: '' },
 * });
 *
 * await orchestrator.runCascade('Implement JWT authentication');
 * ```
 */
export class Orchestrator {
  readonly config: EchelonConfig;
  readonly bus: MessageBus;
  readonly state: EchelonState;
  readonly executor: ActionExecutor;
  readonly transcript: TranscriptWriter;
  readonly logger: Logger;
  readonly correlationId: string;
  private shuttingDown = false;
  private cascadeRunning = false;
  private cascadeStartedAt = 0;
  private readonly dryRun: boolean;
  private readonly yolo: boolean;
  private readonly consolidate: boolean;
  private signalHandlersInstalled = false;
  private readonly boundShutdown = () => this.shutdown();
  private budgetWarningsShown = new Set<number>(); // Track which % thresholds we've warned about
  private cascadeTimeoutWarningsShown = new Set<number>(); // Track cascade timeout warnings (50%, 75%, 90%)
  private zeroCostCallCount = 0; // Track calls returning $0 (subscription/credits detection)
  private costTrackingAvailable = true; // Flag if USD cost tracking is working

  constructor(opts: OrchestratorOptions) {
    // Prevent EventEmitter memory leak from multiple signal handlers
    // (orchestrator + cheenoski both register SIGINT/SIGTERM)
    process.setMaxListeners(20);

    this.config = opts.config;
    this.dryRun = opts.cliOptions.dryRun;
    this.yolo = opts.cliOptions.yolo ?? false;
    this.consolidate = opts.cliOptions.consolidate ?? false;
    this.bus = new MessageBus();

    // Create or restore state
    this.state = opts.state ?? createState(opts.config, opts.cliOptions.directive ?? '');

    // Create root logger with session context and correlation ID
    this.correlationId = generateCorrelationId();
    this.logger = logger.child({
      sessionId: this.state.sessionId,
      correlationId: this.correlationId,
      component: 'orchestrator',
    });

    // Load message history into bus
    this.bus.loadHistory(this.state.messages);

    this.executor = new ActionExecutor(opts.config, this.state, this.bus);
    this.transcript = new TranscriptWriter(this.state.sessionId);

    // Wire up event logging
    this.bus.onEchelon((event) => {
      switch (event.type) {
        case 'action_executed':
          this.logger.info(`Action executed: ${event.action.action}`, { result: event.result.slice(0, 100) });
          this.transcript.appendEvent(`Action: ${event.action.action} — ${event.result}`);
          break;
        case 'action_pending':
          this.logger.info(`Awaiting approval: ${event.approval.description}`);
          break;
        case 'issue_created':
          this.logger.info(`Issue #${event.issue.number}: ${event.issue.title}`);
          break;
        case 'cheenoski_progress':
          this.logger.debug(`[Cheenoski:${event.label}] ${event.line}`);
          break;
        case 'error':
          this.logger.error(`[${event.role}] ${event.error}`);
          break;
      }
    });
  }

  /**
   * Run the full hierarchical cascade for a directive.
   *
   * Executes each layer sequentially (CEO → 2IC → Eng Lead → Team Lead),
   * with budget checks, timeout enforcement, and state persistence.
   *
   * Signal handlers (SIGINT/SIGTERM) are installed to ensure graceful shutdown.
   *
   * @param directive - High-level directive from the CEO (user)
   * @throws {Error} If cascade fails unrecoverably
   */
  async runCascade(directive: string): Promise<void> {
    // Validate directive length
    if (directive.length > 10000) {
      throw new Error(
        `Directive too long (${directive.length} chars, max 10,000). ` +
        'Please summarize or break into smaller tasks.'
      );
    }
    if (!directive.trim()) {
      throw new Error('Directive cannot be empty');
    }

    if (this.cascadeRunning) {
      this.logger.warn('Cascade already running — ignoring duplicate call');
      return;
    }
    this.cascadeRunning = true;
    this.cascadeStartedAt = Date.now();
    this.state.directive = directive;
    this.state.status = 'running';
    saveState(this.state);

    if (this.dryRun) {
      this.printDryRun(directive);
      this.cascadeRunning = false;
      return;
    }

    // Prerequisite checks — fail fast if missing required tools
    await this.checkPrerequisites();

    // Write transcript header on new sessions
    if (this.state.messages.length === 0) {
      this.transcript.writeHeader(this.config, directive);
    }

    this.logger.info('Starting cascade', { directive: directive.slice(0, 80), repo: this.config.project.repo });

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
        this.logger.error('Strategy message validation failed — aborting cascade');
        this.state.status = 'failed';
        saveState(this.state);
        return;
      }

      // Check cascade timeout before Phase 2
      if (this.isCascadeTimedOut()) {
        this.state.status = 'failed';
        saveState(this.state);
        this.logger.error('Cascade aborted: duration timeout exceeded before Eng Lead phase');
        return;
      }

      // Phase 2: 2IC → Eng Lead (technical design)
      const designInput = await this.buildDownwardPrompt(strategyMsg);
      let designMsg = await this.runLayer('eng-lead', '2ic', designInput);
      if (this.shuttingDown || !designMsg) {
        this.state.status = 'paused';
        saveState(this.state);
        return;
      }

      if (!this.validateLayerOutput(designMsg)) {
        this.logger.error('Design message validation failed — aborting cascade');
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

      // Check cascade timeout before Phase 3
      if (this.isCascadeTimedOut()) {
        this.state.status = 'failed';
        saveState(this.state);
        this.logger.error('Cascade aborted: duration timeout exceeded before Team Lead phase');
        return;
      }

      // Phase 3: Eng Lead → Team Lead (issue creation + execution)
      const execInput = await this.buildDownwardPrompt(designMsg, 'team-lead');
      let execMsg = await this.runLayer('team-lead', 'eng-lead', execInput);
      if (this.shuttingDown || !execMsg) {
        this.state.status = 'paused';
        saveState(this.state);
        return;
      }

      if (!this.validateLayerOutput(execMsg)) {
        this.logger.error('Execution message validation failed — aborting cascade');
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
        this.logger.info('Pending approvals:', {
          count: this.executor.getPending().length,
          actions: this.executor.getPending().map(a => a.description),
        });
      }

      this.state.status = 'completed';
      saveState(this.state);

      // Emit detailed completion summary
      const duration = Date.now() - new Date(this.state.startedAt).getTime();
      this.bus.emitEchelon({
        type: 'cascade_complete',
        directive,
        summary: {
          issuesCreated: this.state.issues.length,
          actionsExecuted: this.state.messages.filter(m => m.from !== 'ceo').length,
          pendingApprovals: this.executor.getPending().length,
          totalCost: this.state.totalCost,
          duration,
        },
      });

      const costLabel = this.config.billing === 'max'
        ? `$${this.state.totalCost.toFixed(2)} (estimated)`
        : `$${this.state.totalCost.toFixed(2)}`;
      this.logger.info('Cascade complete', {
        messages: this.state.messages.length,
        issues: this.state.issues.length,
        cost: costLabel,
        pending: this.executor.getPending().length,
      });
      this.logger.info(`Budget: ${budgetSummary(this.state, this.config)}`);

      // Show helpful next steps
      this.printNextSteps();

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

    // Create child logger with layer role context
    const layerLogger = this.logger.child({ role });

    // Budget checks (skipped when billing is 'max' — costs are not real)
    if (this.config.billing !== 'max') {
      if (agentState.totalCost >= layerConfig.maxBudgetUsd) {
        this.logger.warn(`${LAYER_LABELS[role]} budget exceeded`, {
          spent: agentState.totalCost,
          limit: layerConfig.maxBudgetUsd,
        });
        return null;
      }

      if (this.state.totalCost >= this.config.maxTotalBudgetUsd) {
        this.logger.warn('Total budget exceeded', {
          spent: this.state.totalCost,
          limit: this.config.maxTotalBudgetUsd,
        });
        return null;
      }
    }

    updateAgentStatus(this.state, role, 'thinking');
    this.bus.emitEchelon({ type: 'agent_status', role, status: 'thinking' });

    const systemPrompt = buildSystemPrompt(role, this.config, this.consolidate);
    const maxTurns = layerConfig.maxTurns ?? DEFAULT_MAX_TURNS[layerConfig.model] ?? 8;

    // Agent spawn/resume now has built-in error boundaries with:
    // - Error classification (rate limit, timeout, crash, quota)
    // - Exponential backoff with jitter
    // - Circuit breaker (opens after 5 consecutive failures)

    // Stream thinking output to TUI in real-time
    const onProgress = (chunk: string) => {
      this.bus.emitEchelon({
        type: 'agent_progress',
        role,
        content: chunk,
      });
    };

    // Start timeout monitoring
    const agentStartTime = Date.now();
    const timeoutWarnings = new Set<number>(); // Track which % warnings we've sent
    const timeoutMonitor = setInterval(() => {
      const elapsed = Date.now() - agentStartTime;
      const timeoutPercent = (elapsed / layerConfig.timeoutMs) * 100;

      // Warn at 50%, 75%, 90%
      if (timeoutPercent >= 90 && !timeoutWarnings.has(90)) {
        timeoutWarnings.add(90);
        layerLogger.warn(`${LAYER_LABELS[role]} approaching timeout (90% - ${(elapsed / 1000).toFixed(0)}s / ${(layerConfig.timeoutMs / 1000).toFixed(0)}s)`);
        this.bus.emitEchelon({
          type: 'timeout_warning',
          role,
          elapsed,
          timeout: layerConfig.timeoutMs,
          percent: 90,
        });
      } else if (timeoutPercent >= 75 && !timeoutWarnings.has(75)) {
        timeoutWarnings.add(75);
        layerLogger.warn(`${LAYER_LABELS[role]} long-running (75% - ${(elapsed / 1000).toFixed(0)}s / ${(layerConfig.timeoutMs / 1000).toFixed(0)}s)`);
        this.bus.emitEchelon({
          type: 'timeout_warning',
          role,
          elapsed,
          timeout: layerConfig.timeoutMs,
          percent: 75,
        });
      } else if (timeoutPercent >= 50 && !timeoutWarnings.has(50)) {
        timeoutWarnings.add(50);
        layerLogger.info(`${LAYER_LABELS[role]} halfway through timeout (${(elapsed / 1000).toFixed(0)}s / ${(layerConfig.timeoutMs / 1000).toFixed(0)}s)`);
        this.bus.emitEchelon({
          type: 'timeout_warning',
          role,
          elapsed,
          timeout: layerConfig.timeoutMs,
          percent: 50,
        });
      }
    }, 5000); // Check every 5 seconds

    let response;
    try {
      response = agentState.sessionId
        ? await resumeAgent(agentState.sessionId, input, {
            maxTurns,
            timeoutMs: layerConfig.timeoutMs,
            cwd: this.config.project.path,
            maxBudgetUsd: layerConfig.maxBudgetUsd - agentState.totalCost,
            yolo: this.yolo,
            onProgress,
          })
        : await spawnAgent(input, {
            model: layerConfig.model,
            maxBudgetUsd: layerConfig.maxBudgetUsd - agentState.totalCost,
            systemPrompt,
            maxTurns,
            timeoutMs: layerConfig.timeoutMs,
            cwd: this.config.project.path,
            yolo: this.yolo,
            onProgress,
          });
    } finally {
      // Always clear timeout monitor
      clearInterval(timeoutMonitor);
    }

    try {
      // Update agent state
      agentState.sessionId = response.sessionId;
      agentState.totalCost += response.costUsd;
      agentState.turnsCompleted++;
      this.state.totalCost += response.costUsd;

      // Detect zero-cost pattern (subscription/credits-based accounts)
      if (response.costUsd === 0) {
        this.zeroCostCallCount++;
        if (this.zeroCostCallCount >= 3 && this.costTrackingAvailable) {
          this.costTrackingAvailable = false;
          this.logger.warn('⚠️  Budget tracking unavailable — subscription/credits-based account detected');
          this.logger.warn('    API is not returning cost data (Claude 20x Max detected).');
          this.logger.warn('    Anthropic enforces your 4-hour and weekly usage limits.');

          // Emit warning to UI
          this.bus.emitEchelon({
            type: 'error',
            error: '⚠️  Budget tracking unavailable (Claude 20x Max detected). Anthropic enforces your usage limits.',
            role: '2ic',
          });
        }
      }

      this.bus.emitEchelon({
        type: 'cost_update',
        role,
        costUsd: response.costUsd,
        totalUsd: this.state.totalCost,
      });

      // Check for budget warnings (skip if cost tracking unavailable)
      if (this.costTrackingAvailable) {
        this.checkBudgetWarnings();
      }

      // Parse actions from response
      const { actions, errors } = parseActions(response.content);
      if (errors.length > 0) {
        layerLogger.warn(`${LAYER_LABELS[role]} had action parse errors`, { errors });
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
      layerLogger.info(`[${LAYER_LABELS[role]}] ${narrative.slice(0, 150)}...`, {
        cost: `$${response.costUsd.toFixed(4)}`,
        duration: `${(response.durationMs / 1000).toFixed(1)}s`,
        actions: actions.length,
        sessionId: response.sessionId,
      });

      return msg;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      agentState.lastError = errMsg;
      updateAgentStatus(this.state, role, 'error');
      this.bus.emitEchelon({ type: 'error', role, error: errMsg });
      this.state.status = 'failed';
      saveState(this.state);

      // Use structured error logging with stack trace
      if (err instanceof Error) {
        layerLogger.errorWithType(`Layer ${LAYER_LABELS[role]} failed, cascade aborted`, 'crash', err, {
          sessionId: agentState.sessionId,
        });
      } else {
        layerLogger.error(`Layer ${LAYER_LABELS[role]} failed, cascade aborted`, { error: errMsg });
      }

      // Show recovery suggestions
      this.printRecoverySuggestions(role, errMsg);

      return null;
    }
  }

  /** Build prompt for downstream layer using upstream response */
  private async buildDownwardPrompt(upstreamMsg: LayerMessage, targetRole?: LayerId): Promise<string> {
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

    // Specific instructions for the Team Lead — inject existing issue context
    if (targetRole === 'team-lead') {
      // Detect cheenoski labels mentioned in the upstream message
      const labelMatches = upstreamMsg.content.match(/cheenoski-\d+/g);
      const labels = [...new Set(labelMatches ?? [])];

      // Fetch existing open issues for those labels
      const existingIssues: { number: number; title: string; labels: string[] }[] = [];
      for (const label of labels) {
        const issues = await fetchIssuesByLabel(this.config.project.repo, label);
        for (const issue of issues) {
          existingIssues.push({ number: issue.number, title: issue.title, labels: issue.labels });
        }
      }

      if (existingIssues.length > 0) {
        parts.push(
          '',
          '## EXISTING ISSUES (already in GitHub)',
          'These issues already exist and are open. Do NOT create duplicates.',
          '',
          ...existingIssues.map(i => `- #${i.number}: ${i.title} [${i.labels.join(', ')}]`),
          '',
          'INSTRUCTION: Check if these existing issues already cover the planned work.',
          'Only emit create_issues for genuinely NEW work not covered above.',
          'Then emit invoke_cheenoski for each batch label that needs processing.',
        );
      } else {
        parts.push(
          '',
          'INSTRUCTION: Convert the above task specifications into a create_issues action block.',
          'Put ALL issues in a single create_issues action, then invoke_cheenoski for the batch label.',
          'Do this NOW — emit the JSON action blocks immediately.',
        );
      }
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

      this.logger.info(`Loopback: ${LAYER_LABELS[requestingRole]} → ${LAYER_LABELS[targetRole]}`, {
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

    this.logger.info(`Loopback: feeding answers back to ${LAYER_LABELS[requestingRole]}`, {
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
      this.logger.warn(`Dropping "${action.action}" from ${LAYER_LABELS[role]} — not in allowed actions for this role`);
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
      this.logger.warn(`Empty content from ${msg.from}`);
      return false;
    }
    if (msg.costUsd < 0) {
      this.logger.warn(`Invalid cost from ${msg.from}: ${msg.costUsd}`);
      return false;
    }
    return true;
  }

  /** Check prerequisites (gh, claude CLI) before starting cascade */
  private async checkPrerequisites(): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // Check for gh CLI
    try {
      await execFileAsync('gh', ['--version'], { timeout: 5000 });
    } catch (err) {
      const msg = err instanceof Error && 'code' in err ? (err as any).code : '';
      if (msg === 'ENOENT') {
        throw new Error(
          'GitHub CLI (gh) not found. Install: https://cli.github.com\n' +
          'This is required for issue creation and repo operations.'
        );
      }
      throw new Error(`GitHub CLI check failed: ${err}`);
    }

    // Check if gh is authenticated
    try {
      await execFileAsync('gh', ['auth', 'status'], { timeout: 5000 });
    } catch {
      throw new Error(
        'GitHub CLI not authenticated. Run: gh auth login\n' +
        'This is required for issue creation and repo operations.'
      );
    }

    // Check for claude CLI
    try {
      await execFileAsync('claude', ['--version'], { timeout: 5000 });
    } catch (err) {
      const msg = err instanceof Error && 'code' in err ? (err as any).code : '';
      if (msg === 'ENOENT') {
        throw new Error(
          'Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code\n' +
          'This is required for AI agent execution.'
        );
      }
      throw new Error(`Claude CLI check failed: ${err}`);
    }

    this.logger.debug('Prerequisites check passed (gh, claude CLI available)');
  }

  /** Print dry-run information */
  private printDryRun(directive: string): void {
    const isMax = this.config.billing === 'max';
    const fmtBudget = (usd: number) => isMax ? '\u221e (Max plan)' : `$${usd}`;
    console.log('\n=== DRY RUN ===\n');
    console.log(`Project: ${this.config.project.repo}`);
    console.log(`Directive: ${directive}`);
    console.log(`Approval Mode: ${this.config.approvalMode}`);
    console.log(`Max Budget: ${fmtBudget(this.config.maxTotalBudgetUsd)}`);
    console.log('\nCascade Plan:');
    console.log('  1. CEO → 2IC: Strategy breakdown');
    console.log(`     Model: ${this.config.layers['2ic'].model}, Budget: ${fmtBudget(this.config.layers['2ic'].maxBudgetUsd)}`);
    console.log('  2. 2IC → Eng Lead: Technical design');
    console.log(`     Model: ${this.config.layers['eng-lead'].model}, Budget: ${fmtBudget(this.config.layers['eng-lead'].maxBudgetUsd)}`);
    console.log('  3. Eng Lead → Team Lead: Issue creation + execution');
    console.log(`     Model: ${this.config.layers['team-lead'].model}, Budget: ${fmtBudget(this.config.layers['team-lead'].maxBudgetUsd)}`);
    console.log(`  4. Team Lead → Engineers: Cheenoski (max ${this.config.engineers.maxParallel} parallel)`);
    console.log('\n=== END DRY RUN ===\n');
  }

  /** Check if the cascade has exceeded its max duration */
  private isCascadeTimedOut(): boolean {
    if (this.cascadeStartedAt === 0) return false;
    const maxMs = this.config.maxCascadeDurationMs ?? 1_800_000;
    const elapsed = Date.now() - this.cascadeStartedAt;
    const percent = (elapsed / maxMs) * 100;

    // Emit warnings at 50%, 75%, 90% (once per threshold)
    if (percent >= 90 && !this.cascadeTimeoutWarningsShown.has(90)) {
      this.cascadeTimeoutWarningsShown.add(90);
      const elapsedMin = (elapsed / 60_000).toFixed(1);
      const maxMin = (maxMs / 60_000).toFixed(1);
      this.logger.warn(`⚠️  Cascade approaching timeout (90% - ${elapsedMin}min / ${maxMin}min)`);
      this.bus.emitEchelon({
        type: 'timeout_warning',
        role: 'ceo',
        elapsed,
        timeout: maxMs,
        percent: 90,
      });
    } else if (percent >= 75 && !this.cascadeTimeoutWarningsShown.has(75)) {
      this.cascadeTimeoutWarningsShown.add(75);
      const elapsedMin = (elapsed / 60_000).toFixed(1);
      const maxMin = (maxMs / 60_000).toFixed(1);
      this.logger.warn(`Cascade long-running (75% - ${elapsedMin}min / ${maxMin}min)`);
      this.bus.emitEchelon({
        type: 'timeout_warning',
        role: 'ceo',
        elapsed,
        timeout: maxMs,
        percent: 75,
      });
    } else if (percent >= 50 && !this.cascadeTimeoutWarningsShown.has(50)) {
      this.cascadeTimeoutWarningsShown.add(50);
      const elapsedMin = (elapsed / 60_000).toFixed(1);
      const maxMin = (maxMs / 60_000).toFixed(1);
      this.logger.info(`Cascade halfway through timeout (${elapsedMin}min / ${maxMin}min)`);
      this.bus.emitEchelon({
        type: 'timeout_warning',
        role: 'ceo',
        elapsed,
        timeout: maxMs,
        percent: 50,
      });
    }

    if (elapsed > maxMs) {
      const elapsedMin = (elapsed / 60_000).toFixed(1);
      const maxMin = (maxMs / 60_000).toFixed(0);
      this.logger.error(`Cascade timed out after ${elapsedMin}min (max: ${maxMin}min) — aborting gracefully`);
      return true;
    }
    return false;
  }

  /** Get real-time orchestrator status (command center API) */
  getStatus(): {
    status: string;
    activeCascade: boolean;
    totalCost: number;
    directive?: string;
    progress: {
      messagesExchanged: number;
      issuesCreated: number;
      pendingApprovals: number;
      elapsedMs: number;
    };
    agents: Record<string, { status: string; cost: number }>;
  } {
    const elapsed = this.cascadeStartedAt > 0 ? Date.now() - this.cascadeStartedAt : 0;

    const agentStats: Record<string, { status: string; cost: number }> = {};
    for (const role of ['2ic', 'eng-lead', 'team-lead'] as const) {
      const agent = this.state.agents[role];
      agentStats[role] = {
        status: agent?.status ?? 'idle',
        cost: agent?.totalCost ?? 0,
      };
    }

    return {
      status: this.state.status,
      activeCascade: this.cascadeRunning,
      totalCost: this.state.totalCost,
      directive: this.state.directive || undefined,
      progress: {
        messagesExchanged: this.state.messages.length,
        issuesCreated: this.state.issues.length,
        pendingApprovals: this.executor.getPending().length,
        elapsedMs: elapsed,
      },
      agents: agentStats,
    };
  }

  /** Print recovery suggestions when a layer fails */
  private printRecoverySuggestions(role: AgentRole, error: string): void {
    const errorLower = error.toLowerCase();

    this.logger.info('\n' + '─'.repeat(60));
    this.logger.info('🔧 Recovery Suggestions:\n');

    // Detect common error patterns and suggest fixes
    if (errorLower.includes('rate limit') || errorLower.includes('429')) {
      this.logger.info('   • Rate limit hit. Wait 60s and run: echelon --resume');
      this.logger.info('   • Or use --yolo mode for auto-retry with backoff\n');
    } else if (errorLower.includes('quota') || errorLower.includes('insufficient_quota')) {
      this.logger.info('   • API quota exceeded. Check limits at console.anthropic.com');
      this.logger.info('   • Or switch to lower-cost model in config (sonnet → haiku)\n');
    } else if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
      this.logger.info('   • Agent timeout. Increase maxTurns or timeoutMs in config');
      this.logger.info('   • Or simplify the directive and run: echelon --resume\n');
    } else if (errorLower.includes('budget') || errorLower.includes('cost')) {
      this.logger.info('   • Budget exceeded. Increase maxTotalBudgetUsd in config');
      this.logger.info('   • Or review state with: echelon status\n');
    } else if (errorLower.includes('gh:') || errorLower.includes('github')) {
      this.logger.info('   • GitHub CLI error. Check: gh auth status');
      this.logger.info('   • Or re-authenticate: gh auth login\n');
    } else if (errorLower.includes('anthropic') || errorLower.includes('api key')) {
      this.logger.info('   • API key issue. Check: echo $ANTHROPIC_API_KEY');
      this.logger.info('   • Or set it: export ANTHROPIC_API_KEY=sk-...\n');
    } else {
      this.logger.info('   • Check logs for details: ~/.echelon/logs/');
      this.logger.info('   • Resume session: echelon --resume');
      this.logger.info('   • Start fresh: echelon -d "your directive"\n');
    }

    this.logger.info('💡 Debug Commands:');
    this.logger.info('   echelon status          # Check current state');
    this.logger.info('   echelon sessions list   # View all sessions');
    this.logger.info('   echelon --resume        # Resume from checkpoint');
    this.logger.info('─'.repeat(60) + '\n');
  }

  /** Print helpful next steps after cascade completion */
  private printNextSteps(): void {
    const hasIssues = this.state.issues.length > 0;
    const hasPending = this.executor.getPending().length > 0;

    this.logger.info('\n' + '─'.repeat(60));
    this.logger.info('✓ Cascade complete! What\'s next?\n');

    if (hasPending) {
      this.logger.info('📋 Pending Approvals:');
      const pending = this.executor.getPending();
      for (const p of pending.slice(0, 3)) { // Show first 3
        this.logger.info(`   • ${p.description}`);
      }
      if (pending.length > 3) {
        this.logger.info(`   ... and ${pending.length - 3} more\n`);
      }
      this.logger.info('   Run: echelon --resume  (then approve actions in TUI)\n');
    }

    if (hasIssues) {
      this.logger.info('🎯 Next Steps:');
      this.logger.info('   1. Check the GitHub issues created for your project');
      this.logger.info('   2. Review and merge any PRs from Cheenoski');
      this.logger.info(`   3. Run: echelon status  (check progress anytime)\n`);
    }

    this.logger.info('💡 Quick Commands:');
    this.logger.info('   echelon              # Start new cascade (interactive)');
    this.logger.info('   echelon status       # Check cascade state');
    this.logger.info('   echelon --help       # Show all available commands');
    this.logger.info('   echelon sessions     # View all sessions');
    this.logger.info('─'.repeat(60) + '\n');
  }

  /** Check budget and emit warnings at 75%, 90%, 95% thresholds */
  private checkBudgetWarnings(): void {
    const percentage = (this.state.totalCost / this.config.maxTotalBudgetUsd) * 100;
    const thresholds = [75, 90, 95];

    for (const threshold of thresholds) {
      if (percentage >= threshold && !this.budgetWarningsShown.has(threshold)) {
        this.budgetWarningsShown.add(threshold);

        const remaining = this.config.maxTotalBudgetUsd - this.state.totalCost;
        const urgency = threshold >= 95 ? '🚨 CRITICAL' : threshold >= 90 ? '⚠️  WARNING' : '⚡ NOTICE';

        this.logger.warn(`${urgency}: Budget at ${threshold}%`, {
          spent: `$${this.state.totalCost.toFixed(4)}`,
          limit: `$${this.config.maxTotalBudgetUsd.toFixed(2)}`,
          remaining: `$${remaining.toFixed(4)}`,
          percentage: `${percentage.toFixed(1)}%`,
        });

        this.bus.emitEchelon({
          type: 'error',
          error: `Budget ${threshold}% exhausted — $${remaining.toFixed(2)} remaining`,
          role: '2ic', // Default to 2ic for orchestrator-level errors
        });

        // Auto-pause at 95% if not in yolo mode
        if (threshold >= 95 && !this.yolo) {
          this.logger.error('Auto-pausing at 95% budget threshold. Use --yolo to override.');
          this.state.status = 'paused';
          saveState(this.state);
        }
      }
    }
  }

  /** Graceful shutdown — kills Cheenoski subprocesses, saves state */
  /**
   * Gracefully shutdown the orchestrator.
   *
   * Terminates all Cheenoski subprocesses, saves state, writes transcript summary,
   * and removes signal handlers. The session can be resumed later with --resume.
   *
   * Called automatically on SIGINT/SIGTERM.
   */
  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info('Shutting down — killing subprocesses, saving state...');

    // Kill Cheenoski subprocesses
    this.executor.killAll();

    this.state.status = 'paused';
    saveState(this.state);
    this.transcript.writeSummary(this.state.totalCost, new Date(this.state.startedAt));
    this.bus.emitEchelon({ type: 'shutdown', reason: 'user' });
    this.logger.info('State saved. Resume with --resume flag.', {
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

  /**
   * Approve all pending actions in sequence.
   *
   * Used in headless mode or for batch approval workflows.
   *
   * @returns Array of execution results from each approved action
   */
  async approveAllPending(): Promise<string[]> {
    return this.executor.approveAll();
  }
}

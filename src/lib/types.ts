import { z } from 'zod';
import type { CheenoskiEvent } from '../cheenoski/types.js';
import { CheenoskiEngineConfigSchema } from '../cheenoski/types.js';

// --- Config Schemas ---

/**
 * Default maximum turns by model.
 *
 * Haiku needs more turns (produces less output per turn) compared to Opus/Sonnet.
 *
 * @category Configuration
 */
export const DEFAULT_MAX_TURNS: Record<string, number> = {
  opus: 5,
  sonnet: 8,
  haiku: 12,
};

/**
 * Configuration schema for a single layer (2IC, Eng Lead, or Team Lead).
 *
 * @category Configuration
 */
export const LayerConfigSchema = z.object({
  model: z.enum(['opus', 'sonnet', 'haiku']).default('sonnet'),
  maxBudgetUsd: z.number().positive().default(5.0),
  maxTurns: z.number().int().positive().optional(),
  requiresApproval: z.boolean().optional(),
  timeoutMs: z.number().positive().default(300_000),
});

/**
 * Project configuration schema.
 *
 * Defines the target repository and base branch for the orchestrator.
 *
 * @category Configuration
 */
export const ProjectConfigSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be owner/repo format'),
  path: z.string(),
  baseBranch: z.string().default('main'),
});

export const EngineersConfigSchema = CheenoskiEngineConfigSchema;

/** @deprecated Use EngineersConfigSchema (now powered by CheenoskiEngineConfigSchema) */
export const LegacyEngineersConfigSchema = z.object({
  maxParallel: z.number().int().positive().default(3),
  createPr: z.boolean().default(true),
  prDraft: z.boolean().default(true),
});

export const TelegramHealthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(3000),
  bindAddress: z.string().default('0.0.0.0'),
});

export const TelegramConfigSchema = z.object({
  token: z.string(),
  allowedUserIds: z.array(z.number().int()).default([]),
  health: TelegramHealthConfigSchema.optional(),
});
/**
 * Root Echelon configuration schema.
 *
 * Defines all settings for the orchestrator: project, layers, approval mode,
 * budget limits, and optional Telegram integration.
 *
 * @category Configuration
 */
export const EchelonConfigSchema = z.object({
  project: ProjectConfigSchema,
  layers: z.object({
    '2ic': LayerConfigSchema.default({}),
    'eng-lead': LayerConfigSchema.default({}),
    'team-lead': LayerConfigSchema.default({}),
  }).default({}),
  engineers: EngineersConfigSchema.default({}),
  approvalMode: z.enum(['destructive', 'all', 'none']).default('destructive'),
  maxTotalBudgetUsd: z.number().positive().default(50.0),
  maxCascadeDurationMs: z.number().positive().default(1_800_000),
  telegram: TelegramConfigSchema.optional(),
  billing: z.enum(['api', 'max']).default('api'),
});

/** @category Configuration */
export type EchelonConfig = z.infer<typeof EchelonConfigSchema>;
/** @category Configuration */
export type LayerConfig = z.infer<typeof LayerConfigSchema>;
/** @category Configuration */
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
/** @category Configuration */
export type EngineersConfig = z.infer<typeof EngineersConfigSchema>;
/** @category Configuration */
export type TelegramHealthConfig = z.infer<typeof TelegramHealthConfigSchema>;
/** @category Configuration */
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

// --- GitHub Rate Limiting ---

export const RateLimitStateSchema = z.object({
  remaining: z.number().int(),
  limit: z.number().int(),
  reset: z.number().int(), // Unix timestamp
});

export type RateLimitState = z.infer<typeof RateLimitStateSchema>;

// --- Layer Types ---

/**
 * Layer identifier (excludes CEO and engineers).
 * @category Types
 */
export type LayerId = '2ic' | 'eng-lead' | 'team-lead';

/**
 * All agent roles in the hierarchy.
 * @category Types
 */
export type AgentRole = LayerId | 'ceo' | 'engineer';

/**
 * Hierarchical order of agents (CEO → 2IC → Eng Lead → Team Lead → Engineer).
 * @category Types
 */
export const LAYER_ORDER: readonly AgentRole[] = ['ceo', '2ic', 'eng-lead', 'team-lead', 'engineer'] as const;

/**
 * Human-readable labels for each agent role.
 * @category Types
 */
export const LAYER_LABELS: Record<AgentRole, string> = {
  ceo: 'CEO',
  '2ic': '2IC',
  'eng-lead': 'Eng Lead',
  'team-lead': 'Team Lead',
  engineer: 'Engineer',
};

// --- Action Schemas ---

/**
 * Schema for a GitHub issue payload.
 * @category Actions
 */
export const IssuePayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
});

/**
 * Action to create GitHub issues.
 * @category Actions
 */
export const CreateIssuesActionSchema = z.object({
  action: z.literal('create_issues'),
  issues: z.array(IssuePayloadSchema).min(1),
});

export const InvokeCheenoskiActionSchema = z.object({
  action: z.literal('invoke_cheenoski'),
  label: z.string(),
  maxParallel: z.number().int().positive().optional(),
});

/** @deprecated Use InvokeCheenoskiActionSchema */
export const InvokeRalphyActionSchema = z.object({
  action: z.literal('invoke_ralphy'),
  label: z.string(),
  maxParallel: z.number().int().positive().optional(),
});

export const UpdatePlanActionSchema = z.object({
  action: z.literal('update_plan'),
  plan: z.string(),
  workstreams: z.array(z.string()).optional(),
});

export const RequestInfoActionSchema = z.object({
  action: z.literal('request_info'),
  target: z.enum(['2ic', 'eng-lead', 'team-lead', 'ceo']),
  question: z.string(),
});

export const EscalateActionSchema = z.object({
  action: z.literal('escalate'),
  reason: z.string(),
  decision_needed: z.string(),
});

export const RequestReviewActionSchema = z.object({
  action: z.literal('request_review'),
  pr_number: z.number().int().positive(),
  focus: z.string().optional(),
});

export const CreateBranchActionSchema = z.object({
  action: z.literal('create_branch'),
  branch_name: z.string(),
  from: z.string().optional(),
});

/**
 * Discriminated union of all action types.
 *
 * Actions are structured JSON blocks emitted by agents and parsed by the action parser.
 * Each action type has a unique `action` field for type narrowing.
 *
 * @category Actions
 */
export const ActionSchema = z.discriminatedUnion('action', [
  CreateIssuesActionSchema,
  InvokeCheenoskiActionSchema,
  InvokeRalphyActionSchema,
  UpdatePlanActionSchema,
  RequestInfoActionSchema,
  EscalateActionSchema,
  RequestReviewActionSchema,
  CreateBranchActionSchema,
]);

/**
 * Union type of all action objects.
 * @category Actions
 */
export type Action = z.infer<typeof ActionSchema>;

/**
 * GitHub issue payload type.
 * @category Actions
 */
export type IssuePayload = z.infer<typeof IssuePayloadSchema>;

// --- Messages ---

/**
 * Message sent between layers in the hierarchy.
 *
 * Messages contain narrative content, extracted actions, cost tracking,
 * and timing metadata. They are stored in the MessageBus history and
 * persisted to session state.
 *
 * @category Types
 */
export interface LayerMessage {
  id: string;
  from: AgentRole;
  to: AgentRole;
  content: string;
  actions: Action[];
  timestamp: string;
  costUsd: number;
  durationMs: number;
}

// --- Agent State ---

/**
 * Status of an agent during the cascade.
 * @category Types
 */
export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error' | 'done';

/**
 * Runtime state of a single agent.
 *
 * Tracks session ID, cost, turns, and errors for each layer.
 *
 * @category Types
 */
export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  sessionId: string | null;
  totalCost: number;
  turnsCompleted: number;
  lastError: string | null;
}

// --- Echelon State (persisted) ---

/**
 * Orchestrator state persisted to disk.
 *
 * Saved to `~/.echelon/sessions/<project-timestamp>/state.json` after each
 * agent turn. Enables session resumption with `--resume`.
 *
 * @category Types
 */
export interface EchelonState {
  sessionId: string;
  projectRepo: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  agents: Record<AgentRole, AgentState>;
  messages: LayerMessage[];
  plan: string | null;
  issues: TrackedIssue[];
  totalCost: number;
  startedAt: string;
  updatedAt: string;
  directive: string;
}

export interface TrackedIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: string[];
  assignedEngineer: string | null;
  prNumber: number | null;
}

// --- Approval ---

export interface PendingApproval {
  id: string;
  action: Action;
  from: AgentRole;
  description: string;
  timestamp: string;
}

// --- Claude CLI Output ---

export interface ClaudeJsonOutput {
  result: string;
  session_id: string;
  total_cost_usd?: number;
  duration_ms?: number;
  is_error?: boolean;
}

// --- CLI Options ---

export interface CliOptions {
  config: string;
  directive?: string;
  headless: boolean;
  dryRun: boolean;
  resume: boolean;
  verbose: boolean;
  telegram: boolean;
  approvalMode?: EchelonConfig['approvalMode'];
  yolo: boolean;
}

// --- Events ---

export type EchelonEvent =
  | { type: 'agent_status'; role: AgentRole; status: AgentStatus }
  | { type: 'message'; message: LayerMessage }
  | { type: 'action_pending'; approval: PendingApproval }
  | { type: 'action_executed'; action: Action; result: string }
  | { type: 'action_rejected'; approval: PendingApproval; reason: string }
  | { type: 'issue_created'; issue: TrackedIssue }
  | { type: 'cheenoski_progress'; label: string; line: string }
  | { type: 'error'; role: AgentRole; error: string }
  | { type: 'cost_update'; role: AgentRole; costUsd: number; totalUsd: number }
  | { type: 'state_saved'; path: string }
  | { type: 'cascade_complete'; directive: string }
  | { type: 'shutdown'; reason: string }
  | { type: 'github_rate_limit_exceeded'; state: RateLimitState; resetAt: string }
  | CheenoskiEvent;

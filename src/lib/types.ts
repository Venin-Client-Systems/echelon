import { z } from 'zod';
import type { CheenoskiEvent } from '../cheenoski/types.js';
import { CheenoskiEngineConfigSchema } from '../cheenoski/types.js';

// --- Config Schemas ---

/** Default max turns by model — haiku needs more turns (less per turn) */
export const DEFAULT_MAX_TURNS: Record<string, number> = {
  opus: 5,
  sonnet: 8,
  haiku: 12,
};

export const LayerConfigSchema = z.object({
  model: z.enum(['opus', 'sonnet', 'haiku']).default('sonnet'),
  maxBudgetUsd: z.number().positive().default(5.0),
  maxTurns: z.number().int().positive().optional(),
  requiresApproval: z.boolean().optional(),
  timeoutMs: z.number().positive().default(300_000),
});

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

export type EchelonConfig = z.infer<typeof EchelonConfigSchema>;
export type LayerConfig = z.infer<typeof LayerConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type EngineersConfig = z.infer<typeof EngineersConfigSchema>;
export type TelegramHealthConfig = z.infer<typeof TelegramHealthConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

// --- GitHub Rate Limiting ---

export const RateLimitStateSchema = z.object({
  remaining: z.number().int(),
  limit: z.number().int(),
  reset: z.number().int(), // Unix timestamp
});

export type RateLimitState = z.infer<typeof RateLimitStateSchema>;

// --- Layer Types ---

export type LayerId = '2ic' | 'eng-lead' | 'team-lead';
export type AgentRole = LayerId | 'ceo' | 'engineer';

export const LAYER_ORDER: readonly AgentRole[] = ['ceo', '2ic', 'eng-lead', 'team-lead', 'engineer'] as const;

export const LAYER_LABELS: Record<AgentRole, string> = {
  ceo: 'CEO',
  '2ic': '2IC',
  'eng-lead': 'Eng Lead',
  'team-lead': 'Team Lead',
  engineer: 'Engineer',
};

// --- Action Schemas ---

export const IssuePayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
});

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

export type Action = z.infer<typeof ActionSchema>;
export type IssuePayload = z.infer<typeof IssuePayloadSchema>;

// --- Messages ---

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

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error' | 'done';

export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  sessionId: string | null;
  totalCost: number;
  turnsCompleted: number;
  lastError: string | null;
}

// --- Echelon State (persisted) ---

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

import { z } from 'zod';

// --- Domains ---

export const DOMAINS = [
    'backend', 'frontend', 'database', 'infrastructure',
    'security', 'testing', 'documentation', 'billing',
] as const;

export type Domain = typeof DOMAINS[number];

export const DOMAIN_TITLE_TAGS: Record<string, Domain> = {
    '[Backend]': 'backend',
    '[Frontend]': 'frontend',
    '[Database]': 'database',
    '[Infra]': 'infrastructure',
    '[Security]': 'security',
    '[Tests]': 'testing',
    '[Docs]': 'documentation',
    '[Billing]': 'billing',
};

/** Domains that can safely run in parallel (no overlapping file paths) */
export const SAFE_PARALLEL_PAIRS: ReadonlySet<string> = new Set([
    'backend:frontend', 'frontend:backend',
    'backend:documentation', 'documentation:backend',
    'frontend:documentation', 'documentation:frontend',
    'testing:documentation', 'documentation:testing',
    'backend:testing', 'testing:backend',
    'frontend:testing', 'testing:frontend',
]);

// --- Engine Types ---

export const ENGINE_NAMES = ['claude', 'opencode', 'codex', 'cursor', 'qwen'] as const;

export type EngineName = typeof ENGINE_NAMES[number];

export const EngineResultSchema = z.object({
    success: z.boolean(),
    output: z.string(),
    toolsUsed: z.array(z.string()).default([]),
    filesChanged: z.array(z.string()).default([]),
    durationMs: z.number(),
    engineName: z.enum(ENGINE_NAMES),
    errorType: z.enum(['none', 'timeout', 'rate_limit', 'crash', 'stuck', 'no_code_changes']).default('none'),
    rawExitCode: z.number().nullable().default(null),
});

export type EngineResult = z.infer<typeof EngineResultSchema>;

export interface EngineRunner {
    readonly name: EngineName;
    run(opts: EngineRunOptions): Promise<EngineResult>;
    kill(): void;
}

export interface EngineRunOptions {
    prompt: string;
    cwd: string;
    timeoutMs: number;
    issueNumber: number;
    /** Extra context from CHEENOSKI_LESSONS.md etc. */
    lessonsContext?: string;
}

export type SlotStatus = 'pending' | 'running' | 'merging' | 'done' | 'failed' | 'blocked';

export interface Slot {
    id: number;
    issueNumber: number;
    issueTitle: string;
    issueBody: string;
    domain: Domain | 'unknown';
    labels: string[];
    status: SlotStatus;
    branchName: string;
    worktreePath: string | null;
    engineName: EngineName;
    attempt: number;
    maxRetries: number;
    result: EngineResult | null;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    prNumber: number | null;
}

export interface SchedulerState {
    slots: Slot[];
    windowSize: number;
    activeCount: number;
    completedCount: number;
    failedCount: number;
    totalIssues: number;
}

export interface CheenoskiIssue {
    number: number;
    title: string;
    body: string;
    labels: string[];
    state: 'open' | 'closed';
    assignees: string[];
    url: string;
}

export interface ProjectBoardConfig {
    projectNumber: number;
    statusField?: string;
    batchField?: string;
    branchField?: string;
}

export interface LedgerEntry {
    timestamp: string;
    action: 'create' | 'merge' | 'delete' | 'abandon';
    branch: string;
    worktree: string | null;
    issueNumber: number;
    pid: number;
    detail: string;
}

export interface InstanceLock {
    pid: number;
    label: string;
    startedAt: string;
    hostname: string;
    issues: number[];
}

// --- Config Extensions ---

export const CheenoskiEngineConfigSchema = z.object({
    engine: z.enum(ENGINE_NAMES).default('claude'),
    fallbackEngines: z.array(z.enum(ENGINE_NAMES)).default([]),
    maxParallel: z.number().int().positive().default(3),
    createPr: z.boolean().default(true),
    prDraft: z.boolean().default(true),
    projectBoard: z.object({
        projectNumber: z.number().int().positive(),
        statusField: z.string().optional(),
        batchField: z.string().optional(),
        branchField: z.string().optional(),
    }).optional(),
    stuckWarningMs: z.number().positive().default(120_000),
    hardTimeoutMs: z.number().positive().default(600_000),
    maxRetries: z.number().int().min(0).default(2),
    maxSlotDurationMs: z.number().positive().default(600_000),
});

export type CheenoskiEngineConfig = z.infer<typeof CheenoskiEngineConfigSchema>;

export interface CheenoskiSlotFillEvent {
    type: 'cheenoski_slot_fill';
    slot: Slot;
}

export interface CheenoskiSlotDoneEvent {
    type: 'cheenoski_slot_done';
    slot: Slot;
}

export interface CheenoskiDashboardEvent {
    type: 'cheenoski_dashboard';
    state: SchedulerState;
}

export interface CheenoskiMergeEvent {
    type: 'cheenoski_merge';
    slot: Slot;
    success: boolean;
    error?: string;
}

export interface CheenoskiPrCreatedEvent {
    type: 'cheenoski_pr_created';
    slot: Slot;
    prNumber: number;
    prUrl: string;
}

export interface CheenoskiEngineSwitch {
    type: 'cheenoski_engine_switch';
    slot: Slot;
    from: EngineName;
    to: EngineName;
    reason: string;
}

export interface CheenoskiCompleteEvent {
    type: 'cheenoski_complete';
    label: string;
    stats: {
        total: number;
        succeeded: number;
        failed: number;
        blocked: number;
        durationMs: number;
        prsCreated: number;
    };
}

export type CheenoskiEvent =
    | CheenoskiSlotFillEvent
    | CheenoskiSlotDoneEvent
    | CheenoskiDashboardEvent
    | CheenoskiMergeEvent
    | CheenoskiPrCreatedEvent
    | CheenoskiEngineSwitch
    | CheenoskiCompleteEvent;

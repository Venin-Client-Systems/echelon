# Echelon Architecture

This document provides visual diagrams of Echelon's core architectural flows and state machines.

## Cascade Flow

The cascade is the main orchestration loop that flows directives through the management hierarchy:

```mermaid
graph TD
    Start([CEO Directive]) --> Budget{Budget<br/>Available?}
    Budget -->|No| Stop([Abort: Budget Exceeded])
    Budget -->|Yes| 2IC[2IC: Strategic Planning]

    2IC --> Parse2IC[Parse Actions]
    Parse2IC --> Exec2IC[Execute Actions:<br/>update_plan, request_info]
    Exec2IC --> Validate2IC{Valid<br/>Output?}
    Validate2IC -->|No| Fail2IC([Cascade Failed])
    Validate2IC -->|Yes| Timeout1{Cascade<br/>Timeout?}

    Timeout1 -->|Yes| TimeoutFail1([Abort: Timeout])
    Timeout1 -->|No| Lead[Eng Lead: Technical Design]

    Lead --> ParseLead[Parse Actions]
    ParseLead --> ExecLead[Execute Actions:<br/>update_plan, create_branch, request_info]
    ExecLead --> ValidateLead{Valid<br/>Output?}
    ValidateLead -->|No| FailLead([Cascade Failed])
    ValidateLead -->|Yes| InfoReq1{Info<br/>Requests?}

    InfoReq1 -->|Yes| Loopback1[Resume 2IC for Answers]
    Loopback1 --> ResumeEL[Resume Eng Lead]
    ResumeEL --> Timeout2{Cascade<br/>Timeout?}
    InfoReq1 -->|No| Timeout2

    Timeout2 -->|Yes| TimeoutFail2([Abort: Timeout])
    Timeout2 -->|No| TeamLead[Team Lead: Execution]

    TeamLead --> ParseTL[Parse Actions]
    ParseTL --> ExecTL[Execute Actions:<br/>create_issues, invoke_cheenoski]
    ExecTL --> ValidateTL{Valid<br/>Output?}
    ValidateTL -->|No| FailTL([Cascade Failed])
    ValidateTL -->|Yes| InfoReq2{Info<br/>Requests?}

    InfoReq2 -->|Yes| Loopback2[Resume Eng Lead for Answers]
    Loopback2 --> ResumeTL[Resume Team Lead]
    ResumeTL --> Pending{Pending<br/>Approvals?}
    InfoReq2 -->|No| Pending

    Pending -->|Yes| WaitApproval[Log Pending Actions]
    Pending -->|No| Complete([Cascade Complete])
    WaitApproval --> Complete

    style Start fill:#e1f5e1
    style Complete fill:#e1f5e1
    style Stop fill:#ffe1e1
    style Fail2IC fill:#ffe1e1
    style FailLead fill:#ffe1e1
    style FailTL fill:#ffe1e1
    style TimeoutFail1 fill:#ffe1e1
    style TimeoutFail2 fill:#ffe1e1
```

**Key Decision Points:**

1. **Budget Checks** — Before each layer, verify both per-layer and total budget (skipped if `billing: 'max'`)
2. **Output Validation** — Ensure non-empty content and valid cost before proceeding downstream
3. **Info Request Loopback** — Layers can ask upstream questions, resuming sessions bidirectionally (max 2 rounds)
4. **Cascade Timeout** — Hard timeout (default 30min) to prevent infinite loops
5. **Pending Approvals** — Actions queue in `approvalMode: 'destructive'` or `'all'`

## Action Lifecycle

Every action block emitted by agents follows this execution flow:

```mermaid
graph TD
    Agent[Agent Response] --> Extract[Extract JSON Blocks]
    Extract --> ParseJSON{Valid<br/>JSON?}

    ParseJSON -->|No| Skip1([Skip Block])
    ParseJSON -->|Yes| Validate{Valid Action<br/>Schema?}

    Validate -->|No| Skip2([Skip Block])
    Validate -->|Yes| Filter{Role<br/>Allowed?}

    Filter -->|No| Drop([Drop with Warning])
    Filter -->|Yes| DryRun{Dry Run<br/>Mode?}

    DryRun -->|Yes| LogDry([Log Dry Run])
    DryRun -->|No| ApprovalCheck{Needs<br/>Approval?}

    ApprovalCheck -->|Yes: all| Queue([Queue for Approval])
    ApprovalCheck -->|Yes: destructive<br/>+ create_issues/invoke_cheenoski/create_branch| Queue
    ApprovalCheck -->|No: none| Execute[Execute Action]

    Queue --> WaitCEO{CEO<br/>Action?}
    WaitCEO -->|Approve| Execute
    WaitCEO -->|Reject| Reject([Emit action_rejected])

    Execute --> Dispatch{Action Type}

    Dispatch -->|create_issues| GH[gh issue create]
    Dispatch -->|invoke_cheenoski| Scheduler[Spawn Scheduler]
    Dispatch -->|create_branch| Git[git branch + worktree]
    Dispatch -->|request_review| ReviewGH[gh pr review]
    Dispatch -->|update_plan| State[Update State.plan]
    Dispatch -->|request_info| Info([Return Info Request])
    Dispatch -->|escalate| Escalate([Return Escalation])

    GH --> Track[Track Issue in State]
    Track --> EmitCreated
    Scheduler --> EmitExec
    Git --> EmitExec
    ReviewGH --> EmitExec
    State --> EmitExec
    Info --> EmitExec
    Escalate --> EmitExec

    EmitCreated[Emit issue_created] --> Done([Execution Complete])
    EmitExec[Emit action_executed] --> Done

    style Skip1 fill:#f9f9f9
    style Skip2 fill:#f9f9f9
    style Drop fill:#fff4e1
    style Reject fill:#ffe1e1
    style Done fill:#e1f5e1
    style LogDry fill:#e1f0ff
```

**Key Decision Points:**

1. **JSON Parsing** — Regex extracts ` ```json ` blocks, invalid JSON silently skipped
2. **Schema Validation** — Zod discriminated union validates `action` field + parameters
3. **Role Filter** — 2IC/Eng Lead/Team Lead have specific allowed actions (e.g., Team Lead can't `update_plan`)
4. **Approval Mode**:
   - `none` — Auto-execute all
   - `destructive` — Queue `create_issues`, `invoke_cheenoski`, `create_branch`
   - `all` — Queue everything
5. **Dispatch** — Routes to specialized handlers in `src/actions/`

## Scheduler State Machine

The Cheenoski scheduler manages parallel code execution slots:

```mermaid
stateDiagram-v2
    [*] --> Pending: Issue Added to Queue

    Pending --> Running: Slot Available<br/>+ Domain Compatible
    Pending --> Blocked: Loop Detected
    Pending --> Skipped: Already In Progress<br/>(Assigned/WIP)

    Running --> Running: Engine Executing<br/>(within timeout)
    Running --> StuckWarning: Elapsed > stuckWarningMs<br/>(120s default)
    StuckWarning --> Running: Still Progressing
    StuckWarning --> Killed: Elapsed > maxSlotDurationMs<br/>(600s default)

    Running --> Merging: Success + Changes Detected
    Running --> Retry: Engine Failed<br/>(attempt < maxRetries)
    Running --> Failed: Engine Failed<br/>(max retries exhausted)
    Running --> Failed: Rate Limited<br/>(all engines exhausted)
    Running --> Retry: No Changes Detected<br/>(stuck result)

    Killed --> Retry: attempt < maxRetries
    Killed --> Failed: max retries exhausted

    Retry --> Pending: Cleanup Worktree

    Merging --> PRCreation: Merge Success<br/>+ createPr: true
    Merging --> Done: Merge Success<br/>+ createPr: false
    Merging --> Retry: Merge Failed<br/>(attempt < maxRetries)
    Merging --> Failed: Merge Failed<br/>(max retries exhausted)

    PRCreation --> Done: PR Created
    PRCreation --> Done: PR Failed<br/>(issue still closed)

    Done --> [*]: Issue Closed<br/>+ Lessons Merged
    Failed --> [*]: Issue Commented<br/>+ Worktree Cleaned
    Blocked --> [*]: Issue Blocked
    Skipped --> [*]: Issue Skipped

    note right of Pending
        Domain compatibility check:
        - Backend || Frontend: parallel OK
        - Database || Infra: serial only
        - Unknown: serial only
    end note

    note right of Running
        Hard timeout kills engine process.
        runSlot() catch handler retries.
    end note

    note right of Merging
        Mutex prevents concurrent merges
        to the same base branch.
    end note
```

**Key Decision Points:**

1. **Slot Assignment** — Pick next issue compatible with running domains (parallel backend + frontend, serial database/infra)
2. **Loop Detection** — Skip issues closed/reopened multiple times
3. **In Progress Check** — Skip issues already assigned or labeled `WIP`
4. **Stuck Warning** — Warn at 120s, then every 60s
5. **Hard Timeout** — Kill engine at 600s (configurable), triggers retry
6. **Change Detection** — Tool use analysis + `git diff` fallback
7. **Merge Mutex** — Serial merges to prevent race conditions
8. **Retry Logic** — Up to `maxRetries` (default 2) on failure/stuck/merge conflict
9. **PR Creation** — Optional, draft mode supported

## Budget Flow

Budget checks happen at multiple levels:

```mermaid
graph LR
    A[Before Layer Start] --> B{Layer Budget<br/>Exceeded?}
    B -->|Yes| C([Skip Layer])
    B -->|No| D{Total Budget<br/>Exceeded?}
    D -->|Yes| C
    D -->|No| E[Spawn/Resume Agent]
    E --> F[Update Costs]
    F --> G{billing: 'max'?}
    G -->|Yes| H([Estimated Cost])
    G -->|No| I([Real Cost])
```

**Budget enforcement is skipped when `billing: 'max'`** (unlimited Claude plan).

## Error Handling

Agent errors trigger cascading failure handling:

```mermaid
graph TD
    Error[Agent Error] --> Classify{Error Type}
    Classify -->|Rate Limit| Backoff[Exponential Backoff<br/>+ Retry]
    Classify -->|Timeout| Circuit{Circuit<br/>Breaker?}
    Classify -->|Crash| LogStack[Log Stack Trace]
    Classify -->|Quota| Stop([Abort Cascade])

    Circuit -->|Open<br/>(5+ failures)| Stop
    Circuit -->|Closed| Backoff

    LogStack --> MarkFailed[Mark Agent as 'error']
    MarkFailed --> SaveState[Save State]
    SaveState --> EmitError[Emit 'error' event]
    EmitError --> Abort([Cascade Failed])

    Backoff --> Retry{Retry<br/>Successful?}
    Retry -->|Yes| Continue([Continue Cascade])
    Retry -->|No| LogStack

    style Stop fill:#ffe1e1
    style Abort fill:#ffe1e1
    style Continue fill:#e1f5e1
```

**Error recovery** is built into `agent.ts` with exponential backoff, jitter, and circuit breaker pattern.

## State Persistence

All orchestrator state persists to `~/.echelon/sessions/<project-timestamp>/state.json`:

```json
{
  "sessionId": "echelon-owner-repo-20250115-103045",
  "status": "running" | "paused" | "completed" | "failed",
  "agents": {
    "2ic": { "sessionId": "claude-abc123", "totalCost": 0.05, ... },
    "eng-lead": { ... },
    "team-lead": { ... }
  },
  "messages": [ /* LayerMessage[] */ ],
  "issues": [ /* TrackedIssue[] */ ],
  "plan": "Strategic plan text",
  "totalCost": 0.15,
  "directive": "Original CEO directive",
  "startedAt": "2025-01-15T10:30:45Z"
}
```

**Session resumption** (`echelon --resume`) reloads state and resumes each agent via Claude session IDs.

## MessageBus Event Flow

All system events flow through the MessageBus (sync `EventEmitter`):

```mermaid
graph TD
    Orch[Orchestrator] --> Bus((MessageBus))
    Exec[ActionExecutor] --> Bus
    Sched[Scheduler] --> Bus

    Bus --> UI[TUI React Hooks]
    Bus --> Logger[Structured Logger]
    Bus --> Transcript[Markdown Transcript]

    UI --> Render[Terminal Render]
    Logger --> File[~/.echelon/logs/]
    Transcript --> MD[session/transcript.md]

    Bus -.->|agent_status| Orch
    Bus -.->|message| Orch
    Bus -.->|action_pending| Exec
    Bus -.->|action_executed| Logger
    Bus -.->|issue_created| UI
    Bus -.->|cheenoski_progress| Logger
    Bus -.->|cost_update| UI
    Bus -.->|error| Logger
```

**Events** are defined in `src/lib/types.ts` as a discriminated union (`EchelonEvent`).

## Git Worktree Flow

Cheenoski uses isolated worktrees for parallel execution:

```mermaid
graph TD
    Start([Issue Assigned to Slot]) --> Create[git worktree add<br/>~/.echelon/worktrees/...]
    Create --> PropLessons[Copy LESSONS.md<br/>to worktree]
    PropLessons --> Engine[Run Claude/Aider<br/>in worktree CWD]
    Engine --> Check{Changes<br/>Detected?}

    Check -->|No| Cleanup1[git worktree remove]
    Cleanup1 --> Retry{Retry?}
    Retry -->|Yes| Create
    Retry -->|No| End1([Failed])

    Check -->|Yes| Merge[git merge worktree branch<br/>into base branch]
    Merge --> MergeOK{Success?}

    MergeOK -->|No| Cleanup2[git worktree remove]
    Cleanup2 --> Retry

    MergeOK -->|Yes| MergeLessons[Copy LESSONS.md<br/>back to main repo]
    MergeLessons --> PR{createPr?}

    PR -->|Yes| CreatePR[gh pr create --draft]
    PR -->|No| CleanupFinal[git worktree remove]

    CreatePR --> CleanupFinal
    CleanupFinal --> Close[gh issue close]
    Close --> End2([Done])

    style End1 fill:#ffe1e1
    style End2 fill:#e1f5e1
```

**Worktrees** are ephemeral — always cleaned up in `finally` blocks to prevent orphaned directories.

## Domain Parallelization

Issues are tagged with domain labels for smart parallelization:

| Domain | Parallel With | Serial With |
|--------|---------------|-------------|
| `backend` | `frontend`, `tests`, `docs` | `database`, `infrastructure` |
| `frontend` | `backend`, `tests`, `docs` | `database`, `infrastructure` |
| `database` | — | Everything (serial only) |
| `infrastructure` | — | Everything (serial only) |
| `security` | `tests`, `docs` | `backend`, `frontend`, `database`, `infrastructure` |
| `tests` | All except `database`, `infrastructure` | `database`, `infrastructure` |
| `docs` | All except `database`, `infrastructure` | `database`, `infrastructure` |

**Scheduler** checks `canRunParallel(domain1, domain2)` before filling slots.

## File References

- **Cascade**: `src/core/orchestrator.ts:86-225` (runCascade)
- **Action Lifecycle**: `src/core/action-parser.ts`, `src/core/action-executor.ts`
- **Scheduler**: `src/cheenoski/scheduler.ts:88-141` (run method)
- **State Machine**: `src/cheenoski/scheduler.ts:289-526` (runSlot)
- **Budget Checks**: `src/core/recovery.ts`
- **Domain Logic**: `src/cheenoski/domain.ts`
- **Git Worktrees**: `src/cheenoski/git/worktree.ts`

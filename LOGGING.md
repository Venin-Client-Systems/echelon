# Structured Logging with Context Propagation

This document describes the enhanced structured logging system implemented for Echelon.

## Features

### 1. Context Propagation

The logger now supports creating child loggers with inherited context:

```typescript
import { logger, generateCorrelationId } from '../lib/logger.js';

// Root logger
const orchestratorLogger = logger.child({
  sessionId: state.sessionId,
  correlationId: generateCorrelationId(),
  component: 'orchestrator',
});

// Layer-specific child logger
const layerLogger = orchestratorLogger.child({ role: '2ic' });
layerLogger.info('Processing directive');
// Output: [timestamp] INFO  [orchestrator|2ic] Processing directive

// Slot-specific child logger
const slotLogger = schedulerLogger.child({ slot: 5, issueNumber: 42 });
slotLogger.info('Starting work');
// Output: [timestamp] INFO  [scheduler|#42|slot:5] Starting work
```

### 2. JSON Output Format

Set `LOG_FORMAT=json` to enable machine-readable JSON logs for production monitoring:

```typescript
// Text format (default)
[12:34:56.789] INFO  [orchestrator|2ic] Starting cascade {"directive":"Add auth"}

// JSON format (LOG_FORMAT=json)
{"timestamp":"2026-02-18T12:34:56.789Z","level":"info","message":"Starting cascade","context":{"sessionId":"abc123","correlationId":"xyz789","component":"orchestrator","role":"2ic"},"directive":"Add auth"}
```

### 3. Structured Error Logging

Errors now include type classification, stack traces, and session IDs for debugging:

```typescript
logger.errorWithType(
  'Agent spawn failed',
  'rate_limit',  // Error type: rate_limit, timeout, crash, validation, network, quota_exceeded, unknown
  error,
  { sessionId: 'abc123' }
);
```

JSON output:
```json
{
  "timestamp": "2026-02-18T12:34:56.789Z",
  "level": "error",
  "message": "Agent spawn failed",
  "context": {
    "sessionId": "abc123",
    "correlationId": "xyz789",
    "component": "orchestrator",
    "role": "2ic"
  },
  "error": {
    "type": "rate_limit",
    "message": "Rate limit exceeded: 429",
    "stack": "Error: Rate limit exceeded...",
    "sessionId": "abc123"
  }
}
```

### 4. Correlation IDs

Each orchestrator run generates a unique correlation ID that flows through all layers, making it easy to trace a directive through the entire cascade:

```typescript
const correlationId = generateCorrelationId(); // Returns 12-char nanoid
const logger = logger.child({ correlationId });
```

All logs from that cascade will include the same `correlationId`, enabling grep/filter queries:

```bash
# Find all logs for a specific cascade
jq 'select(.context.correlationId == "abc123xyz789")' logs.jsonl

# Find all errors in a session
jq 'select(.level == "error" and .context.sessionId == "session-456")' logs.jsonl
```

### 5. Log Sampling

High-volume events are sampled in production to reduce noise:

```typescript
import { shouldLogSampledEvent } from '../lib/logger.js';

if (shouldLogSampledEvent('cheenoski_slot_done')) {
  logger.debug('Slot completed', { slot: slot.id });
}
```

Sample rates (production only, dev logs everything):
- `cheenoski_slot_done`: 10% (1 in 10)
- `cheenoski_progress`: 5% (1 in 20)

Errors and warnings are **never sampled**.

## Context Fields

Standard context fields:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Echelon session ID (persists across resume) |
| `correlationId` | string | Unique ID for a single cascade run |
| `component` | string | Component name (orchestrator, scheduler, etc.) |
| `role` | string | Agent layer role (2ic, eng-lead, team-lead) |
| `issueNumber` | number | GitHub issue number being processed |
| `slot` | number | Scheduler slot ID |

## Usage Examples

### Orchestrator

```typescript
// Create root logger with session context
this.logger = logger.child({
  sessionId: this.state.sessionId,
  correlationId: this.correlationId,
  component: 'orchestrator',
});

// Create layer-specific child logger
const layerLogger = this.logger.child({ role });
layerLogger.info('Layer started', { cost: 0.05, duration: 2.5 });
```

### Scheduler

```typescript
// Create scheduler logger
this.logger = logger.child({
  component: 'scheduler',
  cheenoskiLabel: label,
});

// Create slot-specific logger
const slotLogger = this.logger.child({ slot: slot.id, issueNumber: slot.issueNumber });
slotLogger.error('Slot failed', { attempt: 2, error: err.message });
```

### Error Handling

```typescript
try {
  await riskyOperation();
} catch (err) {
  if (err instanceof Error) {
    layerLogger.errorWithType('Operation failed', 'crash', err, {
      sessionId: agentState.sessionId,
    });
  } else {
    layerLogger.error('Operation failed', { error: String(err) });
  }
}
```

## Migration Guide

### Before

```typescript
logger.info('Starting work on issue', { issue: 42 });
```

### After

```typescript
const issueLogger = logger.child({ issueNumber: 42 });
issueLogger.info('Starting work');
```

The context fields automatically appear in all logs from that logger.

## Environment Variables

- `LOG_LEVEL`: Set minimum log level (debug, info, warn, error). Default: `info`
- `LOG_FORMAT`: Set to `json` for JSON output. Default: text format
- `NODE_ENV`: When set to `production`, enables log sampling

## PII Compliance

The logger **never logs**:
- Issue bodies (only titles and numbers)
- User credentials
- API keys
- Personal identifiable information

Only metadata and operational context are logged.

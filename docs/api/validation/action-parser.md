# Action Parser Validation

The action parser (`src/core/action-parser.ts`) extracts and validates structured JSON action blocks from agent responses. It handles complex edge cases like embedded backticks, malformed JSON, and mixed narrative content.

---

## Table of Contents

- [Overview](#overview)
- [Core Functions](#core-functions)
  - [parseActions()](#parseactions)
  - [stripActionBlocks()](#stripactionblocks)
- [Progressive Parsing Algorithm](#progressive-parsing-algorithm)
- [Validation with ActionSchema](#validation-with-actionschema)
- [Edge Cases](#edge-cases)
- [Examples](#examples)
- [Integration](#integration)

---

## Overview

Agents communicate by emitting **action blocks** embedded in natural language responses:

```markdown
Here's my plan for authentication:

```json
{
  "action": "update_plan",
  "plan": "Implement JWT-based authentication with refresh tokens"
}
```

I'll break this into issues:

```json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT authentication",
      "body": "## Overview\n...",
      "labels": ["backend", "ralphy-1"]
    }
  ]
}
```
```

The action parser:
1. **Extracts** all JSON blocks from the response
2. **Validates** each block against `ActionSchema` (Zod discriminated union)
3. **Separates** narrative text from action blocks
4. **Reports** validation errors without crashing

---

## Core Functions

### parseActions()

**Signature:**
```typescript
function parseActions(text: string): {
  actions: Action[];
  narrative: string;
  errors: string[];
}
```

**Purpose:**
Extract and validate all JSON action blocks from agent response text.

**Returns:**
- `actions` — Array of validated action objects
- `narrative` — Response text with action blocks removed
- `errors` — Array of validation error messages

**Example:**
```typescript
import { parseActions } from './core/action-parser.js';

const response = `
I'll create a branch for this work:

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "feature/jwt-auth",
  "from": "main"
}
\`\`\`

Then I'll create the issues.
`;

const { actions, narrative, errors } = parseActions(response);

console.log(actions);
// [{ action: 'create_branch', branch_name: 'feature/jwt-auth', from: 'main' }]

console.log(narrative);
// "I'll create a branch for this work:\n\nThen I'll create the issues."

console.log(errors);
// []
```

**Implementation Details:**

**Lines 28-102** in `src/core/action-parser.ts`:

1. **Find all ` ```json ` openers** with regex (line 35-36)
2. **For each opener**, find all subsequent ` ``` ` closers (line 40-43)
3. **Try parsing progressively longer blocks** until `JSON.parse()` succeeds (line 47-86)
4. **Check if parsed object has `action` field** (line 54-58)
5. **Validate with `ActionSchema.safeParse()`** (line 60-67)
6. **Collect validation errors** without throwing (line 64-66)
7. **Track block ranges** for narrative extraction (line 71-72)
8. **Build narrative** by removing all action block ranges (line 94-100)

---

### stripActionBlocks()

**Signature:**
```typescript
function stripActionBlocks(text: string): string
```

**Status:** ⚠️ **Deprecated** — Use `parseActions()` instead, which returns both actions and narrative in one pass.

**Purpose:**
Remove action blocks from text to extract the narrative portion. Kept for backwards compatibility but performs redundant regex parsing.

**Example:**
```typescript
import { stripActionBlocks } from './core/action-parser.js';

const response = `
I'll create issues:

\`\`\`json
{"action": "create_issues", "issues": [...]}
\`\`\`

This is my reasoning.
`;

const narrative = stripActionBlocks(response);
console.log(narrative);
// "I'll create issues:\n\nThis is my reasoning."
```

**Implementation:** Lines 130-169 use the same progressive matching strategy as `parseActions()`.

---

## Progressive Parsing Algorithm

The parser uses a **progressive matching strategy** to handle embedded backticks in JSON strings (e.g., code examples in issue bodies).

### The Problem

Agent responses can contain code blocks inside JSON strings:

```json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT implementation",
      "body": "## Example\n```typescript\nconst token = jwt.sign(payload);\n```",
      "labels": ["backend"]
    }
  ]
}
```

**Challenge:** The embedded ` ``` ` inside the JSON string can confuse a naive parser that matches the first ` ``` ` as the closing fence.

### The Solution

**Progressive matcher** tries each subsequent ` ``` ` until `JSON.parse()` succeeds:

```
Input:
```json
{"body": "```typescript\ncode\n```"}
```

Step 1: Try parsing from opener to first closer (FAILS)
  Block: {"body": "```typescript
  JSON.parse() → SyntaxError

Step 2: Try parsing from opener to second closer (FAILS)
  Block: {"body": "```typescript\ncode
  JSON.parse() → SyntaxError

Step 3: Try parsing from opener to third closer (SUCCESS)
  Block: {"body": "```typescript\ncode\n```"}
  JSON.parse() → Valid object
```

### Algorithm Diagram

```
Text: "... ```json\n{...}\n``` ..."
      ^           ^     ^
      opener      |     closer candidates
                  contentStart

For each opener:
  contentStart = opener.index + opener.length
  For each closer after contentStart:
    block = text[contentStart:closer.index]
    Try JSON.parse(block)
      ✓ Success → Validate with ActionSchema
      ✗ Failure → Try next closer
```

**Key Code (lines 47-86):**

```typescript
while ((closerMatch = closerRegex.exec(text)) !== null) {
  const block = text.slice(contentStart, closerMatch.index).trim();
  try {
    const json = JSON.parse(block);

    // Check for 'action' field
    const items = Array.isArray(json) ? json : [json];
    let hasAction = false;

    for (const item of items) {
      if (!item || typeof item !== 'object' || !('action' in item)) continue;
      hasAction = true;

      // Validate against ActionSchema
      const result = ActionSchema.safeParse(item);
      if (result.success) {
        actions.push(result.data);
      } else {
        const errMsg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        errors.push(`Invalid action "${item.action}": ${errMsg}`);
      }
    }

    if (hasAction) {
      // Record range for narrative extraction
      actionBlockRanges.push([openerMatch.index, closerMatch.index + closerMatch[0].length]);
      openerRegex.lastIndex = closerMatch.index + closerMatch[0].length;
      parsed = true;
      break;
    }
  } catch {
    // JSON.parse failed — try next closer
    continue;
  }
}
```

---

## Validation with ActionSchema

All actions are validated against `ActionSchema`, a Zod **discriminated union** defined in `src/lib/types.ts` (lines 210-218):

```typescript
export const ActionSchema = z.discriminatedUnion('action', [
  CreateIssuesActionSchema,      // action: 'create_issues'
  InvokeCheenoskiActionSchema,   // action: 'invoke_cheenoski'
  UpdatePlanActionSchema,        // action: 'update_plan'
  RequestInfoActionSchema,       // action: 'request_info'
  EscalateActionSchema,          // action: 'escalate'
  RequestReviewActionSchema,     // action: 'request_review'
  CreateBranchActionSchema,      // action: 'create_branch'
]);
```

### Discriminated Union Pattern

The `action` field is the **discriminator** — it must be a **literal** value for type narrowing:

**Correct:**
```typescript
export const CreateIssuesActionSchema = z.object({
  action: z.literal('create_issues'),  // Literal for discrimination
  issues: z.array(IssuePayloadSchema).min(1),
});
```

**Incorrect:**
```typescript
export const CreateIssuesActionSchema = z.object({
  action: z.enum(['create_issues']),  // ❌ Breaks discriminated union!
  issues: z.array(IssuePayloadSchema).min(1),
});
```

### Validation Process

**Step 1:** Parse JSON block
```typescript
const json = JSON.parse(block);  // Could be object or array
```

**Step 2:** Normalize to array
```typescript
const items = Array.isArray(json) ? json : [json];
```

**Step 3:** Check for `action` field
```typescript
for (const item of items) {
  if (!item || typeof item !== 'object' || !('action' in item)) continue;
  // ...
}
```

**Step 4:** Validate with ActionSchema
```typescript
const result = ActionSchema.safeParse(item);
if (result.success) {
  actions.push(result.data);  // Type-safe Action object
} else {
  // Collect validation errors
  const errMsg = result.error.issues
    .map(i => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  errors.push(`Invalid action "${item.action}": ${errMsg}`);
}
```

### Validation Error Examples

**Missing required field:**
```json
{"action": "create_issues"}
```
**Error:** `Invalid action "create_issues": issues: Required`

---

**Wrong field type:**
```json
{"action": "invoke_cheenoski", "label": 123}
```
**Error:** `Invalid action "invoke_cheenoski": label: Expected string, received number`

---

**Invalid discriminator:**
```json
{"action": "unknown_action"}
```
**Error:** `Invalid action "unknown_action": Invalid discriminator value. Expected 'create_issues' | 'invoke_cheenoski' | ...`

---

**Invalid nested field:**
```json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] Auth",
      "body": "",
      "labels": "backend"  // ❌ Should be array
    }
  ]
}
```
**Error:** `Invalid action "create_issues": issues.0.labels: Expected array, received string`

---

## Edge Cases

The action parser handles several complex edge cases gracefully:

### 1. Embedded Backticks in JSON Strings

**Input:**
```json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT implementation",
      "body": "## Example\n```typescript\nconst token = jwt.sign(payload);\n```\n\nImplement this pattern.",
      "labels": ["backend"]
    }
  ]
}
```

**Handling:** Progressive matcher tries each ` ``` ` until full block parses successfully.

**Code:** Lines 47-86 implement the progressive matching loop.

---

### 2. Malformed JSON

**Input:**
```json
{
  "action": "update_plan",
  "plan": "Implement auth",  // ❌ Trailing comma
}
```

**Handling:** `JSON.parse()` throws, parser tries next closer. If all closers fail, block is skipped and logged.

**Code (line 83-86):**
```typescript
} catch {
  // JSON.parse failed — try the next ``` closer
  continue;
}
```

**Log:** `Skipped unclosed or unparseable JSON block in agent response` (line 90)

---

### 3. Non-Action JSON Blocks

**Input:**
```markdown
Here's an example config:

```json
{
  "layers": {
    "2ic": {"model": "sonnet"}
  }
}
```
```

**Handling:** Parser checks for `action` field (line 57). If missing, block is skipped without error.

**Code (lines 54-58):**
```typescript
for (const item of items) {
  if (!item || typeof item !== 'object' || !('action' in item)) continue;
  hasAction = true;
  // ...
}
```

---

### 4. Multiple Action Blocks in One Response

**Input:**
```markdown
I'll update the plan first:

```json
{"action": "update_plan", "plan": "Phase 1: Auth"}
```

Then create issues:

```json
{
  "action": "create_issues",
  "issues": [...]
}
```
```

**Handling:** While-loop (line 38) processes all ` ```json ` openers sequentially.

**Result:**
- `actions` contains both validated actions
- `narrative` has both blocks removed
- `actionBlockRanges` tracks positions of both blocks

---

### 5. Array of Actions in Single Block

**Input:**
```json
[
  {"action": "create_branch", "branch_name": "feature/auth"},
  {"action": "update_plan", "plan": "Phase 1"}
]
```

**Handling:** Normalize to array (line 53), iterate and validate each item.

**Code (lines 51-66):**
```typescript
const items = Array.isArray(json) ? json : [json];
let hasAction = false;

for (const item of items) {
  if (!item || typeof item !== 'object' || !('action' in item)) continue;
  hasAction = true;

  const result = ActionSchema.safeParse(item);
  if (result.success) {
    actions.push(result.data);
  } else {
    // ...validation error handling
  }
}
```

---

## Examples

### Example 1: Valid Single Action

**Input:**
```typescript
const text = `
I'll create a branch for this work:

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "feature/jwt-auth",
  "from": "main"
}
\`\`\`

This will allow parallel development.
`;

const { actions, narrative, errors } = parseActions(text);
```

**Output:**
```typescript
actions = [
  {
    action: 'create_branch',
    branch_name: 'feature/jwt-auth',
    from: 'main'
  }
];

narrative = "I'll create a branch for this work:\n\nThis will allow parallel development.";

errors = [];
```

---

### Example 2: Multiple Actions with Validation Error

**Input:**
```typescript
const text = `
First, update the plan:

\`\`\`json
{"action": "update_plan", "plan": "Implement auth system"}
\`\`\`

Then create issues:

\`\`\`json
{
  "action": "create_issues",
  "issues": "not-an-array"
}
\`\`\`
`;

const { actions, narrative, errors } = parseActions(text);
```

**Output:**
```typescript
actions = [
  {
    action: 'update_plan',
    plan: 'Implement auth system'
  }
];

narrative = "First, update the plan:\n\nThen create issues:";

errors = [
  'Invalid action "create_issues": issues: Expected array, received string'
];
```

---

### Example 3: Embedded Backticks

**Input:**
```typescript
const text = `
Create an issue with code examples:

\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT implementation",
      "body": "## Example\\n\`\`\`typescript\\nconst token = jwt.sign(payload);\\n\`\`\`",
      "labels": ["backend"]
    }
  ]
}
\`\`\`
`;

const { actions, narrative, errors } = parseActions(text);
```

**Output:**
```typescript
actions = [
  {
    action: 'create_issues',
    issues: [
      {
        title: '[Backend] JWT implementation',
        body: '## Example\n```typescript\nconst token = jwt.sign(payload);\n```',
        labels: ['backend']
      }
    ]
  }
];

narrative = "Create an issue with code examples:";

errors = [];
```

**Parsing Steps:**
1. Find ` ```json ` opener at position 35
2. Try first ` ``` ` at position 150 → `JSON.parse()` fails (incomplete)
3. Try second ` ``` ` at position 180 → `JSON.parse()` fails (incomplete)
4. Try third ` ``` ` at position 210 → `JSON.parse()` succeeds ✓
5. Validate with `ActionSchema` → success ✓

---

### Example 4: Non-Action JSON Block

**Input:**
```typescript
const text = `
Here's the config structure:

\`\`\`json
{
  "project": {
    "repo": "owner/repo",
    "baseBranch": "main"
  }
}
\`\`\`

This is just for reference.
`;

const { actions, narrative, errors } = parseActions(text);
```

**Output:**
```typescript
actions = [];  // No 'action' field found

narrative = "Here's the config structure:\n\nThis is just for reference.";

errors = [];
```

---

## Integration

### Usage in Orchestrator

**File:** `src/core/orchestrator.ts` (line 12)

```typescript
import { parseActions } from './action-parser.js';
```

**After agent response:**
```typescript
// Get response from agent
const response = await agent.generate(prompt);

// Parse actions and narrative
const { actions, narrative, errors } = parseActions(response.content);

// Log validation errors
if (errors.length > 0) {
  logger.warn('Action validation errors', { errors });
}

// Store in LayerMessage
const message: LayerMessage = {
  id: generateId(),
  from: currentLayer,
  to: nextLayer,
  content: narrative,  // Narrative only
  actions,             // Validated actions
  timestamp: new Date().toISOString(),
  costUsd: response.costUsd,
  durationMs: response.durationMs,
};

// Execute actions via ActionExecutor
for (const action of actions) {
  await actionExecutor.executeOrQueue(action, currentLayer, dryRun);
}
```

### LayerMessage Structure

**File:** `src/lib/types.ts` (lines 243-252)

```typescript
export interface LayerMessage {
  id: string;
  from: AgentRole;
  to: AgentRole;
  content: string;      // Narrative (action blocks removed)
  actions: Action[];    // Validated actions
  timestamp: string;
  costUsd: number;
  durationMs: number;
}
```

**Storage:**
- Messages are stored in `EchelonState.messages` array
- Persisted to `~/.echelon/sessions/<project-timestamp>/state.json`
- Used for session resumption and audit trails

---

## Performance Considerations

### Regex Efficiency

The parser uses **stateful regex** with `lastIndex` to avoid re-matching already processed blocks:

```typescript
// Advance regex past matched block
openerRegex.lastIndex = closerMatch.index + closerMatch[0].length;
```

**Why:** Without this, the regex would re-match the same ` ```json ` on the next iteration, causing infinite loops or duplicate parsing.

### Progressive Parsing Complexity

**Worst case:** `O(n * m)` where:
- `n` = number of ` ```json ` openers
- `m` = number of ` ``` ` closers after each opener

**Typical case:** `O(n)` — most blocks parse on first or second closer attempt.

**Optimization:** The parser stops trying closers as soon as `JSON.parse()` succeeds (line 76: `break`).

---

## Testing

### Unit Tests

**Location:** `src/lib/__tests__/action-parser.test.ts` (if exists)

**Test cases:**
- Single valid action block
- Multiple action blocks
- Embedded backticks in JSON strings
- Malformed JSON (trailing commas, unquoted keys)
- Non-action JSON blocks
- Array of actions in single block
- Validation errors (missing fields, wrong types)
- Empty input
- Input with no action blocks

**Example test:**
```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseActions } from '../core/action-parser.js';

describe('parseActions', () => {
  it('handles embedded backticks in JSON strings', () => {
    const text = `
\`\`\`json
{
  "action": "create_issues",
  "issues": [{
    "title": "Test",
    "body": "\`\`\`typescript\\ncode\\n\`\`\`",
    "labels": []
  }]
}
\`\`\`
    `;

    const { actions, errors } = parseActions(text);

    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, 'create_issues');
    assert.equal(errors.length, 0);
  });
});
```

---

## Debugging

### Enable Verbose Logging

**CLI:**
```bash
echelon -c config.json -d "..." --verbose
```

**Log output:**
```
[DEBUG] Skipped unclosed or unparseable JSON block in agent response
[WARN] Action validation failed { action: 'create_issues', error: 'issues: Required' }
```

### Common Issues

**Issue:** Actions not being extracted

**Causes:**
- Using ` ```typescript ` instead of ` ```json `
- Malformed JSON in all closure attempts
- Missing `action` field

**Solution:** Check agent system prompts enforce ` ```json ` fences.

---

**Issue:** Validation errors for valid-looking actions

**Causes:**
- Action type not in `ActionSchema` discriminated union
- Field type mismatch (string vs number, object vs array)
- Missing required fields

**Solution:** Compare against schema in `src/lib/types.ts`.

---

**Issue:** Narrative contains partial action blocks

**Causes:**
- Regex lastIndex not advancing correctly
- Overlapping block ranges

**Solution:** Check `actionBlockRanges` tracking (lines 71-72, 94-100).

---

## Related Documentation

- **[Types Reference](../types.md)** — ActionSchema and all action type definitions
- **[Action Executor](./action-executor.md)** — Action dispatch and approval queue
- **[Orchestrator](./orchestrator.md)** — Main cascade loop integration
- **[System Prompts](./prompts.md)** — Agent instructions for emitting actions

---

## Summary

The action parser is a **robust, fault-tolerant system** for extracting structured commands from free-form agent responses. Key features:

✅ **Progressive parsing** handles embedded backticks in JSON strings
✅ **Zod validation** ensures type safety with discriminated unions
✅ **Graceful error handling** skips malformed blocks without crashing
✅ **Narrative extraction** separates natural language from action blocks
✅ **Stateful regex** avoids re-matching processed blocks

**Critical requirements:**
- Action blocks MUST use ` ```json ` fences (not ` ```typescript ` or other)
- All actions MUST have an `action` field matching ActionSchema discriminator
- Validation errors are collected, not thrown — orchestrator decides how to handle

For implementation details, see `src/core/action-parser.ts` (lines 28-169).

# ROUND 7 AUDIT - LINE-BY-LINE & LOGIC ANALYSIS

**Objective**: Line-by-line code review + logic bug analysis

**Status**: **3 CRITICAL BUGS FOUND** (2 resource leaks + 1 logic bug)

---

## 🔴 CRITICAL BUGS (3 Found)

### 1. **Telegram Handler Promise.race Timeout Leak** - Resource Leak (2 instances)
**Files**: `src/telegram/handler.ts:172-183` and `src/telegram/handler.ts:239-250`
**Impact**: Memory leak, dangling timers after successful API calls

```typescript
// CURRENT CODE (BUGGY):
try {
  response = await Promise.race([
    client.messages.create({...}),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Claude API timeout')), API_TIMEOUT_MS)  // ❌ Timer never cleared
    ),
  ]);
} catch (err) {
  // ...
}
```

**Problem**:
- Promise.race() returns as soon as the first promise settles
- If the API call succeeds first, the race resolves with the response
- **But the setTimeout() timer is still running!**
- The timer will fire 2 minutes later and call reject(), but the promise is already settled
- This creates a dangling timer that wastes memory
- With multiple Telegram messages, this accumulates many leaked timers

**Impact**:
- Memory leak in long-running Telegram bot sessions
- Each API call leaks a 2-minute timer
- After 100 messages, there are 100 orphaned timers
- Node.js event loop is cluttered with dead timers

**Fix**:
```typescript
try {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  response = await Promise.race([
    client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: ceoTools,
      messages: messages as Anthropic.Messages.MessageParam[],
    }),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Claude API timeout')), API_TIMEOUT_MS);
    }),
  ]);

  // API call succeeded - clear the timeout
  if (timeoutId) clearTimeout(timeoutId);
} catch (err) {
  // Clear timeout on error too
  if (timeoutId) clearTimeout(timeoutId);
  const msg = err instanceof Error ? err.message : String(err);
  throw new Error(`Claude API error: ${sanitizeError(msg)}`);
}
```

**Alternative fix** (AbortController pattern):
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

try {
  response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    tools: ceoTools,
    messages: messages as Anthropic.Messages.MessageParam[],
    signal: controller.signal,  // Pass abort signal
  });
} finally {
  clearTimeout(timeoutId);
}
```

**Occurrences**: 2 instances in handler.ts
- Lines 172-183 (first API call)
- Lines 239-250 (tool use loop API call)

Both need the same fix.

---

### 2. **Missing Loopback Resolution for 2IC** - Logic Bug
**File**: `src/core/orchestrator.ts:154-178`
**Impact**: 2IC cannot ask CEO for clarification, questions are silently ignored

```typescript
// CURRENT CODE (BUGGY):
async runCascade(directive: string): Promise<void> {
  try {
    // Phase 1: CEO → 2IC (strategy)
    this.state.cascadePhase = 'strategy';
    saveState(this.state);
    const strategyMsg = await this.runLayer('2ic', 'ceo', directive);
    if (this.shuttingDown) {
      this.state.status = 'paused';
      saveState(this.state);
      return;
    }
    if (!strategyMsg) {
      if (this.state.status === 'running') this.state.status = 'failed';
      saveState(this.state);
      return;
    }

    if (!this.validateLayerOutput(strategyMsg)) {
      this.logger.error('Strategy message validation failed — aborting cascade');
      this.state.status = 'failed';
      saveState(this.state);
      return;
    }

    // ❌ BUG: No loopback resolution for 2IC!
    // If 2IC emitted request_info with target='ceo', the question is never answered.

    // Check cascade timeout before Phase 2
    if (this.isCascadeTimedOut()) {
      // ...
    }

    // Phase 2: 2IC → Eng Lead (technical design)
    this.state.cascadePhase = 'design';
    saveState(this.state);
    const designInput = await this.buildDownwardPrompt(strategyMsg);
    let designMsg = await this.runLayer('eng-lead', '2ic', designInput);
    // ...

    // Loopback: if Eng Lead asked 2IC questions, answer them
    designMsg = await this.resolveInfoRequests(designMsg, 'eng-lead');  // ✓ Has loopback
    // ...

    // Phase 3: Eng Lead → Team Lead (execution)
    // ...
    execMsg = await this.resolveInfoRequests(execMsg, 'team-lead');  // ✓ Has loopback
  }
}
```

**Problem**:
- The cascade supports `request_info` actions where agents can ask each other questions
- Eng Lead can ask 2IC questions → loopback resolution exists (line 212)
- Team Lead can ask Eng Lead questions → loopback resolution exists (line 256)
- **BUT 2IC cannot ask CEO questions → NO loopback resolution!**
- If 2IC emits `{action: 'request_info', target: 'ceo', question: '...'}`, it's silently ignored
- The cascade proceeds to Phase 2 without answering the question

**Logic Flow**:
```
CEO → 2IC (strategy)
  2IC thinks...
  2IC emits: {action: 'request_info', target: 'ceo', question: 'Should we use GraphQL or REST?'}
  ❌ No resolveInfoRequests() called
  Cascade continues to Phase 2 with unanswered question
2IC → Eng Lead (design)
  Eng Lead thinks...
  Eng Lead emits: {action: 'request_info', target: '2ic', question: 'Which database?'}
  ✓ resolveInfoRequests(designMsg, 'eng-lead') called
  CEO is prompted to answer, Eng Lead gets answer
Eng Lead → Team Lead (execution)
  Team Lead thinks...
  Team Lead emits: {action: 'request_info', target: 'eng-lead', question: 'API version?'}
  ✓ resolveInfoRequests(execMsg, 'team-lead') called
  CEO is prompted to answer, Team Lead gets answer
```

**Impact**:
- 2IC cannot ask CEO for clarification
- If 2IC is uncertain about strategy direction, it cannot request guidance
- Asymmetric behavior: lower layers can ask questions, top layer cannot
- Violates the design principle that agents should escalate when uncertain

**Fix**:
```typescript
async runCascade(directive: string): Promise<void> {
  try {
    // Phase 1: CEO → 2IC (strategy)
    this.state.cascadePhase = 'strategy';
    saveState(this.state);
    let strategyMsg = await this.runLayer('2ic', 'ceo', directive);
    if (this.shuttingDown) {
      this.state.status = 'paused';
      saveState(this.state);
      return;
    }
    if (!strategyMsg) {
      if (this.state.status === 'running') this.state.status = 'failed';
      saveState(this.state);
      return;
    }

    if (!this.validateLayerOutput(strategyMsg)) {
      this.logger.error('Strategy message validation failed — aborting cascade');
      this.state.status = 'failed';
      saveState(this.state);
      return;
    }

    // ✓ FIX: Add loopback resolution for 2IC
    strategyMsg = await this.resolveInfoRequests(strategyMsg, '2ic');
    if (this.shuttingDown) {
      this.state.status = 'paused';
      saveState(this.state);
      return;
    }
    if (!strategyMsg) {
      if (this.state.status === 'running') this.state.status = 'failed';
      saveState(this.state);
      return;
    }

    // Check cascade timeout before Phase 2
    if (this.isCascadeTimedOut()) {
      // ...
    }

    // Continue to Phase 2...
  }
}
```

**Why This Is Critical**:
- The entire Echelon architecture is based on hierarchical communication
- Agents are supposed to escalate when uncertain
- 2IC is the strategic layer - it needs to ask CEO for guidance on high-level decisions
- Without loopback, 2IC must make assumptions, leading to poor strategy
- Inconsistency breaks the symmetry of the design

---

## Summary

**Round 7 Findings**:
- 3 critical bugs (2 resource leaks + 1 logic bug)
- Resource leak: ~100 leaked timers after 100 Telegram messages
- Logic bug: 2IC cannot request CEO clarification

**Total Bugs Across All Rounds**:
- **Rounds 1-6**: 33 bugs (28 fixed, 5 documented)
- **Round 7**: 3 bugs (Promise.race leaks x2 + 2IC loopback missing)
- **TOTAL**: 36 bugs identified

**Files to Fix**:
```
src/telegram/handler.ts          # Fix Promise.race timeout leaks (2 instances)
src/core/orchestrator.ts         # Add loopback resolution for 2IC
```

---

## File Size Analysis

**Largest files**:
```
762 lines: src/core/orchestrator.ts         # Main cascade logic
611 lines: src/cheenoski/scheduler.ts       # Parallel execution
362 lines: src/lib/types.ts                 # Type definitions
356 lines: src/commands/init.ts             # Config wizard
343 lines: src/telegram/bot.ts              # Telegram integration
336 lines: src/core/error-boundaries.ts     # Circuit breaker
318 lines: src/lib/github-client.ts         # API client
```

**Recommendation**:
- orchestrator.ts (762 lines) is getting large but not critically so
- scheduler.ts (611 lines) could benefit from splitting into:
  - scheduler.ts (main loop)
  - slot-runner.ts (individual slot execution)
  - But this is a refactor, not a bug

---

## Additional Analysis

### Edge Cases Verified
- ✓ slice() operations on short strings - safe (returns whole string)
- ✓ Array access with bounds checking - mostly safe
- ✓ parseInt/JSON.parse with try/catch - all protected
- ✓ AsyncMutex implementation - correct FIFO queue logic
- ✓ Retry loop off-by-one errors - fixed in Round 5

### Logic Consistency Checks
- ❌ **2IC loopback missing** - FOUND (see bug #2)
- ✓ Eng Lead loopback present
- ✓ Team Lead loopback present
- ✓ Action filtering consistent
- ✓ Budget tracking consistent

### Resource Leak Checks
- ❌ **Promise.race timeout leaks** - FOUND (see bug #1)
- ✓ Event listeners cleaned up
- ✓ File handles closed
- ✓ Process spawns have cleanup
- ✓ Timers cleared (except Promise.race bug)

---

## Impact Assessment

### Before Fixes
- ❌ Memory leak in Telegram bot (100 timers after 100 messages)
- ❌ 2IC cannot ask CEO for clarification
- ❌ Asymmetric loopback behavior

### After Fixes
- ✅ Timers properly cleaned up
- ✅ All layers can ask upward questions
- ✅ Symmetric loopback behavior
- ✅ No resource leaks

---

## Testing Plan

1. **Test Promise.race timeout cleanup:**
   ```typescript
   it('should clear timeout when API call succeeds', async () => {
     const activeTi mers = process._getActiveHandles().length;
     await handleMessage('test directive', config);
     expect(process._getActiveHandles().length).toBe(activeTimers);
   });
   ```

2. **Test 2IC loopback:**
   ```typescript
   it('should resolve 2IC info requests to CEO', async () => {
     // Mock 2IC emitting request_info
     // Verify resolveInfoRequests is called
     // Verify CEO gets prompted for answer
   });
   ```

3. **Integration test:**
   - Start Telegram bot
   - Send 100 messages
   - Check heap usage (should not grow linearly)
   - Verify no timer leaks

---

*Audit conducted: 2026-02-18*
*Zero tolerance for bugs continues...*

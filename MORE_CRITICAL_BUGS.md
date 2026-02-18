# MORE CRITICAL BUGS FOUND

## Summary

Found **7 additional critical bugs** after the "Not good enough" audit. These range from memory leaks to retry logic inconsistencies.

---

## NEW SHOWSTOPPER BUGS (3 Found)

### 1. **Memory Leak in ActionExecutor** - Unbounded Array Growth
**File**: `src/core/action-executor.ts:46`
**Impact**: Memory leak across multiple cascade runs

```typescript
private cheenoskiKillHandles: Array<{ label: string; kill: () => void }> = [];

case 'invoke_cheenoski': {
  this.cheenoskiKillHandles.push({ label: action.label, kill: handle.kill });
  // ❌ NEVER REMOVED until killAll() on shutdown
}
```

**Problem**:
- Array grows unbounded with each `invoke_cheenoski` action
- `killAll()` only called during orchestrator shutdown
- If you run multiple cascades in one session, dead handles accumulate
- Each handle references a subprocess that may have already exited

**Example**:
```typescript
// Session 1: invoke_cheenoski for ralphy-1 → array has 1 handle
// Session 2: invoke_cheenoski for ralphy-2 → array has 2 handles (ralphy-1 is DEAD but still in array)
// Session 3: invoke_cheenoski for ralphy-3 → array has 3 handles (only ralphy-3 is alive)
```

**Fix**: Remove handles when Cheenoski completes, not just on shutdown.

---

### 2. **Retry Loop Off-By-One Inconsistency** - Confusing Semantics
**Files**:
- `src/core/recovery.ts:40`
- `src/cheenoski/scheduler.ts:300`

**Problem**: Two different retry loop conventions in the same codebase!

**recovery.ts** (1-indexed):
```typescript
for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
  try {
    return await fn();
  } catch (err) {
    if (attempt >= config.maxRetries) {
      logger.error(`${label}: all ${config.maxRetries} retries exhausted`);
      throw err;
    }
    // ❌ BUG: Logging says "attempt X/${maxRetries + 1}" which is WRONG
    logger.warn(`${label}: attempt ${attempt}/${config.maxRetries + 1} failed, retrying...`);
  }
}
```

With `maxRetries = 3`:
- Logs: "attempt 1/**4** failed", "attempt 2/**4** failed", "all **3** retries exhausted"
- This is inconsistent! Says "4 total attempts" then "3 retries exhausted"

**scheduler.ts** (0-indexed):
```typescript
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  // ... work ...
  if (attempt < maxRetries) {
    slotLogger.warn(`Merge failed, retrying (attempt ${attempt + 1}/${maxRetries})`);
    continue;
  }
  // ❌ BUG: Says "attempt 1/2" suggesting 1 out of 2 attempts, but maxRetries=2 means 3 total attempts
  await commentOnIssue(..., `Cheenoski failed after ${maxRetries + 1} attempts.`);
}
```

With `maxRetries = 2`:
- Loop runs: attempt = 0, 1, 2 (3 iterations)
- Logs: "attempt 1/**2**" on first retry, then "failed after **3** attempts"
- Inconsistent! Says "1/2" then "3 attempts"

**Root cause**: `maxRetries` is ambiguous. Does it mean:
- (A) Total attempts?
- (B) Additional retries after first attempt?

Current code implements (B) but logging suggests (A).

**Fix**:
1. Rename `maxRetries` → `maxAttempts` everywhere
2. Fix logging to be consistent
3. Use same loop convention everywhere (prefer 0-indexed)

---

### 3. **Domain Detection Called Twice Per Issue** - Wasted Computation
**File**: `src/cheenoski/scheduler.ts:222, 265`

```typescript
// pickNextIssue() - Line 222
for (let i = 0; i < this.issueQueue.length; i++) {
  const issue = this.issueQueue[i];
  const domain = detectDomain(issue); // ❌ Call #1
  // ... compatibility check ...
}

// createSlot() - Line 265
private async createSlot(issue: CheenoskiIssue): Promise<Slot | null> {
  // ...
  const domain = detectDomain(issue); // ❌ Call #2 (same issue!)
  // ...
}
```

**Problem**:
- `detectDomain()` is called **twice** for the same issue
- First in `pickNextIssue()` when selecting from queue
- Again in `createSlot()` when creating the slot
- The function does regex matching on title/body (not free)
- Result is always the same for a given issue

**Impact**: Wastes ~0.1-0.5ms per issue (small but unnecessary)

**Fix**: Pass domain from `pickNextIssue()` to `createSlot()`, or cache in issue object.

---

## SERIOUS BUGS (4 Found)

### 4. **Cleanup Sets worktreePath = null Even if Removal Fails** - Orphaned Worktrees
**File**: `src/cheenoski/scheduler.ts:541-544`
**Status**: Already documented in HACKATHON_READY.md #4, but not fixed

```typescript
private async cleanupSlotWorktree(slot: Slot): Promise<void> {
  if (slot.worktreePath) {
    try {
      await removeWorktree(...);
    } catch (err) {
      slotLogger.warn(`Failed to cleanup worktree: ${err}`);
    } finally {
      // ❌ BUG: Always clears path even if removal failed
      slot.worktreePath = null;
    }
  }
}
```

**Problem**:
- If `removeWorktree()` throws, the worktree is still on disk
- But `slot.worktreePath = null` makes us forget where it is
- Orphaned worktrees accumulate in `/tmp/cheenoski-worktrees/`

**Fix**: Only set `worktreePath = null` if removal succeeds:
```typescript
await removeWorktree(...);
slot.worktreePath = null; // Move outside try/catch
```

---

### 5. **runningSlots Memory Leak** - Unbounded Map if Promises Hang
**File**: `src/cheenoski/scheduler.ts:64, 201-206`
**Status**: Already documented in HACKATHON_READY.md #2, but not fixed

```typescript
private runningSlots = new Map<number, Promise<void>>();

// In fillSlots():
const slotPromise = this.runSlot(slot).catch(...);
this.runningSlots.set(slot.id, slotPromise);
slotPromise.finally(() => {
  this.runningSlots.delete(slot.id);
  // ❌ BUG: If promise hangs indefinitely, finally never runs
});
```

**Problem**:
- If `runSlot()` promise hangs forever (e.g., engine crashes without exiting), the entry stays in the map
- Map grows unbounded over long sessions
- Memory leak (small but real)

**Fix**: Wrap `runSlot()` with timeout:
```typescript
const timeoutPromise = Promise.race([
  this.runSlot(slot),
  sleep(this.config.engineers.hardTimeoutMs + 10_000).then(() => {
    throw new Error('Slot timed out');
  }),
]);
```

---

### 6. **Scheduler fillSlots Reentrancy Guard** - Breaks Parallelism
**File**: `src/cheenoski/scheduler.ts:169-170`
**Status**: Already documented in HACKATHON_READY.md #3, but not fixed

```typescript
private async fillSlots(): Promise<void> {
  if (this.filling) return; // ❌ BUG: Reentrancy guard prevents concurrent fills
  this.filling = true;
  try {
    // Fill slots...
  } finally {
    this.filling = false;
  }
}
```

**Problem**:
- Guard prevents concurrent `fillSlots()` calls
- If `fillSlots()` is called while already filling, it returns immediately
- This can delay slot filling after a slot completes
- **Why does this matter?** Slots call `fillSlots()` on completion (line 531), but if another `fillSlots()` is already running from `tick()` (line 587), the completion-triggered fill is skipped

**Impact**: Slots may fill serially instead of in parallel during high concurrency

**Fix**: Use a queue instead of a simple guard, or rethink coordination

---

### 7. **Merge Mutex Scope Too Narrow** - Doesn't Protect Full Sequence
**File**: `src/cheenoski/scheduler.ts:381-393`
**Status**: Already documented in HACKATHON_READY.md #1, but not fixed

```typescript
// Merge back — acquire mutex
slot.status = 'merging';
this.emitDashboard();

await this.mergeMutex.acquire(); // ❌ Lock only protects merge, not PR creation + close
let mergeResult;
try {
  mergeResult = await mergeBranch(...);
} finally {
  this.mergeMutex.release(); // ❌ Released before PR creation + issue close
}

if (mergeResult.success) {
  // ❌ RACE: No mutex protection here!
  if (this.config.engineers.createPr) {
    const pr = await createPullRequest(...); // Could race with another slot
  }
  await closeIssue(...); // Could race with another slot
}
```

**Problem**:
- Mutex only protects the `mergeBranch()` call
- PR creation and issue closing happen **outside** the mutex
- Two slots merging at the same time could create conflicting PRs

**Impact**: Low — rare in practice, but possible race condition

**Fix**: Expand mutex scope to cover merge → PR → close sequence

---

## Impact Summary

### Before Fixes
❌ **Memory leaks** in long-running sessions (kill handles, runningSlots)
❌ **Inconsistent retry semantics** confuse developers and logs
❌ **Wasted CPU** on duplicate domain detection
❌ **Orphaned worktrees** accumulate in /tmp
❌ **Race conditions** in parallel merge workflows
❌ **Degraded parallelism** from reentrancy guard

### After Fixes
✅ **Clean memory management** - no leaks
✅ **Consistent retry logic** across codebase
✅ **Optimized domain detection** - called once per issue
✅ **Reliable cleanup** - no orphaned worktrees
✅ **Proper mutex scope** - full sequence protected
✅ **Better parallelism** - reworked coordination

---

## Priority

**Fix NOW before hackathon:**
1. ✅ Memory leak in ActionExecutor (showstopper for long sessions)
2. ✅ Retry loop inconsistency (confusing logs will look bad)
3. ✅ Domain detection double-call (low-hanging optimization fruit)

**Can wait until after demo:**
4. Cleanup doesn't retry on failure (edge case)
5. runningSlots memory leak (only if promises hang indefinitely)
6. Scheduler fill reentrancy (rare performance issue)
7. Merge mutex scope (very rare race condition)

---

## Files to Fix

```
src/core/action-executor.ts     # Kill handle leak
src/core/recovery.ts             # Retry loop logging
src/cheenoski/scheduler.ts       # Retry loop + domain detection + cleanup
src/cheenoski/domain.ts          # Add caching (optional optimization)
```

---

## Recommended Fixes

### 1. ActionExecutor Kill Handle Leak

```typescript
// Track Cheenoski runs with completion callbacks
case 'invoke_cheenoski': {
  const handle = invokeCheenoski(
    action.label,
    this.config,
    action.maxParallel,
    this.bus,
    (line) => this.bus.emitEchelon({ type: 'cheenoski_progress', label: action.label, line }),
  );

  const killHandle = { label: action.label, kill: handle.kill };
  this.cheenoskiKillHandles.push(killHandle);

  // Remove handle when Cheenoski completes
  handle.onComplete(() => {
    const idx = this.cheenoskiKillHandles.indexOf(killHandle);
    if (idx !== -1) this.cheenoskiKillHandles.splice(idx, 1);
  });

  return `Cheenoski invoked for label: ${action.label}`;
}
```

**Requires**: Update `invokeCheenoski()` to return `{ kill, onComplete }` instead of just `{ kill }`.

### 2. Retry Loop Consistency

**Standardize on 0-indexed loops everywhere:**

```typescript
// recovery.ts
for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
  try {
    return await fn();
  } catch (err) {
    if (attempt >= config.maxAttempts - 1) {
      logger.error(`${label}: all ${config.maxAttempts} attempts exhausted`);
      throw err;
    }
    logger.warn(`${label}: attempt ${attempt + 1}/${config.maxAttempts} failed, retrying...`);
  }
}

// scheduler.ts - keep as-is (already 0-indexed), just rename
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  // ...
  if (attempt < maxAttempts - 1) {
    slotLogger.warn(`Attempt ${attempt + 1}/${maxAttempts} failed, retrying`);
    continue;
  }
  await commentOnIssue(..., `Cheenoski failed after ${maxAttempts} attempts.`);
}
```

### 3. Domain Detection Optimization

```typescript
// In pickNextIssue(), return both issue and domain:
private pickNextIssue(): { issue: CheenoskiIssue; domain: Domain | 'unknown' } | null {
  const runningDomains = this.slots
    .filter(s => s.status === 'running')
    .map(s => s.domain);

  for (let i = 0; i < this.issueQueue.length; i++) {
    const issue = this.issueQueue[i];
    const domain = detectDomain(issue); // Only called once now

    const compatible = runningDomains.every(rd => canRunParallel(rd, domain));
    if (compatible || runningDomains.length === 0) {
      this.issueQueue.splice(i, 1);
      return { issue, domain };
    }
  }

  if (this.issueQueue.length > 0 && this.getActiveSlotCount() === 0) {
    const issue = this.issueQueue.shift()!;
    return { issue, domain: detectDomain(issue) };
  }

  return null;
}

// In fillSlots(), destructure:
const next = this.pickNextIssue();
if (!next) break;
const { issue, domain } = next;

// In createSlot(), accept domain as param:
const slot = await this.createSlot(issue, domain);

private async createSlot(issue: CheenoskiIssue, domain: Domain | 'unknown'): Promise<Slot | null> {
  // ... no more detectDomain() call needed!
  return {
    // ...
    domain, // Use passed domain
    // ...
  };
}
```

---

## Next Steps

1. Fix the 3 critical bugs (memory leak, retry inconsistency, domain detection)
2. Run all tests
3. Test long-running session (multiple cascades) to verify no leaks
4. Commit with clear bug descriptions
5. THEN consider PR or continue bug hunting


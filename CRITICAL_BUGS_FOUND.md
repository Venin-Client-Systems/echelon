# CRITICAL BUGS FOUND - MUST FIX BEFORE HACKATHON

## 🔴 SHOWSTOPPER BUGS (Will Crash in Demo)

### 1. DOUBLE CLEANUP CRASH (scheduler.ts:500)
**Severity**: 🔥 CRITICAL - GUARANTEED CRASH ON RETRY
**Location**: `src/cheenoski/scheduler.ts:300-503`

```typescript
// Lines 460, 469, 478, 493 call cleanup on retry:
await this.cleanupSlotWorktree(slot);
continue;

// Then line 500 ALWAYS calls it again in finally:
finally {
  slot.finishedAt = new Date().toISOString();
  await this.cleanupSlotWorktree(slot);  // DOUBLE CLEANUP!
  this.unregisterEngine(slot.id);
}
```

**Problem**: On retry, cleanup runs twice. Second cleanup fails because worktree already removed.
**Demo Impact**: First retry = crash with "worktree not found" error
**Fix**: Only cleanup in finally, remove all manual cleanup calls

---

### 2. TOCTOU RACE IN ISSUE CLAIMING (coordination.ts:118-138)
**Severity**: 🔥 CRITICAL - DATA RACE
**Location**: `src/cheenoski/coordination.ts:118-138`

```typescript
// Check if file exists
if (existsSync(claimPath)) {  // ← Process A checks (true)
  try {
    const data = JSON.parse(readFileSync(claimPath, 'utf-8'));
    // ...
    if (isAlive(data.pid)) {
      return false;
    }
    logger.debug(`Removing stale claim...`);
    unlinkSync(claimPath);  // ← Process B claims here!
  }                          // ← Process A deletes Process B's claim!
}

// Try to claim
writeFileSync(claimPath, JSON.stringify(claim), { flag: 'wx' });  // ← Process A steals claim
```

**Problem**: Between checking existsSync and unlinking, another process can claim. First process then deletes the valid claim and steals the issue.
**Demo Impact**: Two parallel runs claim same issue, both work on it, merge conflicts, cascade fails
**Fix**: Use atomic ops only, no check-then-act

---

### 3. MEMORY LEAK - UNBOUNDED MAP GROWTH (scheduler.ts:188)
**Severity**: 🔥 CRITICAL - MEMORY LEAK
**Location**: `src/cheenoski/scheduler.ts:188-206`

```typescript
const slotPromise = this.runSlot(slot).catch((err) => {
  // ...
});
this.runningSlots.set(slot.id, slotPromise);  // ← Added
slotPromise.finally(() => {
  this.runningSlots.delete(slot.id);  // ← Only deleted if promise settles
});
```

**Problem**: If slot hangs (network issue, infinite loop), promise never settles. Map grows forever.
**Demo Impact**: Long-running demo = OOM crash
**Fix**: Add timeout wrapper around promise or periodic cleanup of stale entries

---

### 4. RELEASING UNCLAIMED ISSUES (scheduler.ts:520)
**Severity**: 🟠 HIGH - LOGIC ERROR
**Location**: `src/cheenoski/scheduler.ts:299-520`

```typescript
try {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Line 260 would be claimIssue(), but runSlot doesn't call it
    // createSlot() called it at line 260 in a DIFFERENT function

    // If error before createSlot completes, we jump here:
  }
} catch (outerErr) {
  // ...
} finally {
  releaseIssue(slot.issueNumber);  // ← Release issue we never claimed!
}
```

**Problem**: If error occurs before issue is claimed, we try to release it anyway.
**Demo Impact**: Corrupts claim state, issues get "stuck"
**Fix**: Track if claim succeeded, only release if claimed

---

### 5. RETRY LOGIC OFF-BY-ONE (recovery.ts:39)
**Severity**: 🟠 HIGH - INCORRECT RETRY COUNT
**Location**: `src/core/recovery.ts:39`

```typescript
for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
  //                                              ^^^^ BUG!
```

**Problem**: If maxRetries = 3, this loops 4 times (attempts 1,2,3,4). Should be maxRetries attempts.
**Demo Impact**: Wastes API calls, exceeds budget, takes longer than expected
**Fix**: `attempt <= config.maxRetries` or `attempt < config.maxRetries + 1`

---

### 6. EMPTY STRING BRANCH CHECKOUT (merge.ts:89-92, 136-141)
**Severity**: 🟠 HIGH - GIT ERROR
**Location**: `src/cheenoski/git/merge.ts:89-92, 136-141`

```typescript
const currentBranch = await git(['branch', '--show-current'], repoPath);
// If detached HEAD, currentBranch = "" (empty string)

if (currentBranch !== baseBranch) {
  await git(['checkout', baseBranch], repoPath);
}

// ... later in finally:
if (currentBranch && currentBranch !== baseBranch) {  // Empty string is falsy!
  try {
    await git(['checkout', currentBranch], repoPath);  // git checkout ""
```

**Problem**: Detached HEAD returns empty string. `currentBranch` is empty string (truthy as string), but falsy in boolean context. Inconsistent checks.
**Demo Impact**: Error "pathspec '' did not match any file(s)"
**Fix**: Check for empty string explicitly: `currentBranch && currentBranch.length > 0`

---

### 7. RATE LIMIT SLEEP IGNORES STOP (scheduler.ts:461)
**Severity**: 🟠 HIGH - GRACEFUL SHUTDOWN BROKEN
**Location**: `src/cheenoski/scheduler.ts:457-463`

```typescript
} else if (result.errorType === 'rate_limit') {
  if (attempt < maxRetries) {
    slotLogger.warn(`All engines rate-limited, waiting before retry`);
    await this.cleanupSlotWorktree(slot);
    await sleep(30_000);  // ← Sleep 30s, no check if scheduler stopped!
    continue;
  }
```

**Problem**: Sleeps 30s without checking `this.running`. If user Ctrl+C during sleep, slot keeps running.
**Demo Impact**: Ctrl+C doesn't work, zombie processes
**Fix**: Check `this.running` after sleep, exit if stopped

---

### 8. SUCCESSFUL MERGE, FAILED PR (scheduler.ts:397-419)
**Severity**: 🟠 HIGH - INCONSISTENT STATE
**Location**: `src/cheenoski/scheduler.ts:381-419`

```typescript
if (mergeResult.success) {
  // Merge already committed to base branch!

  if (this.config.engineers.createPr) {
    try {
      const pr = await createPullRequest(...);  // ← If this fails...
      slot.prNumber = pr.number;
    } catch (err) {
      slotLogger.warn(`PR creation failed: ...`);  // ← ...merge is still in base!
    }
  }
```

**Problem**: Merge succeeds and is committed. Then PR creation fails. Merge is already in base branch but no PR exists. Can't rollback merge.
**Demo Impact**: Changes merged but tracking lost, confusion, manual cleanup needed
**Fix**: Either make atomic (push branch, create PR, then merge), or accept that merge is more important than PR

---

## 🟡 SERIOUS BUGS (Will Cause Issues)

### 9. ISSUE BODY CAN BE NULL (issues.ts:25)
**Severity**: 🟡 MEDIUM - NULL POINTER
**Location**: `src/cheenoski/github/issues.ts:22-30`

```typescript
return raw.map((issue: any) => ({
  number: issue.number,
  title: issue.title,
  body: issue.body,  // ← Can be null if issue has no description!
  labels: (issue.labels ?? []).map((l: any) => l.name),
```

**Problem**: GitHub API returns `null` for issues with no body. Code assumes string.
**Demo Impact**: Crashes when building engineer prompt with null body
**Fix**: `body: issue.body ?? ''`

---

### 10. STATUS CHECK FALSE NEGATIVE (merge.ts:73-74)
**Severity**: 🟡 MEDIUM - LOGIC ERROR
**Location**: `src/cheenoski/git/merge.ts:73-74`

```typescript
const status = await git(['status', '--porcelain'], repoPath);
if (status.length > 0) {  // ← Checks string length, not if truly empty
  // Stash changes
}
```

**Problem**: If status has only whitespace/newlines, `length > 0` is true but no actual changes.
**Demo Impact**: Unnecessary stash operations
**Fix**: `if (status.trim().length > 0)`

---

### 11. STASH SEARCH AMBIGUITY (merge.ts:147-156)
**Severity**: 🟡 MEDIUM - STASH RECOVERY FAILURE
**Location**: `src/cheenoski/git/merge.ts:147-156`

```typescript
const stashMessage = `cheenoski-pre-merge-${issueNumber}-${Date.now()}`;
// ... later:
for (const line of lines) {
  if (line.includes(stashMessage)) {  // ← Multiple stashes could match if same ms
    const match = line.match(/^(stash@\{\d+\})/);
```

**Problem**: If two stashes created in same millisecond, message is identical. Wrong stash popped.
**Demo Impact**: Wrong changes restored, corrupted working tree
**Fix**: Use `process.pid` in message: `cheenoski-pre-merge-${issueNumber}-${process.pid}-${Date.now()}`

---

### 12. CLOSE ISSUE ERROR NOT HANDLED (issues.ts:55-60)
**Severity**: 🟡 MEDIUM - UNHANDLED ERROR
**Location**: `src/cheenoski/github/issues.ts:55-60`

```typescript
await githubClient.exec([
  'issue', 'close', String(issueNumber),
  '--repo', repo,
]);  // ← Can throw, but caller doesn't catch

logger.info(`Closed issue #${issueNumber}`);  // ← Never reached if error
```

**Problem**: If GitHub API fails, error propagates up. Caller (scheduler) doesn't handle, slot fails.
**Demo Impact**: Network blip = entire slot fails instead of just skipping close
**Fix**: Wrap in try/catch, make closing best-effort

---

### 13. PROCESS LISTENER LEAK (agent.ts:95-101)
**Severity**: 🟡 MEDIUM - MEMORY LEAK
**Location**: `src/core/agent.ts:95-101`

```typescript
proc.on('error', (err) => {
  clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  if (settled) return;
  settled = true;
  reject(new Error(`Failed to spawn claude: ${err.message}`));
});  // ← Listener never removed!
```

**Problem**: If process spawns but errors immediately, listeners stay attached.
**Demo Impact**: After many agent spawns, "MaxListenersExceeded" warning, memory leak
**Fix**: Use `once` instead of `on`, or manually remove listeners

---

### 14. DOMAIN DETECTION CALLED TWICE (scheduler.ts:222, 265)
**Severity**: 🟢 LOW - PERFORMANCE
**Location**: Already in previous audit

**Fix**: Cache domain in CheenoskiIssue when fetching

---

### 15. WORKTREE PATH COLLISION RISK (worktree.ts:30-36)
**Severity**: 🟢 LOW - EDGE CASE
**Location**: `src/cheenoski/git/worktree.ts:30-36`

```typescript
export function worktreePath(repoPath: string, branchName: string): string {
  const repoName = basename(repoPath) || 'repo';
  const safeRepoName = repoName.replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeBranchName = branchName.replace(/[^a-zA-Z0-9_-]/g, '-');
  return join(tmpdir(), 'cheenoski-worktrees', `${safeRepoName}-${safeBranchName}`);
}
```

**Problem**: If two repos with same basename (e.g., "myapp") run cheenoski for same issue number, paths collide.
**Demo Impact**: Rare, but worktree operations fail with "already exists"
**Fix**: Include process.pid in path

---

## 🎯 LOGIC BUGS

### 16. MERGE CONFLICT FILES LOST AFTER ABORT (merge.ts:116-124)
**Severity**: 🟡 MEDIUM - LOST DATA
**Location**: `src/cheenoski/git/merge.ts:116-124`

```typescript
// List conflicting files BEFORE aborting (diff-filter=U is empty after abort)
let conflictFiles: string[] = [];
try {
  const conflictOutput = await git(['diff', '--name-only', '--diff-filter=U'], repoPath);
  conflictFiles = conflictOutput.split('\n').filter(Boolean);
} catch { /* ignore */ }

// Now abort the merge
try { await git(['merge', '--abort'], repoPath); } catch { /* best effort */ }
```

**Problem**: If `git diff` throws, conflictFiles is empty array. Can't debug which files conflicted.
**Demo Impact**: Merge conflict errors with no file names, hard to debug
**Fix**: Try alternative methods (git status) if diff fails

---

### 17. MISSING BUDGET CHECK IN MAX MODE (orchestrator.ts:304)
Already fixed in previous audit

---

### 18. SCHEDULER FILL REENTRANCY (scheduler.ts:168-212)
**Severity**: 🟡 MEDIUM - LOGIC ERROR
**Location**: `src/cheenoski/scheduler.ts:168-212`

```typescript
private async fillSlots(): Promise<void> {
  if (this.filling) return;  // ← Guard against reentrancy
  this.filling = true;

  try {
    while (/* ... */) {
      // ...
      const slotPromise = this.runSlot(slot).catch((err) => {
        // ...
      });
      this.runningSlots.set(slot.id, slotPromise);
      slotPromise.finally(() => {
        this.runningSlots.delete(slot.id);
        this.unregisterEngine(slot.id);
      });
    }
  } finally {
    this.filling = false;
  }
}
```

**Problem**: fillSlots is async and sets filling=false in finally. If runSlot completes before fillSlots finishes, calls fillSlots again (line 526), but filling=true so returns early. Slots don't get filled.
**Demo Impact**: Slots don't fill properly, parallelism broken, runs serially
**Fix**: Remove reentrancy guard or use different coordination mechanism

---

### 19. CLEANUP CALLED WITH NULL WORKTREE PATH (scheduler.ts:529-541)
**Severity**: 🟢 LOW - INEFFICIENCY
**Location**: `src/cheenoski/scheduler.ts:529-541`

```typescript
private async cleanupSlotWorktree(slot: Slot): Promise<void> {
  if (slot.worktreePath) {  // ← Checks if path exists
    try {
      await removeWorktree(this.config.project.path, slot.worktreePath, slot.branchName, slot.issueNumber);
    } catch (err) {
      const slotLogger = this.logger.child({ slot: slot.id, issueNumber: slot.issueNumber });
      slotLogger.warn(`Failed to cleanup worktree: ${err instanceof Error ? err.message : err}`);
    } finally {
      slot.worktreePath = null;  // ← Always set to null even if remove failed
    }
  }
}
```

**Problem**: Sets `worktreePath = null` even if `removeWorktree` fails. Can't retry cleanup.
**Demo Impact**: Orphaned worktrees accumulate in /tmp
**Fix**: Only set to null if removeWorktree succeeds

---

### 20. PARALLEL SLOT KILL RACE (scheduler.ts:144-155)
**Severity**: 🟡 MEDIUM - RACE CONDITION
**Location**: `src/cheenoski/scheduler.ts:144-155`

```typescript
kill(): void {
  this.running = false;
  for (const [slotId, engine] of this.activeEngines) {
    try {
      engine.kill();  // ← Kills engine
      this.logger.info(`Killed engine for slot ${slotId}`);
    } catch (err) {
      this.logger.warn(`Failed to kill engine for slot ${slotId}: ...`);
    }
  }
  this.activeEngines.clear();  // ← Clears all at once
}
```

**Problem**: If slot finishes between loop start and clear(), it calls `unregisterEngine()` which deletes from map. Clear() then has stale entries.
**Demo Impact**: Minor, just log noise
**Fix**: Snapshot entries before loop: `const entries = [...this.activeEngines];`

---

## SUMMARY

- **5 Showstopper Bugs**: Will crash or corrupt data during demo
- **10 Serious Bugs**: Will cause visible issues
- **5 Logic Bugs**: Edge cases and inefficiencies

**Total**: 20 bugs that will make you look bad at hackathon

**Estimated Fix Time**: 3-4 hours if done carefully

**Priority Order**:
1. Fix double cleanup (guaranteed crash)
2. Fix TOCTOU race (data corruption)
3. Fix memory leak (long demos fail)
4. Fix empty branch checkout (git errors)
5. Fix retry logic (wrong behavior)
6. Fix remaining bugs

Your code will be solid after these fixes!

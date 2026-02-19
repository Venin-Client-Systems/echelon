# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < 1.0   | :x:                |

**Note:** Echelon is currently in pre-1.0 development. We recommend always using the latest version from the `main` branch.

## Reporting a Vulnerability

We take the security of Echelon seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Primary channel:** Email security reports to **security@venin.space**

For sensitive disclosures, you may encrypt your report using our PGP key (optional):

```
-----BEGIN PGP PUBLIC KEY BLOCK-----
(PGP key to be added when available)
-----END PGP PUBLIC KEY BLOCK-----
```

### What to Include

Please include as much of the following information as possible:

- Type of vulnerability (credential leakage, command injection, etc.)
- Affected component(s) and file path(s)
- Steps to reproduce the vulnerability
- Proof-of-concept or exploit code (if applicable)
- Potential impact and severity assessment
- Suggested fix or mitigation (if available)

### Response Timeline

We are committed to timely security responses:

- **Acknowledgment:** Within 24-48 hours of receiving your report
- **Initial assessment:** Within 5 business days
- **Fix development:** Within 30-90 days, depending on severity
  - Critical vulnerabilities: 7-14 days
  - High severity: 30 days
  - Medium/Low severity: 90 days
- **Public disclosure:** Coordinated with the reporter after fix is released

### What to Expect

1. **Acknowledgment:** We'll confirm receipt and begin investigation
2. **Assessment:** We'll validate the issue and determine severity
3. **Fix development:** We'll develop and test a patch
4. **Coordinated disclosure:** We'll work with you on timing of public disclosure
5. **Credit:** We'll acknowledge your contribution (unless you prefer to remain anonymous)

## Security Best Practices

When using Echelon, follow these security guidelines:

### Credential Management

**DO:**
- ✅ Store API keys in environment variables (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`)
- ✅ Use `.env` files (ensure they're in `.gitignore`)
- ✅ Use CI/CD secrets for GitHub Actions environments
- ✅ Rotate API keys regularly (quarterly recommended)
- ✅ Use fine-grained GitHub Personal Access Tokens with minimal scopes

**DON'T:**
- ❌ Commit API keys to git (even in private repos)
- ❌ Pass API keys as CLI arguments (visible in `ps` output)
- ❌ Log API keys to files or stdout
- ❌ Share API keys in issue bodies or PR descriptions
- ❌ Use classic GitHub PATs (prefer fine-grained tokens)

**Required environment variables:**
```bash
# Claude AI API key (required)
export ANTHROPIC_API_KEY="sk-ant-..."

# GitHub Personal Access Token (required for gh CLI)
export GITHUB_TOKEN="ghp_..."  # or github_pat_...
```

**Optional variables:**
```bash
# Telegram bot integration
export ECHELON_TELEGRAM_BOT_TOKEN="..."
export ECHELON_TELEGRAM_CHAT_ID="..."
export ECHELON_TELEGRAM_ALLOWED_USERS="123456789,987654321"  # Comma-separated user IDs

# Health monitoring (Telegram mode only)
export ECHELON_HEALTH_ENABLED="true"
export ECHELON_HEALTH_PORT="3000"
export ECHELON_HEALTH_BIND="0.0.0.0"

# Logging configuration
export LOG_LEVEL="info"      # debug|info|warn|error
export LOG_FORMAT="text"     # text|json
```

### Command Injection Prevention

Echelon uses `execFile()` with argument arrays to prevent shell injection:

```typescript
// ✅ Safe — uses execFile with args array
await execFileAsync('git', ['branch', branchName], { cwd: repoPath });

// ❌ Unsafe — uses shell interpolation (we don't do this)
await execAsync(`git branch ${branchName}`);
```

### Logging Safety

Our logger automatically redacts:
- API keys and tokens (e.g., `ANTHROPIC_API_KEY`, `sk-ant-*`, GitHub PATs)
- Authorization headers
- Environment variables matching sensitive patterns

However, you should still:
- Avoid passing raw secrets to logging functions
- Review logs before sharing publicly
- Use `LOG_LEVEL=warn` or `LOG_LEVEL=error` in production

### File Path Safety

All session IDs and file paths are validated to prevent path traversal:

```typescript
// Validated — prevents "../../../etc/passwd"
if (sessionId.includes('..') || sessionId.includes('/')) {
  throw new Error('Invalid session ID');
}
```

### Atomic File Writes

State files use atomic writes to prevent corruption and partial exposure:

```typescript
// Write to temp file, then atomic rename
writeFileSync(tmpPath, data);
renameSync(tmpPath, finalPath);
```

### Temporary File Cleanup

All temporary files (prompts, worktrees) are cleaned up in `finally` blocks:

```typescript
try {
  await doWork(tempFile);
} finally {
  unlinkSync(tempFile);  // Always cleanup
}
```

## Known Security Considerations

### ⚠️ No Sandboxing for Agent Code Execution

**CRITICAL:** Echelon delegates code execution to Claude Code agents, which have unrestricted access to:

- ✅ The git repository and worktree filesystem
- ✅ GitHub API (via `gh` CLI with inherited `GITHUB_TOKEN`)
- ✅ Shell commands (git, npm, docker, etc.)
- ✅ Network access (outbound connections)
- ✅ Environment variables from the parent process

**Implications:**
- Agents can execute arbitrary code in the repository context
- Agents can create/modify/delete files in worktrees
- Agents can make GitHub API calls (create issues, PRs, comments)
- Agents can install npm packages or run build scripts
- Agents inherit all environment variables (including secrets)

**Risk Assessment:**
- **High risk:** Running Echelon in production repos with sensitive data
- **Medium risk:** Running Echelon with `approvalMode: "none"` (auto-executes all actions)
- **Low risk:** Running Echelon with `approvalMode: "all"` and careful PR review

**Mitigation strategies:**

1. **Use approval gates:**
   - `approvalMode: "destructive"` — Approve issue creation, code execution, branch creation
   - `approvalMode: "all"` — Approve every action (maximum safety)
   - `approvalMode: "none"` — Auto-execute (only for throwaway experiments)

2. **Review PRs carefully:**
   - Always review AI-generated code before merging
   - Check for unexpected file changes (config files, dependencies)
   - Verify tests pass and no malicious code injected

3. **Limit repository access:**
   - Use fine-grained GitHub PAT with minimal scopes:
     - `Contents: Read and write`
     - `Pull requests: Read and write`
     - `Issues: Read and write`
   - Avoid classic PATs (they have org-wide access)

4. **Run in isolated environments:**
   - Use Docker containers or VMs for Echelon execution
   - Avoid running on machines with SSH keys or cloud credentials
   - Use ephemeral GitHub Codespaces or cloud dev environments

5. **Monitor git history:**
   - Check branch ledger: `~/.echelon/sessions/*/branch-ledger.json`
   - Review worktree list: `git worktree list`
   - Audit commits: `git log --all --oneline | grep cheenoski`

6. **Budget limits:**
   - Set conservative `maxTotalBudgetUsd` to prevent runaway costs
   - Use per-layer budget limits for management agents
   - Monitor costs via session transcripts

### Worktree Isolation

Cheenoski uses `git worktree` for parallel execution. Each worktree is isolated, but:

- Worktrees share the same `.git` directory
- Branches created in worktrees are visible to the main repo
- Orphaned worktrees can cause "already exists" errors

**Best practices:**

- Clean up worktrees after use (handled automatically)
- Monitor `git worktree list` for orphans
- Use unique branch names (handled by PID-namespacing)

### Telegram Bot Security

If using the Telegram integration:

- **Restrict bot access:** Only authorized Telegram user IDs should access the bot
- **Secure bot token:** Store `ECHELON_TELEGRAM_BOT_TOKEN` securely
- **Rate limiting:** Consider implementing rate limits for bot commands
- **Audit logs:** Monitor Telegram interactions via structured logs

## Security Audit Results

This section documents our comprehensive security audit (issue #38, 2026-02-18):

### ✅ Credential Leakage Protection

**Status:** No credential leakage vulnerabilities found

The logging system (`src/lib/logger.ts:36-78`) implements comprehensive credential sanitization:

```typescript
const SENSITIVE_PATTERNS = [
  /ANTHROPIC_API_KEY[=:]\s*[^\s]+/gi,
  /sk-ant-[a-zA-Z0-9-_]+/gi,
  /ghp_[a-zA-Z0-9]{36,}/gi,
  /gho_[a-zA-Z0-9]{36,}/gi,
  /github_pat_[a-zA-Z0-9_]+/gi,
  /\b[Tt]oken[=:]\s*[a-zA-Z0-9_-]{20,}/g,
  /\b[Aa]pi[Kk]ey[=:]\s*[a-zA-Z0-9_-]{20,}/g,
  /[Aa]uthorization:\s*Bearer\s+[a-zA-Z0-9_-]+/g,
];
```

**Sanitization coverage:**
- ✅ All log output (debug, info, warn, error)
- ✅ Session transcripts (`src/lib/transcript.ts`)
- ✅ Telegram error messages (`src/telegram/handler.ts:10-21`)
- ✅ Recursive sanitization of nested objects
- ✅ Both string and object-based log data

**Verified:**
- No `process.env.ANTHROPIC_API_KEY` or `GITHUB_TOKEN` logged
- Issue bodies sanitized before logging
- No credentials in `~/.echelon/sessions/*/transcript.md`

### ✅ Command Injection Prevention

**Status:** No command injection vulnerabilities found

All shell operations use `execFile()` with argument arrays (no shell interpolation):

**Git operations** (`src/cheenoski/git/worktree.ts`, `src/cheenoski/git/guardrails.ts`):
```typescript
// Line 11-13: Safe git command wrapper
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

// Usage examples:
await git(['worktree', 'add', '-b', branch, wtPath, baseBranch], repoPath);
await git(['branch', '-D', branchName], repoPath);
```

**GitHub CLI operations** (`src/actions/github-issues.ts`):
```typescript
// Line 94: Safe gh issue create
const args = [
  'issue', 'create',
  '--repo', repo,
  '--title', title,
  '--body', body,
];
await execFileAsync('gh', args, { encoding: 'utf-8' });
```

**Verified:**
- ❌ No use of `shell: true` option (grep found 0 matches)
- ❌ No use of `exec()` with string concatenation
- ✅ All branch names sanitized via `slugify()` (`src/cheenoski/domain.ts:79-96`)
- ✅ All worktree paths sanitized (`src/cheenoski/git/worktree.ts:24-35`)

**Input validation:**
- Branch names: `[a-z0-9-]` only, max 50 chars
- Repo names: `^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$` pattern
- Session IDs: `^[a-zA-Z0-9-]+$`, no path separators
- Issue fields: Control characters (`\x00-\x1F`) stripped

### ✅ Safe File Operations

**Status:** No unsafe file operations found

**Temporary file cleanup** (`src/cheenoski/engine/base.ts`):
```typescript
// Line 46-50: Create temp file
const promptFile = join(tmpdir(), `cheenoski-prompt-${nanoid(8)}.md`);
writeFileSync(promptFile, opts.prompt, 'utf-8');

// Cleanup in ALL code paths:
this.proc.on('error', (err) => {
  if (promptFile) this.cleanupPromptFile(promptFile); // Line 77
});

const timer = setTimeout(() => {
  if (promptFile) this.cleanupPromptFile(promptFile); // Line 107
}, opts.timeoutMs);

this.proc.on('close', (code) => {
  if (promptFile) this.cleanupPromptFile(promptFile); // Line 114
});
```

**Atomic state writes** (`src/lib/paths.ts:22-27`):
```typescript
export function atomicWriteJSON(filePath: string, data: unknown): void {
  ensureDir(dirname(filePath));
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, filePath);  // Atomic on most filesystems
}
```

**Worktree cleanup** (`src/cheenoski/git/worktree.ts`):
```typescript
// Line 70, 97: Force flag prevents interactive prompts
await git(['worktree', 'remove', '--force', wtPath], repoPath);

// Orphan detection and cleanup
export async function cleanOrphanedWorktrees(repoPath: string): Promise<number>
```

**Verified:**
- ✅ Temp files cleaned in error/timeout/success paths
- ✅ State files use atomic rename pattern
- ✅ Worktree removal uses `--force` flag
- ✅ Path traversal prevented (`../` checks in session ID validation)

### Security Checklist Summary

- [x] **Logger:** Credential sanitization for API keys, tokens, auth headers
- [x] **Transcript:** Session ID validation prevents path traversal
- [x] **Command execution:** All git/gh commands use `execFile()` with arg arrays
- [x] **BaseEngine:** Temp files cleaned up in error/timeout/close handlers
- [x] **State persistence:** Atomic writes via temp file + rename
- [x] **Error messages:** Telegram handler sanitizes API errors before display
- [x] **Input validation:** Branch names, repo names, issue numbers validated
- [x] **Worktree cleanup:** Force removal, orphan detection implemented
- [x] **No shell interpolation:** Zero instances of `shell: true` option

## Contact

For non-security issues, please use [GitHub Issues](https://github.com/Venin-Client-Systems/echelon/issues).

For security concerns, email **security@venin-client-systems.com**.

---

**Last updated:** 2026-02-18 (Comprehensive security audit - issue #38)

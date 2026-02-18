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

**Primary channel:** Email security reports to **security@venin-client-systems.com**

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

- **Never commit credentials** to version control (`.env`, API keys, tokens)
- Store sensitive configuration in environment variables
- Use `.gitignore` to exclude credential files
- Rotate API keys regularly

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

### AI Agent Execution Risks

Echelon spawns autonomous AI agents that execute code. This inherently carries risk:

- **Code generation:** Agents write and execute code based on issue descriptions
- **Git operations:** Agents create branches, commits, and pull requests
- **GitHub API access:** Agents interact with your repository via `gh` CLI

**Mitigation strategies:**

1. **Use approval gates:** Set `approvalMode: 'destructive'` or `'all'` in config
2. **Review PRs carefully:** Always review AI-generated code before merging
3. **Limit repository access:** Use a GitHub token with minimal required scopes
4. **Run in sandboxed environments:** Consider running Echelon in containers or VMs
5. **Monitor git history:** Check branch ledger (`~/.echelon/sessions/*/branch-ledger.json`)

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

## Security Audit Checklist

This checklist documents our security review (issue #72):

- [x] **Logger:** Credential sanitization for API keys, tokens, auth headers
- [x] **Transcript:** Session ID validation prevents path traversal
- [x] **Command execution:** All git/gh commands use `execFile()` with arg arrays
- [x] **BaseEngine:** Temp files cleaned up in `finally` blocks
- [x] **State persistence:** Atomic writes via temp file + rename
- [x] **Error messages:** Telegram handler sanitizes API errors before display
- [x] **Input validation:** Branch names, repo names, issue numbers validated

## Contact

For non-security issues, please use [GitHub Issues](https://github.com/Venin-Client-Systems/echelon/issues).

For security concerns, email **security@venin-client-systems.com**.

---

**Last updated:** 2026-02-18

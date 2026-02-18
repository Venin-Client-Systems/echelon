import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

/** Cheenoski worktree base dir — only processes with cwd under here get reaped */
const WORKTREE_BASE = join(tmpdir(), 'cheenoski-worktrees');

/** Patterns for processes that engineers might leave running */
const ORPHAN_PATTERNS = [
    /tsc.*--watch/,
    /eslint.*--fix/,
    /vitest.*run/,
    /jest.*--runInBand/,
];

/**
 * Find and kill orphaned child processes from engineer runs.
 * Only kills processes whose cwd is within a Cheenoski worktree directory.
 */
export async function reapOrphanedProcesses(): Promise<number> {
    let killed = 0;

    try {
        const { stdout } = await execFileAsync('ps', ['aux'], { encoding: 'utf-8' });
        const lines = stdout.split('\n');

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 11)
                continue;

            const pid = parseInt(parts[1], 10);
            const command = parts.slice(10).join(' ');

            // Check if it matches orphan patterns
            const isOrphan = ORPHAN_PATTERNS.some(pattern => pattern.test(command));
            if (!isOrphan)
                continue;

            // Don't kill ourselves or init
            if (pid === process.pid || pid <= 1)
                continue;

            // Verify the process is running in a Cheenoski worktree
            try {
                const { stdout: cwdOut } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
                    encoding: 'utf-8',
                });

                // lsof output has lines like "n/path/to/cwd"
                const cwdLine = cwdOut.split('\n').find(l => l.startsWith('n'));
                const cwd = cwdLine?.slice(1) ?? '';

                if (!cwd.startsWith(WORKTREE_BASE)) {
                    continue; // Not a Cheenoski process — skip
                }

                // Verify parent is dead (orphaned) or is us
                const { stdout: ppidOut } = await execFileAsync('ps', ['-o', 'ppid=', '-p', String(pid)], {
                    encoding: 'utf-8',
                });
                const ppid = parseInt(ppidOut.trim(), 10);
                if (ppid === 1 || ppid === process.pid) {
                    process.kill(pid, 'SIGTERM');

                    // Allow graceful shutdown, then escalate to SIGKILL if still alive
                    await sleep(500);
                    try {
                        process.kill(pid, 0); // Check if still running
                        process.kill(pid, 'SIGKILL');
                        logger.debug(`Escalated to SIGKILL for process ${pid}: ${command.slice(0, 80)}`);
                    } catch {
                        // Process already exited after SIGTERM — good
                    }

                    killed++;
                    logger.debug(`Killed orphaned process ${pid}: ${command.slice(0, 80)}`);
                }
            } catch {
                // Process already dead or lsof not available
            }
        }
    } catch {
        logger.debug('Could not scan for orphaned processes');
    }

    if (killed > 0) {
        logger.info(`Reaped ${killed} orphaned process(es)`);
    }

    return killed;
}

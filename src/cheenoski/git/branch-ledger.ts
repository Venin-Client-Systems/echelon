import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import type { LedgerEntry } from '../types.js';

const CHEENOSKI_HOME = join(homedir(), '.cheenoski');
const BRANCHES_DIR = join(CHEENOSKI_HOME, 'branches');

function ensureLedgerDir(): void {
    if (!existsSync(BRANCHES_DIR)) {
        mkdirSync(BRANCHES_DIR, { recursive: true });
    }
}

/** Hash a branch name for the ledger filename */
function branchHash(branch: string): string {
    return createHash('sha256').update(branch).digest('hex').slice(0, 12);
}

/** Get ledger file path for a branch */
function ledgerPath(branch: string): string {
    return join(BRANCHES_DIR, `${branchHash(branch)}.ledger`);
}

/** Append an entry to the branch ledger (append-only audit trail) */
export function appendToLedger(entry: Omit<LedgerEntry, 'timestamp' | 'pid'>): void {
    ensureLedgerDir();
    const full: LedgerEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
        pid: process.pid,
    };
    const line = JSON.stringify(full) + '\n';
    const path = ledgerPath(entry.branch);
    appendFileSync(path, line, 'utf-8');
}

/** Read all ledger entries for a branch */
export function readLedger(branch: string): LedgerEntry[] {
    const path = ledgerPath(branch);
    if (!existsSync(path))
        return [];

    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    const entries: LedgerEntry[] = [];
    for (const line of lines) {
        try {
            entries.push(JSON.parse(line));
        } catch {
            // Skip corrupt lines
        }
    }
    return entries;
}

/** Check if a branch was ever created by Cheenoski */
export function isCheenoskiBranch(branch: string): boolean {
    return existsSync(ledgerPath(branch));
}

/** Get all ledger files (for auditing) */
export function listAllLedgers(): string[] {
    ensureLedgerDir();
    return readdirSync(BRANCHES_DIR)
        .filter((f: string) => f.endsWith('.ledger'))
        .map((f: string) => join(BRANCHES_DIR, f));
}

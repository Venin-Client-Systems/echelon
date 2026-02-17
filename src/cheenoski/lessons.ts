import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

const LESSONS_FILENAME = 'CHEENOSKI_LESSONS.md';
const LEGACY_FILENAME = 'RALPHY_LESSONS.md';

/** Migrate legacy RALPHY_LESSONS.md to CHEENOSKI_LESSONS.md if needed */
function migrateLegacy(repoPath: string): void {
    const legacyPath = join(repoPath, LEGACY_FILENAME);
    const newPath = join(repoPath, LESSONS_FILENAME);

    if (existsSync(legacyPath) && !existsSync(newPath)) {
        renameSync(legacyPath, newPath);
        logger.info(`Migrated ${LEGACY_FILENAME} → ${LESSONS_FILENAME}`);
    }
}

/** Read lessons file from a directory (if it exists) */
export function readLessons(repoPath: string): string | null {
    migrateLegacy(repoPath);
    const path = join(repoPath, LESSONS_FILENAME);
    if (!existsSync(path))
        return null;
    return readFileSync(path, 'utf-8');
}

/** Copy lessons file from main repo into a worktree */
export function propagateLessons(repoPath: string, worktreePath: string): void {
    migrateLegacy(repoPath);
    const src = join(repoPath, LESSONS_FILENAME);
    const dst = join(worktreePath, LESSONS_FILENAME);

    if (!existsSync(src))
        return;

    try {
        copyFileSync(src, dst);
        logger.debug(`Propagated ${LESSONS_FILENAME} to worktree`);
    } catch (err) {
        logger.warn(`Failed to propagate lessons: ${err instanceof Error ? err.message : err}`);
    }
}

/** Append a new lesson to the lessons file */
export function addLesson(repoPath: string, lesson: string): void {
    const path = join(repoPath, LESSONS_FILENAME);
    const date = new Date().toISOString().split('T')[0];

    let content = '';
    if (existsSync(path)) {
        content = readFileSync(path, 'utf-8');
    } else {
        content = '# Lessons Learned\n\nAuto-maintained by Cheenoski. Do not edit manually.\n\n';
    }

    content += `- **${date}**: ${lesson}\n`;
    writeFileSync(path, content, 'utf-8');
}

/** Merge lessons from a worktree back into the main repo */
export function mergeLessonsBack(worktreePath: string, repoPath: string): void {
    const src = join(worktreePath, LESSONS_FILENAME);
    const dst = join(repoPath, LESSONS_FILENAME);

    if (!existsSync(src))
        return;

    const srcContent = readFileSync(src, 'utf-8');
    const srcLines = new Set(srcContent.split('\n').filter(l => l.startsWith('- ')));

    let dstContent = '';
    if (existsSync(dst)) {
        dstContent = readFileSync(dst, 'utf-8');
    } else {
        dstContent = '# Lessons Learned\n\nAuto-maintained by Cheenoski. Do not edit manually.\n\n';
    }

    const dstLines = new Set(dstContent.split('\n').filter(l => l.startsWith('- ')));

    const newLessons = [...srcLines].filter(l => !dstLines.has(l));
    if (newLessons.length > 0) {
        dstContent += newLessons.join('\n') + '\n';
        writeFileSync(dst, dstContent, 'utf-8');
        logger.debug(`Merged ${newLessons.length} new lesson(s) from worktree`);
    }
}

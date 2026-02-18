import { DOMAINS, DOMAIN_TITLE_TAGS, SAFE_PARALLEL_PAIRS } from './types.js';
import type { Domain, CheenoskiIssue } from './types.js';

/** File path patterns that indicate a domain */
const PATH_PATTERNS: Record<string, RegExp[]> = {
    backend: [/^src\/(api|server|lib|core|services|actions)\//, /\.controller\./, /\.service\./],
    frontend: [/^src\/(ui|components|pages|views|hooks)\//, /\.tsx$/, /\.css$/, /\.scss$/],
    database: [/^src\/db\//, /migration/, /schema\.ts$/, /drizzle/],
    infrastructure: [/^\.github\//, /docker/, /^infra\//, /\.yml$/, /Dockerfile/],
    security: [/auth/, /security/, /middleware\/auth/, /\.env/],
    testing: [/\.test\./, /\.spec\./, /^test\//, /vitest/, /jest/],
    documentation: [/\.md$/, /^docs\//, /README/],
    billing: [/billing/, /stripe/, /payment/, /subscription/],
};

/** Keywords in issue body/title that indicate a domain */
const KEYWORD_PATTERNS: Record<string, RegExp> = {
    backend: /\b(api|endpoint|server|route|controller|service|middleware)\b/i,
    frontend: /\b(ui|component|page|view|react|css|layout|button|form|modal)\b/i,
    database: /\b(schema|migration|table|column|index|query|database|db)\b/i,
    infrastructure: /\b(deploy|docker|ci|cd|pipeline|github.actions|terraform|k8s)\b/i,
    security: /\b(auth|security|permission|token|jwt|oauth|csrf|xss)\b/i,
    testing: /\b(test|spec|coverage|vitest|jest|unit.test|e2e|integration)\b/i,
    documentation: /\b(docs|readme|documentation|guide|tutorial|changelog)\b/i,
    billing: /\b(billing|stripe|payment|subscription|invoice|pricing)\b/i,
};

/**
 * 4-tier domain detection:
 * 1. Title tag: [Backend], [Frontend], etc.
 * 2. Label: backend, frontend, etc.
 * 3. File path patterns in body
 * 4. Keyword matching in body
 */
export function detectDomain(issue: CheenoskiIssue): Domain | 'unknown' {
    // Tier 1: Title tag
    for (const [tag, domain] of Object.entries(DOMAIN_TITLE_TAGS)) {
        if (issue.title.startsWith(tag))
            return domain;
    }

    // Tier 2: Label
    for (const label of issue.labels) {
        const lower = label.toLowerCase();
        if (DOMAINS.includes(lower as Domain))
            return lower as Domain;
    }

    // Tier 3: File path patterns in body
    const bodyLines = issue.body.split('\n');
    for (const line of bodyLines) {
        for (const [domain, patterns] of Object.entries(PATH_PATTERNS)) {
            for (const pattern of patterns) {
                if (pattern.test(line))
                    return domain as Domain;
            }
        }
    }

    // Tier 4: Keyword matching
    const fullText = `${issue.title} ${issue.body}`;
    for (const [domain, pattern] of Object.entries(KEYWORD_PATTERNS)) {
        if (pattern.test(fullText))
            return domain as Domain;
    }

    return 'unknown';
}

/** Check if two domains can safely run in parallel */
export function canRunParallel(a: Domain | 'unknown', b: Domain | 'unknown'): boolean {
    if (a === 'unknown' || b === 'unknown')
        return false;
    if (a === b)
        return false; // Same domain = potential file conflicts
    return SAFE_PARALLEL_PAIRS.has(`${a}:${b}`);
}

/** Slugify an issue title for branch naming */
export function slugify(title: string): string {
    // Remove domain tag prefix
    let cleaned = title;
    for (const tag of Object.keys(DOMAIN_TITLE_TAGS)) {
        if (cleaned.startsWith(tag)) {
            cleaned = cleaned.slice(tag.length).trim();
            break;
        }
    }
    const result = cleaned
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);

    return result || 'task';
}

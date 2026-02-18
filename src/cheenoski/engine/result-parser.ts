import type { EngineResult, EngineName } from '../types.js';

/** Known tool names that indicate actual code modifications */
const CODE_TOOLS = new Set([
  'Write', 'Edit', 'NotebookEdit',
  'write_file', 'edit_file', 'create_file',
  'write', 'str_replace_editor',
]);

/** Known tool names for read-only operations */
const READ_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
  'read_file', 'search_files', 'list_files',
  'bash', 'grep', 'find',
]);

/**
 * Parse Claude's stream-json output for tool usage.
 * Claude Code stream-json format:
 * - {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}}]}}
 * - {"type":"tool_result","tool_use_id":"...","content":"..."}
 * - {"type":"result","result":"...","session_id":"..."}
 */
export function parseStreamJson(output: string): { toolsUsed: string[]; filesChanged: string[] } {
  const toolsUsed = new Set<string>();
  const filesChanged = new Set<string>();

  // Buffer for incomplete JSON lines
  let buffer = '';

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Accumulate into buffer
    buffer += trimmed;

    try {
      const obj = JSON.parse(buffer);

      // Successfully parsed — reset buffer
      buffer = '';

      // Claude Code stream-json: tool_use is nested in message.content
      if (obj.type === 'assistant' && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === 'tool_use' && block.name) {
            toolsUsed.add(block.name);
            if (CODE_TOOLS.has(block.name)) {
              const path = block.input?.file_path || block.input?.path || '';
              if (path) filesChanged.add(path);
            }
          }
        }
      }

      // Top-level tool_use (other engines)
      if (obj.type === 'tool_use' || obj.tool) {
        const toolName = obj.tool || obj.name || '';
        toolsUsed.add(toolName);
        if (CODE_TOOLS.has(toolName)) {
          const path = obj.input?.file_path || obj.input?.path || obj.file_path || '';
          if (path) filesChanged.add(path);
        }
      }

      // Result envelope
      if (obj.type === 'result' && typeof obj.result === 'string') {
        const toolMatches = obj.result.matchAll(/(?:Used|Called|Invoked)\s+(\w+)\s+tool/gi);
        for (const m of toolMatches) {
          toolsUsed.add(m[1]);
        }
      }
    } catch {
      // Incomplete JSON — keep buffering
      // If buffer gets too large (>1MB), reset to prevent memory issues
      if (buffer.length > 1_000_000) {
        buffer = '';
      }
    }
  }

  return {
    toolsUsed: [...toolsUsed],
    filesChanged: [...filesChanged],
  };
}

/**
 * Parse JSON output from OpenCode, Codex, Cursor, Qwen.
 * These tend to have simpler output formats.
 */
export function parseJsonOutput(output: string): { toolsUsed: string[]; filesChanged: string[] } {
  const toolsUsed = new Set<string>();
  const filesChanged = new Set<string>();

  // Try to parse as a single JSON object first
  try {
    const obj = JSON.parse(output);
    if (obj.tools_used) {
      for (const t of obj.tools_used) toolsUsed.add(t);
    }
    if (obj.files_changed || obj.files_modified) {
      for (const f of (obj.files_changed || obj.files_modified)) filesChanged.add(f);
    }
    return { toolsUsed: [...toolsUsed], filesChanged: [...filesChanged] };
  } catch {
    // Not a single JSON object — try line-by-line
  }

  return parseStreamJson(output);
}

/**
 * Detect if an engine result indicates a rate limit.
 * Only checks stderr (not stdout) to avoid false positives from agent output text.
 */
export function isRateLimitError(stderr: string, exitCode: number | null): boolean {
  // POSIX exit codes are 0-255; 429 wraps to 173 (429 % 256)
  if (exitCode === 429 || exitCode === 173) return true;

  const lower = stderr.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota exceeded') ||
    lower.includes('429')
  );
}

/**
 * Detect if an engine result indicates the agent got stuck (no code changes).
 * Returns false (not stuck) if any of these are true:
 * - Write/Edit tools were used
 * - Files were detected as changed
 * - Bash tool was used (may have written files via shell commands)
 */
export function isStuckResult(result: EngineResult): boolean {
  if (!result.success) return false;

  const hasCodeTool = result.toolsUsed.some(t => CODE_TOOLS.has(t));
  const hasFileChanges = result.filesChanged.length > 0;
  const usedBash = result.toolsUsed.includes('Bash') || result.toolsUsed.includes('bash');

  // If Bash was used, assume it may have written files — check git diff later
  return !hasCodeTool && !hasFileChanges && !usedBash;
}

/** Build a default EngineResult for error cases */
export function errorResult(
  engineName: EngineName,
  errorType: EngineResult['errorType'],
  output: string,
  durationMs: number,
  exitCode: number | null = null,
): EngineResult {
  return {
    success: false,
    output,
    toolsUsed: [],
    filesChanged: [],
    durationMs,
    engineName,
    errorType,
    rawExitCode: exitCode,
  };
}

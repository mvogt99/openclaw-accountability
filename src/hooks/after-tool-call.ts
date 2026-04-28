import type { AccountabilityConfig } from "../config.js";
import type { VerificationResult, ConfidenceState } from "../types.js";
import { fileExists } from "../verifiers/file-exists.js";
import { checkSyntax } from "../verifiers/syntax-checker.js";
import { resolveImports } from "../verifiers/import-resolver.js";
import { updateFtalConfidence } from "../ftal-bridge.js";

type AfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

type AfterToolCallContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolCallId?: string;
};

type Logger = { info(msg: string): void };

export function createAfterToolCallHandler(config: AccountabilityConfig, logger: Logger) {
  return async function handleAfterToolCall(
    event: AfterToolCallEvent,
    ctx: AfterToolCallContext,
  ): Promise<void> {
    if (event.error) return; // tool failed — nothing to verify

    const filePath = extractFilePath(event.toolName, event.params, config.watchBash);
    if (!filePath) return;

    if (!shouldVerify(event.toolName, event.params, config)) return;

    const sessionKey = ctx.sessionKey;
    const runId = ctx.runId ?? event.runId;

    const exists = fileExists(filePath);

    let syntaxValid: boolean | undefined;
    let syntaxError: string | undefined;
    let importsResolved: boolean | undefined;
    let unresolvedImports: string[] | undefined;

    if (exists) {
      if (config.syntaxCheck) {
        const syntax = await checkSyntax(filePath);
        if (!syntax.skipped) {
          syntaxValid = syntax.valid;
          syntaxError = syntax.error;
        }
      }

      if (config.importCheck && syntaxValid !== false) {
        const imports = resolveImports(filePath);
        if (!imports.skipped) {
          importsResolved = imports.resolved;
          unresolvedImports = imports.unresolvedImports.length > 0 ? imports.unresolvedImports : undefined;
        }
      }
    }

    const confidence = deriveConfidence(exists, syntaxValid, importsResolved);

    const result: VerificationResult = {
      toolName: event.toolName,
      path: filePath,
      exists,
      syntaxValid,
      syntaxError,
      importsResolved,
      unresolvedImports,
      confidence,
      sessionKey,
      runId,
      checkedAt: Date.now(),
    };

    logger.info(`accountability:verification_result ${JSON.stringify(result)}`);

    await updateFtalConfidence(sessionKey, runId, confidence);
  };
}

function deriveConfidence(
  exists: boolean,
  syntaxValid: boolean | undefined,
  importsResolved: boolean | undefined,
): ConfidenceState {
  if (!exists) return "refuted";
  if (syntaxValid === false) return "refuted";
  if (importsResolved === false) return "refuted";
  if (exists && syntaxValid !== false && importsResolved !== false) return "verified";
  return "provisional";
}

// Extract a file path from tool params. Returns undefined if the tool
// doesn't produce a verifiable file path (e.g. a bash read command).
export function extractFilePath(
  toolName: string,
  params: Record<string, unknown>,
  watchBash: boolean,
): string | undefined {
  // Most write tools use "path"
  if (typeof params.path === "string" && params.path.length > 0) return params.path;
  if (typeof params.file === "string" && params.file.length > 0) return params.file;
  if (typeof params.filename === "string" && params.filename.length > 0) return params.filename;

  // bash: parse redirect target from command string
  if (toolName === "bash" && watchBash && typeof params.command === "string") {
    return extractBashRedirectTarget(params.command);
  }

  return undefined;
}

// Returns the target path from a bash redirect, e.g. "echo foo > /tmp/out.ts" → "/tmp/out.ts"
export function extractBashRedirectTarget(command: string): string | undefined {
  // Match > path or >> path, excluding pipes and process substitution
  const match = command.match(/(?:^|[;&|])\s*[^>]*>+\s*([^\s|&;]+)/);
  const path = match?.[1];
  if (!path || path.startsWith("/dev/null")) return undefined;
  return path;
}

// str_replace_editor view commands are read ops — don't verify them.
function shouldVerify(
  toolName: string,
  params: Record<string, unknown>,
  config: AccountabilityConfig,
): boolean {
  if (toolName === "bash" && !config.watchBash) return false;

  if (toolName === "str_replace_editor") {
    const command = params.command;
    // Only verify write operations
    return command === "create" || command === "str_replace" || command === "insert";
  }

  return config.watchedTools.includes(toolName);
}

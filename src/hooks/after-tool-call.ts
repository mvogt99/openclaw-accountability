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
    if (event.error) return;

    if (!shouldVerify(event.toolName, event.params, config)) return;

    const sessionKey = ctx.sessionKey;
    const runId = ctx.runId ?? event.runId;

    // apply_patch can touch multiple files — emit one result per file.
    const filePaths = event.toolName === "apply_patch"
      ? extractPatchFilePaths(event.params)
      : (() => { const p = extractFilePath(event.toolName, event.params, config.watchBash); return p ? [p] : []; })();

    for (const filePath of filePaths) {
      const result = await verifyFile(filePath, event.toolName, sessionKey, runId, config);
      logger.info(`accountability:verification_result ${JSON.stringify(result)}`);
      await updateFtalConfidence(sessionKey, runId, result.confidence);
    }
  };
}

async function verifyFile(
  filePath: string,
  toolName: string,
  sessionKey: string | undefined,
  runId: string | undefined,
  config: AccountabilityConfig,
): Promise<VerificationResult> {
  const exists = fileExists(filePath);

  let syntaxValid: boolean | undefined;
  let syntaxError: string | undefined;
  let syntaxSkippedUnavailable = false;
  let importsResolved: boolean | undefined;
  let unresolvedImports: string[] | undefined;

  if (exists) {
    if (config.syntaxCheck) {
      const syntax = await checkSyntax(filePath);
      if (!syntax.skipped) {
        syntaxValid = syntax.valid;
        syntaxError = syntax.error;
      } else if (syntax.skipReason === "typescript-unavailable") {
        // TS was absent for a checkable file — can't claim verified.
        syntaxSkippedUnavailable = true;
      }
      // "unsupported-extension" means the file type doesn't support syntax checks — not penalised.
    }

    if (config.importCheck && syntaxValid !== false) {
      const imports = resolveImports(filePath);
      if (!imports.skipped) {
        importsResolved = imports.resolved;
        unresolvedImports = imports.unresolvedImports.length > 0 ? imports.unresolvedImports : undefined;
      }
    }
  }

  const confidence = deriveConfidence(exists, syntaxValid, syntaxSkippedUnavailable, importsResolved);

  return {
    toolName,
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
}

export function deriveConfidence(
  exists: boolean,
  syntaxValid: boolean | undefined,
  syntaxSkippedUnavailable: boolean,
  importsResolved: boolean | undefined,
): ConfidenceState {
  if (!exists) return "refuted";
  if (syntaxValid === false) return "refuted";
  if (importsResolved === false) return "refuted";
  // TS was absent for a checkable file — we have existence but can't confirm correctness.
  if (syntaxSkippedUnavailable) return "provisional";
  return "verified";
}

// Extract a single file path from tool params.
export function extractFilePath(
  toolName: string,
  params: Record<string, unknown>,
  watchBash: boolean,
): string | undefined {
  if (typeof params.path === "string" && params.path.length > 0) return params.path;
  if (typeof params.file === "string" && params.file.length > 0) return params.file;
  if (typeof params.filename === "string" && params.filename.length > 0) return params.filename;

  // exec is OpenClaw's native shell tool; bash is the accepted alias.
  if ((toolName === "exec" || toolName === "bash") && watchBash && typeof params.command === "string") {
    return extractBashRedirectTarget(params.command);
  }

  return undefined;
}

// Extract all file paths touched by an apply_patch call.
// Parses unified-diff headers from params.patch or params.content.
export function extractPatchFilePaths(params: Record<string, unknown>): string[] {
  const patch =
    typeof params.patch === "string" ? params.patch :
    typeof params.content === "string" ? params.content : null;

  if (!patch) return [];

  const paths = new Set<string>();

  // "+++ b/path" (unified diff)
  for (const match of patch.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
    const p = match[1]!.trim();
    if (p !== "/dev/null") paths.add(p);
  }

  // "diff --git a/path b/path" (git format)
  for (const match of patch.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)) {
    paths.add(match[1]!.trim());
  }

  return [...paths];
}

// Returns the redirect target from a shell command, e.g. "echo hi > /tmp/out.ts" → "/tmp/out.ts"
export function extractBashRedirectTarget(command: string): string | undefined {
  const match = command.match(/(?:^|[;&|])\s*[^>]*>+\s*([^\s|&;]+)/);
  const path = match?.[1];
  if (!path || path.startsWith("/dev/null")) return undefined;
  return path;
}

function shouldVerify(
  toolName: string,
  params: Record<string, unknown>,
  config: AccountabilityConfig,
): boolean {
  // exec is OpenClaw's native shell tool; bash is the alias. Only verify when watchBash is on.
  if (toolName === "exec" || toolName === "bash") return config.watchBash;

  if (toolName === "str_replace_editor") {
    const command = params.command;
    return command === "create" || command === "str_replace" || command === "insert";
  }

  if (toolName === "apply_patch") return config.watchedTools.includes("apply_patch");

  return config.watchedTools.includes(toolName);
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAfterToolCallHandler,
  extractFilePath,
  extractBashRedirectTarget,
  extractPatchFilePaths,
  deriveConfidence,
} from "./after-tool-call.js";
import type { AccountabilityConfig } from "../config.js";

vi.mock("../verifiers/file-exists.js", () => ({ fileExists: vi.fn() }));
vi.mock("../verifiers/syntax-checker.js", () => ({ checkSyntax: vi.fn() }));
vi.mock("../verifiers/import-resolver.js", () => ({ resolveImports: vi.fn() }));
vi.mock("../ftal-bridge.js", () => ({ updateFtalConfidence: vi.fn() }));

import { fileExists } from "../verifiers/file-exists.js";
import { checkSyntax } from "../verifiers/syntax-checker.js";
import { resolveImports } from "../verifiers/import-resolver.js";
import { updateFtalConfidence } from "../ftal-bridge.js";

const defaultConfig: AccountabilityConfig = {
  watchedTools: ["write", "edit", "apply_patch", "write_file", "create_file", "str_replace_editor"],
  watchBash: false,
  syntaxCheck: true,
  importCheck: true,
};

const logger = { info: vi.fn() };

const baseEvent = {
  toolName: "write_file",
  params: { path: "/tmp/test.ts", content: "const x = 1;" },
  runId: "run-1",
};
const baseCtx = { sessionKey: "sess-1", runId: "run-1", toolName: "write_file" };

function parseLog(call: string): Record<string, unknown> {
  return JSON.parse(call.replace("accountability:verification_result ", ""));
}

describe("createAfterToolCallHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fileExists).mockReturnValue(true);
    vi.mocked(checkSyntax).mockResolvedValue({ valid: true, skipped: false });
    vi.mocked(resolveImports).mockReturnValue({ skipped: false, resolved: true, unresolvedImports: [] });
    vi.mocked(updateFtalConfidence).mockResolvedValue(undefined);
  });

  it("logs verified when file exists, syntax valid, imports resolved", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    expect(logger.info).toHaveBeenCalledOnce();
    const logged = parseLog(logger.info.mock.calls[0]![0]);
    expect(logged.confidence).toBe("verified");
    expect(logged.exists).toBe(true);
    expect(logged.syntaxValid).toBe(true);
    expect(logged.importsResolved).toBe(true);
  });

  it("logs refuted when file does not exist", async () => {
    vi.mocked(fileExists).mockReturnValue(false);
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    expect(parseLog(logger.info.mock.calls[0]![0]).confidence).toBe("refuted");
  });

  it("logs refuted when syntax is invalid", async () => {
    vi.mocked(checkSyntax).mockResolvedValue({ valid: false, skipped: false, error: "Unexpected token" });
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    const logged = parseLog(logger.info.mock.calls[0]![0]);
    expect(logged.confidence).toBe("refuted");
    expect(logged.syntaxError).toBe("Unexpected token");
  });

  it("logs refuted when imports are unresolved", async () => {
    vi.mocked(resolveImports).mockReturnValue({ skipped: false, resolved: false, unresolvedImports: ["./missing"] });
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    const logged = parseLog(logger.info.mock.calls[0]![0]);
    expect(logged.confidence).toBe("refuted");
    expect(logged.unresolvedImports).toContain("./missing");
  });

  it("logs provisional when syntax check skipped due to TypeScript unavailable", async () => {
    vi.mocked(checkSyntax).mockResolvedValue({ valid: true, skipped: true, skipReason: "typescript-unavailable" });
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    expect(parseLog(logger.info.mock.calls[0]![0]).confidence).toBe("provisional");
  });

  it("does NOT log provisional when syntax skipped for unsupported extension", async () => {
    vi.mocked(checkSyntax).mockResolvedValue({ valid: true, skipped: true, skipReason: "unsupported-extension" });
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    // unsupported extension means not applicable — should still be verified (imports also pass)
    expect(parseLog(logger.info.mock.calls[0]![0]).confidence).toBe("verified");
  });

  it("skips import check when syntax invalid", async () => {
    vi.mocked(checkSyntax).mockResolvedValue({ valid: false, skipped: false, error: "bad" });
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    expect(resolveImports).not.toHaveBeenCalled();
  });

  it("does not log when tool call has an error", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler({ ...baseEvent, error: "permission denied" }, baseCtx);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("does not log when no file path found in params", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler({ ...baseEvent, params: { command: "ls" } }, baseCtx);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("skips str_replace_editor view commands", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(
      { toolName: "str_replace_editor", params: { command: "view", path: "/tmp/f.ts" }, runId: "r1" },
      { ...baseCtx, toolName: "str_replace_editor" },
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("verifies str_replace_editor create commands", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(
      { toolName: "str_replace_editor", params: { command: "create", path: "/tmp/new.ts" }, runId: "r1" },
      { ...baseCtx, toolName: "str_replace_editor" },
    );
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("verifies OpenClaw native 'write' tool", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(
      { toolName: "write", params: { path: "/tmp/native.ts" }, runId: "r1" },
      { ...baseCtx, toolName: "write" },
    );
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("verifies OpenClaw native 'edit' tool", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(
      { toolName: "edit", params: { path: "/tmp/native.ts" }, runId: "r1" },
      { ...baseCtx, toolName: "edit" },
    );
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("emits one log entry per file for apply_patch", async () => {
    const patch = `diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\ndiff --git a/src/b.ts b/src/b.ts\n+++ b/src/b.ts\n`;
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(
      { toolName: "apply_patch", params: { patch }, runId: "r1" },
      { ...baseCtx, toolName: "apply_patch" },
    );
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it("does not log for apply_patch with no parseable paths", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(
      { toolName: "apply_patch", params: { patch: "no file headers here" }, runId: "r1" },
      { ...baseCtx, toolName: "apply_patch" },
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("skips exec tool when watchBash is false", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(
      { toolName: "exec", params: { command: "echo hi > /tmp/out.ts" }, runId: "r1" },
      { ...baseCtx, toolName: "exec" },
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("verifies exec redirect when watchBash is true", async () => {
    const config = { ...defaultConfig, watchBash: true };
    const handler = createAfterToolCallHandler(config, logger);
    await handler(
      { toolName: "exec", params: { command: "echo hi > /tmp/out.ts" }, runId: "r1" },
      { ...baseCtx, toolName: "exec" },
    );
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("calls updateFtalConfidence with derived state", async () => {
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    expect(updateFtalConfidence).toHaveBeenCalledWith("sess-1", "run-1", "verified");
  });

  it("skips syntax check when syntaxCheck config is false", async () => {
    const config = { ...defaultConfig, syntaxCheck: false };
    const handler = createAfterToolCallHandler(config, logger);
    await handler(baseEvent, baseCtx);
    expect(checkSyntax).not.toHaveBeenCalled();
  });

  it("skips import check when importCheck config is false", async () => {
    const config = { ...defaultConfig, importCheck: false };
    const handler = createAfterToolCallHandler(config, logger);
    await handler(baseEvent, baseCtx);
    expect(resolveImports).not.toHaveBeenCalled();
  });
});

// --- deriveConfidence ---

describe("deriveConfidence", () => {
  it("returns refuted when file does not exist", () => {
    expect(deriveConfidence(false, undefined, false, undefined)).toBe("refuted");
  });

  it("returns refuted when syntax is invalid", () => {
    expect(deriveConfidence(true, false, false, undefined)).toBe("refuted");
  });

  it("returns refuted when imports unresolved", () => {
    expect(deriveConfidence(true, true, false, false)).toBe("refuted");
  });

  it("returns provisional when TS was unavailable for checkable file", () => {
    expect(deriveConfidence(true, undefined, true, undefined)).toBe("provisional");
  });

  it("returns verified when all checks pass", () => {
    expect(deriveConfidence(true, true, false, true)).toBe("verified");
  });

  it("returns verified when syntax not applicable (unsupported ext) and imports pass", () => {
    // syntaxValid=undefined but syntaxSkippedUnavailable=false → not penalised
    expect(deriveConfidence(true, undefined, false, true)).toBe("verified");
  });
});

// --- extractFilePath ---

describe("extractFilePath", () => {
  it("extracts from params.path", () => {
    expect(extractFilePath("write_file", { path: "/tmp/f.ts" }, false)).toBe("/tmp/f.ts");
  });

  it("extracts from params.file", () => {
    expect(extractFilePath("write_file", { file: "/tmp/f.ts" }, false)).toBe("/tmp/f.ts");
  });

  it("returns undefined when no path param", () => {
    expect(extractFilePath("write_file", { content: "x" }, false)).toBeUndefined();
  });

  it("extracts bash redirect when watchBash=true", () => {
    expect(extractFilePath("bash", { command: "echo hi > /tmp/out.ts" }, true)).toBe("/tmp/out.ts");
  });

  it("extracts exec redirect when watchBash=true", () => {
    expect(extractFilePath("exec", { command: "echo hi > /tmp/out.ts" }, true)).toBe("/tmp/out.ts");
  });

  it("does not extract bash/exec paths when watchBash=false", () => {
    expect(extractFilePath("bash", { command: "echo hi > /tmp/out.ts" }, false)).toBeUndefined();
    expect(extractFilePath("exec", { command: "echo hi > /tmp/out.ts" }, false)).toBeUndefined();
  });
});

// --- extractPatchFilePaths ---

describe("extractPatchFilePaths", () => {
  it("extracts paths from +++ b/ lines", () => {
    const patch = `--- a/src/foo.ts\n+++ b/src/foo.ts\n--- a/src/bar.ts\n+++ b/src/bar.ts\n`;
    expect(extractPatchFilePaths({ patch })).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("extracts paths from diff --git lines", () => {
    const patch = `diff --git a/src/foo.ts b/src/foo.ts\ndiff --git a/src/bar.ts b/src/bar.ts\n`;
    expect(extractPatchFilePaths({ patch })).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("deduplicates paths appearing in both formats", () => {
    const patch = `diff --git a/src/foo.ts b/src/foo.ts\n+++ b/src/foo.ts\n`;
    expect(extractPatchFilePaths({ patch })).toEqual(["src/foo.ts"]);
  });

  it("excludes /dev/null", () => {
    const patch = `+++ b/dev/null\n+++ b/src/real.ts\n`;
    // /dev/null check is on path starting with /dev/null
    const paths = extractPatchFilePaths({ patch });
    expect(paths).not.toContain("/dev/null");
    expect(paths).toContain("src/real.ts");
  });

  it("falls back to params.content when params.patch absent", () => {
    const patch = `+++ b/src/foo.ts\n`;
    expect(extractPatchFilePaths({ content: patch })).toEqual(["src/foo.ts"]);
  });

  it("returns empty array when no patch params", () => {
    expect(extractPatchFilePaths({ command: "something" })).toEqual([]);
  });
});

// --- extractBashRedirectTarget ---

describe("extractBashRedirectTarget", () => {
  it("extracts single redirect target", () => {
    expect(extractBashRedirectTarget("echo foo > /tmp/out.ts")).toBe("/tmp/out.ts");
  });

  it("extracts append redirect target", () => {
    expect(extractBashRedirectTarget("echo foo >> /tmp/out.ts")).toBe("/tmp/out.ts");
  });

  it("returns undefined for /dev/null", () => {
    expect(extractBashRedirectTarget("echo foo > /dev/null")).toBeUndefined();
  });

  it("returns undefined when no redirect", () => {
    expect(extractBashRedirectTarget("ls -la")).toBeUndefined();
  });
});

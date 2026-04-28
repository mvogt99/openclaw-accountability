import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAfterToolCallHandler, extractFilePath, extractBashRedirectTarget } from "./after-tool-call.js";
import type { AccountabilityConfig } from "../config.js";

// Mock all I/O dependencies — unit test only the orchestration logic.
vi.mock("../verifiers/file-exists.js", () => ({ fileExists: vi.fn() }));
vi.mock("../verifiers/syntax-checker.js", () => ({ checkSyntax: vi.fn() }));
vi.mock("../verifiers/import-resolver.js", () => ({ resolveImports: vi.fn() }));
vi.mock("../ftal-bridge.js", () => ({ updateFtalConfidence: vi.fn() }));

import { fileExists } from "../verifiers/file-exists.js";
import { checkSyntax } from "../verifiers/syntax-checker.js";
import { resolveImports } from "../verifiers/import-resolver.js";
import { updateFtalConfidence } from "../ftal-bridge.js";

const defaultConfig: AccountabilityConfig = {
  watchedTools: ["write_file", "create_file", "str_replace_editor"],
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
    const logged = JSON.parse(logger.info.mock.calls[0]![0].replace("accountability:verification_result ", ""));
    expect(logged.confidence).toBe("verified");
    expect(logged.exists).toBe(true);
    expect(logged.syntaxValid).toBe(true);
    expect(logged.importsResolved).toBe(true);
  });

  it("logs refuted when file does not exist", async () => {
    vi.mocked(fileExists).mockReturnValue(false);
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    const logged = JSON.parse(logger.info.mock.calls[0]![0].replace("accountability:verification_result ", ""));
    expect(logged.confidence).toBe("refuted");
    expect(logged.exists).toBe(false);
  });

  it("logs refuted when syntax is invalid", async () => {
    vi.mocked(checkSyntax).mockResolvedValue({ valid: false, skipped: false, error: "Unexpected token" });
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    const logged = JSON.parse(logger.info.mock.calls[0]![0].replace("accountability:verification_result ", ""));
    expect(logged.confidence).toBe("refuted");
    expect(logged.syntaxError).toBe("Unexpected token");
  });

  it("logs refuted when imports are unresolved", async () => {
    vi.mocked(resolveImports).mockReturnValue({ skipped: false, resolved: false, unresolvedImports: ["./missing"] });
    const handler = createAfterToolCallHandler(defaultConfig, logger);
    await handler(baseEvent, baseCtx);
    const logged = JSON.parse(logger.info.mock.calls[0]![0].replace("accountability:verification_result ", ""));
    expect(logged.confidence).toBe("refuted");
    expect(logged.unresolvedImports).toContain("./missing");
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

  it("extracts bash redirect path when watchBash is true", () => {
    expect(extractFilePath("bash", { command: "echo hi > /tmp/out.ts" }, true)).toBe("/tmp/out.ts");
  });

  it("does not extract bash paths when watchBash is false", () => {
    expect(extractFilePath("bash", { command: "echo hi > /tmp/out.ts" }, false)).toBeUndefined();
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

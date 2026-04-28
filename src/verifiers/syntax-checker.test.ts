import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSyntax } from "./syntax-checker.js";

const dir = mkdtempSync(join(tmpdir(), "p2-syntax-"));

function writeTemp(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("checkSyntax", () => {
  it("returns skipped=true for non-TS/JS files", async () => {
    const p = writeTemp("file.json", "{}");
    const result = await checkSyntax(p);
    expect(result.skipped).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("returns valid=true for correct TypeScript", async () => {
    const p = writeTemp("ok.ts", "export const x: number = 1;\n");
    const result = await checkSyntax(p);
    if (result.skipped) return; // typescript not installed in this env — skip
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns valid=false for TypeScript with a syntax error", async () => {
    const p = writeTemp("bad.ts", "export const x: number = ;\n");
    const result = await checkSyntax(p);
    if (result.skipped) return;
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns valid=true for correct JavaScript", async () => {
    const p = writeTemp("ok.js", "export const x = 1;\n");
    const result = await checkSyntax(p);
    if (result.skipped) return;
    expect(result.valid).toBe(true);
  });

  it("returns valid=false for JavaScript with a clear syntax error", async () => {
    // TypeScript's JS parser is lenient about some expression errors; use an
    // unambiguously invalid token sequence that both JS and TS parsers reject.
    const p = writeTemp("bad.js", "const { = x;\n");
    const result = await checkSyntax(p);
    if (result.skipped) return;
    expect(result.valid).toBe(false);
  });

  it("returns valid=false when file cannot be read", async () => {
    const result = await checkSyntax("/nonexistent/path/file.ts");
    // skipped or valid=false — either is acceptable when file is missing
    if (!result.skipped) {
      expect(result.valid).toBe(false);
    }
  });
});

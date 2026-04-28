import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileExists } from "./file-exists.js";

describe("fileExists", () => {
  const dir = mkdtempSync(join(tmpdir(), "p2-test-"));

  it("returns true for an existing file", () => {
    const p = join(dir, "real.ts");
    writeFileSync(p, "export const x = 1;");
    expect(fileExists(p)).toBe(true);
    unlinkSync(p);
  });

  it("returns false for a non-existent path", () => {
    expect(fileExists(join(dir, "ghost.ts"))).toBe(false);
  });

  it("returns false for an empty string path", () => {
    expect(fileExists("")).toBe(false);
  });
});

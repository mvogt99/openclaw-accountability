import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractLocalImports, resolveImports } from "./import-resolver.js";

// --- extractLocalImports ---

describe("extractLocalImports", () => {
  it("extracts static import paths", () => {
    const content = `import { foo } from "./foo";\nimport type { Bar } from "../bar";\n`;
    expect(extractLocalImports(content)).toEqual(["./foo", "../bar"]);
  });

  it("ignores npm package imports", () => {
    const content = `import { z } from "zod";\nimport React from "react";\n`;
    expect(extractLocalImports(content)).toEqual([]);
  });

  it("extracts dynamic imports", () => {
    const content = `const mod = await import("./dynamic");\n`;
    expect(extractLocalImports(content)).toEqual(["./dynamic"]);
  });

  it("extracts require calls", () => {
    const content = `const x = require("./util");\n`;
    expect(extractLocalImports(content)).toEqual(["./util"]);
  });

  it("deduplicates repeated imports", () => {
    const content = `import "./shared";\nimport "./shared";\n`;
    expect(extractLocalImports(content)).toEqual(["./shared"]);
  });

  it("extracts re-export paths", () => {
    const content = `export { foo } from "./foo";\n`;
    expect(extractLocalImports(content)).toEqual(["./foo"]);
  });

  it("returns empty array for content with no local imports", () => {
    expect(extractLocalImports("const x = 1;\n")).toEqual([]);
  });
});

// --- resolveImports ---

describe("resolveImports", () => {
  const dir = mkdtempSync(join(tmpdir(), "p2-imports-"));

  it("returns skipped=true for non-parseable extensions", () => {
    const p = join(dir, "file.json");
    writeFileSync(p, "{}");
    const result = resolveImports(p);
    expect(result.skipped).toBe(true);
  });

  it("returns resolved=true when all local imports exist", () => {
    writeFileSync(join(dir, "dep.ts"), "export const x = 1;\n");
    const main = join(dir, "main.ts");
    writeFileSync(main, `import { x } from "./dep";\n`);
    const result = resolveImports(main);
    expect(result.skipped).toBe(false);
    expect(result.resolved).toBe(true);
    expect(result.unresolvedImports).toEqual([]);
  });

  it("returns resolved=false with unresolved list when import is missing", () => {
    const main = join(dir, "broken.ts");
    writeFileSync(main, `import { x } from "./nonexistent";\n`);
    const result = resolveImports(main);
    expect(result.resolved).toBe(false);
    expect(result.unresolvedImports).toContain("./nonexistent");
  });

  it("resolves imports with explicit extensions", () => {
    writeFileSync(join(dir, "explicit.ts"), "export const y = 2;\n");
    const main = join(dir, "with-ext.ts");
    writeFileSync(main, `import { y } from "./explicit.ts";\n`);
    const result = resolveImports(main);
    expect(result.resolved).toBe(true);
  });

  it("returns resolved=true when file has no local imports", () => {
    const main = join(dir, "no-imports.ts");
    writeFileSync(main, `import { z } from "zod";\nexport const x = 1;\n`);
    const result = resolveImports(main);
    expect(result.resolved).toBe(true);
    expect(result.unresolvedImports).toEqual([]);
  });
});

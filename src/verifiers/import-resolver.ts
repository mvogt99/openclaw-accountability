import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";

// Extensions tried when resolving a bare relative import (e.g. "./foo" → "./foo.ts")
const RESOLUTION_ORDER = [
  "",           // exact match (already has extension or is a directory with package.json)
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  "/index.ts", "/index.tsx", "/index.js", "/index.jsx",
];

// Only TS/JS files can have extractable imports.
const PARSEABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export interface ImportResolveResult {
  skipped: boolean;
  resolved: boolean;
  unresolvedImports: string[];
}

export function resolveImports(filePath: string): ImportResolveResult {
  const ext = extname(filePath);
  if (!PARSEABLE_EXTENSIONS.has(ext)) {
    return { skipped: true, resolved: true, unresolvedImports: [] };
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { skipped: false, resolved: false, unresolvedImports: [] };
  }

  const localImports = extractLocalImports(content);
  if (localImports.length === 0) {
    return { skipped: false, resolved: true, unresolvedImports: [] };
  }

  const dir = dirname(filePath);
  const unresolved: string[] = [];

  for (const importPath of localImports) {
    if (!resolveLocalPath(dir, importPath)) {
      unresolved.push(importPath);
    }
  }

  return {
    skipped: false,
    resolved: unresolved.length === 0,
    unresolvedImports: unresolved,
  };
}

// Regex-based extraction covers the patterns agents produce.
// Skips npm package imports (no leading ./ or ../).
export function extractLocalImports(content: string): string[] {
  const paths = new Set<string>();

  // Static imports/exports: import ... from './foo' | export ... from './foo'
  const staticPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";\n]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
  for (const match of content.matchAll(staticPattern)) {
    paths.add(match[1]!);
  }

  // Dynamic imports: import('./foo')
  const dynamicPattern = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const match of content.matchAll(dynamicPattern)) {
    paths.add(match[1]!);
  }

  // CommonJS require: require('./foo')
  const requirePattern = /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const match of content.matchAll(requirePattern)) {
    paths.add(match[1]!);
  }

  return [...paths];
}

function resolveLocalPath(dir: string, importPath: string): boolean {
  const base = resolve(dir, importPath);
  for (const suffix of RESOLUTION_ORDER) {
    if (existsSync(base + suffix)) return true;
  }
  return false;
}

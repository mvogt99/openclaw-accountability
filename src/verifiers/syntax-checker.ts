import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";

const CHECKABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export interface SyntaxCheckResult {
  valid: boolean;
  skipped: boolean;  // true when the file type isn't checkable or typescript isn't available
  error?: string;
}

export async function checkSyntax(filePath: string): Promise<SyntaxCheckResult> {
  const ext = extname(filePath);
  if (!CHECKABLE_EXTENSIONS.has(ext)) {
    return { valid: true, skipped: true };
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { valid: false, skipped: false, error: "Could not read file" };
  }

  // TypeScript is an optional peer dependency. If absent, skip the check.
  let ts: typeof import("typescript");
  try {
    const mod = await import("typescript");
    ts = (mod.default ?? mod) as typeof import("typescript");
  } catch {
    return { valid: true, skipped: true };
  }

  return checkWithTypeScript(ts, filePath, content, ext);
}

function scriptKindFor(ext: string, ts: typeof import("typescript")): number {
  switch (ext) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default:     return ts.ScriptKind.TS;
  }
}

function checkWithTypeScript(
  ts: typeof import("typescript"),
  filePath: string,
  content: string,
  ext: string,
): SyntaxCheckResult {
  try {
    const base = basename(filePath);
    const host = ts.createCompilerHost({});
    const customHost: import("typescript").CompilerHost = {
      ...host,
      getSourceFile(name, version) {
        if (name === base) return ts.createSourceFile(base, content, version, true, scriptKindFor(ext, ts));
        return host.getSourceFile(name, version);
      },
      fileExists: (name) => name === base || host.fileExists(name),
      readFile:   (name) => name === base ? content : host.readFile(name),
    };

    const isJs = ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs";
    const program = ts.createProgram([base], { noLib: true, noResolve: true, allowJs: isJs }, customHost);
    const diagnostics = program.getSyntacticDiagnostics();

    if (diagnostics.length > 0) {
      const first = diagnostics[0]!;
      const message = typeof first.messageText === "string"
        ? first.messageText
        : first.messageText.messageText;
      return { valid: false, skipped: false, error: message };
    }

    return { valid: true, skipped: false };
  } catch (err) {
    return { valid: false, skipped: false, error: String(err) };
  }
}

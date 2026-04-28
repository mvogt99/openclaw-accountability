export type ConfidenceState = "provisional" | "verified" | "refuted";

export interface VerificationResult {
  toolName: string;
  path: string;
  operation?: "write" | "delete"; // "delete" = file was intentionally removed by the patch
  exists: boolean;
  syntaxValid?: boolean;      // undefined if file doesn't exist or check was skipped
  syntaxError?: string;
  importsResolved?: boolean;  // undefined if syntax invalid or check was skipped
  unresolvedImports?: string[];
  confidence: ConfidenceState;
  sessionKey?: string;
  runId?: string;
  checkedAt: number;
}

import type { ConfidenceState } from "./types.js";

// Minimal shape we need from FtalStore — avoids importing the full openclaw-ftal package
// at the type level, which would make it a hard dependency.
interface FtalStoreShape {
  getLatest(sessionKey: string): { runId?: string } | undefined;
  updateConfidence(sessionKey: string, runId: string, state: ConfidenceState, memoryIds?: string[]): boolean;
}

let resolvedStore: FtalStoreShape | null | undefined = undefined; // undefined = not yet attempted

async function getStore(): Promise<FtalStoreShape | null> {
  if (resolvedStore !== undefined) return resolvedStore;
  try {
    const mod = await import("openclaw-ftal/store");
    resolvedStore = mod.FtalStore as FtalStoreShape;
  } catch {
    // openclaw-ftal not installed — confidence updates are no-ops.
    resolvedStore = null;
  }
  return resolvedStore;
}

export async function updateFtalConfidence(
  sessionKey: string | undefined,
  runId: string | undefined,
  confidence: ConfidenceState,
): Promise<void> {
  if (!sessionKey || !runId) return;
  const store = await getStore();
  if (!store) return;
  store.updateConfidence(sessionKey, runId, confidence);
}

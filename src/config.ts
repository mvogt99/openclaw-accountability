import { z } from "zod";

export const accountabilityConfigSchema = z.object({
  // Tool names that trigger verification. str_replace_editor write ops are always included.
  watchedTools: z.array(z.string()).default(["write_file", "create_file", "str_replace_editor"]),
  // Also extract paths from bash commands (redirect detection: "> file"). Off by default.
  watchBash: z.boolean().default(false),
  // Run syntax check (requires typescript peer dep — skipped gracefully if unavailable).
  syntaxCheck: z.boolean().default(true),
  // Resolve local imports after syntax check passes.
  importCheck: z.boolean().default(true),
});

export type AccountabilityConfig = z.infer<typeof accountabilityConfigSchema>;

export function parseConfig(raw: unknown): AccountabilityConfig {
  return accountabilityConfigSchema.parse(raw ?? {});
}

import { existsSync } from "node:fs";

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

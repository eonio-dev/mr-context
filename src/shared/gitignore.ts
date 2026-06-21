// src/shared/gitignore.ts
// Maintain a managed block in the workspace root .gitignore that ignores the
// sibling clones (workspace/<name>/) created by `mrc build`. The block is
// delimited so it can be refreshed in place without touching the user's own
// entries, and is a no-op when the workspace is not a git repo (the file is
// simply created — harmless).

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const BLOCK_START = "# >>> mr-context clones (managed) >>>";
const BLOCK_END = "# <<< mr-context clones (managed) <<<";

// Write or refresh the managed block listing the given clone folder names.
// Returns true if the file changed.
export function updateClonesGitignore(cwd: string, cloneNames: string[]): boolean {
  const gitignorePath = resolve(cwd, ".gitignore");
  const managed = [
    BLOCK_START,
    "# Cloned repositories indexed by mr-context — safe to delete & rebuild.",
    ...cloneNames.map((n) => `/${n}/`),
    BLOCK_END,
    "",
  ].join("\n");

  let existing = "";
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf-8");
  }

  const blockRe = new RegExp(`${escapeRe(BLOCK_START)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, "m");
  const next = blockRe.test(existing)
    ? existing.replace(blockRe, managed)
    : (existing.trimEnd() + (existing.trim() ? "\n\n" : "") + managed);

  if (next === existing) return false;
  writeFileSync(gitignorePath, next, "utf-8");
  return true;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

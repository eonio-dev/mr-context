// src/extraction/clone.ts
// Clone (or update) configured repositories into a local repos directory.
// All branch/protocol handling is delegated to git itself, so ssh://, ssl://,
// git://, SCP-like, and HTTPS URLs all work without special-casing.

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { parseRepositoryUrl } from "./github.js";

const execFileAsync = promisify(execFile);
const git = process.platform === "win32" ? "git.exe" : "git";
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

// Filesystem-safe folder name for a repo, e.g. "owner__repo". Retained for the
// metadata fallback path; the workspace layout clones by plain repo name instead.
export function repoSlug(owner: string, name: string): string {
  return `${owner}__${name}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

// Local clone path for a repo under the workspace clones dir, by folder name.
export function repoLocalPath(clonesDir: string, name: string): string {
  return join(clonesDir, name);
}

// For GitHub HTTPS URLs, inject a token so private repos clone non-interactively.
// SSH/SSL schemes rely on the environment's SSH agent and are returned unchanged.
function authenticatedUrl(url: string, githubToken?: string): string {
  const token = githubToken ?? process.env.GITHUB_TOKEN;
  if (!token) return url;
  const m = url.match(/^https:\/\/github\.com\/(.+)$/);
  return m ? `https://${token}@github.com/${m[1]}` : url;
}

// Read the origin remote URL from a working tree's .git/config, or null.
export function readOriginUrl(dir: string): string | null {
  try {
    const cfg = readFileSync(join(dir, ".git", "config"), "utf-8");
    const m = cfg.match(/\[remote\s+"origin"\][^[]*?url\s*=\s*(.+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Read the currently checked-out branch name, or null if detached/unavailable.
export function readCurrentBranch(dir: string): string | null {
  try {
    const head = readFileSync(join(dir, ".git", "HEAD"), "utf-8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// True if two repo URLs point at the same repository, across protocols
// (https/ssh/ssl/scp), by comparing parsed host + owner + name.
export function sameRepo(a: string, b: string): boolean {
  try {
    const pa = parseRepositoryUrl(a);
    const pb = parseRepositoryUrl(b);
    return (
      pa.host.toLowerCase() === pb.host.toLowerCase() &&
      pa.owner.toLowerCase() === pb.owner.toLowerCase() &&
      pa.name.toLowerCase() === pb.name.toLowerCase()
    );
  } catch {
    return false;
  }
}

// True if the working tree has uncommitted changes (staged or unstaged).
async function isDirty(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(git, ["-C", dir, "status", "--porcelain"], {
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export interface CloneOptions {
  url: string;
  branch: string;
  clonesDir: string;
  name: string;
  githubToken?: string;
}

export interface CloneResult {
  path: string;     // absolute working-tree path
  dirty: boolean;   // existing clone had uncommitted changes; left untouched
  reused: boolean;  // an existing clone was updated/kept instead of freshly cloned
}

// Clone the repo at the requested branch, or update an existing clone in place.
// An existing clone with uncommitted changes is NEVER reset — the developer's
// working tree is preserved and indexed as-is (dirty=true). Clean clones are
// fast-forwarded to the configured branch.
export async function cloneOrUpdateRepo(opts: CloneOptions): Promise<CloneResult> {
  const dest = repoLocalPath(opts.clonesDir, opts.name);
  const env = { ...process.env };

  if (existsSync(join(dest, ".git"))) {
    if (await isDirty(dest)) {
      // Preserve uncommitted work — index whatever is checked out now.
      return { path: dest, dirty: true, reused: true };
    }
    await execFileAsync(git, ["-C", dest, "fetch", "--depth", "1", "origin", opts.branch], {
      maxBuffer: GIT_MAX_BUFFER, env,
    });
    await execFileAsync(git, ["-C", dest, "checkout", "-B", opts.branch, `origin/${opts.branch}`], {
      maxBuffer: GIT_MAX_BUFFER, env,
    });
    await execFileAsync(git, ["-C", dest, "reset", "--hard", `origin/${opts.branch}`], {
      maxBuffer: GIT_MAX_BUFFER, env,
    });
    return { path: dest, dirty: false, reused: true };
  }

  await mkdir(opts.clonesDir, { recursive: true });
  await execFileAsync(git, [
    "clone",
    "--branch", opts.branch,
    "--single-branch",
    "--depth", "1",
    authenticatedUrl(opts.url, opts.githubToken),
    dest,
  ], { maxBuffer: GIT_MAX_BUFFER, env });

  return { path: dest, dirty: false, reused: false };
}

// src/extraction/index.ts
import type { ExtractionResult, MrcConfig, ResolvedRepo } from "../shared/types.js";
import { resolveRepos } from "../shared/config.js";
import { extractWithRepomix } from "./repomix.js";
import { fetchRepositoryMetadata } from "./github.js";

export async function extractRepositories(
  config: MrcConfig
): Promise<ExtractionResult> {
  const repos = resolveRepos(config);
  if (repos.length === 0) {
    throw new Error(
      "No repositories configured. Add URLs to your .mrc/config.json file or set MRC_REPOS."
    );
  }

  const results = await Promise.allSettled(
    repos.map((repo) => extractSingle(repo, config))
  );

  const files = [];
  const metadata = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      files.push(...result.value.files);
      metadata.push(result.value.metadata);
    } else {
      console.warn(
        `[mr-context] Failed to extract ${repos[i].url}@${repos[i].branch}: ${result.reason}`
      );
    }
  }

  return { files, metadata };
}

async function extractSingle(repo: ResolvedRepo, config: MrcConfig) {
  const [files, meta] = await Promise.all([
    extractWithRepomix({
      url: repo.url,
      branch: repo.branch,
      githubToken: config.githubToken,
      includePatterns: config.includePatterns ?? [],
      excludePatterns: config.excludePatterns ?? [],
      maxFileSizeBytes: config.maxFileSizeBytes ?? 100_000,
    }),
    fetchRepositoryMetadata(repo.url, config, repo.branch),
  ]);

  const filtered = files.filter((f) => f.size <= (config.maxFileSizeBytes ?? 100_000));
  return { files: filtered, metadata: meta };
}

export { extractWithRepomix } from "./repomix.js";
export { fetchRepositoryMetadata } from "./github.js";

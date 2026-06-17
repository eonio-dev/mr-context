// src/extraction/github.ts
import { Octokit } from '@octokit/rest';
import { Config } from '../shared/config';
import type { Repository } from '../shared/types';

const octokit = new Octokit({ auth: Config.github.token });

export interface RepositoryMetadata {
  description: string;
  defaultBranch: string;
  language: string;
  topics: string[];
  dependencies: Record<string, string>;
  readme: string;
  lastCommitDate: Date;
  openIssuesCount: number;
}

export async function fetchRepositoryMetadata(repo: Repository): Promise<RepositoryMetadata> {
  const [repoData, readmeData, packageJson] = await Promise.allSettled([
    octokit.repos.get({ owner: repo.owner, repo: repo.name }),
    octokit.repos.getReadme({ owner: repo.owner, repo: repo.name }),
    fetchPackageJson(repo),
  ]);

  const repoInfo = repoData.status === 'fulfilled' ? repoData.value.data : null;

  let readme = '';
  if (readmeData.status === 'fulfilled') {
    readme = Buffer.from(readmeData.value.data.content, 'base64').toString('utf-8').slice(0, 3000);
  }

  return {
    description: repoInfo?.description ?? '',
    defaultBranch: repoInfo?.default_branch ?? 'main',
    language: repoInfo?.language ?? 'unknown',
    topics: repoInfo?.topics ?? [],
    dependencies: packageJson.status === 'fulfilled' ? packageJson.value : {},
    readme,
    lastCommitDate: new Date(repoInfo?.pushed_at ?? Date.now()),
    openIssuesCount: repoInfo?.open_issues_count ?? 0,
  };
}

async function fetchPackageJson(repo: Repository): Promise<Record<string, string>> {
  try {
    const response = await octokit.repos.getContent({ owner: repo.owner, repo: repo.name, path: 'package.json' });
    if ('content' in response.data) {
      const parsed = JSON.parse(Buffer.from(response.data.content, 'base64').toString('utf-8'));
      return { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    }
  } catch { /* not a Node project */ }
  return {};
}

export function parseRepositoryUrl(url: string): Pick<Repository, 'owner' | 'name' | 'branch'> {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/tree\/(.+))?$/);
  if (!match) throw new Error(`Cannot parse GitHub URL: ${url}`);
  return { owner: match[1], name: match[2], branch: match[3] ?? 'main' };
}

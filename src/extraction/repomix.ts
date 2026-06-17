// src/extraction/repomix.ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../shared/config';
import type { Repository, ExtractionResult, ExtractedFile } from '../shared/types';

const execFileAsync = promisify(execFile);

export async function extractRepository(repo: Repository): Promise<ExtractionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'mrca-'));
  const outputFile = join(tempDir, 'repomix-output.txt');

  try {
    await execFileAsync(
      'npx',
      [
        'repomix',
        '--remote', repo.url,
        '--output', outputFile,
        '--output-show-line-numbers',
        '--ignore', 'node_modules,dist,build,.git,*.lock,*.log',
        '--token-count-encoding', 'cl100k_base',
      ],
      {
        timeout: Config.repomix.timeout,
        env: { ...process.env, GITHUB_TOKEN: Config.github.token },
      }
    );

    const rawOutput = await readFile(outputFile, 'utf-8');
    const files = parseRepomixOutput(rawOutput);
    const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);

    return { repository: repo, files, rawOutput, extractedAt: new Date(), totalTokens };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function parseRepomixOutput(raw: string): ExtractedFile[] {
  const fileBlocks = raw.split(/={3,}\nFile: (.+?)\n={3,}/);
  const files: ExtractedFile[] = [];

  for (let i = 1; i < fileBlocks.length; i += 2) {
    const path = fileBlocks[i].trim();
    const content = fileBlocks[i + 1]?.trim() ?? '';
    const language = detectLanguage(path);
    const tokens = Math.ceil(content.length / 4);
    files.push({ path, content, language, tokens });
  }

  return files;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    css: 'css', scss: 'scss', html: 'html', sh: 'bash',
  };
  return map[ext] ?? 'plaintext';
}

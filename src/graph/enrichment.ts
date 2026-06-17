// src/graph/enrichment.ts
// Semantic enrichment pass — provider injected by caller (VS Code LM API or test stub)
// This module has NO vscode import — it is usable in both CLI and extension contexts

import type { SemanticNode } from "../shared/types.js";

export type EnrichmentProvider = (prompt: string) => Promise<string>;

const BATCH_SIZE = 5;

function summarizePrompt(node: SemanticNode): string {
  return `Summarize this source file in 2-3 sentences. Focus on its responsibility, key exports, and any notable design patterns. File: ${node.filePath} | Language: ${node.language} | Exports: ${node.exports.join(", ") || "none"} | Patterns: ${node.patterns.join(", ") || "none"}\n\nRespond with only the summary — no preamble, no bullet points.`;
}

/**
 * Enrich a batch of nodes with semantic summaries.
 * Nodes with no exports and no patterns receive a minimal summary without an LLM call.
 */
export async function enrichNodes(
  nodes: SemanticNode[],
  provider: EnrichmentProvider,
  onProgress?: (completed: number, total: number) => void
): Promise<SemanticNode[]> {
  const enriched: SemanticNode[] = [];
  let completed = 0;

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (node) => {
        if (node.exports.length === 0 && node.patterns.length === 0) {
          return { ...node, summary: `${node.language} file at ${node.filePath}` };
        }
        const summary = await provider(summarizePrompt(node));
        return { ...node, summary: summary.trim() };
      })
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      enriched.push(r.status === "fulfilled" ? r.value : batch[j]);
      completed++;
      onProgress?.(completed, nodes.length);
    }
  }

  return enriched;
}

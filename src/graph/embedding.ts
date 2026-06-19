// src/graph/embedding.ts
// Semantic embeddings for hybrid retrieval. Provider is injected by the caller
// (the VS Code extension wraps vscode.lm's embedding models). This module has
// NO vscode import, so it is usable from CLI, tests, and the extension alike.

import type { SemanticNode } from "../shared/types.js";

// Embeds a batch of texts into vectors. One call per batch; same-length output.
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;

const BATCH_SIZE = 16;

// The text we embed for a node — mirrors the BM25 document plus the summary,
// so lexical and semantic signals describe the same surface.
export function nodeEmbeddingText(node: SemanticNode): string {
  return [node.filePath, node.summary, node.exports.join(" "), node.patterns.join(" ")]
    .filter(Boolean)
    .join(" ");
}

// Cosine similarity of two equal-length vectors. Returns 0 for empty/mismatched
// inputs so callers can treat "no embedding" as a neutral score.
export function cosineSim(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Embed nodes that don't yet have an embedding, in batches. Returns new node
// objects with `embedding` set; nodes that fail a batch are left unchanged.
export async function embedNodes(
  nodes: SemanticNode[],
  provider: EmbeddingProvider,
  onProgress?: (completed: number, total: number) => void
): Promise<SemanticNode[]> {
  const pending = nodes.filter((n) => !n.embedding || n.embedding.length === 0);
  const byId = new Map<string, number[]>();
  let completed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    try {
      const vectors = await provider(batch.map(nodeEmbeddingText));
      batch.forEach((node, j) => {
        if (vectors[j]) byId.set(node.id, vectors[j]);
      });
    } catch {
      // Whole batch failed (model unavailable, cancelled) — leave these nodes
      // without an embedding; they degrade to BM25-only at query time.
    }
    completed += batch.length;
    onProgress?.(completed, pending.length);
  }

  return nodes.map((n) => (byId.has(n.id) ? { ...n, embedding: byId.get(n.id) } : n));
}

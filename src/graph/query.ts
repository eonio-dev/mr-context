// src/graph/query.ts
import type { SemanticNode, SemanticGraph } from "../shared/types.js";
import { BM25 } from "./bm25.js";
import { cosineSim } from "./embedding.js";

export type LLMScorer = (query: string, nodeDescription: string) => Promise<number>;

// Blend weights for hybrid retrieval (normalized BM25 + cosine similarity).
const W_BM25 = 0.5;
const W_EMBED = 0.5;

function nodeDocument(node: SemanticNode): { id: string; text: string } {
  return {
    id: node.id,
    text: [node.filePath, node.summary, node.exports.join(" "), node.patterns.join(" ")]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Query the semantic graph for nodes relevant to the query string.
 * Phase 1: BM25 candidate retrieval (no LLM, free).
 * Phase 2: Hybrid rerank — blend normalized BM25 with embedding cosine
 *          similarity when a query embedding is supplied (BM25-only otherwise).
 * Phase 3: Optional LLM rescoring of top candidates.
 * Phase 4: Graph expansion — one hop of neighbors for top-5 results.
 *
 * `queryEmbedding` comes from the VS Code extension (vscode.lm); CLI/MCP callers
 * omit it and transparently get pure BM25.
 */
export async function queryGraph(
  graph: SemanticGraph,
  query: string,
  topK: number,
  scorer?: LLMScorer,
  queryEmbedding?: number[]
): Promise<SemanticNode[]> {
  if (graph.nodes.length === 0) return [];

  const bm25 = new BM25(graph.nodes.map(nodeDocument));
  const bm25Results = bm25.search(query, topK * 3);

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const scoredByBm = bm25Results
    .map((r) => ({ node: nodeById.get(r.id), bm: r.score }))
    .filter((x): x is { node: SemanticNode; bm: number } => x.node !== undefined);

  let candidates: SemanticNode[];
  if (queryEmbedding && queryEmbedding.length > 0 && scoredByBm.length > 0) {
    // Normalize BM25 to [0,1] so it blends fairly with cosine. Nodes lacking an
    // embedding keep their BM25 signal only (cosine 0 would unfairly sink them).
    const maxBm = Math.max(...scoredByBm.map((x) => x.bm), 1e-9);
    candidates = scoredByBm
      .map((x) => {
        const hasEmb = !!x.node.embedding && x.node.embedding.length > 0;
        const score = hasEmb
          ? W_BM25 * (x.bm / maxBm) + W_EMBED * cosineSim(queryEmbedding, x.node.embedding)
          : x.bm / maxBm;
        return { node: x.node, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.node);
  } else {
    candidates = scoredByBm.map((x) => x.node);
  }

  if (scorer && candidates.length > 0) {
    const scored = await Promise.allSettled(
      candidates.slice(0, topK).map(async (node) => {
        const desc = `File: ${node.filePath}\nSummary: ${node.summary}\nExports: ${node.exports.join(", ")}`;
        const score = await scorer(query, desc);
        return { node, score };
      })
    );
    candidates = scored
      .filter(
        (r): r is PromiseFulfilledResult<{ node: SemanticNode; score: number }> =>
          r.status === "fulfilled"
      )
      .sort((a, b) => b.value.score - a.value.score)
      .map((r) => r.value.node);
  }

  // Build the result in ranked order (rerank order is significant: formatContextBlock
  // cuts by token budget top-down, so the best candidates must come first).
  const ordered: SemanticNode[] = [];
  const seen = new Set<string>();
  for (const node of candidates) {
    if (ordered.length >= topK) break;
    if (!seen.has(node.id)) {
      ordered.push(node);
      seen.add(node.id);
    }
  }

  // Graph expansion: append up-to-3 neighbors of the top-5 candidates if room.
  const edgeIndex = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const arr = edgeIndex.get(edge.source) ?? [];
    arr.push(edge.target);
    edgeIndex.set(edge.source, arr);
  }
  for (const node of candidates.slice(0, 5)) {
    for (const neighborId of (edgeIndex.get(node.id) ?? []).slice(0, 3)) {
      if (ordered.length >= topK) break;
      if (!seen.has(neighborId)) {
        const neighbor = nodeById.get(neighborId);
        if (neighbor) {
          ordered.push(neighbor);
          seen.add(neighborId);
        }
      }
    }
  }

  return ordered.slice(0, topK);
}

/**
 * Format nodes into a compact context block for LLM prompt injection.
 * Respects a token budget (estimate: 1 token ≈ 4 chars).
 */
export function formatContextBlock(nodes: SemanticNode[], tokenBudget = 4000): string {
  if (nodes.length === 0) return "(No relevant context found.)";

  const sections: string[] = [];
  let tokens = 0;

  for (const node of nodes) {
    const repo = node.repository.split("/").slice(-1)[0];
    const lines = [`### ${node.filePath} [${repo}]`];
    if (node.summary) lines.push(node.summary);
    if (node.exports.length > 0) lines.push(`Exports: ${node.exports.join(", ")}`);
    if (node.patterns.length > 0) lines.push(`Patterns: ${node.patterns.join(", ")}`);
    const section = lines.join("\n");
    const sectionTokens = Math.ceil(section.length / 4);
    if (tokens + sectionTokens > tokenBudget) break;
    sections.push(section);
    tokens += sectionTokens;
  }

  return sections.join("\n\n");
}

/**
 * Build an LLM scorer backed by an arbitrary async text function.
 * In the VS Code extension this wraps vscode.lm.sendRequest().
 */
export function buildScorer(
  sendFn: (prompt: string) => Promise<string>
): LLMScorer {
  return async (query, nodeDescription): Promise<number> => {
    const prompt = `Rate relevance of this code file to the question on a scale of 0–10. Reply with a single integer.\n\nQuestion: ${query}\n\nFile:\n${nodeDescription}`;
    try {
      const raw = await sendFn(prompt);
      const score = parseInt(raw.trim(), 10);
      return isNaN(score) ? 5 : Math.max(0, Math.min(10, score));
    } catch {
      return 5;
    }
  };
}

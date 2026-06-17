// src/shared/telemetry.ts
// Token-savings telemetry shared by every surface (CLI, VS Code, MCP).
// Each retrieval records how many tokens the returned context block cost
// versus the baseline of reading the matched files directly. Aggregates are
// persisted next to the graph in .mrc/data/stats.json. Recording is best
// effort: it never throws into the retrieval path and can be disabled.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { GRAPH_PATH } from "./config.js";
import type { MrcConfig, SemanticNode } from "./types.js";

// Rough token estimate: ~4 characters per token.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Assumed token cost of a file whose real size is unknown (un-rebuilt graph).
const FALLBACK_FILE_TOKENS = 1500;

const MAX_RECENT = 50;

export interface RetrievalRecord {
  at: string;
  query: string;
  nodes: number;
  baselineTokens: number;
  contextTokens: number;
  savedTokens: number;
}

export interface TelemetryStats {
  totalQueries: number;
  totalBaselineTokens: number;
  totalContextTokens: number;
  totalSavedTokens: number;
  firstRecordedAt: string | null;
  lastUpdatedAt: string | null;
  recent: RetrievalRecord[];
}

function emptyStats(): TelemetryStats {
  return {
    totalQueries: 0,
    totalBaselineTokens: 0,
    totalContextTokens: 0,
    totalSavedTokens: 0,
    firstRecordedAt: null,
    lastUpdatedAt: null,
    recent: [],
  };
}

export function statsPathFor(config: MrcConfig): string {
  if (process.env.MRC_STATS) return process.env.MRC_STATS;
  const graphPath = config.graphCachePath ?? GRAPH_PATH;
  return join(dirname(graphPath), "stats.json");
}

function telemetryDisabled(config: MrcConfig): boolean {
  return process.env.MRC_NO_TELEMETRY === "1" || config.telemetry === false;
}

export function loadStats(path: string): TelemetryStats {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<TelemetryStats>;
    return { ...emptyStats(), ...parsed };
  } catch {
    return emptyStats();
  }
}

// Baseline = tokens it would take to read each matched file in full.
function baselineTokens(nodes: SemanticNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + (typeof n.size === "number" ? Math.ceil(n.size / 4) : FALLBACK_FILE_TOKENS),
    0
  );
}

// Record one retrieval and return the per-call record (or null if disabled or
// on failure). Aggregates are updated and persisted atomically-enough for a
// single local writer.
export function recordRetrieval(
  config: MrcConfig,
  query: string,
  nodes: SemanticNode[],
  contextBlock: string
): RetrievalRecord | null {
  if (telemetryDisabled(config)) return null;
  try {
    const path = statsPathFor(config);
    const stats = loadStats(path);

    const baseline = baselineTokens(nodes);
    const context = estimateTokens(contextBlock);
    const saved = Math.max(0, baseline - context);
    const now = new Date().toISOString();

    const record: RetrievalRecord = {
      at: now,
      query: query.length > 120 ? query.slice(0, 120) + "…" : query,
      nodes: nodes.length,
      baselineTokens: baseline,
      contextTokens: context,
      savedTokens: saved,
    };

    stats.totalQueries += 1;
    stats.totalBaselineTokens += baseline;
    stats.totalContextTokens += context;
    stats.totalSavedTokens += saved;
    stats.firstRecordedAt ??= now;
    stats.lastUpdatedAt = now;
    stats.recent = [record, ...stats.recent].slice(0, MAX_RECENT);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(stats, null, 2), "utf-8");
    return record;
  } catch {
    return null;
  }
}

function pct(stats: TelemetryStats): number {
  if (stats.totalBaselineTokens === 0) return 0;
  return Math.round((stats.totalSavedTokens / stats.totalBaselineTokens) * 100);
}

function group(n: number): string {
  return n.toLocaleString("en-US");
}

// Compact human-readable summary for CLI / status surfaces.
export function formatStats(stats: TelemetryStats): string {
  if (stats.totalQueries === 0) return "No retrievals recorded yet.";
  const lines = [
    `Queries:          ${stats.totalQueries}`,
    `Baseline tokens:  ${group(stats.totalBaselineTokens)}  (reading matched files in full)`,
    `Context tokens:   ${group(stats.totalContextTokens)}  (what Mr. Context returned)`,
    `Tokens saved:     ${group(stats.totalSavedTokens)}  (~${pct(stats)}%)`,
  ];
  if (stats.lastUpdatedAt) lines.push(`Last updated:     ${stats.lastUpdatedAt}`);
  return lines.join("\n");
}

export function savedTokens(stats: TelemetryStats): number {
  return stats.totalSavedTokens;
}

export function savedPercent(stats: TelemetryStats): number {
  return pct(stats);
}

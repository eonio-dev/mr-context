// src/shared/types.ts
// Core data contracts for mr-context

export interface ExtractedFile {
  path: string;
  content: string;
  language: string;
  repository: string;
  branch: string;
  size: number;
}

export interface RepositoryMetadata {
  url: string;
  owner: string;
  name: string;
  branch: string;
  description: string | null;
  topics: string[];
  language: string | null;
  starCount: number;
  fileCount: number;
  extractedAt: string;
}

export interface SemanticNode {
  id: string;
  filePath: string;
  repository: string;
  language: string;
  exports: string[];
  imports: string[];
  patterns: string[];
  summary: string;
  embedding?: number[];
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "imports" | "exports-to" | "shares-type" | "pattern-sibling";
  weight: number;
}

export interface SemanticGraph {
  nodes: SemanticNode[];
  edges: GraphEdge[];
  repositories: RepositoryMetadata[];
  builtAt: string;
  version: string;
}

export interface ExtractionResult {
  files: ExtractedFile[];
  metadata: RepositoryMetadata[];
}

export interface MrcConfig {
  repositories: string[];
  githubToken?: string;
  branch?: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFileSizeBytes?: number;
  graphCachePath?: string;
  maxContextNodes?: number;
  embeddingModel?: string;
}

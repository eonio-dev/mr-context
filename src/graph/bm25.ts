// src/graph/bm25.ts
// BM25 (Best Matching 25) ranking for candidate node retrieval

export interface BM25Document {
  id: string;
  text: string;
}

export interface BM25Result {
  id: string;
  score: number;
}

export class BM25 {
  private k1 = 1.5;
  private b = 0.75;
  private documents: BM25Document[];
  private avgDocLength: number;
  private idf: Map<string, number>;
  private termFreqs: Map<string, Map<string, number>>;

  constructor(documents: BM25Document[]) {
    this.documents = documents;
    this.idf = new Map();
    this.termFreqs = new Map();

    const N = documents.length;
    const docFreq = new Map<string, number>();
    let totalLength = 0;

    for (const doc of documents) {
      const terms = tokenize(doc.text);
      totalLength += terms.length;
      const tf = new Map<string, number>();
      const seen = new Set<string>();

      for (const term of terms) {
        tf.set(term, (tf.get(term) ?? 0) + 1);
        if (!seen.has(term)) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
          seen.add(term);
        }
      }
      this.termFreqs.set(doc.id, tf);
    }

    this.avgDocLength = N > 0 ? totalLength / N : 0;

    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }
  }

  search(query: string, topK = 25): BM25Result[] {
    const queryTerms = tokenize(query);
    const scores = new Map<string, number>();

    for (const doc of this.documents) {
      const tf = this.termFreqs.get(doc.id) ?? new Map<string, number>();
      const docLen = [...tf.values()].reduce((a, b) => a + b, 0);
      let score = 0;

      for (const term of queryTerms) {
        const idf = this.idf.get(term) ?? 0;
        const freq = tf.get(term) ?? 0;
        const numerator = freq * (this.k1 + 1);
        const denominator =
          freq + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
        score += idf * (numerator / denominator);
      }

      if (score > 0) scores.set(doc.id, score);
    }

    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

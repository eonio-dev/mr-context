// scripts/eval-query.ts
// Run: npx tsx scripts/eval-query.ts
// Evaluates query quality against the built graph (no LLM required — BM25 only).
import { loadOrBuildGraph } from "../src/graph/index.js";
import { queryGraph } from "../src/graph/query.js";
import { loadConfig } from "../src/shared/config.js";

const TEST_QUERIES = [
  "How is authentication implemented?",
  "Where are the shared type definitions?",
  "What design patterns are used for payment processing?",
  "Which components handle form submission?",
  "How does error handling work across services?",
  "What are the entry points for the API?",
  "Where is configuration loaded?",
  "Which files implement the repository pattern?",
];

async function main() {
  const config = loadConfig();
  const graph = await loadOrBuildGraph(config);

  console.log(
    `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
      `${graph.repositories.length} repositories\n`
  );

  for (const query of TEST_QUERIES) {
    console.log(`Query: "${query}"`);
    const nodes = await queryGraph(graph, query, 5);
    if (nodes.length === 0) {
      console.log("  (no results)\n");
      continue;
    }
    nodes.forEach((n) => {
      const repo = n.repository.split("/").slice(-1)[0];
      const exp = n.exports.slice(0, 3).join(", ");
      console.log(
        `  [${repo}] ${n.filePath}` + (exp ? `  exports=[${exp}]` : "")
      );
    });
    console.log();
  }
}

main().catch(console.error);

// src/cli/commands/build.ts
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, CONFIG_PATH, GRAPH_PATH, CONTENT_CACHE_PATH } from "../../shared/config.js";
import { extractRepositories } from "../../extraction/index.js";
import { buildSyntacticGraph } from "../../graph/builder.js";
import { saveGraph, loadGraph, saveContentCache } from "../../graph/index.js";
import { enrichNodes, type EnrichmentProvider } from "../../graph/enrichment.js";
import type { ContentCache, MrcConfig } from "../../shared/types.js";

async function buildCliProvider(key: string, config: MrcConfig): Promise<EnrichmentProvider | null> {
  const isAnthropic = (config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY) === key;
  if (isAnthropic) {
    return async (prompt: string) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) return "";
      const data = await res.json() as { content: Array<{ type: string; text: string }> };
      return data.content?.[0]?.text ?? "";
    };
  }
  // OpenAI fallback
  return async (prompt: string) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  };
}

export function buildCommand(): Command {
  return new Command("build")
    .description("Build or refresh the semantic graph for all configured repositories")
    .option("-f, --force", "Force rebuild, ignoring cache", false)
    .option("-c, --config <path>", `Path to ${CONFIG_PATH} file`)
    .option("-v, --verbose", "Show detailed output", false)
    .action(async (opts) => {
      const config = loadConfig(opts.config);

      if (config.repositories.length === 0) {
        console.error(
          chalk.red("No repositories configured.") +
          ` Create a ${CONFIG_PATH} file or set MRC_REPOS.`
        );
        process.exit(1);
      }

      const cachePath = config.graphCachePath ?? GRAPH_PATH;

      if (!opts.force) {
        const cached = loadGraph(cachePath);
        if (cached) {
          const age = Math.round((Date.now() - new Date(cached.builtAt).getTime()) / 60000);
          console.log(chalk.yellow(`Existing graph found`) + chalk.gray(` (${age}m ago). Use --force to rebuild.`));
          console.log(chalk.gray(`  ${cached.nodes.length} nodes, ${cached.edges.length} edges`));
          return;
        }
      }

      console.log(chalk.bold.cyan("\n  Mr. Context") + chalk.gray(` — indexing ${config.repositories.length} repo(s)\n`));

      const spinner = ora("Extracting repositories…").start();
      const t0 = Date.now();

      try {
        const { files, metadata } = await extractRepositories(config);
        spinner.succeed(chalk.green(`${files.length} files extracted`) + chalk.gray(` (${metadata.length} repos)`));

        if (opts.verbose) {
          metadata.forEach((m) => console.log(chalk.gray(`  ${m.owner}/${m.name}: ${m.language ?? "mixed"}`)));
        }

        spinner.text = "Building semantic graph…";
        spinner.start();
        const graph = buildSyntacticGraph(files, metadata);

        // Build content cache (nodeId → source) for enrichment and read_file tool
        const contentCachePath = CONTENT_CACHE_PATH;
        const contentCache: ContentCache = {};
        for (const node of graph.nodes) {
          const file = files.find((f) => f.path === node.filePath && f.repository === node.repository);
          if (file) contentCache[node.id] = file.content;
        }
        saveContentCache(contentCache, contentCachePath);

        // Run enrichment at build time if an LLM key is available
        const llmKey = config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY
          ?? config.openaiApiKey ?? process.env.OPENAI_API_KEY;

        if (llmKey) {
          spinner.text = "Enriching nodes with LLM summaries…";
          const provider = await buildCliProvider(llmKey, config);
          if (provider) {
            let done = 0;
            graph.nodes = await enrichNodes(
              graph.nodes,
              provider,
              (completed, total) => {
                done = completed;
                spinner.text = `Enriching nodes… ${completed}/${total}`;
              },
              contentCache
            );
            spinner.succeed(chalk.green(`${done} nodes enriched`));
            spinner.start();
          }
        }

        saveGraph(graph, cachePath);

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        spinner.succeed(chalk.green(`Graph built in ${elapsed}s`) + chalk.gray(` — ${graph.nodes.length} nodes, ${graph.edges.length} edges`));

        console.log(chalk.bold.cyan("\n  Mr. Context at your service."));
        console.log(chalk.gray(`  ${graph.repositories.length} repositories indexed · ${graph.nodes.length} nodes · ready.\n`));
        if (!llmKey) {
          console.log(chalk.yellow("  Tip: set ANTHROPIC_API_KEY or OPENAI_API_KEY to enrich summaries at build time.\n"));
        }

      } catch (err) {
        spinner.fail(chalk.red("Build failed: " + (err as Error).message));
        if (opts.verbose) console.error(err);
        process.exit(1);
      }
    });
}

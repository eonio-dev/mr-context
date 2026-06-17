// src/cli/commands/stats.ts
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, CONFIG_PATH } from "../../shared/config.js";
import { statsPathFor, loadStats, formatStats } from "../../shared/telemetry.js";

export function statsCommand(): Command {
  return new Command("stats")
    .description("Show cumulative token-savings telemetry")
    .option("-c, --config <path>", `Path to ${CONFIG_PATH} file`)
    .action((opts) => {
      const config = loadConfig(opts.config);
      const stats = loadStats(statsPathFor(config));

      console.log(chalk.bold("\nMr. Context — Token Savings\n"));
      if (stats.totalQueries === 0) {
        console.log(chalk.yellow("  No retrievals recorded yet.\n"));
        return;
      }
      formatStats(stats)
        .split("\n")
        .forEach((line) => console.log(chalk.gray("  " + line)));
      console.log();
    });
}

// src/vscode/telemetryStatus.ts
// A status-bar indicator of tokens saved by Mr. Context this session, plus a
// command that opens the cumulative totals persisted in .mrc/data/stats.json.

import * as vscode from "vscode";
import { getAgent } from "../agent/registry.js";
import { statsPathFor, loadStats, formatStats } from "../shared/telemetry.js";
import type { RetrievalRecord } from "../shared/telemetry.js";

let statusItem: vscode.StatusBarItem | undefined;
let sessionSaved = 0;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function registerTelemetryStatus(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "mr-context.showSavings";
  statusItem.tooltip = "Mr. Context — tokens saved this session (click for totals)";
  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("mr-context.showSavings", showSavings)
  );
}

export function onRetrievalRecorded(record: RetrievalRecord): void {
  sessionSaved += record.savedTokens;
  if (!statusItem) return;
  statusItem.text = `$(rocket) mrc saved ~${compact(sessionSaved)} tok`;
  statusItem.show();
}

async function showSavings(): Promise<void> {
  const cts = new vscode.CancellationTokenSource();
  try {
    const agent = await getAgent(cts.token);
    const stats = loadStats(statsPathFor(agent.getConfig()));
    const doc = await vscode.workspace.openTextDocument({
      content: `Mr. Context — Token Savings\n${"=".repeat(28)}\n\n${formatStats(stats)}\n`,
      language: "text",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err) {
    vscode.window.showWarningMessage(`Mr. Context: ${(err as Error).message}`);
  } finally {
    cts.dispose();
  }
}

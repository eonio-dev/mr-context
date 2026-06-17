// src/agent/registry.ts
// Singleton factory for MrcAgent — used by the VS Code extension
// to share one agent instance across commands and chat participants.
//
// This file has a vscode import for the CancellationToken type only —
// the actual vscode.lm calls live in agent.ts.

import type * as vscode from "vscode";
import { MrcAgent } from "./agent.js";
import { loadConfig } from "../shared/config.js";

let instance: MrcAgent | null = null;
let pending: Promise<MrcAgent> | null = null;

export async function getAgent(token: vscode.CancellationToken): Promise<MrcAgent> {
  if (instance) return instance;
  if (!pending) {
    pending = (async () => {
      const config = loadConfig();
      const agent = new MrcAgent(config);
      await agent.initialize(token);
      instance = agent;
      return agent;
    })();
  }
  return pending;
}

export function resetAgent(): void {
  instance = null;
  pending = null;
}

// src/agent/skills.ts
import { buildContextualPrompt } from "./prompts.js";
import { formatContextBlock } from "../graph/query.js";
import type { SemanticNode } from "../shared/types.js";

export type SkillName = "query" | "feature" | "review" | "onboard" | "patterns";

const HEURISTICS: Array<{ skill: SkillName; pattern: RegExp }> = [
  { skill: "feature",  pattern: /\b(add|implement|create|build|scaffold|new feature)\b/i },
  { skill: "review",   pattern: /\b(review|check|feedback|diff|pull request|pr\b)/i },
  { skill: "onboard",  pattern: /\b(onboard|overview|architecture|getting started|explain the codebase)\b/i },
  { skill: "patterns", pattern: /\b(pattern|patterns|design pattern|anti-pattern|conventions?)\b/i },
];

export function detectSkill(message: string, command?: string): SkillName {
  if (command && isSkillName(command)) return command;
  for (const { skill, pattern } of HEURISTICS) {
    if (pattern.test(message)) return skill;
  }
  return "query";
}

function isSkillName(s: string): s is SkillName {
  return ["query", "feature", "review", "onboard", "patterns"].includes(s);
}

export function buildSkillPrompt(skill: SkillName, contextNodes: SemanticNode[]): string {
  return buildContextualPrompt(skill, formatContextBlock(contextNodes));
}

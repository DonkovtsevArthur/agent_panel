import * as vscode from "vscode";
import type { ChatTool } from "./openaiClient";
import { agentTools, READONLY_TOOL_NAMES } from "./tools";
import { resolveUiLanguage } from "./i18n";

export type ModeToolsPolicy = "agent" | "readonly";

export interface AgentModeDef {
  id: string;
  label: string;
  description?: string;
  /** agent — все tools; readonly — только list_files / read_file */
  tools: ModeToolsPolicy;
  /** Доп. system prompt поверх глобального */
  prompt?: string;
  enabled?: boolean;
  builtin?: boolean;
  placeholder?: string;
}

const PLAN_MODE_SYSTEM_PROMPT = `Plan mode is active.
Your task is to inspect the context and produce a clear implementation plan.
Read-only tools are allowed: list_files, read_file, fetch_url, open_external (plus any MCP tools provided).
You CAN read http(s) links via fetch_url — never say you cannot open external URLs.
If the user asks anything about a linked page, call fetch_url and answer from the structured page fields.
Do not modify files, run shell commands, or implement code in the repository.
Reply with a structured plan in English: goal, ordered steps, affected files, risks, and open questions.
Do not start implementation. If you need more data, read the relevant files/URLs first and then write the plan.`;

const ASK_MODE_SYSTEM_PROMPT = `Ask mode is active.
Answer the user's questions: explain code, investigate causes, give advice and examples.
Read-only tools are allowed: list_files, read_file, fetch_url, open_external (plus any MCP tools provided).
You CAN read http(s) links via fetch_url — never say you cannot open external URLs.
If the user asks anything about a linked page, call fetch_url immediately and answer from title/description/headings/content/colors/links/jsonLd.
Do not invent authorization walls. Do not modify files, run shell commands, implement features, or edit the repository.
Do not turn the answer into a large implementation plan or jump straight to "I can make the change" — answer the question directly.
If you need more data, read the relevant files/URLs and ground your answer in facts.`;

export const BUILTIN_MODE_IDS = new Set(["agent", "plan", "ask"]);

export const BUILTIN_MODES: AgentModeDef[] = [
  {
    id: "agent",
    label: "Agent",
    description: "Reads and edits code",
    tools: "agent",
    builtin: true,
    placeholder: "Task for the agent... (@ for file)",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Plan only, no edits",
    tools: "readonly",
    prompt: PLAN_MODE_SYSTEM_PROMPT,
    builtin: true,
    placeholder:
      "Describe the task — the agent will draft a plan without edits... (@ for file)",
  },
  {
    id: "ask",
    label: "Ask",
    description: "Answers and explanations",
    tools: "readonly",
    prompt: ASK_MODE_SYSTEM_PROMPT,
    builtin: true,
    placeholder: "Ask about code or a task... (@ for file)",
  },
];

export function slugifyModeId(label: string): string {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const ascii = base
    .replace(/[а-яё]/gi, (ch) => {
      const map: Record<string, string> = {
        а: "a",
        б: "b",
        в: "v",
        г: "g",
        д: "d",
        е: "e",
        ё: "e",
        ж: "zh",
        з: "z",
        и: "i",
        й: "y",
        к: "k",
        л: "l",
        м: "m",
        н: "n",
        о: "o",
        п: "p",
        р: "r",
        с: "s",
        т: "t",
        у: "u",
        ф: "f",
        х: "h",
        ц: "ts",
        ч: "ch",
        ш: "sh",
        щ: "sch",
        ъ: "",
        ы: "y",
        ь: "",
        э: "e",
        ю: "yu",
        я: "ya",
      };
      return map[ch.toLowerCase()] ?? "";
    })
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `mode-${Date.now().toString(36)}`;
}

export function normalizeToolsPolicy(value: unknown): ModeToolsPolicy {
  return value === "readonly" ? "readonly" : "agent";
}

function currentUiLanguage(): "en" | "ru" {
  const setting = vscode.workspace
    .getConfiguration("agentPanel")
    .get<"auto" | "en" | "ru">("language");
  return resolveUiLanguage(
    setting === "en" || setting === "ru" ? setting : "auto"
  );
}

export function parseCustomModes(raw: unknown): AgentModeDef[] {
  const list = Array.isArray(raw) ? raw : [];
  const modes: AgentModeDef[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      label?: unknown;
      description?: unknown;
      tools?: unknown;
      prompt?: unknown;
      enabled?: unknown;
      placeholder?: unknown;
    };
    let id = typeof row.id === "string" ? row.id.trim() : "";
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : "";
    if (!label) {
      continue;
    }
    if (!id) {
      id = slugifyModeId(label);
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const mode: AgentModeDef = {
      id,
      label,
      tools: normalizeToolsPolicy(row.tools),
    };
    if (typeof row.description === "string" && row.description.trim()) {
      mode.description = row.description.trim();
    }
    if (typeof row.prompt === "string" && row.prompt.trim()) {
      mode.prompt = row.prompt.trim();
    }
    if (typeof row.placeholder === "string" && row.placeholder.trim()) {
      mode.placeholder = row.placeholder.trim();
    }
    if (row.enabled === false) {
      mode.enabled = false;
    }
    if (BUILTIN_MODE_IDS.has(id)) {
      mode.builtin = true;
    }
    modes.push(mode);
  }
  return modes;
}

/** Встроенные (с возможными override) + пользовательские. */
export function mergeModes(custom: AgentModeDef[]): AgentModeDef[] {
  const byId = new Map(
    custom.filter((m) => m.id).map((m) => [m.id, m] as const)
  );
  const builtins = BUILTIN_MODES.map((base) => {
    const override = byId.get(base.id);
    if (!override) {
      return { ...base };
    }
    const merged: AgentModeDef = {
      ...base,
      label: override.label || base.label,
      tools: override.tools || base.tools,
      builtin: true,
    };
    if (override.description !== undefined) {
      merged.description = override.description;
    }
    if (override.prompt !== undefined) {
      merged.prompt = override.prompt;
    }
    if (override.placeholder !== undefined) {
      merged.placeholder = override.placeholder;
    }
    if (override.enabled === false) {
      merged.enabled = false;
    }
    return merged;
  }).filter((m) => m.enabled !== false);

  const extras = custom.filter(
    (m) => m.id && !BUILTIN_MODE_IDS.has(m.id) && m.enabled !== false
  );
  return [...builtins, ...extras];
}

export function resolveMode(
  id: unknown,
  custom: AgentModeDef[] = []
): AgentModeDef {
  const modes = mergeModes(custom);
  const wanted = typeof id === "string" ? id.trim() : "";
  return modes.find((m) => m.id === wanted) || BUILTIN_MODES[0];
}

export function isReadonlyPolicy(tools: ModeToolsPolicy): boolean {
  return tools === "readonly";
}

export function toolsForPolicy(
  tools: ModeToolsPolicy,
  extraTools: ChatTool[] = []
): ChatTool[] {
  const base = !isReadonlyPolicy(tools)
    ? agentTools
    : agentTools.filter((tool) =>
        READONLY_TOOL_NAMES.has(tool.function.name)
      );
  if (!extraTools.length) {
    return base;
  }
  return [...base, ...extraTools];
}

export function modeThinkingLabel(mode: AgentModeDef): string {
  const lang = currentUiLanguage();
  if (mode.id === "plan") {
    return lang === "ru" ? "Планирую..." : "Planning...";
  }
  if (mode.id === "ask") {
    return lang === "ru" ? "Изучаю..." : "Reviewing...";
  }
  if (isReadonlyPolicy(mode.tools)) {
    return lang === "ru" ? "Изучаю..." : "Reviewing...";
  }
  return lang === "ru" ? "Думаю..." : "Thinking...";
}

export function modeDoneLabel(mode: AgentModeDef): string {
  const lang = currentUiLanguage();
  if (mode.id === "plan") {
    return lang === "ru" ? "План готов" : "Plan ready";
  }
  if (mode.id === "ask") {
    return lang === "ru" ? "Готово" : "Answered";
  }
  return lang === "ru" ? "Готово" : "Done";
}

export function modeCollectLabel(mode: AgentModeDef): string {
  const lang = currentUiLanguage();
  if (mode.id === "plan") {
    return lang === "ru" ? "Собираю план..." : "Building plan...";
  }
  return lang === "ru" ? "Готовлю ответ..." : "Drafting answer...";
}

export function modeFinalNudge(mode: AgentModeDef): string {
  if (mode.id === "plan") {
    return "Tools are no longer available. Write the final plan based on the information already gathered. Do not call tools and do not jump straight to editing code.";
  }
  if (isReadonlyPolicy(mode.tools)) {
    return "Tools are no longer available. Answer the question briefly using the information already gathered. Do not call tools and do not propose editing code.";
  }
  return "Tools are no longer available. Reply briefly to the user using the information already gathered. Do not call tools.";
}

export function modeTitle(mode: AgentModeDef): string {
  if (mode.description) {
    return `${mode.label}: ${mode.description}`;
  }
  return mode.label;
}

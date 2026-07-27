import type { ChatTool } from "./openaiClient";
import { agentTools, READONLY_TOOL_NAMES } from "./tools";

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

const PLAN_MODE_SYSTEM_PROMPT = `Сейчас включён режим плана (Plan).
Твоя задача — исследовать контекст и предложить чёткий план реализации.
Разрешены только инструменты чтения: list_files, read_file.
Запрещено: менять файлы, выполнять shell-команды, писать или править код в репозитории.
В ответе дай структурированный план на русском: цель, шаги по порядку, какие файлы затронуть, риски и открытые вопросы.
Не приступай к реализации — только план. Если не хватает данных — сначала прочитай нужные файлы, затем сформулируй план.`;

const ASK_MODE_SYSTEM_PROMPT = `Сейчас включён режим «Спросить» (Ask).
Отвечай на вопросы пользователя: объясняй код, ищи причину, давай советы и примеры.
Разрешены только инструменты чтения: list_files, read_file.
Запрещено: менять файлы, выполнять shell-команды, реализовывать фичи и править репозиторий.
Не составляй большой план внедрения и не предлагай сразу «давай внесу правки» — ответь по существу.
Если не хватает данных — прочитай нужные файлы и опирайся на факты из кода.`;

export const BUILTIN_MODE_IDS = new Set(["agent", "plan", "ask"]);

export const BUILTIN_MODES: AgentModeDef[] = [
  {
    id: "agent",
    label: "Агент",
    description: "Читает и правит код",
    tools: "agent",
    builtin: true,
    placeholder: "Задача для агента... (@ — файл)",
  },
  {
    id: "plan",
    label: "План",
    description: "Только план, без правок",
    tools: "readonly",
    prompt: PLAN_MODE_SYSTEM_PROMPT,
    builtin: true,
    placeholder:
      "Опишите задачу — агент составит план без правок… (@ — файл)",
  },
  {
    id: "ask",
    label: "Спросить",
    description: "Ответы и объяснения",
    tools: "readonly",
    prompt: ASK_MODE_SYSTEM_PROMPT,
    builtin: true,
    placeholder: "Спросите про код или задачу… (@ — файл)",
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

export function toolsForPolicy(tools: ModeToolsPolicy): ChatTool[] {
  if (!isReadonlyPolicy(tools)) {
    return agentTools;
  }
  return agentTools.filter((tool) =>
    READONLY_TOOL_NAMES.has(tool.function.name)
  );
}

export function modeThinkingLabel(mode: AgentModeDef): string {
  if (mode.id === "plan") {
    return "Планирует…";
  }
  if (mode.id === "ask") {
    return "Смотрит…";
  }
  if (isReadonlyPolicy(mode.tools)) {
    return "Смотрит…";
  }
  return "Думает…";
}

export function modeDoneLabel(mode: AgentModeDef): string {
  if (mode.id === "plan") {
    return "План готов";
  }
  if (mode.id === "ask") {
    return "Ответил";
  }
  return "Надумал";
}

export function modeCollectLabel(mode: AgentModeDef): string {
  if (mode.id === "plan") {
    return "Собирает план…";
  }
  return "Собирает ответ…";
}

export function modeFinalNudge(mode: AgentModeDef): string {
  if (mode.id === "plan") {
    return "Инструменты больше недоступны. Сформулируй итоговый план по уже полученным данным. Не вызывай инструменты и не предлагай сразу править код.";
  }
  if (isReadonlyPolicy(mode.tools)) {
    return "Инструменты больше недоступны. Кратко ответь на вопрос по уже полученным данным. Не вызывай инструменты и не предлагай править код.";
  }
  return "Инструменты больше недоступны. Кратко ответь пользователю по уже полученным данным. Не вызывай инструменты.";
}

export function modeTitle(mode: AgentModeDef): string {
  if (mode.description) {
    return `${mode.label}: ${mode.description}`;
  }
  return mode.label;
}

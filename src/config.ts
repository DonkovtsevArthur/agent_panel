import * as vscode from "vscode";

export interface AgentModel {
  id: string;
  label?: string;
  /** Размер контекстного окна модели в токенах (max input) */
  contextWindow?: number;
  /** Лимит выходных токенов модели */
  maxOutputTokens?: number;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Известные лимиты контекста по id модели (если не заданы в settings). */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "DeepSeek-V4-Flash": 128_000,
  "Qwen3-Coder-Next": 262_144,
  "Gemma-4-31b": 128_000,
  "claude-sonnet-4-5": 200_000,
  "gpt-4.1": 1_047_576,
  "Gemini 2.5 Flash": 1_048_576,
};

const DEFAULT_MODELS: AgentModel[] = [
  { id: "DeepSeek-V4-Flash", label: "DeepSeek V4 Flash", contextWindow: 128_000 },
  { id: "Qwen3-Coder-Next", label: "Qwen3 Coder Next", contextWindow: 262_144 },
  { id: "Gemma-4-31b", label: "Gemma 4 31B", contextWindow: 128_000 },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", contextWindow: 200_000 },
  { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 1_047_576 },
  { id: "Gemini 2.5 Flash", label: "Gemini 2.5 Flash", contextWindow: 1_048_576 },
];

export interface AgentPanelConfig {
  baseUrl: string;
  apiKey: string;
  models: AgentModel[];
  defaultModel: string;
  defaultContextWindow: number;
  systemPrompt: string;
  maxToolRounds: number;
  maxTokens: number;
  maxResponseChars: number;
  rejectUnauthorized: boolean;
  caBundlePath: string;
}

function readModels(cfg: vscode.WorkspaceConfiguration): AgentModel[] {
  const raw = cfg.get<unknown>("models");
  const list = Array.isArray(raw) ? raw : [];
  const models: AgentModel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      label?: unknown;
      contextWindow?: unknown;
      maxOutputTokens?: unknown;
    };
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) {
      continue;
    }
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : undefined;
    const contextWindow =
      typeof row.contextWindow === "number" &&
      Number.isFinite(row.contextWindow) &&
      row.contextWindow > 0
        ? Math.floor(row.contextWindow)
        : undefined;
    const maxOutputTokens =
      typeof row.maxOutputTokens === "number" &&
      Number.isFinite(row.maxOutputTokens) &&
      row.maxOutputTokens > 0
        ? Math.floor(row.maxOutputTokens)
        : undefined;
    const model: AgentModel = { id };
    if (label) {
      model.label = label;
    }
    if (contextWindow) {
      model.contextWindow = contextWindow;
    }
    if (maxOutputTokens) {
      model.maxOutputTokens = maxOutputTokens;
    }
    models.push(model);
  }

  return models.length > 0 ? models : DEFAULT_MODELS;
}

export function getConfig(): AgentPanelConfig {
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const models = readModels(cfg);
  const defaultContextWindowRaw = cfg.get<number>("defaultContextWindow");
  const defaultContextWindow =
    typeof defaultContextWindowRaw === "number" &&
    Number.isFinite(defaultContextWindowRaw) &&
    defaultContextWindowRaw > 0
      ? Math.floor(defaultContextWindowRaw)
      : DEFAULT_CONTEXT_WINDOW;

  return {
    baseUrl: (
      cfg.get<string>("baseUrl") ??
      "https://ai-platform.kube.severstal.severstalgroup.com/openai"
    ).replace(/\/$/, ""),
    apiKey: cfg.get<string>("apiKey") ?? "",
    models,
    defaultModel: cfg.get<string>("defaultModel") ?? models[0]?.id ?? "",
    defaultContextWindow,
    systemPrompt:
      cfg.get<string>("systemPrompt") ??
      "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: list_files, read_file, write_file, run_command. Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную.",
    maxToolRounds: cfg.get<number>("maxToolRounds") ?? 20,
    maxTokens: cfg.get<number>("maxTokens") ?? 4096,
    maxResponseChars: cfg.get<number>("maxResponseChars") ?? 12_000,
    rejectUnauthorized: cfg.get<boolean>("rejectUnauthorized") ?? false,
    caBundlePath:
      cfg.get<string>("caBundlePath") ??
      "~/Documents/Cline/severstal-ca-bundle.pem",
  };
}

/** Контекстное окно для модели: settings → known map → default. */
export function getContextWindow(modelId: string): number {
  const config = getConfig();
  const fromSettings = config.models.find((m) => m.id === modelId)?.contextWindow;
  if (fromSettings && fromSettings > 0) {
    return fromSettings;
  }
  const known = KNOWN_CONTEXT_WINDOWS[modelId];
  if (known && known > 0) {
    return known;
  }
  return config.defaultContextWindow;
}

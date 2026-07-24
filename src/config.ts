import * as vscode from "vscode";

export interface AgentModel {
  id: string;
  label?: string;
}

const DEFAULT_MODELS: AgentModel[] = [
  { id: "DeepSeek-V4-Flash", label: "DeepSeek V4 Flash" },
  { id: "Qwen3-Coder-Next", label: "Qwen3 Coder Next" },
  { id: "Gemma-4-31b", label: "Gemma 4 31B" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "Gemini 2.5 Flash", label: "Gemini 2.5 Flash" },
];

export interface AgentPanelConfig {
  baseUrl: string;
  apiKey: string;
  models: AgentModel[];
  defaultModel: string;
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
    const row = item as { id?: unknown; label?: unknown };
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) {
      continue;
    }
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : undefined;
    models.push(label ? { id, label } : { id });
  }

  return models.length > 0 ? models : DEFAULT_MODELS;
}

export function getConfig(): AgentPanelConfig {
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const models = readModels(cfg);

  return {
    baseUrl: (
      cfg.get<string>("baseUrl") ??
      "https://ai-platform.kube.severstal.severstalgroup.com/openai"
    ).replace(/\/$/, ""),
    apiKey: cfg.get<string>("apiKey") ?? "",
    models,
    defaultModel: cfg.get<string>("defaultModel") ?? models[0]?.id ?? "",
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

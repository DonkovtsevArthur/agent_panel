import * as vscode from "vscode";

export interface AgentProvider {
  id: string;
  name?: string;
  baseUrl: string;
  apiKey?: string;
}

export interface AgentModel {
  id: string;
  label?: string;
  /** id провайдера из agentPanel.providers */
  providerId?: string;
  /** Размер контекстного окна модели в токенах (max input) */
  contextWindow?: number;
  /** Лимит выходных токенов модели */
  maxOutputTokens?: number;
  /** false — скрыта из селектора чата; отсутствие = включена */
  enabled?: boolean;
  /** true — избранная: выше в селекторе чата */
  favorite?: boolean;
  /**
   * Явный флаг vision/multimodal.
   * Если не задан — берётся эвристика по id (см. resolveModelSupportsVision).
   */
  supportsVision?: boolean;
}

export interface ModelEndpoint {
  baseUrl: string;
  apiKey: string;
  providerId: string;
  providerName: string;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_PROVIDER_ID = "default";

/** Известные лимиты контекста по id модели (если не заданы в settings). */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "DeepSeek-V4-Flash": 128_000,
  "Qwen3-Coder-Next": 262_144,
  "Gemma-4-31b": 128_000,
  "claude-sonnet-4-5": 200_000,
  "gpt-4.1": 1_047_576,
  "Gemini 2.5 Flash": 1_048_576,
};

/** Явные значения vision для дефолтных/известных id. */
const KNOWN_VISION_SUPPORT: Record<string, boolean> = {
  "DeepSeek-V4-Flash": false,
  "Qwen3-Coder-Next": false,
  "Gemma-4-31b": false,
  "claude-sonnet-4-5": true,
  "gpt-4.1": true,
  "Gemini 2.5 Flash": true,
};

const DEFAULT_MODELS: AgentModel[] = [
  {
    id: "DeepSeek-V4-Flash",
    label: "DeepSeek V4 Flash",
    contextWindow: 128_000,
    supportsVision: false,
  },
  {
    id: "Qwen3-Coder-Next",
    label: "Qwen3 Coder Next",
    contextWindow: 262_144,
    supportsVision: false,
  },
  {
    id: "Gemma-4-31b",
    label: "Gemma 4 31B",
    contextWindow: 128_000,
    supportsVision: false,
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    contextWindow: 200_000,
    supportsVision: true,
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    contextWindow: 1_047_576,
    supportsVision: true,
  },
  {
    id: "Gemini 2.5 Flash",
    label: "Gemini 2.5 Flash",
    contextWindow: 1_048_576,
    supportsVision: true,
  },
];

export interface AgentPanelConfig {
  /** @deprecated legacy mirror of primary provider.baseUrl */
  baseUrl: string;
  /** @deprecated legacy mirror of primary provider.apiKey */
  apiKey: string;
  providers: AgentProvider[];
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

function normalizeBaseUrl(raw: string): string {
  return String(raw || "").trim().replace(/\/$/, "");
}

function readProviders(cfg: vscode.WorkspaceConfiguration): AgentProvider[] {
  const raw = cfg.get<unknown>("providers");
  const list = Array.isArray(raw) ? raw : [];
  const providers: AgentProvider[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      name?: unknown;
      baseUrl?: unknown;
      apiKey?: unknown;
    };
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const baseUrl = normalizeBaseUrl(
      typeof row.baseUrl === "string" ? row.baseUrl : ""
    );
    if (!id || !baseUrl || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const provider: AgentProvider = { id, baseUrl };
    if (typeof row.name === "string" && row.name.trim()) {
      provider.name = row.name.trim();
    }
    if (typeof row.apiKey === "string" && row.apiKey) {
      provider.apiKey = row.apiKey;
    }
    providers.push(provider);
  }
  return providers;
}

/** Если providers пуст — поднять legacy baseUrl/apiKey как провайдер «Основной». */
export function ensureProviders(
  providers: AgentProvider[],
  legacyBaseUrl: string,
  legacyApiKey: string
): AgentProvider[] {
  if (providers.length > 0) {
    return providers;
  }
  const baseUrl = normalizeBaseUrl(legacyBaseUrl);
  if (!baseUrl) {
    return [];
  }
  const provider: AgentProvider = {
    id: DEFAULT_PROVIDER_ID,
    name: "Основной",
    baseUrl,
  };
  if (legacyApiKey) {
    provider.apiKey = legacyApiKey;
  }
  return [provider];
}

export function primaryProvider(
  providers: AgentProvider[]
): AgentProvider | undefined {
  return (
    providers.find((p) => p.id === DEFAULT_PROVIDER_ID) || providers[0]
  );
}

/** Моделям без валидного providerId назначить primary. */
export function assignMissingProviderIds(
  models: AgentModel[],
  providers: AgentProvider[]
): AgentModel[] {
  const primaryId = primaryProvider(providers)?.id;
  if (!primaryId) {
    return models;
  }
  const valid = new Set(providers.map((p) => p.id));
  return models.map((model) => {
    if (model.providerId && valid.has(model.providerId)) {
      return model;
    }
    return { ...model, providerId: primaryId };
  });
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
      providerId?: unknown;
      contextWindow?: unknown;
      maxOutputTokens?: unknown;
      enabled?: unknown;
      favorite?: unknown;
      supportsVision?: unknown;
    };
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) {
      continue;
    }
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : undefined;
    const providerId =
      typeof row.providerId === "string" && row.providerId.trim()
        ? row.providerId.trim()
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
    if (providerId) {
      model.providerId = providerId;
    }
    if (contextWindow) {
      model.contextWindow = contextWindow;
    }
    if (maxOutputTokens) {
      model.maxOutputTokens = maxOutputTokens;
    }
    if (row.enabled === false) {
      model.enabled = false;
    }
    if (row.favorite === true) {
      model.favorite = true;
    }
    if (row.supportsVision === true) {
      model.supportsVision = true;
    } else if (row.supportsVision === false) {
      model.supportsVision = false;
    }
    models.push(model);
  }

  return models.length > 0 ? models : DEFAULT_MODELS;
}

function compareModelsByFavoriteThenLabel(a: AgentModel, b: AgentModel): number {
  const favA = a.favorite === true ? 0 : 1;
  const favB = b.favorite === true ? 0 : 1;
  if (favA !== favB) {
    return favA - favB;
  }
  const labelA = String(a.label || a.id || "").trim();
  const labelB = String(b.label || b.id || "").trim();
  const byLabel = labelA.localeCompare(labelB, "ru", {
    sensitivity: "base",
    numeric: true,
  });
  if (byLabel !== 0) {
    return byLabel;
  }
  return String(a.id || "").localeCompare(String(b.id || ""), "ru", {
    sensitivity: "base",
    numeric: true,
  });
}

export function getConfig(): AgentPanelConfig {
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const legacyBaseUrl = normalizeBaseUrl(
    cfg.get<string>("baseUrl") ??
      "https://ai-platform.kube.severstal.severstalgroup.com/openai"
  );
  const legacyApiKey = cfg.get<string>("apiKey") ?? "";
  const providers = ensureProviders(
    readProviders(cfg),
    legacyBaseUrl,
    legacyApiKey
  );
  const models = assignMissingProviderIds(readModels(cfg), providers);
  const primary = primaryProvider(providers);
  const defaultContextWindowRaw = cfg.get<number>("defaultContextWindow");
  const defaultContextWindow =
    typeof defaultContextWindowRaw === "number" &&
    Number.isFinite(defaultContextWindowRaw) &&
    defaultContextWindowRaw > 0
      ? Math.floor(defaultContextWindowRaw)
      : DEFAULT_CONTEXT_WINDOW;

  return {
    baseUrl: primary?.baseUrl || legacyBaseUrl,
    apiKey: primary?.apiKey || legacyApiKey,
    providers,
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

/** Эвристика vision по id, если флаг не задан в settings. */
export function guessModelSupportsVision(modelId: string): boolean {
  const id = String(modelId || "").trim();
  if (!id) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(KNOWN_VISION_SUPPORT, id)) {
    return KNOWN_VISION_SUPPORT[id];
  }
  const lower = id.toLowerCase();
  if (
    /deepseek|coder|codestral|codellama|code-llama|starcoder|qwen3-coder/.test(
      lower
    )
  ) {
    return false;
  }
  if (
    /gpt-4o|gpt-4\.1|gpt-5|o[1-9]|claude|gemini|llava|vision|pixtral|gpt-image/.test(
      lower
    )
  ) {
    return true;
  }
  if (/gemma-3|gemma3/.test(lower)) {
    return true;
  }
  return false;
}

/** Итоговое supportsVision: явный флаг модели → known/эвристика. */
export function resolveModelSupportsVision(
  modelOrId: AgentModel | string | undefined
): boolean {
  if (!modelOrId) {
    return false;
  }
  if (typeof modelOrId === "string") {
    const fromConfig = getConfig().models.find((m) => m.id === modelOrId);
    if (fromConfig && typeof fromConfig.supportsVision === "boolean") {
      return fromConfig.supportsVision;
    }
    return guessModelSupportsVision(modelOrId);
  }
  if (typeof modelOrId.supportsVision === "boolean") {
    return modelOrId.supportsVision;
  }
  return guessModelSupportsVision(modelOrId.id);
}

/** Модели, доступные в селекторе чата (enabled !== false). Избранные — сверху. */
export function getEnabledModels(): AgentModel[] {
  return getConfig()
    .models.filter((m) => m.enabled !== false)
    .slice()
    .sort(compareModelsByFavoriteThenLabel)
    .map((m) => ({
      ...m,
      supportsVision: resolveModelSupportsVision(m),
    }));
}

/** Endpoint для модели через её провайдера (или primary). */
export function resolveModelEndpoint(modelId: string): ModelEndpoint {
  const config = getConfig();
  const model = config.models.find((m) => m.id === modelId);
  const wantedId = model?.providerId?.trim() || "";
  const provider =
    (wantedId
      ? config.providers.find((p) => p.id === wantedId)
      : undefined) || primaryProvider(config.providers);

  if (!provider) {
    return {
      baseUrl: "",
      apiKey: "",
      providerId: "",
      providerName: "нет провайдера",
    };
  }

  return {
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey || "",
    providerId: provider.id,
    providerName: provider.name || provider.id,
  };
}

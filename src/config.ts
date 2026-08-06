import * as vscode from "vscode";
import {
  defaultCommitMessagePromptForLanguage,
  defaultProviderNameForLanguage,
  defaultSystemPromptForLanguage,
  isBuiltinCommitMessagePrompt,
  isBuiltinSystemPrompt,
  resolveUiLanguage,
} from "./i18n";
import {
  AgentModeDef,
  mergeModes,
  parseCustomModes,
  resolveMode,
} from "./modes";
import {
  resolveModelCapabilities,
  resolveModelContextWindow,
} from "./modelCapabilities";

export type { AgentModeDef } from "./modes";
export { mergeModes, resolveMode } from "./modes";

export interface AgentProvider {
  id: string;
  name?: string;
  baseUrl: string;
  apiKey?: string;
  /**
   * URL проверки соединения (GET).
   * Пусто или равен baseUrl → `{baseUrl}/models`.
   */
  statusUrl?: string;
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
  /**
   * Уровень reasoning_effort для thinking-моделей (Claude 3.5+/4 через
   * OpenAI-compatible гейтвей). Пусто = default по capability ("high").
   * Допустимо: "minimal" | "low" | "medium" | "high" | "xhigh" | "max".
   */
  reasoningEffort?: string;
}

export interface ModelEndpoint {
  baseUrl: string;
  apiKey: string;
  providerId: string;
  providerName: string;
  /** Полный URL для GET-проверки статуса (см. resolveProviderProbeUrl). */
  statusUrl?: string;
}

/** URL для проверки доступности провайдера. */
export function resolveProviderProbeUrl(provider: {
  baseUrl: string;
  statusUrl?: string;
}): string {
  const base = normalizeBaseUrl(provider.baseUrl);
  if (!base) {
    return "";
  }
  const status = normalizeBaseUrl(provider.statusUrl || "");
  if (!status || status === base) {
    return `${base}/models`;
  }
  return status;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_PROVIDER_ID = "default";

const DEFAULT_MODELS: AgentModel[] = [
  {
    id: "DeepSeek-V4-Flash",
    label: "DeepSeek V4 Flash",
  },
  {
    id: "Qwen3-Coder-Next",
    label: "Qwen3 Coder Next",
  },
  {
    id: "Gemma-4-31b",
    label: "Gemma 4 31B",
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
  },
  {
    id: "Gemini 2.5 Flash",
    label: "Gemini 2.5 Flash",
  },
];

export interface AgentPanelConfig {
  language: "auto" | "en" | "ru";
  /** @deprecated legacy mirror of primary provider.baseUrl */
  baseUrl: string;
  /** @deprecated legacy mirror of primary provider.apiKey */
  apiKey: string;
  providers: AgentProvider[];
  models: AgentModel[];
  /** Пользовательские режимы (Агент/План/Спросить — встроенные) */
  modes: AgentModeDef[];
  defaultModel: string;
  defaultContextWindow: number;
  systemPrompt: string;
  maxToolRounds: number;
  maxTokens: number;
  maxResponseChars: number;
  /**
   * Under-the-hood model for image messages when the selected chat model
   * lacks vision. Empty preferredModelIds → built-in VISION_MODEL_PREFERENCE.
   */
  visionRouting: {
    /** Ordered preferred vision model ids; empty = auto. */
    preferredModelIds: string[];
  };
  soundNotifications: {
    enabled: boolean;
  };
  rejectUnauthorized: boolean;
  caBundlePath: string;
  commitMessage: {
    prompt: string;
    language: "auto" | "en" | "ru";
    /** Откуда сейчас действуют настройки commit message. */
    scope: "global" | "workspace";
  };
  figma: {
    enabled: boolean;
  };
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
      statusUrl?: unknown;
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
    const statusUrl = normalizeBaseUrl(
      typeof row.statusUrl === "string" ? row.statusUrl : ""
    );
    if (statusUrl && statusUrl !== baseUrl) {
      provider.statusUrl = statusUrl;
    }
    providers.push(provider);
  }
  return providers;
}

/** Если providers пуст — поднять legacy baseUrl/apiKey как провайдер «Основной». */
export function ensureProviders(
  providers: AgentProvider[],
  legacyBaseUrl: string,
  legacyApiKey: string,
  language: "auto" | "en" | "ru" = "auto"
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
    name: defaultProviderNameForLanguage(resolveUiLanguage(language)),
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
      reasoningEffort?: unknown;
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
    if (
      typeof row.reasoningEffort === "string" &&
      row.reasoningEffort.trim()
    ) {
      model.reasoningEffort = row.reasoningEffort.trim();
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

function readCommitMessageLanguage(
  value: unknown
): "auto" | "en" | "ru" {
  if (value === "ru" || value === "en" || value === "auto") {
    return value;
  }
  return "auto";
}

function resolveCommitMessageScope(
  cfg: vscode.WorkspaceConfiguration
): "global" | "workspace" {
  for (const key of ["commitMessage.prompt", "commitMessage.language"]) {
    const info = cfg.inspect(key);
    if (
      info?.workspaceValue !== undefined ||
      info?.workspaceFolderValue !== undefined
    ) {
      return "workspace";
    }
  }
  return "global";
}

export function getConfig(): AgentPanelConfig {
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const legacyBaseUrl = normalizeBaseUrl(
    cfg.get<string>("baseUrl") ??
      "https://ai-platform.kube.severstal.severstalgroup.com/openai"
  );
  const legacyApiKey = cfg.get<string>("apiKey") ?? "";
  const language =
    cfg.get<"auto" | "en" | "ru">("language") === "ru"
      ? "ru"
      : cfg.get<"auto" | "en" | "ru">("language") === "en"
        ? "en"
        : "auto";
  const providers = ensureProviders(
    readProviders(cfg),
    legacyBaseUrl,
    legacyApiKey,
    language
  );
  const models = assignMissingProviderIds(readModels(cfg), providers);
  const modes = parseCustomModes(cfg.get<unknown>("modes"));
  const primary = primaryProvider(providers);
  const defaultContextWindowRaw = cfg.get<number>("defaultContextWindow");
  const defaultContextWindow =
    typeof defaultContextWindowRaw === "number" &&
    Number.isFinite(defaultContextWindowRaw) &&
    defaultContextWindowRaw > 0
      ? Math.floor(defaultContextWindowRaw)
      : DEFAULT_CONTEXT_WINDOW;

  return {
    language,
    baseUrl: primary?.baseUrl || legacyBaseUrl,
    apiKey: primary?.apiKey || legacyApiKey,
    providers,
    models,
    modes,
    defaultModel:
      models.find((m) => m.enabled !== false)?.id || models[0]?.id || "",
    defaultContextWindow,
    systemPrompt: (() => {
      const stored = String(cfg.get<string>("systemPrompt") || "").trim();
      if (isBuiltinSystemPrompt(stored)) {
        return defaultSystemPromptForLanguage(resolveUiLanguage(language));
      }
      return stored;
    })(),
    maxToolRounds: cfg.get<number>("maxToolRounds") ?? 20,
    maxTokens: cfg.get<number>("maxTokens") ?? 4096,
    maxResponseChars: cfg.get<number>("maxResponseChars") ?? 64_000,
    visionRouting: (() => {
      const rawIds = cfg.get<unknown>("visionRouting.preferredModelIds");
      const fromArray = Array.isArray(rawIds)
        ? rawIds
            .map((id) => String(id || "").trim())
            .filter(Boolean)
            .filter((id, index, all) => all.indexOf(id) === index)
        : [];
      const legacy = String(
        cfg.get<string>("visionRouting.preferredModelId") || ""
      ).trim();
      return {
        preferredModelIds:
          fromArray.length > 0 ? fromArray : legacy ? [legacy] : [],
      };
    })(),
    soundNotifications: {
      enabled: cfg.get<boolean>("soundNotifications.enabled") !== false,
    },
    rejectUnauthorized: cfg.get<boolean>("rejectUnauthorized") ?? false,
    caBundlePath:
      cfg.get<string>("caBundlePath") ??
      "~/Documents/Cline/severstal-ca-bundle.pem",
    commitMessage: (() => {
      const commitLanguage = readCommitMessageLanguage(
        cfg.get("commitMessage.language")
      );
      const commitLangResolved =
        commitLanguage === "ru" || commitLanguage === "en"
          ? commitLanguage
          : resolveUiLanguage(language);
      const storedPrompt = String(
        cfg.get<string>("commitMessage.prompt") || ""
      ).trim();
      return {
        prompt: isBuiltinCommitMessagePrompt(storedPrompt)
          ? defaultCommitMessagePromptForLanguage(commitLangResolved)
          : storedPrompt,
        language: commitLanguage,
        scope: resolveCommitMessageScope(cfg),
      };
    })(),
    figma: {
      enabled: cfg.get<boolean>("figma.enabled") === true,
    },
  };
}

export function getResolvedModes(): AgentModeDef[] {
  return mergeModes(getConfig().modes);
}

export function getModeById(id: unknown): AgentModeDef {
  return resolveMode(id, getConfig().modes);
}

/** Контекстное окно для модели: settings → capability registry → default. */
export function getContextWindow(modelId: string): number {
  const config = getConfig();
  const fromSettings = config.models.find((m) => m.id === modelId)?.contextWindow;
  return resolveModelContextWindow(
    modelId,
    fromSettings,
    config.defaultContextWindow
  );
}

/** Эвристика vision по id, если флаг не задан в settings. */
export function guessModelSupportsVision(modelId: string): boolean {
  return resolveModelCapabilities(modelId).supportsVision;
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
    return resolveModelCapabilities(modelOrId, {
      supportsVision: fromConfig?.supportsVision,
    }).supportsVision;
  }
  return resolveModelCapabilities(modelOrId.id, {
    supportsVision: modelOrId.supportsVision,
  }).supportsVision;
}

/**
 * reasoning_effort для модели: явный из конфига → default по capability.
 * undefined — модель не поддерживает reasoning_effort (не отправляем поле).
 */
export function resolveModelReasoningEffort(
  modelId: string
): string | undefined {
  const fromConfig = getConfig().models.find((m) => m.id === modelId);
  const capabilities = resolveModelCapabilities(modelId, {
    reasoningEffort: fromConfig?.reasoningEffort,
  });
  if (!capabilities.supportsReasoningEffort) {
    return undefined;
  }
  return (
    capabilities.reasoningEffortDefault ||
    fromConfig?.reasoningEffort ||
    "high"
  );
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

/**
 * Pool for whole-turn vision routing when the picker model cannot see images.
 * Includes catalog models that are unchecked in the picker (`enabled: false`) —
 * preferred / built-in vision helpers still run under the hood for that message.
 * `enabled` is forced true so {@link routeModel} accepts them.
 */
export function getVisionRoutingModels(): AgentModel[] {
  return getConfig()
    .models.slice()
    .map((m) => ({
      ...m,
      enabled: true,
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

  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const statusUrl = normalizeBaseUrl(provider.statusUrl || "");
  return {
    baseUrl,
    apiKey: provider.apiKey || "",
    providerId: provider.id,
    providerName: provider.name || provider.id,
    statusUrl: statusUrl && statusUrl !== baseUrl ? statusUrl : undefined,
  };
}

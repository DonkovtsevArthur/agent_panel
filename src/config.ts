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
import { readModelTokenLimits } from "./modelTokenLimits";
import { normalizeReasoningEffort } from "./reasoningEffort";
import { normalizeExcludeGlobs } from "./tabAutocompleteExclude";

export type { AgentModeDef } from "./modes";
export { mergeModes, resolveMode } from "./modes";

/** Tool groups for granular auto-approve (agentPanel.tools.approvals). */
export type ToolApprovalGroup =
  | "reads"
  | "web"
  | "edits"
  | "commands"
  | "mcp"
  | "subagents";

export const TOOL_APPROVAL_GROUPS: ToolApprovalGroup[] = [
  "reads",
  "web",
  "edits",
  "commands",
  "mcp",
  "subagents",
];

/** Explicit per-group override; unset groups follow the master autoApprove flag. */
export type ToolApprovalsConfig = Partial<
  Record<ToolApprovalGroup, boolean>
>;

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
   * Уровень reasoning_effort для thinking-моделей (Claude 3.5+/4, Kimi,
   * GLM-4.5+ через OpenAI-compatible гейтвей). Пусто = default по capability ("high").
   * Допустимо: "low" | "medium" | "high" | "xhigh".
   * Если задано — модель считается поддерживающей reasoning в UI селекторе.
   */
  reasoningEffort?: string;
  /** Вычисляется при getEnabledModels — не из Settings. */
  supportsReasoningEffort?: boolean;
  /** Вычисляется при getEnabledModels — default для селектора. */
  reasoningEffortDefault?: string;
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

export const UI_FONT_SIZE_MIN = 11;
export const UI_FONT_SIZE_MAX = 20;
export const UI_FONT_SIZE_DEFAULT = 13;

export function clampUiFontSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return UI_FONT_SIZE_DEFAULT;
  }
  return Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, Math.round(n)));
}

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
  /** Panel chat + composer font size in pixels. */
  fontSize: number;
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
   * Preferred vision models for under-the-hood image describe when the
   * selected chat model cannot view images (e.g. GLM-5.2). Also used for
   * Figma MCP screenshots.
   */
  visionRouting: {
    /** Ordered preferred vision model ids. */
    preferredModelIds: string[];
  };
  soundNotifications: {
    enabled: boolean;
  };
  /**
   * Parallel sub-agents (ClineCore spawn_agent).
   * Children inherit the parent mode preset (Agent → act tools; Plan/Ask → read-focused).
   */
  subagents: {
    enabled: boolean;
  };
  /**
   * Run multiple tool calls from one model response concurrently
   * (`maxParallelToolCalls` → Cline `toolExecution: "parallel"`).
   */
  parallelToolCalls: {
    enabled: boolean;
  };
  /**
   * Automatically compress Cline conversation context when the request
   * approaches the model input budget (`compaction.enabled`).
   */
  autoCompact: {
    enabled: boolean;
  };
  /**
   * Auto-approve Cline tools (current Harbor default). Off → confirm each tool.
   * `approvals` groups override the master flag per tool group
   * (unset = follow the master flag).
   */
  tools: {
    autoApprove: boolean;
    approvals: ToolApprovalsConfig;
  };
  /**
   * Focus chain: the agent keeps a markdown task checklist and Harbor
   * re-injects the latest one into follow-up turns.
   */
  focusChain: {
    enabled: boolean;
  };
  /**
   * Cline git checkpoints at the start of each root-agent run (restore via UI).
   */
  checkpoints: {
    enabled: boolean;
  };
  /**
   * Agent Skills (SKILL.md). Discovery is Harbor-only:
   * `<workspace>/.harbor/skills`, `~/.harbor/skills`, plus extraDirectories.
   * Does not auto-scan `.agents` / `.cline` / `.cursor` skill trees.
   */
  skills: {
    enabled: boolean;
    /** Scan `<workspace>/.harbor/skills` */
    workspaceEnabled: boolean;
    /** Scan `~/.harbor/skills` */
    globalEnabled: boolean;
    /** Absolute paths added in Settings → Skills. */
    extraDirectories: string[];
    /** Extra directories toggled off in Settings. */
    disabledExtraDirectories: string[];
    /** Skill names (frontmatter name or dirname) excluded from the tool. */
    disabled: string[];
  };
  /**
   * Inline Tab autocomplete (ghost text). Uses Harbor providers via
   * openaiClient — not a separate TabCoder profile system.
   */
  tabAutocomplete: {
    enabled: boolean;
    /** Model id from agentPanel.models (separate from chat selection). */
    modelId: string;
    /** How eagerly to request suggestions while typing. */
    aggressiveness: "low" | "medium" | "high";
    /**
     * How many distinct ghost-text alternatives to request in one hole-fill
     * call (cycle with Alt+[ / Alt+]).
     */
    alternatives: 1 | 2 | 3;
    /**
     * Glob patterns for paths where Tab should stay silent
     * (dist / generated / node_modules / …).
     */
    excludeGlobs: string[];
    /**
     * After accepting a suggestion, offer a one-shot jump to the likely
     * next edit (e.g. store → events section).
     */
    nextEdit: boolean;
    /**
     * `chip` — prefetch silently, show with Ctrl+Enter / ⌘⏎.
     * `inline` — show ghost text automatically when ready.
     */
    showMode: "chip" | "inline";
    /**
     * Prefer OpenAI-style FIM (`/completions` with prompt+suffix) when the
     * provider supports it. Falls back to hole-fill chat on failure.
     */
    fim: boolean;
  };
  /** Floating CodeLens «Add to Chat» above a non-empty selection. */
  selectionHints: {
    enabled: boolean;
  };
  rejectUnauthorized: boolean;
  caBundlePath: string;
  commitMessage: {
    prompt: string;
    /** Empty = auto light/utility model. */
    modelId: string;
    language: "auto" | "en" | "ru";
    /** Откуда сейчас действуют настройки commit message. */
    scope: "global" | "workspace";
  };
  figma: {
    enabled: boolean;
  };
  /** AutoGLM real-browser agent (browser_task tool). */
  autoglm: {
    enabled: boolean;
    binaryPath: string;
    browser: "chrome" | "edge";
    autoApprove: boolean;
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
    const limits = readModelTokenLimits(item);
    const contextWindow = limits.contextWindow;
    const maxOutputTokens = limits.maxOutputTokens;
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
  // JetBrains / headless persist an explicit UI flag (VS Code derives scope
  // from ConfigurationTarget via inspect below).
  const explicit = String(
    cfg.get<string>("commitMessageScope") ||
      cfg.get<string>("commitMessage.scope") ||
      ""
  )
    .trim()
    .toLowerCase();
  if (explicit === "workspace" || explicit === "global") {
    return explicit;
  }
  for (const key of [
    "commitMessage.prompt",
    "commitMessage.language",
    "commitMessage.modelId",
  ]) {
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
  const legacyBaseUrl = normalizeBaseUrl(cfg.get<string>("baseUrl") ?? "");
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
    fontSize: clampUiFontSize(cfg.get<number>("fontSize")),
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
    subagents: {
      enabled: cfg.get<boolean>("subagents.enabled") !== false,
    },
    parallelToolCalls: {
      enabled: cfg.get<boolean>("parallelToolCalls.enabled") !== false,
    },
    autoCompact: {
      enabled: cfg.get<boolean>("autoCompact.enabled") !== false,
    },
    tools: (() => {
      const raw = cfg.get<unknown>("tools.approvals");
      const approvals: ToolApprovalsConfig = {};
      if (raw && typeof raw === "object") {
        for (const group of TOOL_APPROVAL_GROUPS) {
          const value = (raw as Record<string, unknown>)[group];
          if (typeof value === "boolean") {
            approvals[group] = value;
          }
        }
      }
      return {
        autoApprove: cfg.get<boolean>("tools.autoApprove") !== false,
        approvals,
      };
    })(),
    focusChain: {
      enabled: cfg.get<boolean>("focusChain.enabled") !== false,
    },
    checkpoints: {
      enabled: cfg.get<boolean>("checkpoints.enabled") !== false,
    },
    skills: (() => {
      const extraRaw = cfg.get<unknown>("skills.extraDirectories");
      const extraDirectories = Array.isArray(extraRaw)
        ? extraRaw
            .map((p) => String(p || "").trim())
            .filter(Boolean)
            .filter((p, i, all) => all.indexOf(p) === i)
        : [];
      const disabledExtraRaw = cfg.get<unknown>("skills.disabledExtraDirectories");
      const disabledExtraDirectories = Array.isArray(disabledExtraRaw)
        ? disabledExtraRaw
            .map((p) => String(p || "").trim())
            .filter(Boolean)
            .filter((p, i, all) => all.indexOf(p) === i)
        : [];
      const disabledRaw = cfg.get<unknown>("skills.disabled");
      const disabled = Array.isArray(disabledRaw)
        ? disabledRaw
            .map((n) => String(n || "").trim())
            .filter(Boolean)
            .filter((n, i, all) => all.indexOf(n) === i)
        : [];
      return {
        enabled: cfg.get<boolean>("skills.enabled") !== false,
        workspaceEnabled: cfg.get<boolean>("skills.workspaceEnabled") !== false,
        globalEnabled: cfg.get<boolean>("skills.globalEnabled") !== false,
        extraDirectories,
        disabledExtraDirectories,
        disabled,
      };
    })(),
    tabAutocomplete: (() => {
      const rawAgg = String(
        cfg.get<string>("tabAutocomplete.aggressiveness") || "medium"
      )
        .trim()
        .toLowerCase();
      const aggressiveness =
        rawAgg === "low" || rawAgg === "high" ? rawAgg : "medium";
      const rawAlts = Number(cfg.get<number | string>("tabAutocomplete.alternatives"));
      const alternatives: 1 | 2 | 3 =
        rawAlts === 1 || rawAlts === 3 ? rawAlts : 2;
      return {
        enabled: cfg.get<boolean>("tabAutocomplete.enabled") === true,
        modelId: String(cfg.get<string>("tabAutocomplete.modelId") || "").trim(),
        aggressiveness,
        alternatives,
        excludeGlobs: normalizeExcludeGlobs(
          cfg.get<string[]>("tabAutocomplete.excludeGlobs")
        ),
        nextEdit: cfg.get<boolean>("tabAutocomplete.nextEdit") === true,
        showMode:
          String(cfg.get<string>("tabAutocomplete.showMode") || "chip")
            .trim()
            .toLowerCase() === "inline"
            ? "inline"
            : "chip",
        fim: cfg.get<boolean>("tabAutocomplete.fim") === true,
      };
    })(),
    selectionHints: {
      enabled: cfg.get<boolean>("selectionHints.enabled") !== false,
    },
    rejectUnauthorized: cfg.get<boolean>("rejectUnauthorized") ?? false,
    caBundlePath: "",
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
        modelId: String(cfg.get<string>("commitMessage.modelId") || "").trim(),
        language: commitLanguage,
        scope: resolveCommitMessageScope(cfg),
      };
    })(),
    figma: {
      enabled: cfg.get<boolean>("figma.enabled") === true,
    },
    autoglm: (() => {
      const browserRaw = String(cfg.get<string>("autoglm.browser") || "chrome")
        .trim()
        .toLowerCase();
      return {
        enabled: cfg.get<boolean>("autoglm.enabled") === true,
        binaryPath: String(cfg.get<string>("autoglm.binaryPath") || "").trim(),
        browser: browserRaw === "edge" ? ("edge" as const) : ("chrome" as const),
        autoApprove: cfg.get<boolean>("autoglm.autoApprove") === true,
      };
    })(),
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

/**
 * Итоговое supportsVision.
 * Явный `true` в Settings включает vision у неизвестных id.
 * Эвристика по id (claude / gpt-4o / gemini / …) не должна гаситься
 * устаревшим `supportsVision: false` из API — иначе Cline подменяет
 * пиксели плейсхолдером «this model cannot view images».
 */
export function resolveModelSupportsVision(
  modelOrId: AgentModel | string | undefined
): boolean {
  if (!modelOrId) {
    return false;
  }
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId.id;
  const stored =
    typeof modelOrId === "string"
      ? getConfig().models.find((m) => m.id === modelOrId)?.supportsVision
      : modelOrId.supportsVision;
  if (stored === true) {
    return true;
  }
  return resolveModelCapabilities(id).supportsVision;
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
    normalizeReasoningEffort(capabilities.reasoningEffortDefault) ||
    normalizeReasoningEffort(fromConfig?.reasoningEffort) ||
    "high"
  );
}

/** Модель принимает reasoning_effort (Claude 3.5+/4, Kimi, GLM-4.5+ или override в Settings). */
export function resolveModelSupportsReasoningEffort(
  modelOrId: string | AgentModel
): boolean {
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId.id;
  const fromConfig =
    typeof modelOrId === "string"
      ? getConfig().models.find((m) => m.id === id)
      : modelOrId;
  return resolveModelCapabilities(id, {
    reasoningEffort: fromConfig?.reasoningEffort,
  }).supportsReasoningEffort;
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
      supportsReasoningEffort: resolveModelSupportsReasoningEffort(m),
      reasoningEffortDefault: resolveModelReasoningEffort(m.id),
    }));
}

/**
 * @deprecated Chat turns no longer swap models for images (Cline handles vision).
 * Kept for callers / tests that still exercise vision preference pools.
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

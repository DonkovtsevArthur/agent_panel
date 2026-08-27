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

export type { AgentModeDef } from "./modes";
export { mergeModes, resolveMode } from "./modes";

/** Tool groups for granular auto-approve (agentPanel.tools.approvals). */
export type ToolApprovalGroup =
  | "reads"
  | "web"
  | "edits"
  | "commands"
  | "mcp"
  | "subagents"
  | "plan";

export const TOOL_APPROVAL_GROUPS: ToolApprovalGroup[] = [
  "reads",
  "web",
  "edits",
  "commands",
  "mcp",
  "subagents",
  "plan",
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
  /**
   * Per-provider opt-in for Anthropic-style `cache_control` prompt-cache markers
   * on OpenAI-compatible chat turns. Overrides the global
   * `agentPanel.promptCache.enabled`:
   * - `true`  — emit markers (only safe for upstreams that accept them:
   *   LiteLLM / OpenRouter with Claude|Qwen upstreams, Anthropic-compatible
   *   endpoints).
   * - `false` — never emit, even if the global flag is on.
   * - unset  — follow `agentPanel.promptCache.enabled` (backward compatible).
   *
   * Strict OpenAI (`api.openai.com`) rejects the marker with 400, so leave it
   * off for plain OpenAI endpoints. Auto-suggested at "on" in Settings when the
   * baseUrl looks like litellm / openrouter / anthropic.
   */
  promptCache?: boolean;
  /**
   * Wire protocol the provider speaks.
   * - `"openai-compatible"` (default) — OpenAI Chat Completions (`/chat/completions`).
   * - `"anthropic"` — Anthropic Messages API (`/v1/messages`).
   */
  protocol?: "openai-compatible" | "anthropic";
}

/**
 * Heuristic for the Settings "smart default": flip the per-provider promptCache
 * checkbox on by default when the baseUrl is one of the upstreams known to
 * accept Anthropic-style `cache_control` on OpenAI-format bodies.
 * Intentionally conservative — misses are fine (the user can still toggle on),
 * false positives would 400 every request on that provider.
 */
export function baseUrlSuggestsPromptCache(baseUrl: string): boolean {
  const url = String(baseUrl || "").toLowerCase();
  if (!url) {
    return false;
  }
  if (/api\.openai\.com/.test(url)) {
    return false;
  }
  return (
    /litellm/.test(url) ||
    /openrouter\.ai/.test(url) ||
    /anthropic\.com/.test(url) ||
    /claude\.ai/.test(url) ||
    /aihubmix|sapaicore|vertex|ai-sdk/.test(url)
  );
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
  /** Wire protocol: `"openai-compatible"` (default) or `"anthropic"`. */
  protocol?: "openai-compatible" | "anthropic";
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
   * Emit Anthropic-style prompt-cache markers (`cache_control`) on chat turns
   * for OpenAI-compatible upstreams that accept them (LiteLLM/OpenRouter with
   * Claude/Qwen upstreams, Anthropic-compatible endpoints). Off by default:
   * strict OpenAI endpoints reject the unknown content-part field.
   */
  promptCache: {
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
   * `[Harbor turn context]` IDE block on follow-up turns of a live Cline
   * session. The session's first turn always gets the full block; follow-ups
   * re-send it and the old blocks stay in the session history, which is what
   * inflates long chats. `full` keeps the legacy behavior, `slim` drops the
   * heavy parts (active-file prefetch, workspace rules, terminal snapshot,
   * recently viewed files), `none` sends no block on follow-ups.
   */
  turnContext: {
    followUps: "full" | "slim" | "none";
  };
  /**
   * Cline git checkpoints at the start of each root-agent run (restore via UI).
   */
  checkpoints: {
    enabled: boolean;
  };
  /**
   * Live Cline session retention: an idle session is stopped after this many
   * minutes; the next message in that chat starts a fresh session replayed
   * from Harbor history (cold prompt cache). Higher values keep more sessions
   * alive in memory (hard cap `CLINE_MAX_LIVE_SESSIONS` still applies).
   */
  sessions: {
    idleEvictMinutes: number;
    /** Auto-abort a turn after this many minutes of no events from the model/tools. */
    inactivityTimeoutMinutes: number;
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
  /** Floating CodeLens «Add to Chat» above a non-empty selection. */
  selectionHints: {
    enabled: boolean;
  };
  rejectUnauthorized: boolean;
  caBundlePath: string;
  commitMessage: {
    prompt: string;
    /** Ordered model ids for commit generation. Empty = prompt user to select. */
    modelIds: string[];
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
      promptCache?: unknown;
      protocol?: unknown;
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
    if (typeof row.promptCache === "boolean") {
      provider.promptCache = row.promptCache;
    }
    if (
      typeof row.protocol === "string" &&
      (row.protocol === "openai-compatible" || row.protocol === "anthropic")
    ) {
      provider.protocol = row.protocol;
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
    "commitMessage.modelIds",
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
    promptCache: {
      enabled: cfg.get<boolean>("promptCache.enabled") === true,
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
    turnContext: {
      followUps:
        cfg.get("turnContext.followUps") === "none"
          ? "none"
          : cfg.get("turnContext.followUps") === "slim"
            ? "slim"
            : "full",
    },
    checkpoints: {
      enabled: cfg.get<boolean>("checkpoints.enabled") !== false,
    },
    sessions: (() => {
      const raw = Number(cfg.get<unknown>("sessions.idleEvictMinutes"));
      const inactivityRaw = Number(cfg.get<unknown>("sessions.inactivityTimeoutMinutes"));
      return {
        idleEvictMinutes:
          Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60,
        inactivityTimeoutMinutes:
          Number.isFinite(inactivityRaw) && inactivityRaw > 0 ? Math.floor(inactivityRaw) : 5,
      };
    })(),
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
    selectionHints: {
      enabled: cfg.get<boolean>("selectionHints.enabled") !== false,
    },
    rejectUnauthorized: cfg.get<boolean>("rejectUnauthorized") ?? true,
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
      const rawModelIds = cfg.get<unknown>("commitMessage.modelIds");
      const modelIds = Array.isArray(rawModelIds)
        ? rawModelIds
            .map((v) => String(v || "").trim())
            .filter(Boolean)
            .filter((id, i, all) => all.indexOf(id) === i)
        : [];
      // Backward compat: if modelIds is empty, try the old single-modelId string.
      const legacyModelId = String(
        cfg.get<string>("commitMessage.modelId") || ""
      ).trim();
      return {
        prompt: isBuiltinCommitMessagePrompt(storedPrompt)
          ? defaultCommitMessagePromptForLanguage(commitLangResolved)
          : storedPrompt,
        modelIds: modelIds.length > 0 ? modelIds : legacyModelId ? [legacyModelId] : [],
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
  modelOrId: string | AgentModel
): string | undefined {
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId.id;
  const fromConfig =
    typeof modelOrId === "string"
      ? getConfig().models.find((m) => m.id === id)
      : modelOrId;
  const capabilities = resolveModelCapabilities(id, {
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

/**
 * Сырой ключ настроек, от которых зависит getEnabledModels(): models/providers
 * (providerId моделей) + legacy baseUrl/apiKey (fallback-провайдер). Смена
 * любого значения → пересчёт; чтение четырёх значений и сравнение строк дешевле
 * полного парса конфига, поэтому инвалидация по событиям не нужна.
 */
let enabledModelsCache: AgentModel[] | undefined;
let enabledModelsCacheKey: string | undefined;

function enabledModelsSettingsKey(
  cfg: vscode.WorkspaceConfiguration
): string {
  return JSON.stringify([
    cfg.get<unknown>("models"),
    cfg.get<unknown>("providers"),
    cfg.get<unknown>("baseUrl"),
    cfg.get<unknown>("apiKey"),
  ]);
}

/**
 * Модели, доступные в селекторе чата (enabled !== false). Избранные — сверху.
 * Мемоизировано: до смены models/providers возвращается тот же массив —
 * результат read-only, не сортировать и не мутировать на месте.
 */
export function getEnabledModels(): AgentModel[] {
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const key = enabledModelsSettingsKey(cfg);
  if (enabledModelsCache && key === enabledModelsCacheKey) {
    return enabledModelsCache;
  }
  const models = getConfig()
    .models.filter((m) => m.enabled !== false)
    .slice()
    .sort(compareModelsByFavoriteThenLabel)
    .map((m) => ({
      ...m,
      supportsVision: resolveModelSupportsVision(m),
      supportsReasoningEffort: resolveModelSupportsReasoningEffort(m),
      reasoningEffortDefault: resolveModelReasoningEffort(m),
    }));
  enabledModelsCache = models;
  enabledModelsCacheKey = key;
  return models;
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
    protocol: provider.protocol,
  };
}

/**
 * Effective prompt-cache flag for a model: provider override → global setting.
 * - `true` emits Anthropic-style `cache_control` markers on chat turns for
 *   upstreams that accept them (LiteLLM / OpenRouter / Anthropic-compatible).
 * - `false` (default) keeps the legacy markerless behavior.
 *
 * Used by `clineRuntime` to set the `prompt-cache` model capability and the
 * gateway `routing.promptCache` metadata. Part of the Cline session fingerprint
 * so toggling restarts the session for that provider only.
 */
export function resolveModelPromptCache(modelId: string): boolean {
  const config = getConfig();
  const model = config.models.find((m) => m.id === modelId);
  const wantedId = model?.providerId?.trim() || "";
  const provider = wantedId
    ? config.providers.find((p) => p.id === wantedId)
    : primaryProvider(config.providers);
  if (provider && typeof provider.promptCache === "boolean") {
    return provider.promptCache;
  }
  return config.promptCache.enabled === true;
}

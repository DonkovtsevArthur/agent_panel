import type { AgentModel, getEnabledModels } from "./config";
import { resolveModelCapabilities } from "./modelCapabilities";

/** The concrete list shape returned by getEnabledModels, without reading config. */
export type EnabledAgentModels = ReturnType<typeof getEnabledModels>;

export interface ModelRoutingHints {
  /** Only models with explicit or registered vision support are eligible. */
  vision_required?: boolean;
  /**
   * Ordered model ids preferred when vision_required is true and the user's
   * selection is not vision-eligible. Empty / omitted → {@link VISION_MODEL_PREFERENCE}.
   */
  vision_preference?: readonly string[];
  /** Minimum known input context window. Unknown context is not eligible. */
  min_context_window?: number;
  /** Enables an explicit preference intended for short, read-only work. */
  fast_readonly?: boolean;
  /** Marks this selection as a retry after a failed model. */
  fallback_after_failure?: boolean;
  /** Model ids that must not be selected. */
  excluded_model_ids?: readonly string[];
  /** Short alias accepted for callers whose hint payload uses excluded ids. */
  excluded_ids?: readonly string[];
  /**
   * Ordered model ids preferred when fast_readonly is true.
   * No speed or price is inferred when this preference is absent.
   */
  fast_readonly_preference?: readonly string[];
}

export interface ModelRoutingOptions {
  /** Model chosen manually by the user. */
  userSelectedModelId?: string;
  hints?: ModelRoutingHints;
}

export type ModelRoutingReason =
  | "user_selected"
  | "favorite"
  | "capability_match"
  | "vision_preference"
  | "fast_readonly_preference"
  | "utility_preference"
  | "fallback_after_failure"
  | "original_order";

export interface ModelRoutingResult {
  modelId: string;
  reason: ModelRoutingReason;
}

/**
 * Ordered lightweight models for under-the-hood tasks (commit messages, etc.).
 * Exact ids are tried first; then any enabled model that {@link looksLikeUtilityModel}.
 */
export const UTILITY_MODEL_PREFERENCE: readonly string[] = [
  "DeepSeek-V4-Flash",
  "Qwen3-Coder-Next",
  "Gemini 2.5 Flash",
  "Gemma-4-31b",
];

/**
 * Default under-the-hood models when a message has images and the selected
 * model lacks vision. Exact ids first; only enabled vision-capable models win.
 */
export const VISION_MODEL_PREFERENCE: readonly string[] = [
  "Gemini 2.5 Flash",
  "gpt-4.1",
  "claude-sonnet-4-5",
];

/**
 * Manual preferred ids when non-empty; otherwise the built-in vision list.
 */
export function resolveVisionPreferenceIds(
  manualIds: readonly string[] | undefined
): string[] {
  const manual = normalizedIds(manualIds).filter(
    (id, index, all) => all.indexOf(id) === index
  );
  return manual.length > 0 ? manual : [...VISION_MODEL_PREFERENCE];
}

/** Names that look heavy / agentic — never treat as utility even if they match a light token. */
const UTILITY_HEAVY_NAME =
  /kimi|moonshot|\bopus\b|\bsonnet\b|\breasoning\b|\bo[1-9](?![\w-]*mini)(?:-|\b)|gpt-5(?![\w-]*mini)|claude-(?![\w-]*haiku)/i;

/** Lightweight / fast / small signals in model id or label. */
const UTILITY_LIGHT_NAME =
  /\bflash\b|\bmini\b|\bhaiku\b|\blite\b|\bsmall\b|\btiny\b|\bnano\b|coder[-_]?next|deepseek[\w.-]*flash|qwen3[-_]?coder|gemma-?4/i;

export interface UtilityModelSelectionOptions {
  /** Main/default model used when no utility preference is enabled. */
  fallbackModelId?: string;
}

/** True when the model id/label looks suitable for short under-the-hood git/commit work. */
export function looksLikeUtilityModel(model: {
  id?: string;
  label?: string;
}): boolean {
  const id = String(model.id || "").trim();
  const label = String(model.label || "").trim();
  const text = `${id} ${label}`.trim();
  if (!text) {
    return false;
  }
  if (UTILITY_MODEL_PREFERENCE.includes(id)) {
    return true;
  }
  if (UTILITY_HEAVY_NAME.test(text)) {
    return false;
  }
  return UTILITY_LIGHT_NAME.test(text);
}

export type ModelFallbackErrorKind =
  | "transport"
  | "capability"
  | "context";

export interface ModelFallbackError {
  kind: ModelFallbackErrorKind;
  message: string;
}

export interface ModelFallbackEligibility {
  error: unknown;
  fallbackAlreadyAttempted?: boolean;
  hadFileEdits?: boolean;
  hadToolSideEffects?: boolean;
  hadAssistantOutput?: boolean;
  aborted?: boolean;
}

export interface FallbackModelSelectionOptions {
  failedModelId: string;
  visionRequired?: boolean;
  /** Ordered vision helper ids; empty → {@link VISION_MODEL_PREFERENCE}. */
  visionPreferenceIds?: readonly string[];
  minContextWindow?: number;
}

interface Candidate {
  model: AgentModel;
  index: number;
  fastPreferenceIndex: number;
  visionPreferenceIndex: number;
}

function normalizedIds(ids: readonly string[] | undefined): string[] {
  if (!ids) {
    return [];
  }
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    Math.floor(value) === value
    ? value
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function errorStatus(error: unknown): number | undefined {
  const value =
    error && typeof error === "object"
      ? (error as { status?: unknown }).status
      : undefined;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Classifies only explicit failures for which changing the model can be useful.
 * Authentication, configuration, generic 4xx, aborts, and arbitrary model
 * output are intentionally not eligible.
 */
export function classifyModelFallbackError(
  error: unknown
): ModelFallbackError | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const message = errorMessage(error).trim();
  if (!message || error.name === "AbortError" || /(?:^|\b)aborted\b/i.test(message)) {
    return undefined;
  }

  if (
    /context[_ -]?length|maximum context|context window|too many (?:input )?tokens|token limit|prompt (?:is )?too long|input.{0,30}(?:exceeds?|too large)/i.test(
      message
    )
  ) {
    return { kind: "context", message };
  }

  if (
    /(?:vision|image|multimodal).{0,80}(?:not supported|does not support|unsupported|not capable|cannot|can't)|(?:not supported|does not support|unsupported|not capable|cannot|can't).{0,80}(?:vision|images?|multimodal)|(?:tools?|function calling).{0,80}(?:not supported|does not support|unsupported|not available)|model.{0,50}(?:not found|does not exist|not available|unsupported)/i.test(
      message
    )
  ) {
    return { kind: "capability", message };
  }

  const status = errorStatus(error);
  const code = String(
    (error as Error & { code?: unknown }).code || ""
  ).toUpperCase();
  if (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status !== undefined && status >= 500 && status <= 599) ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "EAI_AGAIN",
      "ENETDOWN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code) ||
    /SSE stream interrupted|socket hang up|network error|fetch failed|timed? out|connection (?:reset|refused|closed)|API\s*5\d\d\b|internal server error/i.test(
      message
    )
  ) {
    return { kind: "transport", message };
  }

  return undefined;
}

/**
 * Pure safety gate for the single cross-model retry allowed per turn.
 * Transport failures before any side effects may restart once on another model;
 * mid-turn transport after tools is handled inside the agent loop instead.
 */
export function modelFallbackEligibility(
  input: ModelFallbackEligibility
): ModelFallbackError | undefined {
  if (
    input.fallbackAlreadyAttempted ||
    input.hadFileEdits ||
    input.hadToolSideEffects ||
    input.hadAssistantOutput ||
    input.aborted
  ) {
    return undefined;
  }
  return classifyModelFallbackError(input.error);
}

/** Selects an enabled, capability-compatible model other than the failed one. */
export function selectFallbackModel(
  models: readonly AgentModel[],
  options: FallbackModelSelectionOptions
): ModelRoutingResult | undefined {
  const failedModelId = String(options.failedModelId || "").trim();
  if (!failedModelId) {
    return undefined;
  }
  return routeModel(models, {
    hints: {
      fallback_after_failure: true,
      excluded_model_ids: [failedModelId],
      vision_required: options.visionRequired === true,
      ...(options.visionRequired === true
        ? {
            vision_preference: resolveVisionPreferenceIds(
              options.visionPreferenceIds
            ),
          }
        : {}),
      min_context_window: positiveInteger(options.minContextWindow),
    },
  });
}

/**
 * Prefer a known lightweight model for short git/commit work.
 * Order: exact {@link UTILITY_MODEL_PREFERENCE} → any enabled model that
 * {@link looksLikeUtilityModel} → fallback/main → first enabled.
 */
export function selectUtilityModel(
  models: readonly AgentModel[],
  options: UtilityModelSelectionOptions = {}
): ModelRoutingResult | undefined {
  const enabled: AgentModel[] = [];
  const byId = new Map<string, AgentModel>();
  for (const model of models) {
    const id = String(model.id || "").trim();
    if (!id || model.enabled === false || byId.has(id)) {
      continue;
    }
    const row = { ...model, id };
    enabled.push(row);
    byId.set(id, row);
  }
  if (!enabled.length) {
    return undefined;
  }

  for (const preferredId of UTILITY_MODEL_PREFERENCE) {
    const hit = byId.get(preferredId);
    if (hit) {
      return { modelId: hit.id, reason: "utility_preference" };
    }
  }

  const heuristic = enabled.find((model) => looksLikeUtilityModel(model));
  if (heuristic) {
    return { modelId: heuristic.id, reason: "utility_preference" };
  }

  const fallbackId = String(options.fallbackModelId || "").trim();
  if (fallbackId && byId.has(fallbackId)) {
    return { modelId: fallbackId, reason: "original_order" };
  }

  return { modelId: enabled[0].id, reason: "original_order" };
}

/**
 * Pure, deterministic model selection. The function only examines its
 * arguments and the local capability registry; it never reads settings or
 * performs discovery/network requests.
 */
export function routeModel(
  models: readonly AgentModel[],
  options: ModelRoutingOptions = {}
): ModelRoutingResult | undefined {
  const hints = options.hints ?? {};
  const excluded = new Set([
    ...normalizedIds(hints.excluded_model_ids),
    ...normalizedIds(hints.excluded_ids),
  ]);
  const minimumContext = positiveInteger(hints.min_context_window);
  const fastPreference =
    hints.fast_readonly === true
      ? normalizedIds(hints.fast_readonly_preference)
      : [];
  const fastRanks = new Map<string, number>();
  fastPreference.forEach((id, index) => {
    if (!fastRanks.has(id)) {
      fastRanks.set(id, index);
    }
  });
  const visionPreference =
    hints.vision_required === true && hints.vision_preference != null
      ? resolveVisionPreferenceIds(hints.vision_preference)
      : [];
  const visionRanks = new Map<string, number>();
  visionPreference.forEach((id, index) => {
    if (!visionRanks.has(id)) {
      visionRanks.set(id, index);
    }
  });

  const candidates: Candidate[] = [];
  models.forEach((model, index) => {
    const id = String(model.id || "").trim();
    if (!id || model.enabled === false || excluded.has(id)) {
      return;
    }

    const capabilities = resolveModelCapabilities(id, {
      contextWindow: model.contextWindow,
      supportsVision: model.supportsVision,
    });
    if (hints.vision_required === true && !capabilities.supportsVision) {
      return;
    }
    if (
      minimumContext !== undefined &&
      (capabilities.contextWindow === undefined ||
        capabilities.contextWindow < minimumContext)
    ) {
      return;
    }

    candidates.push({
      model: { ...model, id },
      index,
      fastPreferenceIndex: fastRanks.get(id) ?? Number.POSITIVE_INFINITY,
      visionPreferenceIndex: visionRanks.get(id) ?? Number.POSITIVE_INFINITY,
    });
  });

  const selectedId = String(options.userSelectedModelId || "").trim();
  if (selectedId) {
    const selected = candidates.find((candidate) => candidate.model.id === selectedId);
    if (selected) {
      return { modelId: selected.model.id, reason: "user_selected" };
    }
  }

  candidates.sort((a, b) => {
    if (a.visionPreferenceIndex !== b.visionPreferenceIndex) {
      return a.visionPreferenceIndex - b.visionPreferenceIndex;
    }
    const favoriteA = a.model.favorite === true ? 0 : 1;
    const favoriteB = b.model.favorite === true ? 0 : 1;
    if (favoriteA !== favoriteB) {
      return favoriteA - favoriteB;
    }
    if (a.fastPreferenceIndex !== b.fastPreferenceIndex) {
      return a.fastPreferenceIndex - b.fastPreferenceIndex;
    }
    return a.index - b.index;
  });

  const winner = candidates[0];
  if (!winner) {
    return undefined;
  }

  let reason: ModelRoutingReason = "original_order";
  if (hints.fallback_after_failure === true) {
    reason = "fallback_after_failure";
  } else if (Number.isFinite(winner.visionPreferenceIndex)) {
    reason = "vision_preference";
  } else if (Number.isFinite(winner.fastPreferenceIndex)) {
    reason = "fast_readonly_preference";
  } else if (winner.model.favorite === true) {
    reason = "favorite";
  } else if (
    hints.vision_required === true ||
    minimumContext !== undefined
  ) {
    reason = "capability_match";
  }

  return { modelId: winner.model.id, reason };
}

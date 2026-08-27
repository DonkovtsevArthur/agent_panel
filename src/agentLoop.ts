import {
  MessageAttachment,
} from "./attachments";
import { FileEditStat } from "./diffStats";
import {
  ChatMessage,
} from "./openaiTypes";
import { runClineAgentTurn } from "./clineRuntime";
import type * as vscode from "vscode";
import type { AgentStepEvent } from "./agentSteps";
import type { UiMessage } from "./sessionStore";

/**
 * Busy-line phase for Harbor hosts.
 * Cline runtime mostly emits `"cline"` (notice text); legacy phases remain for
 * host busy-line mapping (`modePhaseStatusLabel`) and older UI branches.
 */
export type AgentPhase =
  | "thinking"
  | "reading"
  | "listing"
  | "running"
  | "editing"
  | "verifying"
  | "done"
  /** Cline notices outside the tool lifecycle (generic running/completed omitted). */
  | "cline";

export type {
  AgentStepEvent,
  AgentStepKind,
  AgentToolStepStatus,
} from "./agentSteps";

export interface ContextUsageInfo {
  /** Занято токенов в окне (обычно prompt + completion последнего запроса). */
  used: number;
  promptTokens: number;
  completionTokens: number;
  /** Токены кешированного префикса, прочитанные за этот вызов (Anthropic cache_read / OpenAI cached_tokens). */
  cacheReadTokens?: number;
  /** Токены, записанные в кеш промпта за этот вызов (Anthropic cache_creation). */
  cacheWriteTokens?: number;
  /** Суммарные входные токены за все итерации сессии (для биллинга). */
  totalInputTokens?: number;
  /** Суммарные выходные токены за все итерации сессии (для биллинга). */
  totalOutputTokens?: number;
  /** Суммарные чтения кеша за все итерации сессии. */
  totalCacheReadTokens?: number;
  /** Суммарные записи кеша за все итерации сессии. */
  totalCacheWriteTokens?: number;
}

export interface AgentRunCallbacks {
  onPhase: (phase: AgentPhase, detail?: string) => void;
  onTool: (text: string) => void;
  /** Структурированный шаг хода (размышление / текст / жизненный цикл инструмента / компактификация / повтор). */
  onStep?: (event: AgentStepEvent) => void;
  onFileEdit: (edit: FileEditStat) => void;
  /** Поток текста ассистента (SSE). */
  onAssistantDelta?: (text: string) => void;
  /** Сбросить незавершённый stream-бабл (tools / nudge). */
  onAssistantStreamClear?: () => void;
  onAssistant: (
    text: string,
    meta?: { reasoning?: string }
  ) => void;
  /** Накопительный текст размышления модели (thinking / reasoning_content). */
  onReasoning?: (text: string) => void;
  /** Может быть async (SCM check) — ждём, иначе review теряется в finally. */
  onReview: (edits: FileEditStat[]) => void | Promise<void>;
  onUsage?: (usage: ContextUsageInfo) => void;
  /** Пользователь вставил URL Figma, но MCP не подключён. */
  onFigmaNeedsConnect?: () => void;
  /** Активная модель дополнения изменилась (напр. helper 5xx → выбранная). */
  onActiveModel?: (modelId: string) => void;
  /**
   * Turn timing milestones from the Cline runtime (e.g. time-to-first-token).
   * Fired once when the first streamed content arrives; host may stamp it
   * onto the runDuration message / persisted assistant message.
   */
  onTiming?: (info: { ttftMs: number }) => void;
}

/**
 * Все модели: ClineCore локальный session host (vendor/cline форк / @cline/sdk).
 * Колбэки Harbor UI без изменений.
 */
export async function runAgentTurn(options: {
  model: string;
  history: ChatMessage[];
  userText: string;
  attachments?: MessageAttachment[];
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  agentMode?: string;
  /** Уровень интеллекта Harbor UI → Cline reasoningEffort. */
  reasoningEffort?: string;
  callbacks: AgentRunCallbacks;
  /** Пути из предыдущего хода правок агента — отбрасываем «свои». */
  lastAgentEditedPaths?: string[];
  chatId?: string;
  resetSession?: boolean;
  /** Сохранённые UI-шаги (карточки инструментов) — используются для запуска новой Cline-сессии
   *  с компактным дайджестом действий инструментов, когда живая сессия не может быть переиспользована
   *  (вытеснена по простаиванию / перезагружена / изменился fingerprint). См. harborHistoryToClineMessages. */
  priorUiMessages?: UiMessage[];
}): Promise<ChatMessage[]> {
  return runClineAgentTurn(options);
}

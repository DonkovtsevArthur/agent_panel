/**
 * Структурированные шаги хода агента (последовательность в стиле Zed).
 */

export type AgentStepKind =
  | "thinking"
  | "text"
  | "tool"
  | "compaction"
  | "checkpoint"
  | "retry"
  | "todo";

export type AgentToolStepStatus = "queued" | "running" | "done" | "error";

export interface AgentStepEvent {
  stepId: string;
  kind: AgentStepKind;
  toolCallId?: string;
  name?: string;
  argsPreview?: string;
  status?: AgentToolStepStatus;
  resultPreview?: string;
  text?: string;
  attempt?: number;
  maxAttempts?: number;
  /**
   * Разобранные метрики по каждому инструменту для более информативных
   * однострочных подписей. Заполняются рантаймом из вывода инструмента
   * Cline в момент события `content_end`.
   */
  metrics?: ToolStepMetrics;
  /** Индекс запуска checkpoint Cline — используется при клике на карточку восстановления. */
  checkpointRunCount?: number;
  /** Пункты плана `update_todo`, отображаемые как карточка прогресса. */
  steps?: TodoStepItem[];
  /**
   * Полное время хода (мс): хост проставляет его на последний шаг с
   * инструментом при успешном завершении, сводка ленты показывает
   * «выполнено · N шагов · 18,6 с».
   */
  runDurationMs?: number;
  /**
   * Wall-clock duration of this tool call (ms), from content_start to
   * content_end. Shown on the tool card after the human label.
   */
  durationMs?: number;
  /**
   * Time-to-first-token (ms) for the turn: send → first streamed content.
   * Host stamps this on the last tool step / runDuration message.
   */
  ttftMs?: number;
}

export interface TodoStepItem {
  title: string;
  status: "pending" | "in_progress" | "done";
}

/**
 * Структурированные метрики, извлечённые из результата инструмента Cline,
 * чтобы webview мог выводить точные однострочные подписи (пути, число
 * совпадений, коды выхода и т.д.) без повторного разбора «непрозрачного»
 * JSON из `resultPreview`.
 */
export interface ToolStepMetrics {
  /** Разрешённые пути файлов для read_files / editor. */
  files?: string[];
  /** Всего строк прочитано по всем файлам (read_files). */
  lines?: number;
  /** Число найденных совпадений (search_codebase). */
  matches?: number;
  /** Код выхода процесса (run_commands); присутствует только при обнаруженной ошибке. */
  exitCode?: number;
  /** Первые строки stderr / хвост ошибки (run_commands при сбое). */
  errorOut?: string;
  /** editor: true, когда файл был создан, а не изменён. */
  created?: boolean;
}

let stepSeq = 0;

export function nextStepId(prefix = "step"): string {
  stepSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${stepSeq}`;
}

export function previewText(value: unknown, maxChars = 160): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function toolStepId(toolCallId: string): string {
  return `tool:${toolCallId || "unknown"}`;
}

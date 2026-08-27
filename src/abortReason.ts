/**
 * Harbor abort reason codes passed via `AbortController.abort(reason)` or set
 * by the inactivity watchdog. Shown in the finale bubble when a turn ends
 * without (or instead of) assistant text.
 */
import type { UiLanguage } from "./i18n";

export type HarborAbortInfo = {
  code: string;
  /** Extra context (e.g. last Cline event type before inactivity abort). */
  detail?: string;
  /** Minutes used by the inactivity watchdog (for the user-facing copy). */
  inactivityMinutes?: number;
};

export function reasonFromAbortSignal(
  signal: AbortSignal | undefined
): string {
  if (!signal?.aborted) {
    return "";
  }
  const raw = (signal as AbortSignal & { reason?: unknown }).reason;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (raw instanceof Error && raw.message.trim()) {
    // DOMException AbortError with the generic "This operation was aborted"
    // is not useful — treat as unknown.
    if (/operation was aborted|The user aborted/i.test(raw.message)) {
      return "";
    }
    return raw.message.trim();
  }
  return "";
}

export function harborAbortInfoFromCode(code: string): HarborAbortInfo {
  const inactivity = /^inactivity-timeout(?::(\d+))?$/i.exec(code);
  if (inactivity) {
    const minutes = Number(inactivity[1]);
    return {
      code: "inactivity-timeout",
      inactivityMinutes:
        Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
    };
  }
  return { code: code || "unknown" };
}

/** Localized placeholder when a turn is aborted. */
export function formatAbortedAssistantText(
  lang: UiLanguage,
  info: HarborAbortInfo | undefined
): string {
  const code = String(info?.code || "unknown").trim() || "unknown";
  const minutes =
    info?.inactivityMinutes && info.inactivityMinutes > 0
      ? info.inactivityMinutes
      : 5;
  const lastEvent = String(info?.detail || "").trim();

  if (lang === "ru") {
    switch (code) {
      case "user-stop":
        return "(остановлено: нажата кнопка Stop)";
      case "inactivity-timeout": {
        const after = lastEvent ? ` после «${lastEvent}»` : "";
        return `(остановлено: нет активности ${minutes} мин${after} — автопрерывание. Таймер не считает время tools; увеличьте agentPanel.sessions.inactivityTimeoutMinutes в Settings)`;
      }
      case "new-run":
        return "(остановлено: начат новый запрос в этом чате)";
      case "regenerate":
        return "(остановлено: ответ перезапущен)";
      case "edit-message":
        return "(остановлено: сообщение отредактировано)";
      case "delete-agent":
        return "(остановлено: чат или агент удалены)";
      case "workspace-reload":
        return "(остановлено: смена workspace)";
      case "discard":
        return "(остановлено: сессия сброшена)";
      default:
        return code !== "unknown" && code !== "user-abort" && code !== "aborted"
          ? `(остановлено: ${code})`
          : "(остановлено)";
    }
  }

  switch (code) {
    case "user-stop":
      return "(stopped: Stop button pressed)";
    case "inactivity-timeout": {
      const after = lastEvent ? ` after “${lastEvent}”` : "";
      return `(stopped: no activity for ${minutes} min${after} — auto-aborted. Timer pauses while tools run; increase agentPanel.sessions.inactivityTimeoutMinutes in Settings)`;
    }
    case "new-run":
      return "(stopped: a new request started in this chat)";
    case "regenerate":
      return "(stopped: response regenerated)";
    case "edit-message":
      return "(stopped: message was edited)";
    case "delete-agent":
      return "(stopped: chat or agent was deleted)";
    case "workspace-reload":
      return "(stopped: workspace changed)";
    case "discard":
      return "(stopped: session discarded)";
    default:
      return code !== "unknown" && code !== "user-abort" && code !== "aborted"
        ? `(stopped: ${code})`
        : "(stopped)";
  }
}

/** True when text is already a Harbor abort-notice bubble. */
export function isAbortNoticeText(text: string): boolean {
  return /^\((?:остановлено|stopped)(?::|\))/i.test(String(text || "").trim());
}

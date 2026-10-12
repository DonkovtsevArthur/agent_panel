/**
 * Harbor abort reason codes passed via `AbortController.abort(reason)`.
 * Shown in the finale bubble when a turn ends without (or instead of)
 * assistant text.
 */
import type { UiLanguage } from "./i18n";

export type HarborAbortInfo = {
  code: string;
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
  return { code: code || "unknown" };
}

/** Localized placeholder when a turn is aborted. */
export function formatAbortedAssistantText(
  lang: UiLanguage,
  info: HarborAbortInfo | undefined
): string {
  const code = String(info?.code || "unknown").trim() || "unknown";

  if (lang === "ru") {
    switch (code) {
      case "user-stop":
        return "(остановлено: нажата кнопка Stop)";
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

import type { ChatMessage } from "./openaiClient";
import type { FileEditStat } from "./diffStats";
import { sanitizeAssistantText } from "./sanitize";

export const EMPTY_ASSISTANT_PLACEHOLDER = "(пустой ответ)";

export const EMPTY_WRITE_USER_NUDGE =
  "You gathered context but made no file edits. Call write_file to apply the required changes now. Do not ask the user to paste code manually. After editing, reply with a short summary.";

export const EMPTY_TEXT_USER_NUDGE_WITH_EDITS =
  "Write a short Russian summary of the file changes you applied. Never return an empty message. Do not call tools.";

export const EMPTY_TEXT_USER_NUDGE_NO_EDITS =
  "Write a clear Russian reply for the user now: what you found and what still needs to be done. Never return an empty message. Do not call tools.";

export function looksLikeEmptyAssistantReply(text: string): boolean {
  const trimmed = String(text || "").trim();
  return !trimmed || trimmed === EMPTY_ASSISTANT_PLACEHOLDER;
}

export function summarizeEditsFallback(
  edits: Map<string, FileEditStat> | Iterable<FileEditStat>
): string {
  const files =
    edits instanceof Map
      ? [...edits.keys()]
      : [...edits].map((edit) => edit.path).filter(Boolean);
  if (!files.length) {
    return "";
  }
  const listed = files
    .slice(0, 8)
    .map((p) => `• ${p}`)
    .join("\n");
  const more =
    files.length > 8 ? `\n…и ещё ${files.length - 8} файл(ов)` : "";
  return `Готово. Изменения применены (${files.length}):\n${listed}${more}`;
}

export function summarizeToolActivity(messages: ChatMessage[]): string {
  const names: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tool_calls?.length) {
      continue;
    }
    for (const call of msg.tool_calls) {
      const name = call.function?.name;
      if (name) {
        names.push(name);
      }
    }
  }
  if (!names.length) {
    return "";
  }
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const lines = [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `• ${name} ×${count}` : `• ${name}`))
    .join("\n");
  return `Модель выполнила инструменты, но не вернула итоговый текст.\n\nЧто было сделано:\n${lines}\n\nПопробуйте повторить запрос или сменить модель.`;
}

/** When the model returns blank content, never show bare «(пустой ответ)». */
export function finalizeAssistantText(
  raw: string,
  edits: Map<string, FileEditStat>,
  maxChars: number,
  messages?: ChatMessage[]
): string {
  const trimmed = String(raw || "").trim();
  if (trimmed && trimmed !== EMPTY_ASSISTANT_PLACEHOLDER) {
    return sanitizeAssistantText(trimmed, { maxChars });
  }
  const fromEdits = summarizeEditsFallback(edits);
  if (fromEdits) {
    return sanitizeAssistantText(fromEdits, { maxChars });
  }
  const fromTools = messages ? summarizeToolActivity(messages) : "";
  if (fromTools) {
    return sanitizeAssistantText(fromTools, { maxChars });
  }
  return sanitizeAssistantText(
    "Не удалось получить текстовый ответ модели. Попробуйте повторить запрос или сменить модель.",
    { maxChars }
  );
}

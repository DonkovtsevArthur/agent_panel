import type { ChatTool } from "./openaiClient";

export interface ToolFilterContext {
  /** В user message (или приложенных ссылках) есть http(s) URL. */
  hasUrl: boolean;
}

/** Имя fetch/screenshot/open tool — кандидаты на фильтрацию по контексту. */
const URL_TOOL_NAMES = new Set([
  "fetch_url",
  "screenshot_url",
  "open_external",
]);

/**
 * Убирает tool-схемы, которые в этом ходе точно бесполезны:
 * без URL в сообщении fetch_url/screenshot_url/open_external — мёртвый груз.
 * MCP tools не трогаем: они и так приходят только от подключённых серверов.
 */
export function filterToolsForContext(
  tools: readonly ChatTool[],
  context: ToolFilterContext
): ChatTool[] {
  if (context.hasUrl) {
    return [...tools];
  }
  return tools.filter((tool) => !URL_TOOL_NAMES.has(tool.function.name));
}

/** Быстрый детектор URL в тексте/attachments для фильтра и подсказок. */
export function messageContainsUrl(text: string): boolean {
  return /https?:\/\/[^\s)\]>'"]+/i.test(String(text || ""));
}

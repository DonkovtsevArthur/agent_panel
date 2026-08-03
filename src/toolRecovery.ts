import type { ChatMessage } from "./openaiClient";
import { looksLikePlanGroundingToolResult } from "./contextBudget";

const DEFAULT_MAX_TOOL_CHARS = 2_500;
const AGGRESSIVE_MAX_TOOL_CHARS = 900;
const PROACTIVE_OLD_TOOL_CHARS = 3_500;

function previewText(value: unknown, max = 420): string {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}

/**
 * Ужимает JSON tool-payload, сохраняя валидный JSON (path + укороченный content).
 * Сырой slice ломал parse и в fallback сыпался весь `{"path":...}`.
 */
export function shrinkToolPayloadJson(
  raw: string,
  maxChars: number
): string | undefined {
  const limit = Math.max(400, Math.floor(maxChars));
  const text = String(raw || "");
  if (!text || text.length <= limit) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.content === "string" && parsed.content.length > 200) {
      const overhead = Math.max(
        120,
        text.length - parsed.content.length + 80
      );
      const contentBudget = Math.max(120, limit - overhead);
      parsed.content =
        parsed.content.slice(0, contentBudget) +
        "\n…[truncated for recovery after model error]";
      const next = JSON.stringify(parsed);
      if (next.length <= limit * 1.15) {
        return next;
      }
    }
    // Нет content или всё ещё огромный — оставляем только метаданные.
    const slim: Record<string, unknown> = {
      path: parsed.path,
      ok: parsed.ok,
      truncated: true,
      note: "tool payload compacted after model/server error",
    };
    if (typeof parsed.content === "string") {
      slim.content = previewText(parsed.content, Math.min(400, limit - 80));
    }
    if (Array.isArray(parsed.items)) {
      slim.items = parsed.items.slice(0, 30);
      slim.itemCount = parsed.items.length;
    }
    if (Array.isArray(parsed.matches)) {
      slim.matches = parsed.matches.slice(0, 12);
      slim.query = parsed.query;
    }
    if (typeof parsed.created === "boolean") {
      slim.created = parsed.created;
    }
    if (typeof parsed.added === "number") {
      slim.added = parsed.added;
    }
    if (typeof parsed.removed === "number") {
      slim.removed = parsed.removed;
    }
    // diagnostics в edit-результате раздувают следующий запрос — не тащим.
    if (typeof parsed.diagnosticErrorCount === "number") {
      slim.diagnosticErrorCount = parsed.diagnosticErrorCount;
    }
    return JSON.stringify(slim);
  } catch {
    return undefined;
  }
}

function shrinkOneToolContent(raw: string, maxChars: number): string {
  const limit = Math.max(400, Math.floor(maxChars));
  if (raw.length <= limit) {
    return raw;
  }
  if (
    raw.includes("[truncated for recovery after model error]") ||
    raw.includes("[older tool result compacted]")
  ) {
    return raw.length > limit
      ? raw.slice(0, limit) + "\n…[truncated for recovery after model error]"
      : raw;
  }
  const jsonShrunk = shrinkToolPayloadJson(raw, limit);
  if (jsonShrunk) {
    return jsonShrunk;
  }
  return raw.slice(0, limit) + "\n…[truncated for recovery after model error]";
}

/**
 * Ужимает содержимое tool-сообщений перед повторной попыткой после API 5xx:
 * большие read_file часто роняют gateway (500) на следующем раунде.
 */
export function shrinkToolMessageContents(
  messages: ChatMessage[],
  maxToolChars = DEFAULT_MAX_TOOL_CHARS,
  options?: { preserveToolPrefixes?: string[] }
): boolean {
  const limit = Math.max(400, Math.floor(maxToolChars));
  const preserve = options?.preserveToolPrefixes ?? [];
  let changed = false;
  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    if (typeof message.content !== "string") {
      continue;
    }
    if (message.content.length <= limit) {
      continue;
    }
    if (preserve.length && message.name && preserve.some((p) => message.name!.startsWith(p))) {
      continue;
    }
    const next = shrinkOneToolContent(message.content, limit);
    if (next !== message.content) {
      message.content = next;
      changed = true;
    }
  }
  return changed;
}

/**
 * Проактивно ужимает все tool-результаты кроме последних keepRecent полных:
 * DeepSeek/flash/Qwen gateway часто падает на 10× read_file до явного 5xx-recovery.
 */
export function shrinkOlderToolResults(
  messages: ChatMessage[],
  options?: {
    keepRecent?: number;
    maxOldChars?: number;
    /** Tool name prefixes to skip (preserve full payload). Used in
     * Plan/Ask mode to keep Figma MCP payloads intact — they are the
     * primary source for the plan and must not be shrunk to 2.5 KB. */
    preserveToolPrefixes?: string[];
    /** Extra per-message preserve (e.g. Plan grounding read_file). */
    preserveToolResult?: (message: ChatMessage) => boolean;
  }
): boolean {
  const keepRecent = Math.max(0, Math.floor(options?.keepRecent ?? 4));
  const maxOldChars = Math.max(
    400,
    Math.floor(options?.maxOldChars ?? PROACTIVE_OLD_TOOL_CHARS)
  );
  const preserve = options?.preserveToolPrefixes ?? [];
  const preserveExtra = options?.preserveToolResult;
  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool") {
      toolIndexes.push(i);
    }
  }
  if (toolIndexes.length <= keepRecent) {
    return false;
  }
  const shrinkUntil = toolIndexes.length - keepRecent;
  let changed = false;
  for (let i = 0; i < shrinkUntil; i++) {
    const message = messages[toolIndexes[i]];
    if (typeof message.content !== "string") {
      continue;
    }
    if (message.content.length <= maxOldChars) {
      continue;
    }
    if (preserve.length && message.name && preserve.some((p) => message.name!.startsWith(p))) {
      continue;
    }
    if (preserveExtra?.(message)) {
      continue;
    }
    const next = shrinkOneToolContent(message.content, maxOldChars).replace(
      "[truncated for recovery after model error]",
      "[older tool result compacted]"
    );
    if (next !== message.content) {
      message.content = next;
      changed = true;
    }
  }
  return changed;
}

/**
 * Kimi на корпоративном gateway: перед каждым chat/completions ужимаем
 * старые read_file и аргументы завершённых write_file.
 * В readonly (Plan/Ask) сохраняем Figma MCP payloads целиком — они
 * primary source для плана, урезание до 2.5 КБ убивает точные ColumnDef.
 * Также pin'им grounding reads (paths / routes / shared UI / pages index).
 */
export function prepareKimiGatewayMessages(
  messages: ChatMessage[],
  options?: { readonly?: boolean }
): boolean {
  const readonly = Boolean(options?.readonly);
  const preserve = readonly ? ["mcp__figma__"] : [];
  // Plan/Ask: keep Figma + grounding reads; shrink other older explore so the
  // gateway does not 400 on JSON parse. keepRecent/maxOldChars softer than
  // before so early page/tab evidence survives longer.
  const older = shrinkOlderToolResults(messages, {
    keepRecent: readonly ? 4 : 3,
    maxOldChars: readonly ? 2_800 : 2_500,
    preserveToolPrefixes: preserve,
    ...(readonly
      ? { preserveToolResult: looksLikePlanGroundingToolResult }
      : {}),
  });
  const edits = compactCompletedEditToolArguments(messages);
  const reasoning = dropOlderReasoningBlocks(messages, {
    keepRecent: readonly ? 1 : 2,
  });
  return older || edits || reasoning;
}

/**
 * Zed-like `drop_reasoning_blocks`: reasoning_content на старых assistant-
 * раундах (tool-call и text) — мёртвый груз. API Kimi требует лишь наличие
 * (непустого) reasoning_content для tool-call раундов; `toApiMessages`
 * подставит placeholder « » автоматически. Оставляем полным reasoning
 * только у `keepRecent` последних раундов — модель видит свежую мысль.
 */
export function dropOlderReasoningBlocks(
  messages: ChatMessage[],
  options?: { keepRecent?: number }
): boolean {
  const keepRecent = Math.max(1, Math.floor(options?.keepRecent ?? 2));
  const reasoningIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") {
      continue;
    }
    const r =
      typeof m.reasoning_content === "string" ? m.reasoning_content : "";
    if (!r.trim()) {
      continue;
    }
    reasoningIdx.push(i);
  }
  if (reasoningIdx.length <= keepRecent) {
    return false;
  }
  let changed = false;
  const dropUntil = reasoningIdx.length - keepRecent;
  for (let i = 0; i < dropUntil; i++) {
    const m = messages[reasoningIdx[i]];
    if (m.reasoning_content && m.reasoning_content.trim()) {
      m.reasoning_content = undefined;
      changed = true;
    }
  }
  return changed;
}

/**
 * DeepSeek / Haiku / flash / mini: даже один свежий read_file (package.json)
 * часто даёт gateway 500 на следующем completion. Ужимаем старые и капим все
 * tool-payloads, включая последний.
 */
export function prepareFragileGatewayMessages(
  messages: ChatMessage[]
): boolean {
  const older = shrinkOlderToolResults(messages, {
    keepRecent: 2,
    maxOldChars: 2_000,
  });
  const all = shrinkToolMessageContents(messages, 2_800);
  const edits = compactCompletedEditToolArguments(messages);
  return older || all || edits;
}

/**
 * Перед forced empty-finale reply — жёстче: иначе 500 на «функционал недоступен».
 * В readonly (Plan/Ask) сохраняем Figma MCP payloads — план строится
 * из них, урезание до 1.2 КБ убивает структуру таблицы.
 */
export function prepareKimiEmptyFinaleMessages(
  messages: ChatMessage[],
  options?: { readonly?: boolean }
): boolean {
  const preserve = options?.readonly ? ["mcp__figma__"] : [];
  const older = shrinkOlderToolResults(messages, {
    keepRecent: 2,
    maxOldChars: 1_200,
    preserveToolPrefixes: preserve,
  });
  const all = shrinkToolMessageContents(messages, 1_500, {
    preserveToolPrefixes: preserve,
  });
  const edits = compactCompletedEditToolArguments(messages);
  return older || all || edits;
}

/** Модели, у которых gateway чаще роняет огромный tool-контекст. */
export function modelNeedsAggressiveToolBudget(modelId: string): boolean {
  // Qwen — main-like API (без aggressive shrink). gpt-4.1 — отдельный gateway path.
  // Kimi — prepareKimiGatewayMessages; DeepSeek/Haiku — prepareFragileGatewayMessages.
  return /deepseek|flash|mini|haiku|lite|small|gemma/i.test(
    String(modelId || "")
  );
}

/**
 * Верхняя граница soft-target даже при заявленном 1M context window:
 * иначе applyContextBudget считает «ещё влезает» и не ужимает tools.
 */
export const AGGRESSIVE_SOFT_TARGET_CAP_TOKENS = 28_000;

export function resolveToolSoftTargetTokens(options: {
  hardBudget: number;
  modelId: string;
}): number {
  const hard = Math.max(1, Math.floor(options.hardBudget));
  const aggressive = modelNeedsAggressiveToolBudget(options.modelId);
  const ratio = aggressive ? 0.38 : 0.55;
  const raw = Math.max(2_048, Math.floor(hard * ratio));
  const cap = aggressive
    ? AGGRESSIVE_SOFT_TARGET_CAP_TOKENS
    : Math.min(hard, 64_000);
  return Math.min(raw, cap, hard);
}

/**
 * После успешного write_file/search_replace полный `content`/`new_string` остаётся
 * в assistant.tool_calls[].arguments и на следующем раунде снова уходит в API —
 * у Qwen/DeepSeek это часто даёт gateway 500. Ужимаем уже выполненные вызовы.
 */
export function compactCompletedEditToolArguments(
  messages: ChatMessage[]
): boolean {
  let changed = false;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      continue;
    }
    const completedIds = new Set<string>();
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j];
      if (next.role === "assistant" || next.role === "user") {
        break;
      }
      if (next.role === "tool" && next.tool_call_id) {
        completedIds.add(next.tool_call_id);
      }
    }
    for (const call of message.tool_calls) {
      if (!completedIds.has(call.id)) {
        continue;
      }
      const name = String(call.function?.name || "");
      if (
        name !== "write_file" &&
        name !== "search_replace" &&
        name !== "run_command"
      ) {
        continue;
      }
      const raw = String(call.function?.arguments || "");
      if (raw.length < 600) {
        continue;
      }
      if (raw.includes('"compacted":true') || raw.includes('"compacted": true')) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const relativePath = String(
          parsed.relativePath || parsed.path || ""
        ).trim();
        if (name === "write_file") {
          const contentLen =
            typeof parsed.content === "string" ? parsed.content.length : 0;
          call.function.arguments = JSON.stringify({
            compacted: true,
            relativePath: relativePath || undefined,
            contentChars: contentLen,
            note: "write_file content omitted after tool completed",
          });
          changed = true;
          continue;
        }
        if (name === "search_replace") {
          const oldLen =
            typeof parsed.old_string === "string"
              ? parsed.old_string.length
              : 0;
          const newLen =
            typeof parsed.new_string === "string"
              ? parsed.new_string.length
              : 0;
          call.function.arguments = JSON.stringify({
            compacted: true,
            relativePath: relativePath || undefined,
            replace_all: parsed.replace_all === true,
            oldChars: oldLen,
            newChars: newLen,
            note: "search_replace strings omitted after tool completed",
          });
          changed = true;
          continue;
        }
        if (name === "run_command") {
          const command = String(parsed.command || "").slice(0, 240);
          call.function.arguments = JSON.stringify({
            compacted: true,
            command,
            originalChars: raw.length,
            note: "run_command arguments truncated after tool completed",
          });
          changed = true;
        }
      } catch {
        call.function.arguments = JSON.stringify({
          compacted: true,
          tool: name,
          originalChars: raw.length,
          note: "tool arguments omitted after tool completed",
        });
        changed = true;
      }
    }
  }
  return changed;
}

/** Пути успешно записанных файлов из tool-результатов текущего хода. */
export function listSuccessfulEditPathsFromMessages(
  messages: Array<{ role?: string; name?: string; content?: unknown }>
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    const name = String(message.name || "");
    if (name !== "write_file" && name !== "search_replace") {
      continue;
    }
    const raw = String(message.content || "");
    try {
      const parsed = JSON.parse(raw) as {
        ok?: unknown;
        unchanged?: unknown;
        path?: unknown;
      };
      if (parsed.ok === false || parsed.unchanged) {
        continue;
      }
      const pathValue = String(parsed.path || "").trim();
      if (!pathValue || seen.has(pathValue)) {
        continue;
      }
      seen.add(pathValue);
      paths.push(pathValue);
    } catch {
      // ignore
    }
  }
  return paths;
}

/** Достаёт path/content из целого или обрезанного JSON tool-результата. */
export function extractReadFileFromToolPayload(raw: string): {
  path?: string;
  content?: string;
} {
  const text = String(raw || "");
  try {
    const parsed = JSON.parse(text) as { path?: unknown; content?: unknown };
    return {
      path: typeof parsed.path === "string" ? parsed.path : undefined,
      content: typeof parsed.content === "string" ? parsed.content : undefined,
    };
  } catch {
    const path = text.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
    const marker = text.match(/"content"\s*:\s*"/);
    let content: string | undefined;
    if (marker && marker.index !== undefined) {
      const start = marker.index + marker[0].length;
      let out = "";
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\\" && i + 1 < text.length) {
          const next = text[i + 1];
          if (next === "n") {
            out += "\n";
          } else if (next === "t") {
            out += "\t";
          } else if (next === '"') {
            out += '"';
          } else if (next === "\\") {
            out += "\\";
          } else {
            out += next;
          }
          i += 1;
          continue;
        }
        if (ch === '"') {
          break;
        }
        out += ch;
      }
      if (out.trim()) {
        content = out;
      }
    }
    return {
      ...(path ? { path: path.replace(/\\"/g, '"') } : {}),
      ...(content ? { content } : {}),
    };
  }
}

/**
 * Если модель недоступна после tool-раундов — отдать пользователю уже
 * собранные факты вместо пустой красной ошибки.
 */
export function formatToolEvidenceFallbackAnswer(
  messages: Array<{ role?: string; name?: string; content?: unknown }>,
  userText: string
): string | undefined {
  const reads: Array<{ path: string; preview: string }> = [];
  const searches: string[] = [];
  const edits: string[] = [];
  const lists: string[] = [];

  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    const name = String(message.name || "");
    const raw = String(message.content || "");

    if (name === "read_file") {
      const extracted = extractReadFileFromToolPayload(raw);
      const pathValue = String(extracted.path || "").trim();
      if (!pathValue) {
        continue;
      }
      reads.push({
        path: pathValue,
        preview: previewText(extracted.content || "(содержимое урезано)"),
      });
      continue;
    }

    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }

    if (name === "write_file" || name === "search_replace") {
      const pathValue = String(
        (parsed?.path as string) ||
          raw.match(/"path"\s*:\s*"([^"]+)"/)?.[1] ||
          ""
      ).trim();
      if (!pathValue) {
        continue;
      }
      if (parsed && parsed.ok === false) {
        edits.push(`${pathValue} — ошибка: ${previewText(parsed.error, 120)}`);
      } else {
        edits.push(
          `${pathValue}${parsed?.created ? " (создан)" : ""} · ${name}`
        );
      }
      continue;
    }

    if (name === "list_files") {
      if (parsed) {
        const pathValue = String(parsed.path || ".").trim() || ".";
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        const names = items
          .slice(0, 12)
          .map((item) => {
            if (item && typeof item === "object" && "name" in item) {
              return String((item as { name?: unknown }).name || "");
            }
            return "";
          })
          .filter(Boolean);
        lists.push(
          names.length
            ? `${pathValue}: ${names.join(", ")}${
                items.length > names.length ? "…" : ""
              }`
            : `${pathValue} (${items.length} записей)`
        );
      }
      continue;
    }

    if (name === "search_text") {
      if (parsed) {
        const query = String(parsed.query || "").trim();
        const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
        if (!matches.length) {
          searches.push(
            query ? `"${query}" → совпадений нет` : "поиск без совпадений"
          );
        } else {
          const hits = matches
            .slice(0, 5)
            .map((item) => {
              const row = item as { path?: unknown; line?: unknown };
              return `${String(row.path || "?")}:${Number(row.line) || "?"}`;
            })
            .join(", ");
          searches.push(query ? `"${query}" → ${hits}` : hits);
        }
      } else if (raw.trim()) {
        const queryGuess = raw.match(/"query"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
        searches.push(
          queryGuess
            ? `"${queryGuess}" → результат поиска ужат/повреждён`
            : "search_text → результат ужат/повреждён"
        );
      }
    }
  }

  if (!reads.length && !searches.length && !edits.length && !lists.length) {
    return undefined;
  }

  const ask = String(userText || "").trim().slice(0, 240);
  const parts: string[] = [
    "Модель временно недоступна (ошибка сервера API). Ниже — что уже удалось сделать в этом ходе:",
  ];
  if (ask) {
    parts.push("", `Запрос: ${ask}`);
  }
  if (edits.length) {
    parts.push("", "Изменённые файлы:", ...edits.map((line) => `- ${line}`));
  }
  if (searches.length) {
    parts.push("", "Поиск:", ...searches.map((line) => `- ${line}`));
  }
  if (lists.length) {
    parts.push("", "Каталоги:", ...lists.map((line) => `- ${line}`));
  }
  if (reads.length) {
    // Если уже были правки — только пути, без дампа README/package.json в чат.
    if (edits.length) {
      parts.push(
        "",
        "Также читали:",
        ...reads.slice(0, 8).map((file) => `- \`${file.path}\``)
      );
    } else {
      parts.push("", "Прочитанные файлы:");
      for (const file of reads.slice(0, 6)) {
        parts.push(
          "",
          `### \`${file.path}\``,
          "```",
          file.preview || "(пусто)",
          "```"
        );
      }
    }
  }
  parts.push(
    "",
    "Когда сервер модели восстановится — отправьте запрос ещё раз для полного ответа."
  );
  return parts.join("\n");
}

export { AGGRESSIVE_MAX_TOOL_CHARS, DEFAULT_MAX_TOOL_CHARS };

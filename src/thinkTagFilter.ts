/**
 * Фильтр thinking-блоков, которые платформа отдаёт инлайн в `content`
 * (а не через отдельное поле `reasoning_content`).
 *
 * Поддерживаемые пары тегов:
 *  - `</think>` … `</think>`  (DeepSeek-R1 native)
 *  - `<thought>` … `</thought>` (платформа «ДаВинчи»)
 *
 * Без фильтра этот блок протекает в видимый ответ (marked рендерит raw HTML,
 * тег виден как текст). Логика — leading-only: срезается только блок в самом
 * начале ответа, чтобы не повредить теги внутри code-блоков ответа.
 *
 * Чистые функции без vscode — тестируются в Node.
 */

export const THINK_TAG_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["<think>", "</think>"],
  ["<thought>", "</thought>"],
];

const OPEN_TAGS = THINK_TAG_PAIRS.map((p) => p[0]);
const CLOSE_TAGS = THINK_TAG_PAIRS.map((p) => p[1]);

interface OpenMatch {
  openTag: string;
  closeTag: string;
  index: number;
}

/** Найти открывающий тег любой из пар, начинающийся в позиции `from` (с ведущими пробелами при from === 0). */
function findOpenTag(buf: string, from: number): OpenMatch | null {
  let i = from;
  if (from === 0) {
    while (i < buf.length && /\s/.test(buf[i])) {
      i += 1;
    }
  }
  for (const [openTag, closeTag] of THINK_TAG_PAIRS) {
    if (buf.startsWith(openTag, i)) {
      return { openTag, closeTag, index: i };
    }
  }
  return null;
}

interface CloseMatch {
  index: number;
  length: number;
}

/**
 * Найти ведущий закрывающий тег любой из пар в позиции `from` (с ведущими
 * пробелами при from === 0). Используется для срезки stray-закрывающего тега,
 * который платформа оставляет в `content`, когда reasoning уже ушёл в
 * `reasoning_content` (открывающего тега в `content` нет).
 */
function findLeadingCloseTag(buf: string, from: number): CloseMatch | null {
  let i = from;
  if (from === 0) {
    while (i < buf.length && /\s/.test(buf[i])) {
      i += 1;
    }
  }
  for (const closeTag of CLOSE_TAGS) {
    if (buf.startsWith(closeTag, i)) {
      return { index: i, length: closeTag.length };
    }
  }
  return null;
}

/**
 * Безопасная позиция обрезки конца буфера: если хвост buf (с позиции `from`)
 * является префиксом любого из `tags`, оставляем этот хвост в буфере, чтобы
 * тег не разрезался между чанками.
 */
function safeCutForPrefixes(buf: string, tags: string[], from: number): number {
  const tail = buf.slice(from);
  for (let len = Math.min(tail.length, Math.max(...tags.map((t) => t.length - 1))); len >= 1; len -= 1) {
    if (tags.some((tag) => tag.startsWith(tail.slice(0, len)))) {
      return buf.length - len;
    }
  }
  return buf.length;
}

export interface StrippedBlock {
  text: string;
  reasoning: string | null;
}

/**
 * Одноразовая (не-стриминг) вырезка ведущего thinking-блока.
 * Если блока нет — возвращает текст как есть. Теги внутри кода (не в начале) не трогает.
 *
 * Дополнительно срезает stray-закрывающий тег (`</welcome>` / `</thought>`) в самом
 * начале, если открывающего тега не было: платформа могла уже забрать reasoning в
 * `reasoning_content` и оставить в `content` только огрызок-закрытие.
 */
export function stripThinkTagBlock(text: string): StrippedBlock {
  const raw = String(text ?? "");
  const open = findOpenTag(raw, 0);
  if (!open) {
    const close = findLeadingCloseTag(raw, 0);
    if (close) {
      const rest = raw.slice(close.index + close.length);
      return { text: rest.replace(/^\s+/, ""), reasoning: null };
    }
    return { text: raw, reasoning: null };
  }
  const afterOpen = raw.slice(open.index + open.openTag.length);
  const closeIdx = afterOpen.indexOf(open.closeTag);
  if (closeIdx === -1) {
    return { text: "", reasoning: afterOpen.trim() || null };
  }
  const reasoning = afterOpen.slice(0, closeIdx);
  const rest = afterOpen.slice(closeIdx + open.closeTag.length);
  return {
    text: rest.replace(/^\s+/, ""),
    reasoning: reasoning.trim() || null,
  };
}

export interface ThinkTagStreamFilter {
  /**
   * Пропустить очередной chunk `delta.content`. Возвращает порции для видимого
   * текста и для reasoning. Теги, разрезанные между чанками, буферизуются.
   */
  consume(chunk: string): { visible: string; reasoning: string };
}

/**
 * Стриминг-aware фильтр: ведёт фазовый автомат по чанкам.
 *   phase 0 — ищем открывающий тег любой пары (или сразу видим текст);
 *              также срезаем stray-закрывающий тег в самом начале, если
 *              открывающего не было (reasoning уже ушёл в reasoning_content);
 *   phase 1 — внутри thinking, ищем конкретный закрывающий тег пары;
 *   phase 2 — thinking закрыт, дальше всё видимое без парсинга (чтобы не
 *             срезать теги внутри code-блоков ответа).
 */
export function createThinkTagStreamFilter(): ThinkTagStreamFilter {
  let phase: 0 | 1 | 2 = 0;
  let pending = "";
  let closeTag = "";
  let emittedAny = false;

  function consume(rawChunk: string): { visible: string; reasoning: string } {
    const buf = pending + rawChunk;
    pending = "";
    let visible = "";
    let reasoning = "";
    let i = 0;

    while (i < buf.length) {
      if (phase === 0) {
        const open = findOpenTag(buf, i);
        if (open) {
          visible += buf.slice(i, open.index);
          i = open.index + open.openTag.length;
          closeTag = open.closeTag;
          phase = 1;
          emittedAny = true;
          continue;
        }
        // Stray-закрывающий тег в самом начале (до любого видимого текста):
        // платформа забрала reasoning в reasoning_content, в content остался
        // только огрызок-закрытие. Срезаем его, остаёмся в phase 0.
        if (!emittedAny) {
          const close = findLeadingCloseTag(buf, i);
          if (close) {
            i = close.index + close.length;
            continue;
          }
        }
        const allTags = emittedAny ? OPEN_TAGS : [...OPEN_TAGS, ...CLOSE_TAGS];
        const safeEnd = safeCutForPrefixes(buf, allTags, i);
        visible += buf.slice(i, safeEnd);
        if (safeEnd > i) {
          emittedAny = true;
        }
        pending = buf.slice(safeEnd);
        break;
      } else if (phase === 1) {
        const closeIdx = buf.indexOf(closeTag, i);
        if (closeIdx === -1) {
          const safeEnd = safeCutForPrefixes(buf, [closeTag], i);
          reasoning += buf.slice(i, safeEnd);
          pending = buf.slice(safeEnd);
          break;
        }
        reasoning += buf.slice(i, closeIdx);
        i = closeIdx + closeTag.length;
        phase = 2;
      } else {
        visible += buf.slice(i);
        i = buf.length;
      }
    }

    return { visible, reasoning };
  }

  return { consume };
}

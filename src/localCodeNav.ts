import * as path from "path";
import {
  escapeRegExp,
  extractCodeIdentifiers,
  isLikelyDefinitionLine,
  searchTextFiles,
  type SearchTextMatch,
} from "./searchText";
import { isIgnoredWorkspacePath } from "./workspaceIgnore";

export type LocalCodeNavKind = "definition" | "usages" | "search";

export type LocalCodeNavTarget = {
  query: string;
  /** Prefer definition-shaped lines when kind is definition. */
  kind: LocalCodeNavKind;
  /** Drop matches from this relative path (e.g. the file itself for usages). */
  excludePath?: string;
};

function normalizeText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** «Этот/текущий файл/компонент» — брать цель из активного редактора. */
export function refersToActiveEditorSymbol(text: string): boolean {
  const value = normalizeText(text);
  if (!value) {
    return false;
  }
  return (
    /(?:этот|эта|это|данный|данная|текущ\w*|this|current)\s+(?:компонент|файл|модул\w*|класс|функци\w*|хук|символ|component|file|module|class|function|hook|symbol)/i.test(
      value
    ) ||
    /(?:компонент|файл|модул\w*|класс|функци\w*|хук|component|file)\s+(?:этот|эта|это|this)/i.test(
      value
    ) ||
    /(?:в этом|из этого|про этот|про эту|про это)\s+(?:файл|компонент|модул)/i.test(
      value
    )
  );
}

/** Короткий follow-up «хочу найти» после того, как в чате уже назвали символ. */
export function looksLikeFindFollowUp(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 64) {
    return false;
  }
  const value = normalizeText(raw);
  return (
    /^(хочу найти|хочу найти его|хочу найти ее|хочу найти её|хочу найти это|найди|найти|поищи|где он|где она|где это|find it|find|locate)\.?$/i.test(
      value
    ) || /^(хочу|нужно|надо)\s+найти\.?$/i.test(value)
  );
}

/** Любой явный intent «найти / где лежит», не обязательно с именем в том же сообщении. */
export function looksLikeFindIntent(text: string): boolean {
  const value = normalizeText(text);
  if (!value) {
    return false;
  }
  if (looksLikeFindFollowUp(text)) {
    return true;
  }
  return (
    /(?:^|[\s,.:;])(?:найди|найти|поищи|find|locate|search)(?:\s|$|,|:)/i.test(
      value
    ) ||
    /(?:хочу|нужно|надо|нужно было|помоги)\s+(?:найти|поискать|find|locate)/i.test(
      value
    ) ||
    /где\s+(?:лежит|находится|определяется|объявлен)/i.test(value)
  );
}

/** «компонент Modal» / «component Foo» — имя сразу после слова. */
export function extractComponentLikeNames(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of String(text || "").matchAll(
    /(?:компонент(?:а|у|ом|е)?|component|класс(?:а|у|ом|е)?|class|функци(?:я|и|ю|ей)|function|хук|hook)\s*[`'"]?([A-Z][A-Za-z0-9_$]{1,63})/g
  )) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}

export function looksLikeFindUsagesRequest(text: string): boolean {
  const value = normalizeText(text);
  if (!value) {
    return false;
  }
  return (
    /(?:где|куда|кто|в каких).{0,80}(?:использу|вызыв|импорт|подключ)/i.test(
      value
    ) ||
    /(?:найди|найти|поищи|покажи).{0,80}(?:использу|использован|вызов|импорт|usages?|imports?|callers?)/i.test(
      value
    ) ||
    /(?:who|where|find|show|list).{0,80}(?:uses?|usage|imports?|imported|callers?|references?)/i.test(
      value
    ) ||
    /\b(?:usages?|references?|callers?)\b/i.test(value) ||
    /в каких\s+компонент/.test(value)
  );
}

export function looksLikeLocateDefinitionRequest(text: string): boolean {
  const value = normalizeText(text);
  if (!value) {
    return false;
  }
  const hasId =
    extractCodeIdentifiers(text).length > 0 ||
    extractComponentLikeNames(text).length > 0 ||
    refersToActiveEditorSymbol(text);
  if (!hasId) {
    return false;
  }
  if (
    /^(найди|найти|поищи|find|locate|search)(?:\s|,|:|$)/i.test(value) ||
    /^где\s+(?:определяется|объявлен|лежит|находится|в коде)\b/i.test(value) ||
    looksLikeFindIntent(text)
  ) {
    return true;
  }
  return (
    /(?:найди|найти|поищи|где|find|locate|search).{0,60}(?:определ|объявлен|defin|declar|implement)/i.test(
      value
    ) ||
    /где\s+(?:определяется|объявлен[аоы]?|лежит|находится)\b/i.test(value) ||
    /(?:find|locate|where).{0,60}(?:defined|definition|declared|declaration)\b/i.test(
      value
    )
  );
}

/**
 * Любой «найди / где / find» по коду, который можно закрыть локальным grep
 * без LLM (иначе Severstal 500 после search_text).
 * @param historyHints — имена из недавнего чата (для «хочу найти» после Modal).
 */
export function looksLikeLocalCodeNavRequest(
  text: string,
  historyHints: string[] = []
): boolean {
  if (looksLikeFindUsagesRequest(text) || looksLikeLocateDefinitionRequest(text)) {
    return true;
  }
  const value = normalizeText(text);
  if (!value) {
    return false;
  }
  const hasTarget =
    extractCodeIdentifiers(text).length > 0 ||
    extractComponentLikeNames(text).length > 0 ||
    refersToActiveEditorSymbol(text);

  // «хочу найти» после того, как в чате уже светился Modal / путь.
  if (looksLikeFindFollowUp(text) && historyHints.length > 0) {
    return true;
  }

  // Любой «найти / где» — локальный grep или честный «укажите имя».
  // Не отдаём модели «разведал код, что править?».
  if (looksLikeFindIntent(text)) {
    return true;
  }

  if (!hasTarget) {
    return false;
  }
  return (
    /^(найди|найти|поищи|find|locate|search|где)(?:\s|,|:|$)/i.test(value) ||
    /(?:найди|найти|поищи|где|find|locate|search|where).{0,80}(?:файл|компонент|модул|класс|функци|хук|символ|component|file|module|class|function|hook)/i.test(
      value
    )
  );
}

function stemFromFilePath(relativePath: string): string {
  const base = path.posix.basename(relativePath.replace(/\\/g, "/"));
  return base
    .replace(/\.(test|spec)\./i, ".")
    .replace(/\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte)$/i, "")
    .replace(/\.(module|styles?)$/i, "");
}

/** Effector / framework noise — не цель для «найди компонент». */
const HISTORY_IDENTIFIER_NOISE = new Set([
  "createEvent",
  "createStore",
  "createEffect",
  "createDomain",
  "createApi",
  "sample",
  "combine",
  "attach",
  "restore",
  "split",
  "merge",
  "guard",
  "forward",
  "useUnit",
  "useStore",
  "useEvent",
  "useGate",
  "React",
  "Fragment",
  "Props",
  "Children",
]);

export function isNoiseHistoryIdentifier(id: string): boolean {
  const value = String(id || "").trim();
  if (!value || value.length < 2) {
    return true;
  }
  if (value.startsWith("$")) {
    return true;
  }
  if (HISTORY_IDENTIFIER_NOISE.has(value)) {
    return true;
  }
  // Флаги/сторы вроде isOpenModalEdit без $ — тоже не UI-компонент.
  if (
    /^(is|has|should|can|was|did)[A-Z]/.test(value) &&
    /Modal|Open|Close|Visible|Shown/i.test(value)
  ) {
    return true;
  }
  return false;
}

/** PascalCase UI-символ: Modal, WorkStatus. */
export function isLikelyComponentIdentifier(id: string): boolean {
  const value = String(id || "").trim();
  if (isNoiseHistoryIdentifier(value)) {
    return false;
  }
  return /^[A-Z][A-Za-z0-9]*$/.test(value) && value.length >= 2;
}

export function userTextPrefersComponentHints(text: string): boolean {
  const value = normalizeText(text);
  return (
    /компонент|component/.test(value) ||
    refersToActiveEditorSymbol(text) ||
    looksLikeFindUsagesRequest(text)
  );
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text || "")
          : ""
      )
      .join("\n");
  }
  return "";
}

/**
 * Идентификаторы из недавней истории чата — для «этот компонент»,
 * когда имя было в прошлом сообщении, а в текущем только «этот».
 *
 * При preferComponents свежий шум ($isOpen…, createEvent) не вытесняет
 * более ранний Modal: собираем кандидатов и ранжируем.
 */
export function extractRecentCodeIdentifiersFromHistory(
  messages: Array<{ role?: string; content?: unknown }>,
  options?: {
    limitMessages?: number;
    maxIdentifiers?: number;
    preferComponents?: boolean;
  }
): string[] {
  const preferComponents = options?.preferComponents === true;
  const limitMessages = Math.max(
    1,
    options?.limitMessages ?? (preferComponents ? 24 : 12)
  );
  const maxIdentifiers = Math.max(
    1,
    options?.maxIdentifiers ?? (preferComponents ? 2 : 3)
  );

  type Candidate = { id: string; score: number; recency: number };
  const byId = new Map<string, Candidate>();
  let recency = 0;

  const consider = (id: string, score: number) => {
    const value = String(id || "").trim();
    if (!value || value.length < 2) {
      return;
    }
    if (preferComponents && isNoiseHistoryIdentifier(value)) {
      return;
    }
    if (!preferComponents && isNoiseHistoryIdentifier(value) && value.startsWith("$")) {
      // $store почти никогда не нужен как цель locate
      return;
    }
    const existing = byId.get(value);
    if (!existing || score > existing.score) {
      byId.set(value, { id: value, score, recency });
    } else if (existing && score === existing.score && recency < existing.recency) {
      existing.recency = recency;
    }
  };

  const slice = messages.slice(-limitMessages);
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const message = slice[i];
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const text = messageText(message.content);
    if (!text.trim()) {
      continue;
    }
    recency += 1;

    for (const id of extractComponentLikeNames(text)) {
      consider(id, 100);
    }
    for (const match of text.matchAll(/`([^`\n]{2,80})`/g)) {
      const inner = match[1].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(inner)) {
        consider(
          inner,
          isLikelyComponentIdentifier(inner) ? 90 : 40
        );
      }
    }
    for (const match of text.matchAll(
      /(?:^|[\s"'`(])((?:[\w.@-]+\/)+[\w.@-]+\.(tsx|jsx|vue|svelte))\b/gi
    )) {
      const stem = stemFromFilePath(match[1]);
      if (stem) {
        consider(stem, 85);
      }
    }
    for (const match of text.matchAll(
      /(?:^|[\s"'`(])((?:[\w.@-]+\/)+[\w.@-]+\.(?:ts|js|mjs|cjs))\b/gi
    )) {
      const stem = stemFromFilePath(match[1]);
      if (stem) {
        consider(stem, preferComponents ? 25 : 55);
      }
    }
    for (const id of extractCodeIdentifiers(text)) {
      let score = 30;
      if (isLikelyComponentIdentifier(id)) {
        score = 70;
      } else if (isNoiseHistoryIdentifier(id)) {
        score = preferComponents ? -100 : 10;
      } else if (id.startsWith("$") || /^(create|use)[A-Z]/.test(id)) {
        score = preferComponents ? -100 : 15;
      }
      if (score > 0) {
        consider(id, score);
      }
    }
  }

  return [...byId.values()]
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.recency - b.recency || a.id.localeCompare(b.id)
    )
    .slice(0, maxIdentifiers)
    .map((item) => item.id);
}

/** Цели поиска: идентификаторы из текста, активный файл и/или история. */
export function resolveLocalCodeNavTargets(
  userText: string,
  activeFilePath?: string,
  historyHints: string[] = []
): LocalCodeNavTarget[] {
  const usage = looksLikeFindUsagesRequest(userText);
  const prefersComponent = userTextPrefersComponentHints(userText);
  const definition =
    (looksLikeLocateDefinitionRequest(userText) ||
      looksLikeFindIntent(userText) ||
      looksLikeFindFollowUp(userText)) &&
    !usage;
  const kind: LocalCodeNavKind = usage
    ? "usages"
    : definition
      ? "definition"
      : "search";

  const targets: LocalCodeNavTarget[] = [];
  const seen = new Set<string>();
  const push = (query: string, excludePath?: string) => {
    const q = String(query || "").trim();
    if (!q || seen.has(q)) {
      return;
    }
    if (prefersComponent && isNoiseHistoryIdentifier(q)) {
      return;
    }
    seen.add(q);
    targets.push({
      query: q,
      kind,
      ...(excludePath ? { excludePath } : {}),
    });
  };

  for (const id of extractCodeIdentifiers(userText)) {
    push(id, usage ? activeFilePath : undefined);
  }
  for (const id of extractComponentLikeNames(userText)) {
    push(id, usage ? activeFilePath : undefined);
  }

  if (refersToActiveEditorSymbol(userText) && activeFilePath) {
    const rel = activeFilePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const stem = stemFromFilePath(rel);
    if (stem) {
      push(stem, usage ? rel : undefined);
    }
    const noExt = rel.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/i, "");
    if (noExt && noExt !== stem) {
      push(noExt, usage ? rel : undefined);
    }
  }

  // «Этот компонент» / «хочу найти» без имени в текущем сообщении —
  // берём символы из недавней истории (Modal, WorkStatus, …).
  if (
    !targets.length ||
    refersToActiveEditorSymbol(userText) ||
    looksLikeFindFollowUp(userText)
  ) {
    const hints = prefersComponent
      ? historyHints.filter((id) => isLikelyComponentIdentifier(id))
      : historyHints;
    const ordered = prefersComponent
      ? [
          ...hints.filter((id) => isLikelyComponentIdentifier(id)),
          ...hints.filter((id) => !isLikelyComponentIdentifier(id)),
        ]
      : hints;
    for (const id of ordered) {
      push(id, usage ? activeFilePath : undefined);
      if (prefersComponent && targets.length >= 1) {
        break;
      }
    }
  }

  return targets;
}

/** package-lock / README и т.п. — не места использования компонента. */
export function isNoiseSearchPath(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(p);
  if (
    base === "package-lock.json" ||
    base === "yarn.lock" ||
    base === "pnpm-lock.yaml" ||
    base === "npm-shrinkwrap.json" ||
    base === "readme.md" ||
    base === "changelog.md" ||
    base === "license" ||
    base === "license.md" ||
    base === "agents.md" ||
    base === ".cursorrules"
  ) {
    return true;
  }
  if (isIgnoredWorkspacePath(p)) {
    return true;
  }
  return false;
}

/** Точное вхождение идентификатора, не UnsavedChangesLeaveModal для Modal. */
export function isWholeIdentifierMatch(line: string, identifier: string): boolean {
  const id = String(identifier || "").trim();
  if (!id) {
    return false;
  }
  const escaped = escapeRegExp(id);
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`).test(
    String(line || "")
  );
}

/**
 * Строка похожа на использование React/UI-компонента:
 * <Modal, import { Modal }, from '...Modal'.
 */
export function isLikelyComponentUsageLine(
  line: string,
  identifier: string
): boolean {
  const text = String(line || "");
  const id = String(identifier || "").trim();
  if (!id || !isWholeIdentifierMatch(text, id)) {
    return false;
  }
  const escaped = escapeRegExp(id);
  return new RegExp(
    `<\\s*/?\\s*${escaped}\\b` +
      `|\\bimport\\b[^\\n;]*\\b${escaped}\\b` +
      `|\\bexport\\b[^\\n;]*\\b${escaped}\\b` +
      `|from\\s+['"][^'"]*\\b${escaped}\\b[^'"]*['"]` +
      `|require\\(\\s*['"][^'"]*\\b${escaped}\\b[^'"]*['"]\\s*\\)`,
    "i"
  ).test(text);
}

function wholeIdentifierRegex(identifier: string): string {
  const escaped = escapeRegExp(identifier);
  return `(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`;
}

function filterMatches(
  matches: SearchTextMatch[],
  target: LocalCodeNavTarget,
  options?: { preferComponentUsages?: boolean }
): SearchTextMatch[] {
  let list = matches.filter((match) => !isNoiseSearchPath(match.path));
  if (target.excludePath) {
    const excluded = target.excludePath.replace(/\\/g, "/");
    list = list.filter(
      (match) => match.path.replace(/\\/g, "/") !== excluded
    );
  }

  const whole = list.filter((match) =>
    isWholeIdentifierMatch(match.text, target.query)
  );
  if (whole.length) {
    list = whole;
  }

  if (target.kind === "definition") {
    const defs = list.filter((match) =>
      isLikelyDefinitionLine(match.text, target.query)
    );
    return defs.length ? defs : list;
  }

  if (target.kind === "usages") {
    const nonDefs = list.filter(
      (match) => !isLikelyDefinitionLine(match.text, target.query)
    );
    list = nonDefs.length ? nonDefs : list;
    if (options?.preferComponentUsages || isLikelyComponentIdentifier(target.query)) {
      const componentUsages = list.filter((match) =>
        isLikelyComponentUsageLine(match.text, target.query)
      );
      if (componentUsages.length) {
        return componentUsages;
      }
      // Нет JSX/import — не сваливаемся в $isOpenModalEdit / package.json.
      const codeFiles = list.filter((match) =>
        /\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte)$/i.test(match.path)
      );
      return codeFiles;
    }
    return list;
  }

  if (options?.preferComponentUsages || isLikelyComponentIdentifier(target.query)) {
    const componentUsages = list.filter((match) =>
      isLikelyComponentUsageLine(match.text, target.query)
    );
    if (componentUsages.length) {
      return componentUsages;
    }
  }
  return list;
}

function kindLabel(kind: LocalCodeNavKind, hadSpecialized: boolean): string {
  if (kind === "definition") {
    return hadSpecialized ? "определение" : "совпадения";
  }
  if (kind === "usages") {
    return hadSpecialized ? "использования" : "совпадения";
  }
  return "совпадения";
}

/**
 * Локальный ответ на find/locate/usages без LLM.
 * undefined только если целей нет (нечего искать).
 */
export function formatLocalCodeNavAnswer(
  rootPath: string,
  userText: string,
  options?: {
    activeFilePath?: string;
    historyHints?: string[];
    maxPerTarget?: number;
  }
): string | undefined {
  const root = String(rootPath || "").trim();
  if (!root) {
    return undefined;
  }
  const targets = resolveLocalCodeNavTargets(
    userText,
    options?.activeFilePath,
    options?.historyHints || []
  );
  if (!targets.length) {
    return undefined;
  }

  const preferComponentUsages =
    userTextPrefersComponentHints(userText) ||
    /компонент|component/i.test(userText);
  const maxPerTarget = Math.max(1, options?.maxPerTarget ?? 12);
  const sections: string[] = [];

  for (const target of targets) {
    const componentQuery =
      preferComponentUsages || isLikelyComponentIdentifier(target.query);
    const found = searchTextFiles({
      rootPath: root,
      query: wholeIdentifierRegex(target.query),
      regex: true,
      maxResults: Math.max(maxPerTarget * 5, 40),
      ...(componentQuery || target.kind === "usages"
        ? { include: "*.{ts,tsx,jsx,js,mjs,cjs,vue,svelte}" }
        : {}),
    });
    if (!found.matches.length) {
      sections.push(
        componentQuery
          ? `**${target.query}**: импортов / \`<${target.query}\` в коде не найдено.`
          : `**${target.query}**: совпадений нет.`
      );
      continue;
    }
    const picks = filterMatches(found.matches, target, {
      preferComponentUsages: componentQuery,
    }).slice(0, maxPerTarget);
    const specialized =
      target.kind === "usages"
        ? picks.filter((match) =>
            isLikelyComponentUsageLine(match.text, target.query)
          )
        : target.kind === "definition"
          ? picks.filter((match) =>
              isLikelyDefinitionLine(match.text, target.query)
            )
          : [];
    if (!picks.length) {
      sections.push(
        componentQuery
          ? `**${target.query}**: импортов / \`<${target.query}\` в коде не найдено.`
          : `**${target.query}**: совпадений нет.`
      );
      continue;
    }
    sections.push(
      [
        `**${target.query}** (${kindLabel(
          target.kind,
          specialized.length > 0 || target.kind === "usages"
        )}):`,
        ...picks.map(
          (match) =>
            `- \`${match.path}:${match.line}\` — ${match.text.trim().slice(0, 140)}`
        ),
      ].join("\n")
    );
  }

  return sections.join("\n\n");
}

/** Совместимость со старым API locate-only. */
export function formatLocateDefinitionAnswer(
  rootPath: string,
  userText: string,
  options?: { maxPerIdentifier?: number }
): string | undefined {
  return formatLocalCodeNavAnswer(rootPath, userText, {
    maxPerTarget: options?.maxPerIdentifier,
  });
}

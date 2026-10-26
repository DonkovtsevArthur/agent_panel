/**
 * Незакоммиченные изменения агентов для списка агентов («+87 −3» в строке).
 *
 * Общий модуль для VS Code (`agentPanelProvider.ts`) и JetBrains-сайдкара
 * (`headlessPanelHost.ts`). Без top-level `vscode`, чтобы тесты могли его
 * импортировать.
 *
 * Источник — review-карточки чата агента: в `lines` лежат хэши строк, которые
 * агент сам добавил / удалил за ход (дельта `git diff HEAD` начала и конца
 * хода). Цифры — пересечение этих строк с живым `git diff HEAD`: закоммиченное
 * выпадает само, чужие правки в тех же файлах не считаются. Один проход git на
 * все агенты сразу (объединение путей), а не по агенту.
 */

import type { AgentsStoreV2, UiMessage } from "./sessionStore";

export interface AgentPendingDiff {
  added: number;
  removed: number;
  files: number;
}

/** Мультимножество строк: хэш строки → сколько раз она встречается. */
export type LineBag = Record<string, number>;

/** Добавленные (`a`) и удалённые (`r`) строки файла относительно HEAD. */
export interface FileLineSets {
  a: LineBag;
  r: LineBag;
}

/** Путь (относительно корня workspace) → строки. */
export type LineSetsByPath = Map<string, FileLineSets>;

/** Сериализуемый вид для review-карточки (`{ files, showScm, lines }`). */
export type AgentLineEdits = Record<string, FileLineSets>;

export type LiveLinesResolver = (
  paths: string[],
  cwd?: string
) => Promise<LineSetsByPath>;

/** Сколько разных строк на файл храним в карточке — защита от огромных ходов. */
const MAX_LINES_PER_FILE = 5000;

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** FNV-1a 32 bit → base36: коротко и достаточно для сравнения строк. */
export function hashLine(line: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < line.length; i++) {
    h ^= line.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function bump(bag: LineBag, line: string): void {
  const k = hashLine(line.replace(/\r$/, ""));
  bag[k] = (bag[k] || 0) + 1;
}

function emptySets(): FileLineSets {
  return { a: {}, r: {} };
}

/** Весь текст как добавленные строки (untracked файл: в HEAD его нет). */
export function lineSetsFromText(text: string): FileLineSets {
  const sets = emptySets();
  if (!text) {
    return sets;
  }
  const lines = text.split(/\n/);
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  for (const line of lines) {
    bump(sets.a, line);
  }
  return sets;
}

/**
 * Разбор `git diff --no-renames -U0` в строки по файлам. Пути — из
 * `diff --git a/x b/x` (относительно корня репозитория, как и numstat).
 */
export function parseUnifiedDiffLines(stdout: string): LineSetsByPath {
  const out: LineSetsByPath = new Map();
  let cur: FileLineSets | undefined;
  let inHunk = false;
  for (const raw of String(stdout || "").split(/\n/)) {
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(raw);
      const rel = m ? normPath(m[2]) : "";
      cur = rel ? out.get(rel) || emptySets() : undefined;
      if (cur && rel) {
        out.set(rel, cur);
      }
      continue;
    }
    if (!cur) {
      continue;
    }
    if (raw.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (raw.startsWith("+")) {
      bump(cur.a, raw.slice(1));
    } else if (raw.startsWith("-")) {
      bump(cur.r, raw.slice(1));
    }
  }
  return out;
}

function bagMinus(end: LineBag, start: LineBag | undefined): LineBag {
  const out: LineBag = {};
  let n = 0;
  for (const [k, v] of Object.entries(end)) {
    const d = v - ((start && start[k]) || 0);
    if (d > 0) {
      out[k] = d;
      if (++n >= MAX_LINES_PER_FILE) {
        break;
      }
    }
  }
  return out;
}

function bagSize(bag: LineBag): number {
  let n = 0;
  for (const v of Object.values(bag)) {
    n += v;
  }
  return n;
}

/**
 * Что агент сам сделал за ход: строки, которых не было в diff HEAD в начале
 * хода, но есть в конце. Файлы без своих строк не попадают.
 */
export function agentLineDelta(
  start: LineSetsByPath,
  end: LineSetsByPath,
  paths: Iterable<string>
): AgentLineEdits {
  const out: AgentLineEdits = {};
  for (const p of new Set([...paths].map(normPath).filter(Boolean))) {
    const e = end.get(p);
    if (!e) {
      continue;
    }
    const s = start.get(p);
    const a = bagMinus(e.a, s?.a);
    const r = bagMinus(e.r, s?.r);
    if (bagSize(a) || bagSize(r)) {
      out[p] = { a, r };
    }
  }
  return out;
}

function addBag(into: LineBag, from: unknown): void {
  if (!from || typeof from !== "object") {
    return;
  }
  for (const [k, v] of Object.entries(from as Record<string, unknown>)) {
    const n = Number(v);
    if (n > 0) {
      into[k] = (into[k] || 0) + n;
    }
  }
}

/**
 * `lines` из текста review-карточки — чтобы перезапись карточки (обновление
 * SCM-кнопок) не теряла строки агента.
 */
export function reviewLinesOf(text: string | undefined): AgentLineEdits | undefined {
  try {
    const data = JSON.parse(String(text || "")) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const lines = (data as { lines?: unknown }).lines;
      if (lines && typeof lines === "object" && !Array.isArray(lines)) {
        return lines as AgentLineEdits;
      }
    }
  } catch {
    // не JSON — старая карточка
  }
  return undefined;
}

/** Строки агента за все ходы чата — сумма `lines` из review-карточек. */
export function agentLineEditsForChat(
  uiMessages: UiMessage[] | undefined
): LineSetsByPath {
  const out: LineSetsByPath = new Map();
  for (const msg of Array.isArray(uiMessages) ? uiMessages : []) {
    if (!msg || msg.role !== "review") {
      continue;
    }
    let lines: unknown;
    try {
      const data = JSON.parse(String(msg.text || "")) as unknown;
      lines =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as { lines?: unknown }).lines
          : undefined;
    } catch {
      continue;
    }
    if (!lines || typeof lines !== "object") {
      continue;
    }
    for (const [rawPath, sets] of Object.entries(
      lines as Record<string, { a?: unknown; r?: unknown }>
    )) {
      const p = normPath(rawPath);
      if (!p || !sets) {
        continue;
      }
      const cur = out.get(p) || emptySets();
      addBag(cur.a, sets.a);
      addBag(cur.r, sets.r);
      out.set(p, cur);
    }
  }
  return out;
}

function intersectCount(mine: LineBag, live: LineBag | undefined): number {
  if (!live) {
    return 0;
  }
  let n = 0;
  for (const [k, v] of Object.entries(mine)) {
    n += Math.min(v, live[k] || 0);
  }
  return n;
}

/** Пути из review-сообщений чата (в порядке появления, без дублей). */
export function reviewSeedPathsForChat(
  uiMessages: UiMessage[] | undefined
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const msg of Array.isArray(uiMessages) ? uiMessages : []) {
    if (!msg || msg.role !== "review") {
      continue;
    }
    let files: Array<{ path?: unknown }> = [];
    try {
      const data = JSON.parse(String(msg.text || "")) as unknown;
      if (Array.isArray(data)) {
        files = data as Array<{ path?: unknown }>;
      } else if (
        data &&
        typeof data === "object" &&
        Array.isArray((data as { files?: unknown }).files)
      ) {
        files = (data as { files: Array<{ path?: unknown }> }).files;
      }
    } catch {
      continue;
    }
    for (const f of files) {
      const p = typeof f?.path === "string" ? f.path.trim() : "";
      if (p && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * Свести живой git к агентам: у каждого считаются только его строки, которые
 * ещё есть в diff HEAD. Чистая функция: `live` — результат резолвера на
 * объединении путей всех агентов.
 */
export function pendingDiffByAgent(
  editsByAgent: Map<string, LineSetsByPath>,
  live: LineSetsByPath
): Map<string, AgentPendingDiff> {
  const liveNorm: LineSetsByPath = new Map();
  for (const [p, sets] of live) {
    liveNorm.set(normPath(p), sets);
  }
  const out = new Map<string, AgentPendingDiff>();
  for (const [agentId, edits] of editsByAgent) {
    let added = 0;
    let removed = 0;
    let files = 0;
    for (const [p, mine] of edits) {
      const now = liveNorm.get(normPath(p));
      if (!now) {
        continue;
      }
      const a = intersectCount(mine.a, now.a);
      const r = intersectCount(mine.r, now.r);
      if (!a && !r) {
        continue;
      }
      files += 1;
      added += a;
      removed += r;
    }
    if (files > 0) {
      out.set(agentId, { added, removed, files });
    }
  }
  return out;
}

function sameDiffMaps(
  a: Map<string, AgentPendingDiff>,
  b: Map<string, AgentPendingDiff>
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [id, x] of a) {
    const y = b.get(id);
    if (
      !y ||
      y.added !== x.added ||
      y.removed !== x.removed ||
      y.files !== x.files
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Кэш «агент → незакоммиченные изменения» с отложенным обновлением.
 * `postAgentsList` читает кэш синхронно; хост зовёт `schedule()` на смене
 * git / конце хода / коммите, а `scheduleIfStale()` — при каждой отрисовке
 * списка (дешёвая проверка возраста кэша). `onChange` — только если цифры
 * реально поменялись, чтобы не зациклить postAgentsList.
 */
export class AgentPendingDiffTracker {
  private cache = new Map<string, AgentPendingDiff>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private rerun = false;
  private lastRefreshAt = 0;
  private disposed = false;

  constructor(
    private readonly getStore: () => AgentsStoreV2,
    private readonly onChange: () => void,
    private readonly resolve: LiveLinesResolver,
    private readonly getCwd: () => string | undefined = () => undefined
  ) {}

  get(agentId: string): AgentPendingDiff | undefined {
    return this.cache.get(agentId);
  }

  schedule(delayMs = 600): void {
    if (this.disposed) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delayMs);
  }

  scheduleIfStale(maxAgeMs = 30_000): void {
    if (this.timer || this.running) {
      return;
    }
    if (Date.now() - this.lastRefreshAt >= maxAgeMs) {
      this.schedule(400);
    }
  }

  async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      const store = this.getStore();
      const editsByAgent = new Map<string, LineSetsByPath>();
      const union = new Set<string>();
      for (const agent of store.agents) {
        if (agent.archivedAt) {
          continue;
        }
        const chat = store.chats[agent.chatId];
        if (!chat || chat.archivedAt) {
          continue;
        }
        const edits = agentLineEditsForChat(chat.uiMessages);
        if (!edits.size) {
          continue;
        }
        editsByAgent.set(agent.id, edits);
        for (const p of edits.keys()) {
          union.add(p);
        }
      }
      let live: LineSetsByPath = new Map();
      if (union.size) {
        try {
          live = await this.resolve([...union], this.getCwd());
        } catch {
          live = new Map();
        }
      }
      const next = pendingDiffByAgent(editsByAgent, live);
      this.lastRefreshAt = Date.now();
      if (!sameDiffMaps(this.cache, next)) {
        this.cache = next;
        if (!this.disposed) {
          this.onChange();
        }
      }
    } finally {
      this.running = false;
      if (this.rerun && !this.disposed) {
        this.rerun = false;
        this.schedule(200);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/**
 * Незакоммиченные изменения агентов для списка агентов («+87 −3» в строке).
 *
 * Общий модуль для VS Code (`agentPanelProvider.ts`) и JetBrains-сайдкара
 * (`headlessPanelHost.ts`). Без top-level `vscode`, чтобы тесты могли его
 * импортировать.
 *
 * Источник путей — review-карточки активного чата агента (что агент правил).
 * Цифры — живой git: из этих путей остаются только те, что ещё dirty. Один
 * проход git на все агенты сразу (объединение путей), а не по агенту.
 */

import type { FileEditStat } from "./diffStats";
import type { AgentsStoreV2, UiMessage } from "./sessionStore";

export interface AgentPendingDiff {
  added: number;
  removed: number;
  files: number;
}

export type RemainingFilesResolver = (
  paths: string[],
  cwd?: string
) => Promise<FileEditStat[]>;

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
 * Свести живые git-цифры по путям к агентам. Чистая функция: `remaining` —
 * результат резолвера на объединении путей всех агентов.
 */
export function pendingDiffByAgent(
  seedsByAgent: Map<string, string[]>,
  remaining: FileEditStat[]
): Map<string, AgentPendingDiff> {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const stats = new Map<string, FileEditStat>();
  for (const f of remaining) {
    if (f && typeof f.path === "string") {
      stats.set(norm(f.path), f);
    }
  }
  const out = new Map<string, AgentPendingDiff>();
  for (const [agentId, seeds] of seedsByAgent) {
    let added = 0;
    let removed = 0;
    let files = 0;
    for (const seed of seeds) {
      const hit = stats.get(norm(seed));
      if (!hit) {
        continue;
      }
      files += 1;
      added += Math.max(0, Number(hit.added) || 0);
      removed += Math.max(0, Number(hit.removed) || 0);
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
    private readonly resolve: RemainingFilesResolver,
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
      const seedsByAgent = new Map<string, string[]>();
      const union = new Set<string>();
      for (const agent of store.agents) {
        if (agent.archivedAt) {
          continue;
        }
        const chat = store.chats[agent.chatId];
        if (!chat || chat.archivedAt) {
          continue;
        }
        const seeds = reviewSeedPathsForChat(chat.uiMessages);
        if (!seeds.length) {
          continue;
        }
        seedsByAgent.set(agent.id, seeds);
        for (const s of seeds) {
          union.add(s);
        }
      }
      let remaining: FileEditStat[] = [];
      if (union.size) {
        try {
          remaining = await this.resolve([...union], this.getCwd());
        } catch {
          remaining = [];
        }
      }
      const next = pendingDiffByAgent(seedsByAgent, remaining);
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

/**
 * Tab accept-rate stats + recent accept/dismiss feedback for ranking and FOCUS.
 * Persisted in extension globalState (lightweight, cross-workspace).
 */

export type TabAcceptStat = {
  /** Normalized preview key (first ~48 chars of refined fill). */
  key: string;
  count: number;
  at: number;
};

export type TabRecentFill = {
  text: string;
  language: string;
  accepted: boolean;
  at: number;
};

const STATS_KEY = "agentPanel.tabAutocomplete.acceptStats.v1";
const MAX_STATS = 80;
const MAX_RECENT = 8;

export type TabStatsStore = {
  getStats(language: string): TabAcceptStat[];
  recordAccept(language: string, text: string): void;
  recordDismiss(language: string, text: string): void;
  recentFills(language?: string): TabRecentFill[];
  rankAlternatives(language: string, texts: string[]): string[];
};

type Persisted = {
  byLang: Record<string, TabAcceptStat[]>;
  recent: TabRecentFill[];
};

function normalizeKey(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function load(raw: unknown): Persisted {
  if (!raw || typeof raw !== "object") {
    return { byLang: {}, recent: [] };
  }
  const row = raw as { byLang?: unknown; recent?: unknown };
  const byLang: Record<string, TabAcceptStat[]> = {};
  if (row.byLang && typeof row.byLang === "object") {
    for (const [lang, list] of Object.entries(
      row.byLang as Record<string, unknown>
    )) {
      if (!Array.isArray(list)) {
        continue;
      }
      byLang[lang] = list
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const s = item as TabAcceptStat;
          return {
            key: String(s.key || ""),
            count: Math.max(0, Number(s.count) || 0),
            at: Number(s.at) || 0,
          };
        })
        .filter((s) => s.key);
    }
  }
  const recent: TabRecentFill[] = Array.isArray(row.recent)
    ? row.recent
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const r = item as TabRecentFill;
          return {
            text: String(r.text || "").slice(0, 120),
            language: String(r.language || ""),
            accepted: r.accepted === true,
            at: Number(r.at) || 0,
          };
        })
        .filter((r) => r.text)
    : [];
  return { byLang, recent };
}

type Memento = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
};

export function createTabStatsStore(memento: Memento): TabStatsStore {
  let data = load(memento.get(STATS_KEY));

  const persist = () => {
    void memento.update(STATS_KEY, data);
  };

  const bump = (language: string, text: string, delta: number) => {
    const lang = String(language || "plaintext") || "plaintext";
    const key = normalizeKey(text);
    if (!key) {
      return;
    }
    const list = data.byLang[lang] ? [...data.byLang[lang]] : [];
    const idx = list.findIndex((s) => s.key === key);
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        count: Math.max(0, list[idx].count + delta),
        at: Date.now(),
      };
    } else if (delta > 0) {
      list.push({ key, count: delta, at: Date.now() });
    }
    list.sort((a, b) => b.count - a.count || b.at - a.at);
    data.byLang[lang] = list.slice(0, MAX_STATS);
    persist();
  };

  const pushRecent = (
    language: string,
    text: string,
    accepted: boolean
  ) => {
    const entry: TabRecentFill = {
      text: String(text || "").slice(0, 120),
      language: String(language || ""),
      accepted,
      at: Date.now(),
    };
    if (!entry.text.trim()) {
      return;
    }
    data.recent = [entry, ...data.recent.filter((r) => r.text !== entry.text)].slice(
      0,
      MAX_RECENT
    );
    persist();
  };

  return {
    getStats(language: string) {
      return data.byLang[language] || [];
    },
    recordAccept(language, text) {
      bump(language, text, 1);
      pushRecent(language, text, true);
    },
    recordDismiss(language, text) {
      bump(language, text, -1);
      pushRecent(language, text, false);
    },
    recentFills(language) {
      if (!language) {
        return data.recent.slice();
      }
      return data.recent.filter((r) => !r.language || r.language === language);
    },
    rankAlternatives(language, texts) {
      const stats = data.byLang[language] || [];
      const score = (t: string) => {
        const key = normalizeKey(t);
        const hit = stats.find((s) => s.key === key || key.startsWith(s.key) || s.key.startsWith(key));
        return hit?.count || 0;
      };
      return [...texts].sort((a, b) => score(b) - score(a));
    },
  };
}

/** Short FOCUS lines from recent accepts/dismisses. */
export function formatRecentFillFeedback(fills: TabRecentFill[]): string {
  if (!fills.length) {
    return "";
  }
  const lines = ["- Recent Tab outcomes (prefer accepted patterns, avoid dismissed):"];
  for (const f of fills.slice(0, 5)) {
    const tag = f.accepted ? "accepted" : "dismissed";
    const preview = f.text.replace(/\n/g, "⏎").slice(0, 60);
    lines.push(`  - ${tag}: \`${preview}\``);
  }
  return lines.join("\n");
}

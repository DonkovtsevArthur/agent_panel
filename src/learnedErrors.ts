/**
 * Workspace memory of short “learned errors” — plan-quality + verification
 * lessons persisted under `.harbor/learned-errors.md` and injected as a system
 * hint on later turns. vscode-free core; fs helpers for load/save.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { PlanQualityReason } from "./planQuality";

export const LEARNED_ERRORS_RELATIVE_PATH = ".harbor/learned-errors.md";
export const LEARNED_ERRORS_CHAR_CAP = 3_000;
export const MAX_LEARNED_ERROR_ENTRIES = 20;

export type LearnedErrorKind = "plan_quality" | "verification";

export type LearnedErrorEntry = {
  /** Stable dedup key: kind + fingerprint. */
  key: string;
  kind: LearnedErrorKind;
  /** One-line lesson for the model (English, like other system hints). */
  lesson: string;
};

const PLAN_QUALITY_LESSONS: Record<PlanQualityReason, string> = {
  plan_file_write:
    "Plan: emit a FULL <proposed_plan> card — do not write_file PLAN.md.",
  prose_already_exists:
    "Plan: do not conclude «already exists» in prose; inventory blocks with reuse path or gap inside <proposed_plan>.",
  unfixed_fields:
    "Plan: never ship «fields not fixed» — call Figma/screenshot_url or request_user_input, then concrete labels.",
  missing_grounded_path:
    "Plan: every Step must name a concrete workspace path (reuse or new-by-pattern of a path you read).",
  missing_steps:
    "Plan: <proposed_plan> needs real Steps mapped to mockup/checklist items.",
  missing_figma_tools:
    "Plan with Figma URL: call get_design_context AND get_screenshot (or get_figma_data) before exploring the repo.",
  page_to_tab:
    "Plan: Goal = the requested page/route (Figma title), not a tab/вкладка from a similar page.",
  page_to_similar:
    "Plan: do not substitute a different existing page that merely looks similar to the request/Figma.",
  already_exists_no_inventory:
    "Plan: «already implemented» requires each mockup block listed with reuse path or explicit gap.",
  missing_analogue_quote:
    "Plan: every reuse/by-pattern Step needs an observed backtick quote copied from that path's content.",
  missing_path_read:
    "Plan: every reuse/by-pattern path must be read_file'd THIS turn — do not cite paths from memory.",
  missing_implementation:
    "Plan (UI/Figma): add **Implementation** with props/imports from read_file of shared component sources.",
  missing_component_api_read:
    "Plan: read_file the named shared component source (not only a call site) before documenting its API.",
  implementation_api_mismatch:
    "Plan: props/imports in **Implementation** must appear in the component source you read_file'd.",
  checklist_coverage:
    "Plan: Steps/Acceptance must cover checklist / mockup block labels ~1:1 (drop at most one).",
  goal_frame_title:
    "Plan: Goal must match the Figma/vision-helper frame Title when a mockup was loaded.",
  figma_block_inventory:
    "Plan: map Figma blocks (Columns/Filters/Actions/Tabs) to separate Steps — do not collapse the mockup.",
};

const HEADER =
  "# Learned errors (Harbor Agents)\n\n" +
  "Auto-updated short lessons from plan-quality nudges and post-edit verification.\n" +
  "Edit or delete freely. Cap ~3k when injected into the agent.\n";

function normalizeFingerprint(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/:\d+:\d+/g, "")
    .replace(/\d+/g, "#")
    .trim()
    .slice(0, 96);
}

export function lessonFromPlanQualityReason(
  reason: PlanQualityReason
): LearnedErrorEntry | null {
  const lesson = PLAN_QUALITY_LESSONS[reason];
  if (!lesson) {
    return null;
  }
  return {
    key: `plan_quality:${reason}`,
    kind: "plan_quality",
    lesson,
  };
}

export function lessonsFromPlanQualityReasons(
  reasons: readonly PlanQualityReason[] | undefined
): LearnedErrorEntry[] {
  const out: LearnedErrorEntry[] = [];
  const seen = new Set<string>();
  for (const reason of reasons || []) {
    const entry = lessonFromPlanQualityReason(reason);
    if (!entry || seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    out.push(entry);
  }
  return out;
}

/**
 * Distill a verification failure into one short lesson.
 * Prefer a stable code/signature over raw stack noise.
 */
export function lessonFromVerificationFailure(input: {
  source: "diagnostics" | "imports" | "project_command";
  errors: string[];
  paths?: string[];
  command?: string;
}): LearnedErrorEntry | null {
  const errors = (input.errors || [])
    .map((e) => String(e || "").trim())
    .filter(Boolean);
  if (!errors.length && input.source !== "project_command") {
    return null;
  }

  const first = errors[0] || String(input.command || "project command").trim();
  if (!first) {
    return null;
  }

  const paths = (input.paths || [])
    .map((p) =>
      String(p || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
    )
    .filter(Boolean)
    .slice(0, 3);
  const pathHint = paths.length ? ` (edited: ${paths.join(", ")})` : "";

  let signature = first;
  const tsCode = first.match(/\bTS\d{4}\b/);
  const eslintRule = first.match(/\b([\w-]+\/[\w-]+)\b/);
  if (tsCode) {
    signature = tsCode[0];
  } else if (eslintRule && /eslint|@typescript/i.test(first)) {
    signature = eslintRule[1];
  }

  const fp = normalizeFingerprint(
    `${input.source}:${input.command || ""}:${signature}`
  );
  if (!fp) {
    return null;
  }

  let lesson: string;
  if (input.source === "diagnostics") {
    const preview = first.replace(/\s+/g, " ").slice(0, 140);
    lesson = `Verification: after edits${pathHint}, fix diagnostics before finale — e.g. «${preview}». Prefer search_replace on edited paths.`;
  } else if (input.source === "imports") {
    const preview = first.replace(/\s+/g, " ").slice(0, 120);
    lesson = `Verification: resolve import warnings on edited files${pathHint} before claiming done — e.g. «${preview}».`;
  } else {
    const cmd = String(input.command || "project check").trim();
    const preview = first.replace(/\s+/g, " ").slice(0, 120);
    lesson = `Verification: \`${cmd}\` failed on edited files${pathHint} — fix those paths (not whole-repo debt) before finale. Hint: «${preview}».`;
  }

  return {
    key: `verification:${fp}`,
    kind: "verification",
    lesson: lesson.slice(0, 280),
  };
}

/** Parse bullet list under optional markdown header. */
export function parseLearnedErrorsMarkdown(raw: string): LearnedErrorEntry[] {
  const text = String(raw || "").replace(/\r\n?/g, "\n");
  const entries: LearnedErrorEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const match = line.match(
      /^\s*[-*]\s+(?:\[(plan_quality|verification):([^\]]+)\]\s*)?(.+?)\s*$/
    );
    if (!match) {
      continue;
    }
    const kind = (match[1] as LearnedErrorKind | undefined) || "plan_quality";
    const keyPart = (match[2] || "").trim();
    const lesson = (match[3] || "").trim();
    if (!lesson) {
      continue;
    }
    const key = keyPart
      ? `${kind}:${keyPart}`
      : `${kind}:${normalizeFingerprint(lesson)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ key, kind, lesson });
  }
  return entries;
}

export function formatLearnedErrorsMarkdown(
  entries: LearnedErrorEntry[]
): string {
  const lines = [HEADER.trimEnd(), ""];
  for (const entry of entries) {
    const keyBody = entry.key.includes(":")
      ? entry.key.slice(entry.key.indexOf(":") + 1)
      : entry.key;
    lines.push(`- [${entry.kind}:${keyBody}] ${entry.lesson}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Newest entries win on key collision; list is newest-first; trimmed to
 * maxEntries and roughly charCap of rendered markdown.
 */
export function mergeLearnedErrors(
  existing: LearnedErrorEntry[],
  incoming: LearnedErrorEntry[],
  options?: { maxEntries?: number; charCap?: number }
): LearnedErrorEntry[] {
  const maxEntries = options?.maxEntries ?? MAX_LEARNED_ERROR_ENTRIES;
  const charCap = options?.charCap ?? LEARNED_ERRORS_CHAR_CAP;
  const byKey = new Map<string, LearnedErrorEntry>();

  // Older first, then incoming — so incoming overwrites.
  for (const entry of existing) {
    if (entry?.key && entry.lesson) {
      byKey.set(entry.key, entry);
    }
  }
  for (const entry of incoming) {
    if (entry?.key && entry.lesson) {
      byKey.set(entry.key, entry);
    }
  }

  // Newest = last written among incoming, then rest of map values.
  const incomingKeys = new Set(incoming.map((e) => e.key));
  const newest: LearnedErrorEntry[] = [];
  for (let i = incoming.length - 1; i >= 0; i--) {
    const e = byKey.get(incoming[i].key);
    if (e && !newest.some((x) => x.key === e.key)) {
      newest.push(e);
    }
  }
  for (const e of byKey.values()) {
    if (!incomingKeys.has(e.key)) {
      newest.push(e);
    }
  }

  const trimmed: LearnedErrorEntry[] = [];
  for (const entry of newest) {
    if (trimmed.length >= maxEntries) {
      break;
    }
    const trial = [...trimmed, entry];
    if (formatLearnedErrorsMarkdown(trial).length > charCap + 400) {
      // Soft stop: header overhead; inject path uses a tighter cap.
      if (trimmed.length > 0) {
        break;
      }
    }
    trimmed.push(entry);
  }
  return trimmed;
}

/** Compact system-prompt block (empty string when nothing to inject). */
export function formatLearnedErrorsForSystem(
  entries: LearnedErrorEntry[],
  charCap = LEARNED_ERRORS_CHAR_CAP
): string {
  if (!entries.length) {
    return "";
  }
  const lines = [
    "Learned errors for this workspace (avoid repeating; still verify with tools):",
  ];
  let used = lines[0].length;
  for (const entry of entries) {
    const line = `- ${entry.lesson}`;
    if (used + line.length + 1 > charCap) {
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

export function learnedErrorsFilePath(rootPath: string): string {
  return path.join(rootPath, LEARNED_ERRORS_RELATIVE_PATH);
}

export async function loadLearnedErrors(
  rootPath: string
): Promise<LearnedErrorEntry[]> {
  if (!rootPath) {
    return [];
  }
  try {
    const raw = await fs.readFile(learnedErrorsFilePath(rootPath), "utf8");
    return parseLearnedErrorsMarkdown(raw);
  } catch {
    return [];
  }
}

export async function saveLearnedErrors(
  rootPath: string,
  entries: LearnedErrorEntry[]
): Promise<void> {
  if (!rootPath) {
    return;
  }
  const filePath = learnedErrorsFilePath(rootPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, formatLearnedErrorsMarkdown(entries), "utf8");
}

/** Load → merge → save. Returns merged list. Failures are swallowed by caller. */
export async function appendLearnedErrors(
  rootPath: string,
  incoming: LearnedErrorEntry[]
): Promise<LearnedErrorEntry[]> {
  if (!rootPath || !incoming.length) {
    return loadLearnedErrors(rootPath);
  }
  const existing = await loadLearnedErrors(rootPath);
  const merged = mergeLearnedErrors(existing, incoming);
  await saveLearnedErrors(rootPath, merged);
  return merged;
}

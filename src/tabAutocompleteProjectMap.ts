/**
 * Learned project map for Tab autocomplete.
 *
 * Builds a workspaceState cache of *concrete* filename→skeleton examples
 * from the repo (sibling clusters + export heads), optionally refined by the
 * Tab model. No hardcoded "component vs model" roles — only evidence from files.
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getConfig, resolveModelEndpoint } from "./config";
import { getOpenAICompatibleClient } from "./openaiClient";

export const TAB_PROJECT_MAP_STORAGE_KEY =
  "agentPanel.tabAutocomplete.projectMap.v2";

const MAP_VERSION = 2 as const;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DIGEST_CHARS = 1_400;
const MAX_FIND_FILES = 220;
const MAX_SAMPLE_FILES = 18;
const MAX_SAMPLE_CHARS = 900;
const MAX_SKELETON_CHARS = 280;
const MAX_SCAN_PROMPT_CHARS = 14_000;
const BUILD_DELAY_MS = 1_800;

const NAME_SUFFIXES = [
  ".model",
  ".store",
  ".stores",
  ".events",
  ".event",
  ".effects",
  ".effect",
  ".api",
  ".types",
  ".type",
  ".ui",
  ".view",
  ".component",
  ".hooks",
  ".hook",
  ".selectors",
  ".selector",
];

export type TabProjectMapShapeExample = {
  /** e.g. `*.model.ts`, `*.tsx` */
  shape: string;
  /** Example relative path. */
  example: string;
  /** Compact import/export skeleton from that file. */
  skeleton: string;
  /** Other basenames that sat in the same folder. */
  siblings?: string[];
};

export type TabProjectMapRecord = {
  v: typeof MAP_VERSION;
  root: string;
  builtAt: number;
  fingerprint: string;
  /** Full prompt digest (may include LLM prose + skeletons). */
  digest: string;
  /** Per-shape concrete examples for targeted injection. */
  shapes: TabProjectMapShapeExample[];
  source: "llm" | "heuristic" | "hybrid";
};

type MementoLike = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
};

type SampleFile = {
  rel: string;
  shape: string;
  head: string;
  skeleton: string;
  siblings: string[];
};

let workspaceState: MementoLike | undefined;
let memoryByRoot = new Map<string, TabProjectMapRecord>();
let buildPromiseByRoot = new Map<
  string,
  Promise<TabProjectMapRecord | undefined>
>();
let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
let logger: ((message: string, extra?: unknown) => void) | undefined;

export function initTabProjectMap(state: MementoLike): void {
  workspaceState = state;
}

export function setTabProjectMapLogger(
  fn: ((message: string, extra?: unknown) => void) | undefined
): void {
  logger = fn;
}

function log(message: string, extra?: unknown): void {
  if (logger) {
    logger(message, extra);
    return;
  }
  if (extra !== undefined) {
    console.log(`[Harbor Tab projectMap] ${message}`, extra);
  } else {
    console.log(`[Harbor Tab projectMap] ${message}`);
  }
}

function isRecord(raw: unknown): raw is TabProjectMapRecord {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const r = raw as TabProjectMapRecord;
  return (
    r.v === MAP_VERSION &&
    typeof r.root === "string" &&
    typeof r.fingerprint === "string" &&
    typeof r.digest === "string" &&
    typeof r.builtAt === "number" &&
    Array.isArray(r.shapes) &&
    r.digest.trim().length > 0
  );
}

function loadPersisted(root: string): TabProjectMapRecord | undefined {
  const mem = memoryByRoot.get(root);
  if (mem && mem.root === root) {
    return mem;
  }
  if (!workspaceState) {
    return undefined;
  }
  const raw = workspaceState.get<unknown>(TAB_PROJECT_MAP_STORAGE_KEY);
  if (!isRecord(raw) || raw.root !== root) {
    return undefined;
  }
  memoryByRoot.set(root, raw);
  return raw;
}

async function saveRecord(record: TabProjectMapRecord): Promise<void> {
  memoryByRoot.set(record.root, record);
  if (!workspaceState) {
    return;
  }
  await workspaceState.update(TAB_PROJECT_MAP_STORAGE_KEY, record);
}

function workspaceRootForUri(uri?: vscode.Uri): string | undefined {
  if (uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function relativePosix(root: string, filePath: string): string {
  const rel = path.relative(root, filePath);
  return rel.split(path.sep).join("/");
}

/** Public for tests / callers that want the same shape as the map. */
export function fileShapeKey(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  for (const suffix of NAME_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return `*${suffix}${ext || ""}`;
    }
  }
  const lower = name.toLowerCase();
  if (
    lower === "events" ||
    lower === "stores" ||
    lower === "effects" ||
    lower === "model" ||
    lower === "units" ||
    lower === "hooks" ||
    lower === "types" ||
    lower === "api" ||
    lower === "index"
  ) {
    return `${lower}${ext || ""}`;
  }
  if (ext === ".tsx" || ext === ".jsx") {
    return `*${ext}`;
  }
  return `*${ext || ""}`;
}

function simpleHash(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/**
 * Compress a source file to imports-of-interest + top-level exports.
 * This is what Tab should mirror — not prose about "business logic".
 */
export function extractFileSkeleton(
  source: string,
  maxChars: number = MAX_SKELETON_CHARS
): string {
  const lines = String(source || "").split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    const t = line.trimEnd();
    if (!t || seen.has(t)) {
      return;
    }
    seen.add(t);
    out.push(t);
  };

  for (const line of lines.slice(0, 120)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      continue;
    }
    if (/^import\b/.test(trimmed)) {
      // Keep library / relative import shape, drop long paths noise later.
      push(trimmed.length > 120 ? trimmed.slice(0, 117) + "…" : trimmed);
      continue;
    }
    if (
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|type|interface|enum)\b/.test(
        trimmed
      ) ||
      /^export\s*\{/.test(trimmed) ||
      /^export\s+\*/.test(trimmed)
    ) {
      push(trimmed.length > 140 ? trimmed.slice(0, 137) + "…" : trimmed);
    }
    if (out.length >= 14) {
      break;
    }
  }

  // If almost empty (new file style), fall back to first non-empty lines.
  if (out.length < 3) {
    for (const line of lines.slice(0, 40)) {
      const t = line.trimEnd();
      if (!t.trim()) {
        continue;
      }
      push(t.length > 120 ? t.slice(0, 117) + "…" : t);
      if (out.length >= 10) {
        break;
      }
    }
  }

  return out.join("\n").slice(0, maxChars).trim();
}

async function readPackageHint(root: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    const interesting = [
      "react",
      "react-dom",
      "effector",
      "effector-react",
      "@reduxjs/toolkit",
      "vue",
      "svelte",
      "next",
      "express",
      "fastify",
      "zod",
      "mobx",
      "zustand",
    ].filter((k) => k in deps);
    return `package: ${pkg.name || "?"} libs: ${interesting.join(", ") || "n/a"}`;
  } catch {
    return "";
  }
}

async function listCandidateUris(root: string): Promise<vscode.Uri[]> {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  const pattern = new vscode.RelativePattern(
    folder ?? vscode.Uri.file(root),
    "**/*.{ts,tsx,js,jsx,mts,cts}"
  );
  const uris = await vscode.workspace.findFiles(
    pattern,
    "**/{node_modules,dist,out,build,coverage,vendor,.git,.next,storybook-static,__mocks__}/**",
    MAX_FIND_FILES
  );
  return uris.filter((u) => u.scheme === "file");
}

function scoreRelForSampling(rel: string, siblingCount: number): number {
  let score = siblingCount * 3;
  const base = path.posix.basename(rel).toLowerCase();
  if (NAME_SUFFIXES.some((s) => base.includes(s))) {
    score += 4;
  }
  if (base.endsWith(".tsx") || base.endsWith(".jsx")) {
    score += 2;
  }
  if (
    /(^|\/)(test|tests|__tests__|__mocks__|spec|stories|storybook|fixtures|mocks|e2e|cypress|playwright)\//i.test(
      rel
    ) ||
    /\.(test|spec|stories|story|mock)\./i.test(base) ||
    /\.d\.ts$/i.test(base) ||
    /^generated/i.test(base)
  ) {
    score -= 20;
  }
  if (base === "index.ts" || base === "index.tsx" || base === "index.js") {
    score -= 2;
  }
  return score;
}

async function pickSamples(
  root: string,
  uris: vscode.Uri[]
): Promise<{
  fingerprint: string;
  samples: SampleFile[];
  shapes: Map<string, string[]>;
}> {
  const relPaths = uris
    .map((u) => relativePosix(root, u.fsPath))
    .filter((r) => r && !r.startsWith(".."))
    .sort();

  const pkgHint = await readPackageHint(root);
  const fingerprint = simpleHash(`v2\n${pkgHint}\n${relPaths.join("\n")}`);

  const byDir = new Map<string, string[]>();
  for (const rel of relPaths) {
    const dir = path.posix.dirname(rel);
    const list = byDir.get(dir) || [];
    list.push(rel);
    byDir.set(dir, list);
  }

  const byShape = new Map<string, string[]>();
  for (const rel of relPaths) {
    const shape = fileShapeKey(rel);
    const list = byShape.get(shape) || [];
    if (list.length < 8) {
      list.push(rel);
      byShape.set(shape, list);
    }
  }

  // Rank candidates: prefer files that sit with siblings (feature folders).
  const ranked = [...relPaths].sort((a, b) => {
    const sa = scoreRelForSampling(a, byDir.get(path.posix.dirname(a))?.length || 1);
    const sb = scoreRelForSampling(b, byDir.get(path.posix.dirname(b))?.length || 1);
    return sb - sa;
  });

  const chosen: string[] = [];
  const seen = new Set<string>();
  const shapeCount = new Map<string, number>();

  const tryAdd = (rel: string) => {
    if (!rel || seen.has(rel) || chosen.length >= MAX_SAMPLE_FILES) {
      return;
    }
    const shape = fileShapeKey(rel);
    const n = shapeCount.get(shape) || 0;
    if (n >= 3) {
      return;
    }
    seen.add(rel);
    shapeCount.set(shape, n + 1);
    chosen.push(rel);
  };

  // Pass 1: take a file, then pull its directory siblings (layering evidence).
  for (const rel of ranked) {
    if (chosen.length >= MAX_SAMPLE_FILES) {
      break;
    }
    tryAdd(rel);
    const siblings = byDir.get(path.posix.dirname(rel)) || [];
    for (const sib of siblings) {
      if (sib === rel) {
        continue;
      }
      tryAdd(sib);
      if (chosen.length >= MAX_SAMPLE_FILES) {
        break;
      }
    }
  }

  const samples: SampleFile[] = [];
  for (const rel of chosen) {
    try {
      const abs = path.join(root, rel.split("/").join(path.sep));
      const raw = await fs.readFile(abs, "utf8");
      if (!raw.trim()) {
        continue;
      }
      const head = raw.slice(0, MAX_SAMPLE_CHARS).trimEnd();
      const skeleton = extractFileSkeleton(raw);
      if (!skeleton) {
        continue;
      }
      const dir = path.posix.dirname(rel);
      const siblings = (byDir.get(dir) || [])
        .filter((p) => p !== rel)
        .map((p) => path.posix.basename(p))
        .slice(0, 6);
      samples.push({
        rel,
        shape: fileShapeKey(rel),
        head,
        skeleton,
        siblings,
      });
    } catch {
      // skip
    }
  }

  return { fingerprint, samples, shapes: byShape };
}

function shapesFromSamples(
  samples: SampleFile[]
): TabProjectMapShapeExample[] {
  const best = new Map<string, TabProjectMapShapeExample>();
  for (const s of samples) {
    const prev = best.get(s.shape);
    const candidate: TabProjectMapShapeExample = {
      shape: s.shape,
      example: s.rel,
      skeleton: s.skeleton.slice(0, MAX_SKELETON_CHARS),
      siblings: s.siblings.length ? s.siblings : undefined,
    };
    // Prefer examples that have siblings (clearer layering).
    if (
      !prev ||
      (s.siblings.length > 0 && !(prev.siblings && prev.siblings.length > 0))
    ) {
      best.set(s.shape, candidate);
    }
  }
  return [...best.values()].sort((a, b) => a.shape.localeCompare(b.shape));
}

/** Concrete heuristic digest — skeletons first, not abstract role words. */
export function buildHeuristicDigest(
  pkgHint: string,
  shapeExamples: TabProjectMapShapeExample[]
): string {
  const lines: string[] = [];
  if (pkgHint) {
    lines.push(`Libs: ${pkgHint.replace(/^package:\s*/, "")}`);
  }
  lines.push(
    "When filling a file, mirror the skeleton for its filename shape (imports + exports). Do not invent other layers."
  );
  for (const ex of shapeExamples.slice(0, 10)) {
    const sib = ex.siblings?.length
      ? ` | siblings: ${ex.siblings.slice(0, 4).join(", ")}`
      : "";
    lines.push(`### ${ex.shape}  (e.g. ${ex.example}${sib})`);
    lines.push(ex.skeleton);
    lines.push("");
  }
  return lines.join("\n").slice(0, MAX_DIGEST_CHARS).trim();
}

function buildScanPrompt(
  pkgHint: string,
  samples: SampleFile[],
  shapes: Map<string, string[]>
): string {
  const shapeLines = [...shapes.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 14)
    .map(([shape, files]) => `- ${shape}: ${files.slice(0, 3).join(", ")}`)
    .join("\n");

  const sampleBlocks = samples
    .map((s) => {
      const sib = s.siblings.length
        ? `\nSiblings in folder: ${s.siblings.join(", ")}`
        : "";
      return `### ${s.rel} [shape ${s.shape}]${sib}\nSKELETON:\n${s.skeleton}\nHEAD:\n${s.head.slice(0, 420)}`;
    })
    .join("\n\n");

  let body = `${pkgHint ? pkgHint + "\n\n" : ""}## Shapes\n${shapeLines}\n\n## Samples\n${sampleBlocks}`;
  if (body.length > MAX_SCAN_PROMPT_CHARS) {
    body = body.slice(0, MAX_SCAN_PROMPT_CHARS);
  }

  return `Distill THIS repo's file-naming conventions for inline Tab autocomplete.

Return plain text under ${MAX_DIGEST_CHARS} chars with this structure:
1) 4–8 short bullets: how filename shapes pair (only if samples show it), which libs appear where, what not to mix.
2) Then for each important shape, a block:
### *.something.ts
- mirror: <one-line rule>
- skeleton:
<3–8 lines of REAL imports/exports copied/lightly compressed from samples>

Rules:
- Evidence ONLY from samples — no invented folders/libs.
- Prefer concrete code over adjectives ("business logic", "component").
- Keep skeletons short; strip comments and blank lines.

${body}`;
}

async function distillWithLlm(scanPrompt: string): Promise<string | undefined> {
  const config = getConfig();
  const modelId = config.tabAutocomplete.modelId.trim();
  if (!modelId) {
    return undefined;
  }
  const endpoint = resolveModelEndpoint(modelId);
  if (!endpoint.baseUrl) {
    return undefined;
  }
  const client = getOpenAICompatibleClient(
    endpoint.baseUrl,
    endpoint.apiKey || "",
    {
      rejectUnauthorized: config.rejectUnauthorized,
      caBundlePath: config.caBundlePath,
    }
  );
  const result = await client.chatCompletions({
    model: modelId,
    messages: [
      {
        role: "system",
        content:
          "You distill repo file conventions into concrete skeletons for code completion. Prefer real import/export lines over abstract advice. No invention.",
      },
      { role: "user", content: scanPrompt },
    ],
    temperature: 0.1,
    max_tokens: 700,
  });
  const content = result.message.content;
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && "text" in part
                ? String((part as { text?: string }).text || "")
                : ""
            )
            .join("")
        : "";
  const cleaned = String(raw || "")
    .replace(/^```(?:\w+)?\n?/g, "")
    .replace(/\n?```$/g, "")
    .trim();
  if (cleaned.length < 60) {
    return undefined;
  }
  return cleaned.slice(0, MAX_DIGEST_CHARS);
}

function composeDigest(
  llmText: string | undefined,
  heuristic: string,
  shapeExamples: TabProjectMapShapeExample[]
): { digest: string; source: TabProjectMapRecord["source"] } {
  if (!llmText) {
    return { digest: heuristic, source: "heuristic" };
  }
  // Hybrid: LLM prose + ensure at least a few concrete skeletons remain.
  const needShapes = shapeExamples.slice(0, 4);
  let digest = llmText.trim();
  const missing = needShapes.filter(
    (ex) => !digest.includes(ex.shape) || !digest.includes("import")
  );
  if (missing.length > 0 || !/###\s|\*\./.test(digest)) {
    const extra = buildHeuristicDigest("", missing.length ? missing : needShapes);
    digest = `${digest}\n\n${extra}`.slice(0, MAX_DIGEST_CHARS);
    return { digest: digest.trim(), source: "hybrid" };
  }
  return { digest, source: "llm" };
}

async function buildMapForRoot(
  root: string
): Promise<TabProjectMapRecord | undefined> {
  const uris = await listCandidateUris(root);
  if (uris.length < 3) {
    log("skip build — too few source files", { root, n: uris.length });
    return undefined;
  }
  const pkgHint = await readPackageHint(root);
  const { fingerprint, samples, shapes } = await pickSamples(root, uris);
  if (samples.length === 0) {
    return undefined;
  }

  const shapeExamples = shapesFromSamples(samples);
  const heuristic = buildHeuristicDigest(pkgHint, shapeExamples);

  let llmText: string | undefined;
  try {
    llmText = await distillWithLlm(buildScanPrompt(pkgHint, samples, shapes));
  } catch (err) {
    log("llm distill failed", err instanceof Error ? err.message : err);
  }

  const { digest, source } = composeDigest(llmText, heuristic, shapeExamples);
  const record: TabProjectMapRecord = {
    v: MAP_VERSION,
    root,
    builtAt: Date.now(),
    fingerprint,
    digest,
    shapes: shapeExamples,
    source,
  };
  await saveRecord(record);
  log("built project map", {
    root,
    source,
    digestChars: digest.length,
    shapes: shapeExamples.map((s) => s.shape),
    samples: samples.length,
    files: uris.length,
  });
  return record;
}

/**
 * Cached digest for Tab prompts.
 * `focused` — only the skeleton matching this filename (less noise mid-file).
 * `full` — focused + short repo digest (for empty / new files).
 */
export function getTabProjectMapDigest(
  root?: string,
  filePath?: string,
  options?: { mode?: "focused" | "full" }
): string | undefined {
  const r = root || workspaceRootForUri();
  if (!r) {
    return undefined;
  }
  const record = loadPersisted(r);
  if (!record || Date.now() - record.builtAt > TTL_MS) {
    return undefined;
  }

  const mode = options?.mode || (filePath ? "focused" : "full");
  const base = record.digest.trim();

  if (!filePath) {
    return base || undefined;
  }

  const shape = fileShapeKey(filePath);
  const match =
    record.shapes.find((s) => s.shape === shape) ||
    record.shapes.find(
      (s) =>
        shape.endsWith(s.shape.replace(/^\*/, "")) ||
        s.shape.endsWith(shape.replace(/^\*/, ""))
    );

  if (!match) {
    // Mid-file without a shape match: skip map entirely (rules/related are enough).
    if (mode === "focused") {
      return undefined;
    }
    return base || undefined;
  }

  const focused = [
    `Shape \`${match.shape}\` — mirror imports/exports style only (do NOT paste this block as the fill).`,
    `Example: ${match.example}${
      match.siblings?.length ? ` | siblings: ${match.siblings.join(", ")}` : ""
    }`,
    match.skeleton,
  ].join("\n");

  if (mode === "focused") {
    return focused.slice(0, 520).trim();
  }

  // Empty-file mode: focused + short bullets only (no other shapes' skeletons).
  const bullets = base
    .split("\n")
    .filter(
      (l) =>
        /^(Libs:|When filling|- )/.test(l.trim()) ||
        /^\s+- `?\*/.test(l)
    )
    .slice(0, 10)
    .join("\n");
  return `${focused}${bullets ? `\n\n${bullets}` : ""}`
    .slice(0, MAX_DIGEST_CHARS)
    .trim();
}

/** Concrete same-shape example from the cached project map (if any). */
export function getTabProjectMapShapeExample(
  root?: string,
  filePath?: string
): TabProjectMapShapeExample | undefined {
  const r = root || workspaceRootForUri();
  if (!r || !filePath) {
    return undefined;
  }
  const record = loadPersisted(r);
  if (!record || Date.now() - record.builtAt > TTL_MS) {
    return undefined;
  }
  const shape = fileShapeKey(filePath);
  return (
    record.shapes.find((s) => s.shape === shape) ||
    record.shapes.find(
      (s) =>
        shape.endsWith(s.shape.replace(/^\*/, "")) ||
        s.shape.endsWith(shape.replace(/^\*/, ""))
    )
  );
}

export async function ensureTabProjectMap(options?: {
  root?: string;
  force?: boolean;
}): Promise<string | undefined> {
  const root = options?.root || workspaceRootForUri();
  if (!root) {
    return undefined;
  }
  if (!getConfig().tabAutocomplete.enabled) {
    return getTabProjectMapDigest(root);
  }

  const existing = loadPersisted(root);
  if (
    existing &&
    !options?.force &&
    Date.now() - existing.builtAt <= TTL_MS
  ) {
    return existing.digest;
  }

  const inflight = buildPromiseByRoot.get(root);
  if (inflight) {
    const got = await inflight;
    return got?.digest;
  }

  const promise = (async () => {
    try {
      if (existing && !options?.force) {
        const uris = await listCandidateUris(root);
        const { fingerprint } = await pickSamples(root, uris);
        if (
          existing.fingerprint === fingerprint &&
          Date.now() - existing.builtAt <= TTL_MS
        ) {
          return existing;
        }
      }
      return await buildMapForRoot(root);
    } catch (err) {
      log("build failed", err instanceof Error ? err.message : err);
      return existing;
    } finally {
      buildPromiseByRoot.delete(root);
    }
  })();

  buildPromiseByRoot.set(root, promise);
  const got = await promise;
  return got?.digest;
}

/** Schedule (or re-schedule) a background build. */
export function scheduleTabProjectMapBuild(options?: {
  force?: boolean;
  delayMs?: number;
}): void {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
  }
  const delay = options?.delayMs ?? BUILD_DELAY_MS;
  scheduleTimer = setTimeout(() => {
    scheduleTimer = undefined;
    void (async () => {
      try {
        if (!getConfig().tabAutocomplete.enabled) {
          log("skip scheduled build — Tab disabled");
          return;
        }
        await ensureTabProjectMap({ force: options?.force === true });
      } catch (err) {
        log("scheduled build error", err instanceof Error ? err.message : err);
      }
    })();
  }, Math.max(0, delay));
  // Node timers in extension host may support unref.
  (scheduleTimer as { unref?: () => void }).unref?.();
}

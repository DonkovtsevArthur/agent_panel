/**
 * Host-side parallel explore probes for Plan + attached screenshot (no Figma URL).
 * Pure prompt builders are vscode-free for unit tests; the runner lazy-imports
 * delegateTask (which pulls the agent loop).
 */

export const HARBOR_SCREENSHOT_EXPLORE_MARKER = "[Harbor screenshot explore";

export const SCREENSHOT_EXPLORE_MAX_ROUNDS = 4;
export const SCREENSHOT_EXPLORE_OCR_CAP = 1_800;
export const SCREENSHOT_EXPLORE_RESULT_CAP = 2_400;

export type ScreenshotExploreProbeId =
  | "ui-api"
  | "pages-routes"
  | "print-widgets";

const PROBE_IDS: readonly ScreenshotExploreProbeId[] = [
  "ui-api",
  "pages-routes",
  "print-widgets",
];

/** Compact Visible UI / OCR text for probe prompts. */
export function extractOcrBriefForExplore(
  visionHelperText: string,
  maxChars = SCREENSHOT_EXPLORE_OCR_CAP
): string {
  const raw = String(visionHelperText || "").trim();
  if (!raw) {
    return "";
  }
  const visible =
    raw.match(/##\s*Visible UI[\s\S]*?(?=\n##\s|\s*$)/i)?.[0] || raw;
  const cleaned = visible
    .replace(/\[Harbor vision helper[^\]]*\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxChars)}\n…`;
}

export function buildScreenshotExploreProbeTask(
  probe: ScreenshotExploreProbeId,
  ocrBrief: string
): string {
  const ocr = String(ocrBrief || "").trim() || "(no OCR labels — explore generically)";
  const shared = [
    "You are a read-only research sub-agent for a Plan turn.",
    "Return a concise summary with concrete workspace paths you actually list_files/search_text/read_file'd.",
    "Do NOT write a <proposed_plan>. Do NOT invent UI labels missing from the OCR below.",
    "Folder name / similar title alone is NOT done. Stub, disabled button, or empty ui/ → stub/partial/gap.",
    "After you read_file a candidate page: if OCR Title + Columns/Actions labels appear in that source,",
    "report match:full for those blocks (reuse). If labels are missing or different → mismatch/gap.",
    "For each candidate path: say reuse | match:full | new-by-pattern | stub/empty | mismatch vs OCR.",
    "Prefer list_files / search_text / read_file. Max depth: find analogues and gaps, not rewrite the app.",
    "",
    "OCR / Visible UI from the user screenshot:",
    ocr,
    "",
  ].join("\n");

  switch (probe) {
    case "ui-api":
      return (
        shared +
        [
          "Focus: reusable UI components and API client patterns.",
          "Look under src/shared/ui/, src/shared/api/, components/, and similar.",
          "Note tables, checkboxes, banners/notifications, buttons, layout wrappers,",
          "and how API endpoints are organized (folder-per-endpoint, fetchApi, Effector attach).",
          "Relate findings to the OCR labels (columns, actions, filters) when possible.",
        ].join("\n")
      );
    case "pages-routes":
      return (
        shared +
        [
          "Focus: pages, routing, and similar screens matching the OCR Title.",
          "Look at src/pages/, src/shared/paths.ts, routes/model, and page registration (PAGES).",
          "Find empty stubs, disabled buttons, or near-analogue list/detail pages.",
          "Report how a new page would be registered (path key, lazy load, menu child).",
        ].join("\n")
      );
    case "print-widgets":
      return (
        shared +
        [
          "Focus: print/download widgets, side menu, and related features.",
          "Look for journal-print / PDF preview / downloadFile patterns and any",
          "certificate / credential / udostoverenie related features or stubs.",
          "Summarize the print/download flow the new page should reuse.",
        ].join("\n")
      );
    default: {
      const _exhaustive: never = probe;
      return shared + String(_exhaustive);
    }
  }
}

export type ScreenshotExploreProbeResult = {
  id: ScreenshotExploreProbeId;
  ok: boolean;
  result: string;
  error?: string;
};

export function formatScreenshotExploreSummary(
  results: ScreenshotExploreProbeResult[],
  resultCap = SCREENSHOT_EXPLORE_RESULT_CAP
): string {
  const sections: string[] = [
    `${HARBOR_SCREENSHOT_EXPLORE_MARKER}]`,
    "Host ran parallel read-only explore probes before planning.",
    "These paths are HOW candidates only. OCR Visible UI remains WHAT.",
    "Inventory EACH OCR block (Title, Columns, Filters, Actions)",
    "→ reuse path | new-by-pattern of a path you read | explicit gap.",
    "Folder name alone ≠ done. BUT if you read_file a page and OCR labels match that source,",
    "say so inside <proposed_plan>: Goal = Title, each block → reuse, note «уже совпадает / no new work».",
    "Do NOT invent a new page or gaps when the existing page already covers the mockup.",
    "Prefer request_user_input only for true preferences that OCR+repo cannot decide.",
  ];
  for (const item of results) {
    const body = item.ok
      ? String(item.result || "").trim() || "(empty)"
      : `ERROR: ${String(item.error || item.result || "failed").trim()}`;
    const clipped =
      body.length > resultCap ? `${body.slice(0, resultCap)}\n…` : body;
    sections.push(`## Probe · ${item.id}`, clipped);
  }
  return sections.join("\n\n");
}

export async function runScreenshotPlanExploreProbes(options: {
  ocrText: string;
  model: string;
  storageUri?: import("vscode").Uri;
  signal?: AbortSignal;
}): Promise<string> {
  const brief = extractOcrBriefForExplore(options.ocrText);
  const { runDelegateTask } = await import("./delegateTask");
  const settled = await Promise.all(
    PROBE_IDS.map(async (id): Promise<ScreenshotExploreProbeResult> => {
      const out = await runDelegateTask({
        task: buildScreenshotExploreProbeTask(id, brief),
        mode: "ask",
        model: options.model,
        storageUri: options.storageUri,
        signal: options.signal,
        maxToolRounds: SCREENSHOT_EXPLORE_MAX_ROUNDS,
      });
      return {
        id,
        ok: out.ok,
        result: out.result,
        error: out.error,
      };
    })
  );
  return formatScreenshotExploreSummary(settled);
}

/**
 * Decide whether MCP/page screenshots go to the chat planner as raw images
 * or through the under-the-hood preferred vision helper (OCR → text).
 *
 * Settings → Preferred vision models (manual list):
 *   - when non-empty, that model "looks" unless the chat planner itself is
 *     in the list (and supports vision) — then the planner gets raw pixels.
 *   - when empty (auto), keep prior behavior: vision planners get raw images;
 *     non-vision planners get the helper with VISION_MODEL_PREFERENCE.
 */

function normalizeIds(ids: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of ids || []) {
    const id = String(raw || "").trim();
    if (id && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/**
 * @param plannerModelId chat-selected model for this turn
 * @param plannerSupportsVision capability of the planner
 * @param manualPreferredIds settings `visionRouting.preferredModelIds` only
 *   (do NOT pass the auto fallback list)
 */
export function shouldDeliverRawScreenshotToPlanner(
  plannerModelId: string,
  plannerSupportsVision: boolean,
  manualPreferredIds: readonly string[] | undefined
): boolean {
  if (!plannerSupportsVision) {
    return false;
  }
  const planner = String(plannerModelId || "").trim();
  if (!planner) {
    return false;
  }
  const manual = normalizeIds(manualPreferredIds);
  if (manual.length > 0) {
    return manual.includes(planner);
  }
  return true;
}

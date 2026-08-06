/**
 * When to whole-turn-route an image attachment onto a vision model.
 * Extracted from the retired Harbor plan-quality brain for the Cline-era host.
 */
import { looksLikeQuestionRequest } from "./claimedEdits";

/**
 * Agent/Ask + image → always swap to a vision model for that turn.
 * Plan + image + QUESTION → swap so the planner can see the image and answer.
 * Plan + image mockup (no question) → no whole-turn swap (host/OCR or Figma
 * owned vision under the old path; with Cline the image still rides attachments
 * when the selected model has vision).
 */
export function shouldWholeTurnRouteForImageAttachment(options: {
  planMode: boolean;
  hasImageAttachment: boolean;
  userText?: string;
}): boolean {
  if (!options.hasImageAttachment) {
    return false;
  }
  if (options.planMode) {
    return looksLikeQuestionRequest(options.userText || "");
  }
  return true;
}

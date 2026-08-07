/**
 * Pure formatting helpers for the under-the-hood Figma vision pass.
 * Kept vscode-free so unit tests can import without the VS Code module.
 */
import type { ChatMessage, ContentPart } from "./openaiClient";

const VISION_DESCRIBE_SYSTEM = `You are a vision helper for a coding agent.
Extract concrete UI text from the screenshot. List exact visible strings:
page/section titles, tabs, table column headers, filter chips, buttons, links,
badges, empty-state copy, form labels, placeholders, menu items.
Do not invent fields that are not visible. If text is unreadable, say so.
No plan, no code, no repo advice — only what you see.
Prefer the language of the UI labels on the screenshot.`;

const VISION_DESCRIBE_USER =
  "Describe this Figma/UI screenshot for planning. Use short markdown sections (Title, Columns, Filters, Actions, Other text). Quote labels exactly.";

export const MAX_VISION_IMAGES = 2;
export const MAX_ACCOMPANYING_CHARS = 6_000;
export const MAX_DESCRIPTION_CHARS = 8_000;

/** Marker in tool-result text — context budget must not compact these payloads. */
export const HARBOR_VISION_HELPER_MARKER = "[Harbor vision helper";

export function buildVisionDescribeMessages(
  imageDataUrls: string[],
  accompanyingText?: string
): ChatMessage[] {
  const images = imageDataUrls
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .slice(0, MAX_VISION_IMAGES);
  const parts: ContentPart[] = [{ type: "text", text: VISION_DESCRIBE_USER }];
  const note = String(accompanyingText || "").trim();
  if (note) {
    parts.push({
      type: "text",
      text: `Accompanying MCP text (may be abstracted):\n${note.slice(0, MAX_ACCOMPANYING_CHARS)}`,
    });
  }
  for (const url of images) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return [
    { role: "system", content: VISION_DESCRIBE_SYSTEM },
    { role: "user", content: parts },
  ];
}

export function formatVisionHelperToolResult(options: {
  visionModelId: string;
  description: string;
  accompanyingText?: string;
}): string {
  const description = String(options.description || "").trim();
  const accompanying = String(options.accompanyingText || "").trim();
  const header = [
    `${HARBOR_VISION_HELPER_MARKER} · ${options.visionModelId}]`,
    "The chat model cannot see raw screenshot bytes in tool results.",
    "Use the labels below as the primary source for concrete UI strings (columns, buttons, filters).",
    "Do NOT claim fields are «not fixed» / «ColumnDef not captured» when they appear below.",
  ].join(" ");

  const sections: string[] = [header];
  if (description) {
    sections.push("## Visible UI (from screenshot)", description);
  } else {
    sections.push(
      "## Visible UI (from screenshot)",
      "(Vision helper returned an empty description.)"
    );
  }
  if (accompanying) {
    sections.push(
      "## Accompanying MCP text",
      accompanying.slice(0, MAX_ACCOMPANYING_CHARS)
    );
  }
  return sections.join("\n\n");
}

export function messageTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text?: string }).text || "")
        : ""
    )
    .join("");
}

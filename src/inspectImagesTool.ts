/**
 * Harbor extraTool: text chat models call this to re-run the vision helper
 * with a specific question. spawn_agent cannot do this — children inherit
 * the parent model and still cannot view pixels.
 */
import { resolveModelSupportsVision } from "./config";
import { describeChatImagesForMainModel } from "./figmaVisionHelper";
import { getInspectableImages } from "./inspectImagesContext";

type CreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

export const INSPECT_IMAGES_TOOL = "inspect_images";

export function createInspectImagesTool(
  createTool: CreateTool,
  plannerModelId: string
): unknown | undefined {
  if (resolveModelSupportsVision(plannerModelId)) {
    return undefined;
  }
  return createTool({
    name: INSPECT_IMAGES_TOOL,
    description:
      "Look at screenshot/image attachments in this chat with a vision model. Call when the Harbor vision-helper description is missing, incomplete, or you still cannot answer a question about the picture. Pass a specific question (labels, colors, layout, errors). Do not spawn_agent to view images — the child uses the same text model and cannot see pixels.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "What to look for on the attached image(s). Quote the user's ask if it is about the screenshot.",
        },
      },
      required: ["question"],
    },
    execute: async (input: unknown, context: unknown) => {
      const question = String(
        (input as { question?: string } | null)?.question || ""
      ).trim();
      const urls = getInspectableImages();
      if (!urls.length) {
        return [
          "No screenshot is in this turn's image buffer.",
          "Ask the user to attach an image, or use the Harbor vision-helper text already in the conversation.",
          "Do not spawn_agent for vision.",
        ].join(" ");
      }
      const signal = (context as { signal?: AbortSignal } | null)?.signal;
      const helper = await describeChatImagesForMainModel({
        imageDataUrls: urls,
        userQuestion: question,
        chatModelId: plannerModelId,
        signal,
      });
      return helper.text || "Vision helper returned an empty description.";
    },
    timeoutMs: 120_000,
  });
}

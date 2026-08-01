/**
 * Under-the-hood vision pass for Figma (and other MCP) screenshots.
 * The chat-selected model stays the planner; a vision model only OCR/labels
 * the image and returns text that is injected as the tool result.
 */
import {
  buildVisionDescribeMessages,
  formatVisionHelperToolResult,
  MAX_DESCRIPTION_CHARS,
  MAX_VISION_IMAGES,
  messageTextFromContent,
} from "./figmaVisionFormat";
import {
  resolveVisionPreferenceIds,
  routeModel,
} from "./modelRouting";

export {
  buildVisionDescribeMessages,
  formatVisionHelperToolResult,
} from "./figmaVisionFormat";

export async function describeMcpImagesForMainModel(options: {
  imageDataUrls: string[];
  accompanyingText?: string;
  visionPreferenceIds?: readonly string[];
  signal?: AbortSignal;
}): Promise<string> {
  // Lazy-require vscode-bound modules so unit tests can import format helpers.
  const {
    getConfig,
    getEnabledModels,
    resolveModelEndpoint,
  } = require("./config") as typeof import("./config");
  const { getOpenAICompatibleClient } =
    require("./openaiClient") as typeof import("./openaiClient");

  const images = (options.imageDataUrls || [])
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .slice(0, MAX_VISION_IMAGES);
  const accompanying = String(options.accompanyingText || "").trim();

  if (!images.length) {
    return accompanying;
  }

  const config = getConfig();
  const enabled = getEnabledModels().filter((m) => {
    const endpoint = resolveModelEndpoint(m.id);
    return Boolean(endpoint.baseUrl && endpoint.apiKey);
  });
  const preference = resolveVisionPreferenceIds(
    options.visionPreferenceIds ?? config.visionRouting.preferredModelIds
  );
  const routed = routeModel(enabled, {
    hints: {
      vision_required: true,
      vision_preference: preference,
    },
  });

  if (!routed?.modelId) {
    return [
      accompanying,
      "[Harbor] Screenshot received, but no vision-capable model is enabled. Enable one under Settings → Images (vision), or call request_user_input for the missing labels.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const endpoint = resolveModelEndpoint(routed.modelId);
  if (!endpoint.baseUrl || !endpoint.apiKey) {
    return [
      accompanying,
      `[Harbor] Vision model «${routed.modelId}» has no provider credentials.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const client = getOpenAICompatibleClient(endpoint.baseUrl, endpoint.apiKey, {
    rejectUnauthorized: config.rejectUnauthorized,
    caBundlePath: config.caBundlePath,
  });

  const result = await client.chatCompletions(
    {
      model: routed.modelId,
      messages: buildVisionDescribeMessages(images, accompanying),
      temperature: 0.1,
      max_tokens: 1_500,
    },
    options.signal
  );

  const description = messageTextFromContent(result.message.content)
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);

  return formatVisionHelperToolResult({
    visionModelId: routed.modelId,
    description,
    accompanyingText: accompanying,
  });
}

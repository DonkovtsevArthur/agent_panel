/**
 * Under-the-hood vision pass for Figma (and other MCP) screenshots.
 * The chat-selected model stays the planner; a vision model only OCR/labels
 * the image and returns text that is injected as the tool result.
 */
import {
  buildChatVisionDescribeMessages,
  buildVisionDescribeMessages,
  formatChatVisionHelperPrompt,
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

/** Vision models tried per chat image description before giving up. */
const MAX_VISION_MODEL_ATTEMPTS = 3;

export async function describeChatImagesForMainModel(options: {
  imageDataUrls: string[];
  userQuestion?: string;
  chatModelId?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; description?: string; visionModelId?: string }> {
  const {
    getConfig,
    getEnabledModels,
    resolveApiModelId,
    resolveModelEndpoint,
  } = require("./config") as typeof import("./config");
  const { getOpenAICompatibleClient } =
    require("./openaiClient") as typeof import("./openaiClient");

  const images = (options.imageDataUrls || [])
    .map((url) => String(url || "").trim())
    .filter((url) => url.startsWith("data:image/"))
    .slice(0, MAX_VISION_IMAGES);
  if (!images.length) {
    return { text: "" };
  }

  const config = getConfig();
  const chatModelId = String(options.chatModelId || "").trim();
  const manualPreference = (config.visionRouting.preferredModelIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  // The chat model is skipped as its own describer (weak-vision flash tier),
  // unless the user explicitly listed it under Settings → Images (vision):
  // a dedicated describe call on that model is what they asked for.
  const excluded = new Set<string>();
  if (chatModelId && !manualPreference.includes(chatModelId)) {
    excluded.add(chatModelId);
  }
  const enabled = getEnabledModels().filter((m) => {
    const endpoint = resolveModelEndpoint(m.id);
    return Boolean(endpoint.baseUrl && endpoint.apiKey);
  });
  const preference = resolveVisionPreferenceIds(manualPreference);
  const messages = buildChatVisionDescribeMessages(images, options.userQuestion);

  let lastError: unknown;
  let lastModelId: string | undefined;
  for (let attempt = 0; attempt < MAX_VISION_MODEL_ATTEMPTS; attempt++) {
    const routed = routeModel(enabled, {
      hints: {
        vision_required: true,
        vision_preference: preference,
        ...(excluded.size ? { excluded_model_ids: [...excluded] } : {}),
        ...(attempt > 0 ? { fallback_after_failure: true } : {}),
      },
    });
    if (!routed?.modelId) {
      break;
    }
    const modelId = routed.modelId;
    excluded.add(modelId);
    lastModelId = modelId;
    const endpoint = resolveModelEndpoint(modelId);
    const client = getOpenAICompatibleClient(endpoint.baseUrl, endpoint.apiKey, {
      rejectUnauthorized: config.rejectUnauthorized,
      caBundlePath: config.caBundlePath,
    });
    try {
      const result = await client.chatCompletions(
        {
          model: resolveApiModelId(modelId),
          messages,
          temperature: 0.1,
          max_tokens: 1_500,
        },
        options.signal
      );
      const description = messageTextFromContent(result.message.content)
        .trim()
        .slice(0, MAX_DESCRIPTION_CHARS);
      return {
        text: formatChatVisionHelperPrompt({
          visionModelId: modelId,
          description,
        }),
        description,
        visionModelId: modelId,
      };
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      // One broken upstream (e.g. gateway 500 for a single model) must not
      // cost the image — try the next vision-capable model.
      const message = error instanceof Error ? error.message : String(error);
      lastError = new Error(`${modelId}: ${message}`);
    }
  }

  if (lastError) {
    throw lastError;
  }
  if (!lastModelId) {
    return {
      text: "[Harbor] Image attached, but no vision-capable model is enabled. Add Claude / GPT-4o / GLM-5V in Settings, or set Settings → Images (vision) preferred models.",
    };
  }
  return { text: "", visionModelId: lastModelId };
}


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
    resolveApiModelId,
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
      model: resolveApiModelId(routed.modelId),
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

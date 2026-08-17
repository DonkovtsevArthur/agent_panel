import type {
	GatewayProviderContext,
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@cline/shared";
import { isGlmModel } from "../model-facts";
import type { ProviderOptionsPatch } from "./utils";

/**
 * GLM thinking routing.
 *
 * Native Z.AI uses `thinking: { type: "enabled" | "disabled" }`.
 * Routed OpenAI-compatible GLM endpoints should use the generic `reasoning`
 * control shape. The return value is a normal provider-options patch so the
 * composer can rely on merge order instead of out-of-band flags.
 */

export const GLM_THINKING_ROUTING_METADATA: GatewayProviderMetadata = {
	routing: {
		reasoning: {
			format: "glm-thinking",
			routes: [
				{ matcher: "model-family", family: "glm" },
				{ matcher: "model-family", family: "glm-air" },
				{ matcher: "model-family", family: "glm-flash" },
			],
		},
	},
};

function buildNativeZaiThinkingOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === undefined) {
		return undefined;
	}
	return {
		thinking: {
			type: request.reasoning.enabled ? "enabled" : "disabled",
		},
	};
}

function buildRoutedGlmReasoningOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === true) {
		return {
			reasoning: {
				enabled: true,
			},
		};
	}
	if (request.reasoning?.enabled === false) {
		return {
			reasoning: {
				exclude: true,
			},
		};
	}
	return undefined;
}

export function buildNativeGlmThinkingProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
	// Native Z.AI GLM endpoints expect `thinking.type`; they do not accept the
	// routed `reasoning.enabled` / `reasoning.exclude` shape.
	const nativeThinking = buildNativeZaiThinkingOptions(request);
	// `openai-compatible` is a deprecated providerOptions key (AI SDK emits a
	// DeprecationWarning); its camelCase alias `openaiCompatible` is already
	// emitted above, so skip the raw-id + alias buckets for that provider id.
	if (!nativeThinking) {
		return undefined;
	}
	if (request.providerId === "openai-compatible") {
		return { openaiCompatible: nativeThinking };
	}
	return {
		openaiCompatible: nativeThinking,
		[request.providerId]: nativeThinking,
		...(providerOptionsKey !== request.providerId
			? { [providerOptionsKey]: nativeThinking }
			: {}),
	};
}

export function buildRoutedGlmReasoningProviderOptionsPatch(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	providerOptionsKey: string,
	options?: { includeProviderBuckets?: boolean },
): ProviderOptionsPatch | undefined {
	// Routed GLM endpoints stay OpenAI-compatible and use the generic
	// `reasoning` include/exclude shape instead of native Z.AI `thinking.type`.
	if (!isGlmModel(request, context)) {
		return undefined;
	}

	const routed = buildRoutedGlmReasoningOptions(request);
	if (!routed) {
		return undefined;
	}

	// `openai-compatible` is a deprecated providerOptions key (AI SDK emits a
	// DeprecationWarning); its camelCase alias `openaiCompatible` is already
	// emitted above, so skip the raw-id + alias buckets for that provider id.
	if (
		options?.includeProviderBuckets === false ||
		request.providerId === "openai-compatible"
	) {
		return { openaiCompatible: routed };
	}
	return {
		openaiCompatible: routed,
		[request.providerId]: routed,
		...(providerOptionsKey !== request.providerId
			? { [providerOptionsKey]: routed }
			: {}),
	};
}

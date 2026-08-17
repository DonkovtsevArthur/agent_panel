import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { type ToolSet, wrapLanguageModel } from "ai";
import { resolveApiKey } from "../http";
import {
	createMiniMaxThinkingFetch,
	miniMaxThinkingDisabledMiddleware,
} from "./minimax-thinking";
import type { ProviderFactoryResult } from "./types";

/**
 * Wraps a fetch function to make requests compatible with Anthropic-compatible
 * proxies (e.g. api.z.ai, LiteLLM, etc.) that don't support the full set of
 * Anthropic beta features.
 *
 * Problems fixed:
 * 1. `anthropic-beta` header contains very recent betas
 *    (`mid-conversation-system-2026-04-07`, `advanced-tool-use-2025-11-20`,
 *    `mid-conversation-tool-changes-2026-07-01`) that most proxies reject.
 * 2. `system` is sent as an array of content blocks
 *    (`[{type:"text",text:"..."}]`) which requires the
 *    `mid-conversation-system-2026-04-07` beta — proxies expect a plain string.
 */
function createProxyFetch(
	underlyingFetch: typeof fetch | undefined,
): typeof fetch {
	const f = underlyingFetch ?? globalThis.fetch;
	return async (input, init) => {
		// Only intercept POST requests to /v1/messages (Anthropic Messages API)
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (!url.includes("/v1/messages") || init?.method !== "POST") {
			return f(input, init);
		}

		// Clone headers and strip anthropic-beta
		const headers = new Headers(init?.headers);
		headers.delete("anthropic-beta");

		// Parse and fix the body
		let bodyStr = init?.body as string;
		if (bodyStr) {
			try {
				const body = JSON.parse(bodyStr);

				// Convert system from content blocks array to plain string
				if (Array.isArray(body.system)) {
					body.system = body.system
						.filter((block: { type: string }) => block.type === "text")
						.map((block: { text: string }) => block.text)
						.join("\n");
				}

				bodyStr = JSON.stringify(body);
			} catch {
				// Body is not JSON or unparseable — pass through as-is
			}
		}

		return f(input, {
			...init,
			headers,
			body: bodyStr,
		});
	};
}

export async function createAnthropicProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const isMiniMax = context.provider.id === "minimax";

	// Non-Anthropic endpoints (proxies like api.z.ai, LiteLLM, etc.) need a
	// compatibility wrapper that strips unsupported beta headers and converts
	// the system prompt from content blocks to a plain string.
	const isOfficialAnthropic =
		!config.baseUrl ||
		config.baseUrl.includes("api.anthropic.com");
	const baseFetch = isMiniMax
		? createMiniMaxThinkingFetch(config.fetch)
		: config.fetch;
	const fetchFn = isOfficialAnthropic
		? baseFetch
		: createProxyFetch(baseFetch);

	const provider = createAnthropic({
		apiKey,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: fetchFn,
		name: context.provider.id,
	});
	return {
		buildModelTools: (tools) => {
			const result: ToolSet = {};
			for (const tool of tools) {
				if (tool.name === "web_search") {
					result.web_search = provider.tools.webSearch_20250305({
						maxUses: tool.maxUses,
						allowedDomains: tool.allowedDomains,
						blockedDomains: tool.blockedDomains,
						userLocation: tool.userLocation
							? { type: "approximate", ...tool.userLocation }
							: undefined,
					});
				}
			}
			return result;
		},
		model: (modelId) => {
			const model = provider(modelId);
			return isMiniMax
				? wrapLanguageModel({
						model: model as LanguageModelV4,
						middleware: miniMaxThinkingDisabledMiddleware,
					})
				: model;
		},
	};
}

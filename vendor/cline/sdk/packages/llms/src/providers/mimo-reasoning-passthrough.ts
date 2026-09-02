/**
 * Xiaomi MiMo (OpenAI-compatible) requires `reasoning_content` on assistant
 * messages that carry `tool_calls` when replaying multi-turn tool history
 * in thinking mode — even if empty. Without it the API returns 400
 * "Param Incorrect" / "reasoning_content ... must be passed back".
 *
 * Applied at HTTP body transform time (after AI SDK message conversion).
 */
export function isMiMoWireModel(model: unknown): boolean {
	const id = String(model || "").toLowerCase();
	return /mimo|xiaomi/.test(id);
}

export function withMiMoReasoningContentPassthrough(
	body: Record<string, unknown>,
): Record<string, unknown> {
	if (!isMiMoWireModel(body.model)) {
		return body;
	}
	const messages = body.messages;
	if (!Array.isArray(messages)) {
		return body;
	}
	let changed = false;
	const next = messages.map((msg) => {
		if (!msg || typeof msg !== "object") {
			return msg;
		}
		const row = msg as Record<string, unknown>;
		if (row.role !== "assistant") {
		 return msg;
		}
		const toolCalls = row.tool_calls;
		if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
			return msg;
		}
		if (row.reasoning_content != null) {
			return msg;
		}
		changed = true;
		return { ...row, reasoning_content: "" };
	});
	return changed ? { ...body, messages: next } : body;
}

export function chainTransformRequestBody(
	...transforms: Array<(body: Record<string, unknown>) => Record<string, unknown>>
): (body: Record<string, unknown>) => Record<string, unknown> {
	return (body) => transforms.reduce((acc, fn) => fn(acc), body);
}

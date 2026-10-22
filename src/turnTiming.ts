/**
 * Wall-clock phase timing for one agent turn. Pure (no vscode import) so
 * tests can import it directly; the owner flushes `summary()` / `toolLines()`
 * to an output channel when the turn ends.
 */
export class TurnTiming {
	private readonly turnStart = performance.now();
	private readonly starts = new Map<string, number>();
	private readonly phases = new Map<string, number>();
	private readonly toolStarts = new Map<string, { name: string; t0: number }>();
	private readonly tools: Array<{ name: string; ms: number }> = [];
	private readonly notes = new Map<string, number>();

	/** Begin a named phase; the first start wins (ttft-style single-shot marks). */
	start(label: string): void {
		if (!this.starts.has(label)) {
			this.starts.set(label, performance.now());
		}
	}

	/** End a named phase; the first end wins so retries don't overwrite. */
	end(label: string): void {
		const t0 = this.starts.get(label);
		if (t0 === undefined || this.phases.has(label)) {
			return;
		}
		this.phases.set(label, Math.round(performance.now() - t0));
	}

	toolStart(toolCallId: string, name: string): void {
		if (!this.toolStarts.has(toolCallId)) {
			this.toolStarts.set(toolCallId, { name, t0: performance.now() });
		}
	}

	/** End a tool call; returns wall-clock ms, or undefined if unknown. */
	toolEnd(toolCallId: string): number | undefined {
		const entry = this.toolStarts.get(toolCallId);
		if (!entry) {
			return undefined;
		}
		this.toolStarts.delete(toolCallId);
		const ms = Math.round(performance.now() - entry.t0);
		this.tools.push({
			name: entry.name,
			ms,
		});
		return ms;
	}

	/**
	 * Attach a number to the summary (prompt size, tokens). `once` keeps the
	 * first value (first API call of the turn); otherwise the latest wins.
	 */
	note(label: string, value: number, once = false): void {
		if (!Number.isFinite(value) || (once && this.notes.has(label))) {
			return;
		}
		this.notes.set(label, Math.round(value));
	}

	/** Settled phase duration (ms), or undefined if not ended yet. */
	phaseMs(label: string): number | undefined {
		return this.phases.get(label);
	}

	summary(): string {
		const parts = [...this.phases.entries()].map(([k, v]) => `${k}=${v}ms`);
		parts.push(`total=${Math.round(performance.now() - this.turnStart)}ms`);
		for (const [k, v] of this.notes) {
			parts.push(`${k}=${v}`);
		}
		return parts.join(" ");
	}

	toolLines(): string[] {
		return this.tools.map((t) => `tool ${t.name} ${t.ms}ms`);
	}
}

/** Effective model request parameters of one turn (as Harbor hands them to Cline). */
export type TurnRequestParams = {
	model: string;
	provider?: string;
	protocol?: string;
	contextWindow?: number;
	maxInputTokens?: number;
	maxTokens?: number;
	/** undefined — reasoning_effort is not sent. */
	reasoningEffort?: string;
	/** undefined — temperature is not sent (provider default). */
	temperature?: number;
	/** Capability registry strips temperature for this model. */
	omitTemperature?: boolean;
};

/**
 * One log line with the request params, so review/quality differences between
 * models or providers can be traced to contextWindow / maxTokens / effort.
 */
export function formatTurnRequestParams(p: TurnRequestParams): string {
	const num = (v: number | undefined) =>
		typeof v === "number" && Number.isFinite(v) && v > 0 ? String(Math.round(v)) : "default";
	const parts = [`model=${p.model || "?"}`];
	if (p.provider) {
		parts.push(`provider=${p.provider}`);
	}
	parts.push(`protocol=${p.protocol || "openai-compatible"}`);
	parts.push(`contextWindow=${num(p.contextWindow)}`);
	parts.push(`maxInputTokens=${num(p.maxInputTokens)}`);
	parts.push(`maxTokens=${num(p.maxTokens)}`);
	parts.push(`reasoning_effort=${p.reasoningEffort || "off"}`);
	const temperature =
		typeof p.temperature === "number" && Number.isFinite(p.temperature)
			? String(p.temperature)
			: "not-sent";
	parts.push(`temperature=${temperature}${p.omitTemperature ? " (omitTemperature)" : ""}`);
	return parts.join(" ");
}

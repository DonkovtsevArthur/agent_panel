/** Normalize thinking/reasoning text from model APIs (Kimi etc.). */
export function normalizeReasoningContent(value: unknown): string {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  // Placeholder used when Kimi requires reasoning_content on tool calls.
  if (!text || text === " ") {
    return "";
  }
  return text;
}

/**
 * Join streaming deltas for a **single** completion.
 * Only treat `chunk` as a cumulative snapshot when it extends `previous`
 * from the start (`startsWith`). Never use bare `includes` — short tokens
 * like «а» / «ет» match earlier rounds and eat letters.
 */
export function appendReasoningDelta(
  previous: string,
  delta: unknown
): string {
  const prev = String(previous || "");
  const chunk = String(delta ?? "");
  if (!chunk) {
    return prev;
  }
  if (!prev) {
    return chunk;
  }
  // Cumulative snapshot for this request.
  if (chunk.startsWith(prev)) {
    return chunk;
  }
  // Exact echo of a suffix we already have.
  if (prev.endsWith(chunk)) {
    return prev;
  }
  return prev + chunk;
}

/** Merge complete reasoning blobs from separate API rounds. */
export function mergeReasoningChunks(
  previous: string,
  next: string
): string {
  const a = normalizeReasoningContent(previous);
  const b = normalizeReasoningContent(next);
  if (!b) {
    return a;
  }
  if (!a) {
    return b;
  }
  if (a === b || a.includes(b)) {
    return a;
  }
  if (b.includes(a) || b.startsWith(a)) {
    return b;
  }
  return `${a}\n\n${b}`;
}

/**
 * After a completion finishes, prefer the authoritative `reasoning_content`
 * field over the streamed assembly for that round.
 */
export function finalizeRoundReasoning(
  streamedRound: string,
  messageField: unknown
): string {
  const streamed = String(streamedRound || "");
  const final = normalizeReasoningContent(messageField);
  if (!final) {
    return normalizeReasoningContent(streamed) || streamed;
  }
  if (!streamed) {
    return final;
  }
  if (final === streamed || final.startsWith(streamed) || streamed.startsWith(final)) {
    return final.length >= streamed.length ? final : streamed;
  }
  // Prefer the completed message field — stream can be noisy.
  return final.length >= streamed.length * 0.5 ? final : streamed;
}

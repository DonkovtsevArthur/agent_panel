/**
 * Harbor transport for TabCoder-style inline completions.
 * Upstream used Vercel AI SDK `generateText` + ProfileService.
 * Harbor injects openai-compatible chat via this callback instead.
 */
export type HarborCompletionTransport = (args: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  signal: AbortSignal;
}) => Promise<string>;

export type HarborCompletionConfig = {
  /** When false / empty model, provider returns no suggestions. */
  isEnabled: () => boolean;
  /** Display label for status (model id). */
  getModelLabel: () => string;
  transport: HarborCompletionTransport;
};

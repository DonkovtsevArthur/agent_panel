/**
 * Hole-filler prompt types for TabCoder autocomplete.
 * Harbor patch: removed Vercel AI SDK (`ai` / `@ai-sdk/*`) imports.
 */

export interface ChatPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface HoleFiller {
  prompt(params: AutoCompleteContext): PromptArgs;
}

export type PromptArgs = {
  messages: ChatPromptMessage[];
};

export type AutoCompleteContext = {
  textBeforeCursor: string;
  textAfterCursor: string;
  currentLineText: string;
  filename?: string;
  language?: string;
};

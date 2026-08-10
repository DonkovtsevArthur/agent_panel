import { buildClineSystemPrompt } from "@cline/shared";
import type { DelegatedAgentRuntimeConfig } from "./delegated-agent";

/**
 * Always wrap delegated prompts in the full Cline system prompt.
 *
 * Harbor (and other openai-compatible hosts) previously returned the raw
 * spawn `systemPrompt` alone. That left children with a full tool list but no
 * tool-use protocol — Claude via LiteLLM/OpenRouter then fails the first
 * stream with `streaming_error` 400, while models that answer in plain text
 * (gpt/kimi) appear fine.
 */
function buildDelegatedClinePrompt(
	roleHeading: string,
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	const trimmedPrompt = prompt.trim();
	return buildClineSystemPrompt({
		ide: config.clineIdeName?.trim() || "VS Code",
		workspaceRoot: config.cwd?.trim() || "/",
		providerId: config.providerId,
		rules: [
			`# ${roleHeading}`,
			trimmedPrompt,
			"",
			"Focus only on this delegated task.",
			"The spawn_agent tool is NOT available in this sub-agent session — do not claim you can spawn further agents.",
		].join("\n"),
		platform: config.clinePlatform,
		metadata: config.workspaceMetadata,
	});
}

export function buildTeammateSystemPrompt(
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	return buildDelegatedClinePrompt("Team Teammate Role", prompt, config);
}

export function buildSubAgentSystemPrompt(
	// The prompt provided when spawning the subagent
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	return buildDelegatedClinePrompt("Sub-agent role", prompt, config);
}

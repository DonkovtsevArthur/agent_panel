/**
 * Ripgrep command resolution.
 *
 * IDE hosts (VS Code extension host, JetBrains sidecar) usually start with a
 * GUI PATH that has no `rg`, even when the IDE itself ships one. A host can
 * point the SDK at a concrete binary via `CLINE_RIPGREP_PATH`; otherwise the
 * bare `rg` from PATH is used. Set the variable before the first search so
 * the file-index worker (created lazily) inherits it.
 */
export const RIPGREP_PATH_ENV = "CLINE_RIPGREP_PATH";

export function ripgrepCommand(): string {
	const configured = process.env[RIPGREP_PATH_ENV]?.trim();
	return configured ? configured : "rg";
}

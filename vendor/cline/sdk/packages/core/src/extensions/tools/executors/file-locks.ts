/**
 * Per-file mutex for edit executors.
 *
 * Parallel tool execution (the agent runtime fires tool calls via Promise.all)
 * lets editor and apply_patch calls race on the same file. Both executors are
 * whole-file read-modify-write cycles, so racing same-file calls lose every
 * write except the last one while every tool result still reports success.
 * Serializing the read-modify-write per absolute path keeps cross-file batches
 * parallel and orders same-file batches against the freshly written content.
 */

import * as path from "node:path";

// Entries are deliberately never deleted: a caller queued behind a settled
// promise must stay ordered against callers that already chained onto it, so
// the map grows by one settled promise per unique file path per process.
const fileLocks = new Map<string, Promise<unknown>>();

/**
 * Run `fn` while holding the lock for `absolutePath`. Waiters execute in
 * arrival order; a rejected previous holder does not poison the chain.
 */
export function withFileLock<T>(
	absolutePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const key = path.resolve(absolutePath);
	const previous = fileLocks.get(key) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(fn);
	fileLocks.set(key, run);
	return run;
}

/**
 * Run `fn` while holding the locks for every path in `absolutePaths`.
 * Locks are always acquired in sorted key order so two overlapping
 * multi-file batches can never deadlock (editor holds one lock and never
 * nests; apply_patch is the only multi-lock caller).
 */
export function withFileLocks<T>(
	absolutePaths: readonly string[],
	fn: () => Promise<T>,
): Promise<T> {
	const keys = [...new Set(absolutePaths.map((p) => path.resolve(p)))].sort();
	let guarded = fn;
	for (const key of keys) {
		const inner = guarded;
		guarded = () => withFileLock(key, inner);
	}
	return guarded();
}

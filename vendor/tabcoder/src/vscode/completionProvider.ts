/**
 * Adapted from TabCoder `src/vscode/completionProvider.ts` (Apache-2.0).
 * Harbor: AI SDK / ProfileService removed — uses HarborCompletionConfig.transport.
 *
 * This file is the vendor reference implementation. Runtime is mirrored in
 * `src/tabAutocomplete.ts` (compiled by Harbor tsc; vendor/ is not in rootDir).
 */
export { type HarborCompletionConfig, type HarborCompletionTransport } from "./harborTransport";

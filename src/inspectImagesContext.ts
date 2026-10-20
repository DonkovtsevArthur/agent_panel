/**
 * Image data-URLs for inspect_images — separate from turnImageInject ALS.
 * Non-vision chat models must not get pixels on chat/completions (they deny
 * the image). The inspect tool still needs those bytes for the vision helper.
 */
import { createTurnScopedValue } from "./turnScopedValue";

const inspectable = createTurnScopedValue<string[]>();

function cleanImageUrls(urls: string[] | undefined): string[] {
  return (urls || []).filter(
    (url) => typeof url === "string" && url.startsWith("data:image/")
  );
}

export function withInspectableImages<T>(
  urls: string[],
  fn: () => Promise<T>
): Promise<T> {
  return inspectable.run(cleanImageUrls(urls), fn);
}

export function getInspectableImages(): string[] {
  return inspectable.get() ?? [];
}

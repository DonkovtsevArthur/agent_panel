/**
 * Image data-URLs for inspect_images — separate from turnImageInject ALS.
 * Non-vision chat models must not get pixels on chat/completions (they deny
 * the image). The inspect tool still needs those bytes for the vision helper.
 */
import { AsyncLocalStorage } from "async_hooks";

const inspectable = new AsyncLocalStorage<string[]>();
let fallback: string[] = [];

function cleanImageUrls(urls: string[] | undefined): string[] {
  return (urls || []).filter(
    (url) => typeof url === "string" && url.startsWith("data:image/")
  );
}

export function withInspectableImages<T>(
  urls: string[],
  fn: () => Promise<T>
): Promise<T> {
  const clean = cleanImageUrls(urls);
  const previous = fallback;
  fallback = clean;
  return inspectable.run(clean, fn).finally(() => {
    fallback = previous;
  });
}

export function getInspectableImages(): string[] {
  const fromAls = inspectable.getStore();
  if (fromAls?.length) {
    return fromAls;
  }
  return fallback;
}

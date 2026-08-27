/**
 * Harbor Agents — Figma plugin main thread.
 * Talks to the UI iframe via plugin messages; persists via figma.clientStorage.
 * Does not touch VS Code / JetBrains hosts.
 *
 * `__HTML_UI__` is injected at build time (JSON string banner) — do not use
 * esbuild `define` for HTML (it becomes a template literal and breaks).
 */

import { captureSelection } from "./selection";
import {
  FIGMA_STORAGE_SESSION,
  FIGMA_STORAGE_SETTINGS,
  FIGMA_STORAGE_UI_STATE,
} from "./storageKeys";

declare const __HTML_UI__: string;

figma.notify("Harbor Agents");

try {
  if (typeof __HTML_UI__ !== "string" || __HTML_UI__.length < 32) {
    throw new Error("UI HTML missing — run npm run build:figma");
  }
  figma.showUI(__HTML_UI__, {
    width: 420,
    height: 640,
    title: "Harbor Agents",
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  figma.notify("Harbor UI failed: " + message, { error: true });
  figma.closePlugin();
}

type UiToMain =
  | { type: "ready"; surface?: string }
  | { type: "figmaGetSelection"; requestId?: string }
  | { type: "figmaClientStorageGet"; key: string; requestId: string }
  | {
      type: "figmaClientStorageSet";
      key: string;
      value: unknown;
      requestId?: string;
    }
  | { type: "copyBrief"; text: string }
  | { type: "copyText"; text: string }
  | { type: "notify"; message: string; error?: boolean }
  | { type: "resize"; width: number; height: number };

function postToUi(msg: unknown): void {
  figma.ui.postMessage(msg);
}

async function pushSelection(requestId?: string): Promise<void> {
  try {
    const selection = await captureSelection();
    postToUi({
      type: "figmaSelectionChanged",
      selection,
      requestId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    figma.notify("Selection sync failed: " + message, { error: true });
  }
}

async function handleMessage(raw: unknown): Promise<void> {
  if (!raw || typeof raw !== "object") return;
  const msg = raw as UiToMain;
  try {
    switch (msg.type) {
      case "ready":
        await pushSelection();
        break;
      case "figmaGetSelection":
        await pushSelection(msg.requestId);
        break;
      case "figmaClientStorageGet": {
        const value = await figma.clientStorage.getAsync(msg.key);
        postToUi({
          type: "figmaClientStorageValue",
          key: msg.key,
          value: value ?? null,
          requestId: msg.requestId,
        });
        break;
      }
      case "figmaClientStorageSet": {
        const allowed =
          msg.key === FIGMA_STORAGE_SETTINGS ||
          msg.key === FIGMA_STORAGE_SESSION ||
          msg.key === FIGMA_STORAGE_UI_STATE ||
          (typeof msg.key === "string" && msg.key.startsWith("harbor.figma."));
        if (!allowed) {
          figma.notify("Blocked storage key (not harbor.figma.*)", {
            error: true,
          });
          break;
        }
        await figma.clientStorage.setAsync(msg.key, msg.value);
        postToUi({
          type: "figmaClientStorageSaved",
          key: msg.key,
          requestId: msg.requestId,
        });
        break;
      }
      case "copyBrief":
      case "copyText":
        postToUi({ type: "copied" });
        figma.notify(msg.type === "copyBrief" ? "Brief copied" : "Copied");
        break;
      case "notify":
        figma.notify(msg.message, { error: !!msg.error });
        break;
      case "resize":
        figma.ui.resize(
          Math.max(320, Math.min(900, msg.width | 0)),
          Math.max(400, Math.min(900, msg.height | 0))
        );
        break;
      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    figma.notify("Harbor error: " + message, { error: true });
  }
}

figma.ui.onmessage = (msg: unknown) => {
  void handleMessage(msg);
};

figma.on("selectionchange", () => {
  void pushSelection();
});

figma.on("currentpagechange", () => {
  void pushSelection();
});

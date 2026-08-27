/** Minimal Figma plugin typings — avoid publishing IDE deps into this host. */

interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FigmaBaseNode {
  id: string;
  name: string;
  type: string;
  parent: FigmaBaseNode | null;
}

interface FigmaSceneNode extends FigmaBaseNode {
  visible: boolean;
  absoluteBoundingBox: FigmaRect | null;
  exportAsync(settings: {
    format: "PNG" | "JPG" | "SVG" | "PDF";
    constraint?: { type: "SCALE" | "WIDTH" | "HEIGHT"; value: number };
  }): Promise<Uint8Array>;
}

interface FigmaChildrenMixin {
  children: ReadonlyArray<FigmaSceneNode>;
}

interface FigmaPageNode extends FigmaBaseNode, FigmaChildrenMixin {
  type: "PAGE";
  selection: ReadonlyArray<FigmaSceneNode>;
}

interface FigmaDocumentNode extends FigmaBaseNode {
  type: "DOCUMENT";
  children: ReadonlyArray<FigmaPageNode>;
}

interface FigmaPluginAPI {
  currentPage: FigmaPageNode;
  root: FigmaDocumentNode;
  fileKey: string | null;
  editorType?: "figma" | "figjam" | "dev" | string;
  currentUser: { id: string; name: string } | null;
  viewport: {
    zoom: number;
    scrollAndZoomIntoView(nodes: ReadonlyArray<FigmaSceneNode>): void;
  };
  mixed: symbol;
  closePlugin(message?: string): void;
  showUI(
    html: string,
    options?: {
      width?: number;
      height?: number;
      themeColors?: boolean;
      title?: string;
      visible?: boolean;
    }
  ): void;
  ui: {
    postMessage(pluginMessage: unknown, options?: { origin?: string }): void;
    onmessage:
      | ((
          pluginMessage: { pluginMessage: unknown },
          props?: unknown
        ) => void)
      | null;
    resize(width: number, height: number): void;
  };
  on(
    type: "selectionchange" | "currentpagechange" | "close",
    callback: () => void
  ): void;
  off(
    type: "selectionchange" | "currentpagechange" | "close",
    callback: () => void
  ): void;
  clientStorage: {
    getAsync(key: string): Promise<unknown>;
    setAsync(key: string, value: unknown): Promise<void>;
    keysAsync(): Promise<string[]>;
    deleteAsync(key: string): Promise<void>;
  };
  notify(message: string, options?: { timeout?: number; error?: boolean }): void;
  getNodeById(id: string): FigmaBaseNode | null;
  getNodeByIdAsync?(id: string): Promise<FigmaBaseNode | null>;
  setCurrentPageAsync?(page: FigmaPageNode): Promise<void>;
  loadFontAsync(font: { family: string; style: string }): Promise<void>;
  getSelectionColors?: () => unknown;
}

declare const figma: FigmaPluginAPI;
declare const __html__: string;

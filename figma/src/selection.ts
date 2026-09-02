/** Selection serialization for the designer chat context (main thread). */

export type FigmaSimplePaint = {
  type: "SOLID";
  r: number;
  g: number;
  b: number;
  a: number;
};

export type FigmaSelectionNode = {
  id: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  fills?: FigmaSimplePaint[];
  strokes?: FigmaSimplePaint[];
  layoutMode?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  componentId?: string;
  mainComponentName?: string;
  visible?: boolean;
  locked?: boolean;
  hiddenChildCount?: number;
  children?: FigmaSelectionNode[];
};

export type FigmaSelectionPayload = {
  fileKey?: string;
  fileName?: string;
  pageName?: string;
  selectedCount?: number;
  nodes: FigmaSelectionNode[];
  previewPngDataUrl?: string;
  /** Primary node id — UI can request preview lazily via figmaGetPreview. */
  primaryNodeId?: string;
  nodeUrl?: string;
  canWrite?: boolean;
};

const MAX_DEPTH = 3;
const MAX_CHILDREN = 16;
const TEXT_CHARS_MAX = 500;
/** Light id/name list — keep high so multi-select reaches the model. */
const MAX_SELECTION_ROOTS_LIGHT = 100;
const MAX_SELECTION_ROOTS_TREE = 4;
const PREVIEW_WIDTH = 360;
const PREVIEW_MAX_CHARS = 350000;

function paintToSimple(paint: {
  type: string;
  color?: { r: number; g: number; b: number };
  opacity?: number;
}): FigmaSimplePaint | null {
  if (paint.type !== "SOLID" || !paint.color) return null;
  const c = paint.color;
  return {
    type: "SOLID",
    r: Math.round(c.r * 1000) / 1000,
    g: Math.round(c.g * 1000) / 1000,
    b: Math.round(c.b * 1000) / 1000,
    a:
      paint.opacity != null
        ? Math.round(paint.opacity * 1000) / 1000
        : 1,
  };
}

function paintsToSimple(paints: unknown): FigmaSimplePaint[] | undefined {
  if (!paints || !Array.isArray(paints)) return undefined;
  const out: FigmaSimplePaint[] = [];
  for (let i = 0; i < paints.length && i < 8; i++) {
    const p = paintToSimple(paints[i] as {
      type: string;
      color?: { r: number; g: number; b: number };
      opacity?: number;
    });
    if (p) out.push(p);
  }
  return out.length ? out : undefined;
}

function enrichNodeDetails(
  node: FigmaSceneNode & Record<string, unknown>,
  out: FigmaSelectionNode,
  depth: number
): void {
  if (depth > 1) return;
  try {
    if ("fills" in node) {
      const fills = paintsToSimple(node.fills);
      if (fills) out.fills = fills;
    }
    if ("strokes" in node) {
      const strokes = paintsToSimple(node.strokes);
      if (strokes) out.strokes = strokes;
    }
  } catch {
    /* mixed */
  }
  if (node.type === "TEXT") {
    try {
      const chars = String((node as { characters?: string }).characters || "");
      out.characters =
        chars.length > TEXT_CHARS_MAX
          ? chars.slice(0, TEXT_CHARS_MAX) + "…"
          : chars;
      const fontSize = (node as { fontSize?: number | symbol }).fontSize;
      if (typeof fontSize === "number") out.fontSize = fontSize;
      const fontName = (node as {
        fontName?: { family: string; style: string } | symbol;
      }).fontName;
      if (fontName && typeof fontName === "object" && "family" in fontName) {
        out.fontName = { family: fontName.family, style: fontName.style };
      }
    } catch {
      /* font */
    }
  }
  if (
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "INSTANCE" ||
    node.type === "COMPONENT_SET"
  ) {
    const n = node as FigmaSceneNode & {
      layoutMode?: string;
      paddingTop?: number;
      paddingRight?: number;
      paddingBottom?: number;
      paddingLeft?: number;
      itemSpacing?: number;
      primaryAxisAlignItems?: string;
      counterAxisAlignItems?: string;
      componentId?: string;
      mainComponent?: { name?: string } | null;
    };
    try {
      if (n.layoutMode && n.layoutMode !== "NONE") {
        out.layoutMode = n.layoutMode;
        out.paddingTop = n.paddingTop;
        out.paddingRight = n.paddingRight;
        out.paddingBottom = n.paddingBottom;
        out.paddingLeft = n.paddingLeft;
        out.itemSpacing = n.itemSpacing;
        if (n.primaryAxisAlignItems) {
          out.primaryAxisAlignItems = n.primaryAxisAlignItems;
        }
        if (n.counterAxisAlignItems) {
          out.counterAxisAlignItems = n.counterAxisAlignItems;
        }
      }
    } catch {
      /* ignore */
    }
    if (node.type === "INSTANCE") {
      try {
        out.componentId = n.componentId;
        if (n.mainComponent?.name) out.mainComponentName = n.mainComponent.name;
      } catch {
        /* remote */
      }
    }
  }
}

function isHiddenLayer(node: FigmaSceneNode): boolean {
  try {
    return (node as FigmaSceneNode & { visible?: boolean }).visible === false;
  } catch {
    return false;
  }
}

function attachVisibilityFlags(
  node: FigmaSceneNode,
  out: FigmaSelectionNode
): void {
  try {
    if ((node as FigmaSceneNode & { visible?: boolean }).visible === false) {
      out.visible = false;
    }
  } catch {
    /* ignore */
  }
  try {
    if ((node as FigmaSceneNode & { locked?: boolean }).locked === true) {
      out.locked = true;
    }
  } catch {
    /* ignore */
  }
}

function serializeNode(
  node: FigmaSceneNode,
  depth: number
): FigmaSelectionNode {
  const box = node.absoluteBoundingBox;
  const out: FigmaSelectionNode = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  if (box) {
    out.width = Math.round(box.width);
    out.height = Math.round(box.height);
  }
  attachVisibilityFlags(node, out);
  enrichNodeDetails(node as FigmaSceneNode & Record<string, unknown>, out, depth);
  if (depth < MAX_DEPTH && "children" in node) {
    const kids = (node as FigmaSceneNode & { children?: ReadonlyArray<FigmaSceneNode> })
      .children;
    if (kids && kids.length > 0) {
      out.children = [];
      let hiddenSkipped = 0;
      let truncatedMore = 0;
      for (let i = 0; i < kids.length; i++) {
        if (isHiddenLayer(kids[i])) {
          hiddenSkipped++;
          continue;
        }
        if (out.children.length < MAX_CHILDREN) {
          out.children.push(serializeNode(kids[i], depth + 1));
        } else {
          truncatedMore++;
        }
      }
      if (hiddenSkipped > 0) {
        out.hiddenChildCount = hiddenSkipped;
      }
      if (truncatedMore > 0) {
        out.children.push({
          id: `${node.id}__more`,
          name: `… +${truncatedMore} more`,
          type: "TRUNCATED",
        });
      }
    }
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63];
    out += chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? chars[triple & 63] : "=";
  }
  return out;
}

function nodeDeepLink(fileKey: string | null, nodeId: string): string | undefined {
  if (!fileKey) return undefined;
  const nid = nodeId.replace(/:/g, "-");
  return `https://www.figma.com/design/${fileKey}?node-id=${encodeURIComponent(nid)}`;
}

export async function captureSelection(): Promise<FigmaSelectionPayload> {
  const selection = figma.currentPage.selection as ReadonlyArray<FigmaSceneNode>;
  const fileKey = figma.fileKey;
  const nodes: FigmaSelectionNode[] = [];
  const rootLimit = Math.min(selection.length, MAX_SELECTION_ROOTS_LIGHT);
  for (let i = 0; i < rootLimit; i++) {
    if (i < MAX_SELECTION_ROOTS_TREE) {
      nodes.push(serializeNode(selection[i], 0));
    } else {
      const box = selection[i].absoluteBoundingBox;
      nodes.push({
        id: selection[i].id,
        name: selection[i].name,
        type: selection[i].type,
        ...(box
          ? {
              width: Math.round(box.width),
              height: Math.round(box.height),
            }
          : {}),
      });
    }
  }
  if (selection.length > MAX_SELECTION_ROOTS_LIGHT) {
    nodes.push({
      id: "__more_roots",
      name: `… +${selection.length - MAX_SELECTION_ROOTS_LIGHT} more selected`,
      type: "TRUNCATED",
    });
  }
  const primary = selection[0];
  return {
    fileKey: fileKey || undefined,
    fileName: figma.root.name,
    pageName: figma.currentPage.name,
    selectedCount: selection.length,
    nodes,
    primaryNodeId: primary?.id,
    nodeUrl: primary ? nodeDeepLink(fileKey, primary.id) : undefined,
  };
}

/** Generate preview PNG on demand (called by UI before sending a message). */
export async function capturePreviewForNode(
  nodeId: string
): Promise<string | undefined> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) return undefined;
    const sceneNode = node as FigmaSceneNode;
    if (!("exportAsync" in sceneNode)) return undefined;
    const bytes = await sceneNode.exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: PREVIEW_WIDTH },
    });
    if (bytes && bytes.length <= 280000) {
      const url = `data:image/png;base64,${bytesToBase64(bytes)}`;
      if (url.length <= PREVIEW_MAX_CHARS) return url;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Harbor Agents - Figma main logic (source).
 * Built into code.js: `npm run build:figma`
 * Prefer manifest `__html__` (ui.html). In Dev Mode it is often empty for large UI -
 * then use chunked `__HTML_UI__` injected by the build (avoids one giant string literal).
 * Dev Mode: manifest needs capabilities: ["inspect"]. Writes require Design mode.
 */
/* global __html__, __HTML_UI__ */

figma.notify("Harbor Agents");

try {
  var html =
    typeof __html__ === "string" && __html__.length > 32 ? __html__ : null;
  if (
    !html &&
    typeof __HTML_UI__ === "string" &&
    __HTML_UI__.length > 32
  ) {
    html = __HTML_UI__;
  }
  if (!html) {
    figma.notify("UI missing - run npm run build:figma", { error: true });
    html =
      "<html><body style=\"margin:0;font:14px -apple-system,sans-serif;padding:16px;background:#1e1e1e;color:#fff\">" +
      "<h2 style=\"margin:0 0 8px\">Harbor Agents</h2>" +
      "<p style=\"margin:0;opacity:.85\">Rebuild the plugin (build:figma) and re-import manifest.</p>" +
      "</body></html>";
  }
  figma.showUI(html, {
    width: PANEL_DEFAULT_W,
    height: PANEL_DEFAULT_H,
    title: "Harbor Agents",
  });
} catch (err) {
  figma.notify(
    "showUI failed: " + (err && err.message ? err.message : String(err)),
    { error: true }
  );
}

var FIGMA_STORAGE_SETTINGS = "harbor.figma.settings";
var FIGMA_STORAGE_SESSION = "harbor.figma.session";
var FIGMA_STORAGE_UI_STATE = "harbor.figma.uiState";
var PANEL_MIN_W = 320;
var PANEL_MIN_H = 400;
var PANEL_MAX_W = 1200;
var PANEL_MAX_H = 1000;
var PANEL_DEFAULT_W = 520;
var PANEL_DEFAULT_H = 820;
var MAX_DEPTH = 2;
/** Deeper inspect when a single frame is selected for a chat turn. */
var MAX_DEPTH_SINGLE_ROOT = 4;
var MAX_CHILDREN = 12;
/** When exactly one root is selected, include more direct children in the tree. */
var MAX_CHILDREN_SINGLE_ROOT = 30;
var APPLY_EDITS_MAX = 80;
var BATCH_TOOLS_MAX = 12;
var TEXT_CHARS_MAX = 400;
/**
 * Light summaries (id/name/type/size) are tiny — include many so multi-select
 * (e.g. 18 frames) reaches the model. Deep trees stay capped separately.
 */
var MAX_SELECTION_ROOTS_LIGHT = 100;
/** Cap deep serializeNode trees (children blow up postMessage). */
var MAX_SELECTION_ROOTS_TREE = 4;
/** Cap FRAME/COMPONENT rows from figma_list_frames. */
var MAX_LIST_FRAMES = 200;
/** Thumbnail width — only for small nodes; large frames skip export entirely. */
var PREVIEW_WIDTH = 240;
var PREVIEW_MAX_AREA = 640 * 640;
var PREVIEW_MAX_CHARS = 120000;
var SELECTION_DEBOUNCE_MS = 250;
var selectionGen = 0;
var selectionTimer = null;

function postToUi(msg) {
  try {
    figma.ui.postMessage(msg);
  } catch (_e) {
    /* ui not ready / message too large */
  }
}

function bytesToBase64(bytes) {
  var chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i];
    var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63];
    out += chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? chars[triple & 63] : "=";
  }
  return out;
}

function canWriteCanvas() {
  try {
    if (typeof figma.editorType === "string" && figma.editorType === "dev") {
      return false;
    }
  } catch (_e) {
    /* ignore */
  }
  return true;
}

function paintToSimple(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  var c = paint.color;
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

function paintsToSimple(paints) {
  if (!paints || paints === figma.mixed) return undefined;
  var out = [];
  for (var i = 0; i < paints.length && i < 8; i++) {
    var p = paintToSimple(paints[i]);
    if (p) out.push(p);
  }
  return out.length ? out : undefined;
}

var MAX_TEXT_SEARCH_DEPTH = 12;

function enrichNodeDetails(node, out, depth) {
  if (node.type === "TEXT") {
    try {
      var chars = String(node.characters || "");
      out.characters =
        chars.length > TEXT_CHARS_MAX
          ? chars.slice(0, TEXT_CHARS_MAX) + "..."
          : chars;
      if (node.fontSize !== figma.mixed && typeof node.fontSize === "number") {
        out.fontSize = node.fontSize;
      }
      if (node.fontName !== figma.mixed && node.fontName) {
        out.fontName = {
          family: node.fontName.family,
          style: node.fontName.style,
        };
      }
    } catch (_eText) {
      /* font not loaded */
    }
    return;
  }
  if (depth > 1) return;
  try {
    if ("fills" in node) {
      var fills = paintsToSimple(node.fills);
      if (fills) out.fills = fills;
    }
    if ("strokes" in node) {
      var strokes = paintsToSimple(node.strokes);
      if (strokes) out.strokes = strokes;
    }
    if ("strokeWeight" in node && node.strokeWeight !== figma.mixed) {
      out.strokeWeight = node.strokeWeight;
    }
    if ("opacity" in node && typeof node.opacity === "number") {
      out.opacity = Math.round(node.opacity * 1000) / 1000;
    }
    if ("cornerRadius" in node && node.cornerRadius !== figma.mixed) {
      out.cornerRadius = node.cornerRadius;
    } else if ("topLeftRadius" in node) {
      out.cornerRadius = {
        topLeft: node.topLeftRadius,
        topRight: node.topRightRadius,
        bottomRight: node.bottomRightRadius,
        bottomLeft: node.bottomLeftRadius,
      };
    }
  } catch (_e) {
    /* mixed / remote */
  }
  if (
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "INSTANCE" ||
    node.type === "COMPONENT_SET"
  ) {
    try {
      if (node.layoutMode && node.layoutMode !== "NONE") {
        out.layoutMode = node.layoutMode;
        out.paddingTop = node.paddingTop;
        out.paddingRight = node.paddingRight;
        out.paddingBottom = node.paddingBottom;
        out.paddingLeft = node.paddingLeft;
        out.itemSpacing = node.itemSpacing;
        if (node.primaryAxisAlignItems) {
          out.primaryAxisAlignItems = node.primaryAxisAlignItems;
        }
        if (node.counterAxisAlignItems) {
          out.counterAxisAlignItems = node.counterAxisAlignItems;
        }
      }
    } catch (_e3) {
      /* ignore */
    }
  }
  try {
    if ("layoutAlign" in node && node.layoutAlign) {
      out.layoutAlign = node.layoutAlign;
    }
    if ("layoutGrow" in node && typeof node.layoutGrow === "number") {
      out.layoutGrow = node.layoutGrow;
    }
    if ("layoutSizingHorizontal" in node && node.layoutSizingHorizontal) {
      out.layoutSizingHorizontal = node.layoutSizingHorizontal;
    }
    if ("layoutSizingVertical" in node && node.layoutSizingVertical) {
      out.layoutSizingVertical = node.layoutSizingVertical;
    }
    if ("constraints" in node && node.constraints) {
      out.constraints = {
        horizontal: node.constraints.horizontal,
        vertical: node.constraints.vertical,
      };
    }
  } catch (_eLayout) {
    /* ignore */
  }
  if (node.type === "INSTANCE") {
    try {
      // Do not read mainComponent — remote instances can hang/crash the sandbox.
      out.componentId = node.componentId || undefined;
    } catch (_e4) {
      /* ignore */
    }
  }
}

function attachNodeGeometry(node, out) {
  try {
    if ("x" in node && typeof node.x === "number") {
      out.x = Math.round(node.x);
    }
    if ("y" in node && typeof node.y === "number") {
      out.y = Math.round(node.y);
    }
  } catch (_eRel) {
    /* ignore */
  }
  try {
    var box = node.absoluteBoundingBox;
    if (box) {
      out.width = Math.round(box.width);
      out.height = Math.round(box.height);
      // Page-absolute top-left — use this for left/right layout, not width math.
      out.absX = Math.round(box.x);
      out.absY = Math.round(box.y);
    } else if ("width" in node && typeof node.width === "number") {
      out.width = Math.round(node.width);
      if ("height" in node && typeof node.height === "number") {
        out.height = Math.round(node.height);
      }
    }
  } catch (_eBox) {
    /* ignore */
  }
  return out;
}

/** Layers panel eye-off — omit from trees/lists so the agent does not edit them. */
function isHiddenLayer(node) {
  try {
    return node && node.visible === false;
  } catch (_e) {
    return false;
  }
}

function attachVisibilityFlags(node, out) {
  try {
    if (node.visible === false) out.visible = false;
  } catch (_eVis) {
    /* ignore */
  }
  try {
    if (node.locked === true) out.locked = true;
  } catch (_eLock) {
    /* ignore */
  }
  return out;
}

function serializeNode(node, depth, opts) {
  opts = opts || {};
  var maxChildren =
    opts.maxChildren != null ? opts.maxChildren : MAX_CHILDREN;
  var maxDepth = opts.maxDepth != null ? opts.maxDepth : MAX_DEPTH;
  var out = { id: node.id, name: node.name, type: node.type };
  attachNodeGeometry(node, out);
  attachVisibilityFlags(node, out);
  enrichNodeDetails(node, out, depth);
  if (depth < maxDepth && node.children && node.children.length) {
    var kids = node.children;
    out.children = [];
    var hiddenSkipped = 0;
    var truncatedMore = 0;
    for (var i = 0; i < kids.length; i++) {
      if (isHiddenLayer(kids[i])) {
        hiddenSkipped++;
        continue;
      }
      if (out.children.length < maxChildren) {
        out.children.push(serializeNode(kids[i], depth + 1, opts));
      } else {
        truncatedMore++;
      }
    }
    if (hiddenSkipped > 0) {
      out.hiddenChildCount = hiddenSkipped;
    }
    if (truncatedMore > 0) {
      out.children.push({
        id: node.id + "__more",
        name: "... +" + truncatedMore + " more",
        type: "TRUNCATED",
      });
    }
  }
  return out;
}

function normalizeInspectFieldList(fields) {
  if (!fields) return null;
  var list = Array.isArray(fields) ? fields : [fields];
  var set = {};
  for (var i = 0; i < list.length; i++) {
    var f = String(list[i] || "").toLowerCase();
    if (!f) continue;
    if (f === "children" || f === "child") set.children = true;
    if (f === "geometry" || f === "geom") set.geometry = true;
    if (f === "layout") set.layout = true;
    if (f === "text") set.text = true;
    if (f === "style" || f === "fills") set.style = true;
    if (f === "meta") set.meta = true;
  }
  var keys = Object.keys(set);
  return keys.length ? set : null;
}

function serializeNodeFields(node, depth, args) {
  var fields = normalizeInspectFieldList(args.fields);
  var includeChildren = !!(fields && fields.children);
  var maxDepth =
    args.maxDepth != null
      ? Number(args.maxDepth)
      : includeChildren
        ? 2
        : 0;
  var maxChildren =
    args.maxChildren != null ? Number(args.maxChildren) : MAX_CHILDREN;
  var out = { id: node.id, name: node.name, type: node.type };
  if (!fields || fields.geometry) {
    attachNodeGeometry(node, out);
    try {
      if ("constraints" in node && node.constraints) {
        out.constraints = {
          horizontal: node.constraints.horizontal,
          vertical: node.constraints.vertical,
        };
      }
    } catch (_eC) {
      /* ignore */
    }
  }
  if (!fields || fields.meta) {
    attachVisibilityFlags(node, out);
  }
  if (!fields || fields.text) {
    enrichNodeDetails(node, out, 0);
    if (fields && !fields.style) {
      delete out.fills;
      delete out.strokes;
      delete out.strokeWeight;
      delete out.opacity;
      delete out.cornerRadius;
    }
    if (fields && !fields.layout) {
      delete out.layoutMode;
      delete out.paddingTop;
      delete out.paddingRight;
      delete out.paddingBottom;
      delete out.paddingLeft;
      delete out.itemSpacing;
      delete out.primaryAxisAlignItems;
      delete out.counterAxisAlignItems;
    }
    if (fields && !fields.text && node.type === "TEXT") {
      delete out.characters;
      delete out.fontSize;
      delete out.fontName;
    }
  } else if (!fields || fields.style || fields.layout) {
    enrichNodeDetails(node, out, fields && fields.layout ? 1 : 0);
    if (fields && !fields.text) {
      delete out.characters;
      delete out.fontSize;
      delete out.fontName;
    }
    if (fields && !fields.style) {
      delete out.fills;
      delete out.strokes;
      delete out.strokeWeight;
      delete out.opacity;
      delete out.cornerRadius;
    }
  }
  if (includeChildren && depth < maxDepth && node.children && node.children.length) {
    out.children = [];
    var truncatedMore = 0;
    for (var i = 0; i < node.children.length; i++) {
      if (isHiddenLayer(node.children[i])) continue;
      if (out.children.length < maxChildren) {
        out.children.push(
          serializeNodeFields(node.children[i], depth + 1, {
            fields: args.fields,
            maxDepth: maxDepth,
            maxChildren: maxChildren,
          })
        );
      } else {
        truncatedMore++;
      }
    }
    if (truncatedMore > 0) {
      out.children.push({
        id: node.id + "__more",
        name: "... +" + truncatedMore + " more",
        type: "TRUNCATED",
      });
    }
  }
  return out;
}

function nodeDeepLink(fileKey, nodeId) {
  if (!fileKey || !nodeId) return undefined;
  return (
    "https://www.figma.com/design/" +
    fileKey +
    "?node-id=" +
    encodeURIComponent(String(nodeId).replace(/:/g, "-"))
  );
}

/** id/name/type/size/position — safe for selectionchange (no children, no export). */
function summarizeNodeLight(node) {
  var out = { id: node.id, name: node.name, type: node.type };
  attachNodeGeometry(node, out);
  attachVisibilityFlags(node, out);
  return out;
}

/**
 * @param {{ withTree?: boolean, withPreview?: boolean }} opts
 * Live selection / Send: light for all roots. Tool figma_get_selection: deep tree
 * for the first few roots, light for the rest (so multi-select ids stay visible).
 */
function captureSelection(opts) {
  opts = opts || {};
  var withTree = !!opts.withTree;
  var withPreview = !!opts.withPreview;
  var selection = figma.currentPage.selection;
  var fileKey = figma.fileKey;
  var nodes = [];
  var rootLimit = Math.min(selection.length, MAX_SELECTION_ROOTS_LIGHT);
  var treeLimit = withTree ? MAX_SELECTION_ROOTS_TREE : 0;
  var singleRootExpanded = withTree && selection.length === 1;
  var serializeOpts = singleRootExpanded
    ? { maxChildren: MAX_CHILDREN_SINGLE_ROOT, maxDepth: MAX_DEPTH_SINGLE_ROOT }
    : undefined;
  for (var i = 0; i < rootLimit; i++) {
    try {
      if (withTree && i < treeLimit) {
        nodes.push(serializeNode(selection[i], 0, serializeOpts));
      } else {
        nodes.push(summarizeNodeLight(selection[i]));
      }
    } catch (_e) {
      try {
        nodes.push(summarizeNodeLight(selection[i]));
      } catch (_e2) {
        nodes.push({
          id: String(selection[i] && selection[i].id),
          name: "(unreadable)",
          type: "UNKNOWN",
        });
      }
    }
  }
  if (selection.length > MAX_SELECTION_ROOTS_LIGHT) {
    nodes.push({
      id: "__more_roots",
      name: "... +" + (selection.length - MAX_SELECTION_ROOTS_LIGHT) + " more selected",
      type: "TRUNCATED",
    });
  }
  var primary = selection[0];
  var base = {
    fileKey: fileKey || undefined,
    fileName: figma.root.name,
    pageName: figma.currentPage.name,
    selectedCount: selection.length,
    nodes: nodes,
    previewPngDataUrl: undefined,
    nodeUrl: primary ? nodeDeepLink(fileKey, primary.id) : undefined,
    canWrite: canWriteCanvas(),
  };
  if (
    opts.withLayoutHealth &&
    primary &&
    "children" in primary &&
    primary.children &&
    primary.children.length
  ) {
    try {
      base.layoutHealth = buildLayoutCheck(primary);
    } catch (_eLH) {
      /* ignore */
    }
  }
  if (!withPreview || !primary || !("exportAsync" in primary)) {
    return Promise.resolve(base);
  }
  var area = 0;
  try {
    var box = primary.absoluteBoundingBox;
    if (box) area = box.width * box.height;
  } catch (_e3) {
    area = 0;
  }
  // Large / complex frames: exportAsync often kills the plugin sandbox.
  if (!area || area > PREVIEW_MAX_AREA) {
    return Promise.resolve(base);
  }
  return primary
    .exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: PREVIEW_WIDTH },
    })
    .then(function (bytes) {
      if (!bytes || bytes.length > 90000) {
        return base;
      }
      var url = "data:image/png;base64," + bytesToBase64(bytes);
      if (url.length > PREVIEW_MAX_CHARS) {
        return base;
      }
      base.previewPngDataUrl = url;
      return base;
    })
    .catch(function () {
      return base;
    });
}

function pushSelection(requestId, opts) {
  var gen = ++selectionGen;
  var captureOpts = opts || { withTree: false, withPreview: false };
  return captureSelection(captureOpts)
    .then(function (selection) {
      if (gen !== selectionGen) {
        return;
      }
      postToUi({
        type: "figmaSelectionChanged",
        selection: selection,
        requestId: requestId,
      });
    })
    .catch(function (err) {
      if (gen !== selectionGen) {
        return;
      }
      // Never throw out of selection sync — keep plugin alive.
      postToUi({
        type: "figmaSelectionChanged",
        selection: {
          nodes: [],
          pageName: figma.currentPage && figma.currentPage.name,
          canWrite: canWriteCanvas(),
        },
        requestId: requestId,
        error: err && err.message ? err.message : String(err),
      });
    });
}

function schedulePushSelection() {
  if (selectionTimer) {
    clearTimeout(selectionTimer);
  }
  selectionTimer = setTimeout(function () {
    selectionTimer = null;
    try {
      // Live updates: never export PNG, never deep-serialize.
      pushSelection(undefined, { withTree: false, withPreview: false });
    } catch (_e) {
      /* keep plugin alive */
    }
  }, SELECTION_DEBOUNCE_MS);
}

function resolveNode(nodeId) {
  if (!nodeId || typeof nodeId !== "string") {
    return Promise.reject(new Error("nodeId is required"));
  }
  if (typeof figma.getNodeByIdAsync === "function") {
    return figma.getNodeByIdAsync(nodeId).then(function (node) {
      if (!node) throw new Error("Node not found: " + nodeId);
      return node;
    });
  }
  var sync = figma.getNodeById(nodeId);
  if (!sync) return Promise.reject(new Error("Node not found: " + nodeId));
  return Promise.resolve(sync);
}

function focusNode(nodeId) {
  return resolveNode(nodeId).then(function (node) {
    if (!("type" in node) || node.type === "PAGE" || node.type === "DOCUMENT") {
      throw new Error("Cannot focus page/document node");
    }
    var page = node.parent;
    while (page && page.type !== "PAGE") {
      page = page.parent;
    }
    if (page && page.type === "PAGE" && page !== figma.currentPage) {
      if (typeof figma.setCurrentPageAsync === "function") {
        return figma.setCurrentPageAsync(page).then(function () {
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          return { id: node.id, name: node.name, type: node.type };
        });
      }
    }
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    return { id: node.id, name: node.name, type: node.type };
  });
}

function inspectNode(nodeId, args) {
  args = args && typeof args === "object" ? args : {};
  return resolveNode(nodeId).then(function (node) {
    if (args.fields && (Array.isArray(args.fields) ? args.fields.length : true)) {
      return serializeNodeFields(node, 0, args);
    }
    var depthOpts = {
      maxDepth:
        args.maxDepth != null ? Number(args.maxDepth) : MAX_DEPTH,
      maxChildren:
        args.maxChildren != null
          ? Number(args.maxChildren)
          : MAX_CHILDREN,
    };
    return serializeNode(node, 0, depthOpts);
  });
}

function requireWrite() {
  if (!canWriteCanvas()) {
    throw new Error(
      "Canvas writes are unavailable in Dev Mode - open the file in Design mode."
    );
  }
}

function assertNodeWritable(node) {
  if (!node) return;
  if ("locked" in node && node.locked) {
    throw new Error("Node is locked: " + node.id);
  }
  var parent = node.parent;
  while (parent && parent.type !== "DOCUMENT") {
    if ("locked" in parent && parent.locked) {
      throw new Error("Parent layer is locked: " + parent.id);
    }
    parent = parent.parent;
  }
}

/** Group subsequent canvas mutations into one Edit → Undo step in Figma. */
function commitCanvasUndo() {
  try {
    if (typeof figma.commitUndo === "function") {
      figma.commitUndo();
    }
  } catch (_eUndo) {
    /* ignore */
  }
}

function beginCanvasWrite(opts) {
  requireWrite();
  if (!(opts && opts.skipUndo)) {
    commitCanvasUndo();
  }
}

var CANVAS_WRITE_TOOLS = {
  figma_set_name: 1,
  figma_set_text: 1,
  figma_set_fills: 1,
  figma_set_auto_layout: 1,
  figma_set_prototype_link: 1,
  figma_set_prototype_flow: 1,
  figma_clear_reactions: 1,
  figma_create_node: 1,
  figma_duplicate_node: 1,
  figma_delete_node: 1,
  figma_set_geometry: 1,
  figma_reparent_node: 1,
  figma_set_opacity: 1,
  figma_set_corner_radius: 1,
  figma_copy_styles: 1,
  figma_set_stroke: 1,
  figma_set_font: 1,
  figma_apply_edits: 1,
  figma_swap_component: 1,
  figma_bind_variable: 1,
  figma_align_in_frame: 1,
  figma_set_layout_child: 1,
  figma_resize_frame: 1,
  figma_batch_text_replace: 1,
  figma_match_layout: 1,
  figma_set_constraints: 1,
  figma_set_effects: 1,
  figma_group_nodes: 1,
  figma_ungroup_node: 1,
  figma_set_layout_grid: 1,
  figma_apply_recipe: 1,
  figma_batch_tools: 1,
  figma_apply_to_children: 1,
  figma_nudge_nodes: 1,
};

function solidPaintFromArgs(color) {
  if (!color || typeof color !== "object") {
    throw new Error("fills requires { r, g, b, a? } with 0-1 channels");
  }
  var a = color.a != null ? Number(color.a) : 1;
  return {
    type: "SOLID",
    color: {
      r: Number(color.r) || 0,
      g: Number(color.g) || 0,
      b: Number(color.b) || 0,
    },
    opacity: isNaN(a) ? 1 : a,
  };
}

var availableFontsCache = null;
var FALLBACK_FONTS = [
  { family: "Inter", style: "Regular" },
  { family: "Roboto", style: "Regular" },
];

function normalizeFontToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFontFamily(value) {
  return normalizeFontToken(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFontStyle(value) {
  var s = normalizeFontToken(value);
  if (/^(regular|normal|roman|book|text|400|default)$/.test(s)) {
    return "regular";
  }
  if (/^(medium|500)$/.test(s)) {
    return "medium";
  }
  if (/^(semibold|demibold|semi bold|600)$/.test(s)) {
    return "semibold";
  }
  if (/^(bold|700)$/.test(s)) {
    return "bold";
  }
  if (/^(light|300)$/.test(s)) {
    return "light";
  }
  if (/^(extralight|extra light|200)$/.test(s)) {
    return "extralight";
  }
  if (/^(black|heavy|900)$/.test(s)) {
    return "black";
  }
  return s;
}

function stylesCompatible(requestedStyle, candidateStyle) {
  var rs = normalizeFontStyle(requestedStyle);
  var cs = normalizeFontStyle(candidateStyle);
  if (rs === cs) return true;
  if (rs === "regular" && cs === "medium") return true;
  return normalizeFontToken(requestedStyle) === normalizeFontToken(candidateStyle);
}

function fontKey(font) {
  return normalizeFontFamily(font.family) + "\0" + normalizeFontStyle(font.style);
}

function uniqueFonts(fonts) {
  var seen = {};
  var out = [];
  for (var i = 0; i < fonts.length; i++) {
    var f = fonts[i];
    if (!f || !f.family) continue;
    var k = fontKey(f);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(f);
  }
  return out;
}

function collectTextNodeFonts(textNode) {
  var fonts = [];
  try {
    if (typeof textNode.getStyledTextSegments === "function") {
      var segments = textNode.getStyledTextSegments(["fontName"]);
      for (var i = 0; i < segments.length; i++) {
        var fn = segments[i].fontName;
        if (fn && fn !== figma.mixed && fn.family) fonts.push(fn);
      }
    } else if (typeof textNode.getRangeAllFontNames === "function") {
      fonts = textNode.getRangeAllFontNames(0, textNode.characters.length);
    } else if (textNode.fontName !== figma.mixed && textNode.fontName) {
      fonts = [textNode.fontName];
    }
  } catch (_e) {
    if (textNode.fontName !== figma.mixed && textNode.fontName) {
      fonts = [textNode.fontName];
    }
  }
  return uniqueFonts(fonts);
}

function getAvailableFonts() {
  if (availableFontsCache) return Promise.resolve(availableFontsCache);
  if (typeof figma.listAvailableFontsAsync !== "function") {
    return Promise.resolve([]);
  }
  return figma.listAvailableFontsAsync().then(function (list) {
    availableFontsCache = list || [];
    return availableFontsCache;
  });
}

function combinedFamilyName(family, style) {
  var f = String(family || "").trim();
  var s = String(style || "").trim();
  if (!s || normalizeFontStyle(s) === "regular") {
    return f;
  }
  return f + " " + s;
}

/** Same face in Figma picker vs legacy TTF naming (Grtsk Peta + Semibold). */
function fontsEquivalent(requested, candidate) {
  var rf = normalizeFontFamily(requested.family);
  var cf = normalizeFontFamily(candidate.family);
  if (rf === cf && stylesCompatible(requested.style, candidate.style)) {
    return true;
  }
  var reqCombined = normalizeFontFamily(
    combinedFamilyName(requested.family, requested.style)
  );
  var cs = normalizeFontStyle(candidate.style);
  if (cf === reqCombined && (cs === "regular" || cs === "medium")) {
    return true;
  }
  var candCombined = normalizeFontFamily(
    combinedFamilyName(candidate.family, candidate.style)
  );
  if (candCombined === rf && stylesCompatible(requested.style, candidate.style)) {
    return true;
  }
  return false;
}

function expandFontCandidates(requested) {
  var family = String(requested.family || "").trim();
  var style = String(requested.style || "Regular").trim();
  var out = [requested];
  var seen = {};
  seen[fontKey(requested)] = true;
  function push(f) {
    var k = fontKey(f);
    if (seen[k]) return;
    seen[k] = true;
    out.push(f);
  }
  push({ family: combinedFamilyName(family, style), style: "Regular" });
  push({ family: combinedFamilyName(family, style), style: style });
  var rs = normalizeFontStyle(style);
  if (rs !== "regular") {
    var rf = normalizeFontFamily(family);
    if (rf.endsWith(" " + rs)) {
      push({ family: family, style: "Regular" });
    }
  }
  return out;
}

function matchAvailableFont(requested, available) {
  var i;
  var familyStyleMatch = null;
  var familyOnlyMatch = null;
  for (i = 0; i < available.length; i++) {
    var exact = available[i];
    if (fontsEquivalent(requested, exact)) {
      if (stylesCompatible(requested.style, exact.style)) {
        return exact;
      }
      if (!familyStyleMatch) familyStyleMatch = exact;
    }
  }
  if (familyStyleMatch) return familyStyleMatch;
  var rf = normalizeFontFamily(requested.family);
  for (i = 0; i < available.length; i++) {
    var familyOnly = available[i];
    if (normalizeFontFamily(familyOnly.family) === rf) {
      if (!familyOnlyMatch) familyOnlyMatch = familyOnly;
    }
  }
  if (familyOnlyMatch) return familyOnlyMatch;
  for (i = 0; i < available.length; i++) {
    var contains = available[i];
    var af = normalizeFontFamily(contains.family);
    if (af.indexOf(rf) >= 0 || rf.indexOf(af) >= 0) {
      return contains;
    }
  }
  var similar = findSimilarFonts(requested, available, 1);
  return similar.length ? similar[0] : null;
}

function findSimilarFonts(requested, available, limit) {
  var rf = normalizeFontFamily(requested.family);
  var rs = normalizeFontStyle(requested.style);
  var scored = [];
  var i;
  for (i = 0; i < available.length; i++) {
    var f = available[i];
    var af = normalizeFontFamily(f.family);
    var score = 0;
    if (af === rf) {
      score = 100;
      if (stylesCompatible(requested.style, f.style)) score += 10;
    } else if (fontsEquivalent(requested, f)) {
      score = 95;
    } else if (af.indexOf(rf) >= 0 || rf.indexOf(af) >= 0) {
      score = 80;
    } else {
      var tokens = rf.split(" ").filter(function (t) {
        return t.length > 2;
      });
      var matched = 0;
      for (var t = 0; t < tokens.length; t++) {
        if (af.indexOf(tokens[t]) >= 0) matched++;
      }
      score = matched * 25;
    }
    if (score > 0) scored.push({ font: f, score: score });
  }
  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  var out = [];
  var seen = {};
  var cap = limit != null ? limit : 8;
  for (i = 0; i < scored.length && out.length < cap; i++) {
    var k = fontKey(scored[i].font);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(scored[i].font);
  }
  return out;
}

function loadOneFont(font, available) {
  var candidates = expandFontCandidates(font);
  var chain = Promise.reject(new Error("font load failed"));
  var tried = {};
  var i;
  var j;
  function enqueueLoad(face) {
    if (!face || !face.family) return;
    var k = fontKey(face);
    if (tried[k]) return;
    tried[k] = true;
    (function (resolvedFace) {
      chain = chain.catch(function () {
        return figma.loadFontAsync(resolvedFace).then(function () {
          return resolvedFace;
        });
      });
    })(face);
  }
  for (i = 0; i < available.length; i++) {
    for (j = 0; j < candidates.length; j++) {
      if (fontsEquivalent(candidates[j], available[i])) {
        enqueueLoad(available[i]);
      }
    }
  }
  for (j = 0; j < candidates.length; j++) {
    enqueueLoad(candidates[j]);
  }
  return chain.catch(function (err) {
    return Promise.reject(
      new Error(
        'Could not load font "' +
          font.family +
          " " +
          font.style +
          '": ' +
          (err && err.message ? err.message : String(err))
      )
    );
  });
}

function loadFontsForEdit(textNode, available, allowSubstitute) {
  var fonts = collectTextNodeFonts(textNode);
  if (!fonts.length) {
    return Promise.resolve(null);
  }
  return fonts
    .reduce(function (chain, font) {
      return chain.then(function () {
        return loadOneFont(font, available);
      });
    }, Promise.resolve())
    .catch(function (err) {
      if (!allowSubstitute) {
        throw err;
      }
      return loadFallbackFont(available).then(function (fallbackFont) {
        reassignTextNodeFont(textNode, fallbackFont);
        return { fontFallback: fallbackFont };
      });
    });
}

function listInstalledFonts(args) {
  args = args && typeof args === "object" ? args : {};
  var filter = args.nameContains
    ? normalizeFontFamily(String(args.nameContains))
    : "";
  var max = args.maxResults != null ? Math.min(Number(args.maxResults) || 80, 200) : 80;
  return getAvailableFonts().then(function (available) {
    var fonts = available;
    if (filter) {
      fonts = [];
      for (var i = 0; i < available.length; i++) {
        var f = available[i];
        if (normalizeFontFamily(f.family).indexOf(filter) >= 0) {
          fonts.push(f);
        }
      }
    }
    var truncated = fonts.length > max;
    if (truncated) fonts = fonts.slice(0, max);
    return {
      totalInstalled: available.length,
      matched: fonts.length,
      truncated: truncated,
      fonts: fonts.map(function (f) {
        return { family: f.family, style: f.style };
      }),
      hint:
        "Use exact family + style from this list in figma_set_font. " +
        "Local fonts: install on your Mac/PC and use Figma Desktop (not browser). " +
        "Org/team shared fonts: admin uploads via file browser → Admin/Team settings → Resources → Fonts (Enterprise). " +
        "Missing font? Click the A? icon in the toolbar.",
    };
  });
}

function loadFontsForTextNode(textNode) {
  var fonts = collectTextNodeFonts(textNode);
  if (!fonts.length) {
    return Promise.reject(new Error("Text node has no fonts to load"));
  }
  return getAvailableFonts().then(function (available) {
    return fonts.reduce(function (chain, font) {
      return chain.then(function () {
        return loadOneFont(font, available);
      });
    }, Promise.resolve());
  });
}

function loadFallbackFont(available) {
  var candidates = FALLBACK_FONTS.slice();
  var i;
  for (i = 0; i < available.length; i++) {
    if (normalizeFontFamily(available[i].family) === "inter") {
      candidates.unshift(available[i]);
    }
  }
  var attempt = Promise.reject(new Error("No fallback font"));
  for (i = 0; i < candidates.length; i++) {
    (function (font) {
      attempt = attempt.catch(function () {
        return figma.loadFontAsync(font).then(function () {
          return font;
        });
      });
    })(candidates[i]);
  }
  return attempt;
}

function reassignTextNodeFont(textNode, newFont) {
  if (textNode.fontName !== figma.mixed) {
    textNode.fontName = newFont;
    return;
  }
  if (typeof textNode.getStyledTextSegments === "function") {
    var segments = textNode.getStyledTextSegments(["fontName"]);
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      textNode.setRangeFontName(seg.start, seg.end, newFont);
    }
    return;
  }
  textNode.fontName = newFont;
}

function readPrimaryFontName(textNode) {
  if (
    textNode.fontName !== figma.mixed &&
    textNode.fontName &&
    textNode.fontName.family
  ) {
    return {
      family: textNode.fontName.family,
      style: textNode.fontName.style || "Regular",
    };
  }
  if (typeof textNode.getStyledTextSegments === "function") {
    var segments = textNode.getStyledTextSegments(["fontName"]);
    for (var i = 0; i < segments.length; i++) {
      var fn = segments[i].fontName;
      if (fn && fn !== figma.mixed && fn.family) {
        return { family: fn.family, style: fn.style || "Regular" };
      }
    }
  }
  return { family: "Inter", style: "Regular" };
}

function ensureTextFontsLoaded(textNode, available) {
  var fonts = collectTextNodeFonts(textNode);
  if (!fonts.length) {
    return Promise.resolve();
  }
  return fonts.reduce(function (chain, font) {
    return chain.then(function () {
      return loadOneFont(font, available);
    });
  }, Promise.resolve());
}

function setTextNodeFontSize(textNode, fontSize) {
  if (fontSize == null || isNaN(Number(fontSize))) return;
  var size = Number(fontSize);
  if (textNode.fontSize !== figma.mixed) {
    textNode.fontSize = size;
    return;
  }
  if (typeof textNode.setRangeFontSize === "function") {
    var len = String(textNode.characters || "").length;
    if (len > 0) {
      textNode.setRangeFontSize(0, len, size);
    }
  }
}

function resolveTextNodeForFont(node, nodeId) {
  if (node.type === "TEXT") return node;
  var texts = [];
  collectTextNodes(node, 0, texts);
  if (!texts.length) {
    throw new Error(
      "figma_set_font requires a TEXT layer (node " +
        nodeId +
        " is " +
        node.type +
        ")"
    );
  }
  return texts[0];
}

function applyTextCharacters(textNode, characters, search, replace) {
  var next = characters != null ? String(characters) : null;
  if (next != null) {
    textNode.characters = next;
    return next;
  }
  if (search != null && replace != null) {
    var current = String(textNode.characters || "");
    var needle = String(search);
    var idx = current.indexOf(needle);
    if (idx < 0) {
      throw new Error(
        'Text "' +
          String(textNode.characters || "").slice(0, 80) +
          '" does not contain "' +
          needle +
          '"'
      );
    }
    textNode.deleteCharacters(idx, idx + needle.length);
    textNode.insertCharacters(idx, String(replace));
    return textNode.characters;
  }
  textNode.characters = "";
  return textNode.characters;
}

function buildTextEditResult(textNode, containerNode, meta) {
  var out = {
    id: textNode.id,
    characters: textNode.characters.slice(0, TEXT_CHARS_MAX),
  };
  if (containerNode && textNode.id !== containerNode.id) {
    out.resolvedFrom = containerNode.id;
  }
  if (meta && meta.fontFallback) {
    out.fontFallback = meta.fontFallback;
    out.warning =
      "Original font was unavailable; text was updated using " +
      meta.fontFallback.family +
      " " +
      meta.fontFallback.style +
      ".";
  }
  return out;
}

function collectTextNodes(node, depth, out) {
  if (!node || depth > MAX_TEXT_SEARCH_DEPTH) return;
  if (isHiddenLayer(node)) return;
  if (node.type === "TEXT") {
    out.push(node);
    return;
  }
  if (!node.children || !node.children.length) return;
  for (var i = 0; i < node.children.length; i++) {
    collectTextNodes(node.children[i], depth + 1, out);
  }
}

function previewTextNodes(texts, limit) {
  var slice = texts.slice(0, limit || 5);
  return slice
    .map(function (t) {
      return (
        (t.name || "TEXT") +
        ': "' +
        String(t.characters || "").slice(0, 48) +
        '"'
      );
    })
    .join("; ");
}

function pickTextNodeByCharacters(texts, characters) {
  var next = String(characters);
  var i;
  for (i = 0; i < texts.length; i++) {
    var cur = String(texts[i].characters || "");
    if (!cur) continue;
    if (next.indexOf(cur) >= 0 || cur.indexOf(next) >= 0) return texts[i];
    if (cur.length > 3 && next.length > 3) {
      var prefix = cur.slice(0, Math.min(cur.length, next.length, 12));
      if (next.indexOf(prefix) >= 0 || cur.indexOf(next.slice(0, 12)) >= 0) {
        return texts[i];
      }
    }
  }
  texts.sort(function (a, b) {
    return String(b.characters || "").length - String(a.characters || "").length;
  });
  return texts[0];
}

function resolveTextNode(node, search, characters) {
  if (node.type === "TEXT") {
    if (search == null) return node;
    if (String(node.characters || "").indexOf(String(search)) >= 0) return node;
  }
  var texts = [];
  collectTextNodes(node, 0, texts);
  if (!texts.length) {
    throw new Error(
      "figma_set_text requires a TEXT node (or a container with a TEXT child)"
    );
  }
  if (search != null) {
    var needle = String(search);
    for (var i = 0; i < texts.length; i++) {
      if (String(texts[i].characters || "").indexOf(needle) >= 0) {
        return texts[i];
      }
    }
    throw new Error(
      'No TEXT layer here contains "' +
        needle +
        '". Text found: ' +
        previewTextNodes(texts, 6)
    );
  }
  if (texts.length === 1) return texts[0];
  if (characters != null) return pickTextNodeByCharacters(texts, characters);
  return texts[0];
}

function setNodeName(nodeId, name) {
  requireWrite();
  return resolveNode(nodeId).then(function (node) {
    if (!("name" in node)) throw new Error("Node has no name");
    node.name = String(name || "");
    return { id: node.id, name: node.name };
  });
}

function setNodeText(nodeId, characters, search, replace) {
  requireWrite();
  if (
    characters == null &&
    (search == null || replace == null)
  ) {
    return Promise.reject(
      new Error("figma_set_text needs characters or search+replace")
    );
  }
  return resolveNode(nodeId).then(function (node) {
    var textNode = resolveTextNode(node, search, characters);
    function commitText(meta) {
      applyTextCharacters(textNode, characters, search, replace);
      return buildTextEditResult(textNode, node, meta);
    }
    return getAvailableFonts().then(function (available) {
      return loadFontsForEdit(textNode, available, true).then(function (meta) {
        return commitText(meta);
      });
    });
  });
}

function setNodeFills(nodeId, color) {
  requireWrite();
  return resolveNode(nodeId).then(function (node) {
    if (!("fills" in node)) throw new Error("Node has no fills");
    node.fills = [solidPaintFromArgs(color)];
    return { id: node.id, fills: paintsToSimple(node.fills) };
  });
}

var VALID_TRIGGERS = {
  ON_CLICK: true,
  ON_HOVER: true,
  ON_PRESS: true,
  ON_DRAG: true,
  MOUSE_ENTER: true,
  MOUSE_LEAVE: true,
  MOUSE_UP: true,
  MOUSE_DOWN: true,
};

var SIMPLE_TRANSITIONS = {
  DISSOLVE: true,
  SMART_ANIMATE: true,
  SCROLL_ANIMATE: true,
};

var DIRECTIONAL_TRANSITIONS = {
  MOVE_IN: true,
  MOVE_OUT: true,
  PUSH: true,
  SLIDE_IN: true,
  SLIDE_OUT: true,
};

var VALID_DEST_TYPES = {
  FRAME: true,
  COMPONENT: true,
  INSTANCE: true,
  COMPONENT_SET: true,
};

function isValidNavigateDestination(node) {
  return !!(node && VALID_DEST_TYPES[node.type]);
}

function buildTransition(transition, duration, direction) {
  var trans = transition ? String(transition).toUpperCase() : "INSTANT";
  if (!trans || trans === "INSTANT" || trans === "NONE") {
    return null;
  }
  var dur =
    duration != null && !isNaN(Number(duration)) ? Number(duration) : 0.3;
  var easing = { type: "EASE_OUT" };
  if (SIMPLE_TRANSITIONS[trans]) {
    return { type: trans, duration: dur, easing: easing };
  }
  if (DIRECTIONAL_TRANSITIONS[trans]) {
    var dir = direction ? String(direction).toUpperCase() : "LEFT";
    if (dir !== "RIGHT" && dir !== "TOP" && dir !== "BOTTOM") {
      dir = "LEFT";
    }
    return {
      type: trans,
      direction: dir,
      matchLayers: false,
      duration: dur,
      easing: easing,
    };
  }
  return null;
}

function cloneNodeAction(action) {
  if (!action || !action.type) return null;
  if (action.type === "NODE") {
    if (!action.destinationId) return null;
    var cloned = {
      type: "NODE",
      destinationId: action.destinationId,
      navigation: action.navigation || "NAVIGATE",
      preserveScrollPosition: !!action.preserveScrollPosition,
      transition: null,
    };
    if (action.transition && action.transition.type) {
      var t = action.transition;
      if (DIRECTIONAL_TRANSITIONS[t.type]) {
        cloned.transition = {
          type: t.type,
          direction: t.direction || "LEFT",
          matchLayers: !!t.matchLayers,
          duration: t.duration != null ? t.duration : 0.3,
          easing: t.easing || { type: "EASE_OUT" },
        };
      } else if (SIMPLE_TRANSITIONS[t.type]) {
        cloned.transition = {
          type: t.type,
          duration: t.duration != null ? t.duration : 0.3,
          easing: t.easing || { type: "EASE_OUT" },
        };
      }
    }
    return cloned;
  }
  try {
    return JSON.parse(JSON.stringify(action));
  } catch (_e) {
    return { type: action.type };
  }
}

function cloneReaction(reaction) {
  var triggerType =
    reaction && reaction.trigger && reaction.trigger.type
      ? reaction.trigger.type
      : "ON_CLICK";
  var srcActions =
    reaction && reaction.actions
      ? reaction.actions
      : reaction && reaction.action
        ? [reaction.action]
        : [];
  var actions = [];
  for (var i = 0; i < srcActions.length; i++) {
    var cloned = cloneNodeAction(srcActions[i]);
    if (cloned) actions.push(cloned);
  }
  if (!actions.length) return null;
  return { trigger: { type: triggerType }, actions: actions };
}

function assertValidReactions(reactions, sourceName, destName) {
  if (!reactions || !reactions.length) {
    throw new Error(
      'No reactions to set on "' + sourceName + '" → "' + destName + '"'
    );
  }
  for (var i = 0; i < reactions.length; i++) {
    var r = reactions[i];
    if (!r || !r.trigger || !r.trigger.type) {
      throw new Error("Reaction at index " + i + " is missing a trigger");
    }
    if (!r.actions || !r.actions.length) {
      throw new Error("Reaction at index " + i + " needs a non-empty actions array");
    }
    for (var j = 0; j < r.actions.length; j++) {
      var a = r.actions[j];
      if (a.type === "NODE") {
        if (!a.destinationId) {
          throw new Error("Reaction at index " + i + " has NODE action without destinationId");
        }
        if (!a.navigation) {
          throw new Error("Reaction at index " + i + " has NODE action without navigation");
        }
      }
    }
  }
}

function applyReactionsAsync(node, reactions, sourceName, destName) {
  assertValidReactions(reactions, sourceName, destName);
  return node.setReactionsAsync(reactions).catch(function (err) {
    var msg = err && err.message ? err.message : String(err);
    throw new Error(
      'Prototype link failed for "' +
        sourceName +
        '" → "' +
        destName +
        '": ' +
        msg
    );
  });
}

function serializeReactions(node) {
  if (!("reactions" in node)) return [];
  var reactions = node.reactions || [];
  var out = [];
  for (var i = 0; i < reactions.length; i++) {
    var r = reactions[i];
    var item = {
      trigger: r.trigger ? { type: r.trigger.type } : null,
      actions: [],
    };
    var acts = r.actions || (r.action ? [r.action] : []);
    for (var j = 0; j < acts.length; j++) {
      var a = acts[j];
      if (a.type === "NODE") {
        item.actions.push({
          type: a.type,
          destinationId: a.destinationId,
          navigation: a.navigation,
          transition: a.transition
            ? {
                type: a.transition.type,
                duration: a.transition.duration,
              }
            : null,
        });
      } else {
        item.actions.push({ type: a.type });
      }
    }
    out.push(item);
  }
  return out;
}

function buildNavigateReaction(destinationId, trigger, transition, duration, direction) {
  var triggerType =
    trigger && VALID_TRIGGERS[String(trigger).toUpperCase()]
      ? String(trigger).toUpperCase()
      : "ON_CLICK";
  return {
    trigger: { type: triggerType },
    actions: [
      {
        type: "NODE",
        destinationId: destinationId,
        navigation: "NAVIGATE",
        preserveScrollPosition: false,
        transition: buildTransition(transition, duration, direction),
      },
    ],
  };
}

function listPageFrames(maxDepth, opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  var depthLimit = maxDepth == null ? 2 : Math.min(Math.max(Number(maxDepth) || 2, 1), 4);
  var selectedOnly = !!opts.selectedOnly;
  var frames = [];
  var truncated = false;
  var totalMatched = 0;

  function pushFrame(node, depth) {
    totalMatched++;
    if (frames.length >= MAX_LIST_FRAMES) {
      truncated = true;
      return;
    }
    var parentType =
      node.parent && node.parent.type ? node.parent.type : "";
    frames.push({
      id: node.id,
      name: node.name,
      type: node.type,
      depth: depth,
      topLevel: parentType === "PAGE" || parentType === "SECTION",
      x: "x" in node && typeof node.x === "number" ? Math.round(node.x) : undefined,
      y: "y" in node && typeof node.y === "number" ? Math.round(node.y) : undefined,
      width:
        "width" in node && typeof node.width === "number"
          ? Math.round(node.width)
          : undefined,
      height:
        "height" in node && typeof node.height === "number"
          ? Math.round(node.height)
          : undefined,
    });
  }

  function walk(node, depth) {
    if (isHiddenLayer(node)) return;
    if (node.type === "FRAME" || node.type === "COMPONENT") {
      pushFrame(node, depth);
    }
    if (depth >= depthLimit || !node.children || !node.children.length) return;
    for (var i = 0; i < node.children.length; i++) {
      walk(node.children[i], depth + 1);
    }
  }

  if (selectedOnly) {
    var sel = figma.currentPage.selection;
    for (var s = 0; s < sel.length; s++) {
      var n = sel[s];
      // Inventory every selected root (frames and other types).
      totalMatched++;
      if (frames.length >= MAX_LIST_FRAMES) {
        truncated = true;
        continue;
      }
      var parentType =
        n.parent && n.parent.type ? n.parent.type : "";
      frames.push({
        id: n.id,
        name: n.name,
        type: n.type,
        depth: 0,
        topLevel: parentType === "PAGE" || parentType === "SECTION",
        selected: true,
        x: "x" in n && typeof n.x === "number" ? Math.round(n.x) : undefined,
        y: "y" in n && typeof n.y === "number" ? Math.round(n.y) : undefined,
        width:
          "width" in n && typeof n.width === "number"
            ? Math.round(n.width)
            : undefined,
        height:
          "height" in n && typeof n.height === "number"
            ? Math.round(n.height)
            : undefined,
      });
    }
  } else {
    var kids = figma.currentPage.children;
    for (var j = 0; j < kids.length; j++) {
      walk(kids[j], 0);
    }
  }

  return {
    pageName: figma.currentPage.name,
    selectedOnly: selectedOnly,
    selectedCount: figma.currentPage.selection.length,
    totalMatched: totalMatched,
    truncated: truncated,
    frames: frames,
  };
}

/** List COMPONENT / COMPONENT_SET (and optional INSTANCE) on the page or selection. */
function listPageComponents(maxDepth, opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  var depthLimit = maxDepth == null ? 3 : Math.min(Math.max(Number(maxDepth) || 3, 1), 5);
  var selectedOnly = !!opts.selectedOnly;
  var includeInstances = !!opts.includeInstances;
  var components = [];
  var truncated = false;
  var totalMatched = 0;

  function pushComp(node, depth) {
    totalMatched++;
    if (components.length >= MAX_LIST_FRAMES) {
      truncated = true;
      return;
    }
    var parentType =
      node.parent && node.parent.type ? node.parent.type : "";
    var row = {
      id: node.id,
      name: node.name,
      type: node.type,
      depth: depth,
      topLevel: parentType === "PAGE" || parentType === "SECTION",
    };
    if (node.type === "INSTANCE") {
      try {
        row.componentId = node.componentId || undefined;
      } catch (_eInst) {
        /* ignore */
      }
    }
    if (node.type === "COMPONENT_SET") {
      try {
        row.variantCount = node.children ? node.children.length : 0;
      } catch (_eSet) {
        /* ignore */
      }
    }
    components.push(row);
  }

  function walk(node, depth) {
    if (isHiddenLayer(node)) return;
    if (
      node.type === "COMPONENT" ||
      node.type === "COMPONENT_SET" ||
      (includeInstances && node.type === "INSTANCE")
    ) {
      pushComp(node, depth);
    }
    if (depth >= depthLimit || !node.children || !node.children.length) return;
    for (var i = 0; i < node.children.length; i++) {
      walk(node.children[i], depth + 1);
    }
  }

  if (selectedOnly) {
    var sel = figma.currentPage.selection;
    for (var s = 0; s < sel.length; s++) {
      var n = sel[s];
      if (
        n.type === "COMPONENT" ||
        n.type === "COMPONENT_SET" ||
        (includeInstances && n.type === "INSTANCE")
      ) {
        pushComp(n, 0);
      }
    }
  } else {
    var kids = figma.currentPage.children;
    for (var j = 0; j < kids.length; j++) {
      walk(kids[j], 0);
    }
  }

  return {
    pageName: figma.currentPage.name,
    selectedOnly: selectedOnly,
    includeInstances: includeInstances,
    totalMatched: totalMatched,
    truncated: truncated,
    components: components,
  };
}

function variablesApiAvailable() {
  return !!(
    figma.variables &&
    typeof figma.variables.getLocalVariablesAsync === "function" &&
    typeof figma.variables.getLocalVariableCollectionsAsync === "function"
  );
}

function serializeVariableValues(variable, collection) {
  var out = {};
  if (!collection || !collection.modes || !variable.valuesByMode) return out;
  for (var i = 0; i < collection.modes.length; i++) {
    var mode = collection.modes[i];
    var raw = variable.valuesByMode[mode.modeId];
    if (raw === undefined) continue;
    if (variable.resolvedType === "COLOR" && raw && typeof raw === "object") {
      if ("r" in raw) {
        out[mode.name] = {
          r: Math.round(raw.r * 1000) / 1000,
          g: Math.round(raw.g * 1000) / 1000,
          b: Math.round(raw.b * 1000) / 1000,
          a: raw.a != null ? Math.round(raw.a * 1000) / 1000 : 1,
        };
      } else if (raw.type === "VARIABLE_ALIAS" && raw.id) {
        out[mode.name] = { aliasId: raw.id };
      }
    } else {
      out[mode.name] = raw;
    }
  }
  return out;
}

function listLocalVariables(opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  var nameFilter = opts.nameContains
    ? String(opts.nameContains).toLowerCase()
    : "";
  if (!variablesApiAvailable()) {
    return Promise.resolve({
      supported: false,
      collections: [],
      variables: [],
      message: "Variables API unavailable in this Figma environment.",
    });
  }
  return Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
  ]).then(function (pair) {
    var collections = pair[0] || [];
    var variables = pair[1] || [];
    var colById = {};
    var colOut = [];
    for (var c = 0; c < collections.length; c++) {
      var col = collections[c];
      colById[col.id] = col;
      colOut.push({
        id: col.id,
        name: col.name,
        modes: (col.modes || []).map(function (m) {
          return { modeId: m.modeId, name: m.name };
        }),
        variableCount: col.variableIds ? col.variableIds.length : 0,
      });
    }
    var varOut = [];
    for (var v = 0; v < variables.length; v++) {
      var variable = variables[v];
      if (nameFilter && String(variable.name || "").toLowerCase().indexOf(nameFilter) < 0) {
        continue;
      }
      var collection = colById[variable.variableCollectionId];
      varOut.push({
        id: variable.id,
        name: variable.name,
        type: variable.resolvedType,
        collectionId: variable.variableCollectionId,
        collectionName: collection ? collection.name : undefined,
        scopes: variable.scopes,
        valuesByMode: serializeVariableValues(variable, collection),
      });
    }
    return {
      supported: true,
      collections: colOut,
      variables: varOut,
    };
  });
}

var BIND_SCALAR_FIELDS = {
  width: "width",
  height: "height",
  itemSpacing: "itemSpacing",
  paddingTop: "paddingTop",
  paddingRight: "paddingRight",
  paddingBottom: "paddingBottom",
  paddingLeft: "paddingLeft",
  cornerRadius: "cornerRadius",
  opacity: "opacity",
  minWidth: "minWidth",
  maxWidth: "maxWidth",
  minHeight: "minHeight",
  maxHeight: "maxHeight",
};

function bindVariableToNode(args) {
  if (!args.nodeId || !args.variableId) {
    return Promise.reject(new Error("nodeId and variableId are required"));
  }
  if (!variablesApiAvailable()) {
    return Promise.reject(new Error("Variables API unavailable"));
  }
  var field = String(args.field || "fill").toLowerCase();
  return Promise.all([
    resolveNode(args.nodeId),
    figma.variables.getVariableByIdAsync(String(args.variableId)),
  ]).then(function (pair) {
    var node = pair[0];
    var variable = pair[1];
    if (!variable) {
      throw new Error("Variable not found: " + args.variableId);
    }
    if (field === "fill" || field === "fills") {
      if (!("fills" in node)) {
        throw new Error("Node does not support fills");
      }
      var fills = clonePaintsSafe(node.fills);
      if (!fills || !fills.length) {
        fills = [solidPaintFromArgs({ r: 0, g: 0, b: 0, a: 1 })];
      }
      var boundFill = figma.variables.setBoundVariableForPaint(
        fills[0],
        "color",
        variable
      );
      node.fills = [boundFill];
      return {
        id: node.id,
        field: "fill",
        variableId: variable.id,
        variableName: variable.name,
      };
    }
    if (field === "stroke" || field === "strokes") {
      if (!("strokes" in node)) {
        throw new Error("Node does not support strokes");
      }
      var strokes = clonePaintsSafe(node.strokes);
      if (!strokes || !strokes.length) {
        strokes = [solidPaintFromArgs({ r: 0, g: 0, b: 0, a: 1 })];
      }
      var boundStroke = figma.variables.setBoundVariableForPaint(
        strokes[0],
        "color",
        variable
      );
      node.strokes = [boundStroke];
      return {
        id: node.id,
        field: "stroke",
        variableId: variable.id,
        variableName: variable.name,
      };
    }
    var bindField = BIND_SCALAR_FIELDS[field];
    if (!bindField || typeof node.setBoundVariable !== "function") {
      throw new Error(
        "Unsupported bind field: " +
          field +
          " (use fill, stroke, width, height, itemSpacing, padding*, cornerRadius, opacity)"
      );
    }
    node.setBoundVariable(bindField, variable);
    return {
      id: node.id,
      field: bindField,
      variableId: variable.id,
      variableName: variable.name,
    };
  });
}

function swapInstanceComponent(args) {
  if (!args.nodeId || !args.componentId) {
    return Promise.reject(new Error("nodeId and componentId are required"));
  }
  return Promise.all([
    resolveNode(args.nodeId),
    resolveNode(args.componentId),
  ]).then(function (pair) {
    var instance = pair[0];
    var component = pair[1];
    if (instance.type !== "INSTANCE") {
      throw new Error("nodeId must be an INSTANCE (got " + instance.type + ")");
    }
    if (component.type !== "COMPONENT") {
      throw new Error(
        "componentId must be a COMPONENT (got " + component.type + ")"
      );
    }
    instance.swapComponent(component);
    return {
      id: instance.id,
      name: instance.name,
      componentId: component.id,
      componentName: component.name,
    };
  });
}

function getNodeReactions(nodeId) {
  return resolveNode(nodeId).then(function (node) {
    if (!("reactions" in node)) {
      throw new Error("Node does not support prototype reactions");
    }
    return {
      id: node.id,
      name: node.name,
      reactions: serializeReactions(node),
    };
  });
}

function clearNodeReactions(nodeId) {
  requireWrite();
  return resolveNode(nodeId).then(function (node) {
    if (typeof node.setReactionsAsync !== "function") {
      throw new Error("Node does not support prototype reactions");
    }
    return node.setReactionsAsync([]).then(function () {
      return { id: node.id, name: node.name, reactions: [] };
    });
  });
}

function setPrototypeLink(nodeId, destinationId, args) {
  requireWrite();
  args = args && typeof args === "object" ? args : {};
  if (!destinationId) {
    return Promise.reject(new Error("destinationId is required"));
  }
  return resolveNode(nodeId).then(function (node) {
    if (typeof node.setReactionsAsync !== "function") {
      throw new Error(
        'Node "' + node.name + '" does not support prototype reactions'
      );
    }
    return resolveNode(destinationId).then(function (dest) {
      if (!isValidNavigateDestination(dest)) {
        throw new Error(
          'Destination "' +
            dest.name +
            '" (' +
            dest.type +
            ") is not a frame/component — pick a screen frame as destination"
        );
      }
      if (node.id === dest.id) {
        throw new Error(
          'Source and destination are the same node ("' + node.name + '")'
        );
      }
      var trigger = args.trigger || "ON_CLICK";
      var reaction = buildNavigateReaction(
        dest.id,
        trigger,
        args.transition,
        args.duration,
        args.direction
      );
      var replaceAll = args.replaceAll;
      if (replaceAll == null && args.replace == null) {
        replaceAll = true;
      }
      var next;
      if (replaceAll) {
        next = [reaction];
      } else {
        var existing = node.reactions ? node.reactions : [];
        next = [];
        var triggerUpper = String(trigger).toUpperCase();
        for (var i = 0; i < existing.length; i++) {
          var er = existing[i];
          var erTrigger =
            er && er.trigger && er.trigger.type ? er.trigger.type : "";
          if (args.replace !== false && erTrigger === triggerUpper) {
            continue;
          }
          var cloned = cloneReaction(er);
          if (cloned) next.push(cloned);
        }
        next.push(reaction);
      }
      return applyReactionsAsync(node, next, node.name, dest.name).then(
        function () {
          return {
            id: node.id,
            name: node.name,
            destinationId: dest.id,
            destinationName: dest.name,
            trigger: reaction.trigger.type,
            transition: reaction.actions[0].transition,
            reactionCount: next.length,
          };
        }
      );
    });
  });
}

function setPrototypeFlow(links) {
  if (!Array.isArray(links) || !links.length) {
    return Promise.reject(new Error("links array is required"));
  }
  var results = [];
  var chain = Promise.resolve();
  for (var i = 0; i < links.length; i++) {
    (function (link, index) {
      chain = chain.then(function () {
        if (!link || typeof link !== "object") {
          results.push({ ok: false, index: index, error: "Invalid link object" });
          return;
        }
        var sourceId = link.sourceId || link.nodeId;
        var destinationId = link.destinationId;
        if (!sourceId || !destinationId) {
          results.push({
            ok: false,
            index: index,
            error: "Missing sourceId or destinationId",
          });
          return;
        }
        return setPrototypeLink(sourceId, destinationId, {
          trigger: link.trigger,
          transition: link.transition,
          duration: link.duration,
          direction: link.direction,
          replaceAll: true,
        })
          .then(function (r) {
            var out = {
              ok: true,
              index: index,
              id: r.id,
              name: r.name,
              destinationId: r.destinationId,
              destinationName: r.destinationName,
            };
            results.push(out);
          })
          .catch(function (err) {
            results.push({
              ok: false,
              index: index,
              sourceId: sourceId,
              destinationId: destinationId,
              error: err && err.message ? err.message : String(err),
            });
          });
      });
    })(links[i], i);
  }
  return chain.then(function () {
    var ok = results.filter(function (r) {
      return r.ok;
    });
    var failed = results.filter(function (r) {
      return !r.ok;
    });
    if (!ok.length && failed.length) {
      throw new Error(
        "All " + failed.length + " prototype links failed: " + failed[0].error
      );
    }
    return {
      linked: ok.length,
      failed: failed.length,
      links: results,
    };
  });
}

var AXIS_ALIGN_VALUES = {
  MIN: true,
  MAX: true,
  CENTER: true,
  SPACE_BETWEEN: true,
  BASELINE: true,
};

function normalizeAxisAlign(value) {
  var v = String(value || "")
    .toUpperCase()
    .replace(/-/g, "_");
  if (v === "LEFT" || v === "TOP") return "MIN";
  if (v === "RIGHT" || v === "BOTTOM") return "MAX";
  if (v === "MIDDLE") return "CENTER";
  if (AXIS_ALIGN_VALUES[v]) return v;
  return null;
}

function applyAutoLayoutAxisFields(node, args) {
  if (args.primaryAxisAlignItems != null) {
    var pa = normalizeAxisAlign(args.primaryAxisAlignItems);
    if (pa) node.primaryAxisAlignItems = pa;
  }
  if (args.counterAxisAlignItems != null) {
    var ca = normalizeAxisAlign(args.counterAxisAlignItems);
    if (ca) node.counterAxisAlignItems = ca;
  }
  if (args.primaryAxisSizingMode != null) {
    var ps = String(args.primaryAxisSizingMode).toUpperCase();
    if (ps === "FIXED" || ps === "AUTO") node.primaryAxisSizingMode = ps;
  }
  if (args.counterAxisSizingMode != null) {
    var cs = String(args.counterAxisSizingMode).toUpperCase();
    if (cs === "FIXED" || cs === "AUTO") node.counterAxisSizingMode = cs;
  }
  if (args.layoutWrap != null) {
    var lw = String(args.layoutWrap).toUpperCase();
    if (lw === "NO_WRAP" || lw === "WRAP") node.layoutWrap = lw;
  }
}

function setAutoLayout(nodeId, args) {
  requireWrite();
  return resolveNode(nodeId).then(function (node) {
    if (!("layoutMode" in node)) {
      throw new Error("Node does not support auto-layout");
    }
    if (args.layoutMode != null) {
      var lm = String(args.layoutMode).toUpperCase();
      if (lm === "NONE" || lm === "HORIZONTAL" || lm === "VERTICAL") {
        node.layoutMode = lm;
      }
    }
    if (args.paddingTop != null) node.paddingTop = Number(args.paddingTop);
    if (args.paddingRight != null) node.paddingRight = Number(args.paddingRight);
    if (args.paddingBottom != null)
      node.paddingBottom = Number(args.paddingBottom);
    if (args.paddingLeft != null) node.paddingLeft = Number(args.paddingLeft);
    if (args.itemSpacing != null) node.itemSpacing = Number(args.itemSpacing);
    if (args.padding != null) {
      var p = Number(args.padding);
      node.paddingTop = p;
      node.paddingRight = p;
      node.paddingBottom = p;
      node.paddingLeft = p;
    }
    applyAutoLayoutAxisFields(node, args);
    return {
      id: node.id,
      layoutMode: node.layoutMode,
      paddingTop: node.paddingTop,
      paddingRight: node.paddingRight,
      paddingBottom: node.paddingBottom,
      paddingLeft: node.paddingLeft,
      itemSpacing: node.itemSpacing,
      primaryAxisAlignItems: node.primaryAxisAlignItems,
      counterAxisAlignItems: node.counterAxisAlignItems,
      primaryAxisSizingMode: node.primaryAxisSizingMode,
      counterAxisSizingMode: node.counterAxisSizingMode,
      layoutWrap: node.layoutWrap,
    };
  });
}

function getAlignTargetChildren(parent, nodeIds) {
  var list = [];
  if (!parent || !parent.children) return list;
  var idSet = null;
  if (Array.isArray(nodeIds) && nodeIds.length) {
    idSet = {};
    for (var i = 0; i < nodeIds.length; i++) {
      idSet[String(nodeIds[i])] = true;
    }
  }
  for (var c = 0; c < parent.children.length; c++) {
    var ch = parent.children[c];
    if (!ch.visible || ch.locked) continue;
    if (idSet && !idSet[ch.id]) continue;
    list.push(ch);
  }
  return list;
}

function childrenRelativeBounds(children) {
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  for (var i = 0; i < children.length; i++) {
    var n = children[i];
    if (!("x" in n) || !("width" in n) || !("height" in n)) continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  if (!isFinite(minX)) return null;
  return {
    minX: minX,
    minY: minY,
    maxX: maxX,
    maxY: maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function distributeChildrenOnAxis(parent, children, axis, padding) {
  var sorted = [];
  for (var i = 0; i < children.length; i++) {
    if ("x" in children[i] && "width" in children[i]) sorted.push(children[i]);
  }
  if (sorted.length < 2) return 0;
  sorted.sort(function (a, b) {
    return axis === "h" ? a.x - b.x : a.y - b.y;
  });
  var inner =
    axis === "h"
      ? parent.width - 2 * padding
      : parent.height - 2 * padding;
  var totalSize = 0;
  for (var j = 0; j < sorted.length; j++) {
    totalSize += axis === "h" ? sorted[j].width : sorted[j].height;
  }
  var gap = (inner - totalSize) / (sorted.length - 1);
  if (!(gap >= 0)) gap = 0;
  var pos = padding;
  for (var k = 0; k < sorted.length; k++) {
    if (axis === "h") {
      sorted[k].x = pos;
      pos += sorted[k].width + gap;
    } else {
      sorted[k].y = pos;
      pos += sorted[k].height + gap;
    }
  }
  return sorted.length;
}

function applyAutoLayoutFrameAlign(parent, mode) {
  var lm = parent.layoutMode;
  if (!lm || lm === "NONE") return false;
  mode = String(mode || "").toLowerCase();
  var primary = null;
  var counter = null;
  if (lm === "HORIZONTAL") {
    if (mode === "left") primary = "MIN";
    else if (mode === "right") primary = "MAX";
    else if (
      mode === "center-h" ||
      mode === "center_h" ||
      mode === "center"
    ) {
      primary = "CENTER";
    } else if (
      mode === "space-between-h" ||
      mode === "space_between_h" ||
      mode === "distribute-h" ||
      mode === "distribute_h"
    ) {
      primary = "SPACE_BETWEEN";
    } else if (mode === "top") counter = "MIN";
    else if (mode === "bottom") counter = "MAX";
    else if (mode === "middle" || mode === "center-v" || mode === "center_v") {
      counter = "CENTER";
    }
  } else if (lm === "VERTICAL") {
    if (mode === "top") primary = "MIN";
    else if (mode === "bottom") primary = "MAX";
    else if (
      mode === "middle" ||
      mode === "center-v" ||
      mode === "center_v" ||
      mode === "center"
    ) {
      primary = "CENTER";
    } else if (
      mode === "space-between-v" ||
      mode === "space_between_v" ||
      mode === "distribute-v" ||
      mode === "distribute_v"
    ) {
      primary = "SPACE_BETWEEN";
    } else if (mode === "left") counter = "MIN";
    else if (mode === "right") counter = "MAX";
    else if (mode === "center-h" || mode === "center_h") counter = "CENTER";
  }
  if (mode === "center") {
    if (lm === "HORIZONTAL") counter = counter || "CENTER";
    if (lm === "VERTICAL") counter = counter || "CENTER";
  }
  if (primary) parent.primaryAxisAlignItems = primary;
  if (counter) parent.counterAxisAlignItems = counter;
  return !!(primary || counter);
}

function alignAbsoluteChildren(parent, children, mode, padding) {
  mode = String(mode || "center").toLowerCase();
  var bounds = childrenRelativeBounds(children);
  if (!bounds) return { moved: 0 };
  var pW = parent.width;
  var pH = parent.height;
  if (
    mode === "distribute-h" ||
    mode === "distribute_h" ||
    mode === "space-between-h" ||
    mode === "space_between_h"
  ) {
    return {
      moved: distributeChildrenOnAxis(parent, children, "h", padding),
      distributed: "horizontal",
    };
  }
  if (
    mode === "distribute-v" ||
    mode === "distribute_v" ||
    mode === "space-between-v" ||
    mode === "space_between_v"
  ) {
    return {
      moved: distributeChildrenOnAxis(parent, children, "v", padding),
      distributed: "vertical",
    };
  }
  var dx = 0;
  var dy = 0;
  if (mode === "left") dx = padding - bounds.minX;
  else if (mode === "right") dx = pW - padding - bounds.maxX;
  else if (mode === "center-h" || mode === "center_h") {
    dx = (pW - bounds.width) / 2 - bounds.minX;
  } else if (mode === "top") dy = padding - bounds.minY;
  else if (mode === "bottom") dy = pH - padding - bounds.maxY;
  else if (mode === "middle" || mode === "center-v" || mode === "center_v") {
    dy = (pH - bounds.height) / 2 - bounds.minY;
  } else if (mode === "center") {
    dx = (pW - bounds.width) / 2 - bounds.minX;
    dy = (pH - bounds.height) / 2 - bounds.minY;
  }
  var moved = 0;
  if (dx !== 0 || dy !== 0) {
    for (var i = 0; i < children.length; i++) {
      if ("x" in children[i]) {
        if (dx) children[i].x += dx;
        if (dy) children[i].y += dy;
        moved++;
      }
    }
  }
  return { moved: moved, delta: { dx: dx, dy: dy } };
}

function alignChildrenInFrame(args) {
  requireWrite();
  if (!args.parentId) {
    return Promise.reject(new Error("parentId is required"));
  }
  var hasAxis =
    args.primaryAxisAlignItems != null ||
    args.counterAxisAlignItems != null;
  var hasMode = args.mode != null && String(args.mode).length > 0;
  if (!hasMode && !hasAxis) {
    return Promise.reject(
      new Error(
        "mode or primaryAxisAlignItems/counterAxisAlignItems is required"
      )
    );
  }
  return resolveNode(args.parentId).then(function (parent) {
    if (
      !parent ||
      parent.type === "PAGE" ||
      parent.type === "DOCUMENT" ||
      !("children" in parent)
    ) {
      throw new Error("parentId must be a frame-like container with children");
    }
    var padding = args.padding != null ? Number(args.padding) : 0;
    if (!(padding >= 0)) padding = 0;
    var mode = hasMode ? String(args.mode) : "";
    var children = getAlignTargetChildren(parent, args.nodeIds);
    var result = {
      parentId: parent.id,
      parentName: parent.name,
      mode: mode || undefined,
      layoutMode: parent.layoutMode || "NONE",
      childCount: children.length,
    };
    if (parent.layoutMode && parent.layoutMode !== "NONE") {
      if (hasAxis) {
        applyAutoLayoutAxisFields(parent, args);
      } else if (hasMode) {
        if (!applyAutoLayoutFrameAlign(parent, mode)) {
          throw new Error(
            "Unsupported align mode for " +
              parent.layoutMode +
              " auto-layout: " +
              mode
          );
        }
      }
      result.method = "auto-layout";
      result.primaryAxisAlignItems = parent.primaryAxisAlignItems;
      result.counterAxisAlignItems = parent.counterAxisAlignItems;
      if (args.recursive) {
        result.recursiveApplied = applyRecursiveFrameAlign(parent, args, 0, 4);
      }
      result.layoutCheck = buildLayoutCheck(parent);
      result.needsFollowUp = !result.layoutCheck.ok;
      return result;
    }
    if (hasAxis) {
      throw new Error(
        "primaryAxisAlignItems/counterAxisAlignItems apply only to auto-layout frames; use mode for absolute layout"
      );
    }
    if (!children.length) {
      throw new Error("No visible unlocked children to align");
    }
    var alignResult = alignAbsoluteChildren(parent, children, mode, padding);
    result.method = "absolute";
    result.moved = alignResult.moved;
    if (alignResult.delta) result.delta = alignResult.delta;
    if (alignResult.distributed) result.distributed = alignResult.distributed;
    if (args.recursive) {
      result.recursiveApplied = applyRecursiveFrameAlign(parent, args, 0, 4);
    }
    result.layoutCheck = buildLayoutCheck(parent);
    result.needsFollowUp = !result.layoutCheck.ok;
    return result;
  });
}

function normalizeLayoutAlign(value) {
  var v = String(value || "")
    .toUpperCase()
    .replace(/-/g, "_");
  if (v === "LEFT" || v === "TOP") return "MIN";
  if (v === "RIGHT" || v === "BOTTOM") return "MAX";
  if (v === "STRETCH") return "STRETCH";
  if (v === "INHERIT") return "INHERIT";
  if (v === "CENTER") return "CENTER";
  if (v === "MIN" || v === "MAX") return v;
  return null;
}

function normalizeLayoutSizing(value) {
  var v = String(value || "").toUpperCase();
  if (v === "AUTO" || v === "HUG") return "HUG";
  if (v === "FILL") return "FILL";
  if (v === "FIXED") return "FIXED";
  return null;
}

function setLayoutChild(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (args.layoutAlign != null && "layoutAlign" in node) {
      var la = normalizeLayoutAlign(args.layoutAlign);
      if (!la) {
        throw new Error(
          "layoutAlign must be MIN, MAX, CENTER, STRETCH, or INHERIT"
        );
      }
      node.layoutAlign = la;
    }
    if (args.layoutGrow != null && "layoutGrow" in node) {
      node.layoutGrow = Number(args.layoutGrow) ? 1 : 0;
    }
    if (args.layoutSizingHorizontal != null && "layoutSizingHorizontal" in node) {
      var lh = normalizeLayoutSizing(args.layoutSizingHorizontal);
      if (!lh) {
        throw new Error("layoutSizingHorizontal must be FIXED, HUG, or FILL");
      }
      node.layoutSizingHorizontal = lh;
    }
    if (args.layoutSizingVertical != null && "layoutSizingVertical" in node) {
      var lv = normalizeLayoutSizing(args.layoutSizingVertical);
      if (!lv) {
        throw new Error("layoutSizingVertical must be FIXED, HUG, or FILL");
      }
      node.layoutSizingVertical = lv;
    }
    if (
      args.layoutAlign == null &&
      args.layoutGrow == null &&
      args.layoutSizingHorizontal == null &&
      args.layoutSizingVertical == null
    ) {
      throw new Error(
        "set at least one of layoutAlign, layoutGrow, layoutSizingHorizontal, layoutSizingVertical"
      );
    }
    return {
      id: node.id,
      name: node.name,
      layoutAlign: "layoutAlign" in node ? node.layoutAlign : undefined,
      layoutGrow: "layoutGrow" in node ? node.layoutGrow : undefined,
      layoutSizingHorizontal:
        "layoutSizingHorizontal" in node
          ? node.layoutSizingHorizontal
          : undefined,
      layoutSizingVertical:
        "layoutSizingVertical" in node ? node.layoutSizingVertical : undefined,
    };
  });
}

function buildLayoutCheck(parent) {
  var issues = [];
  if (!parent || !("children" in parent) || !parent.children) {
    return { ok: true, issues: issues };
  }
  var parentW =
    "width" in parent && typeof parent.width === "number" ? parent.width : 0;
  var parentH =
    "height" in parent && typeof parent.height === "number" ? parent.height : 0;
  for (var i = 0; i < parent.children.length; i++) {
    var ch = parent.children[i];
    if (!ch.visible || ch.locked) continue;
    if (!("x" in ch) || !("width" in ch) || !("height" in ch)) continue;
    var right = ch.x + ch.width;
    var bottom = ch.y + ch.height;
    var overflow = [];
    if (ch.x < -0.5) overflow.push("left");
    if (ch.y < -0.5) overflow.push("top");
    if (parentW > 0 && right > parentW + 0.5) overflow.push("right");
    if (parentH > 0 && bottom > parentH + 0.5) overflow.push("bottom");
    if (overflow.length) {
      issues.push({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        issue: "overflow",
        edges: overflow,
        x: Math.round(ch.x),
        y: Math.round(ch.y),
        width: Math.round(ch.width),
        height: Math.round(ch.height),
      });
    }
  }
  return {
    ok: issues.length === 0,
    parentId: parent.id,
    parentWidth: parentW ? Math.round(parentW) : undefined,
    parentHeight: parentH ? Math.round(parentH) : undefined,
    issueCount: issues.length,
    issues: issues.slice(0, 24),
  };
}

function applyRecursiveFrameAlign(parent, args, depth, maxDepth) {
  if (!parent || !parent.children || depth >= maxDepth) return 0;
  var count = 0;
  for (var i = 0; i < parent.children.length; i++) {
    var ch = parent.children[i];
    if (!ch.visible || ch.locked) continue;
    if (
      ch.type === "FRAME" ||
      ch.type === "COMPONENT" ||
      ch.type === "INSTANCE"
    ) {
      if (ch.layoutMode && ch.layoutMode !== "NONE") {
        if (args.primaryAxisAlignItems != null || args.counterAxisAlignItems != null) {
          applyAutoLayoutAxisFields(ch, args);
        } else if (args.mode) {
          applyAutoLayoutFrameAlign(ch, args.mode);
        }
        count++;
      }
      count += applyRecursiveFrameAlign(ch, args, depth + 1, maxDepth);
    }
  }
  return count;
}

function buildParentPath(node) {
  var parts = [];
  var p = node.parent;
  while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
    parts.unshift(p.name || p.type);
    p = p.parent;
  }
  try {
    if (figma.currentPage) {
      parts.unshift(figma.currentPage.name);
    }
  } catch (_eP) {
    /* ignore */
  }
  return parts.join(" / ");
}

function nodeMatchesFindFilter(node, nameFilter, typeFilter) {
  if (isHiddenLayer(node)) return false;
  if (typeFilter && String(node.type).toUpperCase() !== typeFilter) {
    return false;
  }
  if (nameFilter) {
    var nm = String(node.name || "").toLowerCase();
    if (nm.indexOf(nameFilter) < 0) return false;
  }
  return true;
}

function findNodesInTree(args) {
  var scope = String(args.scope || "page").toLowerCase();
  var maxResults = Math.min(Math.max(Number(args.maxResults) || 20, 1), 50);
  var maxDepth = Math.min(Math.max(Number(args.maxDepth) || 6, 1), 10);
  var nameFilter = args.nameContains
    ? String(args.nameContains).toLowerCase()
    : null;
  var typeFilter = args.type ? String(args.type).toUpperCase() : null;
  var results = [];
  var truncated = false;

  function pushMatch(node, depth) {
    if (results.length >= maxResults) {
      truncated = true;
      return;
    }
    var row = {
      id: node.id,
      name: node.name,
      type: node.type,
      depth: depth,
    };
    attachNodeGeometry(node, row);
    row.parentPath = buildParentPath(node);
    results.push(row);
  }

  function walk(node, depth) {
    if (!node || depth > maxDepth) return;
    if (nodeMatchesFindFilter(node, nameFilter, typeFilter)) {
      pushMatch(node, depth);
    }
    if (results.length >= maxResults) return;
    if (!node.children || !node.children.length) return;
    for (var i = 0; i < node.children.length; i++) {
      walk(node.children[i], depth + 1);
      if (results.length >= maxResults) return;
    }
  }

  function runOnRoots(roots) {
    for (var r = 0; r < roots.length; r++) {
      walk(roots[r], 0);
      if (results.length >= maxResults) break;
    }
    return {
      matches: results,
      count: results.length,
      truncated: truncated,
      scope: scope,
    };
  }

  if (scope === "selection") {
    return Promise.resolve(runOnRoots(figma.currentPage.selection.slice()));
  }
  if (args.rootId) {
    return resolveNode(args.rootId).then(function (root) {
      return runOnRoots([root]);
    });
  }
  return Promise.resolve(runOnRoots(figma.currentPage.children.slice()));
}

function layoutReport(args) {
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    var check = buildLayoutCheck(node);
    var summary = {
      id: node.id,
      name: node.name,
      type: node.type,
      layoutMode: node.layoutMode || "NONE",
      width: "width" in node ? Math.round(node.width) : undefined,
      height: "height" in node ? Math.round(node.height) : undefined,
    };
    if (node.layoutMode && node.layoutMode !== "NONE") {
      summary.primaryAxisAlignItems = node.primaryAxisAlignItems;
      summary.counterAxisAlignItems = node.counterAxisAlignItems;
      summary.itemSpacing = node.itemSpacing;
    }
    return {
      node: summary,
      layoutCheck: check,
      ok: check.ok,
      needsFollowUp: !check.ok,
    };
  });
}

function resizeFrame(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  var hasGeom =
    args.width != null ||
    args.height != null ||
    args.x != null ||
    args.y != null;
  if (!hasGeom && !args.alignMode && !args.alignContent && !args.primaryAxisAlignItems) {
    return Promise.reject(
      new Error("resize needs width/height/x/y and/or align options")
    );
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (node.type === "PAGE" || node.type === "DOCUMENT") {
      throw new Error("Cannot resize page/document");
    }
    if (hasGeom) {
      applyOptionalGeometry(node, args);
    }
    var result = Object.assign(nodeCreateSummary(node), { resized: hasGeom });
    var alignMode = args.alignMode || args.alignContent;
    var wantsAlign =
      alignMode ||
      args.primaryAxisAlignItems != null ||
      args.counterAxisAlignItems != null;
    function finish() {
      result.layoutCheck = buildLayoutCheck(node);
      result.needsFollowUp = !result.layoutCheck.ok;
      selectCreatedNode(node, args.select === true);
      return result;
    }
    if (!wantsAlign) {
      return finish();
    }
    return alignChildrenInFrame({
      parentId: node.id,
      mode: alignMode,
      primaryAxisAlignItems: args.primaryAxisAlignItems,
      counterAxisAlignItems: args.counterAxisAlignItems,
      recursive: args.recursiveAlign === true || args.recursive === true,
      padding: args.padding,
    }).then(function (alignResult) {
      result.align = alignResult;
      return finish();
    });
  });
}

function batchTextReplace(args) {
  requireWrite();
  var rootId = args.rootId || args.nodeId;
  if (!rootId) {
    return Promise.reject(new Error("rootId or nodeId is required"));
  }
  if (args.search == null) {
    return Promise.reject(new Error("search is required"));
  }
  var replace = args.replace != null ? String(args.replace) : "";
  var needle = String(args.search);
  return resolveNode(rootId).then(function (root) {
    var texts = [];
    collectTextNodes(root, 0, texts);
    if (!texts.length) {
      return { matched: 0, updated: 0, nodes: [] };
    }
    return getAvailableFonts().then(function (available) {
      var updated = [];
      var chain = Promise.resolve();
      texts.forEach(function (textNode) {
        chain = chain.then(function () {
          var cur = String(textNode.characters || "");
          if (cur.indexOf(needle) < 0) return;
          return ensureTextFontsLoaded(textNode, available).then(function () {
            applyTextCharacters(textNode, null, needle, replace);
            updated.push({
              id: textNode.id,
              name: textNode.name,
              preview: String(textNode.characters || "").slice(0, 80),
            });
          });
        });
      });
      return chain.then(function () {
        return {
          matched: updated.length,
          updated: updated.length,
          search: needle,
          replace: replace,
          nodes: updated.slice(0, 30),
        };
      });
    });
  });
}

function copyChildLayoutProps(sourceChild, targetChild) {
  var applied = [];
  if ("layoutAlign" in sourceChild && "layoutAlign" in targetChild) {
    targetChild.layoutAlign = sourceChild.layoutAlign;
    applied.push("layoutAlign");
  }
  if ("layoutGrow" in sourceChild && "layoutGrow" in targetChild) {
    targetChild.layoutGrow = sourceChild.layoutGrow;
    applied.push("layoutGrow");
  }
  if (
    "layoutSizingHorizontal" in sourceChild &&
    "layoutSizingHorizontal" in targetChild
  ) {
    targetChild.layoutSizingHorizontal = sourceChild.layoutSizingHorizontal;
    applied.push("layoutSizingHorizontal");
  }
  if (
    "layoutSizingVertical" in sourceChild &&
    "layoutSizingVertical" in targetChild
  ) {
    targetChild.layoutSizingVertical = sourceChild.layoutSizingVertical;
    applied.push("layoutSizingVertical");
  }
  return applied;
}

function matchLayout(args) {
  requireWrite();
  if (!args.fromFrameId || !args.toFrameId) {
    return Promise.reject(new Error("fromFrameId and toFrameId are required"));
  }
  return Promise.all([
    resolveNode(args.fromFrameId),
    resolveNode(args.toFrameId),
  ]).then(function (pair) {
    var source = pair[0];
    var target = pair[1];
    var include = Array.isArray(args.include)
      ? args.include
      : ["autoLayout", "geometry", "childrenSizing"];
    var applied = [];
    if (include.indexOf("autoLayout") >= 0) {
      applied = applied.concat(
        copyVisualStyles(source, target, { include: ["autoLayout"] })
      );
    }
    if (
      include.indexOf("geometry") >= 0 &&
      typeof target.resize === "function" &&
      "width" in source &&
      "height" in source
    ) {
      target.resize(source.width, source.height);
      applied.push("geometry");
    }
    if (include.indexOf("childrenSizing") >= 0 && source.children && target.children) {
      var n = Math.min(source.children.length, target.children.length);
      var childApplied = 0;
      for (var i = 0; i < n; i++) {
        var sc = source.children[i];
        var tc = target.children[i];
        if (!sc || !tc || tc.locked || !tc.visible) continue;
        var props = copyChildLayoutProps(sc, tc);
        if (props.length) childApplied++;
      }
      if (childApplied) applied.push("childrenSizing:" + childApplied);
    }
    var check = buildLayoutCheck(target);
    return {
      fromFrameId: source.id,
      toFrameId: target.id,
      applied: applied,
      layoutCheck: check,
      needsFollowUp: !check.ok,
    };
  });
}

function normalizeConstraint(value) {
  var v = String(value || "").toUpperCase();
  if (v === "LEFT" || v === "TOP") return "MIN";
  if (v === "RIGHT" || v === "BOTTOM") return "MAX";
  if (v === "MIN" || v === "MAX" || v === "CENTER" || v === "STRETCH" || v === "SCALE") {
    return v;
  }
  return null;
}

function setNodeConstraints(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (!("constraints" in node)) {
      throw new Error("Node does not support constraints");
    }
    var c = {
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical,
    };
    if (args.horizontal != null) {
      var h = normalizeConstraint(args.horizontal);
      if (!h) throw new Error("invalid horizontal constraint");
      c.horizontal = h;
    }
    if (args.vertical != null) {
      var v = normalizeConstraint(args.vertical);
      if (!v) throw new Error("invalid vertical constraint");
      c.vertical = v;
    }
    node.constraints = c;
    return { id: node.id, constraints: node.constraints };
  });
}

function buildDropShadowEffect(args) {
  var color = args.color || { r: 0, g: 0, b: 0, a: 0.25 };
  return {
    type: "DROP_SHADOW",
    color: {
      r: Number(color.r) || 0,
      g: Number(color.g) || 0,
      b: Number(color.b) || 0,
      a: color.a != null ? Number(color.a) : 0.25,
    },
    offset: {
      x: args.offsetX != null ? Number(args.offsetX) : 0,
      y: args.offsetY != null ? Number(args.offsetY) : 4,
    },
    radius: args.radius != null ? Number(args.radius) : 8,
    spread: args.spread != null ? Number(args.spread) : 0,
    visible: true,
    blendMode: "NORMAL",
  };
}

function setNodeEffects(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (!("effects" in node)) {
      throw new Error("Node does not support effects");
    }
    if (args.clear === true) {
      node.effects = [];
      return { id: node.id, effects: 0 };
    }
    if (args.copyFromId) {
      return resolveNode(args.copyFromId).then(function (source) {
        if (!("effects" in source)) {
          throw new Error("Source has no effects");
        }
        var effects = clonePaintsSafe(source.effects);
        if (effects) node.effects = effects;
        return {
          id: node.id,
          copiedFrom: source.id,
          effects: node.effects ? node.effects.length : 0,
        };
      });
    }
    if (args.dropShadow) {
      node.effects = [buildDropShadowEffect(args.dropShadow || args)];
      return { id: node.id, effects: node.effects.length };
    }
    throw new Error("pass dropShadow, copyFromId, or clear:true");
  });
}

function groupCanvasNodes(args) {
  requireWrite();
  var ids = Array.isArray(args.nodeIds) ? args.nodeIds : [];
  if (ids.length < 1) {
    return Promise.reject(new Error("nodeIds needs at least one id"));
  }
  return Promise.all(ids.map(resolveNode)).then(function (nodes) {
    var parent = nodes[0].parent;
    if (!parent) throw new Error("Nodes have no parent");
    var group = figma.group(nodes, parent);
    if (args.name) group.name = String(args.name);
    selectCreatedNode(group, args.select !== false);
    return nodeCreateSummary(group);
  });
}

function ungroupCanvasNode(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (node.type !== "GROUP") {
      throw new Error("Node is not a GROUP");
    }
    var children = node.children ? node.children.slice() : [];
    figma.ungroup(node);
    return {
      ungrouped: true,
      childCount: children.length,
      childIds: children.map(function (c) {
        return c.id;
      }),
    };
  });
}

function setLayoutGrid(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (!("layoutGrids" in node)) {
      throw new Error("Node does not support layout grids");
    }
    if (args.clear === true || args.showGrid === false) {
      node.layoutGrids = [];
      return { id: node.id, layoutGrids: 0 };
    }
    var size = Number(args.size || args.sectionSize || 8);
    if (!(size > 0)) size = 8;
    var pattern = String(args.pattern || "COLUMNS").toUpperCase();
    if (pattern !== "COLUMNS" && pattern !== "ROWS" && pattern !== "GRID") {
      pattern = "COLUMNS";
    }
    var grid = {
      pattern: pattern,
      sectionSize: size,
      visible: args.visible !== false,
      color: { r: 0.85, g: 0.85, b: 0.85, a: 0.35 },
      alignment: "STRETCH",
      gutterSize: Number(args.gutterSize || 20),
      offset: Number(args.offset || 0),
      count: Number(args.count || 12),
    };
    node.layoutGrids = [grid];
    return { id: node.id, layoutGrids: node.layoutGrids.length, pattern: pattern, size: size };
  });
}

var LAYOUT_VERIFY_OPS = {
  set_geometry: true,
  set_auto_layout: true,
  reparent_node: true,
  set_layout_child: true,
};

function resolveLayoutVerifyNodeId(edits) {
  if (!Array.isArray(edits)) return null;
  for (var i = edits.length - 1; i >= 0; i--) {
    var edit = edits[i];
    if (!edit) continue;
    var op = String(edit.op || "");
    if (!LAYOUT_VERIFY_OPS[op]) continue;
    if (edit.parentId) return String(edit.parentId);
    if (edit.nodeId) return String(edit.nodeId);
  }
  return null;
}

function attachLayoutVerifyByNodeId(nodeId, result) {
  if (!nodeId) return Promise.resolve(result);
  return resolveNode(nodeId)
    .then(function (node) {
      var target = node;
      if (
        target &&
        (!target.children || !target.children.length) &&
        target.parent &&
        "children" in target.parent
      ) {
        target = target.parent;
      }
      if (target && "children" in target) {
        result.layoutCheck = buildLayoutCheck(target);
        result.needsFollowUp = !result.layoutCheck.ok;
      }
      return result;
    })
    .catch(function () {
      return result;
    });
}

function applyLayoutRecipe(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  var recipe = String(args.recipe || "")
    .toLowerCase()
    .replace(/-/g, "_");
  if (!recipe) {
    return Promise.reject(new Error("recipe is required"));
  }
  if (recipe === "center_content" || recipe === "center") {
    return alignChildrenInFrame({
      parentId: args.nodeId,
      mode: "center",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
      recursive: args.recursive !== false,
    });
  }
  if (
    recipe === "resize_center" ||
    recipe === "desktop_resize" ||
    recipe === "resize"
  ) {
    if (args.width == null && args.height == null) {
      return Promise.reject(new Error("resize recipe needs width and/or height"));
    }
    return resizeFrame({
      nodeId: args.nodeId,
      width: args.width,
      height: args.height,
      alignMode: args.alignMode || "center",
      primaryAxisAlignItems: args.primaryAxisAlignItems,
      counterAxisAlignItems: args.counterAxisAlignItems,
      recursiveAlign: args.recursive !== false,
      padding: args.padding,
    });
  }
  if (recipe === "tablet") {
    return resizeFrame({
      nodeId: args.nodeId,
      width: args.width != null ? args.width : 768,
      height: args.height,
      alignMode: "center",
      recursiveAlign: true,
    });
  }
  if (recipe === "absolute_to_autolayout" || recipe === "autolayout") {
    var layoutMode = String(args.layoutMode || "VERTICAL").toUpperCase();
    return resolveNode(args.nodeId).then(function (node) {
      if (!("layoutMode" in node)) {
        throw new Error("Node does not support auto-layout");
      }
      var chain = Promise.resolve();
      if (args.styleFromId) {
        chain = resolveNode(args.styleFromId).then(function (src) {
          copyVisualStyles(src, node, { include: ["autoLayout"] });
        });
      }
      return chain.then(function () {
        node.layoutMode =
          layoutMode === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL";
        if (args.padding != null) {
          var p = Number(args.padding);
          node.paddingTop = p;
          node.paddingRight = p;
          node.paddingBottom = p;
          node.paddingLeft = p;
        }
        return alignChildrenInFrame({
          parentId: node.id,
          mode: args.alignMode || "center",
          primaryAxisAlignItems: args.primaryAxisAlignItems || "CENTER",
          counterAxisAlignItems: args.counterAxisAlignItems || "CENTER",
          recursive: args.recursive !== false,
        });
      });
    });
  }
  if (recipe === "match_reference" || recipe === "match_sibling") {
    if (!args.fromFrameId && !args.referenceId) {
      return Promise.reject(
        new Error("match_reference recipe needs fromFrameId or referenceId")
      );
    }
    return matchLayout({
      fromFrameId: args.fromFrameId || args.referenceId,
      toFrameId: args.nodeId,
      include: args.include,
    });
  }
  return Promise.reject(
    new Error(
      "unknown recipe: " +
        recipe +
        " (use center_content, resize_center, tablet, absolute_to_autolayout, match_reference)"
    )
  );
}

function batchInvokeTools(args) {
  var calls = Array.isArray(args.calls) ? args.calls : [];
  if (!calls.length) {
    return Promise.reject(new Error("figma_batch_tools needs a non-empty calls array"));
  }
  if (calls.length > BATCH_TOOLS_MAX) {
    return Promise.reject(
      new Error(
        "figma_batch_tools max " + BATCH_TOOLS_MAX + " calls (got " + calls.length + ")"
      )
    );
  }
  var results = [];
  var chain = Promise.resolve();
  calls.forEach(function (call, index) {
    chain = chain.then(function () {
      if (!call || !call.name) {
        results.push({ index: index, ok: false, error: "missing tool name" });
        return;
      }
      return invokeTool(String(call.name), call.args || {}, {
        quiet: true,
        skipUndo: true,
      })
        .then(function (result) {
          results.push({
            index: index,
            ok: true,
            name: call.name,
            result: result,
          });
        })
        .catch(function (err) {
          results.push({
            index: index,
            ok: false,
            name: call.name,
            error: err && err.message ? err.message : String(err),
          });
        });
    });
  });
  return chain.then(function () {
    var ok = true;
    for (var j = 0; j < results.length; j++) {
      if (!results[j].ok) ok = false;
    }
    var out = {
      ok: ok,
      count: results.length,
      results: results,
    };
    var verifyId = null;
    for (var k = calls.length - 1; k >= 0; k--) {
      var c = calls[k];
      if (!c || !c.name) continue;
      if (c.name === "figma_resize_frame" || c.name === "figma_align_in_frame") {
        verifyId =
          (c.args && (c.args.parentId || c.args.nodeId)) || verifyId;
        break;
      }
      if (c.name === "figma_apply_edits" && c.args && c.args.edits) {
        verifyId = resolveLayoutVerifyNodeId(c.args.edits) || verifyId;
        break;
      }
      if (
        c.name === "figma_apply_to_children" &&
        c.args &&
        c.args.parentId
      ) {
        verifyId = c.args.parentId;
        break;
      }
    }
    return attachLayoutVerifyByNodeId(verifyId, out);
  });
}

function listDirectChildren(args) {
  if (!args.parentId) {
    return Promise.reject(new Error("parentId is required"));
  }
  var nameFilter = args.nameContains
    ? String(args.nameContains).toLowerCase()
    : null;
  var typeFilter = args.type ? String(args.type).toUpperCase() : null;
  return resolveNode(args.parentId).then(function (parent) {
    if (!parent || !parent.children) {
      throw new Error("parentId must be a container with children");
    }
    var list = [];
    for (var i = 0; i < parent.children.length; i++) {
      var ch = parent.children[i];
      if (!ch.visible) continue;
      if (nameFilter && String(ch.name || "").toLowerCase().indexOf(nameFilter) < 0) {
        continue;
      }
      if (typeFilter && String(ch.type).toUpperCase() !== typeFilter) {
        continue;
      }
      var row = {
        id: ch.id,
        name: ch.name,
        type: ch.type,
        index: i,
        locked: ch.locked === true,
      };
      attachNodeGeometry(ch, row);
      enrichNodeDetails(ch, row, 1);
      row.parentPath = buildParentPath(ch);
      list.push(row);
    }
    return {
      parentId: parent.id,
      parentName: parent.name,
      layoutMode: parent.layoutMode || "NONE",
      count: list.length,
      children: list,
    };
  });
}

var APPLY_TO_CHILDREN_OPS = {
  set_geometry: true,
  set_layout_child: true,
  set_fills: true,
  set_text: true,
  set_name: true,
  set_opacity: true,
  set_corner_radius: true,
  set_font: true,
  set_stroke: true,
};

function applyEditToChildren(args) {
  requireWrite();
  if (!args.parentId) {
    return Promise.reject(new Error("parentId is required"));
  }
  var op = String(args.op || "");
  if (!APPLY_TO_CHILDREN_OPS[op]) {
    return Promise.reject(
      new Error(
        "unsupported op for apply_to_children: " +
          op +
          " (use set_geometry, set_layout_child, set_fills, set_text, set_name, set_opacity, set_corner_radius, set_font, set_stroke)"
      )
    );
  }
  var maxTargets = Math.min(Math.max(Number(args.maxTargets) || 40, 1), 80);
  return listDirectChildren(args).then(function (listed) {
    var targets = (listed.children || []).filter(function (c) {
      return !c.locked;
    });
    if (!targets.length) {
      throw new Error("No matching unlocked children under parent");
    }
    if (targets.length > maxTargets) {
      throw new Error(
        "Too many children (" +
          targets.length +
          "); narrow nameContains/type or raise maxTargets (max 80)"
      );
    }
    var edits = [];
    for (var i = 0; i < targets.length; i++) {
      var edit = { op: op, nodeId: targets[i].id };
      for (var key in args) {
        if (
          Object.prototype.hasOwnProperty.call(args, key) &&
          key !== "parentId" &&
          key !== "nameContains" &&
          key !== "type" &&
          key !== "op" &&
          key !== "maxTargets"
        ) {
          edit[key] = args[key];
        }
      }
      edits.push(edit);
    }
    return applyCanvasEdits({ edits: edits }).then(function (result) {
      result.parentId = listed.parentId;
      result.parentName = listed.parentName;
      result.matched = targets.length;
      return result;
    });
  });
}

function nudgeNodes(args) {
  requireWrite();
  var dx = Number(args.dx || args.deltaX || 0);
  var dy = Number(args.dy || args.deltaY || 0);
  if (!dx && !dy) {
    return Promise.reject(new Error("nudge needs dx and/or dy"));
  }
  if (Array.isArray(args.nodeIds) && args.nodeIds.length) {
    var ids = args.nodeIds.slice(0, 80);
    return Promise.all(ids.map(resolveNode)).then(function (nodes) {
      var batch = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || n.locked || !("x" in n)) continue;
        batch.push({
          op: "set_geometry",
          nodeId: n.id,
          x: n.x + dx,
          y: n.y + dy,
        });
      }
      if (!batch.length) {
        throw new Error("No nudgeable nodes");
      }
      return applyCanvasEdits({ edits: batch });
    });
  }
  if (args.parentId) {
    return listDirectChildren(args).then(function (listed) {
      var batch = [];
      for (var j = 0; j < (listed.children || []).length; j++) {
        var c = listed.children[j];
        if (c.locked || c.x == null || c.y == null) continue;
        batch.push({
          op: "set_geometry",
          nodeId: c.id,
          x: c.x + dx,
          y: c.y + dy,
        });
      }
      if (!batch.length) {
        throw new Error("No matching children to nudge");
      }
      return applyCanvasEdits({ edits: batch }).then(function (result) {
        result.parentId = listed.parentId;
        result.nudged = batch.length;
        result.dx = dx;
        result.dy = dy;
        return result;
      });
    });
  }
  return Promise.reject(new Error("nodeIds or parentId required for nudge"));
}

var CREATABLE_TYPES = {
  FRAME: true,
  RECTANGLE: true,
  ELLIPSE: true,
  TEXT: true,
};

function resolveParentContainer(parentId) {
  if (!parentId) {
    return Promise.resolve(figma.currentPage);
  }
  return resolveNode(parentId).then(function (parent) {
    if (!parent || !("appendChild" in parent)) {
      throw new Error("parentId must be a frame, group, or page that can hold children");
    }
    if (parent.type === "DOCUMENT") {
      throw new Error("Cannot append to DOCUMENT — use a page or frame");
    }
    return parent;
  });
}

function applyOptionalGeometry(node, args) {
  if (args.width != null || args.height != null) {
    if (typeof node.resize === "function") {
      var w =
        args.width != null
          ? Number(args.width)
          : "width" in node
            ? node.width
            : 100;
      var h =
        args.height != null
          ? Number(args.height)
          : "height" in node
            ? node.height
            : 100;
      if (!(w > 0) || !(h > 0)) {
        throw new Error("width and height must be positive numbers");
      }
      node.resize(w, h);
    }
  }
  if (args.x != null && "x" in node) node.x = Number(args.x);
  if (args.y != null && "y" in node) node.y = Number(args.y);
}

function applyOptionalFill(node, color) {
  if (color == null) return;
  if (!("fills" in node)) return;
  node.fills = [solidPaintFromArgs(color)];
}

function nodeCreateSummary(node) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    width: "width" in node ? node.width : undefined,
    height: "height" in node ? node.height : undefined,
    x: "x" in node ? node.x : undefined,
    y: "y" in node ? node.y : undefined,
    parentId: node.parent && node.parent.id ? node.parent.id : undefined,
  };
}

function clonePaintsSafe(paints) {
  if (!paints || paints === figma.mixed) return null;
  try {
    return JSON.parse(JSON.stringify(paints));
  } catch (_e) {
    return null;
  }
}

function copyVisualStyles(source, target, opts) {
  opts = opts || {};
  var include = opts.include || null; // null = all common fields
  function want(key) {
    return !include || include.indexOf(key) >= 0;
  }
  var applied = [];

  if (want("opacity") && "opacity" in source && "opacity" in target) {
    target.opacity = source.opacity;
    applied.push("opacity");
  }
  if (want("fills") && "fills" in source && "fills" in target) {
    var fills = clonePaintsSafe(source.fills);
    if (fills) {
      target.fills = fills;
      applied.push("fills");
    }
  }
  if (want("strokes") && "strokes" in source && "strokes" in target) {
    var strokes = clonePaintsSafe(source.strokes);
    if (strokes) {
      target.strokes = strokes;
      applied.push("strokes");
    }
  }
  if (
    want("strokeWeight") &&
    "strokeWeight" in source &&
    "strokeWeight" in target &&
    source.strokeWeight !== figma.mixed
  ) {
    target.strokeWeight = source.strokeWeight;
    applied.push("strokeWeight");
  }
  if (want("cornerRadius")) {
    if (
      "cornerRadius" in source &&
      "cornerRadius" in target &&
      source.cornerRadius !== figma.mixed
    ) {
      target.cornerRadius = source.cornerRadius;
      applied.push("cornerRadius");
    } else if ("topLeftRadius" in source && "topLeftRadius" in target) {
      target.topLeftRadius = source.topLeftRadius;
      target.topRightRadius = source.topRightRadius;
      target.bottomRightRadius = source.bottomRightRadius;
      target.bottomLeftRadius = source.bottomLeftRadius;
      applied.push("cornerRadius");
    }
  }
  if (want("effects") && "effects" in source && "effects" in target) {
    var effects = clonePaintsSafe(source.effects);
    if (effects) {
      target.effects = effects;
      applied.push("effects");
    }
  }
  if (
    want("autoLayout") &&
    "layoutMode" in source &&
    "layoutMode" in target
  ) {
    target.layoutMode = source.layoutMode;
    if (source.layoutMode && source.layoutMode !== "NONE") {
      target.paddingTop = source.paddingTop;
      target.paddingRight = source.paddingRight;
      target.paddingBottom = source.paddingBottom;
      target.paddingLeft = source.paddingLeft;
      target.itemSpacing = source.itemSpacing;
      if (source.primaryAxisAlignItems) {
        target.primaryAxisAlignItems = source.primaryAxisAlignItems;
      }
      if (source.counterAxisAlignItems) {
        target.counterAxisAlignItems = source.counterAxisAlignItems;
      }
      if (
        "layoutWrap" in source &&
        "layoutWrap" in target &&
        source.layoutWrap
      ) {
        target.layoutWrap = source.layoutWrap;
      }
    }
    applied.push("autoLayout");
  }
  return applied;
}

function copyTextStyles(source, target) {
  if (source.type !== "TEXT" || target.type !== "TEXT") {
    return Promise.resolve([]);
  }
  return loadFontsForTextNode(source)
    .catch(function () {
      return getAvailableFonts().then(function (available) {
        return loadFallbackFont(available).then(function (font) {
          reassignTextNodeFont(source, font);
        });
      });
    })
    .then(function () {
      var fonts = collectTextNodeFonts(source);
      return fonts.reduce(function (chain, font) {
        return chain.then(function () {
          return figma.loadFontAsync(font).catch(function () {
            /* ignore missing */
          });
        });
      }, Promise.resolve());
    })
    .then(function () {
      var applied = [];
      if (source.fontName !== figma.mixed && source.fontName) {
        target.fontName = source.fontName;
        applied.push("fontName");
      }
      if (source.fontSize !== figma.mixed) {
        target.fontSize = source.fontSize;
        applied.push("fontSize");
      }
      try {
        if (
          source.lineHeight !== figma.mixed &&
          source.lineHeight
        ) {
          target.lineHeight = source.lineHeight;
          applied.push("lineHeight");
        }
      } catch (_e) {
        /* ignore */
      }
      try {
        if (
          source.letterSpacing !== figma.mixed &&
          source.letterSpacing
        ) {
          target.letterSpacing = source.letterSpacing;
          applied.push("letterSpacing");
        }
      } catch (_e2) {
        /* ignore */
      }
      if (source.textAlignHorizontal) {
        target.textAlignHorizontal = source.textAlignHorizontal;
        applied.push("textAlignHorizontal");
      }
      if (source.textAlignVertical) {
        target.textAlignVertical = source.textAlignVertical;
        applied.push("textAlignVertical");
      }
      if ("fills" in source && "fills" in target) {
        var fills = clonePaintsSafe(source.fills);
        if (fills) {
          target.fills = fills;
          applied.push("fills");
        }
      }
      return applied;
    });
}

function copyStylesToNode(fromNodeId, toNodeId, opts) {
  requireWrite();
  opts = opts || {};
  return Promise.all([resolveNode(fromNodeId), resolveNode(toNodeId)]).then(
    function (pair) {
      var source = pair[0];
      var target = pair[1];
      var applied = copyVisualStyles(source, target, opts);
      return copyTextStyles(source, target).then(function (textApplied) {
        if (textApplied && textApplied.length) {
          applied = applied.concat(textApplied);
        }
        // de-dupe
        var seen = {};
        var uniq = [];
        for (var i = 0; i < applied.length; i++) {
          if (seen[applied[i]]) continue;
          seen[applied[i]] = true;
          uniq.push(applied[i]);
        }
        return {
          fromId: source.id,
          toId: target.id,
          applied: uniq,
        };
      });
    }
  );
}

function setNodeStroke(nodeId, color, weight) {
  requireWrite();
  return resolveNode(nodeId).then(function (node) {
    if (!("strokes" in node)) {
      throw new Error("Node does not support strokes");
    }
    node.strokes = [solidPaintFromArgs(color)];
    if (weight != null && "strokeWeight" in node && !isNaN(Number(weight))) {
      node.strokeWeight = Number(weight);
    }
    return {
      id: node.id,
      strokes: paintsToSimple(node.strokes),
      strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
    };
  });
}

function setNodeFont(nodeId, args) {
  requireWrite();
  args = args && typeof args === "object" ? args : {};
  return resolveNode(nodeId).then(function (node) {
    assertNodeWritable(node);
    var textNode = resolveTextNodeForFont(node, nodeId);
    assertNodeWritable(textNode);
    var primary = readPrimaryFontName(textNode);
    var family =
      args.family != null ? String(args.family) : primary.family;
    var style = args.style != null ? String(args.style) : primary.style;
    var requested = { family: family, style: style };
    return getAvailableFonts().then(function (available) {
      return ensureTextFontsLoaded(textNode, available)
        .catch(function () {
          return null;
        })
        .then(function () {
          return loadOneFont(requested, available);
        })
        .then(function (appliedFont) {
          reassignTextNodeFont(textNode, appliedFont);
          setTextNodeFontSize(textNode, args.fontSize);
          var out = {
            id: textNode.id,
            fontName: appliedFont,
            fontSize:
              textNode.fontSize !== figma.mixed ? textNode.fontSize : undefined,
          };
          if (fontKey(appliedFont) !== fontKey(requested)) {
            out.requestedFont = requested;
            out.fontSubstituted = true;
            out.similarFonts = findSimilarFonts(requested, available, 6).map(
              function (f) {
                return { family: f.family, style: f.style };
              }
            );
            out.hint =
              "Exact font not installed in Figma. Applied closest match. " +
              "Call figma_list_fonts with nameContains for exact family/style. " +
              "Enable team fonts in Figma if the typeface is used in the file but missing here.";
          }
          return out;
        })
        .catch(function (err) {
          var similar = findSimilarFonts(requested, available, 8);
          var msg =
            err && err.message
              ? String(err.message)
              : 'Font not available: "' +
                requested.family +
                " " +
                requested.style +
                '".';
          if (similar.length && msg.indexOf("Similar installed") < 0) {
            msg +=
              " Similar installed: " +
              similar
                .map(function (f) {
                  return f.family + " / " + f.style;
                })
                .join("; ");
          } else if (!similar.length && msg.indexOf("figma_list_fonts") < 0) {
            msg += " Call figma_list_fonts (optionally nameContains).";
          }
          throw new Error(msg);
        });
    });
  });
}

function selectCreatedNode(node, select) {
  if (select === false) return;
  try {
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  } catch (_e) {
    /* ignore focus failures */
  }
}

function createCanvasNode(args) {
  requireWrite();
  var type = String(args.type || "").toUpperCase();
  if (!CREATABLE_TYPES[type]) {
    return Promise.reject(
      new Error(
        "figma_create_node type must be FRAME, RECTANGLE, ELLIPSE, or TEXT"
      )
    );
  }
  var styleFromId =
    args.styleFromId != null && String(args.styleFromId).trim()
      ? String(args.styleFromId)
      : null;

  function applyStyleFrom(node) {
    if (!styleFromId) return Promise.resolve(nodeCreateSummary(node));
    return copyStylesToNode(styleFromId, node.id, {}).then(function (copied) {
      return Object.assign(nodeCreateSummary(node), {
        styleFromId: styleFromId,
        styleApplied: copied.applied,
      });
    });
  }

  return resolveParentContainer(args.parentId).then(function (parent) {
    function place(node) {
      parent.appendChild(node);
      if (args.name != null && String(args.name).trim()) {
        node.name = String(args.name);
      }
      applyOptionalGeometry(node, args);
      if (args.color != null) {
        applyOptionalFill(node, args.color);
      }
      if (
        type === "FRAME" &&
        args.layoutMode != null &&
        "layoutMode" in node
      ) {
        var lm = String(args.layoutMode).toUpperCase();
        if (lm === "NONE" || lm === "HORIZONTAL" || lm === "VERTICAL") {
          node.layoutMode = lm;
        }
      }
      selectCreatedNode(node, args.select);
      return applyStyleFrom(node);
    }

    if (type === "FRAME") {
      var frame = figma.createFrame();
      if (args.width == null && args.height == null) {
        frame.resize(375, 812);
      }
      return place(frame);
    }
    if (type === "RECTANGLE") {
      var rect = figma.createRectangle();
      if (args.width == null && args.height == null) {
        rect.resize(100, 100);
      }
      return place(rect);
    }
    if (type === "ELLIPSE") {
      var ellipse = figma.createEllipse();
      if (args.width == null && args.height == null) {
        ellipse.resize(100, 100);
      }
      return place(ellipse);
    }

    // TEXT — prefer styleFromId font; else fallback
    var fontChain = styleFromId
      ? resolveNode(styleFromId)
          .then(function (src) {
            if (src.type === "TEXT") {
              return loadFontsForTextNode(src)
                .then(function () {
                  return src.fontName !== figma.mixed && src.fontName
                    ? src.fontName
                    : null;
                })
                .catch(function () {
                  return null;
                });
            }
            return null;
          })
          .catch(function () {
            return null;
          })
      : Promise.resolve(null);

    return fontChain.then(function (prefFont) {
      var loadFont = prefFont
        ? figma.loadFontAsync(prefFont).then(function () {
            return prefFont;
          })
        : getAvailableFonts().then(function (available) {
            return loadFallbackFont(available);
          });
      return loadFont.then(function (font) {
        var text = figma.createText();
        reassignTextNodeFont(text, font);
        parent.appendChild(text);
        if (args.name != null && String(args.name).trim()) {
          text.name = String(args.name);
        }
        var chars =
          args.characters != null ? String(args.characters) : "Text";
        text.characters = chars;
        applyOptionalGeometry(text, args);
        if (args.color != null) {
          applyOptionalFill(text, args.color);
        }
        selectCreatedNode(text, args.select);
        return applyStyleFrom(text);
      });
    });
  });
}

function duplicateCanvasNode(args) {
  requireWrite();
  var nodeId = args.nodeId;
  if (!nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(nodeId).then(function (node) {
    if (
      !node ||
      node.type === "PAGE" ||
      node.type === "DOCUMENT" ||
      typeof node.clone !== "function"
    ) {
      throw new Error("Cannot duplicate this node type: " + (node && node.type));
    }
    var clone = node.clone();
    var offsetX =
      args.offsetX != null && !isNaN(Number(args.offsetX))
        ? Number(args.offsetX)
        : 40;
    var offsetY =
      args.offsetY != null && !isNaN(Number(args.offsetY))
        ? Number(args.offsetY)
        : 40;
    if ("x" in clone && "x" in node) clone.x = node.x + offsetX;
    if ("y" in clone && "y" in node) clone.y = node.y + offsetY;
    if (args.name != null && String(args.name).trim()) {
      clone.name = String(args.name);
    }

    function finish() {
      selectCreatedNode(clone, args.select);
      return Object.assign(nodeCreateSummary(clone), {
        sourceId: node.id,
      });
    }

    if (!args.parentId) {
      return finish();
    }
    return resolveParentContainer(args.parentId).then(function (parent) {
      if (clone.parent !== parent) {
        parent.appendChild(clone);
      }
      return finish();
    });
  });
}

function normalizeNodeIdList(args) {
  var ids = [];
  if (Array.isArray(args.nodeIds)) {
    for (var i = 0; i < args.nodeIds.length; i++) {
      var id = args.nodeIds[i];
      if (id != null && String(id).trim()) ids.push(String(id));
    }
  }
  if (args.nodeId != null && String(args.nodeId).trim()) {
    ids.push(String(args.nodeId));
  }
  // de-dupe preserving order
  var seen = {};
  var out = [];
  for (var j = 0; j < ids.length; j++) {
    if (seen[ids[j]]) continue;
    seen[ids[j]] = true;
    out.push(ids[j]);
  }
  return out;
}

function deleteCanvasNodes(args) {
  var ids = normalizeNodeIdList(args);
  if (!ids.length) {
    return Promise.reject(new Error("nodeId or nodeIds is required"));
  }
  if (ids.length > 50) {
    return Promise.reject(new Error("Delete at most 50 nodes per call"));
  }
  return ids
    .reduce(function (chain, nodeId) {
      return chain.then(function (acc) {
        return resolveNode(nodeId)
          .then(function (node) {
            if (
              !node ||
              node.type === "PAGE" ||
              node.type === "DOCUMENT" ||
              typeof node.remove !== "function"
            ) {
              acc.push({
                ok: false,
                id: nodeId,
                error: "Cannot delete this node type",
              });
              return acc;
            }
            var summary = {
              ok: true,
              id: node.id,
              name: node.name,
              type: node.type,
            };
            node.remove();
            acc.push(summary);
            return acc;
          })
          .catch(function (err) {
            acc.push({
              ok: false,
              id: nodeId,
              error: err && err.message ? err.message : String(err),
            });
            return acc;
          });
      });
    }, Promise.resolve([]))
    .then(function (results) {
      var deleted = results.filter(function (r) {
        return r.ok;
      });
      var failed = results.filter(function (r) {
        return !r.ok;
      });
      if (!deleted.length && failed.length) {
        throw new Error(
          "Delete failed: " + (failed[0].error || "unknown error")
        );
      }
      try {
        figma.currentPage.selection = [];
      } catch (_e) {
        /* ignore */
      }
      return {
        deleted: deleted.length,
        failed: failed.length,
        nodes: results,
        note:
          deleted.length > 0
            ? "Deleted nodes are gone. Do not re-inspect them; initial selection JSON may still list them (stale)."
            : undefined,
      };
    });
}

function setNodeGeometry(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  var hasGeom =
    args.x != null ||
    args.y != null ||
    args.width != null ||
    args.height != null;
  if (!hasGeom) {
    return Promise.reject(
      new Error("figma_set_geometry needs at least one of x, y, width, height")
    );
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (node.type === "PAGE" || node.type === "DOCUMENT") {
      throw new Error("Cannot set geometry on page/document");
    }
    applyOptionalGeometry(node, args);
    selectCreatedNode(node, args.select === true ? true : false);
    return nodeCreateSummary(node);
  });
}

function reparentCanvasNode(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  if (!args.parentId) {
    return Promise.reject(new Error("parentId is required"));
  }
  if (String(args.nodeId) === String(args.parentId)) {
    return Promise.reject(new Error("nodeId and parentId must differ"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (
      !node ||
      node.type === "PAGE" ||
      node.type === "DOCUMENT" ||
      typeof node.remove !== "function"
    ) {
      throw new Error("Cannot reparent this node type");
    }
    return resolveParentContainer(args.parentId).then(function (parent) {
      // Prevent parenting under own descendant
      var walk = parent;
      while (walk) {
        if (walk.id === node.id) {
          throw new Error("Cannot reparent a node under its own descendant");
        }
        walk = walk.parent;
      }
      if (args.index != null && !isNaN(Number(args.index)) && "insertChild" in parent) {
        var idx = Math.max(0, Number(args.index) | 0);
        var max =
          "children" in parent && parent.children
            ? parent.children.length
            : idx;
        if (node.parent === parent) {
          // already under parent — insertChild still reorders
          parent.insertChild(Math.min(idx, max), node);
        } else {
          parent.insertChild(Math.min(idx, max), node);
        }
      } else {
        parent.appendChild(node);
      }
      if (args.x != null || args.y != null) {
        applyOptionalGeometry(node, { x: args.x, y: args.y });
      }
      selectCreatedNode(node, args.select === true ? true : false);
      return nodeCreateSummary(node);
    });
  });
}

function setNodeOpacity(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  if (args.opacity == null || isNaN(Number(args.opacity))) {
    return Promise.reject(new Error("opacity (0–1) is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (!("opacity" in node)) {
      throw new Error("Node does not support opacity");
    }
    var o = Number(args.opacity);
    if (o < 0) o = 0;
    if (o > 1) o = 1;
    node.opacity = o;
    return { id: node.id, opacity: node.opacity };
  });
}

function setNodeCornerRadius(args) {
  requireWrite();
  if (!args.nodeId) {
    return Promise.reject(new Error("nodeId is required"));
  }
  return resolveNode(args.nodeId).then(function (node) {
    if (!("cornerRadius" in node) && !("topLeftRadius" in node)) {
      throw new Error("Node does not support corner radius");
    }
    if (args.radius != null) {
      var r = Number(args.radius);
      if ("cornerRadius" in node) node.cornerRadius = r;
      else {
        node.topLeftRadius = r;
        node.topRightRadius = r;
        node.bottomRightRadius = r;
        node.bottomLeftRadius = r;
      }
    }
    if (args.topLeft != null && "topLeftRadius" in node) {
      node.topLeftRadius = Number(args.topLeft);
    }
    if (args.topRight != null && "topRightRadius" in node) {
      node.topRightRadius = Number(args.topRight);
    }
    if (args.bottomRight != null && "bottomRightRadius" in node) {
      node.bottomRightRadius = Number(args.bottomRight);
    }
    if (args.bottomLeft != null && "bottomLeftRadius" in node) {
      node.bottomLeftRadius = Number(args.bottomLeft);
    }
    return {
      id: node.id,
      cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
      topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
      topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
      bottomRightRadius:
        "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
      bottomLeftRadius:
        "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
    };
  });
}

function invokeTool(name, args, opts) {
  args = args && typeof args === "object" ? args : {};
  var quiet = !!(opts && opts.quiet);
  if (CANVAS_WRITE_TOOLS[name] && name !== "figma_apply_edits") {
    beginCanvasWrite(opts);
  }
  var afterWrite = function (result) {
    if (!quiet) {
      pushSelection(undefined, { withTree: false, withPreview: false });
    }
    return result;
  };
  if (name === "figma_get_selection") {
    // Tool path: shallow tree for first roots + light ids for the rest; no PNG.
    return captureSelection({ withTree: true, withPreview: false }).then(
      function (sel) {
        return {
          fileName: sel.fileName,
          pageName: sel.pageName,
          nodeUrl: sel.nodeUrl,
          canWrite: sel.canWrite,
          selectedCount: sel.selectedCount,
          nodes: sel.nodes,
        };
      }
    );
  }
  if (name === "figma_inspect_node") {
    return inspectNode(args.nodeId, args);
  }
  if (name === "figma_find_nodes") {
    return findNodesInTree(args);
  }
  if (name === "figma_layout_report") {
    return layoutReport(args);
  }
  if (name === "figma_list_children") {
    return listDirectChildren(args);
  }
  if (name === "figma_focus_node") {
    return focusNode(args.nodeId);
  }
  if (name === "figma_set_name") {
    return setNodeName(args.nodeId, args.name).then(afterWrite);
  }
  if (name === "figma_set_text") {
    return setNodeText(
      args.nodeId,
      args.characters,
      args.search,
      args.replace
    ).then(afterWrite);
  }
  if (name === "figma_set_fills") {
    return setNodeFills(args.nodeId, args.color || args).then(afterWrite);
  }
  if (name === "figma_set_auto_layout") {
    return setAutoLayout(args.nodeId, args).then(afterWrite);
  }
  if (name === "figma_list_frames") {
    return Promise.resolve(
      listPageFrames(args.maxDepth, { selectedOnly: !!args.selectedOnly })
    );
  }
  if (name === "figma_list_components") {
    return Promise.resolve(
      listPageComponents(args.maxDepth, {
        selectedOnly: !!args.selectedOnly,
        includeInstances: !!args.includeInstances,
      })
    );
  }
  if (name === "figma_list_variables") {
    return listLocalVariables({
      nameContains: args.nameContains,
    });
  }
  if (name === "figma_list_fonts") {
    return listInstalledFonts(args);
  }
  if (name === "figma_get_reactions") {
    return getNodeReactions(args.nodeId);
  }
  if (name === "figma_set_prototype_link") {
    return setPrototypeLink(args.nodeId, args.destinationId, args);
  }
  if (name === "figma_set_prototype_flow") {
    return setPrototypeFlow(args.links);
  }
  if (name === "figma_clear_reactions") {
    return clearNodeReactions(args.nodeId);
  }
  if (name === "figma_create_node") {
    return createCanvasNode(args).then(afterWrite);
  }
  if (name === "figma_duplicate_node") {
    return duplicateCanvasNode(args).then(afterWrite);
  }
  if (name === "figma_delete_node") {
    return deleteCanvasNodes(args).then(afterWrite);
  }
  if (name === "figma_set_geometry") {
    return setNodeGeometry(args).then(afterWrite);
  }
  if (name === "figma_reparent_node") {
    return reparentCanvasNode(args).then(afterWrite);
  }
  if (name === "figma_set_opacity") {
    return setNodeOpacity(args).then(afterWrite);
  }
  if (name === "figma_set_corner_radius") {
    return setNodeCornerRadius(args).then(afterWrite);
  }
  if (name === "figma_copy_styles") {
    return copyStylesToNode(
      args.fromNodeId || args.sourceId,
      args.toNodeId || args.nodeId,
      {
        include: Array.isArray(args.include) ? args.include : null,
      }
    ).then(afterWrite);
  }
  if (name === "figma_set_stroke") {
    return setNodeStroke(
      args.nodeId,
      args.color || args,
      args.weight != null ? args.weight : args.strokeWeight
    ).then(afterWrite);
  }
  if (name === "figma_set_font") {
    return setNodeFont(args.nodeId, args).then(afterWrite);
  }
  if (name === "figma_apply_edits") {
    return applyCanvasEdits(args);
  }
  if (name === "figma_align_in_frame") {
    return alignChildrenInFrame(args).then(afterWrite);
  }
  if (name === "figma_set_layout_child") {
    return setLayoutChild(args).then(afterWrite);
  }
  if (name === "figma_resize_frame") {
    return resizeFrame(args).then(afterWrite);
  }
  if (name === "figma_batch_text_replace") {
    return batchTextReplace(args).then(afterWrite);
  }
  if (name === "figma_match_layout") {
    return matchLayout(args).then(afterWrite);
  }
  if (name === "figma_set_constraints") {
    return setNodeConstraints(args).then(afterWrite);
  }
  if (name === "figma_set_effects") {
    return setNodeEffects(args).then(afterWrite);
  }
  if (name === "figma_group_nodes") {
    return groupCanvasNodes(args).then(afterWrite);
  }
  if (name === "figma_ungroup_node") {
    return ungroupCanvasNode(args).then(afterWrite);
  }
  if (name === "figma_set_layout_grid") {
    return setLayoutGrid(args).then(afterWrite);
  }
  if (name === "figma_apply_recipe") {
    return applyLayoutRecipe(args).then(afterWrite);
  }
  if (name === "figma_batch_tools") {
    return batchInvokeTools(args).then(afterWrite);
  }
  if (name === "figma_apply_to_children") {
    return applyEditToChildren(args).then(afterWrite);
  }
  if (name === "figma_nudge_nodes") {
    return nudgeNodes(args).then(afterWrite);
  }
  if (name === "figma_swap_component") {
    return swapInstanceComponent(args).then(afterWrite);
  }
  if (name === "figma_bind_variable") {
    return bindVariableToNode(args).then(afterWrite);
  }
  return Promise.reject(new Error("Unknown tool: " + name));
}

var APPLY_EDIT_OPS = {
  set_name: "figma_set_name",
  set_text: "figma_set_text",
  set_fills: "figma_set_fills",
  set_auto_layout: "figma_set_auto_layout",
  set_geometry: "figma_set_geometry",
  set_opacity: "figma_set_opacity",
  set_corner_radius: "figma_set_corner_radius",
  set_stroke: "figma_set_stroke",
  set_font: "figma_set_font",
  copy_styles: "figma_copy_styles",
  reparent_node: "figma_reparent_node",
  set_layout_child: "figma_set_layout_child",
};

/** Batch property edits — one RPC / one selection refresh. Max 40. */
function applyCanvasEdits(args) {
  requireWrite();
  commitCanvasUndo();
  var edits = Array.isArray(args && args.edits) ? args.edits : [];
  if (!edits.length) {
    return Promise.reject(new Error("figma_apply_edits needs a non-empty edits array"));
  }
  if (edits.length > APPLY_EDITS_MAX) {
    return Promise.reject(
      new Error(
        "figma_apply_edits max " + APPLY_EDITS_MAX + " edits (got " + edits.length + ")"
      )
    );
  }
  var results = [];
  var i = 0;
  function next() {
    if (i >= edits.length) {
      pushSelection(undefined, { withTree: false, withPreview: false });
      var okCount = 0;
      for (var j = 0; j < results.length; j++) {
        if (results[j] && results[j].ok) okCount++;
      }
      var summary = {
        applied: okCount,
        total: edits.length,
        results: results,
      };
      var verifyId = resolveLayoutVerifyNodeId(edits);
      return attachLayoutVerifyByNodeId(verifyId, summary);
    }
    var edit = edits[i];
    var index = i;
    i += 1;
    if (!edit || typeof edit !== "object") {
      results.push({ index: index, ok: false, error: "invalid edit" });
      return next();
    }
    var op = String(edit.op || "");
    var toolName = APPLY_EDIT_OPS[op];
    if (!toolName) {
      results.push({
        index: index,
        ok: false,
        error: "unknown op: " + op,
      });
      return next();
    }
    var toolArgs = {};
    for (var key in edit) {
      if (
        Object.prototype.hasOwnProperty.call(edit, key) &&
        key !== "op"
      ) {
        toolArgs[key] = edit[key];
      }
    }
    return invokeTool(toolName, toolArgs, { quiet: true, skipUndo: true })
      .then(function (result) {
        results.push({ index: index, ok: true, op: op, result: result });
        return next();
      })
      .catch(function (err) {
        results.push({
          index: index,
          ok: false,
          op: op,
          error: err && err.message ? err.message : String(err),
        });
        return next();
      });
  }
  return next();
}

function replyTool(requestId, ok, result, error) {
  postToUi({
    type: "figmaToolResult",
    requestId: requestId,
    ok: !!ok,
    result: result,
    error: error ? String(error) : undefined,
  });
}

figma.ui.onmessage = function (msg) {
  if (!msg || typeof msg !== "object") return;
  var type = msg.type;
  if (type === "ready" || type === "figmaGetSelection") {
    var capOpts = { withTree: false, withPreview: false, withLayoutHealth: false };
    if (msg.forTurn === true) {
      capOpts.withTree = true;
      capOpts.withLayoutHealth = true;
      capOpts.withPreview =
        !!(msg.options && msg.options.withPreview === true);
    } else if (msg.options && typeof msg.options === "object") {
      capOpts.withTree = !!msg.options.withTree;
      capOpts.withPreview = !!msg.options.withPreview;
      capOpts.withLayoutHealth = !!msg.options.withLayoutHealth;
    }
    pushSelection(msg.requestId, capOpts);
    return;
  }
  if (type === "figmaFocusNode") {
    focusNode(msg.nodeId)
      .then(function () {
        pushSelection(undefined, { withTree: false, withPreview: false });
      })
      .catch(function (err) {
        figma.notify(
          "Focus failed: " + (err && err.message ? err.message : err),
          { error: true }
        );
      });
    return;
  }
  if (type === "figmaInvokeTool") {
    var requestId = msg.requestId;
    invokeTool(msg.name, msg.args)
      .then(function (result) {
        replyTool(requestId, true, result, null);
      })
      .catch(function (err) {
        replyTool(
          requestId,
          false,
          null,
          err && err.message ? err.message : String(err)
        );
      });
    return;
  }
  if (type === "figmaClientStorageGet") {
    figma.clientStorage.getAsync(msg.key).then(function (value) {
      postToUi({
        type: "figmaClientStorageValue",
        key: msg.key,
        value: value == null ? null : value,
        requestId: msg.requestId,
      });
    });
    return;
  }
  if (type === "figmaClientStorageSet") {
    var key = msg.key;
    var allowed =
      key === FIGMA_STORAGE_SETTINGS ||
      key === FIGMA_STORAGE_SESSION ||
      key === FIGMA_STORAGE_UI_STATE ||
      (typeof key === "string" && key.indexOf("harbor.figma.") === 0);
    if (!allowed) {
      figma.notify("Blocked storage key", { error: true });
      return;
    }
    figma.clientStorage.setAsync(key, msg.value).then(function () {
      postToUi({
        type: "figmaClientStorageSaved",
        key: key,
        requestId: msg.requestId,
      });
    });
    return;
  }
  if (type === "copyBrief" || type === "copyText") {
    postToUi({ type: "copied" });
    figma.notify(type === "copyBrief" ? "Brief copied" : "Copied");
    return;
  }
  if (type === "notify") {
    figma.notify(msg.message || "", { error: !!msg.error });
    return;
  }
  if (type === "resize") {
    figma.ui.resize(
      Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, msg.width | 0)),
      Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, msg.height | 0))
    );
  }
};

figma.on("selectionchange", function () {
  try {
    schedulePushSelection();
  } catch (_e) {
    /* keep plugin alive */
  }
});
figma.on("currentpagechange", function () {
  try {
    schedulePushSelection();
  } catch (_e) {
    /* keep plugin alive */
  }
});

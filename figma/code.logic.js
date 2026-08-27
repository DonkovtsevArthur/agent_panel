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
    width: 420,
    height: 640,
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
var MAX_DEPTH = 4;
var MAX_CHILDREN = 24;
var TEXT_CHARS_MAX = 500;

function postToUi(msg) {
  try {
    figma.ui.postMessage(msg);
  } catch (_e) {
    /* ui not ready */
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

function enrichNodeDetails(node, out, depth) {
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
  } catch (_e) {
    /* mixed / remote */
  }
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
    } catch (_e2) {
      /* font not loaded */
    }
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
  if (node.type === "INSTANCE") {
    try {
      out.componentId = node.componentId || undefined;
      if (node.mainComponent && node.mainComponent.name) {
        out.mainComponentName = node.mainComponent.name;
      }
    } catch (_e4) {
      /* remote mainComponent */
    }
  }
}

function serializeNode(node, depth) {
  var box = node.absoluteBoundingBox;
  var out = { id: node.id, name: node.name, type: node.type };
  if (box) {
    out.width = Math.round(box.width);
    out.height = Math.round(box.height);
  }
  enrichNodeDetails(node, out, depth);
  if (depth < MAX_DEPTH && node.children && node.children.length) {
    var kids = node.children;
    out.children = [];
    for (var i = 0; i < kids.length && i < MAX_CHILDREN; i++) {
      out.children.push(serializeNode(kids[i], depth + 1));
    }
    if (kids.length > MAX_CHILDREN) {
      out.children.push({
        id: node.id + "__more",
        name: "... +" + (kids.length - MAX_CHILDREN) + " more",
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

function captureSelection() {
  var selection = figma.currentPage.selection;
  var fileKey = figma.fileKey;
  var nodes = [];
  for (var i = 0; i < selection.length; i++) {
    nodes.push(serializeNode(selection[i], 0));
  }
  var primary = selection[0];
  var done = function (preview) {
    return {
      fileKey: fileKey || undefined,
      fileName: figma.root.name,
      pageName: figma.currentPage.name,
      nodes: nodes,
      previewPngDataUrl: preview,
      nodeUrl: primary ? nodeDeepLink(fileKey, primary.id) : undefined,
      canWrite: canWriteCanvas(),
    };
  };
  if (!primary) {
    return Promise.resolve(done(undefined));
  }
  return primary
    .exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } })
    .then(function (bytes) {
      return done("data:image/png;base64," + bytesToBase64(bytes));
    })
    .catch(function () {
      return done(undefined);
    });
}

function pushSelection(requestId) {
  return captureSelection()
    .then(function (selection) {
      postToUi({
        type: "figmaSelectionChanged",
        selection: selection,
        requestId: requestId,
      });
    })
    .catch(function (err) {
      figma.notify(
        "Selection sync failed: " + (err && err.message ? err.message : err),
        { error: true }
      );
    });
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

function inspectNode(nodeId) {
  return resolveNode(nodeId).then(function (node) {
    if (!("absoluteBoundingBox" in node) && node.type !== "TEXT") {
      return serializeNode(node, 0);
    }
    return serializeNode(node, 0);
  });
}

function requireWrite() {
  if (!canWriteCanvas()) {
    throw new Error(
      "Canvas writes are unavailable in Dev Mode - open the file in Design mode."
    );
  }
}

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

function setNodeName(nodeId, name) {
  requireWrite();
  return resolveNode(nodeId).then(function (node) {
    if (!("name" in node)) throw new Error("Node has no name");
    node.name = String(name || "");
    return { id: node.id, name: node.name };
  });
}

function setNodeText(nodeId, characters) {
  requireWrite();
  return resolveNode(nodeId).then(function (node) {
    if (node.type !== "TEXT") {
      throw new Error("figma_set_text requires a TEXT node");
    }
    var font =
      node.fontName !== figma.mixed
        ? node.fontName
        : { family: "Inter", style: "Regular" };
    return figma.loadFontAsync(font).then(function () {
      node.characters = String(characters != null ? characters : "");
      return {
        id: node.id,
        characters: node.characters.slice(0, TEXT_CHARS_MAX),
      };
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
    return {
      id: node.id,
      layoutMode: node.layoutMode,
      paddingTop: node.paddingTop,
      paddingRight: node.paddingRight,
      paddingBottom: node.paddingBottom,
      paddingLeft: node.paddingLeft,
      itemSpacing: node.itemSpacing,
    };
  });
}

function invokeTool(name, args) {
  args = args && typeof args === "object" ? args : {};
  if (name === "figma_get_selection") {
    return captureSelection().then(function (sel) {
      var slim = {
        fileName: sel.fileName,
        pageName: sel.pageName,
        nodeUrl: sel.nodeUrl,
        canWrite: sel.canWrite,
        nodes: sel.nodes,
      };
      return slim;
    });
  }
  if (name === "figma_inspect_node") {
    return inspectNode(args.nodeId);
  }
  if (name === "figma_focus_node") {
    return focusNode(args.nodeId);
  }
  if (name === "figma_set_name") {
    return setNodeName(args.nodeId, args.name).then(function (r) {
      pushSelection();
      return r;
    });
  }
  if (name === "figma_set_text") {
    return setNodeText(args.nodeId, args.characters).then(function (r) {
      pushSelection();
      return r;
    });
  }
  if (name === "figma_set_fills") {
    return setNodeFills(args.nodeId, args.color || args).then(function (r) {
      pushSelection();
      return r;
    });
  }
  if (name === "figma_set_auto_layout") {
    return setAutoLayout(args.nodeId, args).then(function (r) {
      pushSelection();
      return r;
    });
  }
  return Promise.reject(new Error("Unknown tool: " + name));
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
    pushSelection(msg.requestId);
    return;
  }
  if (type === "figmaFocusNode") {
    focusNode(msg.nodeId)
      .then(function () {
        pushSelection();
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
      Math.max(320, Math.min(900, msg.width | 0)),
      Math.max(400, Math.min(900, msg.height | 0))
    );
  }
};

figma.on("selectionchange", function () {
  pushSelection();
});
figma.on("currentpagechange", function () {
  pushSelection();
});

(function () {
  /**
   * Figma UI host bridge — only __harborHost (injected in ui.shell.html).
   * IDE webview host APIs and JetBrains polyfills are excluded from this bundle.
   */
  const host =
    typeof globalThis !== "undefined" && globalThis.__harborHost
      ? globalThis.__harborHost
      : {
          postMessage: function () {},
          getState: function () {
            return {};
          },
          setState: function () {},
        };

  function cryptoToken(len) {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        let out = "";
        for (let i = 0; i < bytes.length; i++) {
          out += bytes[i].toString(36).padStart(2, "0");
        }
        return out.slice(0, len);
      }
    } catch (_e) {
      /* fall through */
    }
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2)
    ).slice(0, len);
  }

  const STORAGE_SETTINGS = "harbor.figma.settings";
  const STORAGE_SESSION = "harbor.figma.session";
  const STORAGE_UI = "harbor.figma.uiState";

  const pendingStorage = new Map();
  let storageReq = 0;

  function storageGet(key) {
    return new Promise(function (resolve) {
      const requestId = "s" + ++storageReq;
      pendingStorage.set(requestId, resolve);
      host.postMessage({
        type: "figmaClientStorageGet",
        key: key,
        requestId: requestId,
      });
      setTimeout(function () {
        if (pendingStorage.has(requestId)) {
          pendingStorage.delete(requestId);
          resolve(null);
        }
      }, 3000);
    });
  }

  function storageSet(key, value) {
    return new Promise(function (resolve) {
      const requestId = "s" + ++storageReq;
      pendingStorage.set(requestId, function () {
        resolve();
      });
      host.postMessage({
        type: "figmaClientStorageSet",
        key: key,
        value: value,
        requestId: requestId,
      });
      setTimeout(function () {
        if (pendingStorage.has(requestId)) {
          pendingStorage.delete(requestId);
          resolve();
        }
      }, 3000);
    });
  }

  const pendingTools = new Map();
  let toolReq = 0;
  const pendingSelection = new Map();
  let selReq = 0;

  function invokeTool(name, args) {
    return new Promise(function (resolve, reject) {
      const requestId = "t" + ++toolReq;
      pendingTools.set(requestId, { resolve: resolve, reject: reject });
      host.postMessage({
        type: "figmaInvokeTool",
        requestId: requestId,
        name: name,
        args: args || {},
      });
      setTimeout(function () {
        if (pendingTools.has(requestId)) {
          pendingTools.delete(requestId);
          reject(new Error("Tool timed out: " + name));
        }
      }, 30000);
    });
  }

  function refreshSelection() {
    return new Promise(function (resolve) {
      const requestId = "sel" + ++selReq;
      pendingSelection.set(requestId, resolve);
      host.postMessage({
        type: "figmaGetSelection",
        requestId: requestId,
      });
      setTimeout(function () {
        if (pendingSelection.has(requestId)) {
          pendingSelection.delete(requestId);
          resolve(null);
        }
      }, 5000);
    });
  }

  function focusNode(nodeId) {
    host.postMessage({ type: "figmaFocusNode", nodeId: nodeId });
  }

  window.__harborFigma = {
    host: host,
    cryptoToken: cryptoToken,
    STORAGE_SETTINGS: STORAGE_SETTINGS,
    STORAGE_SESSION: STORAGE_SESSION,
    STORAGE_UI: STORAGE_UI,
    storageGet: storageGet,
    storageSet: storageSet,
    pendingStorage: pendingStorage,
    pendingTools: pendingTools,
    pendingSelection: pendingSelection,
    invokeTool: invokeTool,
    refreshSelection: refreshSelection,
    focusNode: focusNode,
  };
})();

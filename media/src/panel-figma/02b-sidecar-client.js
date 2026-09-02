(function () {
  /**
   * Harbor Figma Cline sidecar client (localhost HTTP + NDJSON turn stream).
   * Canvas tools still run in the plugin via __harborFigma.invokeTool.
   */
  var DEFAULT_SIDECAR_URL = "http://127.0.0.1:17891";

  function trimSlash(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function sidecarBaseUrl(settings) {
    var fromSettings =
      settings &&
      settings.sidecarUrl &&
      String(settings.sidecarUrl).trim();
    return trimSlash(fromSettings || DEFAULT_SIDECAR_URL);
  }

  async function checkSidecarHealth(settings) {
    var base = sidecarBaseUrl(settings);
    try {
      var ctrl = null;
      var signal = undefined;
      try {
        ctrl = new AbortController();
        signal = ctrl.signal;
        setTimeout(function () {
          try {
            ctrl.abort();
          } catch (_e) {}
        }, 2500);
      } catch (_e2) {}
      var res = await fetch(base + "/v1/health", {
        method: "GET",
        signal: signal,
      });
      if (!res.ok) {
        return { ok: false, base: base, error: "HTTP " + res.status };
      }
      var body = await res.json();
      return {
        ok: !!(body && body.ok),
        base: base,
        cline: !!(body && body.cline),
        body: body,
      };
    } catch (err) {
      return {
        ok: false,
        base: base,
        error: (err && err.message) || String(err),
      };
    }
  }

  /** Guess prompt-cache safety from provider base URL (LiteLLM / OpenRouter / Anthropic). */
  function guessPromptCacheFromBaseUrl(baseUrl) {
    var u = String(baseUrl || "").toLowerCase();
    if (!u) return false;
    if (/openai\.com|api\.openai/.test(u) && !/openrouter|litellm|anthropic/.test(u)) {
      return false;
    }
    return /litellm|openrouter|anthropic|claude/.test(u);
  }

  /**
   * Strip oversized / unused preview before HTTP turn.
   * PNG only when the model has vision — otherwise waste + TTFT.
   */
  function selectionForTurn(selection, supportsVision) {
    if (!selection || typeof selection !== "object") return selection;
    var preview = selection.previewPngDataUrl;
    var dropPreview =
      !supportsVision ||
      !preview ||
      String(preview).length > 350000;
    if (!dropPreview) return selection;
    if (!preview && supportsVision) return selection;
    var copy = {};
    for (var k in selection) {
      if (Object.prototype.hasOwnProperty.call(selection, k)) {
        copy[k] = selection[k];
      }
    }
    delete copy.previewPngDataUrl;
    return copy;
  }

  /**
   * Run a turn via the local Cline sidecar.
   * opts: { settings, provider, model, mode, userText, history, selection,
   *         chatId, resetSession, signal, invokeTool, onToolStep, onDelta,
   *         onTiming }
   */
  async function runFigmaSidecarTurn(opts) {
    var settings = opts.settings || {};
    var provider = opts.provider || {};
    var model = opts.model || {};
    var base = sidecarBaseUrl(settings);
    var health = await checkSidecarHealth(settings);
    if (!health.ok) {
      var offline = new Error(
        "Harbor Cline host is offline (" +
          base +
          "). One-time setup: npm run figma:host:install — then it runs in the background. " +
          "Or: npm run figma:host:ensure. " +
          (health.error ? "(" + health.error + ")" : "")
      );
      offline.code = "sidecar_offline";
      throw offline;
    }

    var turnId = null;
    var fullText = "";
    var aborted = false;
    var streamError = null;
    var pendingToolJobs = [];
    var lastTiming = null;

    var supportsVision = !!model.supportsVision;
    var promptCache =
      typeof provider.promptCache === "boolean"
        ? provider.promptCache
        : guessPromptCacheFromBaseUrl(provider.baseUrl);

    var abortSidecar = function () {
      if (!turnId) return;
      fetch(base + "/v1/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: turnId }),
      }).catch(function () {});
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        var ae = new Error("Aborted");
        ae.name = "AbortError";
        throw ae;
      }
      opts.signal.addEventListener(
        "abort",
        function () {
          aborted = true;
          abortSidecar();
        },
        { once: true }
      );
    }

    var res = await fetch(base + "/v1/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        apiKey: provider.apiKey || "",
        baseUrl: provider.baseUrl || "",
        agentMode: opts.mode || "ask",
        userText: opts.userText || "",
        history: opts.history || [],
        selection: selectionForTurn(opts.selection || null, supportsVision),
        chatId: opts.chatId || undefined,
        resetSession: !!opts.resetSession,
        supportsVision: supportsVision,
        promptCache: promptCache,
        contextWindow:
          typeof model.contextWindow === "number" && model.contextWindow > 0
            ? model.contextWindow
            : undefined,
        maxOutputTokens:
          typeof model.maxOutputTokens === "number" && model.maxOutputTokens > 0
            ? model.maxOutputTokens
            : undefined,
        rejectUnauthorized: settings.rejectUnauthorized !== false,
        language: settings.language || "en",
      }),
      signal: opts.signal,
    });

    turnId = res.headers.get("X-Harbor-Turn-Id") || null;
    if (!res.ok) {
      var errBody = await res.text().catch(function () {
        return "";
      });
      throw new Error(
        "Sidecar turn failed (" +
          res.status +
          "): " +
          (errBody || res.statusText)
      );
    }

    if (!res.body || !res.body.getReader) {
      throw new Error(
        "Streaming not supported in this Figma environment — update Figma Desktop."
      );
    }

    var postToolResult = function (requestId, result, toolError) {
      return fetch(base + "/v1/toolResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turnId: turnId,
          requestId: requestId,
          result: result,
          error: toolError || undefined,
        }),
      }).catch(function () {});
    };

    var handleEvent = async function (ev) {
      if (!ev || !ev.type) return;
      if (ev.type === "turnStarted" && ev.turnId) {
        turnId = ev.turnId;
        return;
      }
      if (ev.type === "assistantDelta" && ev.text) {
        fullText += ev.text;
        if (typeof opts.onDelta === "function") opts.onDelta(ev.text);
        return;
      }
      if (ev.type === "timing") {
        lastTiming = {
          ttftMs: typeof ev.ttftMs === "number" ? ev.ttftMs : lastTiming && lastTiming.ttftMs,
          durationMs:
            typeof ev.durationMs === "number"
              ? ev.durationMs
              : lastTiming && lastTiming.durationMs,
        };
        if (typeof opts.onTiming === "function") opts.onTiming(lastTiming);
        return;
      }
      if (ev.type === "status" && ev.text) {
        if (typeof opts.onStatus === "function") {
          opts.onStatus(String(ev.text));
        }
        return;
      }
      if (ev.type === "step" && typeof opts.onToolStep === "function") {
        var st = String(ev.status || "running").toLowerCase();
        if (st === "done" || st === "success") st = "ok";
        opts.onToolStep({
          stepId: ev.stepId,
          name: ev.name,
          label: ev.label,
          status: st,
          error: ev.error,
          durationMs: ev.durationMs,
        });
        return;
      }
      if (ev.type === "toolRequest") {
        // Fire-and-forget so parallel Cline tool calls are not serialized
        // by the NDJSON reader loop.
        var invoke =
          typeof opts.invokeTool === "function" ? opts.invokeTool : null;
        var requestId = ev.requestId;
        var job = Promise.resolve()
          .then(function () {
            if (!invoke) throw new Error("No canvas invokeTool");
            return invoke(ev.name, ev.args || {});
          })
          .then(function (result) {
            return postToolResult(requestId, result, null);
          })
          .catch(function (e) {
            return postToolResult(
              requestId,
              null,
              (e && e.message) || String(e)
            );
          });
        pendingToolJobs.push(job);
        return;
      }
      if (ev.type === "done") {
        if (typeof ev.text === "string" && ev.text) {
          fullText = ev.text;
        }
        if (
          typeof ev.ttftMs === "number" ||
          typeof ev.durationMs === "number"
        ) {
          lastTiming = {
            ttftMs:
              typeof ev.ttftMs === "number"
                ? ev.ttftMs
                : lastTiming && lastTiming.ttftMs,
            durationMs:
              typeof ev.durationMs === "number"
                ? ev.durationMs
                : lastTiming && lastTiming.durationMs,
          };
          if (typeof opts.onTiming === "function") opts.onTiming(lastTiming);
        }
        return;
      }
      if (ev.type === "error") {
        streamError = new Error(ev.message || "Sidecar error");
      }
    };

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].trim();
        if (!line) continue;
        var ev;
        try {
          ev = JSON.parse(line);
        } catch (_e) {
          continue;
        }
        await handleEvent(ev);
        if (streamError) throw streamError;
        if (aborted) {
          var ab = new Error("Aborted");
          ab.name = "AbortError";
          throw ab;
        }
      }
    }
    if (buffer.trim()) {
      try {
        await handleEvent(JSON.parse(buffer.trim()));
      } catch (_e2) {
        /* ignore trailing junk */
      }
    }
    if (pendingToolJobs.length) {
      await Promise.all(pendingToolJobs);
    }
    if (streamError) throw streamError;
    return fullText;
  }

  window.__harborFigmaSidecar = {
    DEFAULT_SIDECAR_URL: DEFAULT_SIDECAR_URL,
    sidecarBaseUrl: sidecarBaseUrl,
    checkSidecarHealth: checkSidecarHealth,
    runFigmaSidecarTurn: runFigmaSidecarTurn,
    discardChat: async function (settings, chatId) {
      var base = sidecarBaseUrl(settings);
      try {
        await fetch(base + "/v1/discardChat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: chatId || "" }),
        });
      } catch (_e) {
        /* ignore offline */
      }
    },
    syncTlsSettings: async function (settings) {
      var base = sidecarBaseUrl(settings);
      try {
        await fetch(base + "/v1/syncSettings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rejectUnauthorized: settings.rejectUnauthorized !== false,
          }),
        });
      } catch (_e) {
        /* sidecar offline — turn body still carries TLS flag */
      }
    },
    fetchTlsSettings: async function (settings) {
      var base = sidecarBaseUrl(settings);
      try {
        var ctrl = new AbortController();
        setTimeout(function () { try { ctrl.abort(); } catch (_e) {} }, 2500);
        var res = await fetch(base + "/v1/settings", {
          method: "GET",
          signal: ctrl.signal,
        });
        if (!res.ok) return null;
        var body = await res.json();
        return body && typeof body.rejectUnauthorized === "boolean"
          ? body
          : null;
      } catch (_e) {
        return null;
      }
    },
  };
})();

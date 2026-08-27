(function () {
  /** Slim OpenAI-compatible turn — Figma host only (no Cline / IDE tools). */

  var MAX_TOOL_ROUNDS = 8;

  function trimSlash(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function designSystemPrompt(mode) {
    var base =
      "You are Harbor Agents for Figma — a design assistant inside Figma. " +
      "You help designers critique, name, structure, and hand off UI. " +
      "Ground answers in the current selection JSON and screenshot when provided. " +
      "Use tools to inspect or focus nodes by real ids from the selection — never invent node ids. " +
      "Be concise. Do not invent layers that are not in the selection.";
    if (mode === "agent") {
      return (
        base +
        " Mode: Agent. You may edit the canvas via write tools " +
        "(rename, set text, solid fills, auto-layout padding/gap). " +
        "Do not create or delete nodes. Prefer small targeted edits. " +
        "If a write fails (e.g. Dev Mode), explain and continue with advice only."
      );
    }
    if (mode === "plan") {
      return (
        base +
        " Mode: Plan. Produce a clear implementation / design plan with Goal and numbered Steps. " +
        "You may inspect/focus nodes with read tools. Do not edit the canvas. " +
        "End with a short handoff brief a developer can paste into an IDE agent."
      );
    }
    return (
      base +
      " Mode: Ask. Answer the design question; do not invent a full build plan unless asked. " +
      "You may inspect/focus nodes with read tools. Do not edit the canvas."
    );
  }

  function buildSelectionContextText(selection) {
    if (!selection || !selection.nodes || selection.nodes.length === 0) {
      return "Current Figma selection: (none — ask the user to select a frame or node).";
    }
    var header = [
      selection.fileName ? "File: " + selection.fileName : null,
      selection.pageName ? "Page: " + selection.pageName : null,
      selection.nodeUrl ? "Link: " + selection.nodeUrl : null,
      selection.canWrite === false
        ? "Canvas writes: unavailable (Dev Mode)"
        : "Canvas writes: available in Agent mode",
    ]
      .filter(Boolean)
      .join("\n");
    return (
      header +
      "\nSelection JSON:\n" +
      JSON.stringify(selection.nodes, null, 2)
    );
  }

  function buildHandoffBrief(planText, selection) {
    var link = (selection && selection.nodeUrl) || "(no node link)";
    var name =
      (selection &&
        selection.nodes &&
        selection.nodes[0] &&
        selection.nodes[0].name) ||
      (selection && selection.fileName) ||
      "selection";
    return (
      "# Harbor handoff — " +
      name +
      "\n\nFigma: " +
      link +
      "\n\n" +
      String(planText || "").trim() +
      "\n"
    );
  }

  function modelIdForApi(modelId) {
    var id = String(modelId || "");
    if (id.indexOf("/") === -1) return id;
    var parts = id.split("/");
    return parts.slice(1).join("/") || id;
  }

  function readTools() {
    return [
      {
        type: "function",
        function: {
          name: "figma_get_selection",
          description:
            "Get the current Figma selection tree (structure, text, fills, auto-layout).",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_inspect_node",
          description: "Serialize one node by id (including children summary).",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string", description: "Figma node id" },
            },
            required: ["nodeId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_focus_node",
          description: "Select a node on the canvas and zoom the viewport to it.",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
            },
            required: ["nodeId"],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  function writeTools() {
    return [
      {
        type: "function",
        function: {
          name: "figma_set_name",
          description: "Rename an existing node.",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              name: { type: "string" },
            },
            required: ["nodeId", "name"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_text",
          description: "Set characters on a TEXT node (loads font first).",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              characters: { type: "string" },
            },
            required: ["nodeId", "characters"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_fills",
          description: "Set a single solid fill on a node (r/g/b/a in 0–1).",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              color: {
                type: "object",
                properties: {
                  r: { type: "number" },
                  g: { type: "number" },
                  b: { type: "number" },
                  a: { type: "number" },
                },
                required: ["r", "g", "b"],
              },
            },
            required: ["nodeId", "color"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_auto_layout",
          description:
            "Update auto-layout on a frame/component (layoutMode, padding, itemSpacing).",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              layoutMode: {
                type: "string",
                enum: ["NONE", "HORIZONTAL", "VERTICAL"],
              },
              padding: { type: "number" },
              paddingTop: { type: "number" },
              paddingRight: { type: "number" },
              paddingBottom: { type: "number" },
              paddingLeft: { type: "number" },
              itemSpacing: { type: "number" },
            },
            required: ["nodeId"],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  function toolsForMode(mode) {
    var tools = readTools();
    if (mode === "agent") {
      tools = tools.concat(writeTools());
    }
    return tools;
  }

  function toolLabel(name) {
    var map = {
      figma_get_selection: "Get selection",
      figma_inspect_node: "Inspect node",
      figma_focus_node: "Focus node",
      figma_set_name: "Rename",
      figma_set_text: "Set text",
      figma_set_fills: "Set fill",
      figma_set_auto_layout: "Auto-layout",
    };
    return map[name] || name;
  }

  function parseArgs(raw) {
    if (raw == null || raw === "") return {};
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(String(raw));
    } catch (_e) {
      return {};
    }
  }

  async function streamCompletion(opts) {
    var headers = { "Content-Type": "application/json" };
    if (opts.provider.apiKey) {
      headers.Authorization = "Bearer " + opts.provider.apiKey;
    }
    var body = {
      model: modelIdForApi(opts.model.id),
      messages: opts.messages,
      stream: true,
    };
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }

    var res = await fetch(trimSlash(opts.provider.baseUrl) + "/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      var errBody = await res.text().catch(function () {
        return "";
      });
      throw new Error(
        "Provider error " +
          res.status +
          ": " +
          (errBody.slice(0, 400) || res.statusText)
      );
    }

    var reader = res.body && res.body.getReader();
    if (!reader) throw new Error("No response body from provider");

    var decoder = new TextDecoder();
    var buffer = "";
    var fullText = "";
    var finishReason = null;
    /** @type {Record<number, { id: string, name: string, arguments: string }>} */
    var toolAcc = {};

    while (true) {
      var step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      var lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (!trimmed.startsWith("data:")) continue;
        var data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          var json = JSON.parse(data);
          var choice = json.choices && json.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          var delta = choice.delta || {};
          if (delta.content) {
            fullText += delta.content;
            if (opts.onDelta) opts.onDelta(delta.content);
          }
          var tcs = delta.tool_calls;
          if (tcs && tcs.length) {
            for (var t = 0; t < tcs.length; t++) {
              var tc = tcs[t];
              var idx = typeof tc.index === "number" ? tc.index : t;
              if (!toolAcc[idx]) {
                toolAcc[idx] = { id: "", name: "", arguments: "" };
              }
              if (tc.id) toolAcc[idx].id = tc.id;
              if (tc.function && tc.function.name) {
                toolAcc[idx].name = tc.function.name;
              }
              if (tc.function && tc.function.arguments) {
                toolAcc[idx].arguments += tc.function.arguments;
              }
            }
          }
        } catch (_e) {
          /* ignore */
        }
      }
    }

    var toolCalls = Object.keys(toolAcc)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (k) {
        return toolAcc[k];
      })
      .filter(function (tc) {
        return tc && tc.name;
      });

    return {
      text: fullText,
      finishReason: finishReason,
      toolCalls: toolCalls,
    };
  }

  async function runFigmaAgentTurn(opts) {
    var provider = opts.provider;
    var model = opts.model;
    var baseUrl = trimSlash(provider && provider.baseUrl);
    if (!baseUrl) {
      throw new Error(
        "Provider base URL is empty — open Settings and add a provider."
      );
    }
    if (!model || !model.id) {
      throw new Error("No model selected — open Settings and add a model.");
    }

    var mode =
      opts.mode === "plan"
        ? "plan"
        : opts.mode === "agent"
          ? "agent"
          : "ask";
    var system = designSystemPrompt(mode);
    var selectionText = buildSelectionContextText(opts.selection);
    var useVision =
      !!model.supportsVision &&
      opts.selection &&
      opts.selection.previewPngDataUrl;
    var tools = toolsForMode(mode);
    var invokeTool =
      typeof opts.invokeTool === "function" ? opts.invokeTool : null;
    var onToolStep =
      typeof opts.onToolStep === "function" ? opts.onToolStep : null;

    var messages = [{ role: "system", content: system }];
    (opts.history || []).forEach(function (m) {
      messages.push({ role: m.role, content: m.text });
    });

    if (useVision) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: selectionText + "\n\n" + opts.userText },
          {
            type: "image_url",
            image_url: { url: opts.selection.previewPngDataUrl },
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: selectionText + "\n\n" + opts.userText,
      });
    }

    var assistantText = "";
    for (var round = 0; round < MAX_TOOL_ROUNDS; round++) {
      var result = await streamCompletion({
        provider: provider,
        model: model,
        messages: messages,
        tools: tools,
        signal: opts.signal,
        onDelta: function (piece) {
          assistantText += piece;
          if (opts.onDelta) opts.onDelta(piece);
        },
      });

      if (!result.toolCalls || !result.toolCalls.length || !invokeTool) {
        return assistantText || result.text;
      }

      var assistantMsg = {
        role: "assistant",
        content: result.text || null,
        tool_calls: result.toolCalls.map(function (tc, i) {
          return {
            id: tc.id || "call_" + round + "_" + i,
            type: "function",
            function: {
              name: tc.name,
              arguments: tc.arguments || "{}",
            },
          };
        }),
      };
      messages.push(assistantMsg);

      for (var j = 0; j < result.toolCalls.length; j++) {
        var call = result.toolCalls[j];
        var callId = call.id || "call_" + round + "_" + j;
        var args = parseArgs(call.arguments);
        if (onToolStep) {
          onToolStep({
            name: call.name,
            label: toolLabel(call.name),
            status: "running",
            args: args,
          });
        }
        var toolResult;
        var toolError = null;
        try {
          toolResult = await invokeTool(call.name, args);
          if (onToolStep) {
            onToolStep({
              name: call.name,
              label: toolLabel(call.name),
              status: "ok",
              args: args,
            });
          }
        } catch (err) {
          toolError = (err && err.message) || String(err);
          toolResult = { error: toolError };
          if (onToolStep) {
            onToolStep({
              name: call.name,
              label: toolLabel(call.name),
              status: "error",
              error: toolError,
              args: args,
            });
          }
        }
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify(toolResult),
        });
      }
    }

    return assistantText || "(tool round limit reached)";
  }

  window.__harborFigmaTurn = {
    runFigmaAgentTurn: runFigmaAgentTurn,
    buildHandoffBrief: buildHandoffBrief,
    buildSelectionContextText: buildSelectionContextText,
    toolLabel: toolLabel,
  };
})();

(function () {
  /**
   * Legacy OpenAI tool schemas / helpers for Figma.
   * Live turns go through the Cline sidecar (`02b-sidecar-client.js`).
   * Keep schemas here as reference for canvas tools + Copy brief helpers.
   */

  var MAX_TOOL_ROUNDS = 24;

  function trimSlash(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function designSystemPrompt(mode) {
    var base =
      "You are Harbor Agents for Figma — a design assistant inside Figma. " +
      "You help designers critique, name, structure, and hand off UI. " +
      "Ground answers in the current selection JSON and screenshot when provided. " +
      "The selection JSON lists every selected root (id, name, type, size) — up to ~100. " +
      "When the user asks to list or name their selection, answer from that JSON; " +
      "do not call figma_list_frames on the whole page to rediscover it. " +
      "If you need a selection inventory via tools, use figma_list_frames with selectedOnly=true " +
      "or figma_get_selection. Never invent node ids. " +
      "Hidden layers (eye-off) are omitted from trees; do not invent or edit them. " +
      "Be concise. Do not invent layers that are not in the selection.";
    if (mode === "agent") {
      return (
        base +
        " Mode: Agent. SCOPE: change only what the user asked this turn — " +
        "do not also fix siblings/other screens for consistency unless asked. " +
        "If they say only one place / leave the rest alone, stop after that change. " +
        "Match existing mockup style — prefer duplicate, or create with styleFromId / figma_copy_styles. " +
        "Inspect nearby layers before inventing fills/fonts. " +
        "Full canvas writes: create, duplicate, delete, copy styles, font, stroke, fills, geometry, reparent, auto-layout, prototypes. " +
        "For clickable prototypes: first figma_list_frames (prefer topLevel screens), " +
        "then figma_set_prototype_flow with ALL links in one call. " +
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
    var count =
      typeof selection.selectedCount === "number"
        ? selection.selectedCount
        : selection.nodes.filter(function (n) {
            return n && n.id !== "__more_roots";
          }).length;
    var header = [
      selection.fileName ? "File: " + selection.fileName : null,
      selection.pageName ? "Page: " + selection.pageName : null,
      selection.nodeUrl ? "Link: " + selection.nodeUrl : null,
      "Selected roots: " + count,
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
      {
        type: "function",
        function: {
          name: "figma_list_frames",
          description:
            "List FRAME/COMPONENT nodes on the current page (id, name, depth), or the current selection when selectedOnly=true. " +
            "Prefer selectedOnly when the user asks about their multi-select. " +
            "For page-wide lists, prefer topLevel screens; check truncated/totalMatched if the page is large. " +
            "Use before building prototype flows to resolve real node ids by screen name.",
          parameters: {
            type: "object",
            properties: {
              maxDepth: {
                type: "number",
                description:
                  "Search depth from page children (1–4, default 2). Ignored when selectedOnly.",
              },
              selectedOnly: {
                type: "boolean",
                description:
                  "If true, list only the current canvas selection roots (all types), not the whole page.",
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_get_reactions",
          description:
            "Read prototype reactions on a node (triggers, navigate targets, transitions).",
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
          description:
            "Set characters on a TEXT node (or the first TEXT child of a frame). " +
            "Loads all fonts used in the layer before editing; falls back to Inter if missing. " +
            "Prefer search+replace for small edits (e.g. search \"5\", replace \"6\").",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              characters: { type: "string" },
              search: {
                type: "string",
                description: "Optional substring to replace (use with replace).",
              },
              replace: {
                type: "string",
                description: "Replacement for the first search match.",
              },
            },
            required: ["nodeId"],
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
      {
        type: "function",
        function: {
          name: "figma_set_prototype_link",
          description:
            "Add or replace a prototype link: trigger (default ON_CLICK) navigates to destinationId frame. " +
            "Use replaceAll:true to keep only this link on the source node.",
          parameters: {
            type: "object",
            properties: {
              nodeId: {
                type: "string",
                description: "Source node (frame or hotspot layer)",
              },
              destinationId: {
                type: "string",
                description: "Target frame node id",
              },
              trigger: {
                type: "string",
                enum: [
                  "ON_CLICK",
                  "ON_HOVER",
                  "ON_PRESS",
                  "ON_DRAG",
                  "MOUSE_ENTER",
                  "MOUSE_LEAVE",
                  "MOUSE_UP",
                  "MOUSE_DOWN",
                ],
              },
              transition: {
                type: "string",
                enum: [
                  "INSTANT",
                  "DISSOLVE",
                  "SMART_ANIMATE",
                  "MOVE_IN",
                  "MOVE_OUT",
                  "PUSH",
                  "SLIDE_IN",
                  "SLIDE_OUT",
                ],
                description: "INSTANT = no animation (default).",
              },
              duration: {
                type: "number",
                description: "Transition duration in seconds (default 0.3).",
              },
              direction: {
                type: "string",
                enum: ["LEFT", "RIGHT", "TOP", "BOTTOM"],
                description: "For MOVE_IN/SLIDE_IN/etc. (default LEFT).",
              },
              replace: {
                type: "boolean",
                description:
                  "Replace existing reactions with the same trigger (default true).",
              },
              replaceAll: {
                type: "boolean",
                description: "Replace every reaction on the node (default true).",
              },
            },
            required: ["nodeId", "destinationId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_prototype_flow",
          description:
            "Batch-create prototype links for a click-through flow. " +
            "PREFERRED for multi-screen flows — pass every screen-to-screen link in one call. " +
            "Each item: sourceId (or nodeId), destinationId; optional trigger/transition. " +
            "Continues on per-link errors; check failed count in the result.",
          parameters: {
            type: "object",
            properties: {
              links: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sourceId: { type: "string" },
                    nodeId: { type: "string" },
                    destinationId: { type: "string" },
                    trigger: { type: "string" },
                    transition: { type: "string" },
                    duration: { type: "number" },
                  },
                  required: ["destinationId"],
                  additionalProperties: false,
                },
              },
            },
            required: ["links"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_clear_reactions",
          description: "Remove all prototype reactions from a node.",
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
      {
        type: "function",
        function: {
          name: "figma_create_node",
          description:
            "Create FRAME/RECTANGLE/ELLIPSE/TEXT. Prefer styleFromId from a similar layer to match mockup style.",
          parameters: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["FRAME", "RECTANGLE", "ELLIPSE", "TEXT"],
              },
              name: { type: "string" },
              parentId: {
                type: "string",
                description: "Parent frame/page id (default: current page)",
              },
              styleFromId: {
                type: "string",
                description: "Copy styles from this existing node after create",
              },
              width: { type: "number" },
              height: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              characters: {
                type: "string",
                description: "Initial text for TEXT nodes (default \"Text\")",
              },
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
              layoutMode: {
                type: "string",
                enum: ["NONE", "HORIZONTAL", "VERTICAL"],
                description: "Auto-layout for FRAME only",
              },
              select: {
                type: "boolean",
                description: "Select and zoom to the new node (default true)",
              },
            },
            required: ["type"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_duplicate_node",
          description:
            "Clone an existing node (and its subtree). Default offset +40,+40 so the copy is visible. " +
            "Optional rename via name; optional parentId to reparent the clone.",
          parameters: {
            type: "object",
            properties: {
              nodeId: {
                type: "string",
                description: "Source node to clone",
              },
              name: {
                type: "string",
                description: "Optional new name for the clone",
              },
              offsetX: {
                type: "number",
                description: "X offset from source (default 40)",
              },
              offsetY: {
                type: "number",
                description: "Y offset from source (default 40)",
              },
              parentId: {
                type: "string",
                description: "Optional new parent for the clone",
              },
              select: {
                type: "boolean",
                description: "Select and zoom to the clone (default true)",
              },
            },
            required: ["nodeId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_delete_node",
          description:
            "Delete one or more nodes from the canvas (and their subtrees). " +
            "Pass nodeId and/or nodeIds (max 50). Cannot delete PAGE/DOCUMENT.",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              nodeIds: {
                type: "array",
                items: { type: "string" },
                description: "Batch delete (max 50)",
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_geometry",
          description:
            "Set position (x/y) and/or size (width/height) on an existing node.",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              select: {
                type: "boolean",
                description: "Also select/zoom (default false)",
              },
            },
            required: ["nodeId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_reparent_node",
          description:
            "Move a node under a new parent frame/page. Optional index among siblings; optional x/y after move.",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              parentId: { type: "string" },
              index: {
                type: "number",
                description: "Child index under the new parent (0 = first)",
              },
              x: { type: "number" },
              y: { type: "number" },
              select: { type: "boolean" },
            },
            required: ["nodeId", "parentId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_opacity",
          description: "Set node opacity (0–1).",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              opacity: { type: "number", description: "0–1" },
            },
            required: ["nodeId", "opacity"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_corner_radius",
          description:
            "Set corner radius (uniform via radius, or per-corner topLeft/topRight/bottomRight/bottomLeft).",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              radius: { type: "number" },
              topLeft: { type: "number" },
              topRight: { type: "number" },
              bottomRight: { type: "number" },
              bottomLeft: { type: "number" },
            },
            required: ["nodeId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_copy_styles",
          description:
            "Copy visual styles from one node to another. Prefer this to keep mockup style.",
          parameters: {
            type: "object",
            properties: {
              fromNodeId: { type: "string" },
              toNodeId: { type: "string" },
            },
            required: ["fromNodeId", "toNodeId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_stroke",
          description: "Set a solid stroke color and optional weight.",
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
              weight: { type: "number" },
            },
            required: ["nodeId", "color"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "figma_set_font",
          description: "Set TEXT font family/style and optional fontSize.",
          parameters: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              family: { type: "string" },
              style: { type: "string" },
              fontSize: { type: "number" },
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

  function toolLabel(name, args) {
    if (name === "figma_set_prototype_flow" && args && args.links) {
      var n = Array.isArray(args.links) ? args.links.length : 0;
      if (n > 0) return "Prototype flow (" + n + ")";
    }
    var map = {
      figma_get_selection: "Get selection",
      figma_inspect_node: "Inspect node",
      figma_focus_node: "Focus node",
      figma_list_frames: "List frames",
      figma_get_reactions: "Get reactions",
      figma_set_name: "Rename",
      figma_set_text: "Set text",
      figma_set_fills: "Set fill",
      figma_set_auto_layout: "Auto-layout",
      figma_set_prototype_link: "Prototype link",
      figma_set_prototype_flow: "Prototype flow",
      figma_clear_reactions: "Clear reactions",
      figma_create_node: "Create node",
      figma_duplicate_node: "Duplicate",
      figma_delete_node: "Delete",
      figma_set_geometry: "Set geometry",
      figma_reparent_node: "Reparent",
      figma_set_opacity: "Set opacity",
      figma_set_corner_radius: "Corner radius",
      figma_copy_styles: "Copy styles",
      figma_set_stroke: "Set stroke",
      figma_set_font: "Set font",
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

      var toolJobs = result.toolCalls.map(function (call, j) {
        var callId = call.id || "call_" + round + "_" + j;
        var args = parseArgs(call.arguments);
        return {
          callId: callId,
          name: call.name,
          args: args,
          promise: (async function () {
            if (onToolStep) {
              onToolStep({
                stepId: callId,
                name: call.name,
                label: toolLabel(call.name, args),
                status: "running",
                args: args,
              });
            }
            try {
              var toolResult = await invokeTool(call.name, args);
              if (onToolStep) {
                onToolStep({
                  stepId: callId,
                  name: call.name,
                  label: toolLabel(call.name, args),
                  status: "ok",
                  args: args,
                });
              }
              return { callId: callId, content: JSON.stringify(toolResult) };
            } catch (err) {
              var toolError = (err && err.message) || String(err);
              if (onToolStep) {
                onToolStep({
                  stepId: callId,
                  name: call.name,
                  label: toolLabel(call.name, args),
                  status: "error",
                  error: toolError,
                  args: args,
                });
              }
              return {
                callId: callId,
                content: JSON.stringify({ error: toolError }),
              };
            }
          })(),
        };
      });

      var toolOutcomes = await Promise.all(
        toolJobs.map(function (job) {
          return job.promise;
        })
      );
      for (var j = 0; j < toolOutcomes.length; j++) {
        messages.push({
          role: "tool",
          tool_call_id: toolOutcomes[j].callId,
          content: toolOutcomes[j].content,
        });
      }
    }

    return (
      assistantText ||
      "(tool round limit reached — ask the agent to continue the remaining prototype links)"
    );
  }

  window.__harborFigmaTurn = {
    runFigmaAgentTurn: runFigmaAgentTurn,
    buildHandoffBrief: buildHandoffBrief,
    buildSelectionContextText: buildSelectionContextText,
    toolLabel: toolLabel,
  };
})();

   */
  const TOOL_NAME_ALIASES = {
    read_file: "read_files",
    write_file: "editor",
    search_replace: "editor",
    search_text: "search_codebase",
    run_command: "run_commands",
    list_files: "list_files",
    fetch_url: "fetch_web_content",
  };

  function canonicalToolName(raw) {
    const n = String(raw || "").trim();
    return TOOL_NAME_ALIASES[n] || n;
  }

  /** Shorten a filesystem path for one-line display (keep basename + parent). */
  function shortPath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const parts = s.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) return s;
    return `…/${parts.slice(-2).join("/")}`;
  }

  /** Basename only — option C timeline rows. */
  function fileBase(p) {
    const s = String(p || "").trim().replace(/[\\/]+$/, "");
    if (!s) {
      return "";
    }
    const parts = s.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || s;
  }

  function argsPreviewFromToolText(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^[a-zA-Z0-9_]+\(([\s\S]*)\)$/);
    return match ? match[1] : "";
  }

  function toolStepMatchKey(name, argsPreview, label) {
    const tool = canonicalToolName(name || parseToolName(label) || "");
    let path = "";
    const rawArgs = String(argsPreview || "").trim();
    if (rawArgs) {
      // Scalar field: "path":"...", "command":"...", etc.
      const pathMatch = rawArgs.match(
        /"(?:relativePath|path|file_path|command|query|queries)"\s*:\s*"((?:\\.|[^"\\])*)"/
      );
      if (pathMatch) {
        path = pathMatch[1].replace(/\\"/g, '"');
      }
      // Array field: "commands":["..."], "paths":["..."], "files":["..."], etc.
      // Take the first element so two cards for the same tool_use collapse into
      // one (onStep + onTool both produce the same non-empty key → merge).
      if (!path) {
        const arrayMatch = rawArgs.match(
          /"(?:commands|paths|file_paths|files|queries)"\s*:\s*\["((?:\\.|[^"\\])*)"/
        );
        if (arrayMatch) {
          path = arrayMatch[1].replace(/\\"/g, '"');
        }
      }
    }
    if (!path && label) {
      path = String(label)
        .replace(/^(чтение|запись|правка|список|поиск|команда|read|write|edit|list|search|run)\s+/i, "")
        .replace(/\s*·\s*\d+\s+\S+$/u, "")
        .replace(/\s*\(\+\d+\)\s*$/, "")
        .trim();
    }
    return `${tool}::${fileBase(path)}`;
  }

  function formatToolHumanLabel(name, argsPreview, metrics, status, resultPreview) {
    const toolName = canonicalToolName(name);
    let args = {};
    const rawArgs = String(argsPreview || "").trim();
    if (rawArgs) {
      try {
        args = JSON.parse(rawArgs);
      } catch {
        // Truncated JSON from step preview — try to pull common fields by regex.
        const pathMatch = rawArgs.match(
          /"(?:relativePath|path|file_path)"\s*:\s*"((?:\\.|[^"\\])*)"/
        );
        if (pathMatch) {
          args.path = pathMatch[1].replace(/\\"/g, '"');
          args.relativePath = args.path;
        }
        const cmdMatch = rawArgs.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (cmdMatch) {
          args.command = cmdMatch[1].replace(/\\"/g, '"');
        }
        const queryMatch = rawArgs.match(
          /"(?:query|queries)"\s*:\s*"((?:\\.|[^"\\])*)"/
        );
        if (queryMatch) {
          args.query = queryMatch[1].replace(/\\"/g, '"');
        }
        const taskMatch = rawArgs.match(/"task"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (taskMatch) {
          args.task = taskMatch[1].replace(/\\"/g, '"');
        }
        const urlMatch = rawArgs.match(/"url"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (urlMatch) {
          args.url = urlMatch[1].replace(/\\"/g, '"');
        }
      }
    }

    // Helpers to read common Cline input shapes.
    const firstString = (v) =>
      typeof v === "string" ? v.trim() : Array.isArray(v) && v.length ? String(v[0] || "").trim() : "";
    const filesFromArgs = () => {
      const out = [];
      const push = (v) => {
        if (typeof v === "string" && v.trim()) out.push(v.trim());
        else if (v && typeof v === "object") {
          const p = v.path || v.relativePath || v.file_path;
          if (typeof p === "string" && p.trim()) out.push(p.trim());
        }
      };
      for (const key of ["files", "paths", "file_paths"]) {
        const v = args[key];
        if (Array.isArray(v)) v.forEach(push);
        else if (v) push(v);
      }
      if (!out.length && (args.path || args.relativePath)) {
        out.push(String(args.path || args.relativePath).trim());
      }
      return out;
    };
    const m = metrics || {};

    switch (toolName) {
      case "read_files": {
        const paths = (m.files && m.files.length ? m.files : filesFromArgs());
        const first = paths[0] || "";
        const extra = paths.length > 1 ? ` +${paths.length - 1}` : "";
        return t("toolHumanRead", fileBase(first)) + extra;
      }
      case "editor": {
        const filePath =
          (m.files && m.files[0]) || args.path || args.relativePath || "";
        const isCreate = m.created === true || (!args.old_text && !args.insert_line && !!args.new_text);
        return isCreate
          ? t("toolHumanCreate", fileBase(filePath))
          : t("toolHumanReplace", fileBase(filePath));
      }
      case "list_files":
        return t("toolHumanList", fileBase(args.path || args.relativePath) || ".");
      case "search_codebase": {
        const query = firstString(args.queries || args.query);
        const countSuffix =
          status === "done" && typeof m.matches === "number" && m.matches > 0
            ? ` (${m.matches})`
            : "";
        return t("toolHumanSearch", query) + countSuffix;
      }
      case "run_commands": {
        const cmd = firstString(args.commands || args.command);
        const exitSuffix =
          status === "error" && typeof m.exitCode === "number"
            ? ` · ${t("toolMetricExit")} ${m.exitCode}`
            : "";
        return t("toolHumanRun", cmd) + exitSuffix;
      }
      case "fetch_web_content":
      case "fetch_url":
        return t("toolHumanFetch", String(args.url || firstString(args.requests && args.requests[0] && args.requests[0].url) || "").trim());
      case "screenshot_url":
        return t("toolHumanScreenshot", String(args.url || "").trim());
      case "open_external":
        return t("toolHumanOpen", String(args.url || "").trim());
      case "browser_navigate":
        return t("toolHumanBrowserNav", String(args.url || "").trim());
      case "browser_snapshot":
        return t("toolHumanBrowserSnap");
      case "browser_click":
        return t("toolHumanBrowserClick");
      case "browser_type":
        return t("toolHumanBrowserType");
      case "browser_close":
        return t("toolHumanBrowserClose");
      case "get_diagnostics":
        return t("toolHumanDiagnostics");
      case "ask_question":
        return t("toolHumanAskQuestion", String(args.question || "").trim());
      case "submit_and_exit":
        return t("toolHumanSubmitExit");
      case "skills":
        return t("toolHumanSkill", String(args.skill || "").trim());
      case "apply_patch":
        return t("toolHumanApplyPatch");
      case "spawn_agent": {
        const task = String(args.task || args.prompt || "").trim();
        const short = task.length > 80 ? `${task.slice(0, 77)}…` : task;
        const base = t("toolHumanSpawn", short);
        if (status === "error") {
          const err = String(resultPreview || "")
            .replace(/^Субагент ошибка:\s*/i, "")
            .replace(/^Sub-agent error:\s*/i, "")
            .trim();
          if (err) {
            const errShort = err.length > 100 ? `${err.slice(0, 97)}…` : err;
            return `${base} · ${t("toolSpawnError", errShort)}`;
          }
          return `${base} · ${t("toolSpawnError", "")}`;
        }
        return base;
      }
      case "vision_attached_screenshot":
        return t("toolHumanVisionAttached");
      case "vision_page_url":
        return t("toolHumanVisionPageUrl");
      case "screenshot_plan_explore":
        return t("toolHumanScreenshotExplore");
      default: {
        if (toolName.startsWith("mcp__")) {
          const short = toolName.replace(/^mcp__[^_]+__/, "") || toolName;
          return t("toolHumanMcp", short);
        }
        if (toolName.startsWith("subagent_")) {
          return t("toolHumanSpawn", toolName.replace(/^subagent_/, ""));
        }
        return t("toolHumanTool", toolName);
      }
    }
  }

  function formatToolLine(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^([a-zA-Z0-9_]+)\(([\s\S]*)\)$/);
    if (!match) {
      return raw;
    }
    return formatToolHumanLabel(match[1], match[2]);
  }

  function parseToolName(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^([a-zA-Z0-9_]+)\(/);
    if (match) {
      return match[1];
    }
    const line = String(text || "");
    const prefix = line.split("·")[0].trim().toLowerCase();
    if (
      prefix === "read" ||
      prefix === t("toolKindRead").toLowerCase()
    ) {
      return "read_file";
    }
    if (
      prefix === "write" ||
      prefix === t("toolKindWrite").toLowerCase()
    ) {
      return "write_file";
    }
    if (
      prefix === "replace" ||
      prefix === t("toolKindReplace").toLowerCase()
    ) {
      return "search_replace";
    }
    if (
      prefix === "list" ||
      prefix === t("toolKindList").toLowerCase()
    ) {
      return "list_files";
    }
    if (
      prefix === "search" ||
      prefix === t("toolKindSearch").toLowerCase()
    ) {
      return "search_text";
    }
    if (
      prefix === "run" ||
      prefix === t("toolKindRun").toLowerCase()
    ) {
      return "run_command";
    }
    if (
      prefix === "fetch" ||
      prefix === t("toolKindFetch").toLowerCase()
    ) {
      return "fetch_url";
    }
    if (
      prefix === "open" ||
      prefix === t("toolKindOpen").toLowerCase()
    ) {
      return "open_external";
    }
    if (prefix === "mcp" || prefix === t("toolKindMcp").toLowerCase()) {
      return "mcp__tool";
    }
    return "";
  }

  function toolKind(name) {
    const n = canonicalToolName(name);
    if (n === "read_files") {
      return "read";
    }
    if (n === "editor" || n === "apply_patch") {
      return "replace";
    }
    if (n === "list_files") {
      return "list";
    }
    if (n === "search_codebase") {
      return "search";
    }
    if (n === "run_commands") {
      return "run";
    }
    if (n === "fetch_web_content" || n === "fetch_url") {
      return "fetch";
    }
    if (n === "open_external") {
      return "open";
    }
    if (
      n === "vision" ||
      n === "inspect_images" ||
      n === "vision_attached_screenshot" ||
      n === "vision_page_url" ||
      n === "vision_figma_screenshot" ||
      n === "vision_page_screenshot"
    ) {
      return "vision";
    }
    if (n === "screenshot_plan_explore" || n === "delegate_task") {
      return "explore";
    }
    if (n === "spawn_agent" || n.startsWith("subagent_")) {
      return "explore";
    }
    if (n === "ask_question") {
      return "open";
    }
    if (n.startsWith("mcp__")) {
      return "mcp";
    }
    return n ? "tool" : "";
  }

  function toolKindLabel(kind) {
    switch (kind) {
      case "read":
        return t("toolKindRead");
      case "list":
        return t("toolKindList");
      case "write":
        return t("toolKindWrite");
      case "replace":
        return t("toolKindReplace");
      case "run":
        return t("toolKindRun");
      case "fetch":
        return t("toolKindFetch");
      case "open":
        return t("toolKindOpen");
      case "mcp":
        return t("toolKindMcp");
      case "vision":
        return t("toolKindVision");
      case "explore":
        return t("toolKindExplore");
      case "search":
        return t("toolKindSearch");
      default:
        return t("toolKindTool");
    }
  }

  function toolWorkingLabel(kind) {
    switch (kind) {
      case "read":
        return t("toolReading");
      case "list":
        return t("toolListing");
      case "write":
      case "replace":
        return t("toolWriting");
      case "run":
        return t("toolRunning");
      case "fetch":
        return t("toolFetching");
      case "open":
        return t("toolOpening");
      case "mcp":
        return t("toolMcp");
      case "vision":
        return t("toolVision");
      case "explore":
        return t("toolExploring");
      case "search":
        return t("toolSearching");
      default:
        return t("toolWorking");
    }
  }

  function toolTypeLabels(group) {
    const counts = new Map();
    for (const el of group.querySelectorAll(".msg.tool")) {
      if (el.classList.contains("agent-step")) {
        const stepKind = el.dataset.stepKind || "";
        if (stepKind && stepKind !== "tool") {
          continue;
        }
      }
      const name = el.dataset.toolName || parseToolName(el.dataset.raw || "");
      const kind = toolKind(name) || "tool";
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    const order = [
      "vision",
      "read",
      "search",
      "list",
      "write",
      "replace",
      "run",
      "fetch",
      "open",
      "mcp",
      "explore",
    ];
    const parts = [];
    for (const kind of order) {
      const n = counts.get(kind);
      if (!n) {
        continue;
      }
      if (kind === "read") {
        parts.push(t("toolFiles", n));
        continue;
      }
      parts.push(t("toolTypeCount", toolKindLabel(kind), n));
    }
    for (const [kind, n] of counts) {
      if (!order.includes(kind) && n) {
        parts.push(t("toolTypeCount", toolKindLabel(kind), n));
      }
    }
    return parts;
  }

  function toolTypesSummary(group) {
    return toolTypeLabels(group).join(" · ");
  }

  /** Count timeline steps: tools + thinking + compaction/retry (not text deltas). */
  function countAgentSteps(group) {
    if (!group) {
      return 0;
    }
    let n = 0;
    for (const el of group.querySelectorAll(".msg.tool")) {
      if (el.classList.contains("agent-step")) {
        const kind = el.dataset.stepKind || "";
        if (kind === "text") {
          continue;
        }
        n += 1;
        continue;
      }
      n += 1;
    }
    return n;
  }

  function stepsCountLabel(n) {
    if (n <= 0) {
      return "";
    }
    if (n === 1) {
      return t("stepsOne");
    }
    return t("stepsMany")(n);
  }

  function timelineLooksLikeTransportFailure(group) {
    if (!group) {
      return false;
    }
    const body = group.querySelector(".tool-group-body");
    const steps = agentStepsInBody(body);
    if (!steps.length) {
      return false;
    }
    return steps.some((el) => {
      if (el.dataset.stepKind !== "retry") {
        return false;
      }
      const label = String(
        el.querySelector(".agent-step-label")?.textContent ||
          el.dataset.raw ||
          ""
      );
      return /API\s*5\d\d\b|Internal Server Error|ECONNRESET|fetch failed/i.test(
        label
      );
    });
  }

  function markFailedToolGroups() {
    for (const group of messagesEl.querySelectorAll(
      ".tool-group.agent-timeline"
    )) {
      if (!timelineLooksLikeTransportFailure(group)) {
        continue;
      }
      const summary = group.querySelector(".tool-group-summary");
      if (summary) {
        summary.textContent = t("runFailedSummary");
      }
      group.dataset.failed = "1";
    }
  }

  /**
   * End a failed run in the live UI: seal «Работаю…», show error bubble, clear busy.
   * Idempotent — safe if host also sent append/idle.
   */
  function finishRunWithError(text, detail) {
    const msg = String(text || "").trim();
    const full = String(detail || "").trim();
    sealToolGroups();
    markFailedToolGroups();
    if (msg) {
      const last = uiMessagesCache[uiMessagesCache.length - 1];
      const same =
        last &&
        last.role === "error" &&
        String(last.text || "") === msg &&
        String(last.detail || "") === full;
      if (!same) {
        uiMessagesCache.push({
          role: "error",
          text: msg,
          ...(full ? { detail: full } : {}),
        });
        appendMessage(
          "error",
          msg,
          uiMessagesCache.length - 1,
          -1,
          undefined,
          true,
          undefined,
          undefined,
          full || undefined
        );
      }
    }
    setAgentStatus("", true);
    setIdleAndDrain();
    scrollToBottom();
  }

  function sealToolGroups() {
    for (const group of messagesEl.querySelectorAll(
      ".tool-group:not([data-sealed])"
    )) {
      if (countAgentSteps(group) === 0) {
        group.remove();
        continue;
      }
      dedupeThinkingSteps(group);
      dropPlaceholderThinkingSteps(group);
      if (countAgentSteps(group) === 0) {
        group.remove();
        continue;
      }
      group.dataset.sealed = "1";
      dropRawToolRows(group);
      // Collapse the whole work timeline into a single header («N шагов»).
      group.classList.add("is-collapsed");
      const toggle = group.querySelector(".tool-group-toggle");
      if (toggle) {
        toggle.hidden = false;
        toggle.setAttribute("aria-expanded", "false");
      }
      if (timelineLooksLikeTransportFailure(group)) {
        const summary = group.querySelector(".tool-group-summary");
        if (summary) {
          summary.textContent = t("runFailedSummary");
        }
        group.dataset.failed = "1";
      } else {
        updateToolGroupSummary(group);
      }
      // Auto-collapse long Thinking blocks once the turn advances to tools/text.
      collapseLongThinkingSteps(group);
    }
    // Legacy separate reasoning blocks: drop if timeline already has thinking,
    // or if the legacy block itself never received real reasoning content.
    for (const group of messagesEl.querySelectorAll(
      ".reasoning-group:not([data-sealed])"
    )) {
      const turn = group.closest(".chat-turn") || messagesEl;
      const timeline = turn.querySelector(
        ".tool-group.agent-timeline .agent-step[data-step-kind='thinking']"
      );
      if (timeline) {
        group.remove();
        continue;
      }
      const legacyRaw = String(group.dataset.raw || "").trim();
      if (!legacyRaw || isThinkingPlaceholder(legacyRaw)) {
        group.remove();
        continue;
      }
      group.dataset.sealed = "1";
      updateReasoningGroupSummary(group);
    }
    // Merge leftover duplicate timelines / identical Thinking in the same turn.
    collapseTurnThinkingDuplicates();
  }

  function normalizeThinkingKey(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function thinkingStepsIn(scope) {
    if (!scope) {
      return [];
    }
    return [...scope.querySelectorAll(".agent-step[data-step-kind='thinking']")];
  }

  function agentStepsInBody(body) {
    if (!body) {
      return [];
    }
    return [...body.children].filter(
      (el) => el.classList && el.classList.contains("agent-step")
    );
  }

  /** Drop identical Thinking cards across the whole turn (keep first). */
  function collapseTurnThinkingDuplicates() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
    const seen = new Set();
    for (const el of thinkingStepsIn(turn)) {
      const key = normalizeThinkingKey(el.dataset.raw);
      if (!key || isThinkingPlaceholder(key)) {
        continue;
      }
      if (seen.has(key)) {
        el.remove();
      } else {
        seen.add(key);
      }
    }
    // Also merge leftover empty / duplicate timeline groups.
    dedupeTurnTimelines();
  }

  function dedupeThinkingSteps(group) {
    if (!group) {
      return;
    }
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return;
    }
    const seenThinking = new Set();
    for (const el of agentStepsInBody(body)) {
      if (el.dataset.stepKind !== "thinking") {
        continue;
      }
      const key = normalizeThinkingKey(el.dataset.raw);
      if (!key || isThinkingPlaceholder(key)) {
        continue;
      }
      if (seenThinking.has(key)) {
        el.remove();
      } else {
        seenThinking.add(key);
      }
    }
  }

  /**
   * Drop Thinking steps that never received real reasoning content (still on
   * the «Thinking…» / «Continuing…» placeholder). At seal time the turn is
   * complete — if real reasoning had been streamed, it would have replaced the
   * placeholder during streaming. A placeholder at seal means no reasoning was
   * produced, so we remove it when the turn has other real content (assistant
   * text in .msg-wrap-assistant, tool/compaction/retry steps, or non-placeholder
   * thinking). Text answer lives outside the tool-group (.msg-wrap-assistant),
   * so we check the parent .chat-turn too. Fixes the empty Thinking card shown
   * for models that don't stream reasoning_content (e.g. Qwen3-Coder-Next).
   */
  function dropPlaceholderThinkingSteps(group) {
    if (!group) {
      return;
    }
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return;
    }
    const steps = agentStepsInBody(body);
    const thinkingSteps = steps.filter(
      (el) => el.dataset.stepKind === "thinking"
    );
    if (!thinkingSteps.length) {
      return;
    }
    // Non-placeholder thinking or non-thinking steps (tools/compaction/retry)
    // inside the timeline count as real content.
    const hasRealInGroup =
      thinkingSteps.some((el) => !isThinkingPlaceholder(el.dataset.raw)) ||
      steps.some((el) => el.dataset.stepKind !== "thinking");
    // Assistant text answer lives in .msg-wrap-assistant (outside the tool-group),
    // so check the parent .chat-turn. Covers both committed and streaming text.
    const turn = group.closest(".chat-turn") || messagesEl;
    const hasAssistantText = Boolean(
      [...turn.querySelectorAll(".msg-wrap-assistant .msg")].some(
        (el) => String(el.dataset.raw || "").trim()
      )
    );
    if (!hasRealInGroup && !hasAssistantText) {
      return;
    }
    for (const el of thinkingSteps) {
      if (isThinkingPlaceholder(el.dataset.raw)) {
        el.remove();
      }
    }
  }

  /**
   * Clean placeholder-only Thinking cards from ALREADY-SEALED groups in the
   * current turn. sealToolGroups() runs inside appendMessage BEFORE the
   * assistant text element is appended to the DOM, so dropPlaceholderThinkingSteps
   * can't see the text at seal time. This second pass runs after the text is in
   * the DOM and removes placeholders that should have been dropped at seal.
   */
  function cleanSealedThinkingPlaceholders() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    if (!turn) {
      return;
    }
    const hasAssistantText = Boolean(
      [...turn.querySelectorAll(".msg-wrap-assistant .msg")].some(
        (el) => String(el.dataset.raw || "").trim()
      )
    );
    if (!hasAssistantText) {
      return;
    }
    for (const group of turn.querySelectorAll(
      ".tool-group.agent-timeline[data-sealed='1']"
    )) {
      const body = group.querySelector(".tool-group-body");
      if (!body) {
        continue;
      }
      const thinkingSteps = [
        ...body.querySelectorAll(
          ".agent-step[data-step-kind='thinking']"
        ),
      ];
      if (!thinkingSteps.length) {
        continue;
      }
      const hasRealInGroup =
        thinkingSteps.some((el) => !isThinkingPlaceholder(el.dataset.raw)) ||
        Boolean(
          body.querySelector(
            ".agent-step:not([data-step-kind='thinking'])"
          )
        );
      // Remove placeholder thinking steps regardless of whether the group
      // has other real content (tools, non-placeholder thinking). The
      // placeholder means no reasoning was streamed for that round — it
      // should not stay visible next to tool calls or the final answer.
      void hasRealInGroup;
      for (const el of thinkingSteps) {
        if (isThinkingPlaceholder(el.dataset.raw)) {
          el.remove();
        }
      }
      if (countAgentSteps(group) === 0) {
        group.remove();
      }
    }
  }

  function findTurnThinkingByText(text) {
    const key = normalizeThinkingKey(text);
    if (!key || isThinkingPlaceholder(key)) {
      return null;
    }
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
    for (const el of thinkingStepsIn(turn)) {
      if (normalizeThinkingKey(el.dataset.raw) === key) {
        return el;
      }
    }
    return null;
  }

  function findLatestTurnThinking() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
    const all = thinkingStepsIn(turn);
    return all.length ? all[all.length - 1] : null;
  }

  /** True if a committed (non-queued) tool appears after `el` in the turn. */
  function hasCommittedToolAfter(el) {
    if (!el) {
      return false;
    }
    const turn = el.closest(".chat-turn") || messagesEl;
    const steps = [...turn.querySelectorAll(".agent-step")];
    const ix = steps.indexOf(el);
    if (ix < 0) {
      return false;
    }
    for (let i = ix + 1; i < steps.length; i += 1) {
      if (
        steps[i].dataset.stepKind === "tool" &&
        steps[i].dataset.status &&
        steps[i].dataset.status !== "queued"
      ) {
        return true;
      }
    }
    return false;
  }

  function dedupeTurnTimelines() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    if (!turn) {
      return;
    }
    const groups = [...turn.querySelectorAll(".tool-group.agent-timeline")];
    if (groups.length < 2) {
      return;
    }
    const primary = groups[0];
    const primaryBody = primary.querySelector(".tool-group-body");
    if (!primaryBody) {
      return;
    }
    const known = new Set(
      [...primaryBody.querySelectorAll(".agent-step[data-step-kind='thinking']")].map(
        (el) => normalizeThinkingKey(el.dataset.raw)
      )
    );
    for (let i = 1; i < groups.length; i += 1) {
      const body = groups[i].querySelector(".tool-group-body");
      if (!body) {
        groups[i].remove();
        continue;
      }
      for (const el of agentStepsInBody(body)) {
        if (el.dataset.stepKind === "thinking") {
          const key = normalizeThinkingKey(el.dataset.raw);
          if (key && known.has(key)) {
            el.remove();
            continue;
          }
          if (key) {
            known.add(key);
          }
        }
        primaryBody.appendChild(el);
      }
      groups[i].remove();
    }
    dedupeThinkingSteps(primary);
  }

  function updateReasoningGroupSummary(group) {
    if (!group) {
      return;
    }
    const summary = group.querySelector(".reasoning-group-summary");
    const raw = String(group.dataset.raw || "").trim();
    if (summary) {
      summary.textContent = raw ? t("thinkingLabel") : t("thinkingWorking");
    }
    group.title = "";
    const toggle = group.querySelector(".reasoning-group-toggle");
    if (toggle) {
      toggle.title = group.classList.contains("is-collapsed")
        ? t("showThinking")
        : t("hideThinking");
    }
  }

  function createReasoningGroup() {
    const group = document.createElement("div");
    group.className = "reasoning-group is-collapsed";
    group.innerHTML =
      `<button type="button" class="reasoning-group-toggle" aria-expanded="false">` +
      `<span class="material-symbols-outlined reasoning-group-chevron" aria-hidden="true">expand_more</span>` +
      `<span class="material-symbols-outlined reasoning-group-icon" aria-hidden="true">psychology</span>` +
      `<span class="reasoning-group-summary">${escapeHtml(t("thinkingWorking"))}</span>` +
      `</button>` +
      `<div class="reasoning-group-body"><div class="reasoning-text"></div></div>`;
    return group;
  }

  function getActiveReasoningGroup() {
    return null;
  }

  function ensureActiveReasoningGroup() {
    return null;
  }

  function isThinkingPlaceholder(text) {
    const raw = String(text || "").trim();
    return (
      !raw ||
      raw === "Thinking…" ||
      raw === "Thinking..." ||
      raw === "Planning…" ||
      raw === "Planning..." ||
      raw === "Reviewing…" ||
      raw === "Reviewing..." ||
      raw === "Reason…" ||
      raw === "Reason..." ||
      raw === "Thoughts…" ||
      raw === "Thoughts..." ||
      raw === "Разум…" ||
      raw === "Разум..." ||
      raw === "Мысли…" ||
      raw === "Мысли..." ||
      raw === "Думаю…" ||
      raw === "Думаю..." ||
      raw === "Планирую…" ||
      raw === "Планирую..." ||
      raw === "Изучаю…" ||
      raw === "Изучаю..." ||
      raw === "Continuing…" ||
      raw === "Continuing..."
    );
  }

  /**
   * Reasoning goes into the unified timeline (Zed-like), not a separate card.
   */
  function upsertReasoning(text, options = {}) {
    const raw = String(text || "").trim();
    if (!raw) {
      return null;
    }
    return upsertAgentStep({
      stepId: options.stepId || "thinking-live",
      kind: "thinking",
      text: raw,
    });
  }

  function clearStoppedRunArtifacts() {
    if (streamingEl) {
      const wrap = streamingEl.closest(".msg-wrap-assistant");
      (wrap || streamingEl).remove();
      streamingEl = null;
    }
    streamingRenderScheduled = false;

    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    if (turn) {
      for (const group of turn.querySelectorAll(".tool-group")) {
        group.remove();
      }
      for (const group of turn.querySelectorAll(".reasoning-group")) {
        group.remove();
      }
    } else {
      // Fallback для старой/восстановленной разметки: незапечатанная группа
      // всегда относится к текущему незавершённому запуску.
      for (const group of messagesEl.querySelectorAll(
        ".tool-group:not([data-sealed])"
      )) {
        group.remove();
      }
      for (const group of messagesEl.querySelectorAll(
        ".reasoning-group:not([data-sealed])"
      )) {
        group.remove();
      }
    }

    while (
      uiMessagesCache.length &&
      uiMessagesCache[uiMessagesCache.length - 1]?.role === "tool"
    ) {
      uiMessagesCache.pop();
    }
  }

  function toolGroupHasContent(group) {
    const body = group?.querySelector(".tool-group-body");
    if (!body) {
      return false;
    }
    for (const el of agentStepsInBody(body)) {
      const kind = el.dataset.stepKind || "";
      if (kind === "text") {
        continue;
      }
      if (kind === "thinking") {
        if (!isThinkingPlaceholder(el.dataset.raw)) {
          return true;
        }
        continue;
      }
      return true;
    }
    return Boolean(body.querySelector(".msg.tool:not(.agent-step)"));
  }

  function updateToolGroupSummary(group) {
    if (!group) {
      return;
    }
    const hasSteps = toolGroupHasContent(group);
    group.classList.toggle("has-steps", hasSteps);
    const toggle = group.querySelector(".tool-group-toggle");
    const chevron = group.querySelector(".tool-group-chevron");
    if (toggle) {
      toggle.hidden = false;
      toggle.disabled = !hasSteps;
      toggle.setAttribute(
        "aria-expanded",
        hasSteps && !group.classList.contains("is-collapsed")
          ? "true"
          : "false"
      );
    }
    if (chevron) {
      chevron.hidden = !hasSteps;
    }
    const summary = group.querySelector(".tool-group-summary");
    if (summary) {
      if (group.dataset.failed === "1") {
        summary.textContent = t("runFailedSummary");
      } else if (group.dataset.sealed === "1") {
        summary.textContent = t("runDone");
      } else {
        summary.textContent = t("runWorking");
      }
    }
    if (toggle) {
      toggle.title = !hasSteps
        ? ""
        : group.classList.contains("is-collapsed")
          ? t("showSteps")
          : t("hideSteps");
    }
  }

  function createToolGroup() {
    const group = document.createElement("div");
    group.className = "tool-group agent-timeline is-collapsed";
    group.innerHTML =
      `<button type="button" class="tool-group-toggle" aria-expanded="false" disabled>` +
      `<span class="tool-group-summary">${escapeHtml(t("runWorking"))}</span>` +
      `<span class="material-symbols-outlined tool-group-chevron" aria-hidden="true" hidden>expand_more</span>` +
      `</button>` +
      `<div class="tool-group-body agent-timeline-body"></div>`;
    return group;
  }

  function getActiveToolGroup() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    const scope = turn || messagesEl;
    // Keep one open timeline for the turn even if assistant stream
    // was inserted after it (otherwise we spawn a second «Работаю…»).
    const open = scope.querySelectorAll(".tool-group:not([data-sealed])");
    if (open.length > 0) {
      return open[open.length - 1];
    }
    return null;
  }

  /** Latest thinking step after the last committed tool in this timeline body. */
  function findOpenThinkingStep(body) {
    if (!body) {
      return null;
    }
    const steps = agentStepsInBody(body);
    let lastToolIx = -1;
    for (let i = 0; i < steps.length; i += 1) {
      // Early stream "queued" tools must not open a new Thinking phase —
      // the model often abandons them and only answers in text.
      if (
        steps[i].dataset.stepKind === "tool" &&
        steps[i].dataset.status &&
        steps[i].dataset.status !== "queued"
      ) {
        lastToolIx = i;
      }
    }
    for (let i = steps.length - 1; i > lastToolIx; i -= 1) {
      if (steps[i].dataset.stepKind === "thinking") {
        return steps[i];
      }
    }
    return null;
  }

  function ensureActiveToolGroup() {
    const existing = getActiveToolGroup();
    if (existing) {
      return existing;
    }
    // Always start collapsed; user can expand via the toggle. Summary still
    // updates with the current step while the run is live.
    const group = createToolGroup();
    ensureChatTurn().appendChild(group);
    keepStatusAtEnd();
    return group;
  }

  function agentStepStatusIcon(status, kind) {
    if (kind === "thinking") {
      return "psychology";
    }
    if (kind === "compaction") {
      return "compress";
    }
    if (kind === "checkpoint") {
      return "restore";
    }
    if (kind === "retry") {
      return "replay";
    }
    if (kind === "tool" || !kind) {
      const nameHint = "";
      void nameHint;
    }
    if (status === "done") {
      return "check";
    }
    if (status === "error") {
      return "error";
    }
    if (status === "running") {
      return "progress_activity";
    }
    if (status === "queued") {
      return "schedule";
    }
    return "info";
  }

  function toolStepIcon(name, status) {
    if (status === "error") {
      return "error";
    }
    // Type icon stays after done — option C rows, not checkmarks.
    const toolName = canonicalToolName(name);
    switch (toolName) {
      case "read_files":
        return "draft";
      case "list_files":
        return "folder_open";
      case "editor":
      case "apply_patch":
        return "edit";
      case "run_commands":
        return "terminal";
      case "search_codebase":
        return "search";
      case "fetch_web_content":
      case "fetch_url":
      case "open_external":
      case "screenshot_url":
        return "link";
      case "browser_navigate":
      case "browser_snapshot":
      case "browser_click":
      case "browser_type":
      case "browser_close":
        return "web";
      case "get_diagnostics":
        return "bug_report";
      case "ask_question":
        return "help";
      case "submit_and_exit":
        return "check_circle";
      case "skills":
        return "bolt";
      case "spawn_agent":
        return "account_tree";
      default:
        if (toolName.startsWith("mcp__")) {
          return "extension";
        }
        if (toolName.startsWith("subagent_")) {
          return "account_tree";
        }
        return status === "queued" ? "schedule" : "build";
    }
  }

  function upsertAgentStep(step) {
    if (!step || !step.stepId) {
      return null;
    }
    if (step.kind === "text") {
      return null;
    }

    // Thinking: resolve target node BEFORE opening a new timeline group.
    if (step.kind === "thinking") {
      const incoming = String(step.text || "").trim();
      const incomingKey = normalizeThinkingKey(incoming);

      // Same text already on screen → update that card, never clone.
      const sameText = findTurnThinkingByText(incoming);
      if (sameText) {
        sameText.dataset.stepId = step.stepId;
        renderThinkingStep(sameText, incoming);
        collapseTurnThinkingDuplicates();
        keepStatusAtEnd();
        scrollToBottom();
        return sameText;
      }

      // Reuse latest Thinking when still in the same phase (no committed tool after it).
      const latest = findLatestTurnThinking();
      if (latest && !hasCommittedToolAfter(latest)) {
        latest.dataset.stepId = step.stepId;
        renderThinkingStep(latest, incoming);
        collapseTurnThinkingDuplicates();
        keepStatusAtEnd();
        scrollToBottom();
        return latest;
      }
    }

    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return null;
    }

    let el = body.querySelector(
      `.agent-step[data-step-id="${String(step.stepId).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
    );

    if (!el && step.kind === "tool") {
      const key = toolStepMatchKey(step.name, step.argsPreview, "");
      const match = findMatchingToolStep(body, key);
      if (match && String(match.dataset.stepId || "").startsWith("tool-text-")) {
        el = match;
        el.dataset.stepId = step.stepId;
      }
    }

    if (step.kind === "thinking") {
      const openThinking = findOpenThinkingStep(body);
      if (openThinking) {
        el = openThinking;
        el.dataset.stepId = step.stepId;
      } else if (!el) {
        el = document.createElement("div");
        el.className = "msg tool agent-step";
        el.dataset.stepId = step.stepId;
        body.appendChild(el);
      }
    } else if (!el) {
      el = document.createElement("div");
      el.className = "msg tool agent-step";
      el.dataset.stepId = step.stepId;
      body.appendChild(el);
    }
    el.dataset.stepKind = step.kind || "tool";
    if (step.status) {
      el.dataset.status = step.status;
    }
    if (step.name) {
      el.dataset.toolName = step.name;
    }
    if (step.kind === "tool") {
      el.dataset.toolMatchKey = toolStepMatchKey(
        step.name,
        step.argsPreview,
        ""
      );
    }

    if (step.kind === "thinking") {
      renderThinkingStep(el, String(step.text || "").trim());
      collapseTurnThinkingDuplicates();
    } else if (step.kind === "tool") {
      el.classList.remove("agent-step-thinking");
      if (step.resultPreview) {
        el.dataset.resultPreview = String(step.resultPreview);
      }
      const icon = toolStepIcon(step.name, step.status);
      el.innerHTML =
        `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">${icon}</span>` +
        `<span class="agent-step-label"></span>`;
      const labelEl = el.querySelector(".agent-step-label");
      if (labelEl) {
        const toolName = String(step.name || "");
        const isSpawn =
          toolName === "spawn_agent" || toolName.startsWith("subagent_");
        if (isSpawn && step.status === "error") {
          let task = "";
          try {
            const args = JSON.parse(String(step.argsPreview || "{}"));
            task = String(args.task || args.prompt || "").trim();
          } catch {
            const m = String(step.argsPreview || "").match(
              /"task"\s*:\s*"((?:\\.|[^"\\])*)"/
            );
            if (m) {
              task = m[1].replace(/\\"/g, '"');
            }
          }
          const short = task.length > 80 ? `${task.slice(0, 77)}…` : task;
          const title = t("toolHumanSpawn", short);
          let err = String(step.resultPreview || el.dataset.resultPreview || "")
            .replace(/^Субагент ошибка:\s*/i, "")
            .replace(/^Sub-agent error:\s*/i, "")
            .trim();
          if (err.length > 100) {
            err = `${err.slice(0, 97)}…`;
          }
          labelEl.textContent = "";
          const titleSpan = document.createElement("span");
          titleSpan.className = "agent-step-title";
          titleSpan.textContent = title;
          labelEl.appendChild(titleSpan);
          const errSpan = document.createElement("span");
          errSpan.className = "agent-step-error";
          errSpan.textContent = ` · ${t("toolSpawnError", err)}`;
          labelEl.appendChild(errSpan);
        } else {
          labelEl.textContent = formatToolHumanLabel(
            step.name,
            step.argsPreview,
            step.metrics,
            step.status,
            step.resultPreview || el.dataset.resultPreview || ""
          );
        }
      }
    } else {
      el.classList.remove("agent-step-thinking");
      const icon = agentStepStatusIcon(step.status, step.kind);
      const label =
        step.kind === "compaction"
          ? step.text || "Context compacted"
          : step.kind === "checkpoint"
            ? step.text || "Workspace checkpoint"
            : step.kind === "retry"
            ? step.text ||
              `Retry ${step.attempt || "?"}/${step.maxAttempts || "?"}`
            : step.text || step.kind || "";
      el.innerHTML =
        `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">${icon}</span>` +
        `<span class="agent-step-label"></span>`;
      const labelEl = el.querySelector(".agent-step-label");
      if (labelEl) {
        labelEl.textContent = label;
      }
    }

    if (step.kind === "checkpoint") {
      el.classList.add("agent-step-checkpoint");
      el.style.cursor = "pointer";
      el.title = t("checkpointRestore");
      el.onclick = () => {
        if (!window.confirm(t("checkpointRestore"))) {
          return;
        }
        host.postMessage({
          type: "restoreCheckpoint",
          chatId: activeChatId || "",
          checkpointRunCount: Number(step.checkpointRunCount) || undefined,
        });
      };
    }

    updateToolGroupSummary(group);
    dropRawToolRows(group);
    keepStatusAtEnd();
    scrollToBottom();
    return el;
  }

  function renderThinkingStep(el, incoming) {
    if (!el) {
      return;
    }
    const prev = String(el.dataset.raw || "").trim();
    let full =
      isThinkingPlaceholder(incoming) && prev && !isThinkingPlaceholder(prev)
        ? prev
        : incoming;
    if (
      !isThinkingPlaceholder(incoming) &&
      !isThinkingPlaceholder(prev) &&
      incoming.length < prev.length &&
      prev.startsWith(incoming)
    ) {
      full = prev;
    } else if (
      !isThinkingPlaceholder(incoming) &&
      !isThinkingPlaceholder(prev) &&
      prev.length < incoming.length &&
      incoming.startsWith(prev)
    ) {
      full = incoming;
    } else if (
      !isThinkingPlaceholder(incoming) &&
      !isThinkingPlaceholder(prev) &&
      incoming === prev
    ) {
      full = prev;
    }
    el.dataset.stepKind = "thinking";
    el.dataset.raw = full;
    el.classList.add("agent-step-thinking");
    const userOpened = el.dataset.thinkingOpen === "1";
    el.innerHTML =
      `<div class="agent-step-head">` +
      `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">psychology</span>` +
      `<span class="agent-step-label">${escapeHtml(t("thinkingLabel"))}</span>` +
      `<button type="button" class="agent-step-thinking-toggle" hidden>` +
      `<span class="agent-step-thinking-toggle-label"></span>` +
      `</button>` +
      `</div>` +
      `<div class="agent-step-thinking-text"></div>`;
    const textEl = el.querySelector(".agent-step-thinking-text");
    if (textEl) {
      textEl.textContent = isThinkingPlaceholder(full) ? "" : full;
    }
    if (userOpened) {
      el.dataset.thinkingOpen = "1";
    }
    updateThinkingCollapse(el, full);
  }

  /** Thoughts stay a plain row; full text only after «Показать мысли». */
  function updateThinkingCollapse(el, text) {
    const toggle = el.querySelector(".agent-step-thinking-toggle");
    const toggleLabel = el.querySelector(
      ".agent-step-thinking-toggle-label"
    );
    if (!toggle || !toggleLabel) {
      return;
    }
    const raw = String(text || "").trim();
    const isPlaceholder = !raw || isThinkingPlaceholder(raw);
    if (isPlaceholder) {
      el.classList.add("is-thinking-collapsed");
      toggle.hidden = true;
      return;
    }
    const open = el.dataset.thinkingOpen === "1";
    el.classList.toggle("is-thinking-collapsed", !open);
    toggle.hidden = false;
    toggleLabel.textContent = open ? t("hideThinking") : t("showThinking");
    toggle.setAttribute("aria-expanded", String(open));
  }

  /** Collapse thinking rows when the turn seals (unless the user opened one). */
  function collapseLongThinkingSteps(scope) {
    const root = scope || messagesEl;
    for (const el of root.querySelectorAll(
      ".agent-step[data-step-kind='thinking']"
    )) {
      if (el.dataset.thinkingOpen === "1") {
        continue;
      }
      const raw = String(el.dataset.raw || "").trim();
      if (raw && !isThinkingPlaceholder(raw)) {
        el.classList.add("is-thinking-collapsed");
        updateThinkingCollapse(el, raw);
      }
    }
  }

  function findMatchingToolStep(body, key) {
    if (!body || !key || key.endsWith("::")) {
      return null;
    }
    for (const el of body.querySelectorAll(
      ".agent-step[data-step-kind='tool']"
    )) {
      if (el.dataset.toolMatchKey === key) {
        return el;
      }
    }
    return null;
  }

  function dropRawToolRows(group) {
    const body = group?.querySelector(".tool-group-body");
    if (!body) {
      return;
    }
    for (const el of [...body.querySelectorAll(".msg.tool:not(.agent-step)")]) {
      el.remove();
    }
  }

  function appendToolToGroup(text, index, step) {
    if (step && step.stepId) {
      const el = upsertAgentStep(step);
      if (el && typeof index === "number") {
        el.dataset.index = String(index);
      }
      dropRawToolRows(el?.closest(".tool-group"));
      return el;
    }
    const toolName = parseToolName(text);
    const argsPreview = argsPreviewFromToolText(text);
    const key = toolStepMatchKey(toolName, argsPreview, formatToolLine(text));
    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    const existing = findMatchingToolStep(body, key);
    if (existing) {
      if (typeof index === "number") {
        existing.dataset.index = String(index);
      }
      dropRawToolRows(group);
      return existing;
    }
    const el = upsertAgentStep({
      stepId: `tool-text-${index ?? Date.now()}`,
      kind: "tool",
      name: toolName,
      argsPreview,
      status: "done",
    });
    if (el && typeof index === "number") {
      el.dataset.index = String(index);
    }
    dropRawToolRows(group);
    return el;
  }


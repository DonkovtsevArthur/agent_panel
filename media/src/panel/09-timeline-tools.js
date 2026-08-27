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
      // Scalar field: "path":"...", "command":"...", "url":"...", etc.
      // url/task/skill/question cover fetch/open/skills/ask/spawn cards whose
      // args carry no path — with an empty key their "⚙ name(args)" text twin
      // renders as a duplicate card instead of merging into the step.
      let pathMatch = rawArgs.match(
        /"(?:relativePath|path|file_path|command|query|queries|url|task|skill|question)"\s*:\s*"((?:\\.|[^"\\])*)"/
      );
      // Truncated preview: opening quote present, closing quote cut off.
      if (!pathMatch) {
        pathMatch = rawArgs.match(
          /"(?:relativePath|path|file_path|command|query|queries|url|task|skill|question)"\s*:\s*"((?:\\.|[^"\\])*)/
        );
      }
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
      // fetch_web_content ships urls as "requests":[{"url":"..."}].
      if (!path) {
        const requestMatch = rawArgs.match(
          /"requests"\s*:\s*\[\s*\{\s*"url"\s*:\s*"((?:\\.|[^"\\])*)/
        );
        if (requestMatch) {
          path = requestMatch[1].replace(/\\"/g, '"');
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

  /** Format a single command entry — string or {command, args?} object. */
  function formatCmdEntry(entry) {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      if (typeof entry.command === "string") {
        const a = Array.isArray(entry.args) ? entry.args.map(String) : [];
        return a.length > 0 ? `${entry.command} ${a.join(" ")}` : entry.command;
      }
    }
    return String(entry);
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
        let pathMatch = rawArgs.match(
          /"(?:relativePath|path|file_path)"\s*:\s*"((?:\\.|[^"\\])*)"/
        );
        if (!pathMatch) {
          pathMatch = rawArgs.match(
            /"(?:relativePath|path|file_path)"\s*:\s*"((?:\\.|[^"\\])*)/
          );
        }
        if (pathMatch) {
          args.path = pathMatch[1].replace(/\\"/g, '"');
          args.relativePath = args.path;
        }
        const cmdMatch = rawArgs.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (cmdMatch) {
          args.command = cmdMatch[1].replace(/\\"/g, '"');
        } else {
          // Truncated mid-string: opening quote present but closing quote cut off.
          const cmdPartial = rawArgs.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)/);
          if (cmdPartial) {
            args.command = cmdPartial[1].replace(/\\"/g, '"');
          }
        }
        // Also try "commands" array for run_commands with truncated JSON.
        if (!cmdMatch) {
          const cmdsMatch = rawArgs.match(
            /"commands"\s*:\s*\[((?:[^\]]{0,200}))/
          );
          if (cmdsMatch) {
            const inner = cmdsMatch[1];
            const items = [];
            const re = /"((?:\\.|[^"\\])*)"/g;
            let m;
            while ((m = re.exec(inner)) !== null) {
              items.push(m[1].replace(/\\"/g, '"'));
            }
            // If no complete quoted string matched (truncated mid-string),
            // try to grab the first quoted prefix.
            if (!items.length) {
              const partial = inner.match(/"((?:\\.|[^"\\])*)/);
              if (partial) {
                items.push(partial[1].replace(/\\"/g, '"'));
              }
            }
            if (items.length) {
              args.commands = items;
            }
          }
        }
        const queryMatch = rawArgs.match(
          /"(?:query|queries)"\s*:\s*"((?:\\.|[^"\\])*)"/
        );
        if (queryMatch) {
          args.query = queryMatch[1].replace(/\\"/g, '"');
        }
        // No trailing quote requirement: task is often truncated mid-string.
        const taskMatch = rawArgs.match(/"task"\s*:\s*"((?:\\.|[^"\\])*)/);
        if (taskMatch) {
          args.task = taskMatch[1].replace(/\\"/g, '"');
        }
        // Legacy previews truncated inside systemPrompt before task appeared.
        const systemPromptMatch = rawArgs.match(
          /"systemPrompt"\s*:\s*"((?:\\.|[^"\\])*)/
        );
        if (systemPromptMatch) {
          args.systemPrompt = systemPromptMatch[1].replace(/\\"/g, '"');
        }
        const urlMatch = rawArgs.match(/"url"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (urlMatch) {
          args.url = urlMatch[1].replace(/\\"/g, '"');
        }
        // Truncated read_files JSON often still has start_line/end_line as bare numbers.
        const startLineMatch = rawArgs.match(/"start_line"\s*:\s*(\d+)/);
        if (startLineMatch && args.start_line == null) {
          args.start_line = Number(startLineMatch[1]);
        }
        const endLineMatch = rawArgs.match(/"end_line"\s*:\s*(\d+)/);
        if (endLineMatch && args.end_line == null) {
          args.end_line = Number(endLineMatch[1]);
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
    const asPositiveLine = (v) => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const formatLineRange = (startLine, endLine) => {
      const sl = asPositiveLine(startLine);
      if (!sl) return "";
      const el = asPositiveLine(endLine);
      return el ? ` (${sl}–${el})` : ` (${sl}+)`;
    };

    switch (toolName) {
      case "read_files": {
        const paths = (m.files && m.files.length ? m.files : filesFromArgs());
        const names = paths
          .map((p) => fileBase(String(p || "")))
          .filter(Boolean);
        if (!names.length) {
          return t("toolHumanRead", "");
        }
        // Правило батчинга поощряет multi-file чтения — показываем каждый файл
        // батча; после трёх имён остаток сворачиваем в +N, чтобы карточка
        // оставалась компактной.
        const shown = names.slice(0, 3).join(", ");
        const extra = names.length > 3 ? ` +${names.length - 3}` : "";
        // Range only when a single file is shown — otherwise `(12–40)` after a
        // multi-name list looks like it applies to every file.
        let lineRange = "";
        if (names.length === 1) {
          const firstFile = Array.isArray(args.files) && args.files[0];
          lineRange = formatLineRange(
            firstFile?.start_line ?? args.start_line,
            firstFile?.end_line ?? args.end_line
          );
        }
        return t("toolHumanRead", shown) + extra + lineRange;
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
        let cmd = "";
        if (Array.isArray(args.commands) && args.commands.length) {
          cmd = args.commands.map(formatCmdEntry).join(" && ");
        } else if (typeof args.command === "string") {
          cmd = args.command;
        } else if (typeof args.cmd === "string") {
          cmd = args.cmd;
        } else if (typeof args === "string") {
          cmd = args;
        }
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
        const task = String(
          args.task || args.prompt || args.systemPrompt || ""
        ).trim();
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
    return t("stepsMany", n);
  }

  /** Steps users perceive as actions: tool calls only (no thinking/text). */
  function timelineToolStepsCount(group) {
    if (!group) {
      return 0;
    }
    return group.querySelectorAll(
      ".agent-step[data-step-kind='tool']"
    ).length;
  }

  /** Unique edited-file count across write/edit steps (for the sealed summary). */
  function timelineEditedFilesCount(group) {
    if (!group) {
      return 0;
    }
    const files = new Set();
    for (const el of group.querySelectorAll(
      ".agent-step[data-step-kind='tool'][data-tool-name]"
    )) {
      const name = canonicalToolName(el.dataset.toolName || "");
      if (name !== "editor" && name !== "apply_patch") {
        continue;
      }
      let metrics = null;
      try {
        metrics = JSON.parse(el.dataset.metrics || "null");
      } catch {
        metrics = null;
      }
      for (const f of Array.isArray(metrics?.files) ? metrics.files : []) {
        const p = String(f || "").trim();
        if (p) {
          files.add(p);
        }
      }
    }
    return files.size;
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

  /**
   * Run finished (idle/stopped/error): flip timelines that were sealed
   * mid-run from «выполняю» to «выполнено» and stop their pulsing dot.
   */
  function finalizeRunningTimelines() {
    for (const group of messagesEl.querySelectorAll(
      ".tool-group.agent-timeline.is-run-working"
    )) {
      group.classList.remove("is-run-working");
      updateToolGroupSummary(group);
    }
  }

  function sealToolGroups() {    for (const group of messagesEl.querySelectorAll(
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
      // Промежуточный текст модели запечатывает ленту посреди хода —
      // ход ещё идёт, поэтому сводка остаётся «выполняю» до конца всего
      // запуска (idle/stopped снимает флаг через finalizeRunningTimelines).
      // Флаг — только лентам ТЕКУЩЕГО хода и только ЖИВОМУ потоку:
      // при перерисовке истории (редактирование/повторная отправка,
      // messagesReplaced, init/showChat) restoringChatScroll = true и
      // запечатанные ленты прошлых ходов остаются «выполнено».
      if (busy && !restoringChatScroll) {
        const turn = group.closest(".chat-turn");
        if (!currentChatTurnEl || !turn || turn === currentChatTurnEl) {
          group.classList.add("is-run-working");
        }
      }
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

    // Stop button: the host may not succeed in re-posting the todo card with
    // an "error" status (postToRunChat is gated on isChatRunCurrent, which is
    // false after abort). As a client-side fallback, force any still-running
    // todo plan cards into a cancelled state so the header spinner and the
    // in_progress item spinners stop immediately.
    cancelRunningTodoPlans();
  }

  /**
   * Force every visible todo plan card that's still "running" into a
   * cancelled/error state. Recovers the step list from the rendered item DOM
   * (data attributes) so it doesn't depend on the host re-posting anything.
   */
  function cancelRunningTodoPlans() {
    const cards = messagesEl.querySelectorAll(
      '.agent-step-todo[data-status="running"]'
    );
    if (!cards.length) {
      return;
    }
    const cancelledText = t("cancelledByUser") || "Cancelled by user";
    for (const el of cards) {
      // Rebuild steps[] from rendered item DOM: data-todo-status / title.
      const items = el.querySelectorAll(".todo-plan-item");
      const steps = [];
      items.forEach((row) => {
        const titleEl = row.querySelector(".todo-plan-item-title");
        const rawStatus =
          row.getAttribute("data-todo-status") || "pending";
        const status =
          rawStatus === "done"
            ? "done"
            : rawStatus === "in_progress"
              ? "pending" // turn the in_progress one into pending on cancel
              : "pending";
        steps.push({
          title: titleEl ? titleEl.textContent || "" : "",
          status,
        });
      });
      el.dataset.status = "error";
      el.dataset.cancelled = "1";
      renderTodoStep(el, {
        stepId: el.getAttribute("data-step-id") || "",
        kind: "todo",
        name: "update_todo",
        status: "error",
        steps,
        resultPreview: cancelledText,
      });
    }
  }

  /**
   * When the assistant finishes successfully without a final update_todo call
   * that marks every step "done", auto-complete any still-running todo plan
   * cards so the user sees a finished checklist instead of a stuck spinner.
   */
  function completeRunningTodoPlans() {
    const cards = messagesEl.querySelectorAll(
      '.agent-step-todo[data-status="running"]'
    );
    if (!cards.length) {
      return;
    }
    for (const el of cards) {
      const items = el.querySelectorAll(".todo-plan-item");
      const steps = [];
      items.forEach((row) => {
        const titleEl = row.querySelector(".todo-plan-item-title");
        steps.push({
          title: titleEl ? titleEl.textContent || "" : "",
          status: "done",
        });
      });
      el.dataset.status = "done";
      el.dataset.todoOpen = "0";
      renderTodoStep(el, {
        stepId: el.getAttribute("data-step-id") || "",
        kind: "todo",
        name: "update_todo",
        status: "done",
        steps,
      });
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

  /** Full-turn duration stamped on a step by the host (0 when unknown). */
  function groupRunDurationMs(group) {
    const el = group.querySelector("[data-run-duration-ms]");
    if (!el) {
      return 0;
    }
    const ms = Number(el.getAttribute("data-run-duration-ms")) || 0;
    return ms > 0 ? ms : 0;
  }

  /** TTFT stamped with run duration (0 when unknown). */
  function groupTtftMs(group) {
    const el =
      group.querySelector("[data-ttft-ms]") ||
      group.querySelector("[data-run-duration-ms]");
    if (!el) {
      return 0;
    }
    const ms = Number(el.getAttribute("data-ttft-ms")) || 0;
    return ms > 0 ? ms : 0;
  }

  function formatRunDuration(ms) {
    const seconds = ms / 1000;
    if (UI_LANG === "ru") {
      return seconds >= 90
        ? `${Math.floor(seconds / 60)} мин ${Math.round(seconds % 60)} с`
        : `${seconds.toFixed(1).replace(".", ",")} с`;
    }
    return seconds >= 90
      ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
      : `${seconds.toFixed(1)} s`;
  }

  /** Status / tooltip: "1,2 → 18,6 с" when TTFT known, else just total. */
  function formatTurnTiming(ttftMs, totalMs) {
    if (!(totalMs > 0)) {
      return "";
    }
    const total = formatRunDuration(totalMs);
    if (ttftMs > 0 && ttftMs < totalMs) {
      // Drop the unit from the TTFT side so the arrow reads "1,2 → 18,6 с".
      const ttftRaw = formatRunDuration(ttftMs).replace(/\s*(с|s|мин|min).*$/, "");
      return t("runTiming", ttftRaw, total);
    }
    return total;
  }

  /** Hover detail only when both TTFT and total are known. */
  function formatTurnTimingDetail(ttftMs, totalMs) {
    if (!(totalMs > 0) || !(ttftMs > 0) || ttftMs >= totalMs) {
      return "";
    }
    return formatTurnTiming(ttftMs, totalMs);
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
    let durationEl = group.querySelector(".tool-group-duration");
    if (!durationEl && toggle) {
      durationEl = document.createElement("span");
      durationEl.className = "tool-group-duration";
      durationEl.hidden = true;
      toggle.appendChild(durationEl);
    }
    const runDurationMs = groupRunDurationMs(group);
    const ttftMs = groupTtftMs(group);
    const timingDetail = formatTurnTimingDetail(ttftMs, runDurationMs);
    if (summary) {
      const types = toolTypesSummary(group);
      if (group.dataset.failed === "1") {
        summary.textContent = t("runFailedSummary");
        summary.removeAttribute("title");
      } else if (group.dataset.sealed === "1") {
        // Тихая лента: «выполнено · 4 шага · 2 файла» + шеврон +
        // итоговое время справа от «>»; TTFT→всего — в title при hover.
        const base = group.classList.contains("is-run-working")
          ? t("runWorking")
          : t("runDone");
        const parts = [stepsCountLabel(timelineToolStepsCount(group))].filter(
          Boolean
        );
        const files = timelineEditedFilesCount(group);
        if (files > 0) {
          parts.push(t("toolFiles", files));
        }
        const reviewAdd = Number(group.dataset.reviewAdded) || 0;
        const reviewDel = Number(group.dataset.reviewRemoved) || 0;
        if (reviewAdd > 0 || reviewDel > 0) {
          parts.push(`+${reviewAdd} −${reviewDel}`);
        }
        summary.textContent = `${base}${
          parts.length ? ` · ${parts.join(" · ")}` : ""
        }`;
        summary.removeAttribute("title");
      } else {
        const base = t("runWorking");
        summary.textContent = types ? `${base} · ${types}` : base;
        summary.removeAttribute("title");
      }
    }
    if (durationEl) {
      if (
        group.dataset.sealed === "1" &&
        group.dataset.failed !== "1" &&
        runDurationMs > 0
      ) {
        durationEl.hidden = false;
        durationEl.textContent = formatRunDuration(runDurationMs);
        if (timingDetail) {
          durationEl.title = timingDetail;
        } else {
          durationEl.removeAttribute("title");
        }
      } else {
        durationEl.hidden = true;
        durationEl.textContent = "";
        durationEl.removeAttribute("title");
      }
    }
    if (toggle) {
      const sealedTypes =
        group.dataset.sealed === "1" && group.dataset.failed !== "1"
          ? toolTypesSummary(group)
          : "";
      const tipParts = [];
      if (!hasSteps) {
        toggle.title = "";
      } else if (group.classList.contains("is-collapsed")) {
        tipParts.push(
          sealedTypes ? `${t("showSteps")} · ${sealedTypes}` : t("showSteps")
        );
        if (timingDetail) {
          tipParts.push(timingDetail);
        }
        toggle.title = tipParts.join(" · ");
      } else {
        tipParts.push(t("hideSteps"));
        if (timingDetail) {
          tipParts.push(timingDetail);
        }
        toggle.title = tipParts.join(" · ");
      }
    }
  }

  function createToolGroup() {
    const group = document.createElement("div");
    group.className = "tool-group agent-timeline is-collapsed";
    group.innerHTML =
      `<button type="button" class="tool-group-toggle" aria-expanded="false" disabled>` +
      `<span class="tool-group-summary">${escapeHtml(t("runWorking"))}</span>` +
      `<span class="material-symbols-outlined tool-group-chevron" aria-hidden="true" hidden>expand_more</span>` +
      `<span class="tool-group-duration" hidden></span>` +
      `</button>` +
      `<div class="tool-group-live-note"></div>` +
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
    // Промежуточный текст модели запечатал ленту, но ход продолжается:
    // переоткрываем её вместо создания второй строки «выполняю» —
    // один ход, одна лента (итог сводки считается по всем раундам).
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    const scope = turn || messagesEl;
    const reopenable = [
      ...scope.querySelectorAll(
        ".tool-group.agent-timeline.is-run-working[data-sealed]"
      ),
    ];
    if (reopenable.length) {
      const group = reopenable[reopenable.length - 1];
      group.classList.remove("is-run-working");
      delete group.dataset.sealed;
      updateToolGroupSummary(group);
      keepStatusAtEnd();
      return group;
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
    if (kind === "todo") {
      return "checklist";
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

  /**
   * Intermediate assistant text (a completed text block from an earlier
   * model round of this turn). Rendered as a muted markdown card INSIDE the
   * collapsed tool group so the finale-only bubble does not wipe mid-turn
   * lists / answers the model keeps referring to.
   */
  function upsertTextBlockStep(step) {
    const raw = String(step.text || "").trim();
    if (!raw) {
      return null;
    }
    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return null;
    }
    const stepId = String(step.stepId || "");
    let el = body.querySelector(
      `.agent-step[data-step-id="${stepId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
    );
    if (!el) {
      el = document.createElement("div");
      el.className = "msg tool agent-step";
      el.dataset.stepId = stepId;
      body.appendChild(el);
    }
    el.dataset.stepKind = "text";
    el.dataset.status = "done";
    el.classList.add("agent-step-text");
    // Комментарий модели — обычная строка ленты (иконка + текст),
    // идёт в общем порядке событий перед вызванным инструментом.
    el.innerHTML =
      `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">subject</span>` +
      `<span class="agent-step-label agent-step-text-label"></span>`;
    const textLabel = el.querySelector(".agent-step-text-label");
    if (textLabel) {
      textLabel.innerHTML = renderInlineMarkdown(raw);
    }
    // «Живая» строка под статусом: последний комментарий модели, пока
    // лента свёрнута (CSS прячет её в развёрнутом виде и после финиша).
    // Только живой поток — при перерисовке истории тикер не оживляем.
    if (!restoringChatScroll) {
      let note = group.querySelector(".tool-group-live-note");
      if (!note) {
        note = document.createElement("div");
        note.className = "tool-group-live-note";
        const body = group.querySelector(".tool-group-body");
        group.insertBefore(note, body || null);
      }
      note.innerHTML = renderInlineMarkdown(raw);
    }
    keepStatusAtEnd();
    scrollToBottom();
    return el;
  }

  function upsertAgentStep(step) {
    if (!step || !step.stepId) {
      return null;
    }
    if (step.kind === "text") {
      return upsertTextBlockStep(step);
    }

    // Plan card (update_todo) lives OUTSIDE the collapsed tool group — it must
    // stay visible while the steps timeline is folded. Upsert into the turn.
    if (step.kind === "todo") {
      const turnScope = currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
      const todoSel = `.agent-step[data-step-id="${String(step.stepId).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      let todoEl = turnScope.querySelector(todoSel);
      // No tasks → no plan card. Avoids an empty «План» placeholder
      // (e.g. a failed update_todo that carried no step items).
      const todoSteps = Array.isArray(step.steps) ? step.steps : [];
      if (todoSteps.length === 0) {
        if (todoEl) {
          todoEl.remove();
        }
        return null;
      }
      if (!todoEl) {
        todoEl = document.createElement("div");
        todoEl.className = "msg tool agent-step";
        todoEl.dataset.stepId = step.stepId;
        ensureChatTurn().appendChild(todoEl);
      }
      // A plan card cancelled by Stop must not be revived by a late/queued
      // "step" message still in the host pipe after the abort.
      if (todoEl.dataset.cancelled === "1") {
        return todoEl;
      }
      todoEl.dataset.stepKind = "todo";
      if (step.status) {
        todoEl.dataset.status = step.status;
      }
      todoEl.classList.add("agent-step-todo");
      renderTodoStep(todoEl, step);
      // Pin the plan card right under the user's prompt, above the step /
      // thinking timeline, regardless of the order events arrive in.
      positionTodoPlanAfterUser(turnScope, todoEl);
      keepStatusAtEnd();
      scrollToBottom();
      return todoEl;
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

    // If not found in the active group, search all groups (including sealed).
    // This handles late stamps (e.g. runDurationMs) that arrive after
    // assistantDone has sealed the original group.
    if (!el) {
      el = messagesEl.querySelector(
        `.agent-step[data-step-id="${String(step.stepId).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      );
    }

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
    if (step.metrics) {
      try {
        el.dataset.metrics = JSON.stringify(step.metrics);
      } catch {
        /* metrics are optional display hints — ignore unparsable payloads */
      }
    }
    // Host stamps the full turn duration (ms) on the turn's last tool step
    // when the run succeeds — the group summary renders it after «выполнено».
    if (typeof step.runDurationMs === "number" && step.runDurationMs > 0) {
      // Use setAttribute — dataset.runDurationMs produces "data-run-duration-m-s"
      // (hyphen before each capital), but groupRunDurationMs queries
      // "[data-run-duration-ms]".  setAttribute keeps the name literal.
      el.setAttribute("data-run-duration-ms", String(Math.round(step.runDurationMs)));
      if (typeof step.ttftMs === "number" && step.ttftMs > 0) {
        el.setAttribute("data-ttft-ms", String(Math.round(step.ttftMs)));
      }
      const ownerGroup = el.closest(".tool-group");
      if (ownerGroup) {
        // Late duration stamps arrive after assistantDone has sealed the group.
        // ensureActiveToolGroup may have reopened it (is-run-working → unseal)
        // — re-seal so updateToolGroupSummary renders the "выполнено" branch
        // which includes the duration.
        if (!ownerGroup.dataset.sealed) {
          ownerGroup.dataset.sealed = "1";
        }
        updateToolGroupSummary(ownerGroup);
      }
    }
    if (typeof step.durationMs === "number" && step.durationMs >= 0) {
      el.setAttribute("data-duration-ms", String(Math.round(step.durationMs)));
    }
    if (step.kind === "tool") {
      el.dataset.toolMatchKey = toolStepMatchKey(
        step.name,
        step.argsPreview,
        // Same label the "⚙ name(args)" text line derives its key from —
        // without it url/skill/mcp tools get an empty key and never merge
        // with their text twin.
        formatToolHumanLabel(
          step.name,
          step.argsPreview,
          step.metrics,
          step.status,
          step.resultPreview || ""
        )
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
            task = String(
              args.task || args.prompt || args.systemPrompt || ""
            ).trim();
          } catch {
            const m = String(step.argsPreview || "").match(
              /"task"\s*:\s*"((?:\\.|[^"\\])*)/
            );
            if (m) {
              task = m[1].replace(/\\"/g, '"');
            }
            if (!task) {
              const sp = String(step.argsPreview || "").match(
                /"systemPrompt"\s*:\s*"((?:\\.|[^"\\])*)/
              );
              if (sp) {
                task = sp[1].replace(/\\"/g, '"');
              }
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
        // Per-tool wall-clock duration (from runtime TurnTiming).
        const toolMs =
          typeof step.durationMs === "number" && step.durationMs >= 0
            ? step.durationMs
            : Number(el.getAttribute("data-duration-ms")) || 0;
        if (
          toolMs > 0 &&
          (step.status === "done" || step.status === "error")
        ) {
          const dur = document.createElement("span");
          dur.className = "agent-step-duration";
          dur.textContent = formatRunDuration(toolMs);
          labelEl.appendChild(dur);
        }
      }
      // Комментарий модели («Нашёл версию, правлю…») остаётся
      // самостоятельной строкой ленты ПЕРЕД инструментом — хронологичный
      // список: текст, затем шаг. Раньше текст приклеивался описанием
      // в карточку инструмента.
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
      if (!el.querySelector(".agent-step-checkpoint-compare")) {
        const compareBtn = document.createElement("button");
        compareBtn.type = "button";
        compareBtn.className = "agent-step-checkpoint-compare";
        compareBtn.title = t("checkpointCompare");
        compareBtn.innerHTML =
          '<span class="material-symbols-outlined" aria-hidden="true">difference</span>';
        compareBtn.onclick = (event) => {
          event.stopPropagation();
          host.postMessage({
            type: "compareCheckpoint",
            chatId: activeChatId || "",
            checkpointRunCount: Number(step.checkpointRunCount) || undefined,
          });
        };
        el.appendChild(compareBtn);
      }
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

  /**
   * Keep the update_todo plan card pinned as the first element of the turn's
   * work area — directly under the user prompt and above the tool/thinking
   * timeline. Repeated calls are safe (same-position moves are no-ops) and the
   * card is re-pinned on every update so an assistant message or tool group
   * appended later never pushes it down.
   */
  function positionTodoPlanAfterUser(turnScope, todoEl) {
    const users = turnScope.querySelectorAll(".msg-wrap-user");
    const user = users.length ? users[users.length - 1] : null;
    if (user) {
      const after = user.nextSibling;
      if (todoEl !== after) {
        turnScope.insertBefore(todoEl, after);
      }
      harborSyncTodoTop(todoEl, user);
    } else if (turnScope.firstChild !== todoEl) {
      turnScope.insertBefore(todoEl, turnScope.firstChild);
      todoEl.style.removeProperty("--harbor-todo-top");
    }
  }

  /**
   * Set --harbor-todo-top = user bubble height so the sticky todo card pins
   * directly below the (opaque, higher z-index) user message. A
   * ResizeObserver keeps the variable in sync when the bubble reflows.
   */
  function harborSyncTodoTop(todoEl, userEl) {
    if (!todoEl || !userEl) return;
    const setTop = () => {
      const h = userEl.offsetHeight || 0;
      todoEl.style.setProperty("--harbor-todo-top", h + "px");
    };
    setTop();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(setTop);
      ro.observe(userEl);
    }
  }

  /** update_todo plan card: «План · 1/4» header + collapsible step list. */
  function renderTodoStep(el, step) {
    const steps = Array.isArray(step.steps) ? step.steps : [];
    const prevOpen = el.dataset.todoOpen === "1";
    const open = prevOpen;
    const failed = String(step.status || "") === "error";

    let doneCount = 0;
    let currentTitle = "";
    for (const item of steps) {
      if (String(item.status || "") === "done") {
        doneCount += 1;
      } else if (!currentTitle && String(item.status || "") === "in_progress") {
        currentTitle = String(item.title || "");
      }
    }
    if (!currentTitle) {
      const next = steps.find(
        (item) => String(item.status || "") !== "done" && item.title
      );
      currentTitle = next ? String(next.title) : "";
    }

    const counter = steps.length ? `${doneCount}/${steps.length}` : "";
    el.dataset.todoOpen = open ? "1" : "0";

    // Full card collapse: when data-todo-card-collapsed="1", only a compact
    // chip is visible — click it to restore the card.
    const cardCollapsed = el.dataset.todoCardCollapsed === "1";
    if (cardCollapsed) {
      el.innerHTML = "";
      const chip = document.createElement("div");
      chip.className = "todo-plan-chip";
      const chipIcon = failed
        ? "error"
        : steps.length && doneCount === steps.length
          ? "check"
          : "checklist";
      chip.innerHTML =
        `<span class="material-symbols-outlined todo-plan-chip-icon" aria-hidden="true">${chipIcon}</span>` +
        `<span class="todo-plan-chip-label">${t("todoPlanTitle")}</span>` +
        (counter ? `<span class="todo-plan-chip-counter">${counter}</span>` : "");
      chip.addEventListener("click", () => {
        el.dataset.todoCardCollapsed = "0";
        renderTodoStep(el, { steps, status: step.status });
      });
      el.appendChild(chip);
      return;
    }

    const head = document.createElement("div");
    head.className = "todo-plan-head";
    const statusIcon = failed
      ? "error"
      : steps.length && doneCount === steps.length
        ? "check"
        : "checklist";
    head.innerHTML =
      `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">${statusIcon}</span>` +
      `<span class="todo-plan-title"></span>` +
      `<span class="todo-plan-counter"></span>` +
      `<span class="material-symbols-outlined todo-plan-minimize" title="Свернуть панель" aria-hidden="true">minimize</span>` +
      `<span class="material-symbols-outlined todo-plan-chevron" aria-hidden="true">${open ? "expand_less" : "expand_more"}</span>`;
    const titleEl = head.querySelector(".todo-plan-title");
    if (titleEl) {
      titleEl.textContent = t("todoPlanTitle");
    }
    const counterEl = head.querySelector(".todo-plan-counter");
    if (counterEl) {
      counterEl.textContent = counter;
    }
    head.addEventListener("click", (e) => {
      // Minimize button: collapse entire card into compact chip.
      if (e.target.closest(".todo-plan-minimize")) {
        e.stopPropagation();
        el.dataset.todoCardCollapsed = "1";
        renderTodoStep(el, { steps, status: step.status });
        return;
      }
      el.dataset.todoOpen = el.dataset.todoOpen === "1" ? "0" : "1";
      renderTodoStep(el, { steps, status: step.status });
    });

    const list = document.createElement("div");
    list.className = "todo-plan-list";
    if (!open) {
      list.setAttribute("hidden", "");
    }
    steps.forEach((item) => {
      const status = failed ? "pending" : String(item.status || "pending");
      const icon = failed
        ? "schedule"
        : status === "done"
          ? "check"
          : status === "in_progress"
            ? "progress_activity"
            : "schedule";
      const row = document.createElement("div");
      row.className = "todo-plan-item";
      row.dataset.todoStatus = status;
      row.title = t(
        status === "done"
          ? "todoPlanStepDone"
          : status === "in_progress"
            ? "todoPlanStepInProgress"
            : "todoPlanStepPending"
      );
      row.innerHTML =
        `<span class="material-symbols-outlined todo-plan-item-icon" aria-hidden="true">${icon}</span>` +
        `<span class="todo-plan-item-title"></span>`;
      const rowTitle = row.querySelector(".todo-plan-item-title");
      if (rowTitle) {
        rowTitle.textContent = String(item.title || "");
      }
      list.appendChild(row);
    });

    el.innerHTML = "";
    el.appendChild(head);
    if (!open && currentTitle) {
      const current = document.createElement("div");
      current.className = "todo-plan-current";
      current.textContent = currentTitle;
      el.appendChild(current);
    }
    if (failed && step.resultPreview) {
      const err = document.createElement("div");
      err.className = "todo-plan-error";
      err.textContent = String(step.resultPreview);
      el.appendChild(err);
    }
    el.appendChild(list);
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


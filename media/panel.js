(function () {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || { selectedModel: null };

  const messagesEl = document.getElementById("messages");
  const promptEl = document.getElementById("prompt");
  const sendBtn = document.getElementById("sendBtn");
  const newChatBtn = document.getElementById("newChatBtn");
  const modelPicker = document.getElementById("modelPicker");
  const modelTrigger = document.getElementById("modelTrigger");
  const modelLabel = document.getElementById("modelLabel");
  const modelMenu = document.getElementById("modelMenu");

  const agentStatusEl = document.getElementById("agentStatus");
  const agentsScreen = document.getElementById("agentsScreen");
  const archiveScreen = document.getElementById("archiveScreen");
  const chatScreen = document.getElementById("chatScreen");
  const agentsListEl = document.getElementById("agentsList");
  const archiveListEl = document.getElementById("archiveList");
  const newAgentBtn = document.getElementById("newAgentBtn");
  const openArchiveBtn = document.getElementById("openArchiveBtn");
  const archiveCountBadge = document.getElementById("archiveCountBadge");
  const backFromArchiveBtn = document.getElementById("backFromArchiveBtn");
  const backToAgentsBtn = document.getElementById("backToAgentsBtn");
  const chatAgentNameEl = document.getElementById("chatAgentName");
  const chatTitleEl = document.getElementById("chatTitle");
  const contextRingEl = document.getElementById("contextRing");
  const contextRingValueEl = contextRingEl
    ? contextRingEl.querySelector(".context-ring-value")
    : null;
  const contextTipEl = document.getElementById("contextTip");

  let agentsData = [];
  let archiveAgentsData = [];
  let contextUsed = 0;
  let contextMax = 128000;

  const ARCHIVE_ICON =
    `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
    `<path fill="currentColor" d="M2.5 2.25h11a1.25 1.25 0 0 1 1.25 1.25v1.1c0 .48-.39.9-.88.9H2.13a.9.9 0 0 1-.88-.9V3.5c0-.69.56-1.25 1.25-1.25z"/>` +
    `<path fill="currentColor" d="M3.25 6.25h9.5v5.9c0 .97-.78 1.75-1.75 1.75h-6c-.97 0-1.75-.78-1.75-1.75v-5.9zm3.1 1.35a.55.55 0 0 0 0 1.1h3.3a.55.55 0 1 0 0-1.1h-3.3z"/>` +
    `</svg>`;

  const RESTORE_ICON =
    `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
    `<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M8 9.5V3.5M5.5 5.75 8 3.25l2.5 2.5"/>` +
    `<path fill="currentColor" d="M3 10.75h10v1.6c0 .9-.7 1.65-1.6 1.65H4.6c-.9 0-1.6-.75-1.6-1.65v-1.6z"/>` +
    `</svg>`;

  const DELETE_ICON =
    `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
    `<path fill="currentColor" d="M6.2 1.75h3.6c.4 0 .7.3.7.7V3h2.75a.5.5 0 0 1 0 1H2.75a.5.5 0 0 1 0-1H5.5V2.45c0-.4.3-.7.7-.7z"/>` +
    `<path fill="currentColor" fill-rule="evenodd" d="M3.85 5.25h8.3l-.58 7.55A1.85 1.85 0 0 1 9.73 14.5H6.27a1.85 1.85 0 0 1-1.84-1.7L3.85 5.25zm2.55 2.1a.55.55 0 0 1 .55.55v4.1a.55.55 0 0 1-1.1 0v-4.1a.55.55 0 0 1 .55-.55zm3.2 0a.55.55 0 0 1 .55.55v4.1a.55.55 0 1 1-1.1 0v-4.1a.55.55 0 0 1 .55-.55z"/>` +
    `</svg>`;

  const DEFAULT_MODELS = [
    { id: "DeepSeek-V4-Flash", label: "DeepSeek V4 Flash" },
    { id: "Qwen3-Coder-Next", label: "Qwen3 Coder Next" },
    { id: "Gemma-4-31b", label: "Gemma 4 31B" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "Gemini 2.5 Flash", label: "Gemini 2.5 Flash" },
  ];

  let busy = false;
  let models = DEFAULT_MODELS.slice();
  let selectedModelId = state.selectedModel || DEFAULT_MODELS[0].id;
  let menuOpen = false;
  let streamingEl = null;

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setAgentStatus(text, hidden) {
    if (!agentStatusEl) {
      return;
    }
    if (hidden || !text) {
      agentStatusEl.hidden = true;
      agentStatusEl.textContent = "";
      return;
    }
    agentStatusEl.hidden = false;
    agentStatusEl.textContent = text;
  }

  function formatTokenCount(n) {
    const value = Math.max(0, Math.round(Number(n) || 0));
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (value >= 10_000) {
      return `${Math.round(value / 1000)}k`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    }
    return String(value);
  }

  function contextPct(used, max) {
    const u = Math.max(0, Number(used) || 0);
    const m = Math.max(1, Number(max) || 128000);
    return Math.min(1, u / m);
  }

  function setContextUsage(used, max) {
    if (!contextRingEl || !contextRingValueEl) {
      return;
    }
    contextUsed = Math.max(0, Number(used) || 0);
    contextMax = Math.max(1, Number(max) || 128000);
    const pct = contextPct(contextUsed, contextMax);
    const filled = Math.max(pct > 0 ? 1.5 : 0, Math.round(pct * 1000) / 10);
    const pctLabel = Math.round(pct * 100);
    contextRingValueEl.setAttribute(
      "stroke-dasharray",
      `${filled} ${100 - filled}`
    );
    contextRingEl.classList.toggle("is-warn", pct >= 0.7 && pct < 0.9);
    contextRingEl.classList.toggle("is-danger", pct >= 0.9);
    const usedLabel = formatTokenCount(contextUsed);
    const maxLabel = formatTokenCount(contextMax);
    const tip = `${usedLabel} / ${maxLabel} · ${pctLabel}%`;
    if (contextTipEl) {
      contextTipEl.textContent = tip;
    }
    contextRingEl.setAttribute("aria-label", `Контекст: ${tip}`);
    contextRingEl.hidden = false;
  }

  function formatToolLine(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^([a-zA-Z0-9_]+)\(([\s\S]*)\)$/);
    if (!match) {
      return raw;
    }

    const name = match[1];
    let args = {};
    try {
      args = match[2] ? JSON.parse(match[2]) : {};
    } catch {
      return `${name}`;
    }

    switch (name) {
      case "run_command":
        return args.command ? `run · ${args.command}` : "run_command";
      case "read_file":
        return args.relativePath
          ? `read · ${args.relativePath}`
          : "read_file";
      case "write_file":
        return args.relativePath
          ? `write · ${args.relativePath}`
          : "write_file";
      case "list_files": {
        const path = args.relativePath || ".";
        return `list · ${path}`;
      }
      default: {
        const values = Object.values(args)
          .filter((v) => typeof v === "string" || typeof v === "number")
          .slice(0, 2);
        return values.length ? `${name} · ${values.join(" · ")}` : name;
      }
    }
  }

  function showScreen(name) {
    const screen = name === "chat" || name === "archive" ? name : "agents";
    if (agentsScreen) {
      agentsScreen.hidden = screen !== "agents";
    }
    if (archiveScreen) {
      archiveScreen.hidden = screen !== "archive";
    }
    if (chatScreen) {
      chatScreen.hidden = screen !== "chat";
    }
    if (screen === "chat") {
      setContextUsage(contextUsed, contextMax);
      focusPrompt();
    }
  }

  function setArchiveCount(count) {
    if (!archiveCountBadge) {
      return;
    }
    const n = Number(count) || 0;
    if (n > 0) {
      archiveCountBadge.hidden = false;
      archiveCountBadge.textContent = n > 99 ? "99+" : String(n);
    } else {
      archiveCountBadge.hidden = true;
      archiveCountBadge.textContent = "0";
    }
  }

  function renderArchiveList() {
    if (!archiveListEl) {
      return;
    }
    const agents = archiveAgentsData || [];
    if (!agents.length) {
      archiveListEl.innerHTML =
        '<div class="agents-empty">Архив пуст.</div>';
      return;
    }

    archiveListEl.innerHTML = agents
      .map(
        (a) =>
          `<div class="agent-block archive-block" data-agent="${a.id}">` +
          `<div class="agent-row-wrap archive-row-wrap">` +
          `<div class="agent-row flat">` +
          `<span class="agent-main">` +
          `<div class="agent-name"></div>` +
          `<div class="agent-meta"><span class="agent-preview"></span></div>` +
          `</span>` +
          `</div>` +
          `<div class="row-actions">` +
          `<button type="button" class="row-action row-restore" data-restore-agent="${a.id}" title="Восстановить" aria-label="Восстановить">` +
          RESTORE_ICON +
          `</button>` +
          `<button type="button" class="row-action row-delete" data-delete-agent="${a.id}" title="Удалить" aria-label="Удалить">` +
          DELETE_ICON +
          `</button>` +
          `</div>` +
          `<span class="agent-time"></span>` +
          `</div>` +
          `</div>`
      )
      .join("");

    agents.forEach((a, index) => {
      const block = archiveListEl.children[index];
      if (!block) {
        return;
      }
      block.querySelector(".agent-name").textContent = a.name || "Агент";
      block.querySelector(".agent-preview").textContent = a.preview || "";
      block.querySelector(".agent-time").textContent = a.time || "";
    });
  }

  function renderAgentsList() {
    if (!agentsListEl) {
      return;
    }
    const list = agentsData;

    if (!list.length) {
      agentsListEl.innerHTML =
        '<div class="agents-empty">Нет агентов. Нажмите +, чтобы создать.</div>';
      return;
    }

    agentsListEl.innerHTML = list
      .map((a) => {
        const action = a.empty
          ? `<button type="button" class="row-action row-delete" data-delete-agent="${a.id}" title="Удалить" aria-label="Удалить">` +
            DELETE_ICON +
            `</button>`
          : `<button type="button" class="row-action row-archive" data-archive-agent="${a.id}" title="В архив" aria-label="В архив">` +
            ARCHIVE_ICON +
            `</button>`;
        return (
          `<div class="agent-block${a.active ? " is-active" : ""}" data-agent="${a.id}">` +
          `<div class="agent-row-wrap">` +
          `<button type="button" class="agent-row flat" data-agent="${a.id}">` +
          `<span class="agent-main">` +
          `<div class="agent-name"></div>` +
          `<div class="agent-meta"><span class="agent-chip"></span><span class="agent-preview"></span></div>` +
          `</span>` +
          `</button>` +
          `<div class="row-actions">` +
          action +
          `</div>` +
          `<span class="agent-time"></span>` +
          `</div>` +
          `</div>`
        );
      })
      .join("");

    list.forEach((a, index) => {
      const block = agentsListEl.children[index];
      if (!block) {
        return;
      }
      block.querySelector(".agent-name").textContent = a.name || "Агент";
      block.querySelector(".agent-chip").textContent = a.model || "—";
      block.querySelector(".agent-preview").textContent = a.preview || "";
      block.querySelector(".agent-time").textContent = a.time || "";
    });
  }

    function focusPrompt() {
    requestAnimationFrame(() => {
      promptEl.focus();
    });
  }

  function parseReviewData(raw) {
    if (Array.isArray(raw)) {
      return { files: raw, showScm: false };
    }
    if (raw && typeof raw === "object") {
      return {
        files: Array.isArray(raw.files) ? raw.files : [],
        showScm: Boolean(raw.showScm),
      };
    }
    if (typeof raw === "string") {
      try {
        return parseReviewData(JSON.parse(raw));
      } catch {
        return { files: [], showScm: false };
      }
    }
    return { files: [], showScm: false };
  }

  function appendReview(filesOrPayload, showScmFlag) {
    let parsed = parseReviewData(filesOrPayload);
    if (Array.isArray(filesOrPayload)) {
      parsed = {
        files: filesOrPayload,
        showScm:
          showScmFlag === undefined ? parsed.showScm : Boolean(showScmFlag),
      };
    } else if (showScmFlag !== undefined) {
      parsed = { ...parsed, showScm: Boolean(showScmFlag) };
    }
    const list = Array.isArray(parsed.files) ? parsed.files : [];
    if (!list.length) {
      return;
    }

    const card = document.createElement("div");
    card.className = "review-card";

    const title = document.createElement("div");
    title.className = "review-title";
    const totalAdd = list.reduce((s, f) => s + (f.added || 0), 0);
    const totalDel = list.reduce((s, f) => s + (f.removed || 0), 0);
    title.textContent = `Изменено файлов: ${list.length} · +${totalAdd} −${totalDel}`;
    card.appendChild(title);

    const fileList = document.createElement("div");
    fileList.className = "review-files";
    for (const file of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "review-file";
      row.title = "Открыть файл";
      row.innerHTML =
        `<span class="review-file-path"></span>` +
        `<span class="review-file-stats">` +
        `<span class="add">+${file.added || 0}</span> ` +
        `<span class="del">−${file.removed || 0}</span>` +
        `</span>`;
      row.querySelector(".review-file-path").textContent = file.path;
      row.addEventListener("click", () => {
        vscode.postMessage({ type: "openFile", path: file.path });
      });
      fileList.appendChild(row);
    }
    card.appendChild(fileList);
    card.dataset.paths = list.map((f) => f.path).join("\n");
    messagesEl.appendChild(card);

    const actions = document.createElement("div");
    actions.className = "review-actions";
    actions.dataset.paths = list.map((f) => f.path).join("\n");
    actions.hidden = !parsed.showScm;
    const scmBtn = document.createElement("button");
    scmBtn.type = "button";
    scmBtn.className = "review-scm";
    scmBtn.title = "Открыть Source Control";
    scmBtn.setAttribute("aria-label", "Открыть Source Control");
    scmBtn.innerHTML =
      '<svg class="review-scm-icon" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">' +
      '<path fill="currentColor" d="M21 8.25C21 6.1815 19.3185 4.5 17.25 4.5C15.1815 4.5 13.5 6.1815 13.5 8.25C13.5 10.023 14.739 11.5035 16.395 11.892C16.116 12.819 15.2655 13.5 14.25 13.5H9.75C8.9025 13.5 8.1285 13.7925 7.5 14.268V7.4235C9.21 7.0755 10.5 5.5605 10.5 3.75C10.5 1.6815 8.8185 0 6.75 0C4.6815 0 3 1.6815 3 3.75C3 5.562 4.29 7.0755 6 7.4235V16.575C4.29 16.923 3 18.438 3 20.2485C3 22.317 4.6815 23.9985 6.75 23.9985C8.8185 23.9985 10.5 22.317 10.5 20.2485C10.5 18.4755 9.261 16.995 7.605 16.6065C7.884 15.6795 8.7345 14.9985 9.75 14.9985H14.25C16.0845 14.9985 17.61 13.6725 17.931 11.9295C19.674 11.607 21 10.0845 21 8.25ZM4.5 3.75C4.5 2.5095 5.5095 1.5 6.75 1.5C7.9905 1.5 9 2.5095 9 3.75C9 4.9905 7.9905 6 6.75 6C5.5095 6 4.5 4.9905 4.5 3.75ZM9 20.25C9 21.4905 7.9905 22.5 6.75 22.5C5.5095 22.5 4.5 21.4905 4.5 20.25C4.5 19.0095 5.5095 18 6.75 18C7.9905 18 9 19.0095 9 20.25ZM17.25 10.5C16.0095 10.5 15 9.4905 15 8.25C15 7.0095 16.0095 6 17.25 6C18.4905 6 19.5 7.0095 19.5 8.25C19.5 9.4905 18.4905 10.5 17.25 10.5Z"/>' +
      "</svg>";
    scmBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "openScm" });
    });
    actions.appendChild(scmBtn);
    messagesEl.appendChild(actions);
    scrollToBottom();
  }

  function applyScmButtons(reviews) {
    const list = Array.isArray(reviews) ? reviews : [];
    const entries = list.map((r) => ({
      key: [...(r.paths || [])].map(String).sort().join("\n"),
      show: Boolean(r.showScm),
    }));
    for (const el of messagesEl.querySelectorAll(".review-actions")) {
      const key = (el.dataset.paths || "")
        .split("\n")
        .filter(Boolean)
        .sort()
        .join("\n");
      const hit = entries.find((e) => e.key === key);
      // если не нашли соответствие — прячем (безопаснее, чем оставлять кнопку)
      el.hidden = hit ? !hit.show : true;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Лёгкий markdown: заголовки, `код`, **жирный**, fences. */
  function renderInlineMarkdown(text) {
    const blocks = splitFenceBlocks(String(text));
    return blocks
      .map((block) => {
        if (block.type === "fence") {
          const inner = block.content.trim();
          // один путь в fence → просто ссылка на файл, без ```
          if (isFilePath(inner) && !inner.includes("\n")) {
            return fileLinkHtml(inner);
          }
          return `<pre class="md-pre"><code>${escapeHtml(block.content.replace(/\n$/, ""))}</code></pre>`;
        }
        const lines = block.content.split("\n");
        return lines
          .map((line) => {
            const heading = line.match(/^(#{1,3})\s+(.+)$/);
            if (heading) {
              const level = heading[1].length;
              const content = renderInlineSpans(heading[2]);
              return `<div class="md-h md-h${level}">${content}</div>`;
            }
            return renderInlineSpans(line);
          })
          .join("<br>");
      })
      .join("<br>");
  }

  function splitFenceBlocks(text) {
    const blocks = [];
    const re = /```[^\n]*\n?([\s\S]*?)```/g;
    let last = 0;
    let match;
    while ((match = re.exec(text))) {
      if (match.index > last) {
        blocks.push({ type: "text", content: text.slice(last, match.index) });
      }
      blocks.push({ type: "fence", content: match[1] });
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      blocks.push({ type: "text", content: text.slice(last) });
    }
    if (!blocks.length) {
      blocks.push({ type: "text", content: text });
    }
    return blocks;
  }

  const FILE_EXT =
    "ts|tsx|js|jsx|mjs|cjs|json|css|scss|less|sass|md|mdx|py|go|rs|java|kt|kts|vue|svelte|html|htm|yml|yaml|toml|xml|svg|sh|bash|zsh|env|lock|swift|dart|php|rb|cs|cpp|cc|cxx|h|hpp|sql|graphql|gql|proto|txt|csv|gitignore|dockerignore|editorconfig";

  function isFilePath(value) {
    const s = String(value || "").trim();
    // только пути с каталогом (src/...), голые имена файлов — не кликабельны
    if (!s || /\s/.test(s) || !s.includes("/")) {
      return false;
    }
    if (/^https?:\/\//i.test(s) || s.includes("://")) {
      return false;
    }
    // путь с расширением
    if (new RegExp(`\\.(?:${FILE_EXT})$`, "i").test(s)) {
      return true;
    }
    // путь со слэшами без странных символов
    if (/^(?:\.\/|\.\.\/)?(?:[\w.-]+\/)+[\w.-]+$/.test(s)) {
      return true;
    }
    return false;
  }

  function fileLinkHtml(path) {
    const safe = escapeHtml(path);
    return `<a class="md-file" href="#" data-path="${safe}">${safe}</a>`;
  }

  function splitTrailingPunctuation(url) {
    let href = String(url);
    let trailing = "";
    while (href.length > 8 && /[*_~.,);:!?]$/.test(href)) {
      trailing = href.slice(-1) + trailing;
      href = href.slice(0, -1);
    }
    return { href, trailing };
  }

  function linkifyAndEscape(raw) {
    const tokens = [];
    let text = String(raw);

    text = text.replace(/(https?:\/\/[^\s<>"'`]+)/g, (url) => {
      const { href, trailing } = splitTrailingPunctuation(url);
      if (!/^https?:\/\/\S+$/i.test(href)) {
        return url;
      }
      const id = tokens.length;
      tokens.push(
        `<a class="md-link" href="${escapeHtml(href)}" data-href="${escapeHtml(href)}">${escapeHtml(href)}</a>`
      );
      return `\u0001T${id}\u0001${trailing}`;
    });

    text = text.replace(
      new RegExp(
        `(?<![\\w./-])((?:\\.?\\.?/)?(?:[\\w.-]+/)+[\\w.-]+\\.(?:${FILE_EXT}))(?![\\w./-])`,
        "gi"
      ),
      (full, path) => {
        if (!isFilePath(path)) {
          return full;
        }
        const id = tokens.length;
        tokens.push(fileLinkHtml(path));
        return `\u0001T${id}\u0001`;
      }
    );

    let html = escapeHtml(text);
    html = html.replace(/\u0001T(\d+)\u0001/g, (_, id) => tokens[Number(id)] || "");
    return html;
  }

  function renderTextChunk(raw) {
    // Сначала **жирный** / *курсив*, внутри — ссылки и пути
    const tokens = [];
    let text = String(raw);

    text = text.replace(/\*\*([^*\n]+)\*\*/g, (_, inner) => {
      const id = tokens.length;
      tokens.push(`<strong class="md-strong">${linkifyAndEscape(inner)}</strong>`);
      return `\u0001B${id}\u0001`;
    });

    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, lead, inner) => {
      const id = tokens.length;
      tokens.push(`<em class="md-em">${linkifyAndEscape(inner)}</em>`);
      return `${lead}\u0001B${id}\u0001`;
    });

    let html = linkifyAndEscape(text);
    html = html.replace(/\u0001B(\d+)\u0001/g, (_, id) => tokens[Number(id)] || "");
    return html;
  }

  function renderInlineSpans(text) {
    const parts = [];
    const re = /`([^`\n]+)`/g;
    let last = 0;
    let match;
    while ((match = re.exec(text))) {
      if (match.index > last) {
        parts.push({ type: "text", value: text.slice(last, match.index) });
      }
      parts.push({ type: "tick", value: match[1] });
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      parts.push({ type: "text", value: text.slice(last) });
    }
    if (!parts.length) {
      parts.push({ type: "text", value: text });
    }

    return parts
      .map((part) => {
        if (part.type === "tick") {
          if (isFilePath(part.value)) {
            return fileLinkHtml(part.value);
          }
          return `<code class="md-code">${escapeHtml(part.value)}</code>`;
        }
        return renderTextChunk(part.value);
      })
      .join("");
  }

  function setMessageContent(el, role, text) {
    if (role === "assistant") {
      el.innerHTML = renderInlineMarkdown(text);
      return;
    }
    el.textContent = role === "tool" ? formatToolLine(text) : text;
  }

  function appendMessage(role, text) {
    if (role === "review") {
      try {
        appendReview(parseReviewData(text));
      } catch {
        // ignore bad payload
      }
      return null;
    }
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    setMessageContent(el, role, text);
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function renderMessages(list) {
    messagesEl.innerHTML = "";
    if (!Array.isArray(list)) {
      return;
    }
    for (const item of list) {
      appendMessage(item.role, item.text);
    }
  }

  function getSelectedModel() {
    return selectedModelId;
  }

  function updateTriggerLabel() {
    const model = models.find((m) => m.id === selectedModelId);
    modelLabel.textContent = model
      ? model.label || model.id
      : selectedModelId || "Нет моделей";
  }

  function setSelectedModel(id, notify) {
    selectedModelId = id || "";
    state.selectedModel = selectedModelId;
    vscode.setState(state);
    updateTriggerLabel();
    if (menuOpen) {
      renderMenu();
    }
    if (notify && selectedModelId) {
      vscode.postMessage({ type: "modelChanged", model: selectedModelId });
    }
  }

  function renderMenu() {
    modelMenu.innerHTML = "";
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = "Нет моделей в настройках";
      modelMenu.appendChild(empty);
      return;
    }

    for (const model of models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (model.id === selectedModelId ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.dataset.id = model.id;

      const label = document.createElement("span");
      label.className = "model-option-label";
      label.textContent = model.label || model.id;
      btn.appendChild(label);

      if (model.id === selectedModelId) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML =
          '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.appendChild(check);
      }

      modelMenu.appendChild(btn);
    }
  }

  function openMenu() {
    if (busy) {
      return;
    }
    menuOpen = true;
    renderMenu();
    modelPicker.classList.add("is-open");
    modelTrigger.setAttribute("aria-expanded", "true");
    modelMenu.hidden = false;
  }

  function closeMenu() {
    menuOpen = false;
    modelPicker.classList.remove("is-open");
    modelTrigger.setAttribute("aria-expanded", "false");
    modelMenu.hidden = true;
  }

  function toggleMenu() {
    if (menuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    promptEl.disabled = busy;
    modelTrigger.disabled = busy;
    newChatBtn.disabled = busy;
    if (busy) {
      closeMenu();
    }
    sendBtn.dataset.mode = busy ? "stop" : "send";
    sendBtn.title = busy ? "Остановить" : "Отправить";
    sendBtn.setAttribute("aria-label", busy ? "Остановить" : "Отправить");
    sendBtn.classList.toggle("is-stop", busy);
    if (!busy) {
      focusPrompt();
    }
  }

  function fillModels(nextModels, preferredId) {
    const incoming = Array.isArray(nextModels) ? nextModels : [];
    models = incoming.length ? incoming : DEFAULT_MODELS.slice();
    const preferred =
      preferredId ||
      selectedModelId ||
      state.selectedModel ||
      models[0]?.id ||
      "";
    const exists = models.some((m) => m.id === preferred);
    setSelectedModel(exists ? preferred : models[0]?.id || "", false);
  }

  // сразу показать модель, не дожидаясь init
  fillModels(DEFAULT_MODELS, selectedModelId);

  function selectModelById(id) {
    if (!id || busy) {
      return;
    }
    setSelectedModel(id, true);
    closeMenu();
  }

  modelTrigger.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  modelTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) {
      return;
    }
    toggleMenu();
  });

  modelMenu.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const option = event.target.closest(".model-option");
    if (!option || option.classList.contains("is-empty")) {
      return;
    }
    selectModelById(option.dataset.id);
  });

  modelMenu.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  document.addEventListener("mousedown", (event) => {
    if (!menuOpen) {
      return;
    }
    if (!modelPicker.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen) {
      closeMenu();
    }
  });


  function sendPrompt() {
    const text = promptEl.value.trim();
    if (!text || busy) {
      return;
    }
    appendMessage("user", text);
    promptEl.value = "";
    setBusy(true);
    vscode.postMessage({
      type: "send",
      text,
      model: getSelectedModel(),
    });
  }

  sendBtn.addEventListener("click", () => {
    if (busy) {
      vscode.postMessage({ type: "stop" });
      return;
    }
    sendPrompt();
  });

  newChatBtn.addEventListener("click", () => {
    if (busy) {
      return;
    }
    vscode.postMessage({ type: "newChat" });
  });

  if (newAgentBtn) {
    newAgentBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "newAgent" });
    });
  }

  if (openArchiveBtn) {
    openArchiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showArchive" });
    });
  }

  if (backFromArchiveBtn) {
    backFromArchiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showAgents" });
    });
  }

  if (backToAgentsBtn) {
    backToAgentsBtn.addEventListener("click", () => {
      if (busy) {
        return;
      }
      vscode.postMessage({ type: "showAgents" });
    });
  }

  if (archiveListEl) {
    archiveListEl.addEventListener("click", (event) => {
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          vscode.postMessage({
            type: "deleteAgent",
            agentId: deleteBtn.dataset.deleteAgent,
          });
        }
        return;
      }
      const restoreBtn = event.target.closest(".row-restore");
      if (!restoreBtn) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (restoreBtn.dataset.restoreAgent) {
        vscode.postMessage({
          type: "restoreAgent",
          agentId: restoreBtn.dataset.restoreAgent,
        });
      }
    });
  }

  if (agentsListEl) {
    agentsListEl.addEventListener("click", (event) => {
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          vscode.postMessage({
            type: "deleteAgent",
            agentId: deleteBtn.dataset.deleteAgent,
          });
        }
        return;
      }
      const archiveBtn = event.target.closest(".row-archive");
      if (archiveBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (archiveBtn.dataset.archiveAgent) {
          vscode.postMessage({
            type: "archiveAgent",
            agentId: archiveBtn.dataset.archiveAgent,
          });
        }
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (agentRow) {
        event.preventDefault();
        vscode.postMessage({
          type: "openAgent",
          agentId: agentRow.dataset.agent,
        });
      }
    });
  }

  messagesEl.addEventListener("click", (event) => {
    const file = event.target.closest("a.md-file");
    if (file) {
      event.preventDefault();
      const path = file.getAttribute("data-path");
      if (path) {
        vscode.postMessage({ type: "openFile", path });
      }
      return;
    }
    const link = event.target.closest("a.md-link");
    if (!link) {
      return;
    }
    event.preventDefault();
    const href = link.getAttribute("data-href") || link.getAttribute("href");
    if (href) {
      vscode.postMessage({ type: "openExternal", url: href });
    }
  });

  promptEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        fillModels(msg.models, msg.selectedModel);
        renderMessages(msg.uiMessages || []);
        if (chatAgentNameEl && msg.agentName) {
          chatAgentNameEl.textContent = msg.agentName;
        }
        if (chatTitleEl && msg.chatTitle) {
          chatTitleEl.textContent = msg.chatTitle;
        }
        if (msg.contextMax !== undefined || msg.contextUsed !== undefined) {
          setContextUsage(msg.contextUsed || 0, msg.contextMax || contextMax);
        }
        showScreen(msg.screen || "agents");
        setBusy(false);
        break;
      case "agentsList":
        agentsData = Array.isArray(msg.agents) ? msg.agents : [];
        renderAgentsList();
        if (typeof msg.archiveCount === "number") {
          setArchiveCount(msg.archiveCount);
        }
        if (msg.screen === "agents" || msg.screen === "chat") {
          showScreen(msg.screen);
        }
        break;
      case "archiveList":
        archiveAgentsData = Array.isArray(msg.agents) ? msg.agents : [];
        renderArchiveList();
        if (typeof msg.archiveCount === "number") {
          setArchiveCount(msg.archiveCount);
        }
        showScreen("archive");
        setBusy(false);
        break;
      case "showAgents":
        showScreen("agents");
        setBusy(false);
        break;
      case "showArchive":
        showScreen("archive");
        setBusy(false);
        break;
      case "showChat":
        if (msg.models) {
          fillModels(msg.models, msg.selectedModel);
        }
        if (msg.uiMessages) {
          renderMessages(msg.uiMessages);
        }
        if (chatAgentNameEl && msg.agentName) {
          chatAgentNameEl.textContent = msg.agentName;
        }
        if (chatTitleEl && msg.chatTitle) {
          chatTitleEl.textContent = msg.chatTitle;
        }
        if (msg.contextMax !== undefined || msg.contextUsed !== undefined) {
          setContextUsage(msg.contextUsed || 0, msg.contextMax || contextMax);
        }
        showScreen("chat");
        setBusy(false);
        break;
      case "contextUsage":
        setContextUsage(msg.used || 0, msg.max || contextMax);
        break;
      case "modelsUpdated":
        fillModels(msg.models, getSelectedModel() || msg.selectedModel);
        break;
      case "append":
        appendMessage(msg.role, msg.text);
        break;
      case "status":
        setAgentStatus(msg.text || "", Boolean(msg.hidden));
        break;
      case "review":
        appendReview(msg.files || [], msg.showScm);
        break;
      case "scmButtons":
        applyScmButtons(msg.reviews || []);
        break;
      case "assistantDelta":
        if (!streamingEl) {
          streamingEl = appendMessage("assistant", "");
          streamingEl.dataset.raw = "";
        }
        streamingEl.dataset.raw = (streamingEl.dataset.raw || "") + msg.text;
        setMessageContent(streamingEl, "assistant", streamingEl.dataset.raw);
        scrollToBottom();
        break;
      case "assistantDone":
        if (!streamingEl && msg.text) {
          appendMessage("assistant", msg.text);
        } else if (streamingEl) {
          const raw = msg.text || streamingEl.dataset.raw || "";
          setMessageContent(streamingEl, "assistant", raw);
        }
        streamingEl = null;
        setBusy(false);
        break;
      case "idle":
        streamingEl = null;
        setAgentStatus("", true);
        setBusy(false);
        break;
      case "stopped":
        streamingEl = null;
        setAgentStatus("", true);
        setBusy(false);
        break;
      case "cleared":
        messagesEl.innerHTML = "";
        streamingEl = null;
        setAgentStatus("", true);
        setContextUsage(0, contextMax);
        setBusy(false);
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
  setContextUsage(0, contextMax);

  // если init потерялся — перезапросим модели
  setTimeout(() => {
    if (!models.length) {
      vscode.postMessage({ type: "ready" });
    }
  }, 400);
})();

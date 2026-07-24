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
  const settingsScreen = document.getElementById("settingsScreen");
  const chatScreen = document.getElementById("chatScreen");
  const agentsListEl = document.getElementById("agentsList");
  const archiveListEl = document.getElementById("archiveList");
  const settingsModelsList = document.getElementById("settingsModelsList");
  const newAgentBtn = document.getElementById("newAgentBtn");
  const openArchiveBtn = document.getElementById("openArchiveBtn");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const backFromArchiveBtn = document.getElementById("backFromArchiveBtn");
  const backFromSettingsBtn = document.getElementById("backFromSettingsBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const addModelBtn = document.getElementById("addModelBtn");
  const backToAgentsBtn = document.getElementById("backToAgentsBtn");
  const chatAgentNameEl = document.getElementById("chatAgentName");
  const chatTitleEl = document.getElementById("chatTitle");
  const contextRingEl = document.getElementById("contextRing");
  const contextRingValueEl = contextRingEl
    ? contextRingEl.querySelector(".context-ring-value")
    : null;
  const contextTipEl = document.getElementById("contextTip");

  const settingsDefaultModel = document.getElementById("settingsDefaultModel");
  const settingsDefaultContext = document.getElementById("settingsDefaultContext");
  const settingsBaseUrl = document.getElementById("settingsBaseUrl");
  const settingsApiKey = document.getElementById("settingsApiKey");
  const settingsRejectUnauthorized = document.getElementById(
    "settingsRejectUnauthorized"
  );
  const settingsCaBundle = document.getElementById("settingsCaBundle");
  const settingsSystemPrompt = document.getElementById("settingsSystemPrompt");
  const settingsMaxToolRounds = document.getElementById("settingsMaxToolRounds");
  const settingsMaxTokens = document.getElementById("settingsMaxTokens");
  const settingsMaxResponseChars = document.getElementById(
    "settingsMaxResponseChars"
  );

  let agentsData = [];
  let archiveAgentsData = [];
  let settingsModels = [];
  let settingsDefaultModelId = "";
  let contextUsed = 0;
  let contextMax = 128000;

  const ARCHIVE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>';

  const RESTORE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">unarchive</span>';

  const DELETE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">delete</span>';

  const CLOSE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">close</span>';

  const CHECK_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">check</span>';

  const SCM_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">account_tree</span>';

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
    const screen =
      name === "chat" || name === "archive" || name === "settings"
        ? name
        : "agents";
    if (agentsScreen) {
      agentsScreen.hidden = screen !== "agents";
    }
    if (archiveScreen) {
      archiveScreen.hidden = screen !== "archive";
    }
    if (settingsScreen) {
      settingsScreen.hidden = screen !== "settings";
    }
    if (chatScreen) {
      chatScreen.hidden = screen !== "chat";
    }
    if (screen === "chat") {
      setContextUsage(contextUsed, contextMax);
      focusPrompt();
    }
  }

  function syncDefaultModelSelect() {
    if (!settingsDefaultModel) {
      return;
    }
    const current = settingsDefaultModelId;
    settingsDefaultModel.innerHTML = "";
    for (const model of settingsModels) {
      const id = String(model.id || "").trim();
      if (!id) {
        continue;
      }
      const option = document.createElement("option");
      option.value = id;
      option.textContent = model.label ? `${model.label} (${id})` : id;
      settingsDefaultModel.appendChild(option);
    }
    if (
      current &&
      Array.from(settingsDefaultModel.options).some((o) => o.value === current)
    ) {
      settingsDefaultModel.value = current;
    } else if (settingsDefaultModel.options.length) {
      settingsDefaultModel.selectedIndex = 0;
      settingsDefaultModelId = settingsDefaultModel.value;
    }
  }

  function renderSettingsModels() {
    if (!settingsModelsList) {
      return;
    }
    settingsModelsList.innerHTML = "";
    settingsModels.forEach((model, index) => {
      const row = document.createElement("div");
      row.className = "settings-model-row";
      row.innerHTML =
        `<div class="settings-model-head">` +
        `<span class="settings-model-title">Модель ${index + 1}</span>` +
        `<button type="button" class="icon-btn settings-model-remove" data-index="${index}" title="Удалить" aria-label="Удалить">` +
        CLOSE_ICON +
        `</button>` +
        `</div>` +
        `<label class="settings-field">` +
        `<span class="settings-label">ID</span>` +
        `<input class="settings-input" data-field="id" data-index="${index}" type="text" placeholder="как в API, напр. gpt-4.1" />` +
        `</label>` +
        `<label class="settings-field">` +
        `<span class="settings-label">Название</span>` +
        `<input class="settings-input" data-field="label" data-index="${index}" type="text" placeholder="как видно в списке" />` +
        `</label>` +
        `<label class="settings-field">` +
        `<span class="settings-label">Контекст (токены)</span>` +
        `<input class="settings-input" data-field="contextWindow" data-index="${index}" type="number" min="1024" step="1024" placeholder="необязательно" />` +
        `</label>`;
      const idInput = row.querySelector('[data-field="id"]');
      const labelInput = row.querySelector('[data-field="label"]');
      const ctxInput = row.querySelector('[data-field="contextWindow"]');
      idInput.value = model.id || "";
      labelInput.value = model.label || "";
      ctxInput.value =
        model.contextWindow && Number(model.contextWindow) > 0
          ? String(model.contextWindow)
          : "";
      settingsModelsList.appendChild(row);
    });
    syncDefaultModelSelect();
  }

  function readModelsFromDom() {
    if (!settingsModelsList) {
      return settingsModels.slice();
    }
    const rows = Array.from(
      settingsModelsList.querySelectorAll(".settings-model-row")
    );
    return rows.map((row) => {
      const id = row.querySelector('[data-field="id"]').value.trim();
      const label = row.querySelector('[data-field="label"]').value.trim();
      const ctxRaw = row.querySelector('[data-field="contextWindow"]').value;
      const contextWindow = Number(ctxRaw);
      const model = { id, label };
      if (Number.isFinite(contextWindow) && contextWindow >= 1024) {
        model.contextWindow = Math.floor(contextWindow);
      }
      return model;
    });
  }

  function fillSettings(settings) {
    if (!settings || typeof settings !== "object") {
      return;
    }
    settingsModels = Array.isArray(settings.models)
      ? settings.models.map((m) => ({
          id: m.id || "",
          label: m.label || "",
          contextWindow: m.contextWindow,
        }))
      : [];
    settingsDefaultModelId = settings.defaultModel || "";
    if (settingsDefaultContext) {
      settingsDefaultContext.value = String(
        settings.defaultContextWindow || 128000
      );
    }
    if (settingsBaseUrl) {
      settingsBaseUrl.value = settings.baseUrl || "";
    }
    if (settingsApiKey) {
      settingsApiKey.value = settings.apiKey || "";
    }
    if (settingsRejectUnauthorized) {
      settingsRejectUnauthorized.checked = Boolean(settings.rejectUnauthorized);
    }
    if (settingsCaBundle) {
      settingsCaBundle.value = settings.caBundlePath || "";
    }
    if (settingsSystemPrompt) {
      settingsSystemPrompt.value = settings.systemPrompt || "";
    }
    if (settingsMaxToolRounds) {
      settingsMaxToolRounds.value = String(settings.maxToolRounds || 20);
    }
    if (settingsMaxTokens) {
      settingsMaxTokens.value = String(settings.maxTokens || 4096);
    }
    if (settingsMaxResponseChars) {
      settingsMaxResponseChars.value = String(
        settings.maxResponseChars || 12000
      );
    }
    renderSettingsModels();
  }

  function collectSettings() {
    settingsModels = readModelsFromDom();
    return {
      models: settingsModels,
      defaultModel: settingsDefaultModel
        ? settingsDefaultModel.value
        : settingsDefaultModelId,
      defaultContextWindow: Number(settingsDefaultContext?.value || 128000),
      baseUrl: settingsBaseUrl ? settingsBaseUrl.value.trim() : "",
      apiKey: settingsApiKey ? settingsApiKey.value : "",
      rejectUnauthorized: settingsRejectUnauthorized
        ? settingsRejectUnauthorized.checked
        : false,
      caBundlePath: settingsCaBundle ? settingsCaBundle.value.trim() : "",
      systemPrompt: settingsSystemPrompt ? settingsSystemPrompt.value : "",
      maxToolRounds: Number(settingsMaxToolRounds?.value || 20),
      maxTokens: Number(settingsMaxTokens?.value || 4096),
      maxResponseChars: Number(settingsMaxResponseChars?.value || 12000),
    };
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
    scmBtn.innerHTML = SCM_ICON;
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
        check.innerHTML = CHECK_ICON;
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

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showSettings" });
    });
  }

  if (backFromArchiveBtn) {
    backFromArchiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showAgents" });
    });
  }

  if (backFromSettingsBtn) {
    backFromSettingsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showAgents" });
    });
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      vscode.postMessage({
        type: "saveSettings",
        settings: collectSettings(),
      });
    });
  }

  if (addModelBtn) {
    addModelBtn.addEventListener("click", () => {
      settingsModels = readModelsFromDom();
      settingsModels.push({ id: "", label: "" });
      renderSettingsModels();
    });
  }

  if (settingsModelsList) {
    settingsModelsList.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".settings-model-remove");
      if (!removeBtn) {
        return;
      }
      const index = Number(removeBtn.dataset.index);
      settingsModels = readModelsFromDom();
      if (Number.isFinite(index) && index >= 0 && index < settingsModels.length) {
        settingsModels.splice(index, 1);
        if (!settingsModels.length) {
          settingsModels.push({ id: "", label: "" });
        }
        renderSettingsModels();
      }
    });
    settingsModelsList.addEventListener("input", (event) => {
      const input = event.target.closest("[data-field]");
      if (!input) {
        return;
      }
      settingsModels = readModelsFromDom();
      if (input.dataset.field === "id" || input.dataset.field === "label") {
        syncDefaultModelSelect();
      }
    });
  }

  if (settingsDefaultModel) {
    settingsDefaultModel.addEventListener("change", () => {
      settingsDefaultModelId = settingsDefaultModel.value;
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
        if (msg.screen === "agents" || msg.screen === "chat") {
          showScreen(msg.screen);
        }
        break;
      case "archiveList":
        archiveAgentsData = Array.isArray(msg.agents) ? msg.agents : [];
        renderArchiveList();
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
      case "showSettings":
        showScreen("settings");
        setBusy(false);
        break;
      case "settings":
        fillSettings(msg.settings);
        showScreen("settings");
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

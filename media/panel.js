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
  const settingsSaveStatus = document.getElementById("settingsSaveStatus");
  const addModelBtn = document.getElementById("addModelBtn");
  const settingsModelsHint = document.getElementById("settingsModelsHint");
  const settingsModelsJson = document.getElementById("settingsModelsJson");
  const importModelsJsonBtn = document.getElementById("importModelsJsonBtn");
  const exportModelsJsonBtn = document.getElementById("exportModelsJsonBtn");
  const settingsJsonHint = document.getElementById("settingsJsonHint");
  const modelEditModal = document.getElementById("modelEditModal");
  const modelEditTitle = document.getElementById("modelEditTitle");
  const modelEditTabs = document.getElementById("modelEditTabs");
  const modelEditManualPane = document.getElementById("modelEditManualPane");
  const modelEditJsonPane = document.getElementById("modelEditJsonPane");
  const modelEditId = document.getElementById("modelEditId");
  const modelEditLabel = document.getElementById("modelEditLabel");
  const modelEditContext = document.getElementById("modelEditContext");
  const modelEditOutput = document.getElementById("modelEditOutput");
  const modelEditProvider = document.getElementById("modelEditProvider");
  const modelEditCloseBtn = document.getElementById("modelEditCloseBtn");
  const modelEditCancelBtn = document.getElementById("modelEditCancelBtn");
  const modelEditDoneBtn = document.getElementById("modelEditDoneBtn");
  const settingsProvidersList = document.getElementById("settingsProvidersList");
  const settingsProvidersHint = document.getElementById("settingsProvidersHint");
  const addProviderBtn = document.getElementById("addProviderBtn");
  const providerEditModal = document.getElementById("providerEditModal");
  const providerEditTitle = document.getElementById("providerEditTitle");
  const providerEditId = document.getElementById("providerEditId");
  const providerEditName = document.getElementById("providerEditName");
  const providerEditBaseUrl = document.getElementById("providerEditBaseUrl");
  const providerEditApiKey = document.getElementById("providerEditApiKey");
  const providerEditCloseBtn = document.getElementById("providerEditCloseBtn");
  const providerEditCancelBtn = document.getElementById("providerEditCancelBtn");
  const providerEditDoneBtn = document.getElementById("providerEditDoneBtn");
  const backToAgentsBtn = document.getElementById("backToAgentsBtn");
  const chatAgentNameEl = document.getElementById("chatAgentName");
  const chatTitleEl = document.getElementById("chatTitle");
  const contextRingEl = document.getElementById("contextRing");
  const contextRingValueEl = contextRingEl
    ? contextRingEl.querySelector(".context-ring-value")
    : null;
  const contextTipEl = document.getElementById("contextTip");

  const settingsDefaultModel = document.getElementById("settingsDefaultModel");
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
  let settingsProviders = [];
  let settingsDefaultModelId = "";
  let settingsDefaultContextWindow = 128000;
  let modelEditIndex = null;
  let modelEditMode = "manual";
  let providerEditIndex = null;
  let settingsHydrating = false;
  let settingsSaveTimer = null;
  let settingsSaveStatusTimer = null;
  let settingsModelTipEl = null;
  let settingsModelTipRows = null;
  let settingsModelTipIndex = null;
  let settingsModelTipHideTimer = null;
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

  const SETTINGS_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">settings</span>';

  const INFO_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">info</span>';

  const HEART_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">favorite</span>';

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

  function setModelsHint(text, isError) {
    if (!settingsModelsHint) {
      return;
    }
    if (!text) {
      settingsModelsHint.hidden = true;
      settingsModelsHint.textContent = "";
      settingsModelsHint.classList.remove("is-error");
      return;
    }
    settingsModelsHint.hidden = false;
    settingsModelsHint.textContent = text;
    settingsModelsHint.classList.toggle("is-error", Boolean(isError));
  }

  function setProvidersHint(text, isError) {
    if (!settingsProvidersHint) {
      return;
    }
    if (!text) {
      settingsProvidersHint.hidden = true;
      settingsProvidersHint.textContent = "";
      settingsProvidersHint.classList.remove("is-error");
      return;
    }
    settingsProvidersHint.hidden = false;
    settingsProvidersHint.textContent = text;
    settingsProvidersHint.classList.toggle("is-error", Boolean(isError));
  }

  function providerLabel(providerId) {
    const provider = settingsProviders.find((p) => p.id === providerId);
    return provider ? provider.name || provider.id : providerId || "—";
  }

  function primaryProviderId() {
    const def = settingsProviders.find((p) => p.id === "default");
    return def?.id || settingsProviders[0]?.id || "";
  }

  function cloneProvider(provider) {
    return {
      id: provider.id || "",
      name: provider.name || "",
      baseUrl: provider.baseUrl || "",
      apiKey: provider.apiKey || "",
    };
  }

  function fillModelProviderSelect(selectedId) {
    if (!modelEditProvider) {
      return;
    }
    const fallback = primaryProviderId();
    const current = selectedId || fallback;
    modelEditProvider.innerHTML = "";
    if (!settingsProviders.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Сначала добавьте провайдера";
      modelEditProvider.appendChild(empty);
      return;
    }
    for (const provider of settingsProviders) {
      const id = String(provider.id || "").trim();
      if (!id) {
        continue;
      }
      const option = document.createElement("option");
      option.value = id;
      option.textContent = provider.name ? `${provider.name} (${id})` : id;
      modelEditProvider.appendChild(option);
    }
    if (
      current &&
      Array.from(modelEditProvider.options).some((o) => o.value === current)
    ) {
      modelEditProvider.value = current;
    } else if (modelEditProvider.options.length) {
      modelEditProvider.selectedIndex = 0;
    }
  }

  function openProviderEditModal(index, preset) {
    if (!providerEditModal) {
      return;
    }
    providerEditIndex = index;
    const isNew = index === -1;
    const provider = isNew
      ? preset || { id: "", name: "", baseUrl: "", apiKey: "" }
      : settingsProviders[index] || {
          id: "",
          name: "",
          baseUrl: "",
          apiKey: "",
        };
    if (providerEditTitle) {
      providerEditTitle.textContent = isNew ? "Новый провайдер" : "Провайдер";
    }
    if (providerEditId) {
      providerEditId.value = provider.id || "";
      providerEditId.readOnly = !isNew;
    }
    if (providerEditName) {
      providerEditName.value = provider.name || "";
    }
    if (providerEditBaseUrl) {
      providerEditBaseUrl.value = provider.baseUrl || "";
    }
    if (providerEditApiKey) {
      providerEditApiKey.value = provider.apiKey || "";
    }
    providerEditModal.hidden = false;
    (isNew ? providerEditId : providerEditName)?.focus();
  }

  function closeProviderEditModal() {
    if (!providerEditModal) {
      return;
    }
    providerEditModal.hidden = true;
    providerEditIndex = null;
  }

  function applyProviderEditModal() {
    const id = providerEditId ? providerEditId.value.trim() : "";
    const baseUrl = providerEditBaseUrl
      ? providerEditBaseUrl.value.trim().replace(/\/$/, "")
      : "";
    if (!id) {
      setProvidersHint("Укажите id провайдера.", true);
      providerEditId?.focus();
      return;
    }
    if (!baseUrl) {
      setProvidersHint("Укажите base URL.", true);
      providerEditBaseUrl?.focus();
      return;
    }
    const name = providerEditName ? providerEditName.value.trim() : "";
    const apiKey = providerEditApiKey ? providerEditApiKey.value : "";
    const next = { id, name: name || id, baseUrl, apiKey };

    if (providerEditIndex === -1) {
      if (settingsProviders.some((p) => p.id === id)) {
        setProvidersHint(`Провайдер «${id}» уже есть.`, true);
        return;
      }
      settingsProviders.push(next);
    } else if (
      Number.isFinite(providerEditIndex) &&
      providerEditIndex >= 0 &&
      providerEditIndex < settingsProviders.length
    ) {
      settingsProviders[providerEditIndex] = next;
    }
    closeProviderEditModal();
    setProvidersHint("");
    renderSettingsProviders();
    renderSettingsModels();
    fillModelProviderSelect(modelEditProvider?.value || "");
    schedulePersistSettings(0);
  }

  function renderSettingsProviders() {
    if (!settingsProvidersList) {
      return;
    }
    settingsProvidersList.innerHTML = "";
    if (!settingsProviders.length) {
      settingsProvidersList.innerHTML =
        '<div class="settings-models-empty">Нет провайдеров — добавьте хотя бы один.</div>';
      return;
    }
    settingsProviders.forEach((provider, index) => {
      const row = document.createElement("div");
      row.className = "settings-model-row";
      row.dataset.index = String(index);
      const title = provider.name || provider.id || "Провайдер";
      row.innerHTML =
        `<div class="settings-model-info">` +
        `<div class="settings-model-name"></div>` +
        `<div class="settings-model-id"></div>` +
        `</div>` +
        `<button type="button" class="icon-btn settings-provider-edit" data-index="${index}" title="Настройки" aria-label="Настройки">` +
        SETTINGS_ICON +
        `</button>` +
        `<button type="button" class="icon-btn settings-provider-remove" data-index="${index}" title="Удалить" aria-label="Удалить">` +
        DELETE_ICON +
        `</button>`;
      row.querySelector(".settings-model-name").textContent = title;
      row.querySelector(".settings-model-id").textContent =
        provider.baseUrl || provider.id || "";
      settingsProvidersList.appendChild(row);
    });
  }

  function setJsonHint(text, isError) {
    if (!settingsJsonHint) {
      return;
    }
    if (!text) {
      settingsJsonHint.hidden = true;
      settingsJsonHint.textContent = "";
      settingsJsonHint.classList.remove("is-error");
      return;
    }
    settingsJsonHint.hidden = false;
    settingsJsonHint.textContent = text;
    settingsJsonHint.classList.toggle("is-error", Boolean(isError));
  }

  function pickField(raw, keys) {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const entries = Object.entries(raw);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] != null) {
        return raw[key];
      }
    }
    const lowerMap = new Map(
      entries.map(([k, v]) => [String(k).toLowerCase(), v])
    );
    for (const key of keys) {
      const value = lowerMap.get(String(key).toLowerCase());
      if (value != null) {
        return value;
      }
    }
    return undefined;
  }

  function pickNestedField(raw, keys) {
    const direct = pickField(raw, keys);
    if (direct != null) {
      return direct;
    }
    const nestKeys = [
      "model_info",
      "modelInfo",
      "limits",
      "limit",
      "metadata",
      "meta",
      "config",
      "parameters",
      "params",
      "info",
      "capabilities",
    ];
    for (const nestKey of nestKeys) {
      const nested = pickField(raw, [nestKey]);
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const value = pickField(nested, keys);
        if (value != null) {
          return value;
        }
      }
    }
    return undefined;
  }

  function normalizeModelEntry(raw) {
    if (typeof raw === "string") {
      const id = raw.trim();
      return id ? { id, label: id } : null;
    }
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const id = String(
      pickField(raw, [
        "id",
        "model",
        "model_id",
        "modelId",
        "modelID",
        "slug",
        "value",
        "key",
      ]) || ""
    ).trim();
    if (!id) {
      return null;
    }

    const label = String(
      pickField(raw, [
        "label",
        "title",
        "name",
        "displayName",
        "display_name",
        "display",
        "text",
        "description",
      ]) || ""
    ).trim() || id;

    const contextRaw = pickNestedField(raw, [
      "contextWindow",
      "context_window",
      "contextLength",
      "context_length",
      "maxContext",
      "max_context",
      "maxContextTokens",
      "max_context_tokens",
      "max_input_tokens",
      "maxInputTokens",
      "max_input",
      "maxInput",
      "input_tokens",
      "inputTokens",
      "context",
      "tokens",
      "max_tokens",
      "maxTokens",
    ]);
    const outputRaw = pickNestedField(raw, [
      "maxOutputTokens",
      "max_output_tokens",
      "max_output",
      "maxOutput",
      "output_tokens",
      "outputTokens",
      "max_completion_tokens",
      "maxCompletionTokens",
      "completion_tokens",
      "completionTokens",
    ]);
    const contextWindow = Number(contextRaw);
    const maxOutputTokens = Number(outputRaw);
    const model = { id, label, enabled: true };
    if (Number.isFinite(contextWindow) && contextWindow >= 1024) {
      model.contextWindow = Math.floor(contextWindow);
    }
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      model.maxOutputTokens = Math.floor(maxOutputTokens);
    }
    return model;
  }

  function cloneModel(model) {
    return {
      id: model.id || "",
      label: model.label || "",
      providerId: model.providerId || "",
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      enabled: model.enabled !== false,
      favorite: model.favorite === true,
    };
  }

  function sortSettingsModels() {
    settingsModels.sort((a, b) => {
      const favA = a.favorite === true ? 0 : 1;
      const favB = b.favorite === true ? 0 : 1;
      if (favA !== favB) {
        return favA - favB;
      }
      const labelA = String(a.label || a.id || "").trim();
      const labelB = String(b.label || b.id || "").trim();
      const byLabel = labelA.localeCompare(labelB, "ru", {
        sensitivity: "base",
        numeric: true,
      });
      if (byLabel !== 0) {
        return byLabel;
      }
      return String(a.id || "").localeCompare(String(b.id || ""), "ru", {
        sensitivity: "base",
        numeric: true,
      });
    });
  }

  function upsertModels(incoming) {
    const byId = new Map();
    for (const model of settingsModels) {
      const id = String(model.id || "").trim();
      if (id) {
        byId.set(id, cloneModel(model));
      }
    }
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      const model = normalizeModelEntry(item);
      if (!model) {
        continue;
      }
      if (byId.has(model.id)) {
        const prev = byId.get(model.id);
        byId.set(model.id, {
          id: model.id,
          label: model.label || prev.label || model.id,
          providerId: prev.providerId || "",
          contextWindow:
            model.contextWindow || prev.contextWindow || undefined,
          maxOutputTokens:
            model.maxOutputTokens || prev.maxOutputTokens || undefined,
          enabled: prev.enabled !== false,
          favorite: prev.favorite === true,
        });
        updated += 1;
      } else {
        byId.set(model.id, cloneModel(model));
        added += 1;
      }
    }
    settingsModels = Array.from(byId.values());
    sortSettingsModels();
    renderSettingsModels();
    return { added, updated, total: settingsModels.filter((m) => m.id).length };
  }

  function looksLikeModelEntry(item) {
    if (typeof item === "string") {
      return Boolean(item.trim());
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    return Boolean(
      pickField(item, [
        "id",
        "model",
        "model_id",
        "modelId",
        "modelID",
        "slug",
        "value",
        "key",
        "name",
      ])
    );
  }

  function extractModelsList(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (looksLikeModelEntry(parsed)) {
      return [parsed];
    }

    const wrapperKeys = [
      "models",
      "data",
      "items",
      "results",
      "list",
      "model_list",
      "modelList",
      "available_models",
      "availableModels",
      "choices",
      "entries",
      "values",
      "records",
      "payload",
      "response",
      "body",
      "result",
    ];

    for (const key of wrapperKeys) {
      const value = pickField(parsed, [key]);
      if (Array.isArray(value)) {
        return value;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = extractModelsList(value);
        if (nested) {
          return nested;
        }
      }
    }

    for (const value of Object.values(parsed)) {
      if (!Array.isArray(value) || !value.length) {
        continue;
      }
      if (value.some(looksLikeModelEntry)) {
        return value;
      }
    }

    return null;
  }

  function parseModelsJson(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      throw new Error("Вставьте JSON со списком моделей.");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Некорректный JSON.");
    }
    const items = extractModelsList(parsed);
    if (!items) {
      throw new Error("В JSON не найден список моделей.");
    }
    return items;
  }

  function importModelsFromJson() {
    try {
      const items = parseModelsJson(settingsModelsJson?.value || "");
      const normalized = items
        .map((item) => normalizeModelEntry(item))
        .filter(Boolean);
      if (!normalized.length) {
        throw new Error("В JSON нет ни одной модели с id.");
      }
      const result = upsertModels(normalized);
      setJsonHint(
        `Готово: +${result.added}, обновлено ${result.updated}, всего ${result.total}.`
      );
      return true;
    } catch (error) {
      setJsonHint(error.message || "Не удалось импортировать.", true);
      return false;
    }
  }

  function exportModelsToJson() {
    const payload = settingsModels
      .filter((m) => String(m.id || "").trim())
      .map((m) => {
        const row = {
          id: m.id,
          label: m.label || m.id,
        };
        if (m.contextWindow) {
          row.contextWindow = m.contextWindow;
        }
        if (m.maxOutputTokens) {
          row.maxOutputTokens = m.maxOutputTokens;
        }
        return row;
      });
    const text = JSON.stringify(payload, null, 2);
    if (settingsModelsJson) {
      settingsModelsJson.value = text;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setJsonHint("Список скопирован в буфер."),
        () => setJsonHint("JSON заполнен в поле ниже.")
      );
    } else {
      setJsonHint("JSON заполнен в поле ниже.");
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
      if (!id || model.enabled === false) {
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
    } else {
      settingsDefaultModelId = "";
    }
  }

  function setModelEditMode(mode) {
    modelEditMode = mode === "json" ? "json" : "manual";
    if (modelEditTabs) {
      modelEditTabs.querySelectorAll("[data-model-mode]").forEach((btn) => {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-model-mode") === modelEditMode
        );
      });
    }
    if (modelEditManualPane) {
      modelEditManualPane.hidden = modelEditMode !== "manual";
    }
    if (modelEditJsonPane) {
      modelEditJsonPane.hidden = modelEditMode !== "json";
    }
    if (modelEditDoneBtn) {
      modelEditDoneBtn.textContent =
        modelEditMode === "json" ? "Применить" : "Готово";
    }
  }

  function openModelEditModal(index) {
    if (!modelEditModal) {
      return;
    }
    modelEditIndex = index;
    const isNew = index === -1;
    const model = isNew
      ? {
          id: "",
          label: "",
          providerId: "",
          contextWindow: undefined,
          maxOutputTokens: undefined,
        }
      : settingsModels[index] || { id: "", label: "", providerId: "" };
    if (modelEditTitle) {
      modelEditTitle.textContent = isNew ? "Добавить модели" : "Настройки модели";
    }
    if (modelEditTabs) {
      modelEditTabs.hidden = !isNew;
    }
    setModelEditMode("manual");
    setJsonHint("");
    if (modelEditId) {
      modelEditId.value = model.id || "";
    }
    if (modelEditLabel) {
      modelEditLabel.value = model.label || "";
    }
    fillModelProviderSelect(model.providerId || primaryProviderId());
    if (modelEditContext) {
      modelEditContext.value =
        model.contextWindow && Number(model.contextWindow) > 0
          ? String(model.contextWindow)
          : "";
    }
    if (modelEditOutput) {
      modelEditOutput.value =
        model.maxOutputTokens && Number(model.maxOutputTokens) > 0
          ? String(model.maxOutputTokens)
          : "";
    }
    if (isNew && settingsModelsJson && !settingsModelsJson.value.trim()) {
      settingsModelsJson.value = "";
    }
    modelEditModal.hidden = false;
    if (isNew) {
      modelEditId?.focus();
    } else {
      modelEditId?.focus();
    }
  }

  function closeModelEditModal() {
    if (!modelEditModal) {
      return;
    }
    modelEditModal.hidden = true;
    modelEditIndex = null;
    setModelEditMode("manual");
    setJsonHint("");
  }

  function applyModelEditModal() {
    if (modelEditIndex === -1 && modelEditMode === "json") {
      if (importModelsFromJson()) {
        closeModelEditModal();
        setModelsHint("Модели из JSON добавлены.");
        schedulePersistSettings(0);
      }
      return;
    }

    const id = modelEditId ? modelEditId.value.trim() : "";
    if (!id) {
      setModelsHint("Укажите id модели.", true);
      setModelEditMode("manual");
      modelEditId?.focus();
      return;
    }
    const label = modelEditLabel ? modelEditLabel.value.trim() : "";
    const providerId = modelEditProvider ? modelEditProvider.value.trim() : "";
    if (!providerId) {
      setModelsHint("Выберите провайдера (или сначала добавьте его).", true);
      setModelEditMode("manual");
      modelEditProvider?.focus();
      return;
    }
    const contextWindow = Number(modelEditContext?.value);
    const maxOutputTokens = Number(modelEditOutput?.value);
    const next = {
      id,
      label: label || id,
      providerId,
      enabled: true,
    };
    if (Number.isFinite(contextWindow) && contextWindow >= 1024) {
      next.contextWindow = Math.floor(contextWindow);
    }
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      next.maxOutputTokens = Math.floor(maxOutputTokens);
    }

    if (modelEditIndex === -1) {
      const existing = settingsModels.findIndex((m) => m.id === id);
      if (existing >= 0) {
        const prev = settingsModels[existing];
        settingsModels[existing] = {
          ...next,
          enabled: prev.enabled !== false,
          favorite: prev.favorite === true,
        };
      } else {
        settingsModels.push(next);
      }
    } else if (
      Number.isFinite(modelEditIndex) &&
      modelEditIndex >= 0 &&
      modelEditIndex < settingsModels.length
    ) {
      const prev = settingsModels[modelEditIndex];
      const duplicate = settingsModels.findIndex(
        (m, i) => i !== modelEditIndex && m.id === id
      );
      if (duplicate >= 0) {
        setModelsHint(`Модель с id «${id}» уже есть.`, true);
        return;
      }
      settingsModels[modelEditIndex] = {
        ...next,
        enabled: prev.enabled !== false,
        favorite: prev.favorite === true,
      };
    }
    closeModelEditModal();
    setModelsHint("");
    sortSettingsModels();
    renderSettingsModels();
    schedulePersistSettings(0);
  }

  function formatModelTokens(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return "—";
    }
    return Math.floor(n).toLocaleString("ru-RU");
  }

  function ensureSettingsModelTip() {
    if (settingsModelTipEl) {
      return settingsModelTipEl;
    }
    settingsModelTipEl = document.createElement("div");
    settingsModelTipEl.className = "settings-model-tip";
    settingsModelTipEl.hidden = true;
    settingsModelTipEl.setAttribute("role", "tooltip");
    const labels = [
      "ID",
      "Название",
      "Провайдер",
      "Контекст (вход)",
      "Ответ (выход)",
      "Статус",
      "Избранное",
    ];
    settingsModelTipRows = labels.map((label) => {
      const line = document.createElement("div");
      line.className = "settings-model-tip-row";
      const key = document.createElement("span");
      key.className = "settings-model-tip-key";
      key.textContent = label;
      const val = document.createElement("span");
      val.className = "settings-model-tip-val";
      line.appendChild(key);
      line.appendChild(val);
      settingsModelTipEl.appendChild(line);
      return val;
    });
    document.body.appendChild(settingsModelTipEl);
    return settingsModelTipEl;
  }

  function hideSettingsModelTip() {
    if (settingsModelTipHideTimer) {
      clearTimeout(settingsModelTipHideTimer);
      settingsModelTipHideTimer = null;
    }
    settingsModelTipIndex = null;
    if (settingsModelTipEl) {
      settingsModelTipEl.hidden = true;
    }
  }

  function fillSettingsModelTip(model) {
    const vals = [
      model.id || "—",
      model.label || model.id || "—",
      providerLabel(model.providerId),
      formatModelTokens(model.contextWindow),
      formatModelTokens(model.maxOutputTokens),
      model.enabled !== false ? "Включена" : "Выключена",
      model.favorite === true ? "Да" : "Нет",
    ];
    ensureSettingsModelTip();
    for (let i = 0; i < settingsModelTipRows.length; i += 1) {
      settingsModelTipRows[i].textContent = vals[i];
    }
  }

  function positionSettingsModelTip(anchor) {
    const tip = ensureSettingsModelTip();
    if (!anchor || tip.hidden) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const tipWidth = tip.offsetWidth || 220;
    const tipHeight = tip.offsetHeight || 120;
    let left = rect.left;
    if (left + tipWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - tipWidth - margin);
    }
    let top = rect.bottom + 6;
    if (top + tipHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - tipHeight - 6);
    }
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function showSettingsModelTip(anchor, model, index) {
    if (!anchor || !model) {
      return;
    }
    if (settingsModelTipHideTimer) {
      clearTimeout(settingsModelTipHideTimer);
      settingsModelTipHideTimer = null;
    }
    const tip = ensureSettingsModelTip();
    if (settingsModelTipIndex !== index) {
      fillSettingsModelTip(model);
      settingsModelTipIndex = index;
    }
    tip.hidden = false;
    positionSettingsModelTip(anchor);
  }

  function scheduleHideSettingsModelTip() {
    if (settingsModelTipHideTimer) {
      clearTimeout(settingsModelTipHideTimer);
    }
    settingsModelTipHideTimer = setTimeout(() => {
      settingsModelTipHideTimer = null;
      hideSettingsModelTip();
    }, 40);
  }

  function renderSettingsModels() {
    if (!settingsModelsList) {
      return;
    }
    hideSettingsModelTip();
    sortSettingsModels();
    settingsModelsList.innerHTML = "";
    if (!settingsModels.length) {
      settingsModelsList.innerHTML =
        '<div class="settings-models-empty">Список пуст — добавьте модель.</div>';
      syncDefaultModelSelect();
      return;
    }
    settingsModels.forEach((model, index) => {
      const row = document.createElement("div");
      const enabled = model.enabled !== false;
      const favorite = model.favorite === true;
      row.className =
        "settings-model-row" + (enabled ? "" : " is-disabled");
      row.dataset.index = String(index);
      const title = model.label || model.id || "Без id";
      const parts = [];
      if (model.label && model.id && model.label !== model.id) {
        parts.push(model.id);
      }
      parts.push(providerLabel(model.providerId));
      const subtitle = parts.join(" · ");
      row.innerHTML =
        `<label class="settings-model-switch" title="${enabled ? "Выключить" : "Включить"}">` +
        `<input type="checkbox" class="settings-model-toggle" data-index="${index}" ${
          enabled ? "checked" : ""
        } />` +
        `<span class="settings-model-switch-ui" aria-hidden="true"></span>` +
        `</label>` +
        `<div class="settings-model-info">` +
        `<div class="settings-model-title">` +
        `<div class="settings-model-name"></div>` +
        `<button type="button" class="icon-btn settings-model-info-btn" data-index="${index}" title="Параметры модели" aria-label="Параметры модели">` +
        INFO_ICON +
        `</button>` +
        `</div>` +
        `<div class="settings-model-id"></div>` +
        `</div>` +
        `<button type="button" class="icon-btn settings-model-fav${
          favorite ? " is-on" : ""
        }" data-index="${index}" title="${
          favorite ? "Убрать из избранного" : "В избранное"
        }" aria-label="${
          favorite ? "Убрать из избранного" : "В избранное"
        }" aria-pressed="${favorite ? "true" : "false"}">` +
        HEART_ICON +
        `</button>` +
        `<button type="button" class="icon-btn settings-model-edit" data-index="${index}" title="Настройки" aria-label="Настройки">` +
        SETTINGS_ICON +
        `</button>` +
        `<button type="button" class="icon-btn settings-model-remove" data-index="${index}" title="Удалить" aria-label="Удалить">` +
        DELETE_ICON +
        `</button>`;
      row.querySelector(".settings-model-name").textContent = title;
      row.querySelector(".settings-model-id").textContent = subtitle;
      settingsModelsList.appendChild(row);
    });
    syncDefaultModelSelect();
  }

  function readModelsFromDom() {
    return settingsModels
      .map((m) => cloneModel(m))
      .filter((m) => String(m.id || "").trim());
  }

  function showSettingsSaved() {
    if (!settingsSaveStatus) {
      return;
    }
    settingsSaveStatus.hidden = false;
    if (settingsSaveStatusTimer) {
      clearTimeout(settingsSaveStatusTimer);
    }
    settingsSaveStatusTimer = setTimeout(() => {
      settingsSaveStatus.hidden = true;
    }, 1200);
  }

  function persistSettingsNow() {
    if (settingsHydrating) {
      return;
    }
    vscode.postMessage({
      type: "saveSettings",
      settings: collectSettings(),
    });
    showSettingsSaved();
  }

  function schedulePersistSettings(delayMs) {
    if (settingsHydrating) {
      return;
    }
    if (settingsSaveTimer) {
      clearTimeout(settingsSaveTimer);
    }
    settingsSaveTimer = setTimeout(() => {
      settingsSaveTimer = null;
      persistSettingsNow();
    }, typeof delayMs === "number" ? delayMs : 450);
  }

  function fillSettings(settings) {
    if (!settings || typeof settings !== "object") {
      return;
    }
    settingsHydrating = true;
    try {
    settingsProviders = Array.isArray(settings.providers)
      ? settings.providers.map((p) => ({
          id: p.id || "",
          name: p.name || "",
          baseUrl: p.baseUrl || "",
          apiKey: p.apiKey || "",
        }))
      : [];
    if (
      !settingsProviders.length &&
      (settings.baseUrl || settings.apiKey)
    ) {
      settingsProviders.push({
        id: "default",
        name: "Основной",
        baseUrl: String(settings.baseUrl || "").replace(/\/$/, ""),
        apiKey: settings.apiKey || "",
      });
    }
    const primaryId = primaryProviderId();
    settingsModels = Array.isArray(settings.models)
      ? settings.models.map((m) => ({
          id: m.id || "",
          label: m.label || "",
          providerId: m.providerId || primaryId,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          enabled: m.enabled !== false,
          favorite: m.favorite === true,
        }))
      : [];
    settingsDefaultModelId = settings.defaultModel || "";
    settingsDefaultContextWindow =
      Number(settings.defaultContextWindow) > 0
        ? Number(settings.defaultContextWindow)
        : 128000;
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
    closeModelEditModal();
    closeProviderEditModal();
    renderSettingsProviders();
    renderSettingsModels();
    } finally {
      settingsHydrating = false;
    }
  }

  function collectSettings() {
    const providers = settingsProviders
      .map((p) => cloneProvider(p))
      .filter((p) => String(p.id || "").trim() && String(p.baseUrl || "").trim())
      .map((p) => {
        const row = {
          id: p.id,
          baseUrl: String(p.baseUrl || "").replace(/\/$/, ""),
        };
        if (p.name) {
          row.name = p.name;
        }
        if (p.apiKey) {
          row.apiKey = p.apiKey;
        }
        return row;
      });

    const models = readModelsFromDom().map((m) => {
      const row = {
        id: m.id,
        label: m.label || m.id,
        providerId: m.providerId || primaryProviderId(),
        enabled: m.enabled !== false,
      };
      if (m.contextWindow) {
        row.contextWindow = m.contextWindow;
      }
      if (m.maxOutputTokens) {
        row.maxOutputTokens = m.maxOutputTokens;
      }
      if (row.enabled) {
        delete row.enabled;
      } else {
        row.enabled = false;
      }
      if (m.favorite === true) {
        row.favorite = true;
      }
      return row;
    });
    const primary =
      settingsProviders.find((p) => p.id === "default") ||
      settingsProviders[0];
    return {
      providers,
      models,
      defaultModel: settingsDefaultModel
        ? settingsDefaultModel.value
        : settingsDefaultModelId,
      defaultContextWindow: settingsDefaultContextWindow,
      baseUrl: primary ? String(primary.baseUrl || "").replace(/\/$/, "") : "",
      apiKey: primary ? primary.apiKey || "" : "",
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

      if (model.favorite === true) {
        const heart = document.createElement("span");
        heart.className = "model-option-fav";
        heart.innerHTML = HEART_ICON;
        heart.setAttribute("aria-hidden", "true");
        btn.appendChild(heart);
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

  const settingsBody = document.getElementById("settingsBody");
  if (settingsBody) {
    settingsBody.addEventListener("scroll", hideSettingsModelTip, { passive: true });
    settingsBody.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest(
          "#settingsCaBundle, #settingsSystemPrompt, #settingsMaxToolRounds, #settingsMaxTokens, #settingsMaxResponseChars"
        )
      ) {
        schedulePersistSettings();
      }
    });
    settingsBody.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.closest("#settingsRejectUnauthorized")) {
        persistSettingsNow();
      }
    });
  }

  if (addModelBtn) {
    addModelBtn.addEventListener("click", () => {
      setModelsHint("");
      openModelEditModal(-1);
    });
  }

  if (addProviderBtn) {
    addProviderBtn.addEventListener("click", () => {
      setProvidersHint("");
      openProviderEditModal(-1);
    });
  }

  if (settingsProvidersList) {
    settingsProvidersList.addEventListener("click", (event) => {
      const editBtn = event.target.closest(".settings-provider-edit");
      if (editBtn) {
        const index = Number(editBtn.dataset.index);
        if (Number.isFinite(index)) {
          openProviderEditModal(index);
        }
        return;
      }
      const removeBtn = event.target.closest(".settings-provider-remove");
      if (!removeBtn) {
        return;
      }
      const index = Number(removeBtn.dataset.index);
      if (
        Number.isFinite(index) &&
        index >= 0 &&
        index < settingsProviders.length
      ) {
        const removedId = settingsProviders[index].id;
        settingsProviders.splice(index, 1);
        const fallback = primaryProviderId();
        for (const model of settingsModels) {
          if (model.providerId === removedId) {
            model.providerId = fallback;
          }
        }
        renderSettingsProviders();
        renderSettingsModels();
        fillModelProviderSelect(modelEditProvider?.value || fallback);
        schedulePersistSettings(0);
      }
    });
  }

  if (importModelsJsonBtn) {
    importModelsJsonBtn.addEventListener("click", () => {
      if (importModelsFromJson()) {
        schedulePersistSettings(0);
      }
    });
  }

  if (exportModelsJsonBtn) {
    exportModelsJsonBtn.addEventListener("click", () => {
      exportModelsToJson();
    });
  }

  if (modelEditTabs) {
    modelEditTabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-model-mode]");
      if (!tab) {
        return;
      }
      setModelEditMode(tab.getAttribute("data-model-mode"));
      if (modelEditMode === "json") {
        settingsModelsJson?.focus();
      } else {
        modelEditId?.focus();
      }
    });
  }

  if (settingsModelsList) {
    settingsModelsList.addEventListener("pointerover", (event) => {
      const btn = event.target.closest(".settings-model-info-btn");
      if (!btn || !settingsModelsList.contains(btn)) {
        return;
      }
      const related = event.relatedTarget;
      if (related instanceof Node && btn.contains(related)) {
        return;
      }
      const index = Number(btn.dataset.index);
      if (!Number.isFinite(index) || !settingsModels[index]) {
        return;
      }
      showSettingsModelTip(btn, settingsModels[index], index);
    });
    settingsModelsList.addEventListener("pointerout", (event) => {
      const btn = event.target.closest(".settings-model-info-btn");
      if (!btn || !settingsModelsList.contains(btn)) {
        return;
      }
      const related = event.relatedTarget;
      if (related instanceof Node && btn.contains(related)) {
        return;
      }
      scheduleHideSettingsModelTip();
    });
    settingsModelsList.addEventListener("focusin", (event) => {
      const btn = event.target.closest(".settings-model-info-btn");
      if (!btn || !settingsModelsList.contains(btn)) {
        return;
      }
      const index = Number(btn.dataset.index);
      if (!Number.isFinite(index) || !settingsModels[index]) {
        return;
      }
      showSettingsModelTip(btn, settingsModels[index], index);
    });
    settingsModelsList.addEventListener("focusout", (event) => {
      const btn = event.target.closest(".settings-model-info-btn");
      if (!btn || !settingsModelsList.contains(btn)) {
        return;
      }
      scheduleHideSettingsModelTip();
    });
    settingsModelsList.addEventListener("scroll", hideSettingsModelTip, true);
    settingsModelsList.addEventListener("click", (event) => {
      const favBtn = event.target.closest(".settings-model-fav");
      if (favBtn) {
        const index = Number(favBtn.dataset.index);
        if (Number.isFinite(index) && settingsModels[index]) {
          settingsModels[index].favorite = settingsModels[index].favorite !== true;
          renderSettingsModels();
          schedulePersistSettings(0);
        }
        return;
      }
      const editBtn = event.target.closest(".settings-model-edit");
      if (editBtn) {
        hideSettingsModelTip();
        const index = Number(editBtn.dataset.index);
        if (Number.isFinite(index)) {
          openModelEditModal(index);
        }
        return;
      }
      const removeBtn = event.target.closest(".settings-model-remove");
      if (!removeBtn) {
        return;
      }
      const index = Number(removeBtn.dataset.index);
      if (Number.isFinite(index) && index >= 0 && index < settingsModels.length) {
        settingsModels.splice(index, 1);
        renderSettingsModels();
        schedulePersistSettings(0);
      }
    });
    settingsModelsList.addEventListener("change", (event) => {
      const toggle = event.target.closest(".settings-model-toggle");
      if (!toggle) {
        return;
      }
      const index = Number(toggle.dataset.index);
      if (Number.isFinite(index) && settingsModels[index]) {
        settingsModels[index].enabled = Boolean(toggle.checked);
        renderSettingsModels();
        schedulePersistSettings(0);
      }
    });
  }

  window.addEventListener("resize", hideSettingsModelTip);

  function bindModelModalDismiss(el) {
    if (!el) {
      return;
    }
    el.addEventListener("click", () => {
      closeModelEditModal();
    });
  }

  bindModelModalDismiss(modelEditCloseBtn);
  bindModelModalDismiss(modelEditCancelBtn);

  if (modelEditDoneBtn) {
    modelEditDoneBtn.addEventListener("click", () => {
      applyModelEditModal();
    });
  }

  if (modelEditModal) {
    modelEditModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-modal-dismiss]")) {
        closeModelEditModal();
      }
    });
    modelEditModal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModelEditModal();
        return;
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
        const tag = event.target instanceof HTMLElement ? event.target.tagName : "";
        if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") {
          return;
        }
        event.preventDefault();
        applyModelEditModal();
      }
    });
  }

  function bindProviderModalDismiss(el) {
    if (!el) {
      return;
    }
    el.addEventListener("click", () => {
      closeProviderEditModal();
    });
  }

  bindProviderModalDismiss(providerEditCloseBtn);
  bindProviderModalDismiss(providerEditCancelBtn);

  if (providerEditDoneBtn) {
    providerEditDoneBtn.addEventListener("click", () => {
      applyProviderEditModal();
    });
  }

  if (providerEditModal) {
    providerEditModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-provider-dismiss]")) {
        closeProviderEditModal();
      }
    });
    providerEditModal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeProviderEditModal();
        return;
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
        const tag = event.target instanceof HTMLElement ? event.target.tagName : "";
        if (tag === "TEXTAREA" || tag === "BUTTON") {
          return;
        }
        event.preventDefault();
        applyProviderEditModal();
      }
    });
  }

  if (settingsDefaultModel) {
    settingsDefaultModel.addEventListener("change", () => {
      settingsDefaultModelId = settingsDefaultModel.value;
      schedulePersistSettings(0);
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

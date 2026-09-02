(function () {
  try {
  const F = window.__harborFigma;
  const Turn = window.__harborFigmaTurn;
  const Md = window.__harborFigmaMd;
  if (!F || !Turn || !Md) {
    document.body.innerHTML =
      "<pre style='padding:16px;color:#c00;font:13px monospace'>Harbor UI failed to init (bridge/turn/markdown missing). Rebuild: npm run build:figma</pre>";
    return;
  }
  const host = F.host;

  const ICON = {
    settings:
      '<span class="material-symbols-outlined" aria-hidden="true">settings</span>',
    delete:
      '<span class="material-symbols-outlined" aria-hidden="true">delete</span>',
  };

  const els = {
    workspaceShell: document.getElementById("workspaceShell"),
    agentsRailBackdrop: document.getElementById("agentsRailBackdrop"),
    agentsScreen: document.getElementById("agentsScreen"),
    chatScreen: document.getElementById("chatScreen"),
    settingsScreen: document.getElementById("settingsScreen"),
    agentsList: document.getElementById("agentsList"),
    messages: document.getElementById("messages"),
    prompt: document.getElementById("prompt"),
    sendBtn: document.getElementById("sendBtn"),
    modeLabel: document.getElementById("modeLabel"),
    modeMenu: document.getElementById("modeMenu"),
    modeTrigger: document.getElementById("modeTrigger"),
    modePicker: document.getElementById("modePicker"),
    modelLabel: document.getElementById("modelLabel"),
    modelMenu: document.getElementById("modelMenu"),
    modelTrigger: document.getElementById("modelTrigger"),
    chatAgentName: document.getElementById("chatAgentName"),
    selectionPreview: document.getElementById("selectionPreview"),
    selectionThumb: document.getElementById("selectionThumb"),
    selectionMeta: document.getElementById("selectionMeta"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    toggleAgentsRailBtn: document.getElementById("toggleAgentsRailBtn"),
    newAgentBtn: document.getElementById("newAgentBtn"),
    settingsProvidersModelsList: document.getElementById(
      "settingsProvidersModelsList"
    ),
    settingsNav: document.getElementById("settingsNav"),
    settingsSaveStatus: document.getElementById("settingsSaveStatus"),
    addProviderBtn: document.getElementById("addProviderBtn"),
    addModelBtn: document.getElementById("addModelBtn"),
    langSelect: document.getElementById("langSelect"),
    fontSizeRange: document.getElementById("fontSizeRange"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    fontPreview: document.getElementById("fontPreview"),
    settingsRejectUnauthorized: document.getElementById(
      "settingsRejectUnauthorized"
    ),
    statusLine: document.getElementById("statusLine"),
    hostStatusRow: document.getElementById("hostStatusRow"),
    hostStatusDot: document.getElementById("hostStatusDot"),
    hostStatusLabel: document.getElementById("hostStatusLabel"),
    providerEditModal: document.getElementById("providerEditModal"),
    providerEditTitle: document.getElementById("providerEditTitle"),
    providerEditName: document.getElementById("providerEditName"),
    providerEditBaseUrl: document.getElementById("providerEditBaseUrl"),
    providerEditApiKey: document.getElementById("providerEditApiKey"),
    providerEditPromptCache: document.getElementById("providerEditPromptCache"),
    providerEditCloseBtn: document.getElementById("providerEditCloseBtn"),
    providerEditCancelBtn: document.getElementById("providerEditCancelBtn"),
    providerEditDoneBtn: document.getElementById("providerEditDoneBtn"),
    modelEditModal: document.getElementById("modelEditModal"),
    modelEditTitle: document.getElementById("modelEditTitle"),
    modelEditProvider: document.getElementById("modelEditProvider"),
    modelEditId: document.getElementById("modelEditId"),
    modelEditLabel: document.getElementById("modelEditLabel"),
    modelEditVision: document.getElementById("modelEditVision"),
    modelEditCloseBtn: document.getElementById("modelEditCloseBtn"),
    modelEditCancelBtn: document.getElementById("modelEditCancelBtn"),
    modelEditDoneBtn: document.getElementById("modelEditDoneBtn"),
    panelResizeHandle: document.getElementById("panelResizeHandle"),
  };

  const PANEL_MIN_W = 320;
  const PANEL_MIN_H = 400;
  const PANEL_MAX_W = 1200;
  const PANEL_MAX_H = 1000;
  const PANEL_DEFAULT_W = 520;
  const PANEL_DEFAULT_H = 820;

  /** @type {{ width: number, height: number }} */
  let panelSize = { width: PANEL_DEFAULT_W, height: PANEL_DEFAULT_H };
  /** @type {{ x: number, y: number, width: number, height: number } | null} */
  let panelResizeDrag = null;

  /** @type {{ providers: any[], models: any[], language: string, fontSize: number, rejectUnauthorized: boolean }} */
  let settings = {
    providers: [],
    models: [],
    language: "en",
    fontSize: 13,
    rejectUnauthorized: true,
  };

  /** @type {{ agents: any[], activeAgentId: string|null }} */
  let session = { agents: [], activeAgentId: null };

  /** @type {any} */
  let selection = null;
  let mode = "agent";
  let selectedModelId = "";
  /** agentId → AbortController for in-flight turns (chats run independently). */
  const runningByAgentId = new Map();
  let lastAssistantText = "";
  /** @type {number|null} */
  let providerEditIndex = null;
  /** @type {number|null} */
  let modelEditIndex = null;
  let saveStatusTimer = 0;
  /** Cache preview PNG by primaryNodeId to avoid re-generation. */
  const previewCache = new Map();
  let agentsRailOpen = false;
  let currentScreen = "chat";
  /**
   * Pending canvas selection — captured while the active chat is running.
   * Applied to the chat when the run finishes, so the user's latest click
   * is not lost but also does not interrupt the running turn.
   */
  let pendingCanvasSelection = null;

  const i18n = {
    en: {
      agents: "Agents",
      settings: "Settings",
      newAgent: "New chat",
      agent: "Agent",
      ask: "Ask",
      plan: "Plan",
      send: "Send",
      stop: "Stop",
      focusSelection: "Focus on canvas",
      toolRunning: "Running…",
      runWorking: "Running",
      runDone: "Done",
      toolStepsCount: "{n} steps",
      runTiming: "{ttft} → {total}",
      promptCache: "Prompt cache (LiteLLM / OpenRouter / Claude)",
      promptCacheHint:
        "Speeds up follow-ups. Leave off for strict OpenAI (api.openai.com).",
      advanced: "Advanced",
      validateTls: "Validate TLS certificate",
      validateTlsHint:
        "Turn off for corporate LiteLLM / proxy gateways with a self-signed MITM certificate.",
      toolOk: "Done",
      toolError: "Failed",
      canvasReadOnly: "Dev Mode — canvas writes unavailable",
      showAgentsList: "Show agents",
      hideAgentsList: "Hide agents",
      modelsProviders: "Models & providers",
      providersNote:
        "Base URL and API key for each OpenAI-compatible API. Models are grouped under their provider.",
      language: "Language",
      appearance: "Appearance",
      appearanceNote:
        "Chat text and composer size. Drag the grip in the bottom-right corner to resize the plugin window.",
      pluginUiLanguage: "Plugin UI language",
      fontSize: "Font size",
      fontSizeHint: "Applies to messages and the input field.",
      fontPreview: "The agent will reply at this size.",
      cancel: "Cancel",
      done: "Done",
      addProvider: "+ Provider",
      addModel: "+ Model",
      noSelection: "Select a frame or node",
      selectionCount: "{n} selected",
      placeholder: "Task for the design agent…",
      placeholderAgent: "Task for the design agent…",
      placeholderPlan: "Describe the task — draft a plan without canvas edits…",
      placeholderAsk: "Ask about the selection…",
      emptyChat: "Select a frame, then ask a design question.",
      saved: "Saved",
      needSettings: "Add a provider and model in Settings.",
      openSettingsCta: "Open Settings",
      setupHint: "Add an OpenAI-compatible provider and a model to start.",
      noProvidersOrModels: "No providers or models yet.",
      otherProvider: "Other",
      providerTitle: "Provider",
      newProvider: "New provider",
      modelTitle: "Model",
      newModel: "New model",
      delete: "Delete",
      noAgentsYet: "No chats yet.",
      supportsVision: "Supports images (vision)",
      hostOnline: "Cline host online",
      hostOffline: "Cline host offline",
      hostOfflineHint:
        "Open Harbor Agents in VS Code (auto-starts host) or run: npm run figma:host:install",
      emptyTurnError:
        "Empty response from the model (no text, no tools). Try again or switch model in Settings.",
      providerParamError:
        "Provider error «Param Incorrect» — usually wrong model id or base URL for MiMo/Xiaomi. " +
        "In Settings check that model slug matches the provider docs (e.g. mimo-v2.5-pro on the token-plan URL). " +
        "Follow-up turns now restart without tool history; retry the message.",
    },
    ru: {
      agents: "Агенты",
      settings: "Настройки",
      newAgent: "Новый чат",
      agent: "Агент",
      ask: "Спросить",
      plan: "План",
      send: "Отправить",
      stop: "Стоп",
      focusSelection: "Показать на макете",
      toolRunning: "Выполняется…",
      runWorking: "выполняю",
      runDone: "выполнено",
      toolStepsCount: "{n} шагов",
      runTiming: "{ttft} → {total}",
      promptCache: "Prompt cache (LiteLLM / OpenRouter / Claude)",
      promptCacheHint:
        "Ускоряет follow-up. Выключите для чистого OpenAI (api.openai.com).",
      advanced: "Дополнительно",
      validateTls: "Проверять TLS-сертификат",
      validateTlsHint:
        "Выключите для корпоративного LiteLLM / прокси с self-signed MITM-сертификатом.",
      toolOk: "Готово",
      toolError: "Ошибка",
      canvasReadOnly: "Dev Mode — правки canvas недоступны",
      showAgentsList: "Показать агентов",
      hideAgentsList: "Скрыть агентов",
      modelsProviders: "Модели и провайдеры",
      providersNote:
        "Base URL и API-ключ для каждого OpenAI-compatible API. Модели сгруппированы под провайдером.",
      language: "Язык",
      appearance: "Оформление",
      appearanceNote:
        "Размер текста чата и поля ввода. Потяните за угол внизу справа, чтобы изменить размер окна плагина.",
      pluginUiLanguage: "Язык интерфейса плагина",
      fontSize: "Размер шрифта",
      fontSizeHint: "Действует на сообщения и поле ввода.",
      fontPreview: "Агент ответит таким размером.",
      cancel: "Отмена",
      done: "Готово",
      addProvider: "+ Провайдер",
      addModel: "+ Модель",
      noSelection: "Выберите фрейм или ноду",
      selectionCount: "Выделено: {n}",
      placeholder: "Задача для дизайн-агента…",
      placeholderAgent: "Задача для дизайн-агента…",
      placeholderPlan: "Опишите задачу — составим план без правок canvas…",
      placeholderAsk: "Вопрос по выделению…",
      emptyChat: "Выберите фрейм и задайте вопрос по дизайну.",
      saved: "Сохранено",
      needSettings: "Добавьте провайдера и модель в Настройках.",
      openSettingsCta: "Открыть настройки",
      setupHint: "Добавьте OpenAI-compatible провайдера и модель, чтобы начать.",
      noProvidersOrModels: "Пока нет провайдеров и моделей.",
      otherProvider: "Другое",
      providerTitle: "Провайдер",
      newProvider: "Новый провайдер",
      modelTitle: "Модель",
      newModel: "Новая модель",
      delete: "Удалить",
      noAgentsYet: "Пока нет чатов.",
      supportsVision: "Поддержка изображений (vision)",
      hostOnline: "Cline host online",
      hostOffline: "Cline host offline",
      hostOfflineHint:
        "Откройте Harbor Agents в VS Code (хост запустится автоматически) или: npm run figma:host:install",
      emptyTurnError:
        "Пустой ответ модели (нет текста и tools). Повторите или смените модель в Настройках.",
      providerParamError:
        "Ошибка провайдера «Param Incorrect» — обычно неверный model id или base URL для MiMo/Xiaomi. " +
        "В Настройках проверьте slug модели по документации провайдера (например mimo-v2.5-pro на token-plan URL). " +
        "Повторная попытка теперь без истории инструментов; отправьте сообщение ещё раз.",
    },
  };

  function clampPanelSize(width, height) {
    return {
      width: Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, width | 0)),
      height: Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, height | 0)),
    };
  }

  function applyPanelSize(width, height, persist) {
    panelSize = clampPanelSize(width, height);
    F.resizePanel(panelSize.width, panelSize.height);
    if (persist) {
      void F.storageSet(F.STORAGE_UI, panelSize);
    }
  }

  function bindPanelResizeHandle() {
    const handle = els.panelResizeHandle;
    if (!handle) return;

    handle.addEventListener("mousedown", function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      panelResizeDrag = {
        x: event.clientX,
        y: event.clientY,
        width: panelSize.width,
        height: panelSize.height,
      };
      handle.classList.add("is-dragging");
      document.body.style.cursor = "nwse-resize";
    });

    window.addEventListener("mousemove", function (event) {
      if (!panelResizeDrag) return;
      applyPanelSize(
        panelResizeDrag.width + (event.clientX - panelResizeDrag.x),
        panelResizeDrag.height + (event.clientY - panelResizeDrag.y),
        false
      );
    });

    window.addEventListener("mouseup", function () {
      if (!panelResizeDrag) return;
      panelResizeDrag = null;
      handle.classList.remove("is-dragging");
      document.body.style.cursor = "";
      void F.storageSet(F.STORAGE_UI, panelSize);
    });
  }

  function t(key) {
    const lang = settings.language === "ru" ? "ru" : "en";
    return (i18n[lang] && i18n[lang][key]) || i18n.en[key] || key;
  }

  function normalizeMode(value) {
    if (value === "plan" || value === "ask" || value === "agent") return value;
    return "agent";
  }

  function modeLabelText(m) {
    if (m === "plan") return t("plan");
    if (m === "ask") return t("ask");
    return t("agent");
  }

  function modePlaceholder(m) {
    if (m === "plan") return t("placeholderPlan");
    if (m === "ask") return t("placeholderAsk");
    return t("placeholderAgent");
  }

  function setStatus(text) {
    if (els.statusLine) els.statusLine.textContent = text || "";
  }

  /** @type {"unknown"|"online"|"offline"} */
  let sidecarHealthState = "unknown";

  function renderHostStatus() {
    if (!els.hostStatusRow || !els.hostStatusLabel) return;
    els.hostStatusRow.classList.remove("is-online", "is-offline");
    if (sidecarHealthState === "online") {
      els.hostStatusRow.classList.add("is-online");
      els.hostStatusLabel.textContent = t("hostOnline");
    } else if (sidecarHealthState === "offline") {
      els.hostStatusRow.classList.add("is-offline");
      els.hostStatusLabel.textContent =
        t("hostOffline") + " — " + t("hostOfflineHint");
    } else {
      els.hostStatusLabel.textContent = "";
    }
  }

  async function refreshSidecarHealth() {
    try {
      var Sidecar =
        typeof window !== "undefined" && window.__harborFigmaSidecar
          ? window.__harborFigmaSidecar
          : null;
      if (!Sidecar || typeof Sidecar.checkSidecarHealth !== "function") {
        sidecarHealthState = "unknown";
        renderHostStatus();
        return false;
      }
      var health = await Sidecar.checkSidecarHealth(settings);
      sidecarHealthState = health.ok ? "online" : "offline";
      renderHostStatus();
      return health.ok;
    } catch (_e) {
      sidecarHealthState = "offline";
      renderHostStatus();
      return false;
    }
  }

  function flashSaved() {
    if (!els.settingsSaveStatus) return;
    els.settingsSaveStatus.textContent = t("saved");
    els.settingsSaveStatus.hidden = false;
    window.clearTimeout(saveStatusTimer);
    saveStatusTimer = window.setTimeout(function () {
      if (els.settingsSaveStatus) els.settingsSaveStatus.hidden = true;
    }, 1600);
  }

  function applyChrome() {
    document.documentElement.style.setProperty(
      "--harbor-font-size",
      (settings.fontSize || 13) + "px"
    );
    if (els.prompt) els.prompt.placeholder = modePlaceholder(mode);
    if (els.modeLabel) {
      els.modeLabel.textContent = modeLabelText(mode);
    }
    if (els.modePicker) els.modePicker.setAttribute("data-mode", mode);
    const composer = document.getElementById("composer");
    if (composer) composer.setAttribute("data-mode", mode);
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      const key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    });
    if (els.fontSizeValue) {
      els.fontSizeValue.textContent = (settings.fontSize || 13) + " px";
    }
    if (els.fontPreview) {
      els.fontPreview.style.fontSize = (settings.fontSize || 13) + "px";
    }
    syncAgentsRailChrome();
    updateSendButton();
    renderModeMenu();
  }

  function clearMenuPlacement(menu) {
    if (!menu) return;
    menu.classList.remove("is-fixed", "opens-down");
    menu.style.position = "";
    menu.style.left = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.bottom = "";
    menu.style.minWidth = "";
    menu.style.maxHeight = "";
    menu.style.visibility = "";
    menu.style.zIndex = "";
    if (
      menu._homeParent &&
      menu.parentElement !== menu._homeParent
    ) {
      if (menu._homeNext && menu._homeNext.parentNode === menu._homeParent) {
        menu._homeParent.insertBefore(menu, menu._homeNext);
      } else {
        menu._homeParent.appendChild(menu);
      }
    }
  }

  function placeMenu(picker, menu) {
    if (!picker || !menu || menu.hidden) return;
    if (!menu._homeParent) {
      menu._homeParent = menu.parentElement;
      menu._homeNext = menu.nextSibling;
    }
    const trigger = picker.querySelector(".model-trigger") || picker;
    const triggerRect = trigger.getBoundingClientRect();
    const gap = 6;
    const edgePad = 8;
    const cssMax = 240;
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }
    menu.classList.add("is-fixed");
    menu.style.position = "fixed";
    menu.style.visibility = "hidden";
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.zIndex = "10000";
    menu.style.minWidth =
      Math.round(Math.max(160, triggerRect.width)) + "px";

    const naturalHeight = Math.min(Math.max(menu.scrollHeight, 1), cssMax);
    const menuWidth = Math.min(
      280,
      Math.max(160, triggerRect.width, menu.offsetWidth || 0)
    );
    const availAbove = triggerRect.top - gap - edgePad;
    const availBelow = window.innerHeight - triggerRect.bottom - gap - edgePad;
    const openDown = availAbove < naturalHeight && availBelow > availAbove;

    let left = triggerRect.left;
    const maxLeft = window.innerWidth - menuWidth - edgePad;
    if (left > maxLeft) left = Math.max(edgePad, maxLeft);
    if (left < edgePad) left = edgePad;

    menu.style.visibility = "";
    menu.style.left = Math.round(left) + "px";
    menu.style.minWidth = Math.round(menuWidth) + "px";
    if (openDown) {
      menu.classList.add("opens-down");
      picker.classList.add("opens-down");
      const maxH = Math.max(80, Math.min(cssMax, availBelow));
      menu.style.maxHeight = Math.round(maxH) + "px";
      menu.style.top = Math.round(triggerRect.bottom + gap) + "px";
      menu.style.bottom = "auto";
    } else {
      menu.classList.remove("opens-down");
      picker.classList.remove("opens-down");
      const maxH = Math.max(80, Math.min(cssMax, availAbove));
      const h = Math.min(naturalHeight, maxH);
      menu.style.maxHeight = Math.round(maxH) + "px";
      menu.style.top = Math.round(triggerRect.top - gap - h) + "px";
      menu.style.bottom = "auto";
    }
  }

  function closeModeMenu() {
    if (els.modePicker) {
      els.modePicker.classList.remove("is-open", "opens-down");
    }
    if (els.modeTrigger) {
      els.modeTrigger.setAttribute("aria-expanded", "false");
    }
    if (els.modeMenu) {
      els.modeMenu.hidden = true;
      clearMenuPlacement(els.modeMenu);
    }
  }

  function closeModelMenu() {
    const modelPicker = document.getElementById("modelPicker");
    if (modelPicker) {
      modelPicker.classList.remove("is-open", "opens-down");
    }
    if (els.modelTrigger) {
      els.modelTrigger.setAttribute("aria-expanded", "false");
    }
    if (els.modelMenu) {
      els.modelMenu.hidden = true;
      clearMenuPlacement(els.modelMenu);
    }
  }

  function closeAllMenus() {
    closeModeMenu();
    closeModelMenu();
  }

  function openModeMenu() {
    closeModelMenu();
    renderModeMenu();
    if (els.modePicker) els.modePicker.classList.add("is-open");
    if (els.modeTrigger) {
      els.modeTrigger.setAttribute("aria-expanded", "true");
    }
    if (els.modeMenu) {
      els.modeMenu.hidden = false;
      placeMenu(els.modePicker, els.modeMenu);
    }
  }

  function openModelMenu() {
    closeModeMenu();
    renderModelMenu();
    const modelPicker = document.getElementById("modelPicker");
    if (modelPicker) modelPicker.classList.add("is-open");
    if (els.modelTrigger) {
      els.modelTrigger.setAttribute("aria-expanded", "true");
    }
    if (els.modelMenu) {
      els.modelMenu.hidden = false;
      placeMenu(modelPicker, els.modelMenu);
    }
  }

  function renderModeMenu() {
    if (!els.modeMenu) return;
    const wasOpen = !els.modeMenu.hidden;
    els.modeMenu.innerHTML = "";
    ["agent", "plan", "ask"].forEach(function (m) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-option" + (m === mode ? " is-active" : "");
      btn.setAttribute("data-mode", m);
      btn.setAttribute("role", "option");
      btn.innerHTML = '<span class="model-option-label"></span>';
      btn.querySelector(".model-option-label").textContent = modeLabelText(m);
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        mode = normalizeMode(m);
        const agent = activeAgent();
        if (agent) agent.mode = mode;
        closeModeMenu();
        applyChrome();
        renderChat();
        void persistSession();
      });
      els.modeMenu.appendChild(btn);
    });
    if (wasOpen && els.modePicker) {
      placeMenu(els.modePicker, els.modeMenu);
    }
  }

  function syncAgentsRailChrome() {
    if (els.workspaceShell) {
      els.workspaceShell.classList.toggle("is-rail-open", agentsRailOpen);
      els.workspaceShell.classList.add("is-narrow");
    }
    if (els.agentsScreen) {
      els.agentsScreen.hidden = !(currentScreen === "chat" && agentsRailOpen);
    }
    if (els.agentsRailBackdrop) {
      els.agentsRailBackdrop.hidden = !(
        currentScreen === "chat" && agentsRailOpen
      );
    }
    if (els.toggleAgentsRailBtn) {
      const label = agentsRailOpen
        ? t("hideAgentsList")
        : t("showAgentsList");
      els.toggleAgentsRailBtn.title = label;
      els.toggleAgentsRailBtn.setAttribute("aria-label", label);
      els.toggleAgentsRailBtn.setAttribute(
        "aria-pressed",
        agentsRailOpen ? "true" : "false"
      );
      const icon = els.toggleAgentsRailBtn.querySelector(
        ".material-symbols-outlined"
      );
      if (icon) icon.textContent = agentsRailOpen ? "menu_open" : "menu";
    }
  }

  function setAgentsRailOpen(next) {
    agentsRailOpen = !!next;
    if (agentsRailOpen) renderAgents();
    syncAgentsRailChrome();
  }

  function showScreen(name) {
    currentScreen = name === "settings" ? "settings" : "chat";
    if (els.workspaceShell) els.workspaceShell.hidden = currentScreen !== "chat";
    if (els.chatScreen) els.chatScreen.hidden = false;
    if (els.settingsScreen) {
      els.settingsScreen.hidden = currentScreen !== "settings";
    }
    if (currentScreen !== "chat") {
      agentsRailOpen = false;
    }
    syncAgentsRailChrome();
  }

  function isAgentRunning(agentId) {
    return !!(agentId && runningByAgentId.has(agentId));
  }

  function isActiveChatBusy() {
    return isAgentRunning(session.activeAgentId);
  }

  function updateSendButton() {
    if (!els.sendBtn) return;
    els.sendBtn.classList.remove("is-stop", "is-queue");
    if (!isActiveChatBusy()) {
      els.sendBtn.dataset.mode = "send";
      els.sendBtn.title = t("send");
      els.sendBtn.setAttribute("aria-label", t("send"));
      return;
    }
    els.sendBtn.dataset.mode = "stop";
    els.sendBtn.classList.add("is-stop");
    els.sendBtn.title = t("stop");
    els.sendBtn.setAttribute("aria-label", t("stop"));
  }

  function showSettingsCategory(category) {
    const allowed = ["models", "language", "appearance", "advanced"];
    const cat = allowed.indexOf(category) >= 0 ? category : "models";
    if (els.settingsNav) {
      els.settingsNav.querySelectorAll(".settings-nav-item").forEach(function (btn) {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-settings-cat") === cat
        );
      });
    }
    document.querySelectorAll("[data-settings-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-settings-panel") !== cat;
    });
  }

  function activeAgent() {
    return (
      session.agents.find(function (a) {
        return a.id === session.activeAgentId;
      }) || null
    );
  }

  function ensureAgent() {
    if (activeAgent()) return activeAgent();
    const agent = {
      id: "a_" + F.cryptoToken(10),
      name: "Chat",
      messages: [],
      mode: mode,
      modelId: selectedModelId,
      selection: null,
      createdAt: Date.now(),
    };
    session.agents.unshift(agent);
    session.activeAgentId = agent.id;
    return agent;
  }

  /** Drop huge PNG before writing session to clientStorage. */
  function slimSelectionForStore(sel) {
    if (!sel || typeof sel !== "object") return null;
    const copy = {};
    for (const k in sel) {
      if (!Object.prototype.hasOwnProperty.call(sel, k)) continue;
      if (k === "previewPngDataUrl") continue;
      copy[k] = sel[k];
    }
    return copy;
  }

  function persistSession() {
    const agents = (session.agents || []).map(function (a) {
      const row = Object.assign({}, a);
      if (row.selection) {
        row.selection = slimSelectionForStore(row.selection);
      }
      return row;
    });
    return F.storageSet(F.STORAGE_SESSION, {
      agents: agents,
      activeAgentId: session.activeAgentId,
    });
  }

  /** Bind canvas selection to the active chat only (per-chat like VS Code chips). */
  function setActiveSelection(sel, opts) {
    selection = sel || null;
    const agent = activeAgent();
    if (agent) {
      agent.selection = sel || null;
      agent.updatedAt = Date.now();
    }
    if (!opts || opts.render !== false) {
      renderSelection();
    }
    if (opts && opts.persist) {
      void persistSession();
    }
  }

  function loadSelectionForAgent(agent) {
    selection = (agent && agent.selection) || null;
    renderSelection();
  }

  function readSettingsFromDom() {
    if (els.langSelect) {
      settings.language = els.langSelect.value || "en";
    }
    if (els.fontSizeRange) {
      settings.fontSize = Number(els.fontSizeRange.value) || 13;
    }
    if (els.settingsRejectUnauthorized) {
      settings.rejectUnauthorized = !!els.settingsRejectUnauthorized.checked;
    }
  }

  function persistSettings() {
    readSettingsFromDom();
    void syncSidecarTlsSettings();
    return F.storageSet(F.STORAGE_SETTINGS, settings);
  }

  function syncSidecarTlsSettings() {
    var Sidecar = window.__harborFigmaSidecar;
    if (!Sidecar || typeof Sidecar.syncTlsSettings !== "function") return;
    void Sidecar.syncTlsSettings(settings);
  }

  function shortModelChip(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const last = s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
    if (/^gpt-/i.test(last)) return last.replace(/^gpt-/i, "GPT-");
    if (/^glm-/i.test(last)) return last.replace(/^glm-/i, "GLM ");
    if (/^claude-/i.test(last)) return last.replace(/^claude-/i, "");
    return last.length > 18 ? last.slice(0, 16) + "…" : last;
  }

  function formatAgentTime(ts) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (_e) {
      return "";
    }
  }

  function agentPreview(a) {
    const msgs = a.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const text = String((msgs[i] && msgs[i].text) || "").trim();
      if (text) return text.slice(0, 120);
    }
    return "";
  }

  function deleteAgent(agentId) {
    const idx = session.agents.findIndex(function (a) {
      return a.id === agentId;
    });
    if (idx < 0) return;
    const wasActive = session.activeAgentId === agentId;
    const running = runningByAgentId.get(agentId);
    if (running) {
      running.abort();
      runningByAgentId.delete(agentId);
    }
    session.agents.splice(idx, 1);
    try {
      var Sidecar =
        typeof window !== "undefined" && window.__harborFigmaSidecar
          ? window.__harborFigmaSidecar
          : null;
      if (Sidecar && typeof Sidecar.discardChat === "function") {
        void Sidecar.discardChat(settings, agentId);
      }
    } catch (_e) {
      /* ignore */
    }
    if (wasActive) {
      session.activeAgentId = session.agents[0] ? session.agents[0].id : null;
      lastAssistantText = "";
      if (session.activeAgentId) {
        const next = activeAgent();
        if (next) {
          mode = normalizeMode(next.mode);
          selectedModelId = next.modelId || selectedModelId;
        }
        loadSelectionForAgent(next);
      } else {
        ensureAgent();
        loadSelectionForAgent(activeAgent());
      }
    }
    renderAgents();
    renderChat();
    updateSendButton();
    applyChrome();
    void persistSession();
  }

  function renderAgents() {
    if (!els.agentsList) return;
    els.agentsList.innerHTML = "";
    if (!session.agents.length) {
      els.agentsList.innerHTML =
        '<div class="agents-empty">' + escapeHtml(t("noAgentsYet")) + "</div>";
      return;
    }
    session.agents.forEach(function (a) {
      const wrap = document.createElement("div");
      wrap.className =
        "agent-block" + (a.id === session.activeAgentId ? " is-active" : "");
      wrap.dataset.agent = a.id;
      const model =
        a.modelId ||
        ((settings.models || []).find(function (m) {
          return m.id === selectedModelId;
        }) || {}).id ||
        "";
      const runMode = normalizeMode(a.mode || mode);
      const isRunning = isAgentRunning(a.id);
      const statusHtml = isRunning
        ? '<span class="agent-run-status agent-run-status-running" data-mode="' +
          escapeHtml(runMode) +
          '" aria-label="' +
          escapeHtml(t("runWorking")) +
          '"><span class="cube-bit cube-bit-1"></span><span class="cube-bit cube-bit-2"></span><span class="cube-bit cube-bit-3"></span><span class="cube-bit cube-bit-4"></span></span>'
        : '<span class="agent-run-status agent-run-status-empty" aria-hidden="true"></span>';
      wrap.innerHTML =
        '<div class="agent-row-wrap">' +
        '<div class="agent-row flat" role="button" tabindex="0">' +
        '<div class="agent-main">' +
        statusHtml +
        '<div class="agent-name-row">' +
        '<div class="agent-name-wrap"><div class="agent-name"></div></div>' +
        '<div class="agent-trailing">' +
        '<span class="agent-time"></span>' +
        '<div class="row-actions">' +
        '<button type="button" class="row-action row-delete" data-delete-agent="' +
        escapeHtml(a.id) +
        '" title="' +
        escapeHtml(t("delete")) +
        '" aria-label="' +
        escapeHtml(t("delete")) +
        '">' +
        ICON.delete +
        "</button>" +
        "</div></div></div>" +
        '<div class="agent-preview"></div>' +
        '<span class="agent-chip"></span>' +
        "</div></div></div>";
      wrap.querySelector(".agent-name").textContent = a.name || "Chat";
      wrap.querySelector(".agent-time").textContent = formatAgentTime(
        a.createdAt || a.updatedAt
      );
      wrap.querySelector(".agent-preview").textContent = agentPreview(a);
      const chip = wrap.querySelector(".agent-chip");
      const chipText = shortModelChip(model);
      chip.textContent = chipText;
      if (chipText && model) chip.title = String(model);
      wrap.querySelector(".agent-row").addEventListener("click", function (e) {
        if (e.target.closest(".row-action")) return;
        session.activeAgentId = a.id;
        mode = normalizeMode(a.mode);
        selectedModelId = a.modelId || selectedModelId;
        loadSelectionForAgent(a);
        renderChat();
        renderAgents();
        updateSendButton();
        setAgentsRailOpen(false);
        showScreen("chat");
        applyChrome();
        void persistSession();
      });
      wrap
        .querySelector(".row-delete")
        .addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          deleteAgent(a.id);
        });
      els.agentsList.appendChild(wrap);
    });
  }

  function escapeHtml(s) {
    return Md.escapeHtml(s);
  }

  function renderMarkdown(text) {
    return Md.renderMarkdown(text);
  }

  function openSettings() {
    ensureDefaultProviderForm();
    renderSettingsCatalog();
    if (els.langSelect) els.langSelect.value = settings.language || "en";
    if (els.fontSizeRange) {
      els.fontSizeRange.value = String(settings.fontSize || 13);
    }
    if (els.settingsRejectUnauthorized) {
      els.settingsRejectUnauthorized.checked = settings.rejectUnauthorized !== false;
    }
    showSettingsCategory("models");
    showScreen("settings");
    applyChrome();
  }

  function ensureDefaultProviderForm() {
    if (!settings.providers) settings.providers = [];
    if (!settings.models) settings.models = [];
    if (settings.providers.length === 0) {
      settings.providers.push({
        id: "p_" + F.cryptoToken(6),
        name: "Provider",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
      });
    }
    if (settings.models.length === 0) {
      settings.models.push({
        id: "gpt-4o-mini",
        label: "gpt-4o-mini",
        providerId: settings.providers[0].id,
        supportsVision: false,
        enabled: true,
      });
    }
  }

  function hasUsableSetup() {
    return (
      (settings.providers || []).some(function (p) {
        return p && p.baseUrl;
      }) &&
      (settings.models || []).some(function (m) {
        return m && m.id && m.providerId && m.enabled !== false;
      })
    );
  }

  function formatDurationMs(ms) {
    if (!(ms > 0)) return "";
    const seconds = ms / 1000;
    const isRu = settings.language === "ru";
    if (isRu) {
      return seconds >= 90
        ? Math.floor(seconds / 60) +
            " мин " +
            Math.round(seconds % 60) +
            " с"
        : seconds.toFixed(1).replace(".", ",") + " с";
    }
    return seconds >= 90
      ? Math.floor(seconds / 60) + " min " + Math.round(seconds % 60) + " s"
      : seconds.toFixed(1) + " s";
  }

  function formatTurnTiming(ttftMs, totalMs) {
    if (!(totalMs > 0)) return "";
    const total = formatDurationMs(totalMs);
    if (ttftMs > 0 && ttftMs < totalMs) {
      const ttftRaw = formatDurationMs(ttftMs).replace(
        /\s*(с|s|мин|min).*$/,
        ""
      );
      return t("runTiming")
        .replace("{ttft}", ttftRaw)
        .replace("{total}", total);
    }
    return total;
  }

  function normalizeStepStatus(status) {
    const s = String(status || "running").toLowerCase();
    if (s === "done" || s === "ok" || s === "success") return "ok";
    if (s === "error" || s === "failed") return "error";
    return "running";
  }

  function stepStatusLabel(status) {
    const s = normalizeStepStatus(status);
    if (s === "ok") return t("toolOk");
    if (s === "error") return t("toolError");
    return t("toolRunning");
  }

  function toolGroupSummary(steps, turnBusy, message) {
    const list = Array.isArray(steps) ? steps : [];
    const n = list.length;
    const running = list.filter(function (s) {
      return normalizeStepStatus(s.status) === "running";
    });
    const failed = list.some(function (s) {
      return normalizeStepStatus(s.status) === "error";
    });
    const countLabel = t("toolStepsCount").replace("{n}", String(n));
    if (turnBusy || running.length) {
      const live = running[running.length - 1] || list[list.length - 1];
      const liveLabel =
        (live && (live.label || live.name)) || t("runWorking");
      return t("runWorking") + " · " + liveLabel;
    }
    let base = failed
      ? t("toolError") + " · " + countLabel
      : t("runDone") + " · " + countLabel;
    const timing = formatTurnTiming(
      message && message.ttftMs,
      message && message.durationMs
    );
    if (timing) {
      base += " · " + timing;
    }
    return base;
  }

  function renderToolStepsGroup(message, messageIndex, turnBusy) {
    const steps = message.steps || [];
    if (!steps.length && !(message.ttftMs > 0 || message.durationMs > 0)) {
      return null;
    }

    const expanded = !!message.stepsExpanded;
    const group = document.createElement("div");
    group.className =
      "figma-tool-group" + (expanded ? "" : " is-collapsed");
    group.dataset.messageIndex = String(messageIndex);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "figma-tool-group-toggle";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");

    const summary = document.createElement("span");
    summary.className = "figma-tool-group-summary";
    summary.textContent = steps.length
      ? toolGroupSummary(steps, turnBusy, message)
      : formatTurnTiming(message.ttftMs, message.durationMs) ||
        t("runDone");

    const chevron = document.createElement("span");
    chevron.className = "material-symbols-outlined figma-tool-group-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "expand_more";

    toggle.appendChild(summary);
    if (steps.length) {
      toggle.appendChild(chevron);
    }
    toggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!steps.length) return;
      message.stepsExpanded = !message.stepsExpanded;
      renderChat();
    });

    const body = document.createElement("div");
    body.className = "figma-tool-group-body";
    steps.forEach(function (step) {
      const status = normalizeStepStatus(step.status);
      const row = document.createElement("div");
      row.className = "figma-tool-step is-" + status;
      if (step.error) {
        row.classList.add("has-error");
      }
      const head = document.createElement("div");
      head.className = "figma-tool-step-head";
      const label = document.createElement("span");
      label.className = "figma-tool-step-label";
      label.textContent = step.label || step.name || "tool";
      const statusEl = document.createElement("span");
      statusEl.className = "figma-tool-step-status";
      var statusText = stepStatusLabel(status);
      if (
        typeof step.durationMs === "number" &&
        step.durationMs >= 0 &&
        status !== "running"
      ) {
        statusText += " · " + formatDurationMs(step.durationMs);
      }
      statusEl.textContent = statusText;
      head.appendChild(label);
      head.appendChild(statusEl);
      row.appendChild(head);
      if (step.error) {
        const errEl = document.createElement("div");
        errEl.className = "figma-tool-step-error";
        errEl.textContent = step.error;
        row.appendChild(errEl);
      }
      body.appendChild(row);
    });

    group.appendChild(toggle);
    if (steps.length) {
      group.appendChild(body);
    }
    return group;
  }

  function formatProviderErrorText(text) {
    var s = String(text || "").trim();
    if (!s) return s;
    var lower = s.toLowerCase();
    if (lower === "param incorrect" || lower.indexOf("param incorrect") >= 0) {
      return t("providerParamError");
    }
    return s;
  }

  function renderChat() {
    const agent = ensureAgent();
    if (els.chatAgentName) els.chatAgentName.textContent = agent.name || "Chat";
    if (!els.messages) return;
    els.messages.innerHTML = "";
    if (!agent.messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      if (!hasUsableSetup()) {
        const p = document.createElement("p");
        p.textContent = t("setupHint");
        empty.appendChild(p);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "text-btn";
        btn.textContent = t("openSettingsCta");
        btn.addEventListener("click", openSettings);
        empty.appendChild(btn);
      } else {
        empty.textContent = t("emptyChat");
      }
      els.messages.appendChild(empty);
      return;
    }
    agent.messages.forEach(function (m, messageIndex) {
      const wrap = document.createElement("div");
      wrap.className =
        "msg-wrap " +
        (m.role === "user" ? "msg-wrap-user" : "msg-wrap-assistant");
      const bubble = document.createElement("div");
      bubble.className = "msg " + (m.role === "user" ? "user" : "assistant");
      if (m.role === "user") {
        const msgMode = normalizeMode(m.mode || mode);
        bubble.setAttribute("data-mode", msgMode);
      }
      if (m.role === "assistant") {
        const turnBusy =
          messageIndex === agent.messages.length - 1 &&
          isAgentRunning(agent.id);
        const stepsGroup = renderToolStepsGroup(m, messageIndex, turnBusy);
        if (stepsGroup) bubble.appendChild(stepsGroup);
        const md = document.createElement("div");
        md.className = "msg-md";
        md.innerHTML = renderMarkdown(m.text || "");
        bubble.appendChild(md);
      } else {
        bubble.innerHTML =
          '<div class="msg-body"><div class="msg-text"></div></div>';
        bubble.querySelector(".msg-text").textContent = m.text || "";
      }
      wrap.appendChild(bubble);
      els.messages.appendChild(wrap);
    });
    const lastMsg = agent.messages[agent.messages.length - 1];
    const lastHasSteps =
      lastMsg &&
      lastMsg.role === "assistant" &&
      lastMsg.steps &&
      lastMsg.steps.length > 0;
    if (isAgentRunning(agent.id) && !lastHasSteps) {
      const runEl = document.createElement("div");
      const liveUser =
        agent.messages.length >= 2
          ? agent.messages[agent.messages.length - 2]
          : null;
      const runMode = normalizeMode(
        (liveUser && liveUser.role === "user" && liveUser.mode) || mode
      );
      runEl.className = "figma-run-working";
      runEl.setAttribute("data-mode", runMode);
      runEl.setAttribute("aria-live", "polite");
      runEl.innerHTML =
        '<span class="figma-run-working-dot" aria-hidden="true"></span>' +
        '<span class="figma-run-working-label"></span>';
      runEl.querySelector(".figma-run-working-label").textContent =
        t("runWorking");
      const last = els.messages.lastElementChild;
      if (
        last &&
        last.classList.contains("msg-wrap-assistant") &&
        last.parentNode
      ) {
        last.parentNode.insertBefore(runEl, last);
      } else {
        els.messages.appendChild(runEl);
      }
    }
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderSelection() {
    if (!els.selectionPreview) return;
    const has = selection && selection.nodes && selection.nodes.length > 0;
    els.selectionPreview.hidden = !has;
    if (!has) {
      if (els.selectionMeta) els.selectionMeta.textContent = t("noSelection");
      els.selectionPreview.classList.remove("is-clickable");
      els.selectionPreview.removeAttribute("title");
      els.selectionPreview.removeAttribute("role");
      els.selectionPreview.removeAttribute("tabindex");
      return;
    }
    const realNodes = selection.nodes.filter(function (n) {
      return n && n.id !== "__more_roots" && n.type !== "TRUNCATED";
    });
    const count =
      typeof selection.selectedCount === "number"
        ? selection.selectedCount
        : realNodes.length;
    const n = realNodes[0] || selection.nodes[0];
    let meta;
    if (count > 1) {
      meta = t("selectionCount").replace("{n}", String(count));
      if (n && n.name) {
        meta += " · " + n.name + (count > 1 ? "…" : "");
      }
    } else {
      meta =
        n.name +
        " · " +
        n.type +
        (n.width && n.height ? " · " + n.width + "×" + n.height : "");
    }
    if (selection.canWrite === false) {
      meta += " · " + t("canvasReadOnly");
    }
    if (els.selectionMeta) {
      els.selectionMeta.textContent = meta;
    }
    if (els.selectionThumb) {
      if (selection.previewPngDataUrl) {
        els.selectionThumb.src = selection.previewPngDataUrl;
        els.selectionThumb.hidden = false;
      } else {
        els.selectionThumb.hidden = true;
      }
    }
    els.selectionPreview.classList.add("is-clickable");
    els.selectionPreview.title = t("focusSelection");
    els.selectionPreview.setAttribute("role", "button");
    els.selectionPreview.setAttribute("tabindex", "0");
  }

  function renderModelMenu() {
    if (!els.modelMenu || !els.modelLabel) return;
    els.modelMenu.innerHTML = "";
    const models = (settings.models || []).filter(function (m) {
      return m && m.enabled !== false;
    });
    if (!selectedModelId && models[0]) selectedModelId = models[0].id;
    const current = models.find(function (m) {
      return m.id === selectedModelId;
    });
    els.modelLabel.textContent = current
      ? current.label || current.id
      : t("needSettings");
    models.forEach(function (m) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (m.id === selectedModelId ? " is-active" : "");
      btn.role = "option";
      btn.innerHTML = '<span class="model-option-label"></span>';
      btn.querySelector(".model-option-label").textContent = m.label || m.id;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        selectedModelId = m.id;
        const agent = activeAgent();
        if (agent) agent.modelId = m.id;
        closeModelMenu();
        renderModelMenu();
        void persistSession();
      });
      els.modelMenu.appendChild(btn);
    });
  }

  function appendProviderHead(listEl, provider, index) {
    const row = document.createElement("div");
    row.className = "settings-provider-head";
    row.dataset.providerIndex = String(index);
    const title = provider.name || provider.id || t("providerTitle");
    row.innerHTML =
      '<div class="settings-model-info">' +
      '<div class="settings-model-name">' +
      '<span class="provider-status-title"></span>' +
      "</div>" +
      '<div class="settings-model-id"></div>' +
      "</div>" +
      '<button type="button" class="icon-btn settings-provider-edit" data-index="' +
      index +
      '" title="' +
      t("settings") +
      '" aria-label="' +
      t("settings") +
      '">' +
      ICON.settings +
      "</button>" +
      '<button type="button" class="icon-btn settings-provider-remove" data-index="' +
      index +
      '" title="' +
      t("delete") +
      '" aria-label="' +
      t("delete") +
      '">' +
      ICON.delete +
      "</button>";
    row.querySelector(".provider-status-title").textContent = title;
    row.querySelector(".settings-model-id").textContent =
      provider.baseUrl || provider.id || "";
    listEl.appendChild(row);
  }

  function appendModelRow(listEl, model, index, nested) {
    const row = document.createElement("div");
    const enabled = model.enabled !== false;
    row.className =
      "settings-model-row" +
      (enabled ? "" : " is-disabled") +
      (nested ? " is-under-provider" : "");
    row.dataset.index = String(index);
    const title = model.label || model.id || "";
    const parts = [];
    if (model.label && model.id && model.label !== model.id) {
      parts.push(model.id);
    }
    if (!nested) {
      const p = (settings.providers || []).find(function (x) {
        return x.id === model.providerId;
      });
      if (p) parts.push(p.name || p.id);
    }
    row.innerHTML =
      '<label class="settings-model-switch">' +
      '<input type="checkbox" class="settings-model-toggle" data-index="' +
      index +
      '"' +
      (enabled ? " checked" : "") +
      " />" +
      '<span class="settings-model-switch-ui" aria-hidden="true"></span>' +
      "</label>" +
      '<div class="settings-model-info">' +
      '<div class="settings-model-name"></div>' +
      '<div class="settings-model-id"></div>' +
      "</div>" +
      '<button type="button" class="icon-btn settings-model-edit" data-index="' +
      index +
      '" title="' +
      t("settings") +
      '" aria-label="' +
      t("settings") +
      '">' +
      ICON.settings +
      "</button>" +
      '<button type="button" class="icon-btn settings-model-remove" data-index="' +
      index +
      '" title="' +
      t("delete") +
      '" aria-label="' +
      t("delete") +
      '">' +
      ICON.delete +
      "</button>";
    row.querySelector(".settings-model-name").textContent = title;
    row.querySelector(".settings-model-id").textContent = parts.join(" · ");
    listEl.appendChild(row);
  }

  function renderSettingsCatalog() {
    const list = els.settingsProvidersModelsList;
    if (!list) return;
    list.innerHTML = "";
    const providers = settings.providers || [];
    const models = settings.models || [];
    if (!providers.length && !models.length) {
      list.innerHTML =
        '<div class="settings-models-empty">' +
        escapeHtml(t("noProvidersOrModels")) +
        "</div>";
      return;
    }
    const used = new Set();
    providers.forEach(function (provider, providerIndex) {
      const group = document.createElement("div");
      group.className = "settings-provider-group";
      appendProviderHead(group, provider, providerIndex);
      const pid = String(provider.id || "").trim();
      models.forEach(function (model, index) {
        if (String(model.providerId || "").trim() === pid) {
          used.add(index);
          appendModelRow(group, model, index, true);
        }
      });
      list.appendChild(group);
    });
    const orphans = [];
    models.forEach(function (model, index) {
      if (!used.has(index)) orphans.push({ model: model, index: index });
    });
    if (orphans.length) {
      if (providers.length) {
        const group = document.createElement("div");
        group.className = "settings-provider-group";
        const orphanHead = document.createElement("div");
        orphanHead.className = "settings-provider-head";
        orphanHead.innerHTML =
          '<div class="settings-model-info"><div class="settings-model-name"></div></div>';
        orphanHead.querySelector(".settings-model-name").textContent =
          t("otherProvider");
        group.appendChild(orphanHead);
        orphans.forEach(function (entry) {
          appendModelRow(group, entry.model, entry.index, true);
        });
        list.appendChild(group);
      } else {
        orphans.forEach(function (entry) {
          appendModelRow(list, entry.model, entry.index, false);
        });
      }
    }
  }

  function closeProviderEdit() {
    if (els.providerEditModal) els.providerEditModal.hidden = true;
    providerEditIndex = null;
  }

  function closeModelEdit() {
    if (els.modelEditModal) els.modelEditModal.hidden = true;
    modelEditIndex = null;
  }

  function guessPromptCacheForUrl(baseUrl) {
    const u = String(baseUrl || "").toLowerCase();
    if (!u) return false;
    if (
      /openai\.com|api\.openai/.test(u) &&
      !/openrouter|litellm|anthropic/.test(u)
    ) {
      return false;
    }
    return /litellm|openrouter|anthropic|claude/.test(u);
  }

  function openProviderEdit(index) {
    ensureDefaultProviderForm();
    providerEditIndex = index;
    const isNew = index < 0 || index >= settings.providers.length;
    const provider = isNew
      ? {
          id: "p_" + F.cryptoToken(6),
          name: "",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "",
          promptCache: false,
        }
      : settings.providers[index];
    if (isNew) {
      settings.providers.push(provider);
      providerEditIndex = settings.providers.length - 1;
    }
    if (els.providerEditTitle) {
      els.providerEditTitle.textContent = isNew
        ? t("newProvider")
        : t("providerTitle");
    }
    if (els.providerEditName) els.providerEditName.value = provider.name || "";
    if (els.providerEditBaseUrl) {
      els.providerEditBaseUrl.value = provider.baseUrl || "";
    }
    if (els.providerEditApiKey) {
      els.providerEditApiKey.value = provider.apiKey || "";
    }
    if (els.providerEditPromptCache) {
      els.providerEditPromptCache.checked =
        typeof provider.promptCache === "boolean"
          ? provider.promptCache
          : guessPromptCacheForUrl(provider.baseUrl);
    }
    if (els.providerEditModal) els.providerEditModal.hidden = false;
    if (els.providerEditName) els.providerEditName.focus();
  }

  function saveProviderEdit() {
    if (providerEditIndex == null || !settings.providers[providerEditIndex]) {
      closeProviderEdit();
      return;
    }
    const p = settings.providers[providerEditIndex];
    p.name = (els.providerEditName && els.providerEditName.value.trim()) || "Provider";
    p.baseUrl =
      (els.providerEditBaseUrl && els.providerEditBaseUrl.value.trim()) || "";
    p.apiKey =
      (els.providerEditApiKey && els.providerEditApiKey.value) || "";
    p.promptCache = !!(
      els.providerEditPromptCache && els.providerEditPromptCache.checked
    );
    closeProviderEdit();
    renderSettingsCatalog();
    void persistSettings().then(flashSaved);
  }

  function fillModelProviderSelect(selectedId) {
    if (!els.modelEditProvider) return;
    els.modelEditProvider.innerHTML = "";
    (settings.providers || []).forEach(function (p) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      els.modelEditProvider.appendChild(opt);
    });
    if (selectedId) els.modelEditProvider.value = selectedId;
  }

  function openModelEdit(index) {
    ensureDefaultProviderForm();
    modelEditIndex = index;
    const isNew = index < 0 || index >= settings.models.length;
    const model = isNew
      ? {
          id: "",
          label: "",
          providerId: settings.providers[0] ? settings.providers[0].id : "",
          supportsVision: false,
          enabled: true,
        }
      : settings.models[index];
    if (isNew) {
      settings.models.push(model);
      modelEditIndex = settings.models.length - 1;
    }
    if (els.modelEditTitle) {
      els.modelEditTitle.textContent = isNew ? t("newModel") : t("modelTitle");
    }
    fillModelProviderSelect(model.providerId);
    if (els.modelEditId) els.modelEditId.value = model.id || "";
    if (els.modelEditLabel) els.modelEditLabel.value = model.label || "";
    if (els.modelEditVision) {
      els.modelEditVision.checked = !!model.supportsVision;
    }
    if (els.modelEditModal) els.modelEditModal.hidden = false;
    if (els.modelEditId) els.modelEditId.focus();
  }

  function saveModelEdit() {
    if (modelEditIndex == null || !settings.models[modelEditIndex]) {
      closeModelEdit();
      return;
    }
    const m = settings.models[modelEditIndex];
    m.id = (els.modelEditId && els.modelEditId.value.trim()) || "";
    m.label =
      (els.modelEditLabel && els.modelEditLabel.value.trim()) || m.id;
    m.providerId =
      (els.modelEditProvider && els.modelEditProvider.value) || "";
    m.supportsVision = !!(els.modelEditVision && els.modelEditVision.checked);
    if (m.enabled === undefined) m.enabled = true;
    closeModelEdit();
    renderSettingsCatalog();
    renderModelMenu();
    void persistSettings().then(flashSaved);
  }

  async function sendMessage() {
    const agent = ensureAgent();
    if (isAgentRunning(agent.id)) return;
    const text = (els.prompt && els.prompt.value.trim()) || "";
    if (!text) return;
    const model = (settings.models || []).find(function (m) {
      return m.id === selectedModelId && m.enabled !== false;
    });
    const provider =
      model &&
      (settings.providers || []).find(function (p) {
        return p.id === model.providerId;
      });
    if (!model || !provider) {
      setStatus(t("needSettings"));
      openSettings();
      return;
    }

    var hostOk = await refreshSidecarHealth();
    if (!hostOk) {
      setStatus(t("hostOffline") + " — retrying in 3s…");
      await new Promise(function (r) { setTimeout(r, 3000); });
      hostOk = await refreshSidecarHealth();
    }
    if (!hostOk) {
      setStatus(t("hostOffline"));
      return;
    }

    const runAgentId = agent.id;
    agent.messages.push({ role: "user", text: text, mode: mode });
    if (agent.name === "Chat" && text.length > 0) {
      agent.name = text.slice(0, 40);
    }
    agent.mode = mode;
    agent.modelId = selectedModelId;
    if (els.prompt) els.prompt.value = "";
    renderChat();
    renderAgents();

    const abortCtrl = new AbortController();
    runningByAgentId.set(runAgentId, abortCtrl);
    updateSendButton();
    if (session.activeAgentId === runAgentId) {
      setStatus(t("runWorking"));
    }
    renderAgents();
    renderChat();

    if (typeof F.refreshSelectionForTurn === "function") {
      const fresh = await F.refreshSelectionForTurn(false);
      if (fresh) {
        // Bind refreshed canvas selection to this chat only.
        if (session.activeAgentId === runAgentId) {
          setActiveSelection(fresh, { render: true });
        } else {
          agent.selection = fresh;
        }
      }
    }

    // Lazy preview: request only when model supports vision, cache by nodeId.
    var turnSelection = agent.selection || selection;
    if (
      model.supportsVision &&
      turnSelection &&
      turnSelection.primaryNodeId &&
      !turnSelection.previewPngDataUrl &&
      typeof F.requestPreview === "function"
    ) {
      var cachedPreview = previewCache.get(turnSelection.primaryNodeId);
      if (cachedPreview) {
        turnSelection.previewPngDataUrl = cachedPreview;
      } else {
        var pv = await F.requestPreview(turnSelection.primaryNodeId);
        if (pv) {
          turnSelection.previewPngDataUrl = pv;
          previewCache.set(turnSelection.primaryNodeId, pv);
        }
      }
    }

    const history = agent.messages.slice(0, -1).map(function (m) {
      return { role: m.role, text: m.text };
    });
    const assistant = { role: "assistant", text: "", steps: [] };
    agent.messages.push(assistant);
    agent.updatedAt = Date.now();
    renderChat();
    renderAgents();

    try {
      const Sidecar =
        typeof window !== "undefined" && window.__harborFigmaSidecar
          ? window.__harborFigmaSidecar
          : null;
      if (!Sidecar || typeof Sidecar.runFigmaSidecarTurn !== "function") {
        throw new Error("Figma Cline sidecar client missing from UI bundle");
      }
      const full = await Sidecar.runFigmaSidecarTurn({
        settings: settings,
        provider: provider,
        model: model,
        mode: mode,
        userText: text,
        history: history,
        selection: turnSelection,
        chatId: runAgentId,
        signal: abortCtrl.signal,
        invokeTool: function (name, args) {
          return F.invokeTool(name, args);
        },
        onToolStep: function (step) {
          if (!assistant.steps) assistant.steps = [];
          var stepId = step.stepId || step.name;
          var status = normalizeStepStatus(step.status);
          var prev = assistant.steps.find(function (s) {
            return s.stepId === stepId;
          });
          if (prev) {
            prev.status = status;
            prev.error = step.error;
            prev.label = step.label || prev.label;
            if (step.name) prev.name = step.name;
            if (typeof step.durationMs === "number") {
              prev.durationMs = step.durationMs;
            }
          } else {
            assistant.steps.push({
              stepId: stepId,
              name: step.name,
              label: step.label,
              status: status,
              error: step.error,
              durationMs: step.durationMs,
            });
          }
          if (session.activeAgentId === runAgentId) {
            renderChat();
          }
          renderAgents();
        },
        onTiming: function (timing) {
          if (!timing) return;
          if (typeof timing.ttftMs === "number" && timing.ttftMs > 0) {
            assistant.ttftMs = timing.ttftMs;
          }
          if (typeof timing.durationMs === "number" && timing.durationMs >= 0) {
            assistant.durationMs = timing.durationMs;
          }
          if (session.activeAgentId === runAgentId) {
            renderChat();
          }
        },
        onStatus: function (statusText) {
          if (!statusText) return;
          var st = String(statusText).toLowerCase();
          if (
            st === "failed" ||
            st === "error" ||
            (st.indexOf("unauthorized") >= 0 && st.indexOf("401") >= 0)
          ) {
            if (session.activeAgentId === runAgentId) {
              setStatus(t("runWorking") + " — " + statusText);
            }
          }
        },
        onDelta: function (piece) {
          assistant.text += piece;
          if (session.activeAgentId === runAgentId) {
            lastAssistantText = assistant.text;
            renderChat();
          }
        },
      });
      assistant.text = formatProviderErrorText(full || assistant.text);
      if (
        !String(assistant.text || "").trim() &&
        !(assistant.steps && assistant.steps.length)
      ) {
        assistant.text = t("emptyTurnError");
      }
      if (session.activeAgentId === runAgentId) {
        lastAssistantText = assistant.text;
      }
      if (assistant.steps && assistant.steps.length) {
        assistant.steps.forEach(function (s) {
          if (normalizeStepStatus(s.status) === "running") {
            s.status = "ok";
          }
        });
      }
      if (session.activeAgentId === runAgentId) {
        setStatus("");
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        if (session.activeAgentId === runAgentId) {
          setStatus("Stopped");
        }
      } else {
        assistant.text = formatProviderErrorText(
          assistant.text ||
            "Error: " + ((err && err.message) || String(err))
        );
        if (session.activeAgentId === runAgentId) {
          setStatus(assistant.text.slice(0, 120));
        }
      }
      if (session.activeAgentId === runAgentId) {
        lastAssistantText = assistant.text;
      }
      if (assistant.steps && assistant.steps.length) {
        assistant.steps.forEach(function (s) {
          if (normalizeStepStatus(s.status) === "running") {
            s.status = err && err.name === "AbortError" ? "error" : "ok";
          }
        });
      }
    }

    if (runningByAgentId.get(runAgentId) === abortCtrl) {
      runningByAgentId.delete(runAgentId);
    }
    // Apply any canvas selection that arrived while the chat was running.
    if (pendingCanvasSelection && session.activeAgentId === runAgentId) {
      setActiveSelection(pendingCanvasSelection, { persist: false });
      pendingCanvasSelection = null;
    }
    updateSendButton();
    renderChat();
    renderAgents();
    void persistSession();
  }

  function onHostMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "figmaSelectionChanged") {
      // While the active chat is running, don't overwrite its selection —
      // buffer the canvas click and apply it when the run finishes.
      if (isAgentRunning(session.activeAgentId)) {
        pendingCanvasSelection = msg.selection || null;
      } else {
        setActiveSelection(msg.selection || null, { persist: false });
      }
      if (msg.requestId && F.pendingSelection) {
        const resolve = F.pendingSelection.get(msg.requestId);
        if (resolve) {
          F.pendingSelection.delete(msg.requestId);
          resolve(msg.selection || null);
        }
      }
      return;
    }
    if (msg.type === "figmaToolResult") {
      if (F.pendingTools) {
        const pending = F.pendingTools.get(msg.requestId);
        if (pending) {
          F.pendingTools.delete(msg.requestId);
          if (msg.ok) {
            pending.resolve(msg.result);
          } else {
            pending.reject(new Error(msg.error || "Tool failed"));
          }
        }
      }
      return;
    }
    if (msg.type === "figmaClientStorageValue") {
      const resolve = F.pendingStorage.get(msg.requestId);
      if (resolve) {
        F.pendingStorage.delete(msg.requestId);
        resolve(msg.value);
      }
      return;
    }
    if (msg.type === "figmaClientStorageSaved") {
      const resolve = F.pendingStorage.get(msg.requestId);
      if (resolve) {
        F.pendingStorage.delete(msg.requestId);
        resolve();
      }
      return;
    }
    if (msg.type === "figmaPreviewResult") {
      if (F.pendingPreview) {
        const resolve = F.pendingPreview.get(msg.requestId);
        if (resolve) {
          F.pendingPreview.delete(msg.requestId);
          resolve(msg.preview || null);
        }
      }
      return;
    }
  }

  window.onmessage = function (event) {
    const data = event.data;
    const msg =
      data && typeof data === "object" && "pluginMessage" in data
        ? data.pluginMessage
        : data;
    onHostMessage(msg);
  };

  if (els.sendBtn) {
    els.sendBtn.addEventListener("click", function () {
      const activeId = session.activeAgentId;
      if (isAgentRunning(activeId)) {
        const ctrl = runningByAgentId.get(activeId);
        if (ctrl) ctrl.abort();
        return;
      }
      void sendMessage();
    });
  }
  if (els.selectionPreview) {
    els.selectionPreview.addEventListener("click", function () {
      const id =
        selection &&
        selection.nodes &&
        selection.nodes[0] &&
        selection.nodes[0].id;
      if (id && typeof F.focusNode === "function") F.focusNode(id);
    });
    els.selectionPreview.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        els.selectionPreview.click();
      }
    });
  }
  if (els.prompt) {
    els.prompt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!isActiveChatBusy()) void sendMessage();
      }
    });
  }
  if (els.modeTrigger && els.modeMenu) {
    els.modeTrigger.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (els.modeMenu.hidden) {
        openModeMenu();
      } else {
        closeModeMenu();
      }
    });
  }
  if (els.modelTrigger && els.modelMenu) {
    els.modelTrigger.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!(settings.models || []).length) {
        openSettings();
        return;
      }
      if (els.modelMenu.hidden) {
        openModelMenu();
      } else {
        closeModelMenu();
      }
    });
  }
  document.addEventListener("click", function (e) {
    const target = e.target;
    if (!(target instanceof Element)) {
      closeAllMenus();
      return;
    }
    if (
      target.closest("#modePicker") ||
      target.closest("#modelPicker") ||
      target.closest("#modeMenu") ||
      target.closest("#modelMenu")
    ) {
      return;
    }
    closeAllMenus();
  });
  window.addEventListener("resize", function () {
    closeAllMenus();
  });
  if (els.toggleAgentsRailBtn) {
    els.toggleAgentsRailBtn.addEventListener("click", function () {
      setAgentsRailOpen(!agentsRailOpen);
    });
  }
  if (els.agentsRailBackdrop) {
    els.agentsRailBackdrop.addEventListener("click", function () {
      setAgentsRailOpen(false);
    });
  }
  if (els.newAgentBtn) {
    els.newAgentBtn.addEventListener("click", function () {
      session.activeAgentId = null;
      ensureAgent();
      lastAssistantText = "";
      loadSelectionForAgent(activeAgent());
      renderAgents();
      renderChat();
      updateSendButton();
      setAgentsRailOpen(false);
      showScreen("chat");
      void persistSession();
      // Pull current canvas into this new chat only.
      if (typeof F.refreshSelection === "function") {
        void F.refreshSelection().then(function (fresh) {
          if (fresh) setActiveSelection(fresh, { persist: true });
        });
      }
    });
  }
  if (els.openSettingsBtn) {
    els.openSettingsBtn.addEventListener("click", openSettings);
  }
  if (els.closeSettingsBtn) {
    els.closeSettingsBtn.addEventListener("click", function () {
      closeProviderEdit();
      closeModelEdit();
      void persistSettings().then(function () {
        showScreen("chat");
        renderModelMenu();
      });
    });
  }
  if (els.settingsNav) {
    els.settingsNav.addEventListener("click", function (event) {
      const btn = event.target.closest(".settings-nav-item");
      if (!btn) return;
      showSettingsCategory(btn.getAttribute("data-settings-cat") || "models");
    });
  }
  if (els.addProviderBtn) {
    els.addProviderBtn.addEventListener("click", function () {
      openProviderEdit(-1);
    });
  }
  if (els.addModelBtn) {
    els.addModelBtn.addEventListener("click", function () {
      openModelEdit(-1);
    });
  }
  if (els.settingsProvidersModelsList) {
    els.settingsProvidersModelsList.addEventListener("click", function (e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const editP = target.closest(".settings-provider-edit");
      if (editP) {
        openProviderEdit(Number(editP.getAttribute("data-index")));
        return;
      }
      const remP = target.closest(".settings-provider-remove");
      if (remP) {
        const idx = Number(remP.getAttribute("data-index"));
        settings.providers.splice(idx, 1);
        renderSettingsCatalog();
        void persistSettings().then(flashSaved);
        return;
      }
      const editM = target.closest(".settings-model-edit");
      if (editM) {
        openModelEdit(Number(editM.getAttribute("data-index")));
        return;
      }
      const remM = target.closest(".settings-model-remove");
      if (remM) {
        const idx = Number(remM.getAttribute("data-index"));
        settings.models.splice(idx, 1);
        renderSettingsCatalog();
        renderModelMenu();
        void persistSettings().then(flashSaved);
        return;
      }
    });
    els.settingsProvidersModelsList.addEventListener("change", function (e) {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("settings-model-toggle")) return;
      const idx = Number(target.getAttribute("data-index"));
      if (!settings.models[idx]) return;
      settings.models[idx].enabled = target.checked;
      renderSettingsCatalog();
      renderModelMenu();
      void persistSettings().then(flashSaved);
    });
  }

  function bindModalDismiss(modal, closeFn, attr) {
    if (!modal) return;
    modal.addEventListener("click", function (e) {
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (el.getAttribute(attr) === "1") closeFn();
    });
  }
  bindModalDismiss(els.providerEditModal, closeProviderEdit, "data-provider-dismiss");
  bindModalDismiss(els.modelEditModal, closeModelEdit, "data-modal-dismiss");
  if (els.providerEditCloseBtn) {
    els.providerEditCloseBtn.addEventListener("click", closeProviderEdit);
  }
  if (els.providerEditCancelBtn) {
    els.providerEditCancelBtn.addEventListener("click", closeProviderEdit);
  }
  if (els.providerEditDoneBtn) {
    els.providerEditDoneBtn.addEventListener("click", saveProviderEdit);
  }
  if (els.modelEditCloseBtn) {
    els.modelEditCloseBtn.addEventListener("click", closeModelEdit);
  }
  if (els.modelEditCancelBtn) {
    els.modelEditCancelBtn.addEventListener("click", closeModelEdit);
  }
  if (els.modelEditDoneBtn) {
    els.modelEditDoneBtn.addEventListener("click", saveModelEdit);
  }

  if (els.langSelect) {
    els.langSelect.addEventListener("change", function () {
      settings.language = els.langSelect.value || "en";
      applyChrome();
      void persistSettings().then(flashSaved);
    });
  }
  if (els.fontSizeRange) {
    els.fontSizeRange.addEventListener("input", function () {
      settings.fontSize = Number(els.fontSizeRange.value) || 13;
      applyChrome();
    });
    els.fontSizeRange.addEventListener("change", function () {
      void persistSettings().then(flashSaved);
    });
  }
  if (els.settingsRejectUnauthorized) {
    els.settingsRejectUnauthorized.addEventListener("change", function () {
      settings.rejectUnauthorized = !!els.settingsRejectUnauthorized.checked;
      void persistSettings().then(flashSaved);
    });
    var tlsSwitch = els.settingsRejectUnauthorized.closest(".settings-switch");
    if (tlsSwitch) {
      tlsSwitch.addEventListener("click", function (event) {
        if (event.target === els.settingsRejectUnauthorized) return;
        els.settingsRejectUnauthorized.checked =
          !els.settingsRejectUnauthorized.checked;
        els.settingsRejectUnauthorized.dispatchEvent(
          new Event("change", { bubbles: true })
        );
      });
    }
  }
  async function boot() {
    const storedSettings = await F.storageGet(F.STORAGE_SETTINGS);
    if (storedSettings && typeof storedSettings === "object") {
      settings = Object.assign(settings, storedSettings);
      if (!Array.isArray(settings.providers)) settings.providers = [];
      if (!Array.isArray(settings.models)) settings.models = [];
      if (typeof settings.rejectUnauthorized !== "boolean") {
        settings.rejectUnauthorized = true;
      }
    }
    // Sync TLS setting from the sidecar settings file — it survives plugin
    // reloads even when figma.clientStorage lost the value or the sidecar
    // was offline when the user toggled the switch.
    // Prefer the less-strict side: if either store says false, use false
    // (corporate MITM). Then push the resolved value back to the sidecar.
    try {
      var Sidecar =
        typeof window !== "undefined" && window.__harborFigmaSidecar
          ? window.__harborFigmaSidecar
          : null;
      if (Sidecar && typeof Sidecar.fetchTlsSettings === "function") {
        var remote = await Sidecar.fetchTlsSettings(settings);
        if (remote && remote.rejectUnauthorized === false) {
          settings.rejectUnauthorized = false;
        }
        if (settings.rejectUnauthorized === false) {
          void F.storageSet(F.STORAGE_SETTINGS, settings);
          if (typeof Sidecar.syncTlsSettings === "function") {
            void Sidecar.syncTlsSettings(settings);
          }
        }
      }
    } catch (_e) { /* ignore */ }
    const storedSession = await F.storageGet(F.STORAGE_SESSION);
    if (storedSession && typeof storedSession === "object") {
      session = Object.assign(session, storedSession);
      if (!Array.isArray(session.agents)) session.agents = [];
    }
    const storedUi = await F.storageGet(F.STORAGE_UI);
    if (
      storedUi &&
      typeof storedUi === "object" &&
      storedUi.width &&
      storedUi.height
    ) {
      panelSize = clampPanelSize(storedUi.width, storedUi.height);
    }
    applyPanelSize(panelSize.width, panelSize.height, false);
    bindPanelResizeHandle();
    ensureAgent();
    const agent = activeAgent();
    if (agent) {
      mode = normalizeMode(agent.mode);
      selectedModelId = agent.modelId || selectedModelId;
    }
    applyChrome();
    renderModelMenu();
    renderAgents();
    renderChat();
    loadSelectionForAgent(agent);
    updateSendButton();
    showScreen("chat");
    if (!hasUsableSetup()) {
      // Soft nudge: empty state CTA already points to Settings.
    }
    host.postMessage({ type: "ready", surface: "figma" });
    // Refresh live canvas into the active chat only (other chats keep their own).
    host.postMessage({ type: "figmaGetSelection" });
    void refreshSidecarHealth();
  }

  void boot();
  } catch (err) {
    var msg = err && err.stack ? err.stack : String(err);
    document.body.innerHTML =
      "<pre style='padding:16px;color:#c00;white-space:pre-wrap;font:12px monospace'>Harbor UI crash:\n" +
      msg +
      "</pre>";
  }
})();

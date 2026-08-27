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
    copyBriefBtn: document.getElementById("copyBriefBtn"),
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
    statusLine: document.getElementById("statusLine"),
    providerEditModal: document.getElementById("providerEditModal"),
    providerEditTitle: document.getElementById("providerEditTitle"),
    providerEditName: document.getElementById("providerEditName"),
    providerEditBaseUrl: document.getElementById("providerEditBaseUrl"),
    providerEditApiKey: document.getElementById("providerEditApiKey"),
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
  };

  /** @type {{ providers: any[], models: any[], language: string, fontSize: number }} */
  let settings = {
    providers: [],
    models: [],
    language: "en",
    fontSize: 13,
  };

  /** @type {{ agents: any[], activeAgentId: string|null }} */
  let session = { agents: [], activeAgentId: null };

  /** @type {any} */
  let selection = null;
  let mode = "agent";
  let selectedModelId = "";
  let busy = false;
  /** Agent id currently running a turn (cube on agents list). */
  let busyAgentId = null;
  /** @type {AbortController|null} */
  let abortCtrl = null;
  let lastAssistantText = "";
  /** @type {number|null} */
  let providerEditIndex = null;
  /** @type {number|null} */
  let modelEditIndex = null;
  let saveStatusTimer = 0;
  let agentsRailOpen = false;
  let currentScreen = "chat";

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
      copyBrief: "Copy brief",
      focusSelection: "Focus on canvas",
      toolRunning: "Running…",
      runWorking: "Running",
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
      appearanceNote: "Chat text and composer size in the panel.",
      pluginUiLanguage: "Plugin UI language",
      fontSize: "Font size",
      fontSizeHint: "Applies to messages and the input field.",
      fontPreview: "The agent will reply at this size.",
      cancel: "Cancel",
      done: "Done",
      addProvider: "+ Provider",
      addModel: "+ Model",
      noSelection: "Select a frame or node",
      placeholder: "Task for the design agent…",
      placeholderAgent: "Task for the design agent…",
      placeholderPlan: "Describe the task — draft a plan without canvas edits…",
      placeholderAsk: "Ask about the selection…",
      emptyChat: "Select a frame, then ask a design question.",
      saved: "Saved",
      briefCopied: "Brief copied",
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
      copyBrief: "Копировать бриф",
      focusSelection: "Показать на макете",
      toolRunning: "Выполняется…",
      runWorking: "выполняю",
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
      appearanceNote: "Размер текста чата и поля ввода в панели.",
      pluginUiLanguage: "Язык интерфейса плагина",
      fontSize: "Размер шрифта",
      fontSizeHint: "Действует на сообщения и поле ввода.",
      fontPreview: "Агент ответит таким размером.",
      cancel: "Отмена",
      done: "Готово",
      addProvider: "+ Провайдер",
      addModel: "+ Модель",
      noSelection: "Выберите фрейм или ноду",
      placeholder: "Задача для дизайн-агента…",
      placeholderAgent: "Задача для дизайн-агента…",
      placeholderPlan: "Опишите задачу — составим план без правок canvas…",
      placeholderAsk: "Вопрос по выделению…",
      emptyChat: "Выберите фрейм и задайте вопрос по дизайну.",
      saved: "Сохранено",
      briefCopied: "Бриф скопирован",
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
    },
  };

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
    if (els.copyBriefBtn) {
      els.copyBriefBtn.title = t("copyBrief");
      els.copyBriefBtn.setAttribute("aria-label", t("copyBrief"));
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

  function updateSendButton() {
    if (!els.sendBtn) return;
    els.sendBtn.classList.remove("is-stop", "is-queue");
    if (!busy) {
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
    const allowed = ["models", "language", "appearance"];
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
      createdAt: Date.now(),
    };
    session.agents.unshift(agent);
    session.activeAgentId = agent.id;
    return agent;
  }

  function persistSession() {
    return F.storageSet(F.STORAGE_SESSION, session);
  }

  function persistSettings() {
    return F.storageSet(F.STORAGE_SETTINGS, settings);
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
    session.agents.splice(idx, 1);
    if (wasActive) {
      session.activeAgentId = session.agents[0] ? session.agents[0].id : null;
      lastAssistantText = "";
      if (session.activeAgentId) {
        const next = activeAgent();
        if (next) {
          mode = normalizeMode(next.mode);
          selectedModelId = next.modelId || selectedModelId;
        }
      } else {
        ensureAgent();
      }
    }
    renderAgents();
    renderChat();
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
      const isRunning = busy && busyAgentId === a.id;
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
        renderChat();
        renderAgents();
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
    agent.messages.forEach(function (m) {
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
        if (m.steps && m.steps.length) {
          const stepsEl = document.createElement("div");
          stepsEl.className = "figma-tool-steps";
          m.steps.forEach(function (step) {
            const row = document.createElement("div");
            row.className =
              "figma-tool-step is-" + (step.status || "running");
            const label = document.createElement("span");
            label.className = "figma-tool-step-label";
            label.textContent = step.label || step.name || "tool";
            const status = document.createElement("span");
            status.className = "figma-tool-step-status";
            status.textContent =
              step.status === "ok"
                ? t("toolOk")
                : step.status === "error"
                  ? t("toolError")
                  : t("toolRunning");
            row.appendChild(label);
            row.appendChild(status);
            if (step.error) {
              row.title = step.error;
            }
            stepsEl.appendChild(row);
          });
          bubble.appendChild(stepsEl);
        }
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
    if (busy) {
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
    if (els.copyBriefBtn) {
      els.copyBriefBtn.hidden = mode !== "plan" || !lastAssistantText;
    }
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
    const n = selection.nodes[0];
    let meta =
      n.name +
      " · " +
      n.type +
      (n.width && n.height ? " · " + n.width + "×" + n.height : "");
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
    if (busy) return;
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

    const agent = ensureAgent();
    agent.messages.push({ role: "user", text: text, mode: mode });
    if (agent.name === "Chat" && text.length > 0) {
      agent.name = text.slice(0, 40);
    }
    agent.mode = mode;
    agent.modelId = selectedModelId;
    if (els.prompt) els.prompt.value = "";
    renderChat();
    renderAgents();

    busy = true;
    busyAgentId = agent.id;
    abortCtrl = new AbortController();
    updateSendButton();
    setStatus(t("runWorking"));
    renderAgents();
    renderChat();

    if (typeof F.refreshSelection === "function") {
      const fresh = await F.refreshSelection();
      if (fresh) selection = fresh;
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
      const full = await Turn.runFigmaAgentTurn({
        provider: provider,
        model: model,
        mode: mode,
        userText: text,
        history: history,
        selection: selection,
        signal: abortCtrl.signal,
        invokeTool: function (name, args) {
          return F.invokeTool(name, args);
        },
        onToolStep: function (step) {
          if (!assistant.steps) assistant.steps = [];
          const prev = assistant.steps[assistant.steps.length - 1];
          if (
            prev &&
            prev.name === step.name &&
            prev.status === "running" &&
            step.status !== "running"
          ) {
            prev.status = step.status;
            prev.error = step.error;
          } else {
            assistant.steps.push({
              name: step.name,
              label: step.label,
              status: step.status,
              error: step.error,
            });
          }
          renderChat();
        },
        onDelta: function (piece) {
          assistant.text += piece;
          lastAssistantText = assistant.text;
          renderChat();
        },
      });
      assistant.text = full || assistant.text;
      lastAssistantText = assistant.text;
      setStatus("");
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("Stopped");
      } else {
        assistant.text =
          assistant.text ||
          "Error: " + ((err && err.message) || String(err));
        setStatus(assistant.text.slice(0, 120));
      }
      lastAssistantText = assistant.text;
    }

    busy = false;
    busyAgentId = null;
    abortCtrl = null;
    updateSendButton();
    renderChat();
    renderAgents();
    void persistSession();
  }

  function onHostMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "figmaSelectionChanged") {
      selection = msg.selection || null;
      renderSelection();
      if (msg.requestId && F.pendingSelection) {
        const resolve = F.pendingSelection.get(msg.requestId);
        if (resolve) {
          F.pendingSelection.delete(msg.requestId);
          resolve(selection);
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
    if (msg.type === "copied") {
      setStatus(t("briefCopied"));
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
      if (busy) {
        if (abortCtrl) abortCtrl.abort();
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
        if (!busy) void sendMessage();
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
      renderAgents();
      renderChat();
      setAgentsRailOpen(false);
      showScreen("chat");
      void persistSession();
    });
  }
  if (els.openSettingsBtn) {
    els.openSettingsBtn.addEventListener("click", openSettings);
  }
  if (els.closeSettingsBtn) {
    els.closeSettingsBtn.addEventListener("click", function () {
      closeProviderEdit();
      closeModelEdit();
      showScreen("chat");
      renderModelMenu();
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
  if (els.copyBriefBtn) {
    els.copyBriefBtn.addEventListener("click", function () {
      const brief = Turn.buildHandoffBrief(lastAssistantText, selection);
      void navigator.clipboard.writeText(brief).then(
        function () {
          host.postMessage({ type: "copyBrief", text: brief });
          setStatus(t("briefCopied"));
        },
        function () {
          host.postMessage({ type: "copyBrief", text: brief });
        }
      );
    });
  }

  async function boot() {
    const storedSettings = await F.storageGet(F.STORAGE_SETTINGS);
    if (storedSettings && typeof storedSettings === "object") {
      settings = Object.assign(settings, storedSettings);
      if (!Array.isArray(settings.providers)) settings.providers = [];
      if (!Array.isArray(settings.models)) settings.models = [];
    }
    const storedSession = await F.storageGet(F.STORAGE_SESSION);
    if (storedSession && typeof storedSession === "object") {
      session = Object.assign(session, storedSession);
      if (!Array.isArray(session.agents)) session.agents = [];
    }
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
    renderSelection();
    showScreen("chat");
    if (!hasUsableSetup()) {
      // Soft nudge: empty state CTA already points to Settings.
    }
    host.postMessage({ type: "ready", surface: "figma" });
    host.postMessage({ type: "figmaGetSelection" });
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

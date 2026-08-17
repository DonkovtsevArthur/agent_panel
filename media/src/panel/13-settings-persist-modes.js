  function persistSettingsNow() {
    if (settingsHydrating) {
      return;
    }
    host.postMessage({
      type: "saveSettings",
      settings: collectSettings(),
    });
    showSettingsSaved();
  }

  function persistModesNow() {
    if (settingsHydrating) {
      return;
    }
    host.postMessage({
      type: "saveModes",
      modes: collectCustomModesForSave(),
    });
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
    settingsLanguageValue =
      settings.language === "ru"
        ? "ru"
        : settings.language === "en"
          ? "en"
          : "auto";
    if (
      settings.resolvedLanguage === "ru" ||
      settings.resolvedLanguage === "en"
    ) {
      hostResolvedUiLang = settings.resolvedLanguage;
    }
    applyUiLanguage(effectiveUiLangFromSetting(settingsLanguageValue));
    if (settingsLanguage) {
      settingsLanguage.value = settingsLanguageValue;
    }
    applyUiFontSize(settings.fontSize);
    settingsProviders = Array.isArray(settings.providers)
      ? settings.providers.map((p) => ({
          id: p.id || "",
          name: p.name || "",
          baseUrl: p.baseUrl || "",
          apiKey: p.apiKey || "",
          statusUrl: p.statusUrl || "",
        }))
      : [];
    if (
      !settingsProviders.length &&
      (settings.baseUrl || settings.apiKey)
    ) {
      settingsProviders.push({
        id: "default",
        name: t("defaultProviderName"),
        baseUrl: String(settings.baseUrl || "").replace(/\/$/, ""),
        apiKey: settings.apiKey || "",
        statusUrl: "",
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
          supportsVision:
            typeof m.supportsVision === "boolean"
              ? m.supportsVision
              : guessModelSupportsVision(m.id),
        }))
      : [];
    settingsDefaultModelId = settings.defaultModel || "";
    settingsWorkspaceName = String(settings.workspaceName || "").trim();
    if (settingsCommitScope) {
      settingsCommitScope.value =
        settings.commitMessageScope === "workspace" ? "workspace" : "global";
      updateCommitScopeWorkspaceOption();
    }
    settingsDefaultContextWindow =
      Number(settings.defaultContextWindow) > 0
        ? Number(settings.defaultContextWindow)
        : 128000;
    if (settingsRejectUnauthorized) {
      settingsRejectUnauthorized.checked = Boolean(settings.rejectUnauthorized);
    }
    if (settingsSystemPrompt) {
      settingsSystemPrompt.value = settings.systemPrompt || "";
      updateSystemPromptPreview();
    }
    if (settingsCommitLanguage) {
      settingsCommitLanguage.value =
        settings.commitMessageLanguage === "ru"
          ? "ru"
          : settings.commitMessageLanguage === "en"
            ? "en"
            : "auto";
    }
    if (settingsCommitPrompt) {
      settingsCommitPrompt.value = settings.commitMessagePrompt || "";
      updateCommitPromptPreview();
    }
    fillCommitMessageModelCheckboxes(settings.commitMessageModelIds || []);
    if (typeof settings.figmaEnabled === "boolean") {
      figmaStatus = {
        ...figmaStatus,
        enabled: settings.figmaEnabled === true,
      };
    }
    if (settings.figma) {
      renderFigmaStatus({ ...figmaStatus, ...settings.figma });
    } else {
      host.postMessage({ type: "figmaRefreshStatus" });
    }
    applyModes(settings.modes);
    if (settingsMaxToolRounds) {
      settingsMaxToolRounds.value = String(settings.maxToolRounds || 20);
    }
    if (settingsMaxTokens) {
      settingsMaxTokens.value = String(settings.maxTokens || 4096);
    }
    if (settingsMaxResponseChars) {
      settingsMaxResponseChars.value = String(
        settings.maxResponseChars || 64000
      );
    }
    if (settingsSoundNotificationsEnabled) {
      settingsSoundNotificationsEnabled.checked =
        settings.soundNotificationsEnabled !== false;
    }
    if (settingsSubagentsEnabled) {
      settingsSubagentsEnabled.checked = settings.subagentsEnabled !== false;
    }
    if (settingsParallelToolCallsEnabled) {
      settingsParallelToolCallsEnabled.checked =
        settings.parallelToolCallsEnabled !== false;
    }
    if (settingsAutoCompactEnabled) {
      settingsAutoCompactEnabled.checked =
        settings.autoCompactEnabled !== false;
    }
    if (settingsToolsAutoApprove) {
      settingsToolsAutoApprove.checked = settings.toolsAutoApprove !== false;
    }
    const approvalOverrides =
      settings.toolsApprovals &&
      typeof settings.toolsApprovals === "object"
        ? settings.toolsApprovals
        : {};
    for (const [group, select] of Object.entries(settingsApprovalSelects)) {
      if (!select) {
        continue;
      }
      const value = approvalOverrides[group];
      select.value =
        value === true ? "auto" : value === false ? "ask" : "inherit";
    }
    if (settingsFocusChainEnabled) {
      settingsFocusChainEnabled.checked = settings.focusChainEnabled !== false;
    }
    if (settingsCheckpointsEnabled) {
      settingsCheckpointsEnabled.checked = settings.checkpointsEnabled !== false;
    }
    if (
      Array.isArray(settings.skillsExtraDirectories) ||
      Array.isArray(settings.skillsDisabled)
    ) {
      // Keep cache in sync when settings hydrate; full list comes via skillsList.
      skillsCache = {
        ...skillsCache,
        enabled: settings.skillsEnabled !== false,
      };
    }
    fillTabAutocompleteModelSelect(settings.tabAutocompleteModelId || "");
    if (settingsTabAutocompleteEnabled) {
      settingsTabAutocompleteEnabled.checked =
        settings.tabAutocompleteEnabled === true;
    }
    if (settingsTabAutocompleteAggressiveness) {
      const agg = String(settings.tabAutocompleteAggressiveness || "medium")
        .trim()
        .toLowerCase();
      settingsTabAutocompleteAggressiveness.value =
        agg === "low" || agg === "high" ? agg : "medium";
    }
    if (settingsTabAutocompleteAlternatives) {
      const alts = Number(settings.tabAutocompleteAlternatives);
      settingsTabAutocompleteAlternatives.value = String(
        alts === 1 || alts === 3 ? alts : 2
      );
    }
    if (settingsTabAutocompleteExcludeGlobs) {
      const globs = Array.isArray(settings.tabAutocompleteExcludeGlobs)
        ? settings.tabAutocompleteExcludeGlobs
        : [];
      settingsTabAutocompleteExcludeGlobs.value = globs.join("\n");
      updateTabExcludePreview();
    }
    if (settingsTabAutocompleteNextEdit) {
      settingsTabAutocompleteNextEdit.checked =
        settings.tabAutocompleteNextEdit === true;
    }
    if (settingsTabAutocompleteShowMode) {
      settingsTabAutocompleteShowMode.value =
        String(settings.tabAutocompleteShowMode || "chip").toLowerCase() ===
        "inline"
          ? "inline"
          : "chip";
    }
    if (settingsTabAutocompleteFim) {
      settingsTabAutocompleteFim.checked = settings.tabAutocompleteFim === true;
    }
    if (settingsSelectionHintsEnabled) {
      settingsSelectionHintsEnabled.checked =
        settings.selectionHintsEnabled !== false;
    }
    if (settingsAutoglmEnabled) {
      settingsAutoglmEnabled.checked = settings.autoglmEnabled === true;
    }
    if (settingsAutoglmBrowser) {
      settingsAutoglmBrowser.value =
        settings.autoglmBrowser === "edge" ? "edge" : "chrome";
    }
    if (settingsAutoglmAutoApprove) {
      settingsAutoglmAutoApprove.checked = settings.autoglmAutoApprove === true;
    }
    if (settingsAutoglmBinaryPath) {
      settingsAutoglmBinaryPath.value = settings.autoglmBinaryPath || "";
    }
    closeModelEditModal();
    closeProviderEditModal();
    ingestProviderConnStatuses(settings.providerConnStatuses);
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
        const statusUrl = String(p.statusUrl || "").replace(/\/$/, "");
        if (statusUrl && statusUrl !== row.baseUrl) {
          row.statusUrl = statusUrl;
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
      row.supportsVision =
        typeof m.supportsVision === "boolean"
          ? m.supportsVision
          : guessModelSupportsVision(m.id);
      return row;
    });
    const primary =
      settingsProviders.find((p) => p.id === "default") ||
      settingsProviders[0];
    return {
      providers,
      models,
      language: settingsLanguage ? settingsLanguage.value : settingsLanguageValue,
      fontSize: clampUiFontSize(settingsFontSize ? settingsFontSize.value : FONT_SIZE_DEFAULT),
      defaultModel: firstEnabledSettingsModelId() || settingsDefaultModelId,
      defaultContextWindow: settingsDefaultContextWindow,
      baseUrl: primary ? String(primary.baseUrl || "").replace(/\/$/, "") : "",
      apiKey: primary ? primary.apiKey || "" : "",
      rejectUnauthorized: settingsRejectUnauthorized
        ? settingsRejectUnauthorized.checked
        : false,
      systemPrompt: settingsSystemPrompt ? settingsSystemPrompt.value : "",
      commitMessagePrompt: settingsCommitPrompt
        ? settingsCommitPrompt.value
        : "",
      commitMessageLanguage: settingsCommitLanguage
        ? settingsCommitLanguage.value
        : "auto",
      commitMessageModelIds: settingsCommitModelList
        ? [...settingsCommitModelList.querySelectorAll("input:checked")].map(
            (el) => el.dataset.modelId
          )
        : [],
      commitMessageScope: settingsCommitScope
        ? settingsCommitScope.value === "workspace"
          ? "workspace"
          : "global"
        : "global",
      figmaEnabled: figmaStatus.enabled === true,
      maxToolRounds: Number(settingsMaxToolRounds?.value || 20),
      maxTokens: Number(settingsMaxTokens?.value || 4096),
      maxResponseChars: Number(settingsMaxResponseChars?.value || 64000),
      soundNotificationsEnabled: settingsSoundNotificationsEnabled
        ? settingsSoundNotificationsEnabled.checked
        : true,
      subagentsEnabled: settingsSubagentsEnabled
        ? settingsSubagentsEnabled.checked
        : true,
      parallelToolCallsEnabled: settingsParallelToolCallsEnabled
        ? settingsParallelToolCallsEnabled.checked
        : true,
      autoCompactEnabled: settingsAutoCompactEnabled
        ? settingsAutoCompactEnabled.checked
        : true,
      toolsAutoApprove: settingsToolsAutoApprove
        ? settingsToolsAutoApprove.checked
        : true,
      toolsApprovals: Object.fromEntries(
        Object.entries(settingsApprovalSelects)
          .filter(([, select]) => select && select.value !== "inherit")
          .map(([group, select]) => [group, select.value === "auto"])
      ),
      focusChainEnabled: settingsFocusChainEnabled
        ? settingsFocusChainEnabled.checked
        : true,
      checkpointsEnabled: settingsCheckpointsEnabled
        ? settingsCheckpointsEnabled.checked
        : true,
      skillsEnabled: skillsCache.enabled !== false,
      skillsExtraDirectories: Array.isArray(skillsCache.directories)
        ? skillsCache.directories
            .filter((d) => d && d.removable)
            .map((d) => d.path)
            .filter(Boolean)
        : [],
      skillsDisabled: Array.isArray(skillsCache.skills)
        ? skillsCache.skills
            .filter((s) => s && s.disabled)
            .map((s) => s.name)
            .filter(Boolean)
        : [],
      tabAutocompleteEnabled:
        harborHostAvailable()
          ? false
          : settingsTabAutocompleteEnabled
            ? settingsTabAutocompleteEnabled.checked
            : false,
      tabAutocompleteModelId: settingsTabAutocompleteModel
        ? settingsTabAutocompleteModel.value.trim()
        : "",
      tabAutocompleteAggressiveness: settingsTabAutocompleteAggressiveness
        ? settingsTabAutocompleteAggressiveness.value
        : "medium",
      tabAutocompleteAlternatives: settingsTabAutocompleteAlternatives
        ? Number(settingsTabAutocompleteAlternatives.value) || 2
        : 2,
      tabAutocompleteExcludeGlobs: settingsTabAutocompleteExcludeGlobs
        ? settingsTabAutocompleteExcludeGlobs.value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      tabAutocompleteNextEdit: settingsTabAutocompleteNextEdit
        ? settingsTabAutocompleteNextEdit.checked
        : false,
      tabAutocompleteShowMode: settingsTabAutocompleteShowMode
        ? settingsTabAutocompleteShowMode.value
        : "chip",
      tabAutocompleteFim: settingsTabAutocompleteFim
        ? settingsTabAutocompleteFim.checked
        : false,
      selectionHintsEnabled: settingsSelectionHintsEnabled
        ? settingsSelectionHintsEnabled.checked
        : true,
      autoglmEnabled: settingsAutoglmEnabled
        ? settingsAutoglmEnabled.checked
        : false,
      autoglmBrowser: settingsAutoglmBrowser
        ? settingsAutoglmBrowser.value === "edge"
          ? "edge"
          : "chrome"
        : "chrome",
      autoglmAutoApprove: settingsAutoglmAutoApprove
        ? settingsAutoglmAutoApprove.checked
        : false,
      autoglmBinaryPath: settingsAutoglmBinaryPath
        ? settingsAutoglmBinaryPath.value.trim()
        : "",
      modes: collectCustomModesForSave(),
    };
  }

  function collectCustomModesForSave() {
    return settingsModes
      .filter((m) => m && m.id && m.label)
      .filter((m) => {
        if (!m.builtin && !["agent", "plan", "ask"].includes(m.id)) {
          return true;
        }
        return Boolean(m.overridden);
      })
      .map((m) => {
        const row = {
          id: m.id,
          label: m.label,
          tools: m.tools === "readonly" ? "readonly" : "agent",
        };
        if (m.description) {
          row.description = m.description;
        }
        if (m.prompt) {
          row.prompt = m.prompt;
        }
        if (m.placeholder) {
          row.placeholder = m.placeholder;
        }
        if (m.color) {
          row.color = m.color;
        }
        if (m.enabled === false) {
          row.enabled = false;
        }
        return row;
      });
  }

  const DEFAULT_CHAT_MODES = [
    {
      id: "agent",
      label: t("agent"),
      description: UI_LANG === "ru" ? "Читает и правит код" : "Reads and edits code",
      tools: "agent",
      builtin: true,
      placeholder: t("taskPlaceholder"),
    },
    {
      id: "plan",
      label: t("plan"),
      description: UI_LANG === "ru" ? "Только план, без правок" : "Plan only, no edits",
      tools: "readonly",
      builtin: true,
      placeholder:
        UI_LANG === "ru"
          ? "Опишите задачу — агент составит план без правок… (@ — файл)"
          : "Describe the task — the agent will draft a plan without edits... (@ for file)",
    },
    {
      id: "ask",
      label: t("ask"),
      description: UI_LANG === "ru" ? "Ответы и объяснения" : "Answers and explanations",
      tools: "readonly",
      builtin: true,
      placeholder:
        UI_LANG === "ru"
          ? "Спросите про код или задачу… (@ — файл)"
          : "Ask about code or a task... (@ for file)",
    },
  ];
  if (!chatModes.length) {
    chatModes = DEFAULT_CHAT_MODES.slice();
  }
  if (!settingsModes.length) {
    settingsModes = DEFAULT_CHAT_MODES.map((m) => ({ ...m }));
  }

  function slugifyModeId(label) {
    const map = {
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      е: "e",
      ё: "e",
      ж: "zh",
      з: "z",
      и: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "h",
      ц: "ts",
      ч: "ch",
      ш: "sh",
      щ: "sch",
      ъ: "",
      ы: "y",
      ь: "",
      э: "e",
      ю: "yu",
      я: "ya",
    };
    const ascii = String(label || "")
      .trim()
      .toLowerCase()
      .split("")
      .map((ch) => map[ch] ?? ch)
      .join("")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return ascii || `mode-${Date.now().toString(36)}`;
  }

  function normalizeModesList(list) {
    const incoming = Array.isArray(list) ? list : [];
    if (!incoming.length) {
      return DEFAULT_CHAT_MODES.map((m) => ({ ...m }));
    }
    return incoming.map((m) => ({
      id: m.id || "",
      label: m.label || m.id || "",
      description: m.description || "",
      tools: m.tools === "readonly" ? "readonly" : "agent",
      prompt: m.prompt || "",
      color: normalizeModeColorUi(m.color) || "",
      placeholder: m.placeholder || "",
      enabled: m.enabled !== false,
      builtin: Boolean(m.builtin) || ["agent", "plan", "ask"].includes(m.id),
      overridden: Boolean(m.overridden),
    }));
  }

  function applyModes(list, { keepSelection = true } = {}) {
    const next = normalizeModesList(list);
    settingsModes = next.map((m) => localizeModeMeta({ ...m }));
    chatModes = next
      .filter((m) => m.enabled !== false)
      .map((m) => localizeModeMeta({ ...m }));
    syncModeAccentStyles();
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    const still =
      keepSelection && chatModes.some((m) => m.id === agentMode)
        ? agentMode
        : chatModes[0]?.id || "agent";
    const modeChanged = still !== agentMode;
    if (typeof setAgentMode === "function") {
      setAgentMode(still, { close: false, notify: modeChanged });
    } else {
      agentMode = still;
    }
  }

  function renderSettingsModes() {
    if (!settingsModesList) {
      return;
    }
    settingsModesList.innerHTML = "";
    if (!settingsModes.length) {
      settingsModesList.innerHTML =
        `<div class="settings-models-empty">${t("noModes")}</div>`;
      return;
    }
    settingsModes.forEach((mode, index) => {
      const row = document.createElement("div");
      row.className = "settings-model-row";
      row.dataset.index = String(index);
      const toolsLabel =
        mode.tools === "readonly" ? t("readOnly") : t("agent").toLowerCase();
      const subtitle = mode.builtin
        ? `${t("builtIn")} · ${toolsLabel}`
        : toolsLabel;
      row.innerHTML =
        `<div class="settings-model-info">` +
        `<div class="settings-model-name"></div>` +
        `<div class="settings-model-id"></div>` +
        `</div>` +
        `<button type="button" class="icon-btn settings-mode-edit" data-index="${index}" title="${t("edit")}" aria-label="${t("edit")}">` +
        SETTINGS_ICON +
        `</button>` +
        (mode.builtin
          ? ""
          : `<button type="button" class="icon-btn settings-mode-remove" data-index="${index}" title="${t("delete")}" aria-label="${t("delete")}">` +
            DELETE_ICON +
            `</button>`);
      row.querySelector(".settings-model-name").textContent =
        mode.label || mode.id;
      row.querySelector(".settings-model-id").textContent = mode.description
        ? `${mode.description} · ${subtitle}`
        : subtitle;
      settingsModesList.appendChild(row);
    });
  }

  function closeModeEditModal() {
    if (!modeEditModal) {
      return;
    }
    modeEditModal.hidden = true;
    modeEditIndex = null;
    modeEditSource = "settings";
  }

  const MODE_ACCENT_DEFAULTS = {
    plan: "#a67c00",
    ask: "#2d6a4f",
  };

  function normalizeModeColorUi(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) {
      return "";
    }
    const hex = match[1];
    if (hex.length === 3) {
      const [a, b, c] = hex.split("");
      return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
    }
    return `#${hex}`.toLowerCase();
  }

  function resolveModeAccent(modeId) {
    const id = String(modeId || "").trim();
    if (!id) {
      return "";
    }
    const modes = chatModes.length
      ? chatModes
      : settingsModes.length
        ? settingsModes
        : DEFAULT_CHAT_MODES;
    const mode = modes.find((m) => m.id === id);
    const custom = normalizeModeColorUi(mode?.color);
    if (custom) {
      return custom;
    }
    return MODE_ACCENT_DEFAULTS[id] || "";
  }

  /** Webview CSP blocks element.style / inline vars — accents go through a nonced <style>. */
  function getWebviewStyleNonce() {
    const tagged =
      document.querySelector("style[nonce]") ||
      document.querySelector("script[nonce]");
    if (!tagged) {
      return "";
    }
    return tagged.nonce || tagged.getAttribute("nonce") || "";
  }

  function ensureModeAccentStyleEl() {
    let el = document.getElementById("harborModeAccents");
    if (el) {
      return el;
    }
    el = document.createElement("style");
    el.id = "harborModeAccents";
    const nonce = getWebviewStyleNonce();
    if (nonce) {
      el.setAttribute("nonce", nonce);
    }
    document.head.appendChild(el);
    return el;
  }

  function cssAttrValue(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  function syncModeAccentStyles() {
    const styleEl = ensureModeAccentStyleEl();
    const modes = settingsModes.length
      ? settingsModes
      : chatModes.length
        ? chatModes
        : DEFAULT_CHAT_MODES;
    const seen = new Set();
    const chunks = [];
    for (const mode of modes) {
      const id = String(mode?.id || "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const custom = normalizeModeColorUi(mode?.color);
      const accent = custom || MODE_ACCENT_DEFAULTS[id] || "";
      if (!accent) {
        continue;
      }
      // Built-in plan/ask already styled in panel.css unless user overrode color.
      if (!custom && (id === "plan" || id === "ask")) {
        continue;
      }
      const attr = cssAttrValue(id);
      // Override CSS vars so panel.css cube rules for plan/ask pick up custom color.
      if (custom && id === "plan") {
        chunks.push(`:root{--mode-plan:${accent};}`);
      } else if (custom && id === "ask") {
        chunks.push(`:root{--mode-ask:${accent};}`);
      }
      chunks.push(
        `.msg.user[data-mode="${attr}"]{background:color-mix(in srgb,${accent} 14%,var(--harbor-chat-bg));}` +
          `.composer[data-mode="${attr}"],` +
          `.msg-edit-composer[data-mode="${attr}"]{border-color:color-mix(in srgb,${accent} var(--mode-border-composer),transparent);}` +
          `.mode-picker[data-mode="${attr}"] .model-trigger,` +
          `.mode-picker[data-mode="${attr}"] .model-trigger:hover:not(:disabled),` +
          `.mode-picker[data-mode="${attr}"].is-open .model-trigger,` +
          `.msg-edit-mode-picker[data-mode="${attr}"] .model-trigger{color:${accent};}` +
          `.mode-picker .model-option[data-mode="${attr}"] .model-option-label,` +
          `#modeMenu .model-option[data-mode="${attr}"] .model-option-label,` +
          `.msg-edit-mode-menu .model-option[data-mode="${attr}"] .model-option-label{color:${accent};}` +
          `.agents-list .agent-run-status-running[data-mode="${attr}"]{--cube-accent:${accent};}`
      );
    }
    styleEl.textContent = chunks.join("\n");
  }

  function applyModeAccentToElement(el, modeId) {
    if (!el) {
      return;
    }
    const id = String(modeId || "").trim();
    if (id) {
      el.dataset.mode = id;
    } else {
      delete el.dataset.mode;
    }
    // Colors: panel.css for plan/ask; #harborModeAccents for custom.
    // Do not use has-mode-accent + --mode-accent (CSP blocks the var; class overrides builtins).
    el.classList.remove("has-mode-accent");
    el.style.removeProperty("--mode-accent");
  }

  function getModeEditColor() {
    if (!modeEditColorRow) {
      return "";
    }
    const active = modeEditColorRow.querySelector(
      ".mode-color-swatch.is-active"
    );
    if (active) {
      return normalizeModeColorUi(active.getAttribute("data-color"));
    }
    if (modeEditColorRow.dataset.customActive === "1" && modeEditColor) {
      return normalizeModeColorUi(modeEditColor.value);
    }
    return "";
  }

  function setModeEditColor(value) {
    const color = normalizeModeColorUi(value);
    if (!modeEditColorRow) {
      return;
    }
    modeEditColorRow.dataset.customActive = "";
    modeEditColorRow.querySelectorAll(".mode-color-swatch").forEach((btn) => {
      const swatch = normalizeModeColorUi(btn.getAttribute("data-color"));
      const isNone = btn.classList.contains("is-none");
      btn.classList.toggle("is-active", color ? swatch === color : isNone);
    });
    if (color && modeEditColor) {
      modeEditColor.value = color;
      const matched = [...modeEditColorRow.querySelectorAll(".mode-color-swatch")].some(
        (btn) =>
          !btn.classList.contains("is-none") &&
          normalizeModeColorUi(btn.getAttribute("data-color")) === color
      );
      if (!matched) {
        modeEditColorRow.dataset.customActive = "1";
        modeEditColorRow
          .querySelectorAll(".mode-color-swatch")
          .forEach((btn) => btn.classList.remove("is-active"));
      }
    }
  }

  function applyModeEditModalStrings() {
    const nameLabel = document.getElementById("modeEditNameLabel");
    if (nameLabel) nameLabel.textContent = t("name");
    const descLabel = document.getElementById("modeEditDescriptionLabel");
    if (descLabel) descLabel.textContent = t("modeDescription");
    const toolsLabel = document.getElementById("modeEditToolsLabel");
    if (toolsLabel) toolsLabel.textContent = t("modeTools");
    const promptLabel = document.getElementById("modeEditPromptLabel");
    if (promptLabel) promptLabel.textContent = t("modePrompt");
    const colorLabel = document.getElementById("modeEditColorLabel");
    if (colorLabel) colorLabel.textContent = t("modeColor");
    const colorHint = document.getElementById("modeEditColorHint");
    if (colorHint) colorHint.textContent = t("modeColorHint");
    if (modeEditLabel) {
      modeEditLabel.placeholder = t("modeNamePlaceholder");
    }
    if (modeEditDescription) {
      modeEditDescription.placeholder = t("modeDescriptionPlaceholder");
    }
    if (modeEditPrompt) {
      modeEditPrompt.placeholder = t("modePromptPlaceholder");
    }
    if (modeEditTools) {
      const agentOpt = modeEditTools.querySelector('option[value="agent"]');
      const roOpt = modeEditTools.querySelector('option[value="readonly"]');
      if (agentOpt) agentOpt.textContent = t("modeToolsAgent");
      if (roOpt) roOpt.textContent = t("modeToolsReadonly");
    }
    if (modeEditColorRow) {
      const noneBtn = modeEditColorRow.querySelector(
        ".mode-color-swatch.is-none"
      );
      if (noneBtn) {
        noneBtn.title = t("modeColorNone");
        noneBtn.setAttribute("aria-label", t("modeColorNone"));
      }
      const custom = modeEditColorRow.querySelector(".mode-color-custom");
      if (custom) {
        custom.title = t("modeColorCustom");
      }
      if (modeEditColor) {
        modeEditColor.setAttribute("aria-label", t("modeColorCustom"));
      }
    }
    if (modeEditCancelBtn) modeEditCancelBtn.textContent = t("cancel");
    if (modeEditDoneBtn) modeEditDoneBtn.textContent = t("done");
    if (modeEditCloseBtn) {
      modeEditCloseBtn.title = t("close");
      modeEditCloseBtn.setAttribute("aria-label", t("close"));
    }
  }

  function openModeEditModal(index, source) {
    if (!modeEditModal) {
      return;
    }
    applyModeEditModalStrings();
    modeEditSource = source || "settings";
    modeEditIndex = Number.isInteger(index) ? index : -1;
    const existing =
      modeEditIndex >= 0 ? settingsModes[modeEditIndex] : null;
    if (modeEditTitle) {
      modeEditTitle.textContent = existing ? t("mode") : t("newMode");
    }
    if (modeEditLabel) {
      modeEditLabel.value = existing ? existing.label || "" : "";
    }
    if (modeEditDescription) {
      modeEditDescription.value = existing ? existing.description || "" : "";
    }
    if (modeEditTools) {
      modeEditTools.value =
        existing && existing.tools === "readonly" ? "readonly" : "agent";
    }
    if (modeEditPrompt) {
      modeEditPrompt.value = existing ? existing.prompt || "" : "";
    }
    setModeEditColor(existing?.color || "");
    modeEditModal.hidden = false;
    if (modeEditLabel) {
      modeEditLabel.focus();
    }
  }

  function commitModeEdit() {
    const label = modeEditLabel ? modeEditLabel.value.trim() : "";
    if (!label) {
      showCopyToast(t("enterModeName"));
      return;
    }
    const description = modeEditDescription
      ? modeEditDescription.value.trim()
      : "";
    const tools =
      modeEditTools && modeEditTools.value === "readonly"
        ? "readonly"
        : "agent";
    const prompt = modeEditPrompt ? modeEditPrompt.value.trim() : "";
    const color = getModeEditColor();
    const existing =
      modeEditIndex >= 0 ? settingsModes[modeEditIndex] : null;
    let id = existing && existing.id ? existing.id : slugifyModeId(label);
    const isBuiltin =
      Boolean(existing?.builtin) || ["agent", "plan", "ask"].includes(id);
    if (!existing) {
      const taken = new Set(settingsModes.map((m) => m.id));
      const base = id;
      let n = 2;
      while (taken.has(id) || ["agent", "plan", "ask"].includes(id)) {
        id = `${base}-${n}`;
        n += 1;
      }
    }
    const next = {
      id,
      label,
      description,
      tools,
      prompt,
      color,
      enabled: true,
      builtin: isBuiltin,
      overridden: true,
      placeholder:
        existing?.placeholder ||
        (tools === "readonly"
          ? `${label}... (@ for file)`
          : `Task (${label})... (@ for file)`),
    };
    if (existing && modeEditIndex >= 0) {
      settingsModes[modeEditIndex] = next;
    } else {
      settingsModes.push(next);
    }
    chatModes = settingsModes.filter((m) => m.enabled !== false);
    syncModeAccentStyles();
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    closeModeEditModal();
    persistModesNow();
    if (modeEditSource === "composer" && typeof setAgentMode === "function") {
      setAgentMode(id, { focus: true });
    } else if (typeof setAgentMode === "function" && agentMode === id) {
      setAgentMode(id, { close: false, notify: false });
    }
  }

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

  const CLOUD_DOWNLOAD_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">cloud_download</span>';

  const INFO_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">info</span>';

  const HEART_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">favorite</span>';

  const REGENERATE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">refresh</span>';

  const BRANCH_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">fork_right</span>';

  const COPY_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">content_copy</span>';

  let chatSearchOpen = false;
  let chatSearchScope = "current";
  let chatSearchRequestId = 0;
  let chatSearchTimer = null;
  let chatSearchHits = [];
  let chatSearchActiveIndex = -1;
  let chatSearchHighlightTimer = null;
  let chatSearchPendingRequestId = "";
  let pendingHighlightIndex = null;
  let pendingOpenSearch = null;
  let chatSearchMatchEls = [];
  let chatSearchMatchIndex = -1;
  let restoringChatScroll = false;
  let pendingScrollSync = 0;
  /** Follow live output only while the viewport is pinned to the bottom. */
  let stickToBottom = true;
  const NEAR_BOTTOM_PX = 80;
  let scrollBottomRaf = 0;

  function localizeStaticUi() {
    document.title = "Harbor Agents";
    const agentTitles = document.querySelectorAll(".agents-title");
    if (agentTitles[0]) agentTitles[0].textContent = t("agents");
    if (agentTitles[1]) agentTitles[1].textContent = t("archive");
    if (openSettingsBtn) {
      openSettingsBtn.title =
        openSettingsBtn.setAttribute("aria-label", t("settings")) || t("settings");
    }
    if (openArchiveBtn) {
      openArchiveBtn.title =
        openArchiveBtn.setAttribute("aria-label", t("archive")) || t("archive");
    }
    if (newAgentBtn) {
      newAgentBtn.title =
        newAgentBtn.setAttribute("aria-label", t("newAgent")) || t("newAgent");
    }
    if (chatNewAgentBtn) {
      chatNewAgentBtn.title =
        chatNewAgentBtn.setAttribute("aria-label", t("newAgent")) || t("newAgent");
    }
    if (backFromArchiveBtn) {
      backFromArchiveBtn.title =
        backFromArchiveBtn.setAttribute("aria-label", t("backToAgents")) ||
        t("backToAgents");
    }
    if (deleteAllArchiveBtn) {
      deleteAllArchiveBtn.textContent = t("deleteAll");
      deleteAllArchiveBtn.title =
        deleteAllArchiveBtn.setAttribute("aria-label", t("deleteAll")) ||
        t("deleteAll");
    }
    syncAgentsRailToggleUi();
    if (settingsSaveStatus) {
      settingsSaveStatus.textContent = t("saved");
    }
    if (openChatSearchBtn) {
      openChatSearchBtn.title =
        openChatSearchBtn.setAttribute("aria-label", t("searchChat")) ||
        t("searchChat");
    }
    if (closeChatSearchBtn) {
      closeChatSearchBtn.title =
        closeChatSearchBtn.setAttribute("aria-label", t("close")) || t("close");
    }
    chatBranchesEl.setAttribute("aria-label", UI_LANG === "ru" ? "Ветки диалога" : "Conversation branches");
    if (chatSearchInput) {
      chatSearchInput.placeholder = t("search");
      chatSearchInput.setAttribute("aria-label", t("searchChat"));
    }
    if (chatSearchResults) {
      chatSearchResults.setAttribute("aria-label", t("searchResults"));
    }
    promptEl.placeholder = t("taskPlaceholder");
    composerPlusBtn.title = composerPlusBtn.setAttribute("aria-label", t("add")) || t("add");
    composerPlusMenu.querySelectorAll(".composer-plus-item").forEach((item) => {
      const action = item.getAttribute("data-action");
      const label = item.querySelector("span:last-child");
      if (!label) {
        return;
      }
      if (action === "file") {
        label.textContent = t("file");
        item.title = t("attachFile");
      }
    });
    modeTrigger.title = t("mode");
    modelTrigger.title = t("model");
    modeLabel.textContent = t("agent");
    modelLabel.textContent = t("model");
    if (reasonTrigger) {
      reasonTrigger.title = t("intelligence");
    }
    if (reasonLabel) {
      reasonLabel.textContent = t("reasonMedium");
    }
    sendBtn.title = sendBtn.setAttribute("aria-label", t("send")) || t("send");
    if (messageQueueEl) {
      messageQueueEl.setAttribute("aria-label", t("queuePending"));
    }
    composerDropHintEl.querySelector(".composer-drop-hint-text").textContent =
      UI_LANG === "ru" ? "Отпустите файл, чтобы прикрепить" : "Drop file to attach";
    contextRingEl.setAttribute("aria-label", t("contextUsage"));
    chatAgentNameEl.textContent = t("agent");
    const setText = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t(key);
    };
    setText("settingsModelsProvidersTitle", "modelsProviders");
    setText("settingsModesTitle", "modes");
    setText("settingsLanguageTitle", "languageSection");
    setText("settingsAppearanceTitle", "appearanceSection");
    setText("settingsAppearanceNote", "appearanceNote");
    setText("settingsFontSizeLabel", "fontSize");
    setText("settingsFontSizeHint", "fontSizeHint");
    setText("settingsFontPreview", "fontSizePreview");
    setText("settingsCommitTitle", "commitMessages");
    setText("settingsCommitGenerationTitle", "commitGeneration");
    setText("settingsCommitStorageTitle", "commitStorage");
    setText("settingsCommitScopeHint", "commitScopeHint");
    setText("settingsMcpTitle", "mcpServers");
    setText("settingsSkillsTitle", "skillsSection");
    setText("settingsBrowserTitle", "browserAgentTitle");
    setText("settingsAutoglmConnectionTitle", "autoglmConnection");
    setText("settingsAgentTitle", "agentBehavior");
    setText("settingsLimitsTitle", "agentLimits");
    setText("settingsExecutionTitle", "agentExecution");
    setText("settingsInterfaceTitle", "agentInterface");
    setText("settingsAdvancedTitle", "advancedSettings");
    document.querySelectorAll("[data-i18n-nav]").forEach((el) => {
      const key = el.getAttribute("data-i18n-nav");
      if (key && t(key)) el.textContent = t(key);
    });
    const settingsProvidersNote = document.getElementById(
      "settingsProvidersNote"
    );
    if (settingsProvidersNote) {
      settingsProvidersNote.textContent = t("providersNote");
    }
    if (addProviderBtn) addProviderBtn.textContent = t("addProvider");
    if (addModelBtn) addModelBtn.textContent = t("addModel");
    const newProviderIdLabel = document.getElementById(
      "modelEditNewProviderIdLabel"
    );
    const newProviderNameLabel = document.getElementById(
      "modelEditNewProviderNameLabel"
    );
    const newProviderUrlLabel = document.getElementById(
      "modelEditNewProviderUrlLabel"
    );
    const newProviderKeyLabel = document.getElementById(
      "modelEditNewProviderKeyLabel"
    );
    if (newProviderIdLabel) newProviderIdLabel.textContent = t("providerIdLabel");
    if (newProviderNameLabel) {
      newProviderNameLabel.textContent = t("providerNameLabel");
    }
    if (newProviderUrlLabel) newProviderUrlLabel.textContent = t("baseUrl");
    if (newProviderKeyLabel) newProviderKeyLabel.textContent = t("apiKey");
    const providerEditStatusUrlLabel = document.getElementById(
      "providerEditStatusUrlLabel"
    );
    const providerEditStatusUrlHint = document.getElementById(
      "providerEditStatusUrlHint"
    );
    if (providerEditStatusUrlLabel) {
      providerEditStatusUrlLabel.textContent = t("statusUrl");
    }
    if (providerEditStatusUrlHint) {
      providerEditStatusUrlHint.textContent = t("statusUrlHint");
    }
    const providerEditPromptCacheLabel = document.getElementById(
      "providerEditPromptCacheLabel"
    );
    const providerEditPromptCacheHint = document.getElementById(
      "providerEditPromptCacheHint"
    );
    if (providerEditPromptCacheLabel) {
      providerEditPromptCacheLabel.textContent = t("promptCacheLabel");
    }
    if (providerEditPromptCacheHint) {
      providerEditPromptCacheHint.textContent = t("promptCacheHint");
    }
    const modelEditProviderLabel = document.getElementById(
      "modelEditProviderLabel"
    );
    if (modelEditProviderLabel) {
      modelEditProviderLabel.textContent = t("provider");
    }
    if (modelEditTabs) {
      const manualTab = modelEditTabs.querySelector('[data-model-mode="manual"]');
      const apiTab = modelEditTabs.querySelector('[data-model-mode="api"]');
      const jsonTab = modelEditTabs.querySelector('[data-model-mode="json"]');
      if (manualTab) manualTab.textContent = t("fetchModelsManual");
      if (apiTab) apiTab.textContent = t("fetchModelsFromApi");
      if (jsonTab) jsonTab.textContent = t("fetchModelsJson");
    }
    if (modelEditApiNote) modelEditApiNote.textContent = t("fetchModelsApiNote");
    if (modelEditApiFetchBtn) {
      modelEditApiFetchBtn.textContent = t("fetchModels");
    }
    if (modelEditApiSelectNewBtn) {
      modelEditApiSelectNewBtn.textContent = t("fetchModelsSelectNew");
    }
    if (modelEditApiSearchLabel) {
      modelEditApiSearchLabel.textContent = t("fetchModelsFilter");
    }
    if (fetchModelsTitle) fetchModelsTitle.textContent = t("fetchModelsTitle");
    if (fetchModelsNote) fetchModelsNote.textContent = t("fetchModelsNote");
    if (fetchModelsSearchLabel) {
      fetchModelsSearchLabel.textContent = t("fetchModelsFilter");
    }
    if (fetchModelsSelectNewBtn) {
      fetchModelsSelectNewBtn.textContent = t("fetchModelsSelectNew");
    }
    if (fetchModelsAddBtn) {
      fetchModelsAddBtn.textContent = t("fetchModelsAddSelected");
    }
    if (fetchModelsCancelBtn) fetchModelsCancelBtn.textContent = t("cancel");
    const settingsModesNote = document.getElementById("settingsModesNote");
    if (settingsModesNote) settingsModesNote.textContent = t("modesNote");
    const addModeBtnEl = document.getElementById("addModeBtn");
    if (addModeBtnEl) addModeBtnEl.textContent = t("addModeShort");
    applyModeEditModalStrings();
    const settingsLanguageLabel = document.getElementById(
      "settingsLanguageLabel"
    );
    if (settingsLanguageLabel) {
      settingsLanguageLabel.textContent = t("pluginUiLanguage");
    }
    if (settingsLanguage) {
      const autoOpt = settingsLanguage.querySelector('option[value="auto"]');
      const enOpt = settingsLanguage.querySelector('option[value="en"]');
      const ruOpt = settingsLanguage.querySelector('option[value="ru"]');
      if (autoOpt) {
        autoOpt.textContent = harborHostAvailable()
          ? UI_LANG === "ru"
            ? "Авто (как в IDE)"
            : "Auto (follow IDE)"
          : t("languageAuto");
      }
      if (enOpt) enOpt.textContent = t("languageEn");
      if (ruOpt) ruOpt.textContent = t("languageRu");
    }
    if (settingsFontSize) {
      applyUiFontSize(settingsFontSize.value);
    }
    const settingsTlsValidateLabel = document.getElementById(
      "settingsTlsValidateLabel"
    );
    if (settingsTlsValidateLabel) {
      settingsTlsValidateLabel.textContent = t("validateTls");
    }
    const modelEditVisionLabel = document.getElementById(
      "modelEditVisionLabel"
    );
    if (modelEditVisionLabel) {
      modelEditVisionLabel.textContent = t("supportsVision");
    }
    const settingsSystemPromptLabel = document.getElementById(
      "settingsSystemPromptLabel"
    );
    if (settingsSystemPromptLabel) {
      settingsSystemPromptLabel.textContent = t("systemPrompt");
    }
    const settingsMaxToolRoundsLabel = document.getElementById(
      "settingsMaxToolRoundsLabel"
    );
    if (settingsMaxToolRoundsLabel) {
      settingsMaxToolRoundsLabel.textContent = t("maxToolRounds");
    }
    const settingsMaxTokensLabel = document.getElementById(
      "settingsMaxTokensLabel"
    );
    if (settingsMaxTokensLabel) {
      settingsMaxTokensLabel.textContent = t("maxTokens");
    }
    setText("settingsMaxTokensHint", "maxTokensHint");
    const settingsMaxResponseCharsLabel = document.getElementById(
      "settingsMaxResponseCharsLabel"
    );
    if (settingsMaxResponseCharsLabel) {
      settingsMaxResponseCharsLabel.textContent = t("maxResponseLength");
    }
    setText("settingsMaxResponseCharsHint", "maxResponseCharsHint");
    const settingsSoundNotificationsLabel = document.getElementById(
      "settingsSoundNotificationsLabel"
    );
    if (settingsSoundNotificationsLabel) {
      settingsSoundNotificationsLabel.textContent = t("soundNotifications");
    }
    setText("settingsSoundNotificationsNote", "soundNotificationsNote");
    const settingsSubagentsLabel = document.getElementById(
      "settingsSubagentsLabel"
    );
    if (settingsSubagentsLabel) {
      settingsSubagentsLabel.textContent = t("parallelAgents");
    }
    const settingsSubagentsNote = document.getElementById(
      "settingsSubagentsNote"
    );
    if (settingsSubagentsNote) {
      settingsSubagentsNote.textContent = t("parallelAgentsNote");
    }
    const settingsParallelToolCallsLabel = document.getElementById(
      "settingsParallelToolCallsLabel"
    );
    if (settingsParallelToolCallsLabel) {
      settingsParallelToolCallsLabel.textContent = t("parallelToolCalls");
    }
    const settingsParallelToolCallsNote = document.getElementById(
      "settingsParallelToolCallsNote"
    );
    if (settingsParallelToolCallsNote) {
      settingsParallelToolCallsNote.textContent = t("parallelToolCallsNote");
    }
    const settingsAutoCompactLabel = document.getElementById(
      "settingsAutoCompactLabel"
    );
    if (settingsAutoCompactLabel) {
      settingsAutoCompactLabel.textContent = t("autoCompact");
    }
    const settingsAutoCompactNote = document.getElementById(
      "settingsAutoCompactNote"
    );
    if (settingsAutoCompactNote) {
      settingsAutoCompactNote.textContent = t("autoCompactNote");
    }
    const settingsToolsAutoApproveLabel = document.getElementById(
      "settingsToolsAutoApproveLabel"
    );
    if (settingsToolsAutoApproveLabel) {
      settingsToolsAutoApproveLabel.textContent = t("toolsAutoApprove");
    }
    const settingsToolsAutoApproveNote = document.getElementById(
      "settingsToolsAutoApproveNote"
    );
    if (settingsToolsAutoApproveNote) {
      settingsToolsAutoApproveNote.textContent = t("toolsAutoApproveNote");
    }
    const approvalGroups = [
      "Reads",
      "Web",
      "Edits",
      "Commands",
      "Mcp",
      "Subagents",
    ];
    const approvalKeyByGroup = {
      Reads: "approvalReads",
      Web: "approvalWeb",
      Edits: "approvalEdits",
      Commands: "approvalCommands",
      Mcp: "approvalMcp",
      Subagents: "approvalSubagents",
    };
    const approvalOptionLabels = {
      inherit: t("approvalInherit"),
      auto: t("approvalAuto"),
      ask: t("approvalAsk"),
    };
    for (const group of approvalGroups) {
      const label = document.getElementById(`settingsApproval${group}Label`);
      if (label) {
        label.textContent = t(approvalKeyByGroup[group]);
      }
      const note = document.getElementById(`settingsApproval${group}Note`);
      if (note) {
        note.textContent = t(`${approvalKeyByGroup[group]}Note`);
      }
      const select = document.getElementById(
        `settingsApproval${group}`
      );
      if (select) {
        for (const option of select.options || []) {
          const optionLabel = approvalOptionLabels[option.value];
          if (optionLabel) {
            option.textContent = optionLabel;
          }
        }
      }
    }
    const settingsFocusChainLabel = document.getElementById(
      "settingsFocusChainLabel"
    );
    if (settingsFocusChainLabel) {
      settingsFocusChainLabel.textContent = t("focusChain");
    }
    const settingsFocusChainNote = document.getElementById(
      "settingsFocusChainNote"
    );
    if (settingsFocusChainNote) {
      settingsFocusChainNote.textContent = t("focusChainNote");
    }
    const settingsTurnContextLabel = document.getElementById(
      "settingsTurnContextLabel"
    );
    if (settingsTurnContextLabel) {
      settingsTurnContextLabel.textContent = t("turnContext");
    }
    const settingsTurnContextNote = document.getElementById(
      "settingsTurnContextNote"
    );
    if (settingsTurnContextNote) {
      settingsTurnContextNote.textContent = t("turnContextNote");
    }
    const turnContextOptionLabels = {
      full: t("turnContextFull"),
      slim: t("turnContextSlim"),
      none: t("turnContextNone"),
    };
    const settingsTurnContextSelect = document.getElementById(
      "settingsTurnContextFollowUps"
    );
    if (settingsTurnContextSelect) {
      for (const option of settingsTurnContextSelect.options || []) {
        const optionLabel = turnContextOptionLabels[option.value];
        if (optionLabel) {
          option.textContent = optionLabel;
        }
      }
    }
    const settingsCheckpointsLabel = document.getElementById(
      "settingsCheckpointsLabel"
    );
    if (settingsCheckpointsLabel) {
      settingsCheckpointsLabel.textContent = t("checkpoints");
    }
    const settingsCheckpointsNote = document.getElementById(
      "settingsCheckpointsNote"
    );
    if (settingsCheckpointsNote) {
      settingsCheckpointsNote.textContent = t("checkpointsNote");
    }
    const settingsTabAutocompleteTitle = document.getElementById(
      "settingsTabAutocompleteTitle"
    );
    if (settingsTabAutocompleteTitle) {
      settingsTabAutocompleteTitle.textContent = t("tabAutocomplete");
    }
    const settingsTabAutocompleteLabel = document.getElementById(
      "settingsTabAutocompleteLabel"
    );
    if (settingsTabAutocompleteLabel) {
      settingsTabAutocompleteLabel.textContent = t("tabAutocompleteEnable");
    }
    const settingsTabAutocompleteNote = document.getElementById(
      "settingsTabAutocompleteNote"
    );
    if (settingsTabAutocompleteNote) {
      settingsTabAutocompleteNote.textContent = t("tabAutocompleteNote");
    }
    const settingsTabAutocompleteModelLabel = document.getElementById(
      "settingsTabAutocompleteModelLabel"
    );
    if (settingsTabAutocompleteModelLabel) {
      settingsTabAutocompleteModelLabel.textContent = t("tabAutocompleteModel");
    }
    const settingsTabAutocompleteModelHint = document.getElementById(
      "settingsTabAutocompleteModelHint"
    );
    if (settingsTabAutocompleteModelHint) {
      settingsTabAutocompleteModelHint.textContent = t(
        "tabAutocompleteModelHint"
      );
    }
    const settingsTabAutocompleteAggLabel = document.getElementById(
      "settingsTabAutocompleteAggLabel"
    );
    if (settingsTabAutocompleteAggLabel) {
      settingsTabAutocompleteAggLabel.textContent = t("tabAutocompleteAgg");
    }
    if (settingsTabAutocompleteAggressiveness) {
      const optLow = settingsTabAutocompleteAggressiveness.querySelector(
        'option[value="low"]'
      );
      const optMed = settingsTabAutocompleteAggressiveness.querySelector(
        'option[value="medium"]'
      );
      const optHigh = settingsTabAutocompleteAggressiveness.querySelector(
        'option[value="high"]'
      );
      if (optLow) optLow.textContent = t("tabAutocompleteAggLow");
      if (optMed) optMed.textContent = t("tabAutocompleteAggMedium");
      if (optHigh) optHigh.textContent = t("tabAutocompleteAggHigh");
    }
    const settingsTabAutocompleteAltsLabel = document.getElementById(
      "settingsTabAutocompleteAltsLabel"
    );
    if (settingsTabAutocompleteAltsLabel) {
      settingsTabAutocompleteAltsLabel.textContent = t("tabAutocompleteAlts");
    }
    if (settingsTabAutocompleteAlternatives) {
      const a1 = settingsTabAutocompleteAlternatives.querySelector(
        'option[value="1"]'
      );
      const a2 = settingsTabAutocompleteAlternatives.querySelector(
        'option[value="2"]'
      );
      const a3 = settingsTabAutocompleteAlternatives.querySelector(
        'option[value="3"]'
      );
      if (a1) a1.textContent = t("tabAutocompleteAlts1");
      if (a2) a2.textContent = t("tabAutocompleteAlts2");
      if (a3) a3.textContent = t("tabAutocompleteAlts3");
    }
    const settingsTabAutocompleteAltsHint = document.getElementById(
      "settingsTabAutocompleteAltsHint"
    );
    if (settingsTabAutocompleteAltsHint) {
      settingsTabAutocompleteAltsHint.textContent = t("tabAutocompleteAltsHint");
    }
    const settingsTabAutocompleteExcludeLabel = document.getElementById(
      "settingsTabAutocompleteExcludeLabel"
    );
    if (settingsTabAutocompleteExcludeLabel) {
      settingsTabAutocompleteExcludeLabel.textContent = t(
        "tabAutocompleteExclude"
      );
    }
    const settingsTabAutocompleteExcludeHint = document.getElementById(
      "settingsTabAutocompleteExcludeHint"
    );
    if (settingsTabAutocompleteExcludeHint) {
      settingsTabAutocompleteExcludeHint.textContent = t(
        "tabAutocompleteExcludeHint"
      );
    }
    const settingsTabAutocompleteNextEditLabel = document.getElementById(
      "settingsTabAutocompleteNextEditLabel"
    );
    if (settingsTabAutocompleteNextEditLabel) {
      settingsTabAutocompleteNextEditLabel.textContent = t(
        "tabAutocompleteNextEdit"
      );
    }
    const settingsTabAutocompleteNextEditHint = document.getElementById(
      "settingsTabAutocompleteNextEditHint"
    );
    if (settingsTabAutocompleteNextEditHint) {
      settingsTabAutocompleteNextEditHint.textContent = t(
        "tabAutocompleteNextEditHint"
      );
    }
    const settingsTabAutocompleteShowModeLabel = document.getElementById(
      "settingsTabAutocompleteShowModeLabel"
    );
    if (settingsTabAutocompleteShowModeLabel) {
      settingsTabAutocompleteShowModeLabel.textContent = t(
        "tabAutocompleteShowMode"
      );
    }
    if (settingsTabAutocompleteShowMode) {
      const chip = settingsTabAutocompleteShowMode.querySelector(
        'option[value="chip"]'
      );
      const inline = settingsTabAutocompleteShowMode.querySelector(
        'option[value="inline"]'
      );
      if (chip) chip.textContent = t("tabAutocompleteShowModeChip");
      if (inline) inline.textContent = t("tabAutocompleteShowModeInline");
    }
    const settingsTabAutocompleteShowModeHint = document.getElementById(
      "settingsTabAutocompleteShowModeHint"
    );
    if (settingsTabAutocompleteShowModeHint) {
      settingsTabAutocompleteShowModeHint.textContent = t(
        "tabAutocompleteShowModeHint"
      );
    }
    const settingsTabAutocompleteFimLabel = document.getElementById(
      "settingsTabAutocompleteFimLabel"
    );
    if (settingsTabAutocompleteFimLabel) {
      settingsTabAutocompleteFimLabel.textContent = t("tabAutocompleteFim");
    }
    const settingsTabAutocompleteFimHint = document.getElementById(
      "settingsTabAutocompleteFimHint"
    );
    if (settingsTabAutocompleteFimHint) {
      settingsTabAutocompleteFimHint.textContent = t("tabAutocompleteFimHint");
    }
    const settingsTabAutocompleteKeysHint = document.getElementById(
      "settingsTabAutocompleteKeysHint"
    );
    if (settingsTabAutocompleteKeysHint) {
      settingsTabAutocompleteKeysHint.textContent = t("tabAutocompleteKeysHint");
    }
    const settingsSelectionHintsLabel = document.getElementById(
      "settingsSelectionHintsLabel"
    );
    if (settingsSelectionHintsLabel) {
      settingsSelectionHintsLabel.textContent = t("selectionHints");
    }
    setText("settingsSelectionHintsNote", "selectionHintsNote");
    updateSystemPromptPreview();
    updateTabExcludePreview();
    if (settingsMcpNote) settingsMcpNote.textContent = t("mcpServersNote");
    const settingsSkillsNote = document.getElementById("settingsSkillsNote");
    if (settingsSkillsNote) settingsSkillsNote.textContent = t("skillsNote");
    setText("skillsRefreshLabel", "skillsRefresh");
    setText("skillsFoldersTitle", "skillsFoldersTitle");
    setText("skillsFoldersDisabledHint", "skillsFoldersDisabledHint");
    const settingsBrowserNote = document.getElementById("settingsBrowserNote");
    if (settingsBrowserNote) {
      settingsBrowserNote.textContent = t("browserAgentNote");
    }
    setText("settingsAutoglmEnabledLabel", "autoglmEnabled");
    setText("settingsAutoglmEnabledNote", "autoglmEnabledNote");
    setText("settingsAutoglmAutoApproveLabel", "autoglmAutoApprove");
    setText("settingsAutoglmAutoApproveNote", "autoglmAutoApproveNote");
    setText("settingsAutoglmBrowserLabel", "autoglmBrowser");
    setText("settingsAutoglmBrowserHint", "autoglmBrowserHint");
    setText("settingsAutoglmBinaryPathLabel", "autoglmBinaryPath");
    setText("settingsAutoglmBinaryPathHint", "autoglmBinaryPathHint");
    if (settingsAutoglmBinaryPath) {
      settingsAutoglmBinaryPath.placeholder = t("autoglmBinaryPathPlaceholder");
    }
    if (mcpConfiguredTitle) mcpConfiguredTitle.textContent = t("mcpConfigured");
    if (mcpSearchInput) {
      mcpSearchInput.placeholder = t("mcpSearchPlaceholder");
    }
    if (mcpAddBtn) {
      mcpAddBtn.title = mcpAddBtn.setAttribute("aria-label", t("add")) || t("add");
    }
    if (mcpPresetsLabel) mcpPresetsLabel.textContent = t("mcpPresetsLabel");
    if (mcpPresetPlaywright) {
      const label = mcpPresetPlaywright.querySelector(".mcp-preset-btn-label");
      if (label) label.textContent = t("mcpPresetPlaywright");
    }
    if (mcpPresetGithub) {
      const label = mcpPresetGithub.querySelector(".mcp-preset-btn-label");
      if (label) label.textContent = t("mcpPresetGithub");
    }
    if (mcpEditNote) mcpEditNote.textContent = t("mcpEditNote");
    if (settingsFigmaConnectBtn) {
      settingsFigmaConnectBtn.textContent = t("figmaConnect");
    }
    if (settingsFigmaDisconnectBtn) {
      settingsFigmaDisconnectBtn.textContent = t("figmaDisconnect");
    }
    if (settingsFigmaPatNote) {
      settingsFigmaPatNote.textContent = t("figmaPatNote");
    }
    if (settingsFigmaPatLabel) {
      settingsFigmaPatLabel.textContent = t("figmaPatLabel");
    }
    if (settingsFigmaPatConnectBtn) {
      settingsFigmaPatConnectBtn.textContent = t("figmaPatConnect");
    }
    if (settingsFigmaPatHelpBtn) {
      settingsFigmaPatHelpBtn.textContent = t("figmaOpenTokenHelp");
    }
    renderFigmaStatus(figmaStatus);
    if (settingsCommitNote) {
      settingsCommitNote.textContent = t("commitMessagesNote");
    }
    if (settingsCommitScopeLabel) {
      settingsCommitScopeLabel.textContent = t("commitScope");
    }
    if (settingsCommitLanguageLabel) {
      settingsCommitLanguageLabel.textContent = t("commitLanguage");
    }
    if (settingsCommitModelsLabel) {
      settingsCommitModelsLabel.textContent = t("commitModels");
    }
    if (settingsCommitPromptLabel) {
      settingsCommitPromptLabel.textContent = t("commitPrompt");
    }
    if (settingsCommitPrompt) {
      settingsCommitPrompt.placeholder = t("commitPromptPlaceholder");
    }
    updateCommitPromptPreview();
    if (settingsCommitScope) {
      const globalOpt = settingsCommitScope.querySelector(
        'option[value="global"]'
      );
      if (globalOpt) globalOpt.textContent = t("commitScopeGlobal");
      updateCommitScopeWorkspaceOption();
    }
    if (settingsCommitLanguage) {
      const autoOpt = settingsCommitLanguage.querySelector(
        'option[value="auto"]'
      );
      const enOpt = settingsCommitLanguage.querySelector('option[value="en"]');
      const ruOpt = settingsCommitLanguage.querySelector('option[value="ru"]');
      if (autoOpt) autoOpt.textContent = t("commitLanguageAuto");
      if (enOpt) enOpt.textContent = t("languageEn");
      if (ruOpt) ruOpt.textContent = t("languageRu");
    }
  }

  localizeStaticUi();

  function localizeModeMeta(meta) {
    if (!meta || typeof meta !== "object") {
      return meta;
    }
    if (meta.id === "agent") {
      return {
        ...meta,
        label: t("agent"),
        description: UI_LANG === "ru" ? "Читает и правит код" : "Reads and edits code",
        placeholder: t("taskPlaceholder"),
      };
    }
    if (meta.id === "plan") {
      return {
        ...meta,
        label: t("plan"),
        description: UI_LANG === "ru" ? "Только план, без правок" : "Plan only, no edits",
        placeholder:
          UI_LANG === "ru"
            ? "Опишите задачу — агент составит план без правок… (@ — файл)"
            : "Describe the task — the agent will draft a plan without edits... (@ for file)",
      };
    }
    if (meta.id === "ask") {
      return {
        ...meta,
        label: t("ask"),
        description: UI_LANG === "ru" ? "Ответы и объяснения" : "Answers and explanations",
        placeholder:
          UI_LANG === "ru"
            ? "Спросите про код или задачу… (@ — файл)"
            : "Ask about code or a task... (@ for file)",
      };
    }
    return meta;
  }

  const DEFAULT_MODELS = [
    {
      id: "DeepSeek-V4-Flash",
      label: "DeepSeek V4 Flash",
      supportsVision: false,
    },
    {
      id: "Qwen3-Coder-Next",
      label: "Qwen3 Coder Next",
      supportsVision: false,
    },
    { id: "Gemma-4-31b", label: "Gemma 4 31B", supportsVision: false },
    {
      id: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      supportsVision: true,
    },
    { id: "gpt-4.1", label: "GPT-4.1", supportsVision: true },
    {
      id: "Gemini 2.5 Flash",
      label: "Gemini 2.5 Flash",
      supportsVision: true,
    },
  ];

  const KNOWN_VISION_SUPPORT = {
    "DeepSeek-V4-Flash": false,
    "Qwen3-Coder-Next": false,
    "Gemma-4-31b": false,
    "claude-sonnet-4-5": true,
    "gpt-4.1": true,
    "Gemini 2.5 Flash": true,
  };

  function guessModelSupportsVision(modelId) {
    const id = String(modelId || "").trim();
    if (!id) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(KNOWN_VISION_SUPPORT, id)) {
      return KNOWN_VISION_SUPPORT[id];
    }
    const lower = id.toLowerCase();
    if (
      /deepseek|coder|codestral|codellama|code-llama|starcoder|qwen3-coder/.test(
        lower
      )
    ) {
      return false;
    }
    if (
      /gpt-4o|gpt-4\.1|gpt-5|o[1-9]|claude|gemini|llava|vision|pixtral|gpt-image/.test(
        lower
      )
    ) {
      return true;
    }
    if (/gemma-3|gemma3/.test(lower)) {
      return true;
    }
    return false;
  }

  function resolveModelSupportsVision(model) {
    if (!model) {
      return false;
    }
    const id = typeof model === "string" ? model : model.id;
    const stored =
      typeof model === "string"
        ? models.find((m) => m.id === model)?.supportsVision
        : model.supportsVision;
    if (stored === true) {
      return true;
    }
    return guessModelSupportsVision(id);
  }

  let busy = false;
  let canRegenerate = false;
  let uiMessagesCache = [];
  let pendingAttachments = [];
  let pendingSelections = [];
  /** @type {Array<{id: string, path: string, startLine: number, endLine: number}>} */
  let pendingMentions = [];
  /** @type {Map<string, Array<{id: string, text: string, attachments: any[], mode: string, model: string, reasoningEffort?: string}>>} */
  const messageQueues = new Map();
  const MAX_MESSAGE_QUEUE = 10;
  let drainingQueue = false;
  let drainScheduled = false;
  let mentionOpen = false;
  let mentionItems = [];
  let mentionActiveIndex = 0;
  let mentionRequestId = 0;
  let mentionQuery = "";
  let mentionStart = -1;
  /** @type {HTMLTextAreaElement | null} */
  let mentionTarget = null;
  let mentionSearchTimer = null;
  let slashOpen = false;
  let slashItems = [];
  let slashActiveIndex = 0;
  let slashQuery = "";
  let slashStart = -1;
  let editingUserIndex = null;
  let editingUserText = "";
  let editingModelId = "";
  let editingModeId = "";
  let editingReasoningEffort = "";
  let editingAttachments = [];
  let editModelMenuOpen = false;
  let editModeMenuOpen = false;
  let editPlusMenuOpen = false;
  let editReasonMenuOpen = false;
  /** True while a host file picker was opened from the edit-composer "+" button. */
  let pickAttachmentsForEdit = false;
  let harborEditPickerOpenedAt = 0;
  /** Timestamp of last edit-save / regenerate / branch pointer or submit. */
  let harborEditSaveAt = 0;
  /** Timestamp of last JetBrains pointerdown for agents-rail / branch-pill switch. */
  let harborAgentNavAt = 0;
  let models = DEFAULT_MODELS.slice();
  let selectedModelId = "";
  let menuOpen = false;
  let plusMenuOpen = false;
  let modeMenuOpen = false;
  let reasonMenuOpen = false;
  let agentMode = "agent";
  let selectedReasoningEffort = "medium";
  let modeEditIndex = null;
  let modeEditSource = "settings";
  let chatModes = [];
  let streamingEl = null;
  let streamingRenderScheduled = false;
  let composerDragDepth = 0;

  const MAX_PENDING_ATTACHMENTS = 8;
  const MAX_PENDING_SELECTIONS = 8;
  const MAX_PENDING_MENTIONS = 8;

  function buildSlashInitPrompt(args) {
    const target = String(args || "").trim();
    return target ? t("slashInitWithTarget", target) : t("slashInitDefault");
  }


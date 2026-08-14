
  window.addEventListener("dragend", clearComposerDropState);

  function extractClipboardImages(clipboardData) {
    const files = [];
    const seen = new Set();
    const push = (file) => {
      if (!file) {
        return;
      }
      const key = `${file.name}:${file.size}:${file.type}:${file.lastModified || 0}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      files.push(file);
    };

    if (clipboardData?.files?.length) {
      for (const file of Array.from(clipboardData.files)) {
        if (!file.type || file.type.startsWith("image/")) {
          push(file);
        }
      }
    }

    const items = clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type && item.type.startsWith("image/")) {
          push(item.getAsFile());
        }
      }
    }
    return files;
  }

  async function readClipboardImagesFallback() {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
      return [];
    }
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const item of items) {
        for (const type of item.types) {
          if (!type.startsWith("image/")) {
            continue;
          }
          const blob = await item.getType(type);
          const ext = type.split("/")[1] || "png";
          files.push(
            new File([blob], `clipboard.${ext}`, {
              type,
              lastModified: Date.now(),
            })
          );
        }
      }
      return files;
    } catch {
      return [];
    }
  }

  async function handleChatImagePaste(event) {
    if (!chatScreen || chatScreen.hidden) {
      return;
    }
    let imageFiles = extractClipboardImages(event.clipboardData);
    if (!imageFiles.length) {
      imageFiles = await readClipboardImagesFallback();
    }
    if (!imageFiles.length) {
      // JCEF / JetBrains: clipboard images rarely appear in paste event —
      // ask the IDE host to read the system clipboard.
      if (harborHostAvailable()) {
        event.preventDefault();
        event.stopPropagation();
        host.postMessage({ type: "requestClipboardImage" });
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await ingestDroppedFiles(imageFiles);
    if (promptEl && typeof promptEl.focus === "function") {
      promptEl.focus();
    }
  }

  // Capture на document: работает не только когда фокус в textarea
  document.addEventListener(
    "paste",
    (event) => {
      void handleChatImagePaste(event);
    },
    true
  );

  // На случай, если paste пришёл до фокуса webview — подхватим после фокуса по Cmd/Ctrl+V
  document.addEventListener("keydown", (event) => {
    const isPaste =
      (event.key === "v" || event.key === "V" || event.code === "KeyV") &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPaste || !chatScreen || chatScreen.hidden) {
      return;
    }
    // Если фокус не в поле ввода — всё равно даём шанс прочитать буфер
    const active = document.activeElement;
    const inPrompt = active === promptEl;
    if (inPrompt) {
      // Still help JetBrains: paste event may arrive empty for images.
      if (harborHostAvailable()) {
        // Let native paste run for text; also probe host clipboard for images.
        // Host will no-op if clipboard has no image.
        setTimeout(() => {
          host.postMessage({ type: "requestClipboardImage" });
        }, 0);
      }
      return;
    }
    void (async () => {
      const imageFiles = await readClipboardImagesFallback();
      if (imageFiles.length) {
        event.preventDefault();
        await ingestDroppedFiles(imageFiles);
        if (promptEl && typeof promptEl.focus === "function") {
          promptEl.focus();
        }
        return;
      }
      if (harborHostAvailable()) {
        host.postMessage({ type: "requestClipboardImage" });
      }
    })();
  });

  if (newAgentBtn) {
    newAgentBtn.addEventListener("click", () => {
      host.postMessage({ type: "newAgent" });
    });
  }

  if (chatNewAgentBtn) {
    chatNewAgentBtn.addEventListener("click", () => {
      host.postMessage({ type: "newAgent" });
    });
  }

  if (openArchiveBtn) {
    openArchiveBtn.addEventListener("click", () => {
      host.postMessage({ type: "showArchive" });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      host.postMessage({ type: "showSettings" });
    });
  }

  if (backFromArchiveBtn) {
    backFromArchiveBtn.addEventListener("click", () => {
      host.postMessage({ type: "showAgents" });
    });
  }

  if (deleteAllArchiveBtn) {
    deleteAllArchiveBtn.addEventListener("click", () => {
      host.postMessage({ type: "deleteAllArchived" });
    });
  }

  const settingsBody = document.getElementById("settingsBody");
  if (settingsSystemPromptToggle && settingsSystemPromptCard) {
    settingsSystemPromptToggle.addEventListener("click", () => {
      const open = !settingsSystemPromptCard.classList.contains("is-open");
      settingsSystemPromptCard.classList.toggle("is-open", open);
      settingsSystemPromptToggle.setAttribute(
        "aria-expanded",
        open ? "true" : "false"
      );
      if (settingsSystemPromptBody) {
        settingsSystemPromptBody.hidden = !open;
      }
      if (open && settingsSystemPrompt) {
        settingsSystemPrompt.focus();
      }
    });
  }
  if (settingsTabExcludeToggle && settingsTabExcludeCard) {
    settingsTabExcludeToggle.addEventListener("click", () => {
      const open = !settingsTabExcludeCard.classList.contains("is-open");
      settingsTabExcludeCard.classList.toggle("is-open", open);
      settingsTabExcludeToggle.setAttribute(
        "aria-expanded",
        open ? "true" : "false"
      );
      if (settingsTabExcludeBody) {
        settingsTabExcludeBody.hidden = !open;
      }
      if (open && settingsTabAutocompleteExcludeGlobs) {
        settingsTabAutocompleteExcludeGlobs.focus();
      }
    });
  }
  if (settingsCommitPromptToggle && settingsCommitPromptCard) {
    settingsCommitPromptToggle.addEventListener("click", () => {
      const open = !settingsCommitPromptCard.classList.contains("is-open");
      settingsCommitPromptCard.classList.toggle("is-open", open);
      settingsCommitPromptToggle.setAttribute(
        "aria-expanded",
        open ? "true" : "false"
      );
      if (settingsCommitPromptBody) {
        settingsCommitPromptBody.hidden = !open;
      }
      if (open && settingsCommitPrompt) {
        settingsCommitPrompt.focus();
      }
    });
  }
  if (settingsBody) {
    settingsBody.addEventListener("scroll", hideSettingsModelTip, { passive: true });
    settingsBody.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest(
          "#settingsSystemPrompt, #settingsCommitPrompt, #settingsMaxToolRounds, #settingsMaxTokens, #settingsMaxResponseChars, #settingsFontSize, #settingsAutoglmBinaryPath, #settingsTabAutocompleteExcludeGlobs"
        )
      ) {
        if (target.closest("#settingsSystemPrompt")) {
          updateSystemPromptPreview();
        }
        if (target.closest("#settingsCommitPrompt")) {
          updateCommitPromptPreview();
        }
        if (target.closest("#settingsTabAutocompleteExcludeGlobs")) {
          updateTabExcludePreview();
        }
        if (target.closest("#settingsFontSize")) {
          applyUiFontSize(settingsFontSize.value);
        }
        schedulePersistSettings();
      }
    });
    settingsBody.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest(
          "#settingsRejectUnauthorized, #settingsSoundNotificationsEnabled, #settingsSubagentsEnabled, #settingsParallelToolCallsEnabled, #settingsAutoCompactEnabled, #settingsToolsAutoApprove, #settingsCheckpointsEnabled, #settingsTabAutocompleteEnabled, #settingsTabAutocompleteModel, #settingsTabAutocompleteAggressiveness, #settingsTabAutocompleteAlternatives, #settingsTabAutocompleteNextEdit, #settingsTabAutocompleteShowMode, #settingsTabAutocompleteFim, #settingsSelectionHintsEnabled, #settingsCommitScope, #settingsCommitLanguage, #settingsCommitModel, #settingsAutoglmEnabled, #settingsAutoglmBrowser, #settingsAutoglmAutoApprove"
        )
      ) {
        persistSettingsNow();
      }
    });
  }

  if (skillsRefreshBtn) {
    skillsRefreshBtn.addEventListener("click", () => {
      host.postMessage({ type: "skillsRefreshList" });
    });
  }
  if (skillsFoldersList) {
    skillsFoldersList.addEventListener("click", (event) => {
      const openBtn = event.target.closest("[data-skills-open]");
      if (openBtn) {
        const path = openBtn.getAttribute("data-skills-open") || "";
        if (path) {
          host.postMessage({ type: "skillsOpenPath", path });
        }
        return;
      }
      const removeBtn = event.target.closest("[data-skills-remove-dir]");
      if (removeBtn) {
        const path = removeBtn.getAttribute("data-skills-remove-dir") || "";
        if (path) {
          host.postMessage({ type: "skillsRemoveDirectory", path });
        }
      }
    });
    skillsFoldersList.addEventListener("change", (event) => {
      const toggle = event.target.closest("[data-skills-source-toggle]");
      if (!toggle) {
        return;
      }
      const source = toggle.getAttribute("data-skills-source-toggle") || "";
      const path = toggle.getAttribute("data-skills-source-path") || "";
      host.postMessage({
        type: "skillsSetSourceEnabled",
        source,
        path,
        enabled: toggle.checked === true,
      });
    });
  }

  if (openMcpServersBtn) {
    openMcpServersBtn.addEventListener("click", () => {
      showScreen("settings");
      showSettingsCategory("mcp");
    });
  }
  const settingsNav = document.getElementById("settingsNav");
  if (settingsNav) {
    settingsNav.addEventListener("click", (event) => {
      const btn = event.target.closest(".settings-nav-item");
      if (!btn) {
        return;
      }
      const cat = btn.getAttribute("data-settings-cat");
      if (cat) {
        showSettingsCategory(cat);
      }
    });
  }
  if (backFromMcpBtn) {
    backFromMcpBtn.addEventListener("click", () => {
      closeMcpEditModal();
      showSettingsCategory("models");
    });
  }
  if (mcpSearchInput) {
    mcpSearchInput.addEventListener("input", () => {
      mcpSearchQuery = mcpSearchInput.value || "";
      renderMcpServersList();
    });
  }
  if (mcpAddBtn) {
    mcpAddBtn.addEventListener("click", () => {
      openMcpCustomEditModal("");
    });
  }
  if (mcpPresetPlaywright) {
    mcpPresetPlaywright.addEventListener("click", () => {
      openMcpPreset("playwright");
    });
  }
  if (mcpPresetGithub) {
    mcpPresetGithub.addEventListener("click", () => {
      openMcpPreset("github");
    });
  }
  if (mcpServersList) {
    mcpServersList.addEventListener("click", (event) => {
      const editBtn = event.target.closest(".mcp-edit-btn");
      if (editBtn) {
        openMcpEditModal(editBtn.dataset.id || "figma");
        return;
      }
      const deleteBtn = event.target.closest(".mcp-delete-btn");
      if (deleteBtn) {
        const id = deleteBtn.dataset.id || "";
        host.postMessage({ type: "mcpDeleteServer", id });
      }
    });
    mcpServersList.addEventListener("change", (event) => {
      const toggle = event.target.closest(".mcp-enable-toggle");
      if (!toggle) {
        return;
      }
      const id = toggle.dataset.id || "";
      const enabled = Boolean(toggle.checked);
      if (!enabled) {
        if (id === "figma") {
          figmaStatus = { ...figmaStatus, enabled: false };
        }
        host.postMessage({ type: "mcpSetEnabled", id, enabled: false });
        return;
      }
      if (id === "figma") {
        const server = getMcpServers().find((s) => s.id === "figma");
        const hasCreds =
          Boolean(server && server.hasCredentials) ||
          Boolean(figmaStatus.hasPat);
        if (!hasCreds) {
          toggle.checked = false;
          openMcpEditModal("figma");
          return;
        }
        figmaStatus = { ...figmaStatus, enabled: true };
      }
      host.postMessage({ type: "mcpSetEnabled", id, enabled: true });
    });
  }
  if (mcpEditCloseBtn) {
    mcpEditCloseBtn.addEventListener("click", () => closeMcpEditModal());
  }
  if (mcpEditModal) {
    mcpEditModal.addEventListener("click", (event) => {
      if (event.target?.dataset?.mcpDismiss === "1") {
        closeMcpEditModal();
      }
    });
  }
  if (mcpCustomEditCloseBtn) {
    mcpCustomEditCloseBtn.addEventListener("click", () =>
      closeMcpCustomEditModal()
    );
  }
  if (mcpCustomEditCancelBtn) {
    mcpCustomEditCancelBtn.addEventListener("click", () =>
      closeMcpCustomEditModal()
    );
  }
  if (mcpCustomEditSaveBtn) {
    mcpCustomEditSaveBtn.addEventListener("click", () => saveMcpCustomServer());
  }
  if (mcpCustomTransport) {
    mcpCustomTransport.addEventListener("change", () =>
      syncMcpCustomTransportFields()
    );
  }
  if (mcpCustomEditModal) {
    mcpCustomEditModal.addEventListener("click", (event) => {
      if (event.target?.dataset?.mcpCustomDismiss === "1") {
        closeMcpCustomEditModal();
      }
    });
  }

  if (settingsFigmaConnectBtn) {
    settingsFigmaConnectBtn.addEventListener("click", () => {
      host.postMessage({ type: "figmaConnect" });
    });
  }
  if (settingsFigmaDisconnectBtn) {
    settingsFigmaDisconnectBtn.addEventListener("click", () => {
      host.postMessage({ type: "figmaDisconnect" });
    });
  }
  if (settingsFigmaPatConnectBtn) {
    settingsFigmaPatConnectBtn.addEventListener("click", () => {
      const token = settingsFigmaPat ? settingsFigmaPat.value.trim() : "";
      host.postMessage({ type: "figmaConnectPat", token });
      if (settingsFigmaPat) {
        settingsFigmaPat.value = "";
      }
    });
  }
  if (settingsFigmaPatHelpBtn) {
    settingsFigmaPatHelpBtn.addEventListener("click", () => {
      host.postMessage({
        type: "openExternal",
        url: "https://www.figma.com/settings",
      });
    });
  }

  if (addModelBtn) {
    addModelBtn.addEventListener("click", () => {
      setModelsHint("");
      openModelEditModal(-1);
    });
  }

  if (addModeBtn) {
    addModeBtn.addEventListener("click", () => {
      openModeEditModal(-1, "settings");
    });
  }

  if (settingsModesList) {
    settingsModesList.addEventListener("click", (event) => {
      const editBtn = event.target.closest(".settings-mode-edit");
      if (editBtn) {
        const index = Number(editBtn.dataset.index);
        if (Number.isInteger(index)) {
          openModeEditModal(index, "settings");
        }
        return;
      }
      const removeBtn = event.target.closest(".settings-mode-remove");
      if (removeBtn) {
        const index = Number(removeBtn.dataset.index);
        if (
          !Number.isInteger(index) ||
          !settingsModes[index] ||
          settingsModes[index].builtin
        ) {
          return;
        }
        settingsModes.splice(index, 1);
        chatModes = settingsModes.filter((m) => m.enabled !== false);
        syncModeAccentStyles();
        renderSettingsModes();
        renderModeMenu();
        if (!chatModes.some((m) => m.id === agentMode)) {
          setAgentMode(chatModes[0]?.id || "agent", { close: false });
        }
        persistModesNow();
      }
    });
  }

  if (modeEditDoneBtn) {
    modeEditDoneBtn.addEventListener("click", () => commitModeEdit());
  }
  if (modeEditCancelBtn) {
    modeEditCancelBtn.addEventListener("click", () => closeModeEditModal());
  }
  if (modeEditCloseBtn) {
    modeEditCloseBtn.addEventListener("click", () => closeModeEditModal());
  }
  if (modeEditColorRow) {
    modeEditColorRow.addEventListener("click", (event) => {
      const swatch =
        event.target instanceof Element
          ? event.target.closest(".mode-color-swatch")
          : null;
      if (swatch && modeEditColorRow.contains(swatch)) {
        event.preventDefault();
        setModeEditColor(swatch.getAttribute("data-color") || "");
      }
    });
  }
  if (modeEditColor) {
    modeEditColor.addEventListener("input", () => {
      const color = normalizeModeColorUi(modeEditColor.value);
      if (!modeEditColorRow || !color) {
        return;
      }
      modeEditColorRow.dataset.customActive = "1";
      modeEditColorRow
        .querySelectorAll(".mode-color-swatch")
        .forEach((btn) => btn.classList.remove("is-active"));
    });
  }
  if (modeEditModal) {
    modeEditModal.addEventListener("click", (event) => {
      if (event.target?.dataset?.modeDismiss === "1") {
        closeModeEditModal();
      }
    });
  }

  if (addProviderBtn) {
    addProviderBtn.addEventListener("click", () => {
      setProvidersHint("");
      openProviderEditModal(-1);
    });
  }

  if (modelEditProvider) {
    modelEditProvider.addEventListener("change", () => {
      syncModelNewProviderFields();
      if (modelEditProvider.value === NEW_PROVIDER_VALUE) {
        modelEditNewProviderId?.focus();
      }
      if (modelEditMode === "api" && modelEditIndex === -1) {
        setModelEditMode("api");
      }
    });
  }

  if (modelEditApiFetchBtn) {
    modelEditApiFetchBtn.addEventListener("click", () => {
      const providerId = modelEditProvider?.value?.trim() || "";
      if (!providerId || providerId === NEW_PROVIDER_VALUE) {
        setFetchModelsHint(
          modelEditApiStatus,
          t("fetchModelsNeedProvider"),
          true
        );
        return;
      }
      requestProviderModels(providerId, "editApi");
    });
  }

  if (modelEditApiSelectNewBtn) {
    modelEditApiSelectNewBtn.addEventListener("click", () => {
      selectNewFetchModels();
    });
  }

  if (modelEditApiSearch) {
    modelEditApiSearch.addEventListener("input", () => {
      renderFetchModelsPicker();
    });
  }

  function bindFetchModelsDismiss(el) {
    if (!el) {
      return;
    }
    el.addEventListener("click", () => {
      closeFetchModelsModal();
    });
  }

  bindFetchModelsDismiss(fetchModelsCloseBtn);
  bindFetchModelsDismiss(fetchModelsCancelBtn);

  if (fetchModelsAddBtn) {
    fetchModelsAddBtn.addEventListener("click", () => {
      if (applyFetchedModels()) {
        closeFetchModelsModal();
      }
    });
  }

  if (fetchModelsSelectNewBtn) {
    fetchModelsSelectNewBtn.addEventListener("click", () => {
      selectNewFetchModels();
    });
  }

  if (fetchModelsSearch) {
    fetchModelsSearch.addEventListener("input", () => {
      renderFetchModelsPicker();
    });
  }

  if (fetchModelsModal) {
    fetchModelsModal.addEventListener("click", (event) => {
      if (event.target?.getAttribute?.("data-fetch-models-dismiss") === "1") {
        closeFetchModelsModal();
      }
    });
    fetchModelsModal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeFetchModelsModal();
      }
    });
  }

  if (settingsProvidersList) {
    settingsProvidersList.addEventListener("click", (event) => {
      const fetchBtn = event.target.closest(".settings-provider-fetch");
      if (fetchBtn) {
        const index = Number(fetchBtn.dataset.index);
        if (Number.isFinite(index)) {
          openFetchModelsModal(index);
        }
        return;
      }
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
      } else if (modelEditMode === "api") {
        modelEditApiFetchBtn?.focus();
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

  if (settingsLanguage) {
    settingsLanguage.addEventListener("change", () => {
      settingsLanguageValue = settingsLanguage.value || "auto";
      applyUiLanguage(effectiveUiLangFromSetting(settingsLanguageValue));
      schedulePersistSettings(0);
      if (harborHostAvailable()) {
        // JetBrains: no window reload — language already applied above.
        showCopyToast(t("saved"));
      } else {
        showCopyToast(
          UI_LANG === "ru" ? "Перезагрузка окна…" : "Reloading window…"
        );
      }
    });
  }

  if (toggleAgentsRailBtn) {
    toggleAgentsRailBtn.addEventListener("click", () => {
      setAgentsRailOpen(!agentsRailOpen);
    });
  }

  if (agentsRailBackdrop) {
    agentsRailBackdrop.addEventListener("click", () => {
      setAgentsRailOpen(false);
    });
  }

  if (workspaceShell && typeof ResizeObserver === "function") {
    const shellRo = new ResizeObserver(() => {
      updateWorkspaceNarrow();
      updateComposerCompact();
    });
    shellRo.observe(workspaceShell);
  }
  updateWorkspaceNarrow();
  updateComposerCompact();
  applyAgentsRailVisibility();

  if (chatBranchesEl) {
    const onBranchClosePointer = (event) => {
      if (event.button != null && event.button !== 0) {
        return;
      }
      const closeBtn = event.target.closest(".chat-branch-close");
      if (!closeBtn || !chatBranchesEl.contains(closeBtn)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Allow delete while a run is active — host aborts then deletes.
      // pointerdown + capture: JCEF OSR often drops click on tiny close targets.
      const chatId = closeBtn.getAttribute("data-chat-id") || "";
      if (!chatId) {
        return;
      }
      clearMessageQueue(chatId);
      host.postMessage({ type: "deleteBranch", chatId });
    };
    const onBranchSwitchPointer = (event) => {
      if (!harborHostAvailable()) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (event.target.closest(".chat-branch-close")) {
        return;
      }
      const pill = event.target.closest(".chat-branch-pill");
      if (!pill || !chatBranchesEl.contains(pill)) {
        return;
      }
      const chatId = pill.getAttribute("data-chat-id") || "";
      if (!chatId || chatId === activeChatId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      harborAgentNavAt = Date.now();
      host.postMessage({ type: "switchBranch", chatId });
      if (typeof forceHarborUiRepaint === "function") {
        forceHarborUiRepaint();
      }
    };
    const onBranchClick = (event) => {
      if (event.target.closest(".chat-branch-close")) {
        // Handled on pointerdown — do not also switch branch.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (Date.now() - harborAgentNavAt < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const pill = event.target.closest(".chat-branch-pill");
      if (!pill || !chatBranchesEl.contains(pill)) {
        return;
      }
      event.preventDefault();
      const chatId = pill.getAttribute("data-chat-id") || "";
      if (!chatId || chatId === activeChatId) {
        return;
      }
      host.postMessage({ type: "switchBranch", chatId });
    };
    chatBranchesEl.addEventListener("pointerdown", onBranchClosePointer, true);
    chatBranchesEl.addEventListener("pointerdown", onBranchSwitchPointer, true);
    chatBranchesEl.addEventListener("click", onBranchClick);
  }

  if (openChatSearchBtn) {
    openChatSearchBtn.addEventListener("click", () => {
      openChatSearch({ fromAgents: false });
    });
  }

  if (closeChatSearchBtn) {
    closeChatSearchBtn.addEventListener("click", () => {
      closeChatSearch();
    });
  }

  if (chatSearchInput) {
    chatSearchInput.addEventListener("input", () => {
      scheduleChatSearch();
    });
    chatSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeChatSearch();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (chatSearchMatchEls.length) {
          focusChatSearchMatch(chatSearchMatchIndex + 1, true);
        } else {
          setChatSearchActiveIndex(chatSearchActiveIndex + 1);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (chatSearchMatchEls.length) {
          focusChatSearchMatch(chatSearchMatchIndex - 1, true);
        } else {
          setChatSearchActiveIndex(chatSearchActiveIndex - 1);
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (chatSearchMatchEls.length) {
          focusChatSearchMatch(
            chatSearchMatchIndex >= 0 ? chatSearchMatchIndex : 0,
            true
          );
          return;
        }
        if (
          chatSearchActiveIndex >= 0 &&
          chatSearchHits[chatSearchActiveIndex]
        ) {
          openSearchHit(chatSearchHits[chatSearchActiveIndex]);
        }
      }
    });
  }

  if (chatSearchPanel) {
    chatSearchPanel.addEventListener("click", (event) => {
      const hit = event.target.closest(".chat-search-hit");
      if (!hit) {
        return;
      }
      const index = Number(hit.dataset.index);
      if (!Number.isInteger(index) || !chatSearchHits[index]) {
        return;
      }
      openSearchHit(chatSearchHits[index]);
    });
  }

  if (chatSearchResults) {
    chatSearchResults.addEventListener("click", (event) => {
      const hit = event.target.closest(".chat-search-hit");
      if (!hit) {
        return;
      }
      const index = Number(hit.dataset.index);
      if (!Number.isInteger(index) || !chatSearchHits[index]) {
        return;
      }
      openSearchHit(chatSearchHits[index]);
    });
  }

  document.addEventListener("mousedown", (event) => {
    if (!chatSearchOpen) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (chatSearchPanel && chatSearchPanel.contains(target)) {
      return;
    }
    if (chatSearchResults && chatSearchResults.contains(target)) {
      return;
    }
    if (openChatSearchBtn && openChatSearchBtn.contains(target)) {
      return;
    }
    closeChatSearch();
  });

  window.addEventListener("keydown", (event) => {
    if (chatSearchOpen && event.key === "Escape") {
      event.preventDefault();
      closeChatSearch();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") {
      return;
    }
    if (settingsScreen && !settingsScreen.hidden && !chatSearchOpen) {
      return;
    }
    if (archiveScreen && !archiveScreen.hidden && !chatSearchOpen) {
      return;
    }
    event.preventDefault();
    if (chatSearchOpen) {
      if (chatSearchInput) {
        chatSearchInput.focus();
        chatSearchInput.select();
      }
      return;
    }
    const fromAgents = Boolean(agentsScreen && !agentsScreen.hidden);
    openChatSearch({ fromAgents });
  });

  if (archiveListEl) {
    const onArchivePointer = (event) => {
      if (!harborHostAvailable()) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn && archiveListEl.contains(deleteBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
            type: "deleteAgent",
            agentId: deleteBtn.dataset.deleteAgent,
          });
        }
        return;
      }
      const restoreBtn = event.target.closest(".row-restore");
      if (restoreBtn && archiveListEl.contains(restoreBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (restoreBtn.dataset.restoreAgent) {
          host.postMessage({
            type: "restoreAgent",
            agentId: restoreBtn.dataset.restoreAgent,
          });
        }
      }
    };
    archiveListEl.addEventListener("pointerdown", onArchivePointer, true);
    archiveListEl.addEventListener("click", (event) => {
      if (Date.now() - harborAgentNavAt < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
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
        host.postMessage({
          type: "restoreAgent",
          agentId: restoreBtn.dataset.restoreAgent,
        });
      }
    });
  }

  if (agentsListEl) {
    const onAgentsPointer = (event) => {
      if (!harborHostAvailable()) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (event.target.closest(".agent-name-input")) {
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn && agentsListEl.contains(deleteBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
            type: "deleteAgent",
            agentId: deleteBtn.dataset.deleteAgent,
          });
        }
        return;
      }
      const archiveBtn = event.target.closest(".row-archive");
      if (archiveBtn && agentsListEl.contains(archiveBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (archiveBtn.dataset.archiveAgent) {
          host.postMessage({
            type: "archiveAgent",
            agentId: archiveBtn.dataset.archiveAgent,
          });
        }
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (!agentRow || !agentsListEl.contains(agentRow)) {
        return;
      }
      // JCEF OSR often drops synthesized click on the agents rail — open on
      // pointerdown (same pattern as branch close / edit-save).
      event.preventDefault();
      event.stopPropagation();
      harborAgentNavAt = Date.now();
      if (workspaceNarrow) {
        setAgentsRailOpen(false);
      }
      host.postMessage({
        type: "openAgent",
        agentId: agentRow.dataset.agent || agentRow.getAttribute("data-agent"),
      });
      if (typeof forceHarborUiRepaint === "function") {
        forceHarborUiRepaint();
        setTimeout(forceHarborUiRepaint, 32);
      }
    };
    agentsListEl.addEventListener("pointerdown", onAgentsPointer, true);
    agentsListEl.addEventListener("click", (event) => {
      if (Date.now() - harborAgentNavAt < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
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
          host.postMessage({
            type: "archiveAgent",
            agentId: archiveBtn.dataset.archiveAgent,
          });
        }
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (agentRow) {
        event.preventDefault();
        if (workspaceNarrow) {
          setAgentsRailOpen(false);
        }
        host.postMessage({
          type: "openAgent",
          agentId: agentRow.dataset.agent,
        });
      }
    });
    agentsListEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (!agentRow || !agentsListEl.contains(agentRow)) {
        return;
      }
      if (event.target.closest(".agent-name-input")) {
        return;
      }
      event.preventDefault();
      if (workspaceNarrow) {
        setAgentsRailOpen(false);
      }
      host.postMessage({
        type: "openAgent",
        agentId: agentRow.dataset.agent,
      });
    });
  }

  if (chatAgentNameEl) {
    chatAgentNameEl.title = t("rename");
    chatAgentNameEl.setAttribute("role", "button");
    chatAgentNameEl.tabIndex = 0;
    chatAgentNameEl.addEventListener("click", () => {
      if (!activeAgentId || renamingAgentId) {
        return;
      }
      startAgentRename(activeAgentId, chatAgentNameEl);
    });
    chatAgentNameEl.addEventListener("keydown", (event) => {
      if (renamingAgentId) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (activeAgentId) {
          startAgentRename(activeAgentId, chatAgentNameEl);
        }
      }
    });
  }

  messagesEl.addEventListener(
    "pointerdown",
    (event) => {
      trySubmitEditedUserMessageFromPointer(event);
    },
    true
  );

  messagesEl.addEventListener("click", (event) => {
    const previewBtn = event.target.closest(".msg-attach-image[data-preview-src]");
    if (previewBtn && messagesEl.contains(previewBtn)) {
      event.preventDefault();
      event.stopPropagation();
      openImgLightbox(previewBtn.getAttribute("data-preview-src") || "");
      return;
    }
    const codeToggle = event.target.closest(".md-pre-toggle");
    if (
      codeToggle &&
      messagesEl.contains(codeToggle) &&
      !event.target.closest("a.md-file")
    ) {
      event.preventDefault();
      event.stopPropagation();
      toggleCodeBlock(codeToggle);
      return;
    }
    const toolToggle = event.target.closest(".tool-group-toggle");
    if (toolToggle && messagesEl.contains(toolToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const group = toolToggle.closest(".tool-group");
      if (!group || !toolGroupHasContent(group)) {
        return;
      }
      const collapsed = group.classList.toggle("is-collapsed");
      toolToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      updateToolGroupSummary(group);
      return;
    }
    const reasoningToggle = event.target.closest(".reasoning-group-toggle");
    if (reasoningToggle && messagesEl.contains(reasoningToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const group = reasoningToggle.closest(".reasoning-group");
      if (!group) {
        return;
      }
      const collapsed = group.classList.toggle("is-collapsed");
      reasoningToggle.setAttribute(
        "aria-expanded",
        collapsed ? "false" : "true"
      );
      updateReasoningGroupSummary(group);
      return;
    }
    const thinkingToggle = event.target.closest(
      ".agent-step-thinking-toggle"
    );
    if (thinkingToggle && messagesEl.contains(thinkingToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const step = thinkingToggle.closest(".agent-step");
      if (!step) {
        return;
      }
      const collapsed = step.classList.toggle("is-thinking-collapsed");
      step.dataset.thinkingOpen = collapsed ? "0" : "1";
      thinkingToggle.setAttribute(
        "aria-expanded",
        collapsed ? "false" : "true"
      );
      const label = thinkingToggle.querySelector(
        ".agent-step-thinking-toggle-label"
      );
      if (label) {
        label.textContent = collapsed
          ? t("showThinking")
          : t("hideThinking");
      }
      return;
    }
    const planToggleBtn = event.target.closest("[data-plan-action='toggle']");
    if (planToggleBtn && messagesEl.contains(planToggleBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const card = planToggleBtn.closest(".proposed-plan-card");
      if (card) {
        setProposedPlanCollapsed(
          card,
          !card.classList.contains("is-collapsed")
        );
      }
      return;
    }
    const planOpenTabBtn = event.target.closest("[data-plan-action='open-tab']");
    if (planOpenTabBtn && messagesEl.contains(planOpenTabBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const card = planOpenTabBtn.closest(".proposed-plan-card");
      if (card) {
        openProposedPlanInTab(card);
      }
      return;
    }
    const editModeTrigger = event.target.closest(".msg-edit-mode-trigger");
    if (editModeTrigger && messagesEl.contains(editModeTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      // JetBrains OSR may already have toggled on pointerdown.
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditModeMenu();
      return;
    }
    const editModelTrigger = event.target.closest(".msg-edit-model-trigger");
    if (editModelTrigger && messagesEl.contains(editModelTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditModelMenu();
      return;
    }
    const editPlusTrigger = event.target.closest(".msg-edit-plus-btn");
    if (editPlusTrigger && messagesEl.contains(editPlusTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditPlusMenu();
      return;
    }
    const editReasonTrigger = event.target.closest(".msg-edit-reason-trigger");
    if (editReasonTrigger && messagesEl.contains(editReasonTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditReasonMenu();
      return;
    }
    const editAttachRemove = event.target.closest(
      ".msg-edit-attach-preview .attach-chip-remove"
    );
    if (editAttachRemove && messagesEl.contains(editAttachRemove)) {
      event.preventDefault();
      event.stopPropagation();
      removeEditingAttachment(editAttachRemove.getAttribute("data-id"));
      return;
    }
    const saveEditTarget = eventTargetElement(event);
    const saveEditBtn = saveEditTarget
      ? saveEditTarget.closest(".msg-edit-save")
      : null;
    if (saveEditBtn && messagesEl.contains(saveEditBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditSaveAt < 450) {
        return;
      }
      submitEditedUserMessage();
      return;
    }
    const copyBtn = event.target.closest(".msg-copy");
    if (copyBtn && messagesEl.contains(copyBtn)) {
      event.preventDefault();
      event.stopPropagation();
      copyAssistantFromButton(copyBtn);
      return;
    }
    const regenBtn = event.target.closest(".msg-regenerate");
    if (regenBtn && messagesEl.contains(regenBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditSaveAt < 450) {
        return;
      }
      // Allow while busy — host aborts the current run, then regenerates.
      if (!canRegenerate) {
        return;
      }
      pinChatToBottom();
      setBusy(true);
      host.postMessage({
        type: "regenerate",
        agentMode,
        reasoningEffort: selectedReasoningEffort || undefined,
      });
      return;
    }
    const branchBtn = event.target.closest(".msg-branch");
    if (branchBtn && messagesEl.contains(branchBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditSaveAt < 450) {
        return;
      }
      // Allow while busy — host forks into a new chat; the old run keeps going.
      const index = Number(branchBtn.dataset.index);
      if (!Number.isInteger(index) || index < 0) {
        return;
      }
      host.postMessage({ type: "branchFromMessage", messageIndex: index });
      return;
    }
    const mentionBtn = event.target.closest(".msg-mention");
    if (mentionBtn && messagesEl.contains(mentionBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const path = mentionBtn.getAttribute("data-path");
      if (path) {
        host.postMessage({ type: "openFile", path });
      }
      return;
    }
    const userMsg = event.target.closest(".msg.user");
    if (
      userMsg &&
      messagesEl.contains(userMsg) &&
      !userMsg.classList.contains("is-editing") &&
      !busy
    ) {
      const selection = window.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        userMsg.contains(selection.anchorNode)
      ) {
        return;
      }
      event.preventDefault();
      const editIndex = Number(userMsg.dataset.index);
      if (Number.isInteger(editIndex) && editIndex >= 0) {
        startEditingUserMessage(editIndex);
      }
      return;
    }
    const file = event.target.closest("a.md-file");
    if (file) {
      event.preventDefault();
      const path = file.getAttribute("data-path");
      if (path) {
        host.postMessage({ type: "openFile", path });
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
      host.postMessage({ type: "openExternal", url: href });
    }
  });

  messagesEl.addEventListener("input", (event) => {
    const input = event.target.closest(".msg-edit-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      return;
    }
    editingUserText = input.value;
    onMentionInput(input);
  });

  messagesEl.addEventListener("keydown", (event) => {
    const codeToggle = event.target.closest(".md-pre-toggle");
    if (
      codeToggle &&
      event.target === codeToggle &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      toggleCodeBlock(codeToggle);
      return;
    }
    const input = event.target.closest(".msg-edit-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      return;
    }
    if (onMentionKeydown(event, input)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitEditedUserMessage();
      return;
    }
    if (event.key === "Escape" && editModeMenuOpen) {
      event.preventDefault();
      closeEditModeMenu();
      return;
    }
    if (event.key === "Escape" && editModelMenuOpen) {
      event.preventDefault();
      closeEditModelMenu();
    }
  });

  promptEl.addEventListener("input", () => {
    autoResizePrompt();
    persistDraftPrompt();
    updateSendButton();
    if (!onSlashInput(promptEl)) {
      onMentionInput(promptEl);
    }
  });

  promptEl.addEventListener("keydown", (event) => {
    if (onSlashKeydown(event, promptEl)) {
      return;
    }
    if (onMentionKeydown(event, promptEl)) {
      return;
    }
    if (event.key === " " && tryCommitComposerMention(promptEl)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });

  messagesEl.addEventListener(
    "scroll",
    () => {
      if (editModelMenuOpen) {
        closeEditModelMenu();
      }
      if (!restoringChatScroll) {
        stickToBottom = isNearBottom();
      }
      if (!restoringChatScroll && chatScreen && !chatScreen.hidden && activeChatId) {
        syncChatScroll(activeChatId);
      }
    },
    { passive: true }
  );

  if (typeof ResizeObserver !== "undefined") {
    const keepPinnedOnResize = () => {
      if (stickToBottom && !restoringChatScroll) {
        scrollToBottom();
      }
    };
    const resizePin = new ResizeObserver(keepPinnedOnResize);
    resizePin.observe(messagesEl);
    if (composerWrapEl) {
      resizePin.observe(composerWrapEl);
    }
  }
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      if (stickToBottom && !restoringChatScroll) {
        scrollToBottom();
      }
    }).observe(messagesEl, { childList: true, subtree: true });
  }

  if (mentionMenuEl) {
    mentionMenuEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const slashOption = event.target.closest("[data-slash-index]");
      if (slashOption) {
        const index = Number(slashOption.getAttribute("data-slash-index"));
        if (Number.isInteger(index)) {
          applySlashSelection(index);
        }
        return;
      }
      const option = event.target.closest(".mention-option");
      if (!option) {
        return;
      }
      const index = Number(option.getAttribute("data-index"));
      if (Number.isInteger(index)) {
        applyMentionSelection(index);
      }
    });
  }


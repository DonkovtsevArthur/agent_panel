  function getSelectedModel() {
    return selectedModelId;
  }

  function updateTriggerLabel() {
    if (!modelLabel) {
      return;
    }
    const model = models.find((m) => m.id === selectedModelId);
    const full = model
      ? model.label || model.id
      : selectedModelId || t("noModels");
    modelLabel.textContent = shortModelChip(full);
    if (modelTrigger) {
      modelTrigger.title = full;
    }
  }

  function updateVisionUi() {
    if (!composerPlusMenu) {
      return;
    }
    const fileItem = composerPlusMenu.querySelector(
      '.composer-plus-item[data-action="file"]'
    );
    if (fileItem) {
      fileItem.title = t("attachFile");
    }
  }

  /** Ignore briefly-stale host selectedModel after a local picker change. */
  let localModelChangeAt = 0;
  const LOCAL_MODEL_GUARD_MS = 5000;

  function setSelectedModel(id, notify) {
    const next = String(id || "").trim();
    selectedModelId = next;
    state.selectedModel = selectedModelId;
    if (activeChatId) {
      state.modelByChat[activeChatId] = selectedModelId;
    }
    host.setState(state);
    updateTriggerLabel();
    updateVisionUi();
    applySelectedReasoningEffort(
      activeChatId ? state.reasonByChat[activeChatId] : selectedReasoningEffort,
      { notify: false }
    );
    if (notify && selectedModelId) {
      localModelChangeAt = Date.now();
      host.postMessage({
        type: "modelChanged",
        model: selectedModelId,
        chatId: activeChatId || "",
      });
    }
  }

  function resolvePreferredModelId(preferredId, forceHost = false) {
    const fromHost = String(preferredId || "").trim();
    // При переключении чата / init / regenerate модель хоста авторитетна —
    // не даём локальному guard перекрывать модель нового чата.
    if (forceHost) {
      localModelChangeAt = 0;
      if (fromHost && models.some((m) => m.id === fromHost)) {
        return fromHost;
      }
      if (activeChatId && state.modelByChat[activeChatId]) {
        const fromChat = String(state.modelByChat[activeChatId] || "").trim();
        if (fromChat && models.some((m) => m.id === fromChat)) {
          return fromChat;
        }
      }
      return selectedModelId && models.some((m) => m.id === selectedModelId)
        ? selectedModelId
        : fromHost;
    }
    const localIsFresh =
      localModelChangeAt > 0 &&
      Date.now() - localModelChangeAt < LOCAL_MODEL_GUARD_MS &&
      selectedModelId &&
      models.some((m) => m.id === selectedModelId);
    if (localIsFresh) {
      return selectedModelId;
    }
    if (fromHost && models.some((m) => m.id === fromHost)) {
      return fromHost;
    }
    if (activeChatId && state.modelByChat[activeChatId]) {
      const fromChat = String(state.modelByChat[activeChatId] || "").trim();
      if (fromChat && models.some((m) => m.id === fromChat)) {
        return fromChat;
      }
    }
    if (selectedModelId && models.some((m) => m.id === selectedModelId)) {
      return selectedModelId;
    }
    if (fromHost) {
      return models[0]?.id || "";
    }
    return models[0]?.id || "";
  }

  function fillModels(nextModels, preferredId, forceHost = false) {
    const incoming = Array.isArray(nextModels) ? nextModels : [];
    models = incoming.length ? incoming : DEFAULT_MODELS.slice();
    const preferred = resolvePreferredModelId(preferredId, forceHost);
    setSelectedModel(preferred, false);
    if (menuOpen) {
      renderMenu();
    }
  }

  function renderMenu() {
    modelMenu.innerHTML = "";
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = t("noModelsInSettings");
      modelMenu.appendChild(empty);
      return;
    }

    for (const model of models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (model.id === selectedModelId ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("data-model-id", model.id);
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
    closePlusMenu();
    closeModeMenu();
    closeReasonMenu();
    menuOpen = true;
    renderMenu();
    modelPicker.classList.add("is-open");
    modelTrigger.setAttribute("aria-expanded", "true");
    modelMenu.hidden = false;
    placeModelMenu(modelPicker, modelMenu, chatScreen);
  }

  function closeMenu() {
    menuOpen = false;
    modelPicker.classList.remove("is-open");
    modelTrigger.setAttribute("aria-expanded", "false");
    modelMenu.hidden = true;
    resetModelMenuPlacement(modelPicker, modelMenu);
  }

  function closePlusMenu() {
    plusMenuOpen = false;
    if (composerPlusEl) {
      composerPlusEl.classList.remove("is-open");
    }
    if (composerPlusBtn) {
      composerPlusBtn.setAttribute("aria-expanded", "false");
    }
    if (composerPlusMenu) {
      composerPlusMenu.hidden = true;
    }
    resetModelMenuPlacement(composerPlusEl, composerPlusMenu);
  }

  function openPlusMenu() {
    closeMenu();
    closeModeMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    plusMenuOpen = true;
    if (composerPlusEl) {
      composerPlusEl.classList.add("is-open");
    }
    if (composerPlusBtn) {
      composerPlusBtn.setAttribute("aria-expanded", "true");
    }
    if (composerPlusMenu) {
      composerPlusMenu.hidden = false;
      placeModelMenu(composerPlusEl, composerPlusMenu, chatScreen);
    }
  }

  function togglePlusMenu() {
    if (plusMenuOpen) {
      closePlusMenu();
    } else {
      openPlusMenu();
    }
  }

  function toggleMenu() {
    if (menuOpen) {
      closeMenu();
    } else {
      closePlusMenu();
      closeModeMenu();
      openMenu();
    }
  }

  function renderModeMenu() {
    if (!modeMenu) {
      return;
    }
    modeMenu.innerHTML = "";
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    for (const sourceMode of modes) {
      const mode = localizeModeMeta(sourceMode);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (mode.id === agentMode ? " is-active" : "");
      btn.dataset.mode = mode.id;
      applyModeAccentToElement(btn, mode.id);
      btn.setAttribute("role", "option");
      const text = document.createElement("span");
      text.className = "mode-option-text";
      const title = document.createElement("span");
      title.className = "model-option-label";
      title.textContent = mode.label || mode.id;
      text.appendChild(title);
      if (mode.description) {
        const desc = document.createElement("span");
        desc.className = "mode-option-desc";
        desc.textContent = mode.description;
        text.appendChild(desc);
      }
      btn.appendChild(text);
      if (mode.id === agentMode) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML = CHECK_ICON;
        btn.appendChild(check);
      }
      modeMenu.appendChild(btn);
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "model-option mode-option-add";
    addBtn.dataset.action = "add-mode";
    addBtn.setAttribute("role", "option");
    const addLabel = document.createElement("span");
    addLabel.className = "model-option-label";
    addLabel.textContent = t("addMode");
    addBtn.appendChild(addLabel);
    modeMenu.appendChild(addBtn);
  }

  function normalizeAgentModeUi(value) {
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    if (modes.some((m) => m.id === value)) {
      return value;
    }
    return modes[0]?.id || "agent";
  }

  function closeModeMenu() {
    modeMenuOpen = false;
    if (modePicker) {
      modePicker.classList.remove("is-open");
    }
    if (modeTrigger) {
      modeTrigger.setAttribute("aria-expanded", "false");
    }
    if (modeMenu) {
      modeMenu.hidden = true;
    }
    resetModelMenuPlacement(modePicker, modeMenu);
  }

  function openModeMenu() {
    closeMenu();
    closePlusMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    renderModeMenu();
    modeMenuOpen = true;
    if (modePicker) {
      modePicker.classList.add("is-open");
    }
    if (modeTrigger) {
      modeTrigger.setAttribute("aria-expanded", "true");
    }
    if (modeMenu) {
      modeMenu.hidden = false;
      placeModelMenu(modePicker, modeMenu, chatScreen);
    }
  }

  function toggleModeMenu() {
    if (modeMenuOpen) {
      closeModeMenu();
    } else {
      openModeMenu();
    }
  }

  function setAgentMode(next, { focus = false, close = true, notify = true } = {}) {
    agentMode = normalizeAgentModeUi(next);
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const meta = localizeModeMeta(
      modes.find((m) => m.id === agentMode) || modes[0] || {
      id: "agent",
      label: t("agent"),
      placeholder: t("taskPlaceholder"),
      }
    );
    if (activeChatId) {
      state.modeByChat[activeChatId] = agentMode;
      host.setState(state);
    }
    if (modePicker) {
      applyModeAccentToElement(modePicker, agentMode);
    }
    if (composerEl) {
      applyModeAccentToElement(composerEl, agentMode);
    }
    if (modeLabel) {
      modeLabel.textContent = meta.label || meta.id;
    }
    if (modeTrigger) {
      modeTrigger.title = meta.description
        ? `${meta.label}: ${meta.description}`
        : meta.label || t("mode");
    }
    if (modeMenu && !modeMenu.hidden) {
      renderModeMenu();
      placeModelMenu(modePicker, modeMenu, chatScreen);
    }
    if (promptEl) {
      promptEl.placeholder =
        meta.placeholder || t("taskPlaceholder");
    }
    if (close) {
      closeModeMenu();
    }
    if (focus && promptEl && typeof promptEl.focus === "function") {
      promptEl.focus();
    }
    if (notify && agentMode) {
      host.postMessage({
        type: "modeChanged",
        mode: agentMode,
        chatId: activeChatId || "",
      });
    }
  }

  function resolvePreferredModeId(preferredId) {
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const fromHost = String(preferredId || "").trim();
    if (fromHost && modes.some((m) => m.id === fromHost)) {
      return fromHost;
    }
    if (activeChatId && state.modeByChat[activeChatId]) {
      const fromChat = String(state.modeByChat[activeChatId] || "").trim();
      if (fromChat && modes.some((m) => m.id === fromChat)) {
        return fromChat;
      }
    }
    if (fromHost) {
      return modes[0]?.id || "agent";
    }
    return modes.some((m) => m.id === "agent")
      ? "agent"
      : modes[0]?.id || "agent";
  }

  function applySelectedMode(preferredId, { notify = false } = {}) {
    setAgentMode(resolvePreferredModeId(preferredId), {
      close: false,
      notify,
    });
  }

  const REASON_LEVELS = [
    { id: "low", labelKey: "reasonLow" },
    { id: "medium", labelKey: "reasonMedium" },
    { id: "high", labelKey: "reasonHigh" },
    { id: "xhigh", labelKey: "reasonExtraHigh" },
  ];

  function normalizeReasonLevel(value) {
    const id = String(value || "")
      .trim()
      .toLowerCase();
    if (id === "extra" || id === "extra-high" || id === "extrahigh" || id === "extra_high" || id === "max") {
      return "xhigh";
    }
    return REASON_LEVELS.some((item) => item.id === id) ? id : "";
  }

  function reasonLevelLabel(id) {
    const level = REASON_LEVELS.find((item) => item.id === id);
    return level ? t(level.labelKey) : t("reasonMedium");
  }

  function modelSupportsReasoning(modelId) {
    const id = String(modelId || selectedModelId || "").trim();
    const model = models.find((m) => m.id === id);
    return model?.supportsReasoningEffort === true;
  }

  function defaultReasonForModel(modelId) {
    const id = String(modelId || selectedModelId || "").trim();
    const model = models.find((m) => m.id === id);
    return (
      normalizeReasonLevel(model?.reasoningEffortDefault) ||
      normalizeReasonLevel(model?.reasoningEffort) ||
      "medium"
    );
  }

  function resolvePreferredReasonLevel(preferredId, modelId) {
    if (!modelSupportsReasoning(modelId || selectedModelId)) {
      return "";
    }
    const fromHost = normalizeReasonLevel(preferredId);
    if (fromHost) {
      return fromHost;
    }
    if (activeChatId && state.reasonByChat[activeChatId]) {
      const fromChat = normalizeReasonLevel(state.reasonByChat[activeChatId]);
      if (fromChat) {
        return fromChat;
      }
    }
    const current = normalizeReasonLevel(selectedReasoningEffort);
    if (current) {
      return current;
    }
    return defaultReasonForModel(modelId || selectedModelId);
  }

  function updateReasonPickerVisibility() {
    if (!reasonPicker) {
      return;
    }
    const supported = modelSupportsReasoning(selectedModelId);
    reasonPicker.hidden = !supported;
    if (!supported) {
      closeReasonMenu();
    }
  }

  function renderReasonMenu() {
    if (!reasonMenu) {
      return;
    }
    reasonMenu.innerHTML = "";
    for (const level of REASON_LEVELS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" +
        (level.id === selectedReasoningEffort ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.dataset.reason = level.id;
      const label = document.createElement("span");
      label.className = "model-option-label";
      label.textContent = t(level.labelKey);
      btn.appendChild(label);
      if (level.id === selectedReasoningEffort) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML = CHECK_ICON;
        btn.appendChild(check);
      }
      reasonMenu.appendChild(btn);
    }
  }

  function closeReasonMenu() {
    reasonMenuOpen = false;
    if (reasonPicker) {
      reasonPicker.classList.remove("is-open");
    }
    if (reasonTrigger) {
      reasonTrigger.setAttribute("aria-expanded", "false");
    }
    if (reasonMenu) {
      reasonMenu.hidden = true;
      resetModelMenuPlacement(reasonPicker, reasonMenu);
    }
  }

  function openReasonMenu() {
    if (!reasonPicker || reasonPicker.hidden) {
      return;
    }
    closePlusMenu();
    closeMenu();
    closeModeMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    renderReasonMenu();
    reasonMenuOpen = true;
    reasonPicker.classList.add("is-open");
    if (reasonTrigger) {
      reasonTrigger.setAttribute("aria-expanded", "true");
    }
    if (reasonMenu) {
      reasonMenu.hidden = false;
      placeModelMenu(reasonPicker, reasonMenu, chatScreen);
    }
  }

  function toggleReasonMenu() {
    if (reasonMenuOpen) {
      closeReasonMenu();
    } else {
      openReasonMenu();
    }
  }

  function setReasoningEffort(
    next,
    { close = true, notify = true, modelId } = {}
  ) {
    if (!modelSupportsReasoning(modelId || selectedModelId)) {
      selectedReasoningEffort = "";
      updateReasonPickerVisibility();
      if (close) {
        closeReasonMenu();
      }
      return;
    }
    const level =
      normalizeReasonLevel(next) ||
      defaultReasonForModel(modelId || selectedModelId);
    selectedReasoningEffort = level;
    if (activeChatId) {
      state.reasonByChat[activeChatId] = level;
      host.setState(state);
    }
    if (reasonLabel) {
      reasonLabel.textContent = reasonLevelLabel(level);
    }
    if (reasonTrigger) {
      reasonTrigger.title = `${t("intelligence")}: ${reasonLevelLabel(level)}`;
    }
    if (reasonMenu && !reasonMenu.hidden) {
      renderReasonMenu();
    }
    updateReasonPickerVisibility();
    if (close) {
      closeReasonMenu();
    }
    if (notify && level) {
      host.postMessage({
        type: "reasoningEffortChanged",
        reasoningEffort: level,
        chatId: activeChatId || "",
      });
    }
  }

  function applySelectedReasoningEffort(preferredId, { notify = false } = {}) {
    setReasoningEffort(resolvePreferredReasonLevel(preferredId), {
      close: false,
      notify,
    });
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    // Keep composer editable while a run is active so the user can queue
    // the next message. Model/mode/plus stay available for that draft.
    promptEl.disabled = false;
    modelTrigger.disabled = false;
    if (composerPlusBtn) {
      composerPlusBtn.disabled = false;
    }
    if (modeTrigger) {
      modeTrigger.disabled = false;
    }
    if (reasonTrigger) {
      reasonTrigger.disabled = false;
    }
    if (composerScmActionsEl) {
      const commitBtn = composerScmActionsEl.querySelector(".review-commit-push");
      if (commitBtn) {
        commitBtn.disabled = busy;
      }
    }
    if (composerPlanActionsEl) {
      const planBtn = composerPlanActionsEl.querySelector(".composer-plan-build");
      if (planBtn) {
        planBtn.disabled = busy;
      }
    }
    if (busy) {
      lastRunDurationMs = 0;
      lastTtftMs = 0;
      runStartedAt = Date.now();
      if (runStopwatchInterval) {
        clearInterval(runStopwatchInterval);
      }
      runStopwatchInterval = setInterval(updateLiveStopwatch, 1000);
      // Show initial "0.0 s" immediately
      updateLiveStopwatch();
      closePlusMenu();
      closeModeMenu();
      closeSlashMenu();
      closeMentionMenu();
      if (currentChatTurnEl && messagesEl.contains(currentChatTurnEl)) {
        ensureActiveToolGroup();
      }
    }
    updateSendButton();
    if (!busy) {
      if (runStopwatchInterval) {
        clearInterval(runStopwatchInterval);
        runStopwatchInterval = 0;
      }
      runStartedAt = 0;
      finalizeRunningTimelines();
      focusPrompt();
    }
  }

  function setIdleAndDrain() {
    setBusy(false);
    if (drainScheduled) {
      return;
    }
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      tryDrainQueue();
    });
  }

  updateSendButton();

  // сразу показать модель, не дожидаясь init
  fillModels(DEFAULT_MODELS, "");

  function selectModelById(id) {
    const next = String(id || "").trim();
    if (!next) {
      closeMenu();
      return;
    }
    setSelectedModel(next, true);
    closeMenu();
  }

  function modelIdFromOption(option) {
    if (!(option instanceof Element)) {
      return "";
    }
    return (
      option.getAttribute("data-model-id") ||
      option.getAttribute("data-id") ||
      option.dataset.id ||
      ""
    );
  }

  function selectModelFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".model-option")
        : null;
    if (!option || option.classList.contains("is-empty")) {
      return false;
    }
    selectModelById(modelIdFromOption(option));
    return true;
  }

  modelTrigger.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  modelTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  });

  // Do NOT preventDefault on mousedown/pointerdown: in VS Code webviews that
  // often suppresses the following click. Only stopPropagation so the floated
  // menu is not closed by the document outside-click handler.
  modelMenu.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  modelMenu.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  // Select on pointerup (primary). click remains for keyboard activation.
  modelMenu.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectModelFromEvent(event);
  });

  modelMenu.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectModelFromEvent(event);
  });

  document.addEventListener("pointerup", (event) => {
    if (editModeMenuOpen && selectEditingModeFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (editReasonMenuOpen && selectEditingReasonFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (editPlusMenuOpen && selectEditPlusItemFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!editModelMenuOpen) {
      return;
    }
    if (selectEditingModelFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  document.addEventListener("click", (event) => {
    if (editModeMenuOpen) {
      const editModeOption = event.target.closest(
        ".msg-edit-mode-menu .model-option"
      );
      if (editModeOption && !editModeOption.classList.contains("is-empty")) {
        event.preventDefault();
        event.stopPropagation();
        selectEditingMode(String(editModeOption.dataset.mode || "").trim());
        return;
      }
    }
    if (editReasonMenuOpen) {
      const editReasonOption = event.target.closest(
        ".msg-edit-reason-menu .model-option"
      );
      if (editReasonOption) {
        event.preventDefault();
        event.stopPropagation();
        selectEditingReasoningEffort(
          String(editReasonOption.dataset.reason || "")
        );
        return;
      }
    }
    if (editPlusMenuOpen && selectEditPlusItemFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!editModelMenuOpen) {
      return;
    }
    const editModelOption = event.target.closest(
      ".msg-edit-model-menu .model-option"
    );
    if (!editModelOption) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!editModelOption.classList.contains("is-empty")) {
      selectEditingModel(editingModelIdFromOption(editModelOption));
    }
  });

  document.addEventListener("mousedown", (event) => {
    const target = event.target;
    const targetNode = target instanceof Node ? target : null;
    const inModelMenu =
      Boolean(targetNode && modelMenu.contains(targetNode)) ||
      Boolean(
        target instanceof Element &&
          target.closest("#modelMenu, .model-menu.is-fixed")
      );
    if (
      menuOpen &&
      targetNode &&
      !modelPicker.contains(targetNode) &&
      !inModelMenu
    ) {
      closeMenu();
    }
    const inPlusMenu =
      Boolean(
        composerPlusEl &&
          targetNode &&
          composerPlusEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element &&
          target.closest("#composerPlusMenu, .composer-plus-menu.is-fixed")
      );
    if (plusMenuOpen && !inPlusMenu) {
      closePlusMenu();
    }
    if (
      modeMenuOpen &&
      !(
        (modePicker && targetNode && modePicker.contains(targetNode)) ||
        (target instanceof Element && target.closest("#modeMenu"))
      )
    ) {
      closeModeMenu();
    }
    if (
      reasonMenuOpen &&
      !(
        (reasonPicker && targetNode && reasonPicker.contains(targetNode)) ||
        (target instanceof Element && target.closest("#reasonMenu"))
      )
    ) {
      closeReasonMenu();
    }
    if (
      mentionOpen &&
      mentionMenuEl &&
      !mentionMenuEl.contains(event.target) &&
      event.target !== mentionTarget
    ) {
      closeMentionMenu();
    }
    const editModelPickerEl = getEditModelPicker();
    const editModelMenuEl = findEditModelMenu(editModelPickerEl);
    const editModePickerEl = getEditModePicker();
    const editModeMenuEl = findEditModeMenu(editModePickerEl);
    const editPlusPickerEl = getEditPlusPicker();
    const editPlusMenuEl = findEditPlusMenu(editPlusPickerEl);
    const editReasonPickerEl = getEditReasonPicker();
    const editReasonMenuEl = findEditReasonMenu(editReasonPickerEl);
    const inEditModelMenu =
      Boolean(
        editModelMenuEl && targetNode && editModelMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-model-menu")
      );
    const inEditModeMenu =
      Boolean(
        editModeMenuEl && targetNode && editModeMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-mode-menu")
      );
    const inEditPlusMenu =
      Boolean(
        editPlusMenuEl && targetNode && editPlusMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-plus-menu")
      );
    const inEditReasonMenu =
      Boolean(
        editReasonMenuEl && targetNode && editReasonMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-reason-menu")
      );
    if (editModelMenuOpen) {
      const inPicker =
        editModelPickerEl &&
        targetNode &&
        editModelPickerEl.contains(targetNode);
      if (!inPicker && !inEditModelMenu) {
        closeEditModelMenu();
      }
    }
    if (editModeMenuOpen) {
      const inPicker =
        editModePickerEl &&
        targetNode &&
        editModePickerEl.contains(targetNode);
      if (!inPicker && !inEditModeMenu) {
        closeEditModeMenu();
      }
    }
    if (editPlusMenuOpen) {
      const inPicker =
        editPlusPickerEl &&
        targetNode &&
        editPlusPickerEl.contains(targetNode);
      if (!inPicker && !inEditPlusMenu) {
        closeEditPlusMenu();
      }
    }
    if (editReasonMenuOpen) {
      const inPicker =
        editReasonPickerEl &&
        targetNode &&
        editReasonPickerEl.contains(targetNode);
      if (!inPicker && !inEditReasonMenu) {
        closeEditReasonMenu();
      }
    }
    // Floated edit menus live on document.body — must not cancel the edit.
    // Save/resend is inside the composer; still exclude it explicitly so a
    // VS Code webview retarget (sticky user bubble) cannot abort the click.
    const inEditSave =
      target instanceof Element &&
      Boolean(target.closest(".msg-edit-save, .msg-edit-footer-right"));
    if (Number.isInteger(editingUserIndex) && !busy) {
      const composer = messagesEl.querySelector(".msg-edit-composer");
      if (
        composer &&
        targetNode &&
        !composer.contains(targetNode) &&
        !inEditModelMenu &&
        !inEditModeMenu &&
        !inEditPlusMenu &&
        !inEditReasonMenu &&
        !inEditSave
      ) {
        cancelEditingUserMessage();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && imgLightboxEl && !imgLightboxEl.hidden) {
      closeImgLightbox();
      return;
    }
    if (event.key === "Escape" && mentionOpen) {
      closeMentionMenu();
    }
    if (event.key === "Escape" && menuOpen) {
      closeMenu();
    }
    if (event.key === "Escape" && plusMenuOpen) {
      closePlusMenu();
    }
    if (event.key === "Escape" && modeMenuOpen) {
      closeModeMenu();
    }
    if (event.key === "Escape" && reasonMenuOpen) {
      closeReasonMenu();
    }
    if (event.key === "Escape" && editModelMenuOpen) {
      closeEditModelMenu();
    }
    if (event.key === "Escape" && editModeMenuOpen) {
      closeEditModeMenu();
    }
    if (event.key === "Escape" && editPlusMenuOpen) {
      closeEditPlusMenu();
    }
    if (event.key === "Escape" && editReasonMenuOpen) {
      closeEditReasonMenu();
    }
  });


  function sendPrompt() {
    const rawInput = promptEl.value || "";
    const command = parseSlashCommand(rawInput);
    let typed = rawInput.trim();
    let modeForSend = agentMode;
    if (command) {
      if (command.mode !== "inherit") {
        setAgentMode(command.mode, { close: true });
        modeForSend = normalizeAgentModeUi(command.mode);
      }
      if (command.kind === "mode" && !command.sendText) {
        promptEl.value = "";
        autoResizePrompt();
        clearDraftPrompt();
        closeMentionMenu();
        showCopyToast(t("slashModeSwitched", modeLabel ? modeLabel.textContent : command.mode));
        focusPrompt();
        updateSendButton();
        return;
      }
      typed = command.sendText;
    }
    const text = buildMessageWithSelections(buildMessageWithMentions(typed));
    const attachments = pendingAttachments.slice();
    if (!text && !attachments.length) {
      return;
    }
    if (busy) {
      const queued = enqueueComposerMessage({
        text,
        attachments,
        mode: modeForSend,
        model: getSelectedModel(),
        reasoningEffort: selectedReasoningEffort || undefined,
      });
      if (!queued) {
        return;
      }
      promptEl.value = "";
      autoResizePrompt();
      clearDraftPrompt();
      clearPendingAttachments();
      clearPendingSelections();
      clearPendingMentions();
      closeSlashMenu();
      closeMentionMenu();
      updateSendButton();
      focusPrompt();
      return;
    }
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingModeId = "";
    editingAttachments = [];
    stickToBottom = true;
    uiMessagesCache.push({
      role: "user",
      text,
      attachments,
      mode: modeForSend,
    });
    appendMessage("user", text, uiMessagesCache.length - 1, -1, attachments);
    promptEl.value = "";
    autoResizePrompt();
    clearDraftPrompt();
    clearPendingAttachments();
    clearPendingSelections();
    clearPendingMentions();
    closeSlashMenu();
    closeMentionMenu();
    setBusy(true);
    pinChatToBottom();
    host.postMessage({
      type: "send",
      text,
      model: getSelectedModel(),
      agentMode: modeForSend,
      reasoningEffort: selectedReasoningEffort || undefined,
      attachments: attachments.map(attachmentPayload),
    });
  }

  function activateSendButton(event) {
    if (event && typeof event.button === "number" && event.button !== 0) {
      return;
    }
    if (Date.now() - harborEditSaveAt < 450) {
      return;
    }
    harborEditSaveAt = Date.now();
    if (busy) {
      if (composerHasContent()) {
        sendPrompt();
        return;
      }
      host.postMessage({ type: "stop" });
      return;
    }
    sendPrompt();
  }

  sendBtn.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    activateSendButton(event);
  });
  sendBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateSendButton(event);
  });

  if (messageQueueEl) {
    messageQueueEl.addEventListener("click", (event) => {
      const removeBtn =
        event.target instanceof Element
          ? event.target.closest(".message-queue-remove")
          : null;
      if (removeBtn && messageQueueEl.contains(removeBtn)) {
        event.preventDefault();
        event.stopPropagation();
        removeQueuedMessage(removeBtn.dataset.queueId || "");
        return;
      }
      const item =
        event.target instanceof Element
          ? event.target.closest(".message-queue-item")
          : null;
      if (!item || !messageQueueEl.contains(item)) {
        return;
      }
      event.preventDefault();
      restoreQueuedMessage(item.dataset.queueId || "");
    });
    messageQueueEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const item =
        event.target instanceof Element
          ? event.target.closest(".message-queue-item")
          : null;
      if (!item || !messageQueueEl.contains(item)) {
        return;
      }
      event.preventDefault();
      restoreQueuedMessage(item.dataset.queueId || "");
    });
  }

  if (composerPlusBtn) {
    let plusPointerHandled = false;
    // JCEF OSR often skips `click` after pointerdown; open on pointerdown.
    composerPlusBtn.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      plusPointerHandled = true;
      event.preventDefault();
      event.stopPropagation();
      togglePlusMenu();
      setTimeout(() => {
        plusPointerHandled = false;
      }, 0);
    });
    composerPlusBtn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (plusPointerHandled || event.button !== 0) {
        return;
      }
      togglePlusMenu();
    });
    composerPlusBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  if (modeTrigger) {
    let modePointerHandled = false;
    modeTrigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      modePointerHandled = true;
      event.preventDefault();
      event.stopPropagation();
      toggleModeMenu();
      setTimeout(() => {
        modePointerHandled = false;
      }, 0);
    });
    modeTrigger.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (modePointerHandled || event.button !== 0) {
        return;
      }
      toggleModeMenu();
    });
    modeTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  if (modeMenu) {
    modeMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    modeMenu.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    modeMenu.addEventListener("click", (event) => {
      const add = event.target.closest('[data-action="add-mode"]');
      if (add) {
        event.preventDefault();
        event.stopPropagation();
        closeModeMenu();
        openModeEditModal(-1, "composer");
        return;
      }
      const option = event.target.closest(".model-option");
      if (!option || option.dataset.action === "add-mode") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setAgentMode(option.dataset.mode, { focus: true });
    });
  }

  if (reasonTrigger) {
    reasonTrigger.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    reasonTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (reasonPicker && reasonPicker.hidden) {
        return;
      }
      toggleReasonMenu();
    });
  }

  if (reasonMenu) {
    reasonMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    reasonMenu.addEventListener("click", (event) => {
      const option = event.target.closest(".model-option");
      if (!option) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setReasoningEffort(option.dataset.reason, { focus: false });
    });
  }

  setAgentMode(agentMode, { close: false, notify: false });
  syncModeAccentStyles();
  renderModeMenu();
  applySelectedReasoningEffort(selectedReasoningEffort, { notify: false });

  if (composerPlusMenu) {
    composerPlusMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    composerPlusMenu.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    composerPlusMenu.addEventListener("click", (event) => {
      const item = event.target.closest(".composer-plus-item");
      if (!item || item.disabled || item.classList.contains("is-disabled")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = item.getAttribute("data-action");
      closePlusMenu();
      if (action === "file") {
        pickAttachmentsForEdit = false;
        host.postMessage({ type: "pickAttachments" });
      }
    });
  }

  if (attachPreviewEl) {
    attachPreviewEl.addEventListener("click", (event) => {
      const mentionRemove = event.target.closest(".mention-chip-remove");
      if (mentionRemove) {
        event.preventDefault();
        event.stopPropagation();
        removePendingMention(mentionRemove.getAttribute("data-id"));
        return;
      }
      const mentionChip = event.target.closest(".composer-mention-chip");
      if (mentionChip) {
        event.preventDefault();
        const path = mentionChip.getAttribute("data-path");
        if (path) {
          host.postMessage({ type: "openFile", path });
        }
        return;
      }
      const btn = event.target.closest(".attach-chip-remove");
      if (!btn) {
        return;
      }
      event.preventDefault();
      removePendingAttachment(btn.getAttribute("data-id"));
    });
  }

  if (selectionPreviewEl) {
    selectionPreviewEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".selection-chip-remove");
      if (!btn) {
        return;
      }
      event.preventDefault();
      removePendingSelection(btn.getAttribute("data-id"));
    });
  }

  function setComposerDropActive(active, withHint) {
    if (!composerEl) {
      return;
    }
    // Подсветка только у поля ввода, даже если drag над всей областью чата
    composerEl.classList.toggle("is-drop-target", Boolean(active));
    if (composerWrapEl) {
      composerWrapEl.classList.remove("is-drop-target");
    }
    if (composerDropHintEl) {
      composerDropHintEl.hidden = !(active && withHint);
    }
  }

  function clearComposerDropState() {
    composerDragDepth = 0;
    setComposerDropActive(false, false);
  }

  // Drop принимаем на весь экран чата; визуально подсвечиваем только composer
  const dropRoot = chatScreen || composerWrapEl || composerEl;
  if (dropRoot) {
    dropRoot.addEventListener("dragenter", (event) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      composerDragDepth += 1;
      setComposerDropActive(true, true);
    });
    dropRoot.addEventListener("dragover", (event) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setComposerDropActive(true, true);
    });
    dropRoot.addEventListener("dragleave", (event) => {
      const related = event.relatedTarget;
      if (related instanceof Node && dropRoot.contains(related)) {
        return;
      }
      composerDragDepth = Math.max(0, composerDragDepth - 1);
      if (composerDragDepth === 0) {
        setComposerDropActive(false, false);
      }
    });
    dropRoot.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearComposerDropState();
      const uris = extractDropUris(event.dataTransfer);
      if (uris.length) {
        host.postMessage({ type: "attachUris", uris });
        return;
      }
      if (event.dataTransfer?.files?.length) {
        void ingestDroppedFiles(event.dataTransfer.files);
        return;
      }
      showCopyToast(t("failedReadFile"));
    });
  }

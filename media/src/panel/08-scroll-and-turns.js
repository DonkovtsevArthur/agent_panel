  function isNearBottom(threshold = NEAR_BOTTOM_PX) {
    if (!messagesEl) {
      return true;
    }
    const distance =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    return distance <= threshold;
  }

  function applyScrollToBottom() {
    if (!messagesEl) {
      return;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /** Scroll to end only if pinned (or forced — new send / full re-render). */
  function scrollToBottom(options) {
    const force = Boolean(options && options.force);
    if (!force && !stickToBottom) {
      return;
    }
    stickToBottom = true;
    applyScrollToBottom();
    if (scrollBottomRaf) {
      return;
    }
    // Second pass after layout (user bubble, «выполняю», composer/context).
    scrollBottomRaf = requestAnimationFrame(() => {
      applyScrollToBottom();
      requestAnimationFrame(() => {
        applyScrollToBottom();
        scrollBottomRaf = 0;
      });
    });
  }

  function pinChatToBottom() {
    stickToBottom = true;
    scrollToBottom({ force: true });
  }

  function persistUiState() {
    host.setState(state);
  }

  function persistDraftPrompt() {
    if (!promptEl) {
      return;
    }
    state.draftPrompt = promptEl.value || "";
    persistUiState();
  }

  /** Grow #prompt with content up to CSS max-height (~15 lines). */
  function autoResizePrompt() {
    if (!(promptEl instanceof HTMLTextAreaElement)) {
      return;
    }
    promptEl.style.height = "auto";
    const styles = window.getComputedStyle(promptEl);
    const minHeight = parseFloat(styles.minHeight);
    const maxHeight = parseFloat(styles.maxHeight);
    const contentHeight = promptEl.scrollHeight;
    let next = contentHeight;
    if (Number.isFinite(minHeight)) {
      next = Math.max(next, minHeight);
    }
    if (Number.isFinite(maxHeight)) {
      next = Math.min(next, maxHeight);
    }
    promptEl.style.height = `${Math.ceil(next)}px`;
  }

  function restoreDraftPrompt() {
    if (!promptEl || UI_SURFACE !== "panel") {
      return;
    }
    const draft = typeof state.draftPrompt === "string" ? state.draftPrompt : "";
    if (draft && !promptEl.value) {
      promptEl.value = draft;
    }
    autoResizePrompt();
  }

  function clearDraftPrompt() {
    state.draftPrompt = "";
    persistUiState();
  }

  function syncChatScroll(chatId) {
    if (!chatId || !messagesEl || restoringChatScroll) {
      return;
    }
    const scrollTop = messagesEl.scrollTop;
    window.clearTimeout(pendingScrollSync);
    pendingScrollSync = window.setTimeout(() => {
      host.postMessage({
        type: "chatScroll",
        chatId,
        scrollTop,
      });
    }, 120);
  }

  function restoreChatScroll(scrollTop) {
    if (typeof scrollTop === "number" && Number.isFinite(scrollTop)) {
      messagesEl.scrollTop = scrollTop;
      stickToBottom = isNearBottom();
    } else {
      scrollToBottom({ force: true });
    }
  }

  let currentChatTurnEl = null;

  function resetChatTurns() {
    currentChatTurnEl = null;
  }

  function startChatTurn() {
    currentChatTurnEl = document.createElement("div");
    currentChatTurnEl.className = "chat-turn";
    const status = messagesEl.querySelector(
      "#agentStatus, .agent-status-in-messages"
    );
    if (status && status.parentElement === messagesEl) {
      messagesEl.insertBefore(currentChatTurnEl, status);
    } else {
      messagesEl.appendChild(currentChatTurnEl);
    }
    return currentChatTurnEl;
  }

  function ensureChatTurn() {
    if (currentChatTurnEl && messagesEl.contains(currentChatTurnEl)) {
      return currentChatTurnEl;
    }
    return startChatTurn();
  }

  function ensureAgentStatusEl() {
    if (agentStatusEl && messagesEl.contains(agentStatusEl)) {
      return agentStatusEl;
    }
    agentStatusEl = document.createElement("div");
    agentStatusEl.id = "agentStatus";
    agentStatusEl.className = "agent-status agent-status-in-messages";
    agentStatusEl.hidden = true;
    messagesEl.appendChild(agentStatusEl);
    return agentStatusEl;
  }

  function applyAgentStatusState(text, hidden, phase, modelLabel) {
    const nextHidden = Boolean(hidden || !text);
    agentStatusState = {
      text: nextHidden ? "" : text,
      hidden: nextHidden,
      phase: nextHidden ? "" : phase || "",
      modelLabel: nextHidden ? "" : modelLabel || "",
    };
  }

  function isAgentTimelineBusy() {
    return Boolean(
      currentChatTurnEl?.querySelector?.(
        ".tool-group.agent-timeline:not([data-sealed])"
      )
    );
  }

  /** Old «Думаю…» line — the run group («выполняю») is the only live status. */
  function shouldSuppressStatusPhase(phase) {
    return (
      !phase ||
      phase === "cline" ||
      phase === "reading" ||
      phase === "listing" ||
      phase === "editing" ||
      phase === "running" ||
      phase === "thinking" ||
      phase === "verifying"
    );
  }

  function setAgentStatus(text, hidden, phase, modelLabel) {
    // «выполняю» replaces the pulsing «Думаю…» line for the whole run,
    // even before the first tool/thinking step arrives.
    const suppressPhase =
      !hidden && (busy || isAgentTimelineBusy() || shouldSuppressStatusPhase(phase || ""));
    if (suppressPhase) {
      applyAgentStatusState(text, false, phase, modelLabel);
      if (agentStatusEl) {
        agentStatusEl.hidden = true;
      }
      return;
    }

    applyAgentStatusState(text, hidden, phase, modelLabel);

    if (agentStatusState.hidden) {
      if (agentStatusEl) {
        agentStatusEl.hidden = true;
        agentStatusEl.textContent = "";
        agentStatusEl.removeAttribute("data-phase");
      }
      return;
    }

    const el = ensureAgentStatusEl();
    el.hidden = false;
    el.replaceChildren();
    const label = document.createElement("span");
    label.className = "agent-status-text";
    label.textContent = agentStatusState.text;
    el.appendChild(label);
    if (agentStatusState.phase) {
      el.dataset.phase = agentStatusState.phase;
    } else {
      el.removeAttribute("data-phase");
    }
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function restoreAgentStatus() {
    if (agentStatusState.hidden) {
      agentStatusEl = null;
      return;
    }
    agentStatusEl = null;
    setAgentStatus(
      agentStatusState.text,
      false,
      agentStatusState.phase,
      agentStatusState.modelLabel
    );
  }

  function keepStatusAtEnd() {
    if (agentStatusState.hidden) {
      return;
    }
    if (
      busy ||
      isAgentTimelineBusy() ||
      shouldSuppressStatusPhase(agentStatusState.phase || "")
    ) {
      if (agentStatusEl) {
        agentStatusEl.hidden = true;
      }
      return;
    }
    if (agentStatusEl && agentStatusEl.hidden) {
      return;
    }
    messagesEl.appendChild(ensureAgentStatusEl());
  }

  function setCanRegenerate(nextValue) {
    canRegenerate = Boolean(nextValue);
  }

  function focusEditingInput() {
    if (!Number.isInteger(editingUserIndex)) {
      return;
    }
    const input = messagesEl.querySelector(
      `.msg-edit-input[data-index="${editingUserIndex}"]`
    );
    if (!(input instanceof HTMLTextAreaElement)) {
      return;
    }
    requestAnimationFrame(() => {
      input.focus();
      const pos = input.value.length;
      input.setSelectionRange(pos, pos);
    });
  }

  function startEditingUserMessage(index) {
    const item = uiMessagesCache[index];
    if (!item || item.role !== "user" || busy) {
      return;
    }
    const preservedScrollTop = messagesEl.scrollTop;
    closeMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    pickAttachmentsForEdit = false;
    editingUserIndex = index;
    editingUserText = String(item.text || "");
    editingModelId = selectedModelId || models[0]?.id || "";
    editingModeId = normalizeAgentModeUi(item.mode || agentMode || "agent");
    editingReasoningEffort = modelSupportsReasoning(editingModelId)
      ? normalizeReasonLevel(selectedReasoningEffort) ||
        defaultReasonForModel(editingModelId)
      : "";
    editingAttachments = Array.isArray(item.attachments)
      ? item.attachments.slice()
      : [];
    renderMessages(uiMessagesCache, "restore", preservedScrollTop);
  }

  function cancelEditingUserMessage() {
    const preservedScrollTop = messagesEl.scrollTop;
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    pickAttachmentsForEdit = false;
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingModeId = "";
    editingReasoningEffort = "";
    editingAttachments = [];
    renderMessages(uiMessagesCache, "restore", preservedScrollTop);
  }

  function submitEditedUserMessage() {
    if (!Number.isInteger(editingUserIndex)) {
      return;
    }
    if (busy) {
      showCopyToast(
        UI_LANG === "ru"
          ? "Дождитесь окончания текущего хода или остановите его."
          : "Wait for the current turn to finish, or stop it."
      );
      return;
    }
    const input = messagesEl.querySelector(
      `.msg-edit-input[data-index="${editingUserIndex}"]`
    );
    if (input instanceof HTMLTextAreaElement) {
      editingUserText = input.value;
    }
    const nextText = editingUserText.trim();
    const attachments = editingAttachments.slice();
    if (!nextText && !attachments.length) {
      showCopyToast(
        UI_LANG === "ru" ? "Введите текст сообщения." : "Enter a message."
      );
      return;
    }
    const model =
      editingModelId || selectedModelId || models[0]?.id || "";
    const mode = normalizeAgentModeUi(editingModeId || agentMode);
    if (model && model !== selectedModelId) {
      setSelectedModel(model, true);
    }
    if (mode && mode !== agentMode) {
      setAgentMode(mode, { close: true, notify: true, focus: false });
    }
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    pickAttachmentsForEdit = false;
    harborEditSaveAt = Date.now();
    stickToBottom = true;
    setBusy(true);
    host.postMessage({
      type: "editUserMessage",
      index: editingUserIndex,
      text: nextText,
      model,
      agentMode: mode,
      reasoningEffort:
        editingReasoningEffort || selectedReasoningEffort || undefined,
      attachments: attachments.map(attachmentPayload),
    });
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingModeId = "";
    editingReasoningEffort = "";
    editingAttachments = [];
  }

  function eventTargetElement(event) {
    const target = event.target;
    if (target instanceof Element) {
      return target;
    }
    if (target && target.parentElement instanceof Element) {
      return target.parentElement;
    }
    return null;
  }

  /** VS Code webview often drops `click` on the sticky edit-save control. */
  function trySubmitEditedUserMessageFromPointer(event) {
    if (event.button != null && event.button !== 0) {
      return false;
    }
    const target = eventTargetElement(event);
    if (!target || !messagesEl) {
      return false;
    }
    const saveBtn = target.closest(".msg-edit-save");
    if (!saveBtn || !messagesEl.contains(saveBtn) || saveBtn.disabled) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() - harborEditSaveAt < 450) {
      return true;
    }
    submitEditedUserMessage();
    return true;
  }

  function modelDisplayName(id) {
    const model = models.find((m) => m.id === id);
    return model ? model.label || model.id : id || t("noModels");
  }

  function modeDisplayName(id) {
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const wanted = String(id || "").trim();
    const raw =
      modes.find((m) => m.id === wanted) ||
      modes.find((m) => m.id === "agent") ||
      modes[0];
    if (!raw) {
      return t("mode");
    }
    const mode = localizeModeMeta(raw);
    return mode.label || mode.id || t("mode");
  }

  function renderEditModelMenu(menuEl) {
    if (!menuEl) {
      return;
    }
    menuEl.innerHTML = "";
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = t("noModelsInSettings");
      menuEl.appendChild(empty);
      return;
    }
    for (const model of models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (model.id === editingModelId ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("data-model-id", model.id);
      btn.dataset.id = model.id;

      const label = document.createElement("span");
      label.className = "model-option-label";
      label.textContent = model.label || model.id;
      btn.appendChild(label);

      if (model.id === editingModelId) {
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

      menuEl.appendChild(btn);
    }
  }

  function getEditModelPicker() {
    return messagesEl.querySelector(".msg-edit-model-picker");
  }

  const modelMenuHomes = new WeakMap();

  function ensureModelMenuFloated(menu) {
    if (!menu || menu.parentElement === document.body) {
      return;
    }
    if (!modelMenuHomes.has(menu)) {
      modelMenuHomes.set(menu, {
        parent: menu.parentElement,
        next: menu.nextSibling,
      });
    }
    document.body.appendChild(menu);
  }

  function restoreModelMenuHome(menu) {
    if (!menu) {
      return;
    }
    const home = modelMenuHomes.get(menu);
    modelMenuHomes.delete(menu);
    if (!home || !home.parent || !home.parent.isConnected) {
      return;
    }
    if (home.next && home.next.parentNode === home.parent) {
      home.parent.insertBefore(menu, home.next);
    } else {
      home.parent.appendChild(menu);
    }
  }

  function findEditModelMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-model-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-model-menu");
  }

  function clearModelMenuPlacementStyles(menu) {
    if (!menu) {
      return;
    }
    menu.classList.remove("opens-down", "is-fixed");
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.bottom = "";
    menu.style.width = "";
    menu.style.minWidth = "";
    menu.style.maxHeight = "";
    menu.style.zIndex = "";
    menu.style.visibility = "";
  }

  function resetModelMenuPlacement(picker, menu) {
    if (picker) {
      picker.classList.remove("opens-down");
    }
    clearModelMenuPlacementStyles(menu);
    restoreModelMenuHome(menu);
  }

  /**
   * Float the menu to document.body + position:fixed so #messages overflow
   * and sticky stacking contexts cannot clip it.
   */
  function placeModelMenu(picker, menu, boundaryEl) {
    if (!picker || !menu || menu.hidden) {
      return;
    }
    if (picker) {
      picker.classList.remove("opens-down");
    }
    clearModelMenuPlacementStyles(menu);

    const gap = 6;
    const cssMax = 240;
    const edgePad = 8;
    const boundary =
      boundaryEl || chatScreen || document.documentElement;
    const trigger =
      picker.querySelector(".model-trigger") || picker;
    const triggerRect = trigger.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();

    ensureModelMenuFloated(menu);
    menu.classList.add("is-fixed");
    menu.style.position = "fixed";
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.visibility = "hidden";
    menu.style.zIndex = "10000";
    menu.style.minWidth =
      Math.round(Math.max(220, triggerRect.width)) + "px";

    const naturalHeight = Math.min(
      Math.max(menu.scrollHeight, 1),
      cssMax
    );
    const menuWidth = Math.min(
      320,
      Math.max(220, triggerRect.width, menu.offsetWidth || 0)
    );

    const availAbove =
      Math.min(
        triggerRect.top - boundaryRect.top,
        triggerRect.top
      ) - gap;
    const availBelow =
      Math.min(
        boundaryRect.bottom - triggerRect.bottom,
        window.innerHeight - triggerRect.bottom
      ) - gap;
    const openDown =
      availAbove < naturalHeight && availBelow > availAbove;

    let left = triggerRect.left;
    const maxLeft = window.innerWidth - menuWidth - edgePad;
    if (left > maxLeft) {
      left = Math.max(edgePad, maxLeft);
    }
    if (left < edgePad) {
      left = edgePad;
    }

    menu.style.visibility = "";
    menu.style.left = Math.round(left) + "px";

    const minMenu = 120;
    if (openDown) {
      picker.classList.add("opens-down");
      menu.classList.add("opens-down");
      menu.style.top = Math.round(triggerRect.bottom + gap) + "px";
      menu.style.bottom = "auto";
      let below = Math.floor(availBelow);
      if (below < minMenu) {
        below = Math.min(
          cssMax,
          Math.max(minMenu, window.innerHeight - triggerRect.bottom - gap - edgePad)
        );
      }
      menu.style.maxHeight = Math.max(minMenu, Math.min(cssMax, below)) + "px";
    } else {
      menu.style.top = "auto";
      menu.style.bottom =
        Math.round(window.innerHeight - triggerRect.top + gap) + "px";
      let above = Math.floor(availAbove);
      if (above < minMenu) {
        above = Math.min(
          cssMax,
          Math.max(minMenu, triggerRect.top - gap - edgePad)
        );
      }
      menu.style.maxHeight = Math.max(minMenu, Math.min(cssMax, above)) + "px";
    }
    if (typeof forceHarborUiRepaint === "function") {
      forceHarborUiRepaint();
      setTimeout(forceHarborUiRepaint, 32);
    }
  }

  function closeEditModelMenu() {
    editModelMenuOpen = false;
    const picker = getEditModelPicker();
    const menu = findEditModelMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-model-trigger");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditModelMenu() {
    const picker = getEditModelPicker();
    if (!picker) {
      return;
    }
    if (busy) {
      showCopyToast(
        UI_LANG === "ru"
          ? "Дождитесь окончания текущего хода или остановите его."
          : "Wait for the current turn to finish, or stop it."
      );
      return;
    }
    closeMenu();
    closeEditModeMenu();
    editModelMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-model-trigger");
    const menu = findEditModelMenu(picker);
    renderEditModelMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
    }
  }

  function toggleEditModelMenu() {
    if (editModelMenuOpen) {
      closeEditModelMenu();
    } else {
      openEditModelMenu();
    }
  }

  function selectEditingModel(id) {
    const next = String(id || "").trim();
    if (!next) {
      closeEditModelMenu();
      return;
    }
    editingModelId = next;
    if (modelSupportsReasoning(editingModelId)) {
      editingReasoningEffort =
        normalizeReasonLevel(editingReasoningEffort) ||
        defaultReasonForModel(editingModelId);
    } else {
      editingReasoningEffort = "";
    }
    const picker = getEditModelPicker();
    const label = picker
      ? picker.querySelector(".msg-edit-model-label")
      : null;
    const trigger = picker
      ? picker.querySelector(".msg-edit-model-trigger")
      : null;
    const full = modelDisplayName(editingModelId);
    if (label) {
      label.textContent = shortModelChip(full);
    }
    if (trigger) {
      trigger.title = full;
    }
    updateEditReasonPickerUI();
    closeEditModelMenu();
  }

  function editingModelIdFromOption(option) {
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

  function selectEditingModelFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-model-menu .model-option")
        : null;
    if (!option || option.classList.contains("is-empty")) {
      return false;
    }
    selectEditingModel(editingModelIdFromOption(option));
    return true;
  }

  function getEditModePicker() {
    return messagesEl.querySelector(".msg-edit-mode-picker");
  }

  function findEditModeMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-mode-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-mode-menu");
  }

  function renderEditModeMenu(menuEl) {
    if (!menuEl) {
      return;
    }
    menuEl.innerHTML = "";
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    if (!modes.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = t("noModes");
      menuEl.appendChild(empty);
      return;
    }
    const activeId = normalizeAgentModeUi(editingModeId || agentMode);
    for (const sourceMode of modes) {
      const mode = localizeModeMeta(sourceMode);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (mode.id === activeId ? " is-active" : "");
      btn.dataset.mode = mode.id;
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
      if (mode.id === activeId) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML = CHECK_ICON;
        btn.appendChild(check);
      }
      menuEl.appendChild(btn);
    }
  }

  function closeEditModeMenu() {
    editModeMenuOpen = false;
    const picker = getEditModePicker();
    const menu = findEditModeMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-mode-trigger");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditModeMenu() {
    const picker = getEditModePicker();
    if (!picker) {
      return;
    }
    if (busy) {
      showCopyToast(
        UI_LANG === "ru"
          ? "Дождитесь окончания текущего хода или остановите его."
          : "Wait for the current turn to finish, or stop it."
      );
      return;
    }
    closeMenu();
    closeModeMenu();
    closeEditModelMenu();
    editModeMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-mode-trigger");
    const menu = findEditModeMenu(picker);
    renderEditModeMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
    }
  }

  function toggleEditModeMenu() {
    if (editModeMenuOpen) {
      closeEditModeMenu();
    } else {
      openEditModeMenu();
    }
  }

  function selectEditingMode(id) {
    const next = normalizeAgentModeUi(id);
    editingModeId = next;
    const picker = getEditModePicker();
    const label = picker
      ? picker.querySelector(".msg-edit-mode-label")
      : null;
    if (label) {
      label.textContent = modeDisplayName(editingModeId);
    }
    if (picker) {
      applyModeAccentToElement(picker, editingModeId);
    }
    const editComposer = messagesEl
      ? messagesEl.querySelector(".msg-edit-composer")
      : null;
    if (editComposer) {
      applyModeAccentToElement(editComposer, editingModeId);
    }
    closeEditModeMenu();
  }

  function selectEditingModeFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-mode-menu .model-option")
        : null;
    if (!option || option.classList.contains("is-empty")) {
      return false;
    }
    const modeId = String(option.dataset.mode || "").trim();
    if (!modeId) {
      return false;
    }
    selectEditingMode(modeId);
    return true;
  }

  /* --- Edit-composer "+" (attachments) picker — mirrors composerPlus. --- */

  function getEditPlusPicker() {
    return messagesEl.querySelector(".msg-edit-plus");
  }

  function findEditPlusMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-plus-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-plus-menu");
  }

  function closeEditPlusMenu() {
    editPlusMenuOpen = false;
    const picker = getEditPlusPicker();
    const menu = findEditPlusMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-plus-btn");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditPlusMenu() {
    const picker = getEditPlusPicker();
    if (!picker) {
      return;
    }
    closeMenu();
    closeModeMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditReasonMenu();
    editPlusMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-plus-btn");
    const menu = findEditPlusMenu(picker);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
    }
  }

  function toggleEditPlusMenu() {
    if (editPlusMenuOpen) {
      closeEditPlusMenu();
    } else {
      openEditPlusMenu();
    }
  }

  /* --- Edit-composer reason (Intelligence) picker — mirrors reasonPicker. --- */

  function getEditReasonPicker() {
    return messagesEl.querySelector(".msg-edit-reason-picker");
  }

  function findEditReasonMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-reason-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-reason-menu");
  }

  function updateEditReasonPickerUI() {
    const picker = getEditReasonPicker();
    if (!picker) {
      return;
    }
    const supported = modelSupportsReasoning(
      editingModelId || selectedModelId
    );
    picker.hidden = !supported;
    if (!supported) {
      closeEditReasonMenu();
      return;
    }
    const level =
      normalizeReasonLevel(editingReasoningEffort) ||
      defaultReasonForModel(editingModelId || selectedModelId);
    const label = picker.querySelector(".msg-edit-reason-label");
    const trigger = picker.querySelector(".msg-edit-reason-trigger");
    if (label) {
      label.textContent = reasonLevelLabel(level);
    }
    if (trigger) {
      trigger.title = `${t("intelligence")}: ${reasonLevelLabel(level)}`;
    }
  }

  function renderEditReasonMenu(menuEl) {
    if (!menuEl) {
      return;
    }
    menuEl.innerHTML = "";
    const activeLevel = normalizeReasonLevel(editingReasoningEffort);
    for (const level of REASON_LEVELS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (level.id === activeLevel ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.dataset.reason = level.id;
      const label = document.createElement("span");
      label.className = "model-option-label";
      label.textContent = t(level.labelKey);
      btn.appendChild(label);
      if (level.id === activeLevel) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML = CHECK_ICON;
        btn.appendChild(check);
      }
      menuEl.appendChild(btn);
    }
  }

  function closeEditReasonMenu() {
    editReasonMenuOpen = false;
    const picker = getEditReasonPicker();
    const menu = findEditReasonMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-reason-trigger");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditReasonMenu() {
    const picker = getEditReasonPicker();
    if (!picker || picker.hidden) {
      return;
    }
    closeMenu();
    closeModeMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    editReasonMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-reason-trigger");
    const menu = findEditReasonMenu(picker);
    renderEditReasonMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
    }
  }

  function toggleEditReasonMenu() {
    if (editReasonMenuOpen) {
      closeEditReasonMenu();
    } else {
      openEditReasonMenu();
    }
  }

  function selectEditingReasoningEffort(id) {
    const next = normalizeReasonLevel(id);
    if (!modelSupportsReasoning(editingModelId || selectedModelId)) {
      editingReasoningEffort = "";
      updateEditReasonPickerUI();
      closeEditReasonMenu();
      return;
    }
    editingReasoningEffort =
      next || defaultReasonForModel(editingModelId || selectedModelId);
    updateEditReasonPickerUI();
    closeEditReasonMenu();
  }

  /* --- Edit-composer attachments — mirrors pendingAttachments flow. --- */

  function refreshEditingAttachmentsPreview() {
    const composer = messagesEl.querySelector(".msg-edit-composer");
    if (!composer) {
      return;
    }
    // Replace the read-only render (plain .msg-attachments) — edit mode
    // shows removable chips instead.
    composer
      .querySelectorAll(
        ".msg-attachments:not(.msg-edit-attach-preview)"
      )
      .forEach((el) => el.remove());
    let container = composer.querySelector(
      ".msg-attachments.msg-edit-attach-preview"
    );
    if (!editingAttachments.length) {
      if (container) {
        container.remove();
      }
      return;
    }
    if (!container) {
      container = document.createElement("div");
      container.className = "msg-attachments msg-edit-attach-preview";
      const textarea = composer.querySelector(".msg-edit-input");
      if (textarea) {
        composer.insertBefore(container, textarea);
      } else {
        composer.prepend(container);
      }
    }
    container.innerHTML = editingAttachments
      .map((att) => {
        const full = String(att.path || att.name || "file");
        const title = escapeHtml(full);
        const src = attachmentPreviewSrc(att);
        const remove =
          `<button type="button" class="attach-chip-remove" data-id="${escapeHtml(
            att.id
          )}" title="${t("remove")}" aria-label="${t("remove")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
          `</button>`;
        if (attachmentLooksLikeImage(att) && src) {
          return (
            `<div class="attach-chip attach-chip-image" data-id="${escapeHtml(
              att.id
            )}" title="${title}">` +
            `<img class="attach-thumb" src="${src}" alt="" decoding="sync" />` +
            `<span class="msg-attach-image-badge" aria-hidden="true">` +
            `<span class="material-symbols-outlined">image</span>` +
            `</span>` +
            remove +
            `</div>`
          );
        }
        return renderFileTypeChip(att, "attach-chip", remove);
      })
      .join("");
  }

  function mergeEditingAttachments(list) {
    if (!Array.isArray(list) || !list.length) {
      return;
    }
    let changed = false;
    for (const item of list) {
      if (editingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      const id =
        item.id ||
        `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (editingAttachments.some((a) => a.id === id)) {
        continue;
      }
      const kind = attachmentLooksLikeImage(item)
        ? "image"
        : item.kind || "file";
      editingAttachments.push({
        id,
        kind,
        name: item.name || "file",
        mime: item.mime || "application/octet-stream",
        path: item.path,
        storageKey: item.storageKey,
        size: item.size,
        dataBase64: item.dataBase64,
        previewDataUrl: item.previewDataUrl,
      });
      changed = true;
    }
    if (changed) {
      refreshEditingAttachmentsPreview();
    }
  }

  function removeEditingAttachment(id) {
    const before = editingAttachments.length;
    editingAttachments = editingAttachments.filter((a) => a.id !== id);
    if (editingAttachments.length !== before) {
      refreshEditingAttachmentsPreview();
    }
  }

  function selectEditingReasonFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-reason-menu .model-option")
        : null;
    if (!option) {
      return false;
    }
    selectEditingReasoningEffort(String(option.dataset.reason || ""));
    return true;
  }

  function selectEditPlusItemFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const item =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-plus-menu .composer-plus-item")
        : null;
    if (!item || item.disabled || item.classList.contains("is-disabled")) {
      return false;
    }
    const action = item.getAttribute("data-action");
    closeEditPlusMenu();
    if (action === "file") {
      pickAttachmentsForEdit = true;
      host.postMessage({ type: "pickAttachments" });
    }
    return true;
  }

  function removeRegenerateButtons() {
    const btns = messagesEl.querySelectorAll(".msg-regenerate");
    btns.forEach((b) => b.remove());
  }

  function branchButtonHtml(index) {
    return (
      `<button type="button" class="icon-btn msg-branch" data-index="${index}" title="${t("branch")}" aria-label="${t("branch")}">` +
      BRANCH_ICON +
      `</button>`
    );
  }

  function copyAssistantFromButton(btn) {
    const wrap = btn.closest(".msg-wrap-assistant");
    const msg = wrap?.querySelector(".msg.assistant");
    const raw = String(msg?.dataset.raw || msg?.querySelector(".msg-body")?.innerText || "").trim();
    if (!raw) {
      return;
    }
    const done = () => showCopyToast(t("copied"));
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(raw).then(done).catch(() => {
        host.postMessage({ type: "copyText", text: raw });
      });
      return;
    }
    host.postMessage({ type: "copyText", text: raw });
  }

  function assistantActionsHtml(index, showRegen) {
    const copyHtml =
      `<button type="button" class="icon-btn msg-copy" data-index="${index}" title="${t("copy")}" aria-label="${t("copy")}">` +
      COPY_ICON +
      `</button>`;
    const branchHtml = Number.isInteger(index) ? branchButtonHtml(index) : "";
    const regenHtml = showRegen
      ? `<button type="button" class="icon-btn msg-regenerate" title="${t("regenerateLast")}" aria-label="${t("regenerateLast")}">` +
        REGENERATE_ICON +
        `</button>`
      : "";
    return copyHtml + branchHtml + regenHtml;
  }

  function ensureRegenerateButton() {
    removeRegenerateButtons();
    if (!canRegenerate) {
      return;
    }
    const all = messagesEl.querySelectorAll(".msg.assistant");
    const last = all.length ? all[all.length - 1] : null;
    if (!last) {
      return;
    }
    const index = Number(last.dataset.index);
    const actionsHtml = assistantActionsHtml(index, true);

    const parent = last.parentElement;
    if (parent && parent.classList.contains("msg-wrap-assistant")) {
      let actions = parent.querySelector(".msg-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "msg-actions";
        parent.appendChild(actions);
      }
      actions.innerHTML = actionsHtml;
      return;
    }

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = actionsHtml;

    const wrap = document.createElement("div");
    wrap.className = "msg-wrap msg-wrap-assistant";
    (parent || messagesEl).insertBefore(wrap, last);
    wrap.appendChild(last);
    wrap.appendChild(actions);
  }

  function renderChatBranches(list) {
    chatBranches = Array.isArray(list) ? list : [];
    if (!chatBranchesEl) {
      return;
    }
    if (chatBranches.length < 2) {
      chatBranchesEl.hidden = true;
      chatBranchesEl.innerHTML = "";
      forceHarborUiRepaint();
      return;
    }
    chatBranchesEl.hidden = false;
    chatBranchesEl.innerHTML = chatBranches
      .map((b) => {
        const active = b.active ? " is-active" : "";
        const selected = b.active ? "true" : "false";
        const closeBtn = b.canDelete
          ? `<button type="button" class="chat-branch-close" data-chat-id="${escapeHtml(
              b.id || ""
            )}" title="${t("deleteBranch")}" aria-label="${t("deleteBranch")}">` +
            `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
            `</button>`
          : "";
        return (
          `<div class="chat-branch-item${active}" role="presentation">` +
          `<button type="button" class="chat-branch-pill${active}" role="tab" aria-selected="${selected}" data-chat-id="${escapeHtml(
            b.id || ""
          )}" title="${escapeHtml(b.label || t("branchDefault"))}">` +
          escapeHtml(b.label || t("branchDefault")) +
          `</button>` +
          closeBtn +
          `</div>`
        );
      })
      .join("");
    forceHarborUiRepaint();
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
    contextRingEl.setAttribute("aria-label", `Context: ${tip}`);
    contextRingEl.hidden = false;
    if (stickToBottom) {
      scrollToBottom();
    }
  }

  /**
   * Map legacy tool names to current Cline names so labels stay correct even
   * if a stale bundle is loaded. Keys are old Harbor names; values are the
   * canonical Cline tool name.

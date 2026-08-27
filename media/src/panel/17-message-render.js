
  let copyToastEl = null;
  let copyToastTimer = null;

  function ensureCopyToast() {
    if (copyToastEl) {
      return copyToastEl;
    }
    copyToastEl = document.createElement("div");
    copyToastEl.className = "copy-toast";
    copyToastEl.hidden = true;
    document.body.appendChild(copyToastEl);
    return copyToastEl;
  }

  function showCopyToast(text) {
    const toast = ensureCopyToast();
    toast.textContent = text || t("copied");
    toast.hidden = false;
    if (copyToastTimer) {
      clearTimeout(copyToastTimer);
    }
    copyToastTimer = setTimeout(() => {
      copyToastTimer = null;
      toast.hidden = true;
    }, 1200);
  }


  function setMessageContent(el, role, text) {
    const raw = text || "";
    el.dataset.raw = raw;
    let body = el.querySelector(".msg-body");
    if (!body) {
      body = document.createElement("div");
      body.className = "msg-body";
      el.insertBefore(body, el.firstChild);
    }
    if (role === "user" && looksLikePlanImplementDisplay(raw)) {
      // Keep full Build payload in dataset.raw for the model / edit-resend;
      // in chat show a short handoff chip — not a second copy of the plan.
      el.classList.add("is-plan-implement");
      body.innerHTML =
        `<span class="plan-implement-chip">` +
        `<span class="material-symbols-outlined" aria-hidden="true">construction</span>` +
        `<span>${escapeHtml(t("proposedPlanImplementBubble"))}</span>` +
        `</span>`;
      return;
    }
    if (role === "user") {
      const extracted = extractUserFileChips(raw);
      const md = extracted.text
        ? renderInlineMarkdown(extracted.text, { userChrome: true })
        : "";
      const chipsHtml = extracted.chips.length
        ? `<div class="msg-attachments">${extracted.chips.join("")}</div>`
        : "";
      if (extracted.chips.length) {
        el.classList.add("has-attach");
      }
      body.innerHTML =
        chipsHtml + (md ? `<div class="msg-text">${md}</div>` : "");
      return;
    }
    if (role === "assistant" || role === "error") {
      body.innerHTML = renderInlineMarkdown(raw);
      return;
    }
    if (role === "tool") {
      const formatted = formatToolLine(raw);
      // Сырой вывод (git remote, MR URL) — с кликабельными ссылками.
      if (/https?:\/\//i.test(formatted) || /`[^`]+`/.test(formatted)) {
        body.innerHTML = `<div class="tool-output">${linkifyPlainText(
          formatted,
          false
        ).replace(/\n/g, "<br />")}</div>`;
      } else {
        body.textContent = formatted;
      }
      return;
    }
    body.textContent = raw;
  }

  function appendMessage(
    role,
    text,
    index,
    regenAssistantIndex,
    attachments,
    shouldScroll = true,
    reasoning,
    step,
    detail
  ) {
    if (role === "review") {
      sealToolGroups();
      try {
        appendReview(parseReviewData(text));
      } catch {
        // ignore bad payload
      }
      return null;
    }

    if (role === "tool") {
      return appendToolToGroup(text, index, step);
    }

    sealToolGroups();

    // History restore only — live turns already painted Thinking via steps.
    if (role === "assistant" && String(reasoning || "").trim()) {
      const turn =
        currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
          ? currentChatTurnEl
          : null;
      const alreadyHasThinking = Boolean(
        turn?.querySelector(".agent-step[data-step-kind='thinking']")
      );
      if (!alreadyHasThinking) {
        upsertReasoning(String(reasoning).trim());
        sealToolGroups();
      }
    }

    const el = document.createElement("div");
    el.className = `msg ${role}`;
    if (typeof index === "number") {
      el.dataset.index = String(index);
    }
    if (role === "user") {
      const cachedMode =
        typeof index === "number"
          ? String(uiMessagesCache[index]?.mode || "").trim()
          : "";
      if (cachedMode) {
        applyModeAccentToElement(el, cachedMode);
      }
    }

    const body = document.createElement("div");
    body.className = "msg-body";
    el.appendChild(body);
    setMessageContent(el, role, text);

    if (role === "user") {
      const isEditing = index === editingUserIndex;
      const msgAttachments = isEditing
        ? editingAttachments
        : Array.isArray(attachments)
          ? attachments
          : [];
      if (isEditing) {
        el.classList.add("is-editing");
        const editModeId = normalizeAgentModeUi(editingModeId || agentMode);
        const editModeLabel = modeDisplayName(editModeId);
        const editModelFull = modelDisplayName(
          editingModelId || selectedModelId
        );
        const editModelLabel = shortModelChip(editModelFull);
        const editReasonSupported = modelSupportsReasoning(
          editingModelId || selectedModelId
        );
        const editReasonLabel = editReasonSupported
          ? reasonLevelLabel(
              normalizeReasonLevel(editingReasoningEffort) ||
                defaultReasonForModel(editingModelId || selectedModelId)
            )
          : "";
        body.innerHTML =
          `<div class="msg-edit-composer">` +
          (msgAttachments.length
            ? renderMessageAttachments(msgAttachments)
            : "") +
          `<textarea class="msg-edit-input" data-index="${index}" rows="3" aria-label="${t("editMessage")}"></textarea>` +
          `<div class="msg-edit-footer">` +
          `<div class="msg-edit-footer-left">` +
          `<div class="composer-plus msg-edit-plus">` +
          `<button type="button" class="icon-btn msg-edit-plus-btn" aria-haspopup="menu" aria-expanded="false" title="${t("add")}" aria-label="${t("add")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">add</span>` +
          `</button>` +
          `<div class="composer-plus-menu msg-edit-plus-menu" role="menu" hidden>` +
          `<button type="button" class="composer-plus-item" data-action="file" role="menuitem">` +
          `<span class="material-symbols-outlined" aria-hidden="true">attach_file</span>` +
          `<span>${escapeHtml(t("file"))}</span>` +
          `</button>` +
          `</div>` +
          `</div>` +
          `<div class="model-picker mode-picker msg-edit-mode-picker" data-mode="${escapeHtml(
            editModeId
          )}">` +
          `<button type="button" class="model-trigger msg-edit-mode-trigger" aria-haspopup="listbox" aria-expanded="false" title="${t("mode")}">` +
          `<span class="model-label msg-edit-mode-label">${escapeHtml(
            editModeLabel
          )}</span>` +
          `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
          `</button>` +
          `<div class="model-menu msg-edit-mode-menu" role="listbox" hidden></div>` +
          `</div>` +
          `</div>` +
          `<div class="msg-edit-footer-right">` +
          `<div class="model-picker msg-edit-model-picker" id="msgEditModelPicker">` +
          `<button type="button" class="model-trigger msg-edit-model-trigger" aria-haspopup="listbox" aria-expanded="false" title="${escapeHtml(
            editModelFull
          )}">` +
          `<span class="model-label msg-edit-model-label">${escapeHtml(
            editModelLabel
          )}</span>` +
          `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
          `</button>` +
          `<div class="model-menu msg-edit-model-menu" role="listbox" hidden></div>` +
          `</div>` +
          (editReasonSupported
            ? `<div class="model-picker reason-picker msg-edit-reason-picker">` +
              `<button type="button" class="model-trigger msg-edit-reason-trigger" aria-haspopup="listbox" aria-expanded="false" title="${escapeHtml(
                t("intelligence")
              )}">` +
              `<span class="material-symbols-outlined reason-icon" aria-hidden="true">neurology</span>` +
              `<span class="model-label msg-edit-reason-label">${escapeHtml(
                editReasonLabel
              )}</span>` +
              `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
              `</button>` +
              `<div class="model-menu msg-edit-reason-menu" role="listbox" hidden></div>` +
              `</div>`
            : "") +
          `<button type="button" class="primary msg-edit-save" data-index="${index}" title="${t("saveAndResend")}" aria-label="${t("saveAndResend")}">` +
          `<span class="material-symbols-outlined icon-send" aria-hidden="true">arrow_upward</span>` +
          `</button>` +
          `</div>` +
          `</div>` +
          `</div>`;
        const editModePicker = body.querySelector(".msg-edit-mode-picker");
        if (editModePicker) {
          applyModeAccentToElement(editModePicker, editModeId);
        }
        const editComposer = body.querySelector(".msg-edit-composer");
        if (editComposer) {
          applyModeAccentToElement(editComposer, editModeId);
        }
        const input = body.querySelector(".msg-edit-input");
        if (input) {
          input.value = editingUserText;
        }
        // Removable attachment chips replace the read-only preview in edit mode.
        if (msgAttachments.length) {
          refreshEditingAttachmentsPreview();
        }
        const saveBtn = body.querySelector(".msg-edit-save");
        if (saveBtn) {
          saveBtn.addEventListener("pointerdown", (event) => {
            trySubmitEditedUserMessageFromPointer(event);
          });
        }
      } else if (msgAttachments.length) {
        const attachHtml = renderMessageAttachments(msgAttachments);
        if (attachHtml) {
          el.classList.add("has-attach");
          const existing = body.querySelector(".msg-attachments");
          if (existing) {
            const tmp = document.createElement("div");
            tmp.innerHTML = attachHtml;
            const incoming = tmp.querySelector(".msg-attachments");
            if (incoming) {
              existing.insertAdjacentHTML("afterbegin", incoming.innerHTML);
            }
          } else {
            const textHtml = body.innerHTML;
            body.innerHTML =
              attachHtml +
              (String(text || "").trim()
                ? `<div class="msg-text">${textHtml}</div>`
                : "");
          }
        }
      }
      const wrap = document.createElement("div");
      wrap.className = "msg-wrap msg-wrap-user";
      wrap.appendChild(el);
      startChatTurn().appendChild(wrap);
      keepStatusAtEnd();
      if (shouldScroll) {
        scrollToBottom();
      }
      return el;
    }

    if (role === "assistant" && typeof index === "number") {
      const wrap = document.createElement("div");
      wrap.className = "msg-wrap msg-wrap-assistant";
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const showRegen =
        regenAssistantIndex >= 0 &&
        index === regenAssistantIndex &&
        canRegenerate;
      actions.innerHTML = assistantActionsHtml(index, showRegen);
      wrap.appendChild(el);
      wrap.appendChild(actions);
      ensureChatTurn().appendChild(wrap);
      keepStatusAtEnd();
      if (shouldScroll) {
        scrollToBottom();
      }
      return el;
    }

    ensureChatTurn().appendChild(el);
    keepStatusAtEnd();
    if (shouldScroll) {
      scrollToBottom();
    }
    return el;
  }

  function renderMessages(list, scrollMode = "bottom", restoredScrollTop) {
    restoringChatScroll = true;
    // Full remount destroys DOM nodes — drop the streaming ref so later
    // assistantDelta/Done do not paint into a detached element (invisible
    // until the next chat remount from store).
    streamingEl = null;
    streamingRenderScheduled = false;
    messagesEl.innerHTML = "";
    resetChatTurns();
    uiMessagesCache = Array.isArray(list) ? list : [];
    if (!Array.isArray(list)) {
      restoringChatScroll = false;
      return;
    }

    let regenAssistantIndex = -1;
    if (canRegenerate) {
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        if (
          item?.role === "assistant" &&
          String(item?.text || "").trim()
        ) {
          regenAssistantIndex = i;
          break;
        }
      }
    }

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      appendMessage(
        item.role,
        item.text,
        i,
        regenAssistantIndex,
        item.attachments,
        false,
        item.reasoning,
        item.step,
        item.detail
      );
    }
    restoreAgentStatus();
    syncComposerScmFromCache();
    syncComposerPlanFromCache({ openEditor: false });
    focusEditingInput();
    requestAnimationFrame(() => {
      if (scrollMode === "restore") {
        restoreChatScroll(restoredScrollTop);
      } else {
        scrollToBottom({ force: true });
      }
      restoringChatScroll = false;
    });
    if (chatSearchOpen && chatSearchInput) {
      applyInChatSearchHighlights(chatSearchInput.value);
    }
  }


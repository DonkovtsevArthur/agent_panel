  function buildSlashCompactPrompt(args) {
    const target = String(args || "").trim();
    return target ? t("slashCompactWithTarget", target) : t("slashCompactDefault");
  }

  function parseSlashCommand(raw) {
    const text = String(raw || "").trim();
    if (!text.startsWith("/")) {
      return null;
    }
    const match = text.match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
    if (!match) {
      return null;
    }
    const name = String(match[1] || "").toLowerCase();
    const args = String(match[2] || "").trim();
    switch (name) {
      case "agent":
        return { kind: "mode", mode: "agent", sendText: args };
      case "plan":
        return { kind: "mode", mode: "plan", sendText: args };
      case "ask":
        return { kind: "mode", mode: "ask", sendText: args };
      case "init":
        return {
          kind: "prompt",
          mode: "agent",
          sendText: buildSlashInitPrompt(args),
        };
      case "compact":
        return {
          kind: "prompt",
          mode: "ask",
          sendText: buildSlashCompactPrompt(args),
        };
      default:
        // User command from .harbor/commands/*.md — send as-is; the host
        // expands the template. Keep the current mode.
        if (
          Array.isArray(userSlashCommands) &&
          userSlashCommands.some((c) => c.name === name)
        ) {
          return { kind: "user", mode: "inherit", sendText: text };
        }
        return null;
    }
  }

  function getSlashCommands() {
    const builtins = [
      {
        id: "agent",
        label: "/agent",
        description:
          UI_LANG === "ru"
            ? "Переключить в режим Agent"
            : "Switch to Agent mode",
        kind: "mode",
      },
      {
        id: "plan",
        label: "/plan",
        description:
          UI_LANG === "ru"
            ? "Переключить в режим Plan"
            : "Switch to Plan mode",
        kind: "mode",
      },
      {
        id: "ask",
        label: "/ask",
        description:
          UI_LANG === "ru"
            ? "Переключить в режим Ask"
            : "Switch to Ask mode",
        kind: "mode",
      },
      {
        id: "init",
        label: "/init",
        description:
          UI_LANG === "ru"
            ? "Создать AGENTS.md — ориентир для агента"
            : "Create AGENTS.md agent orientation guide",
        kind: "prompt",
      },
      {
        id: "compact",
        label: "/compact",
        description:
          UI_LANG === "ru"
            ? "Сжать текущий контекст чата"
            : "Compact current chat context",
        kind: "prompt",
      },
    ];
    const users = (Array.isArray(userSlashCommands) ? userSlashCommands : [])
      .map((c) => ({
        id: String(c.name || "").toLowerCase(),
        label: `/${c.name}`,
        description: String(c.description || "").slice(0, 80),
        kind: "user",
      }));
    return [...builtins, ...users];
  }

  function attachmentPayload(att) {
    const row = {
      id: att.id,
      kind: att.kind,
      name: att.name,
      mime: att.mime,
      path: att.path,
      storageKey: att.storageKey,
      size: att.size,
    };
    // JCEF JSQuery truncates multi-MB JSON. Kotlin HarborAttachmentStore
    // already has picker/clipboard/drop bytes — omit huge payloads.
    // Small screenshots still fit JSQuery; include them so a cache miss
    // (paste decoded only in the webview) does not drop the image.
    const data = att.dataBase64;
    const MAX_JSQUERY_BASE64 = 400000;
    if (!harborHostAvailable()) {
      row.dataBase64 = data;
    } else if (
      typeof data === "string" &&
      data.length > 0 &&
      data.length <= MAX_JSQUERY_BASE64
    ) {
      row.dataBase64 = data;
    }
    return row;
  }

  function mergePendingAttachments(list) {
    if (!Array.isArray(list) || !list.length) {
      return;
    }
    for (const item of list) {
      if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      const id = item.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (pendingAttachments.some((a) => a.id === id)) {
        continue;
      }
      const kind = attachmentLooksLikeImage(item)
        ? "image"
        : item.kind || "file";
      pendingAttachments.push({
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
    }
    showScreen("chat");
    renderAttachPreview();
    focusPrompt();
  }

  function removePendingAttachment(id) {
    pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
    renderAttachPreview();
  }

  function clearPendingAttachments() {
    pendingAttachments = [];
    renderAttachPreview();
  }

  function composerHasContent() {
    return Boolean(
      String(promptEl.value || "").trim() ||
        pendingAttachments.length ||
        pendingSelections.length ||
        pendingMentions.length
    );
  }

  function queueChipId() {
    return `q_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function getQueueForChat(chatId) {
    const id = String(chatId || "").trim();
    if (!id) {
      return [];
    }
    if (!messageQueues.has(id)) {
      messageQueues.set(id, []);
    }
    return messageQueues.get(id);
  }

  function getActiveQueue() {
    return getQueueForChat(activeChatId);
  }

  function clearMessageQueue(chatId) {
    const id = String(chatId || "").trim();
    if (!id) {
      return;
    }
    messageQueues.delete(id);
    if (id === activeChatId) {
      renderMessageQueue();
    }
  }

  function queuePreviewText(text) {
    const plain = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) {
      return UI_LANG === "ru" ? "(вложение)" : "(attachment)";
    }
    return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain;
  }

  function renderMessageQueue() {
    if (!messageQueueEl) {
      return;
    }
    const queue = getActiveQueue();
    if (!queue.length) {
      messageQueueEl.hidden = true;
      messageQueueEl.replaceChildren();
      return;
    }
    messageQueueEl.hidden = false;
    messageQueueEl.setAttribute("aria-label", t("queuePending"));
    messageQueueEl.replaceChildren();
    for (const item of queue) {
      const row = document.createElement("div");
      row.className = "message-queue-item";
      row.setAttribute("role", "listitem");
      row.dataset.queueId = item.id;
      row.title = t("queue");
      row.tabIndex = 0;

      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined message-queue-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "schedule";

      const textEl = document.createElement("span");
      textEl.className = "message-queue-text";
      textEl.textContent = queuePreviewText(item.text);

      row.appendChild(icon);
      row.appendChild(textEl);

      const attCount = Array.isArray(item.attachments)
        ? item.attachments.length
        : 0;
      if (attCount > 0) {
        const meta = document.createElement("span");
        meta.className = "message-queue-meta";
        meta.textContent = `×${attCount}`;
        row.appendChild(meta);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "message-queue-remove";
      removeBtn.title = t("queueRemove");
      removeBtn.setAttribute("aria-label", t("queueRemove"));
      removeBtn.dataset.queueId = item.id;
      const removeIcon = document.createElement("span");
      removeIcon.className = "material-symbols-outlined";
      removeIcon.setAttribute("aria-hidden", "true");
      removeIcon.textContent = "close";
      removeBtn.appendChild(removeIcon);
      row.appendChild(removeBtn);

      messageQueueEl.appendChild(row);
    }
  }

  function removeQueuedMessage(queueId) {
    const queue = getActiveQueue();
    const next = queue.filter((item) => item.id !== queueId);
    if (next.length === queue.length) {
      return;
    }
    if (activeChatId) {
      messageQueues.set(activeChatId, next);
    }
    renderMessageQueue();
  }

  function restoreQueuedMessage(queueId) {
    const queue = getActiveQueue();
    const index = queue.findIndex((item) => item.id === queueId);
    if (index < 0) {
      return;
    }
    const [item] = queue.splice(index, 1);
    if (activeChatId) {
      messageQueues.set(activeChatId, queue);
    }
    renderMessageQueue();
    promptEl.value = String(item.text || "");
    autoResizePrompt();
    persistDraftPrompt();
    clearPendingAttachments();
    clearPendingMentions();
    pullMentionsFromPrompt();
    if (Array.isArray(item.attachments) && item.attachments.length) {
      mergePendingAttachments(item.attachments);
    }
    if (item.mode) {
      setAgentMode(item.mode, { close: true, notify: false });
    }
    updateSendButton();
    focusPrompt();
  }

  function enqueueComposerMessage({
    text,
    attachments,
    mode,
    model,
    reasoningEffort,
  }) {
    if (!activeChatId) {
      return false;
    }
    const queue = getActiveQueue();
    if (queue.length >= MAX_MESSAGE_QUEUE) {
      showCopyToast(t("queueFull"));
      return false;
    }
    queue.push({
      id: queueChipId(),
      text,
      attachments: (attachments || []).map((att) => ({ ...att })),
      mode,
      model: model || getSelectedModel(),
      reasoningEffort: reasoningEffort || undefined,
    });
    messageQueues.set(activeChatId, queue);
    renderMessageQueue();
    return true;
  }

  function dispatchQueuedSend(item) {
    const text = String(item.text || "").trim();
    const attachments = Array.isArray(item.attachments)
      ? item.attachments.slice()
      : [];
    if (!text && !attachments.length) {
      return;
    }
    const modeForSend = normalizeAgentModeUi(item.mode || agentMode);
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
    setBusy(true);
    host.postMessage({
      type: "send",
      text,
      model: item.model || getSelectedModel(),
      agentMode: modeForSend,
      reasoningEffort: item.reasoningEffort || undefined,
      attachments: attachments.map(attachmentPayload),
    });
  }

  function tryDrainQueue() {
    if (busy || drainingQueue) {
      return;
    }
    const queue = getActiveQueue();
    if (!queue.length) {
      return;
    }
    drainingQueue = true;
    try {
      const item = queue.shift();
      if (activeChatId) {
        messageQueues.set(activeChatId, queue);
      }
      renderMessageQueue();
      if (item) {
        dispatchQueuedSend(item);
      }
    } finally {
      drainingQueue = false;
    }
  }

  function updateSendButton() {
    if (!sendBtn) {
      return;
    }
    sendBtn.classList.remove("is-stop", "is-queue");
    if (!busy) {
      sendBtn.dataset.mode = "send";
      sendBtn.title = t("send");
      sendBtn.setAttribute("aria-label", t("send"));
      return;
    }
    if (composerHasContent()) {
      sendBtn.dataset.mode = "queue";
      sendBtn.classList.add("is-queue");
      sendBtn.title = t("queue");
      sendBtn.setAttribute("aria-label", t("queue"));
      return;
    }
    sendBtn.dataset.mode = "stop";
    sendBtn.classList.add("is-stop");
    sendBtn.title = t("stop");
    sendBtn.setAttribute("aria-label", t("stop"));
  }

  function selectionChipId() {
    return `sel_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function formatSelectionLabel(sel) {
    const path = sel.path || "file";
    const start = Number(sel.startLine) || 0;
    const end = Number(sel.endLine) || start;
    if (!start) {
      return path;
    }
    return start === end ? `${path}:${start}` : `${path}:${start}–${end}`;
  }

  function selectionFileType(sel) {
    const path = String(sel.path || "");
    const fileName = path.split(/[\\/]/).pop() || "";
    const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
    const languageAliases = {
      typescript: "ts",
      typescriptreact: "tsx",
      javascript: "js",
      javascriptreact: "jsx",
      shellscript: "sh",
      plaintext: "txt",
      markdown: "md",
      python: "py",
      rust: "rs",
      csharp: "cs",
    };
    const language = String(sel.language || "").toLowerCase();
    const extension =
      (match && match[1]) || languageAliases[language] || language || "code";
    const normalized = extension.replace(/[^a-z0-9]/g, "").slice(0, 8) || "code";
    const labels = {
      javascript: "JS",
      javascriptreact: "JSX",
      typescript: "TS",
      typescriptreact: "TSX",
      markdown: "MD",
      plaintext: "TXT",
      shellscript: "SH",
      yaml: "YML",
    };
    return {
      className: normalized,
      label: (labels[normalized] || normalized).slice(0, 4).toUpperCase(),
    };
  }

  function selectionToFence(sel) {
    const start = Number(sel.startLine) || 1;
    const end = Number(sel.endLine) || start;
    const path = sel.path || "file";
    const body = String(sel.text || "").replace(/\n$/, "");
    return `\`\`\`${start}:${end}:${path}\n${body}\n\`\`\``;
  }

  function mentionChipId() {
    return `mn_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function addPendingMention(pathRaw) {
    const parsed = parseMentionTarget(String(pathRaw || "").replace(/^@+/, ""));
    const path = String(parsed.path || "").trim();
    if (!path) {
      return false;
    }
    const startLine = Number(parsed.startLine) || 0;
    const endLine = Number(parsed.endLine) || startLine;
    const dup = pendingMentions.find(
      (m) =>
        m.path === path && m.startLine === startLine && m.endLine === endLine
    );
    if (dup) {
      return false;
    }
    if (pendingMentions.length >= MAX_PENDING_MENTIONS) {
      showCopyToast(t("tooManySelections"));
      return false;
    }
    pendingMentions.push({
      id: mentionChipId(),
      path,
      startLine,
      endLine,
    });
    renderAttachPreview();
    updateSendButton();
    return true;
  }

  function removePendingMention(id) {
    pendingMentions = pendingMentions.filter((m) => m.id !== id);
    renderAttachPreview();
    updateSendButton();
  }

  function clearPendingMentions() {
    pendingMentions = [];
    renderAttachPreview();
  }

  function mentionToken(meta) {
    const suffix =
      meta.startLine > 0
        ? meta.startLine === meta.endLine
          ? `:${meta.startLine}`
          : `:${meta.startLine}-${meta.endLine}`
        : "";
    return `@${meta.path}${suffix}`;
  }

  function buildMessageWithMentions(userText) {
    const chips = pendingMentions.map(mentionToken);
    const text = String(userText || "").trim();
    if (!chips.length) {
      return text;
    }
    if (!text) {
      return chips.join(" ");
    }
    return `${chips.join(" ")} ${text}`;
  }

  function renderComposerMentionChip(meta) {
    const path = String(meta.path || "file");
    const fileType = selectionFileType({ path });
    const name = pathBasename(path);
    const line =
      meta.startLine > 0
        ? meta.startLine === meta.endLine
          ? `· ${meta.startLine}`
          : `· ${meta.startLine}–${meta.endLine}`
        : "";
    const remove =
      `<button type="button" class="attach-chip-remove mention-chip-remove" data-id="${escapeHtml(
        meta.id
      )}" title="${t("remove")}" aria-label="${t("remove")}">` +
      `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
      `</button>`;
    return (
      `<div class="msg-file-chip composer-mention-chip" data-id="${escapeHtml(
        meta.id
      )}" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">` +
      `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(
        fileType.label
      )}</span>` +
      `<span class="msg-file-chip-name">${escapeHtml(name)}</span>` +
      (line ? `<span class="msg-file-chip-line">${escapeHtml(line)}</span>` : "") +
      remove +
      `</div>`
    );
  }

  function tryCommitComposerMention(textarea) {
    if (textarea !== promptEl) {
      return false;
    }
    const mention = findMentionAtCursor(textarea);
    if (!mention || !mention.query) {
      return false;
    }
    const parsed = parseMentionTarget(mention.query);
    if (!isFilePath(parsed.path)) {
      return false;
    }
    if (!addPendingMention(mention.query)) {
      return false;
    }
    const value = textarea.value;
    const next = value.slice(0, mention.start) + value.slice(mention.end);
    textarea.value = next;
    textarea.setSelectionRange(mention.start, mention.start);
    autoResizePrompt();
    persistDraftPrompt();
    closeMentionMenu();
    return true;
  }

  function pullMentionsFromPrompt() {
    if (!(promptEl instanceof HTMLTextAreaElement)) {
      return;
    }
    const re = /@([^\s@]+)/g;
    let value = promptEl.value || "";
    const hits = [];
    let match;
    while ((match = re.exec(value))) {
      const path = match[1];
      if (path.includes("://") || path.includes(":")) {
        continue;
      }
      if (!isFilePath(path) && !path.includes("/")) {
        continue;
      }
      hits.push({
        start: match.index,
        end: match.index + match[0].length,
        path,
      });
    }
    if (!hits.length) {
      return;
    }
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const hit = hits[i];
      if (!addPendingMention(hit.path)) {
        continue;
      }
      value = `${value.slice(0, hit.start)}${value.slice(hit.end)}`;
    }
    promptEl.value = value.replace(/[ \t]{2,}/g, " ").replace(/^ +| +$/gm, "");
    autoResizePrompt();
    persistDraftPrompt();
  }

  function addPendingSelection(sel) {
    if (!sel || !String(sel.text || "").trim()) {
      return;
    }
    if (pendingSelections.length >= MAX_PENDING_SELECTIONS) {
      showCopyToast(t("tooManySelections"));
      return;
    }
    const path = String(sel.path || "").trim() || "file";
    const startLine = Number(sel.startLine) || 1;
    const endLine = Number(sel.endLine) || startLine;
    const text = String(sel.text || "").replace(/\n$/, "");
    const dup = pendingSelections.find(
      (s) =>
        s.path === path &&
        s.startLine === startLine &&
        s.endLine === endLine &&
        s.text === text
    );
    if (dup) {
      showScreen("chat");
      focusPrompt();
      return;
    }
    pendingSelections.push({
      id: selectionChipId(),
      path,
      startLine,
      endLine,
      text,
      language: sel.language || "",
    });
    renderSelectionPreview();
    showScreen("chat");
    focusPrompt();
  }

  function removePendingSelection(id) {
    pendingSelections = pendingSelections.filter((s) => s.id !== id);
    renderSelectionPreview();
  }

  function clearPendingSelections() {
    pendingSelections = [];
    renderSelectionPreview();
  }

  function renderSelectionPreview() {
    if (!selectionPreviewEl) {
      return;
    }
    if (!pendingSelections.length) {
      selectionPreviewEl.hidden = true;
      selectionPreviewEl.innerHTML = "";
      updateSendButton();
      forceHarborUiRepaint();
      return;
    }
    selectionPreviewEl.hidden = false;
    selectionPreviewEl.innerHTML = pendingSelections
      .map((sel) => {
        const label = escapeHtml(formatSelectionLabel(sel));
        const fileType = selectionFileType(sel);
        const lines =
          sel.startLine === sel.endLine
            ? `line ${sel.startLine}`
            : `lines ${sel.startLine}–${sel.endLine}`;
        return (
          `<div class="selection-chip" data-id="${escapeHtml(sel.id)}" title="${label}">` +
          `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(fileType.label)}</span>` +
          `<span class="selection-chip-body">` +
          `<span class="selection-chip-path">${escapeHtml(sel.path || "file")}</span>` +
          `<span class="selection-chip-lines">${escapeHtml(lines)}</span>` +
          `</span>` +
          `<button type="button" class="selection-chip-remove" data-id="${escapeHtml(
            sel.id
          )}" title="${t("remove")}" aria-label="${t("remove")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
          `</button></div>`
        );
      })
      .join("");
    updateSendButton();
    forceHarborUiRepaint();
    setTimeout(forceHarborUiRepaint, 32);
    setTimeout(forceHarborUiRepaint, 120);
  }

  function buildMessageWithSelections(userText) {
    const fences = pendingSelections.map(selectionToFence);
    const text = String(userText || "").trim();
    if (!fences.length) {
      return text;
    }
    if (!text) {
      return fences.join("\n\n");
    }
    return `${fences.join("\n\n")}\n\n${text}`;
  }

  function harborHostAvailable() {

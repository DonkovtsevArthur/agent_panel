  installHarborClickPolyfill();

  function attachmentLooksLikeImage(att) {
    const mime = String(att?.mime || "").toLowerCase();
    if (mime.startsWith("image/") && mime !== "image/svg+xml") {
      return true;
    }
    if (att?.kind === "image") {
      return true;
    }
    return /\.(png|jpe?g|gif|webp|bmp)$/i.test(
      String(att?.name || att?.path || "")
    );
  }

  function attachmentPreviewSrc(att) {
    if (att?.previewDataUrl) {
      return String(att.previewDataUrl);
    }
    if (att?.dataBase64) {
      return `data:${att.mime || "image/png"};base64,${att.dataBase64}`;
    }
    return "";
  }

  function renderFileTypeChip(att, extraClass, extraHtml) {
    const full = String(att.path || att.name || "file");
    const label = displayAttachmentName(att);
    const fileType = selectionFileType({ path: full });
    return (
      `<div class="msg-file-chip ${extraClass || ""}" data-id="${escapeHtml(
        att.id || ""
      )}" title="${escapeHtml(full)}">` +
      `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(
        fileType.label
      )}</span>` +
      `<span class="msg-file-chip-name">${escapeHtml(label)}</span>` +
      (extraHtml || "") +
      `</div>`
    );
  }

  function renderAttachPreview() {
    if (!attachPreviewEl) {
      return;
    }
    const mentionHtml = pendingMentions.map(renderComposerMentionChip).join("");
    if (!pendingAttachments.length && !mentionHtml) {
      attachPreviewEl.hidden = true;
      attachPreviewEl.innerHTML = "";
      updateSendButton();
      forceHarborUiRepaint();
      return;
    }
    attachPreviewEl.hidden = false;
    attachPreviewEl.innerHTML =
      mentionHtml +
      pendingAttachments
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
            `<div class="attach-chip attach-chip-image" data-id="${escapeHtml(att.id)}" title="${title}">` +
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
    attachPreviewEl.querySelectorAll("img.attach-thumb").forEach((img) => {
      if (img.complete) {
        return;
      }
      img.addEventListener(
        "load",
        () => {
          forceHarborUiRepaint();
        },
        { once: true }
      );
    });
    updateSendButton();
    forceHarborUiRepaint();
    setTimeout(forceHarborUiRepaint, 32);
    setTimeout(forceHarborUiRepaint, 120);
  }

  function closeMentionMenu() {
    mentionOpen = false;
    mentionItems = [];
    mentionActiveIndex = 0;
    mentionQuery = "";
    mentionStart = -1;
    mentionTarget = null;
    if (mentionSearchTimer) {
      clearTimeout(mentionSearchTimer);
      mentionSearchTimer = null;
    }
    if (mentionMenuEl) {
      mentionMenuEl.hidden = true;
      mentionMenuEl.innerHTML = "";
    }
  }

  function closeSlashMenu() {
    slashOpen = false;
    slashItems = [];
    slashActiveIndex = 0;
    slashQuery = "";
    slashStart = -1;
    if (!mentionOpen && mentionMenuEl) {
      mentionMenuEl.hidden = true;
      mentionMenuEl.innerHTML = "";
    }
  }

  function renderSlashMenu() {
    if (!mentionMenuEl) {
      return;
    }
    if (!slashOpen) {
      if (!mentionOpen) {
        mentionMenuEl.hidden = true;
        mentionMenuEl.innerHTML = "";
      }
      return;
    }
    if (!slashItems.length) {
      mentionMenuEl.hidden = false;
      mentionMenuEl.innerHTML =
        `<div class="mention-empty">${
          UI_LANG === "ru" ? "Нет команд" : "No commands"
        }</div>`;
      return;
    }
    mentionMenuEl.hidden = false;
    mentionMenuEl.innerHTML = slashItems
      .map((item, index) => {
        const active = index === slashActiveIndex ? " is-active" : "";
        return (
          `<button type="button" class="mention-option${active}" role="option" data-slash-index="${index}" data-command="${escapeHtml(
            item.id
          )}" aria-selected="${index === slashActiveIndex ? "true" : "false"}">` +
          `<span class="mention-option-text">` +
          `<span class="mention-option-name">${escapeHtml(item.label)}</span>` +
          `<span class="mention-option-path">${escapeHtml(
            item.description || ""
          )}</span>` +
          `</span></button>`
        );
      })
      .join("");
    const activeEl = mentionMenuEl.querySelector(".mention-option.is-active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  function renderMentionMenu() {
    if (!mentionMenuEl) {
      return;
    }
    if (!mentionOpen) {
      mentionMenuEl.hidden = true;
      mentionMenuEl.innerHTML = "";
      return;
    }
    if (!mentionItems.length) {
      mentionMenuEl.hidden = false;
      mentionMenuEl.innerHTML =
        `<div class="mention-empty">No files</div>`;
      return;
    }
    mentionMenuEl.hidden = false;
    mentionMenuEl.innerHTML = mentionItems
      .map((item, index) => {
        const active = index === mentionActiveIndex ? " is-active" : "";
        if (item.special) {
          const hint = escapeHtml(item.hint || "");
          return (
            `<button type="button" class="mention-option${active}" role="option" data-index="${index}" data-special="${escapeHtml(item.special)}" aria-selected="${
              index === mentionActiveIndex ? "true" : "false"
            }">` +
            `<span class="material-symbols-outlined mention-option-icon" aria-hidden="true">${item.icon || "draft"}</span>` +
            `<span class="mention-option-text">` +
            `<span class="mention-option-name">${escapeHtml(item.name)}</span>` +
            `<span class="mention-option-path">${hint}</span>` +
            `</span></button>`
          );
        }
        const name = escapeHtml(item.name || pathBasename(item.path));
        const filePath = escapeHtml(item.path || "");
        return (
          `<button type="button" class="mention-option${active}" role="option" data-index="${index}" data-path="${filePath}" aria-selected="${
            index === mentionActiveIndex ? "true" : "false"
          }">` +
          `<span class="material-symbols-outlined mention-option-icon" aria-hidden="true">draft</span>` +
          `<span class="mention-option-text">` +
          `<span class="mention-option-name">${name}</span>` +
          `<span class="mention-option-path">${filePath}</span>` +
          `</span></button>`
        );
      })
      .join("");
    const activeEl = mentionMenuEl.querySelector(".mention-option.is-active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  function pathBasename(filePath) {
    const parts = String(filePath || "").split("/");
    return parts[parts.length - 1] || filePath || "file";
  }

  function findMentionAtCursor(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return null;
    }
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/(^|[\s\n])@([^\s@]*)$/);
    if (!match) {
      return null;
    }
    const query = match[2] || "";
    // Не рассматриваем @https://... / @...:... как упоминание файла.
    // Иначе появляется mention-панель с файлами (searchFiles по "https://...").
    if (query.includes("://") || query.includes(":")) {
      return null;
    }
    const atIndex = before.length - match[2].length - 1;
    return {
      start: atIndex,
      query,
      end: cursor,
    };
  }

  function findSlashAtCursor(textarea) {
    if (textarea !== promptEl) {
      return null;
    }
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/^\s*\/([^\s]*)$/);
    if (!match) {
      return null;
    }
    const query = match[1] || "";
    const slashIndex = before.lastIndexOf("/");
    if (slashIndex < 0) {
      return null;
    }
    return {
      start: slashIndex,
      query,
      end: cursor,
    };
  }

  function openSlashMenu(start, query) {
    closeMentionMenu();
    slashOpen = true;
    slashStart = start;
    slashQuery = String(query || "").toLowerCase();
    slashItems = getSlashCommands().filter((item) =>
      !slashQuery
        ? true
        : item.id.toLowerCase().includes(slashQuery) ||
          item.label.toLowerCase().includes(slashQuery)
    );
    slashActiveIndex = 0;
    closePlusMenu();
    closeMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    renderSlashMenu();
  }

  function applySlashSelection(index) {
    const item = slashItems[index];
    if (!item || !(promptEl instanceof HTMLTextAreaElement) || slashStart < 0) {
      closeSlashMenu();
      return;
    }
    if (item.kind === "mode") {
      const nextMode = item.id === "compose" ? "agent" : item.id;
      setAgentMode(nextMode, { focus: true, close: true });
      promptEl.value = "";
      promptEl.dispatchEvent(new Event("input", { bubbles: true }));
      closeSlashMenu();
      showCopyToast(
        t("slashModeSwitched", modeLabel ? modeLabel.textContent : item.label)
      );
      return;
    }
    const value = promptEl.value;
    const cursor =
      typeof promptEl.selectionStart === "number"
        ? promptEl.selectionStart
        : value.length;
    const insert = `/${item.id} `;
    const next = value.slice(0, slashStart) + insert + value.slice(cursor);
    const caret = slashStart + insert.length;
    promptEl.value = next;
    promptEl.focus();
    promptEl.setSelectionRange(caret, caret);
    autoResizePrompt();
    closeSlashMenu();
  }

  function requestMentionSearch(query) {
    mentionRequestId += 1;
    const requestId = String(mentionRequestId);
    host.postMessage({
      type: "searchFiles",
      query: String(query || ""),
      requestId,
    });
  }

  function specialMentionItems(query) {
    const q = String(query || "").toLowerCase();
    const specials = [
      {
        special: "problems",
        name: "@problems",
        hint: UI_LANG === "ru"
          ? "Все ошибки и предупреждения workspace"
          : "All workspace errors and warnings",
        icon: "error",
      },
      {
        special: "terminal",
        name: "@terminal",
        hint: UI_LANG === "ru"
          ? "Последний вывод терминала / Run"
          : "Last terminal / Run output",
        icon: "terminal",
      },
      {
        special: "url",
        name: "@url",
        hint: UI_LANG === "ru"
          ? "Вставить страницу: @url https://…"
          : "Fetch a page: @url https://…",
        icon: "language",
      },
    ];
    return specials.filter(
      (item) =>
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.special.includes(q)
    );
  }

  function openMentionMenu(textarea, start, query) {
    mentionOpen = true;
    mentionTarget = textarea;
    mentionStart = start;
    mentionQuery = query;
    mentionItems = [];
    mentionActiveIndex = 0;
    closePlusMenu();
    closeMenu();
    closeEditModelMenu();
    if (mentionMenuEl) {
      mentionMenuEl.hidden = false;
      mentionMenuEl.innerHTML =
        `<div class="mention-empty">Searching...</div>`;
    }
    const specials = specialMentionItems(query);
    if (specials.length) {
      mentionItems = specials;
      renderMentionMenu();
    }
    if (mentionSearchTimer) {
      clearTimeout(mentionSearchTimer);
    }
    mentionSearchTimer = setTimeout(() => {
      mentionSearchTimer = null;
      requestMentionSearch(query);
    }, 80);
  }

  function applyMentionSelection(index) {
    const item = mentionItems[index];
    const textarea = mentionTarget;
    if (!item || !(textarea instanceof HTMLTextAreaElement) || mentionStart < 0) {
      closeMentionMenu();
      return;
    }
    if (item.special) {
      const value = textarea.value;
      const cursor = textarea.selectionStart;
      const insert = item.special === "url" ? "@url " : `${item.name} `;
      const next = value.slice(0, mentionStart) + insert + value.slice(cursor);
      const caret = mentionStart + insert.length;
      textarea.value = next;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      if (textarea.classList.contains("msg-edit-input")) {
        editingUserText = next;
      }
      autoResizePrompt();
      persistDraftPrompt();
      closeMentionMenu();
      return;
    }
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    if (textarea === promptEl) {
      const next = value.slice(0, mentionStart) + value.slice(cursor);
      textarea.value = next;
      textarea.focus();
      textarea.setSelectionRange(mentionStart, mentionStart);
      addPendingMention(item.path);
      autoResizePrompt();
      persistDraftPrompt();
      closeMentionMenu();
      return;
    }
    const insert = `@${item.path} `;
    const next = value.slice(0, mentionStart) + insert + value.slice(cursor);
    const caret = mentionStart + insert.length;
    textarea.value = next;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    if (textarea.classList.contains("msg-edit-input")) {
      editingUserText = next;
    }
    closeMentionMenu();
  }

  function handleMentionResults(msg) {
    if (!mentionOpen) {
      return;
    }
    if (String(msg.requestId || "") !== String(mentionRequestId)) {
      return;
    }
    mentionItems = [
      ...specialMentionItems(mentionQuery),
      ...(Array.isArray(msg.files) ? msg.files : []),
    ];
    mentionActiveIndex = 0;
    renderMentionMenu();
  }

  function onMentionInput(textarea) {
    const mention = findMentionAtCursor(textarea);
    if (!mention) {
      if (mentionOpen && mentionTarget === textarea) {
        closeMentionMenu();
      }
      return;
    }
    openMentionMenu(textarea, mention.start, mention.query);
  }

  function onSlashInput(textarea) {
    const slash = findSlashAtCursor(textarea);
    if (!slash) {
      if (slashOpen) {
        closeSlashMenu();
      }
      return false;
    }
    openSlashMenu(slash.start, slash.query);
    return true;
  }

  function onSlashKeydown(event, textarea) {
    if (!slashOpen || textarea !== promptEl) {
      return false;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!slashItems.length) {
        return true;
      }
      slashActiveIndex = (slashActiveIndex + 1) % slashItems.length;
      renderSlashMenu();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!slashItems.length) {
        return true;
      }
      slashActiveIndex = (slashActiveIndex - 1 + slashItems.length) % slashItems.length;
      renderSlashMenu();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (!slashItems.length) {
        closeSlashMenu();
        return false;
      }
      event.preventDefault();
      applySlashSelection(slashActiveIndex);
      return true;
    }
    return false;
  }

  function onMentionKeydown(event, textarea) {
    if (!mentionOpen || mentionTarget !== textarea) {
      return false;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeMentionMenu();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!mentionItems.length) {
        return true;
      }
      mentionActiveIndex = (mentionActiveIndex + 1) % mentionItems.length;
      renderMentionMenu();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!mentionItems.length) {
        return true;
      }
      mentionActiveIndex =
        (mentionActiveIndex - 1 + mentionItems.length) % mentionItems.length;
      renderMentionMenu();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (mentionItems.length) {
        event.preventDefault();
        applyMentionSelection(mentionActiveIndex);
        return true;
      }
      closeMentionMenu();
      return false;
    }
    return false;
  }

  function parseMentionTarget(raw) {
    const s = String(raw || "").trim();
    const m = s.match(
      /^(.*?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/
    );
    if (!m) {
      return { path: s, startLine: 0, endLine: 0 };
    }
    const startLine = Number(m[2] || m[4] || 0);
    const endLine = Number(m[3] || m[5] || startLine);
    return { path: m[1] || s, startLine, endLine };
  }

  function renderMentionChip(pathRaw) {
    const parsed = parseMentionTarget(pathRaw);
    const name = pathBasename(parsed.path);
    const fileType = selectionFileType({ path: parsed.path });
    const line =
      parsed.startLine > 0
        ? parsed.startLine === parsed.endLine
          ? `· ${parsed.startLine}`
          : `· ${parsed.startLine}–${parsed.endLine}`
        : "";
    return (
      `<button type="button" class="msg-mention msg-file-chip" data-path="${escapeHtml(
        parsed.path
      )}" title="${escapeHtml(parsed.path)}">` +
      `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(
        fileType.label
      )}</span>` +
      `<span class="msg-file-chip-name">${escapeHtml(name)}</span>` +
      (line
        ? `<span class="msg-file-chip-line">${escapeHtml(line)}</span>`
        : "") +
      `</button>`
    );
  }

  function renderUserTextWithMentions(text) {
    const raw = String(text || "");
    const re = /@([^\s@]+)/g;
    let html = "";
    let last = 0;
    let match;
    while ((match = re.exec(raw))) {
      html += escapeHtml(raw.slice(last, match.index));
      html += renderMentionChip(match[1]);
      last = match.index + match[0].length;
    }
    html += escapeHtml(raw.slice(last));
    return html;
  }

  function displayAttachmentName(att) {
    const kind = String(att?.kind || "");
    const raw = String(att?.name || att?.path || "").trim();
    const base = raw.split(/[/\\]/).pop() || raw;
    const extMatch = base.match(/(\.[a-z0-9]{1,8})$/i);
    const ext = extMatch ? extMatch[1] : "";
    let stem = ext ? base.slice(0, -ext.length) : base;
    stem = stem.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      " "
    );
    stem = stem.replace(/[0-9a-f]{16,}/gi, " ");
    stem = stem.replace(/^[_-\s]+|[_-\s]+$/g, "").replace(/[_-\s]{2,}/g, " ");
    stem = stem.replace(/\s+/g, " ").trim();
    if (!stem) {
      return kind === "image" ? `image${ext || ".png"}` : ext ? `file${ext}` : "file";
    }
    const name = `${stem}${ext}`;
    return name.length > 42 ? `${stem.slice(0, 28)}…${ext}` : name;
  }

  function renderMessageAttachments(attachments) {
    if (!Array.isArray(attachments) || !attachments.length) {
      return "";
    }
    return (
      `<div class="msg-attachments">` +
      attachments
        .map((att) => {
          const full = String(att.path || att.name || "file");
          const title = escapeHtml(full);
          const src = attachmentPreviewSrc(att);
          if (attachmentLooksLikeImage(att) && src) {
            return (
              `<button type="button" class="msg-attach msg-attach-image" data-preview-src="${escapeHtml(
                src
              )}" title="${title}" aria-label="${t("zoomImage")}">` +
              `<img src="${src}" alt="" />` +
              `<span class="msg-attach-image-badge" aria-hidden="true">` +
              `<span class="material-symbols-outlined">zoom_in</span>` +
              `</span>` +
              `</button>`
            );
          }
          return renderFileTypeChip(att, "msg-attach");
        })
        .join("") +
      `</div>`
    );
  }

  let imgLightboxEl = null;

  function ensureImgLightbox() {
    if (imgLightboxEl) {
      return imgLightboxEl;
    }
    imgLightboxEl = document.createElement("div");
    imgLightboxEl.className = "img-lightbox";
    imgLightboxEl.hidden = true;
    imgLightboxEl.innerHTML =
      `<button type="button" class="img-lightbox-close" title="${t("close")}" aria-label="${t("close")}">` +
      `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
      `</button>` +
      `<img class="img-lightbox-img" alt="" />`;
    imgLightboxEl.addEventListener("click", (event) => {
      if (event.target.closest(".img-lightbox-close") || event.target === imgLightboxEl) {
        closeImgLightbox();
      }
    });
    document.body.appendChild(imgLightboxEl);
    return imgLightboxEl;
  }

  function openImgLightbox(src) {
    const url = String(src || "").trim();
    if (!url) {
      return;
    }
    const box = ensureImgLightbox();
    const img = box.querySelector(".img-lightbox-img");
    if (img) {
      img.src = url;
    }
    box.hidden = false;
  }

  function closeImgLightbox() {
    if (!imgLightboxEl) {
      return;
    }
    imgLightboxEl.hidden = true;
    const img = imgLightboxEl.querySelector(".img-lightbox-img");
    if (img) {
      img.removeAttribute("src");
    }
  }

  function readFileAsAttachment(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        const dataBase64 = comma >= 0 ? result.slice(comma + 1) : result;
        const mime = file.type || "application/octet-stream";
        const kind = mime.startsWith("image/") ? "image" : "file";
        resolve({
          id: `local_${Date.now()}_${cryptoToken(7)}`,
          kind,
          name: file.name || (kind === "image" ? "image.png" : "file"),
          mime,
          size: file.size,
          dataBase64,
          previewDataUrl: kind === "image" ? result : undefined,
        });
      };
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  function fsPathToFileUri(fsPath) {
    const raw = String(fsPath || "").trim();
    if (!raw) {
      return "";
    }
    if (/^[a-zA-Z]:[\\/]/.test(raw)) {
      return `file:///${raw.replace(/\\/g, "/")}`;
    }
    if (raw.startsWith("\\\\")) {
      return `file://${raw.replace(/\\/g, "/")}`;
    }
    if (raw.startsWith("/")) {
      return `file://${raw}`;
    }
    return "";
  }

  function parseUriCandidates(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      return [];
    }
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith("#")) {
        continue;
      }
      if (/^(file|vscode-remote|vscode-vfs):/i.test(value)) {
        out.push(value);
        continue;
      }
      const asFile = fsPathToFileUri(value);
      if (asFile) {
        out.push(asFile);
      }
    }
    return out;
  }

  function extractDropUris(dataTransfer) {
    if (!dataTransfer) {
      return [];
    }
    const found = [];
    const seen = new Set();
    const add = (uri) => {
      const value = String(uri || "").trim();
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      found.push(value);
    };

    const types = Array.from(dataTransfer.types || []);
    for (const type of [
      "text/uri-list",
      "text/plain",
      "application/vnd.code.uri-list",
      "resourceurls",
    ]) {
      if (!types.includes(type)) {
        continue;
      }
      let raw = "";
      try {
        raw = dataTransfer.getData(type);
      } catch {
        raw = "";
      }
      if (!raw && type === "resourceurls") {
        try {
          raw = dataTransfer.getData("ResourceURLs");
        } catch {
          raw = "";
        }
      }
      if (raw) {
        // resourceurls иногда JSON-массив
        if (raw.trim().startsWith("[")) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                add(String(item));
              }
              continue;
            }
          } catch {
            // fall through
          }
        }
        for (const uri of parseUriCandidates(raw)) {
          add(uri);
        }
      }
    }

    const files = dataTransfer.files ? Array.from(dataTransfer.files) : [];
    for (const file of files) {
      // Electron File.path — абсолютный путь
      if (file && file.path) {
        add(fsPathToFileUri(file.path));
      }
    }

    return found;
  }

  function isFileDrag(dataTransfer) {
    if (!dataTransfer) {
      return false;
    }
    const types = Array.from(dataTransfer.types || []);
    return (
      types.includes("Files") ||
      types.includes("text/uri-list") ||
      types.includes("application/vnd.code.uri-list") ||
      types.includes("resourceurls") ||
      (dataTransfer.files && dataTransfer.files.length > 0)
    );
  }

  async function ingestDroppedFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }
    const withPath = [];
    const withoutPath = [];
    for (const file of files) {
      if (pendingAttachments.length + withPath.length + withoutPath.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      if (file && file.path) {
        const uri = fsPathToFileUri(file.path);
        if (uri) {
          withPath.push(uri);
          continue;
        }
      }
      withoutPath.push(file);
    }
    if (withPath.length) {
      host.postMessage({ type: "attachUris", uris: withPath });
    }
    if (!withoutPath.length) {
      return;
    }
    const parsed = [];
    for (const file of withoutPath) {
      if (pendingAttachments.length + parsed.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      try {
        parsed.push(await readFileAsAttachment(file));
      } catch {
        // skip unreadable
      }
    }
    if (parsed.length) {
      host.postMessage({
        type: "attachFiles",
        files: parsed.map(attachmentPayload),
      });
    }
  }


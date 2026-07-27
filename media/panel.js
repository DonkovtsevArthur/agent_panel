(function () {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || { selectedModel: null };

  const messagesEl = document.getElementById("messages");
  const promptEl = document.getElementById("prompt");
  const sendBtn = document.getElementById("sendBtn");
  const composerPlusEl = document.getElementById("composerPlus");
  const composerPlusBtn = document.getElementById("composerPlusBtn");
  const composerPlusMenu = document.getElementById("composerPlusMenu");
  const modePicker = document.getElementById("modePicker");
  const modeTrigger = document.getElementById("modeTrigger");
  const modeLabel = document.getElementById("modeLabel");
  const modeMenu = document.getElementById("modeMenu");
  const attachPreviewEl = document.getElementById("attachPreview");
  const mentionMenuEl = document.getElementById("mentionMenu");
  const composerEl = document.getElementById("composer");
  const composerWrapEl = document.getElementById("composerWrap");
  const composerDropHintEl = document.getElementById("composerDropHint");
  const modelPicker = document.getElementById("modelPicker");
  const modelTrigger = document.getElementById("modelTrigger");
  const modelLabel = document.getElementById("modelLabel");
  const modelMenu = document.getElementById("modelMenu");

  let agentStatusEl = null;
  let agentStatusState = { text: "", hidden: true, phase: "" };
  const agentsScreen = document.getElementById("agentsScreen");
  const archiveScreen = document.getElementById("archiveScreen");
  const settingsScreen = document.getElementById("settingsScreen");
  const chatScreen = document.getElementById("chatScreen");
  const agentsListEl = document.getElementById("agentsList");
  const archiveListEl = document.getElementById("archiveList");
  const settingsModelsList = document.getElementById("settingsModelsList");
  const newAgentBtn = document.getElementById("newAgentBtn");
  const openArchiveBtn = document.getElementById("openArchiveBtn");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const backFromArchiveBtn = document.getElementById("backFromArchiveBtn");
  const backFromSettingsBtn = document.getElementById("backFromSettingsBtn");
  const settingsSaveStatus = document.getElementById("settingsSaveStatus");
  const addModelBtn = document.getElementById("addModelBtn");
  const settingsModelsHint = document.getElementById("settingsModelsHint");
  const settingsModelsJson = document.getElementById("settingsModelsJson");
  const importModelsJsonBtn = document.getElementById("importModelsJsonBtn");
  const exportModelsJsonBtn = document.getElementById("exportModelsJsonBtn");
  const settingsJsonHint = document.getElementById("settingsJsonHint");
  const modelEditModal = document.getElementById("modelEditModal");
  const modelEditTitle = document.getElementById("modelEditTitle");
  const modelEditTabs = document.getElementById("modelEditTabs");
  const modelEditManualPane = document.getElementById("modelEditManualPane");
  const modelEditJsonPane = document.getElementById("modelEditJsonPane");
  const modelEditId = document.getElementById("modelEditId");
  const modelEditLabel = document.getElementById("modelEditLabel");
  const modelEditContext = document.getElementById("modelEditContext");
  const modelEditOutput = document.getElementById("modelEditOutput");
  const modelEditVision = document.getElementById("modelEditVision");
  const modelEditProvider = document.getElementById("modelEditProvider");
  const modelEditCloseBtn = document.getElementById("modelEditCloseBtn");
  const modelEditCancelBtn = document.getElementById("modelEditCancelBtn");
  const modelEditDoneBtn = document.getElementById("modelEditDoneBtn");
  const settingsProvidersList = document.getElementById("settingsProvidersList");
  const settingsProvidersHint = document.getElementById("settingsProvidersHint");
  const addProviderBtn = document.getElementById("addProviderBtn");
  const providerEditModal = document.getElementById("providerEditModal");
  const providerEditTitle = document.getElementById("providerEditTitle");
  const providerEditId = document.getElementById("providerEditId");
  const providerEditName = document.getElementById("providerEditName");
  const providerEditBaseUrl = document.getElementById("providerEditBaseUrl");
  const providerEditApiKey = document.getElementById("providerEditApiKey");
  const providerEditCloseBtn = document.getElementById("providerEditCloseBtn");
  const providerEditCancelBtn = document.getElementById("providerEditCancelBtn");
  const providerEditDoneBtn = document.getElementById("providerEditDoneBtn");
  const backToAgentsBtn = document.getElementById("backToAgentsBtn");
  const chatAgentNameEl = document.getElementById("chatAgentName");
  const chatTitleEl = document.getElementById("chatTitle");
  const openChatSearchBtn = document.getElementById("openChatSearchBtn");
  const chatSearchPanel = document.getElementById("chatSearchPanel");
  const chatSearchInput = document.getElementById("chatSearchInput");
  const closeChatSearchBtn = document.getElementById("closeChatSearchBtn");
  const chatSearchResults = document.getElementById("chatSearchResults");
  const contextRingEl = document.getElementById("contextRing");
  const contextRingValueEl = contextRingEl
    ? contextRingEl.querySelector(".context-ring-value")
    : null;
  const contextTipEl = document.getElementById("contextTip");

  const settingsDefaultModel = document.getElementById("settingsDefaultModel");
  const settingsRejectUnauthorized = document.getElementById(
    "settingsRejectUnauthorized"
  );
  const settingsCaBundle = document.getElementById("settingsCaBundle");
  const settingsSystemPrompt = document.getElementById("settingsSystemPrompt");
  const settingsMaxToolRounds = document.getElementById("settingsMaxToolRounds");
  const settingsMaxTokens = document.getElementById("settingsMaxTokens");
  const settingsMaxResponseChars = document.getElementById(
    "settingsMaxResponseChars"
  );
  const settingsModesList = document.getElementById("settingsModesList");
  const addModeBtn = document.getElementById("addModeBtn");
  const modeEditModal = document.getElementById("modeEditModal");
  const modeEditTitle = document.getElementById("modeEditTitle");
  const modeEditLabel = document.getElementById("modeEditLabel");
  const modeEditDescription = document.getElementById("modeEditDescription");
  const modeEditTools = document.getElementById("modeEditTools");
  const modeEditPrompt = document.getElementById("modeEditPrompt");
  const modeEditCloseBtn = document.getElementById("modeEditCloseBtn");
  const modeEditCancelBtn = document.getElementById("modeEditCancelBtn");
  const modeEditDoneBtn = document.getElementById("modeEditDoneBtn");

  let agentsData = [];
  let archiveAgentsData = [];
  let activeAgentId = "";
  let renamingAgentId = null;
  let settingsModels = [];
  let settingsProviders = [];
  let settingsModes = [];
  let settingsDefaultModelId = "";
  let settingsDefaultContextWindow = 128000;
  let modelEditIndex = null;
  let modelEditMode = "manual";
  let providerEditIndex = null;
  let settingsHydrating = false;
  let settingsSaveTimer = null;
  let settingsSaveStatusTimer = null;
  let settingsModelTipEl = null;
  let settingsModelTipRows = null;
  let settingsModelTipIndex = null;
  let settingsModelTipHideTimer = null;
  let contextUsed = 0;
  let contextMax = 128000;

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

  const INFO_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">info</span>';

  const HEART_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">favorite</span>';

  const COPY_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">content_copy</span>';

  const REGENERATE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">refresh</span>';

  const SCM_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">account_tree</span>';

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
    if (typeof model === "string") {
      const found = models.find((m) => m.id === model);
      if (found && typeof found.supportsVision === "boolean") {
        return found.supportsVision;
      }
      return guessModelSupportsVision(model);
    }
    if (typeof model.supportsVision === "boolean") {
      return model.supportsVision;
    }
    return guessModelSupportsVision(model.id);
  }

  function currentModelSupportsVision() {
    return resolveModelSupportsVision(
      models.find((m) => m.id === selectedModelId) || selectedModelId
    );
  }

  let busy = false;
  let canRegenerate = false;
  let uiMessagesCache = [];
  let pendingAttachments = [];
  let mentionOpen = false;
  let mentionItems = [];
  let mentionActiveIndex = 0;
  let mentionRequestId = 0;
  let mentionQuery = "";
  let mentionStart = -1;
  /** @type {HTMLTextAreaElement | null} */
  let mentionTarget = null;
  let mentionSearchTimer = null;
  let editingUserIndex = null;
  let editingUserText = "";
  let editingModelId = "";
  let editingAttachments = [];
  let editModelMenuOpen = false;
  let models = DEFAULT_MODELS.slice();
  let selectedModelId = state.selectedModel || DEFAULT_MODELS[0].id;
  let menuOpen = false;
  let plusMenuOpen = false;
  let modeMenuOpen = false;
  let agentMode = "agent";
  let modeEditIndex = null;
  let modeEditSource = "settings";
  let chatModes = [];
  let streamingEl = null;
  let composerDragDepth = 0;

  const MAX_PENDING_ATTACHMENTS = 8;

  function attachmentPayload(att) {
    return {
      id: att.id,
      kind: att.kind,
      name: att.name,
      mime: att.mime,
      path: att.path,
      storageKey: att.storageKey,
      size: att.size,
      dataBase64: att.dataBase64,
    };
  }

  function mergePendingAttachments(list) {
    if (!Array.isArray(list) || !list.length) {
      return;
    }
    const visionOk = currentModelSupportsVision();
    let skippedImages = 0;
    for (const item of list) {
      if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      const id = item.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (pendingAttachments.some((a) => a.id === id)) {
        continue;
      }
      const kind =
        item.kind ||
        (String(item.mime || "").startsWith("image/") ? "image" : "file");
      if (kind === "image" && !visionOk) {
        skippedImages += 1;
        continue;
      }
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
    if (skippedImages) {
      showCopyToast("Модель не поддерживает изображения");
    }
    renderAttachPreview();
  }

  function removePendingAttachment(id) {
    pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
    renderAttachPreview();
  }

  function clearPendingAttachments() {
    pendingAttachments = [];
    renderAttachPreview();
  }

  function renderAttachPreview() {
    if (!attachPreviewEl) {
      return;
    }
    if (!pendingAttachments.length) {
      attachPreviewEl.hidden = true;
      attachPreviewEl.innerHTML = "";
      return;
    }
    attachPreviewEl.hidden = false;
    attachPreviewEl.innerHTML = pendingAttachments
      .map((att) => {
        const label = escapeHtml(att.path || att.name || "file");
        if (att.kind === "image" && (att.previewDataUrl || att.dataBase64)) {
          const src =
            att.previewDataUrl ||
            `data:${att.mime || "image/png"};base64,${att.dataBase64}`;
          return (
            `<div class="attach-chip attach-chip-image" data-id="${escapeHtml(att.id)}" title="${label}">` +
            `<img class="attach-thumb" src="${src}" alt="" />` +
            `<button type="button" class="attach-chip-remove" data-id="${escapeHtml(
              att.id
            )}" title="Убрать" aria-label="Убрать">` +
            `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
            `</button></div>`
          );
        }
        return (
          `<div class="attach-chip" data-id="${escapeHtml(att.id)}">` +
          `<span class="material-symbols-outlined attach-chip-icon" aria-hidden="true">draft</span>` +
          `<span class="attach-chip-name" title="${label}">${label}</span>` +
          `<button type="button" class="attach-chip-remove" data-id="${escapeHtml(
            att.id
          )}" title="Убрать" aria-label="Убрать">` +
          `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
          `</button></div>`
        );
      })
      .join("");
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
        `<div class="mention-empty">Нет файлов</div>`;
      return;
    }
    mentionMenuEl.hidden = false;
    mentionMenuEl.innerHTML = mentionItems
      .map((item, index) => {
        const active = index === mentionActiveIndex ? " is-active" : "";
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
    const atIndex = before.length - match[2].length - 1;
    return {
      start: atIndex,
      query: match[2],
      end: cursor,
    };
  }

  function requestMentionSearch(query) {
    mentionRequestId += 1;
    const requestId = String(mentionRequestId);
    vscode.postMessage({
      type: "searchFiles",
      query: String(query || ""),
      requestId,
    });
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
        `<div class="mention-empty">Поиск…</div>`;
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
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const insert = `@${item.path} `;
    const next = value.slice(0, mentionStart) + insert + value.slice(cursor);
    const caret = mentionStart + insert.length;
    textarea.value = next;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    if (textarea === promptEl) {
      // keep as is
    } else if (textarea.classList.contains("msg-edit-input")) {
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
    mentionItems = Array.isArray(msg.files) ? msg.files : [];
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

  function renderUserTextWithMentions(text) {
    const raw = String(text || "");
    const re = /@([^\s@]+)/g;
    let html = "";
    let last = 0;
    let match;
    while ((match = re.exec(raw))) {
      html += escapeHtml(raw.slice(last, match.index));
      const filePath = match[1];
      html +=
        `<button type="button" class="msg-mention" data-path="${escapeHtml(
          filePath
        )}" title="${escapeHtml(filePath)}">@${escapeHtml(filePath)}</button>`;
      last = match.index + match[0].length;
    }
    html += escapeHtml(raw.slice(last));
    return html;
  }

  function renderMessageAttachments(attachments) {
    if (!Array.isArray(attachments) || !attachments.length) {
      return "";
    }
    return (
      `<div class="msg-attachments">` +
      attachments
        .map((att) => {
          const label = escapeHtml(att.path || att.name || "file");
          if (att.kind === "image" && att.previewDataUrl) {
            return (
              `<div class="msg-attach msg-attach-image" title="${label}">` +
              `<img src="${att.previewDataUrl}" alt="" />` +
              `</div>`
            );
          }
          return (
            `<div class="msg-attach" title="${label}">` +
            `<span class="material-symbols-outlined" aria-hidden="true">${
              att.kind === "image" ? "image" : "draft"
            }</span>` +
            `<span class="msg-attach-name">${label}</span>` +
            `</div>`
          );
        })
        .join("") +
      `</div>`
    );
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
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
      vscode.postMessage({ type: "attachUris", uris: withPath });
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
      vscode.postMessage({
        type: "attachFiles",
        files: parsed.map(attachmentPayload),
      });
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
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

  function setAgentStatus(text, hidden, phase) {
    const nextHidden = Boolean(hidden || !text);
    agentStatusState = {
      text: nextHidden ? "" : text,
      hidden: nextHidden,
      phase: nextHidden ? "" : phase || "",
    };

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
    el.textContent = agentStatusState.text;
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
      agentStatusState.phase
    );
  }

  function keepStatusAtEnd() {
    if (agentStatusState.hidden) {
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
    closeMenu();
    closeEditModelMenu();
    editingUserIndex = index;
    editingUserText = String(item.text || "");
    editingModelId = selectedModelId || models[0]?.id || "";
    editingAttachments = Array.isArray(item.attachments)
      ? item.attachments.slice()
      : [];
    renderMessages(uiMessagesCache);
  }

  function cancelEditingUserMessage() {
    closeEditModelMenu();
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingAttachments = [];
    renderMessages(uiMessagesCache);
  }

  function submitEditedUserMessage() {
    if (!Number.isInteger(editingUserIndex) || busy) {
      return;
    }
    const nextText = editingUserText.trim();
    const attachments = editingAttachments.slice();
    if (!nextText && !attachments.length) {
      return;
    }
    const model =
      editingModelId || selectedModelId || models[0]?.id || "";
    if (model && model !== selectedModelId) {
      setSelectedModel(model, true);
    }
    closeEditModelMenu();
    setBusy(true);
    vscode.postMessage({
      type: "editUserMessage",
      index: editingUserIndex,
      text: nextText,
      model,
      agentMode,
      attachments: attachments.map(attachmentPayload),
    });
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingAttachments = [];
  }

  function modelDisplayName(id) {
    const model = models.find((m) => m.id === id);
    return model ? model.label || model.id : id || "Нет моделей";
  }

  function renderEditModelMenu(menuEl) {
    if (!menuEl) {
      return;
    }
    menuEl.innerHTML = "";
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = "Нет моделей в настройках";
      menuEl.appendChild(empty);
      return;
    }
    for (const model of models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (model.id === editingModelId ? " is-active" : "");
      btn.setAttribute("role", "option");
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

  function closeEditModelMenu() {
    editModelMenuOpen = false;
    const picker = getEditModelPicker();
    if (!picker) {
      return;
    }
    picker.classList.remove("is-open");
    const trigger = picker.querySelector(".msg-edit-model-trigger");
    const menu = picker.querySelector(".msg-edit-model-menu");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    }
    if (menu) {
      menu.hidden = true;
    }
  }

  function openEditModelMenu() {
    const picker = getEditModelPicker();
    if (!picker || busy) {
      return;
    }
    closeMenu();
    editModelMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-model-trigger");
    const menu = picker.querySelector(".msg-edit-model-menu");
    renderEditModelMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
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
    if (!id || busy) {
      return;
    }
    editingModelId = id;
    const picker = getEditModelPicker();
    const label = picker
      ? picker.querySelector(".msg-edit-model-label")
      : null;
    if (label) {
      label.textContent = modelDisplayName(editingModelId);
    }
    closeEditModelMenu();
  }

  function removeRegenerateButtons() {
    const btns = messagesEl.querySelectorAll(".msg-regenerate");
    btns.forEach((b) => b.remove());
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

    const parent = last.parentElement;
    if (parent && parent.classList.contains("msg-wrap-assistant")) {
      let actions = parent.querySelector(".msg-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "msg-actions";
        parent.insertBefore(actions, last);
      }
      actions.innerHTML =
        `<button type="button" class="icon-btn msg-regenerate" title="Перегенерировать последний ответ" aria-label="Перегенерировать последний ответ">` +
        REGENERATE_ICON +
        `</button>`;
      return;
    }

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML =
      `<button type="button" class="icon-btn msg-regenerate" title="Перегенерировать последний ответ" aria-label="Перегенерировать последний ответ">` +
      REGENERATE_ICON +
      `</button>`;

    const wrap = document.createElement("div");
    wrap.className = "msg-wrap msg-wrap-assistant";
    (parent || messagesEl).insertBefore(wrap, last);
    wrap.appendChild(actions);
    wrap.appendChild(last);
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
    contextRingEl.setAttribute("aria-label", `Контекст: ${tip}`);
    contextRingEl.hidden = false;
  }

  function formatToolLine(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^([a-zA-Z0-9_]+)\(([\s\S]*)\)$/);
    if (!match) {
      return raw;
    }

    const name = match[1];
    let args = {};
    try {
      args = match[2] ? JSON.parse(match[2]) : {};
    } catch {
      return `${name}`;
    }

    switch (name) {
      case "run_command":
        return args.command ? `run · ${args.command}` : "run_command";
      case "read_file":
        return args.relativePath
          ? `read · ${args.relativePath}`
          : "read_file";
      case "write_file":
        return args.relativePath
          ? `write · ${args.relativePath}`
          : "write_file";
      case "list_files": {
        const path = args.relativePath || ".";
        return `list · ${path}`;
      }
      default: {
        const values = Object.values(args)
          .filter((v) => typeof v === "string" || typeof v === "number")
          .slice(0, 2);
        return values.length ? `${name} · ${values.join(" · ")}` : name;
      }
    }
  }

  function toolStepsLabel(count) {
    if (count === 1) {
      return "1 шаг";
    }
    if (count > 1 && count < 5) {
      return `${count} шага`;
    }
    return `${count} шагов`;
  }

  function sealToolGroups() {
    for (const group of messagesEl.querySelectorAll(
      ".tool-group:not([data-sealed])"
    )) {
      group.dataset.sealed = "1";
    }
  }

  function updateToolGroupSummary(group) {
    if (!group) {
      return;
    }
    const count = group.querySelectorAll(".msg.tool").length;
    const summary = group.querySelector(".tool-group-summary");
    if (summary) {
      summary.textContent = toolStepsLabel(count);
    }
    group.title = group.classList.contains("is-collapsed")
      ? "Показать шаги"
      : "Скрыть шаги";
  }

  function createToolGroup() {
    const group = document.createElement("div");
    group.className = "tool-group is-collapsed";
    group.innerHTML =
      `<button type="button" class="tool-group-toggle" aria-expanded="false">` +
      `<span class="material-symbols-outlined tool-group-chevron" aria-hidden="true">expand_more</span>` +
      `<span class="tool-group-summary">0 шагов</span>` +
      `</button>` +
      `<div class="tool-group-body"></div>`;
    return group;
  }

  function getActiveToolGroup() {
    let node = messagesEl.lastElementChild;
    while (
      node &&
      (node.id === "agentStatus" ||
        node.classList.contains("agent-status") ||
        node.classList.contains("review-actions"))
    ) {
      node = node.previousElementSibling;
    }
    if (
      node &&
      node.classList.contains("tool-group") &&
      !node.dataset.sealed
    ) {
      return node;
    }
    return null;
  }

  function ensureActiveToolGroup() {
    const existing = getActiveToolGroup();
    if (existing) {
      return existing;
    }
    const group = createToolGroup();
    messagesEl.appendChild(group);
    keepStatusAtEnd();
    return group;
  }

  function appendToolToGroup(text, index) {
    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    const el = document.createElement("div");
    el.className = "msg tool";
    if (typeof index === "number") {
      el.dataset.index = String(index);
    }
    const msgBody = document.createElement("div");
    msgBody.className = "msg-body";
    el.appendChild(msgBody);
    setMessageContent(el, "tool", text);
    body.appendChild(el);
    updateToolGroupSummary(group);
    keepStatusAtEnd();
    scrollToBottom();
    return el;
  }

  function showScreen(name) {
    const screen =
      name === "chat" || name === "archive" || name === "settings"
        ? name
        : "agents";
    if (agentsScreen) {
      agentsScreen.hidden = screen !== "agents";
    }
    if (archiveScreen) {
      archiveScreen.hidden = screen !== "archive";
    }
    if (settingsScreen) {
      settingsScreen.hidden = screen !== "settings";
    }
    if (chatScreen) {
      chatScreen.hidden = screen !== "chat";
    }
    if (screen === "chat") {
      setContextUsage(contextUsed, contextMax);
      if (!chatSearchOpen) {
        focusPrompt();
      }
    }
    if (screen !== "chat" && chatSearchOpen) {
      closeChatSearch();
    }
  }

  function highlightQueryInText(text, query) {
    const raw = String(text || "");
    const q = String(query || "").trim();
    if (!q) {
      return escapeHtml(raw);
    }
    const lower = raw.toLowerCase();
    const qLower = q.toLowerCase();
    let out = "";
    let cursor = 0;
    let idx = lower.indexOf(qLower, cursor);
    while (idx !== -1) {
      out += escapeHtml(raw.slice(cursor, idx));
      out +=
        `<mark class="chat-search-mark">` +
        escapeHtml(raw.slice(idx, idx + q.length)) +
        `</mark>`;
      cursor = idx + q.length;
      idx = lower.indexOf(qLower, cursor);
    }
    out += escapeHtml(raw.slice(cursor));
    return out;
  }

  function getMsgRole(el) {
    if (!el) {
      return "assistant";
    }
    if (el.classList.contains("user")) {
      return "user";
    }
    if (el.classList.contains("error")) {
      return "error";
    }
    if (el.classList.contains("system")) {
      return "system";
    }
    if (el.classList.contains("tool")) {
      return "tool";
    }
    return "assistant";
  }

  function wrapMatchesInTextNode(textNode, query) {
    const text = textNode.nodeValue;
    if (!text || !textNode.parentNode) {
      return false;
    }
    const qLower = query.toLowerCase();
    const lower = text.toLowerCase();
    let idx = lower.indexOf(qLower);
    if (idx === -1) {
      return false;
    }
    const frag = document.createDocumentFragment();
    let cursor = 0;
    const qLen = qLower.length;
    while (idx !== -1) {
      if (idx > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
      }
      const mark = document.createElement("mark");
      mark.className = "chat-search-mark";
      mark.textContent = text.slice(idx, idx + qLen);
      frag.appendChild(mark);
      cursor = idx + qLen;
      idx = lower.indexOf(qLower, cursor);
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
    return true;
  }

  function highlightTextInElement(root, query) {
    if (!root || !query) {
      return false;
    }
    const qLower = query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) {
      const parent = current.parentElement;
      if (!parent) {
        continue;
      }
      if (parent.closest("textarea, input, .msg-edit-composer, .msg-actions")) {
        continue;
      }
      if (parent.closest("mark.chat-search-mark")) {
        continue;
      }
      if (!current.nodeValue || !current.nodeValue.toLowerCase().includes(qLower)) {
        continue;
      }
      nodes.push(current);
    }
    let found = false;
    for (const node of nodes) {
      if (wrapMatchesInTextNode(node, query)) {
        found = true;
      }
    }
    return found;
  }

  function focusChatSearchMatch(index, scrollIntoView) {
    if (!messagesEl || !chatSearchMatchEls.length) {
      chatSearchMatchIndex = -1;
      return;
    }
    messagesEl.querySelectorAll(".msg.is-search-current").forEach((el) => {
      el.classList.remove("is-search-current");
    });
    const len = chatSearchMatchEls.length;
    chatSearchMatchIndex = ((index % len) + len) % len;
    const el = chatSearchMatchEls[chatSearchMatchIndex];
    if (!el) {
      return;
    }
    el.classList.add("is-search-current");
    if (scrollIntoView !== false) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function applyInChatSearchHighlights(query) {
    if (!messagesEl) {
      return;
    }
    const q = String(query || "").trim();
    const msgs = messagesEl.querySelectorAll(
      ".msg.user, .msg.assistant, .msg.error"
    );
    chatSearchMatchEls = [];
    chatSearchMatchIndex = -1;

    msgs.forEach((el) => {
      el.classList.remove(
        "has-search-match",
        "is-search-current",
        "is-search-hit"
      );
      const existingBody = el.querySelector(".msg-body");
      if (existingBody) {
        existingBody.classList.remove("has-search-match-fallback");
      }
      if (el.classList.contains("is-editing")) {
        return;
      }
      const raw = el.dataset.raw;
      if (raw == null) {
        return;
      }
      const role = getMsgRole(el);
      setMessageContent(el, role, raw);
      if (!chatSearchOpen || q.length < 1) {
        return;
      }
      if (!raw.toLowerCase().includes(q.toLowerCase())) {
        return;
      }
      const body = el.querySelector(".msg-body");
      const marked = highlightTextInElement(body, q);
      // Даже если текст разбит по DOM-узлам — помечаем сообщение.
      el.classList.add("has-search-match");
      chatSearchMatchEls.push(el);
      if (!marked && body) {
        body.classList.add("has-search-match-fallback");
      }
    });

    if (chatSearchMatchEls.length) {
      focusChatSearchMatch(0, true);
    }
  }

  function clearMessageSearchHighlight() {
    if (chatSearchHighlightTimer) {
      clearTimeout(chatSearchHighlightTimer);
      chatSearchHighlightTimer = null;
    }
    if (!messagesEl) {
      return;
    }
    messagesEl
      .querySelectorAll(".is-search-hit")
      .forEach((el) => el.classList.remove("is-search-hit"));
  }

  function highlightMessageByIndex(index) {
    clearMessageSearchHighlight();
    if (!messagesEl || !Number.isInteger(index) || index < 0) {
      return;
    }
    const el = messagesEl.querySelector(`.msg[data-index="${index}"]`);
    if (!el) {
      return;
    }
    const target = el.closest(".msg-wrap") || el;
    target.classList.add("is-search-hit");
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    chatSearchHighlightTimer = setTimeout(() => {
      target.classList.remove("is-search-hit");
      chatSearchHighlightTimer = null;
    }, 2400);
  }

  function syncChatSearchBody() {
    const query = chatSearchInput
      ? String(chatSearchInput.value || "").trim()
      : "";
    const showResults =
      chatSearchOpen && chatSearchScope === "all" && query.length >= 1;
    if (chatSearchResults) {
      chatSearchResults.hidden = !showResults;
    }
    if (messagesEl) {
      messagesEl.hidden = false;
    }
    if (chatScreen) {
      chatScreen.classList.toggle("is-searching", chatSearchOpen);
    }
  }

  function renderChatSearchResults(hits, query) {
    if (!chatSearchResults) {
      return;
    }
    chatSearchHits = Array.isArray(hits) ? hits : [];
    chatSearchActiveIndex = chatSearchHits.length ? 0 : -1;
    const q = String(query || "").trim();
    syncChatSearchBody();

    if (chatSearchScope !== "all" || q.length < 1) {
      chatSearchResults.innerHTML = "";
      return;
    }
    if (!chatSearchHits.length) {
      chatSearchResults.innerHTML =
        '<div class="chat-search-empty">Ничего не найдено</div>';
      return;
    }

    chatSearchResults.innerHTML = chatSearchHits
      .map((hit, index) => {
        const roleLabel = hit.role === "user" ? "Вы" : "Агент";
        return (
          `<button type="button" class="chat-search-hit${
            index === chatSearchActiveIndex ? " is-active" : ""
          }" role="option" data-index="${index}">` +
          `<div class="chat-search-hit-meta">` +
          `<span class="chat-search-hit-role">${escapeHtml(roleLabel)}</span>` +
          `<span class="chat-search-hit-agent">${escapeHtml(
            hit.agentName || "Агент"
          )}</span>` +
          `<span class="chat-search-hit-time">${escapeHtml(
            hit.time || ""
          )}</span>` +
          `</div>` +
          `<div class="chat-search-hit-snippet">${highlightQueryInText(
            hit.snippet || "",
            q
          )}</div>` +
          `</button>`
        );
      })
      .join("");
  }

  function setChatSearchActiveIndex(next) {
    if (!chatSearchHits.length || !chatSearchResults) {
      return;
    }
    const max = chatSearchHits.length - 1;
    chatSearchActiveIndex = Math.max(0, Math.min(max, next));
    chatSearchResults.querySelectorAll(".chat-search-hit").forEach((el, i) => {
      el.classList.toggle("is-active", i === chatSearchActiveIndex);
    });
    const active = chatSearchResults.querySelector(
      `.chat-search-hit[data-index="${chatSearchActiveIndex}"]`
    );
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function requestChatSearch() {
    if (!chatSearchOpen) {
      return;
    }
    const query = chatSearchInput ? String(chatSearchInput.value || "") : "";
    applyInChatSearchHighlights(query);
    syncChatSearchBody();
    if (String(query).trim().length < 1) {
      renderChatSearchResults([], query);
      return;
    }
    if (chatSearchScope !== "all") {
      renderChatSearchResults([], query);
      return;
    }
    const requestId = `cs_${Date.now().toString(36)}_${++chatSearchRequestId}`;
    vscode.postMessage({
      type: "searchChat",
      requestId,
      query,
      scope: "all",
      role: "all",
      date: "any",
    });
    chatSearchPendingRequestId = requestId;
  }

  function scheduleChatSearch() {
    const query = chatSearchInput ? String(chatSearchInput.value || "") : "";
    applyInChatSearchHighlights(query);
    syncChatSearchBody();
    if (chatSearchTimer) {
      clearTimeout(chatSearchTimer);
    }
    chatSearchTimer = setTimeout(() => {
      chatSearchTimer = null;
      requestChatSearch();
    }, 160);
  }

  function openSearchHit(hit) {
    if (!hit || !hit.agentId) {
      return;
    }
    const messageIndex = Number(hit.messageIndex);
    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
      return;
    }
    closeChatSearch();
    if (hit.agentId === activeAgentId && chatScreen && !chatScreen.hidden) {
      highlightMessageByIndex(messageIndex);
      return;
    }
    pendingHighlightIndex = messageIndex;
    vscode.postMessage({
      type: "openSearchHit",
      agentId: hit.agentId,
      messageIndex,
    });
  }

  function openChatSearch(opts) {
    if (!chatSearchPanel) {
      return;
    }
    const fromAgents = Boolean(opts && opts.fromAgents);
    if (chatScreen && chatScreen.hidden) {
      pendingOpenSearch = opts || { fromAgents: true };
      if (activeAgentId) {
        vscode.postMessage({ type: "openAgent", agentId: activeAgentId });
      }
      return;
    }
    chatSearchOpen = true;
    chatSearchPanel.hidden = false;
    if (fromAgents || !activeAgentId) {
      chatSearchScope = "all";
    } else if (!opts || opts.scope == null) {
      chatSearchScope = "current";
    } else {
      chatSearchScope = opts.scope;
    }
    syncChatSearchBody();
    if (chatSearchInput) {
      chatSearchInput.focus();
      chatSearchInput.select();
    }
    scheduleChatSearch();
  }

  function closeChatSearch() {
    chatSearchOpen = false;
    if (chatSearchTimer) {
      clearTimeout(chatSearchTimer);
      chatSearchTimer = null;
    }
    if (chatSearchPanel) {
      chatSearchPanel.hidden = true;
    }
    chatSearchHits = [];
    chatSearchActiveIndex = -1;
    chatSearchPendingRequestId = "";
    if (chatSearchResults) {
      chatSearchResults.innerHTML = "";
    }
    applyInChatSearchHighlights("");
    syncChatSearchBody();
  }

  function setModelsHint(text, isError) {
    if (!settingsModelsHint) {
      return;
    }
    if (!text) {
      settingsModelsHint.hidden = true;
      settingsModelsHint.textContent = "";
      settingsModelsHint.classList.remove("is-error");
      return;
    }
    settingsModelsHint.hidden = false;
    settingsModelsHint.textContent = text;
    settingsModelsHint.classList.toggle("is-error", Boolean(isError));
  }

  function setProvidersHint(text, isError) {
    if (!settingsProvidersHint) {
      return;
    }
    if (!text) {
      settingsProvidersHint.hidden = true;
      settingsProvidersHint.textContent = "";
      settingsProvidersHint.classList.remove("is-error");
      return;
    }
    settingsProvidersHint.hidden = false;
    settingsProvidersHint.textContent = text;
    settingsProvidersHint.classList.toggle("is-error", Boolean(isError));
  }

  function providerLabel(providerId) {
    const provider = settingsProviders.find((p) => p.id === providerId);
    return provider ? provider.name || provider.id : providerId || "—";
  }

  function primaryProviderId() {
    const def = settingsProviders.find((p) => p.id === "default");
    return def?.id || settingsProviders[0]?.id || "";
  }

  function cloneProvider(provider) {
    return {
      id: provider.id || "",
      name: provider.name || "",
      baseUrl: provider.baseUrl || "",
      apiKey: provider.apiKey || "",
    };
  }

  function fillModelProviderSelect(selectedId) {
    if (!modelEditProvider) {
      return;
    }
    const fallback = primaryProviderId();
    const current = selectedId || fallback;
    modelEditProvider.innerHTML = "";
    if (!settingsProviders.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Сначала добавьте провайдера";
      modelEditProvider.appendChild(empty);
      return;
    }
    for (const provider of settingsProviders) {
      const id = String(provider.id || "").trim();
      if (!id) {
        continue;
      }
      const option = document.createElement("option");
      option.value = id;
      option.textContent = provider.name ? `${provider.name} (${id})` : id;
      modelEditProvider.appendChild(option);
    }
    if (
      current &&
      Array.from(modelEditProvider.options).some((o) => o.value === current)
    ) {
      modelEditProvider.value = current;
    } else if (modelEditProvider.options.length) {
      modelEditProvider.selectedIndex = 0;
    }
  }

  function openProviderEditModal(index, preset) {
    if (!providerEditModal) {
      return;
    }
    providerEditIndex = index;
    const isNew = index === -1;
    const provider = isNew
      ? preset || { id: "", name: "", baseUrl: "", apiKey: "" }
      : settingsProviders[index] || {
          id: "",
          name: "",
          baseUrl: "",
          apiKey: "",
        };
    if (providerEditTitle) {
      providerEditTitle.textContent = isNew ? "Новый провайдер" : "Провайдер";
    }
    if (providerEditId) {
      providerEditId.value = provider.id || "";
      providerEditId.readOnly = !isNew;
    }
    if (providerEditName) {
      providerEditName.value = provider.name || "";
    }
    if (providerEditBaseUrl) {
      providerEditBaseUrl.value = provider.baseUrl || "";
    }
    if (providerEditApiKey) {
      providerEditApiKey.value = provider.apiKey || "";
    }
    providerEditModal.hidden = false;
    (isNew ? providerEditId : providerEditName)?.focus();
  }

  function closeProviderEditModal() {
    if (!providerEditModal) {
      return;
    }
    providerEditModal.hidden = true;
    providerEditIndex = null;
  }

  function applyProviderEditModal() {
    const id = providerEditId ? providerEditId.value.trim() : "";
    const baseUrl = providerEditBaseUrl
      ? providerEditBaseUrl.value.trim().replace(/\/$/, "")
      : "";
    if (!id) {
      setProvidersHint("Укажите id провайдера.", true);
      providerEditId?.focus();
      return;
    }
    if (!baseUrl) {
      setProvidersHint("Укажите base URL.", true);
      providerEditBaseUrl?.focus();
      return;
    }
    const name = providerEditName ? providerEditName.value.trim() : "";
    const apiKey = providerEditApiKey ? providerEditApiKey.value : "";
    const next = { id, name: name || id, baseUrl, apiKey };

    if (providerEditIndex === -1) {
      if (settingsProviders.some((p) => p.id === id)) {
        setProvidersHint(`Провайдер «${id}» уже есть.`, true);
        return;
      }
      settingsProviders.push(next);
    } else if (
      Number.isFinite(providerEditIndex) &&
      providerEditIndex >= 0 &&
      providerEditIndex < settingsProviders.length
    ) {
      settingsProviders[providerEditIndex] = next;
    }
    closeProviderEditModal();
    setProvidersHint("");
    renderSettingsProviders();
    renderSettingsModels();
    fillModelProviderSelect(modelEditProvider?.value || "");
    schedulePersistSettings(0);
  }

  function renderSettingsProviders() {
    if (!settingsProvidersList) {
      return;
    }
    settingsProvidersList.innerHTML = "";
    if (!settingsProviders.length) {
      settingsProvidersList.innerHTML =
        '<div class="settings-models-empty">Нет провайдеров — добавьте хотя бы один.</div>';
      return;
    }
    settingsProviders.forEach((provider, index) => {
      const row = document.createElement("div");
      row.className = "settings-model-row";
      row.dataset.index = String(index);
      const title = provider.name || provider.id || "Провайдер";
      row.innerHTML =
        `<div class="settings-model-info">` +
        `<div class="settings-model-name"></div>` +
        `<div class="settings-model-id"></div>` +
        `</div>` +
        `<button type="button" class="icon-btn settings-provider-edit" data-index="${index}" title="Настройки" aria-label="Настройки">` +
        SETTINGS_ICON +
        `</button>` +
        `<button type="button" class="icon-btn settings-provider-remove" data-index="${index}" title="Удалить" aria-label="Удалить">` +
        DELETE_ICON +
        `</button>`;
      row.querySelector(".settings-model-name").textContent = title;
      row.querySelector(".settings-model-id").textContent =
        provider.baseUrl || provider.id || "";
      settingsProvidersList.appendChild(row);
    });
  }

  function setJsonHint(text, isError) {
    if (!settingsJsonHint) {
      return;
    }
    if (!text) {
      settingsJsonHint.hidden = true;
      settingsJsonHint.textContent = "";
      settingsJsonHint.classList.remove("is-error");
      return;
    }
    settingsJsonHint.hidden = false;
    settingsJsonHint.textContent = text;
    settingsJsonHint.classList.toggle("is-error", Boolean(isError));
  }

  function pickField(raw, keys) {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const entries = Object.entries(raw);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] != null) {
        return raw[key];
      }
    }
    const lowerMap = new Map(
      entries.map(([k, v]) => [String(k).toLowerCase(), v])
    );
    for (const key of keys) {
      const value = lowerMap.get(String(key).toLowerCase());
      if (value != null) {
        return value;
      }
    }
    return undefined;
  }

  function pickNestedField(raw, keys) {
    const direct = pickField(raw, keys);
    if (direct != null) {
      return direct;
    }
    const nestKeys = [
      "model_info",
      "modelInfo",
      "limits",
      "limit",
      "metadata",
      "meta",
      "config",
      "parameters",
      "params",
      "info",
      "capabilities",
    ];
    for (const nestKey of nestKeys) {
      const nested = pickField(raw, [nestKey]);
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const value = pickField(nested, keys);
        if (value != null) {
          return value;
        }
      }
    }
    return undefined;
  }

  function normalizeModelEntry(raw) {
    if (typeof raw === "string") {
      const id = raw.trim();
      return id ? { id, label: id } : null;
    }
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const id = String(
      pickField(raw, [
        "id",
        "model",
        "model_id",
        "modelId",
        "modelID",
        "slug",
        "value",
        "key",
      ]) || ""
    ).trim();
    if (!id) {
      return null;
    }

    const label = String(
      pickField(raw, [
        "label",
        "title",
        "name",
        "displayName",
        "display_name",
        "display",
        "text",
        "description",
      ]) || ""
    ).trim() || id;

    const contextRaw = pickNestedField(raw, [
      "contextWindow",
      "context_window",
      "contextLength",
      "context_length",
      "maxContext",
      "max_context",
      "maxContextTokens",
      "max_context_tokens",
      "max_input_tokens",
      "maxInputTokens",
      "max_input",
      "maxInput",
      "input_tokens",
      "inputTokens",
      "context",
      "tokens",
      "max_tokens",
      "maxTokens",
    ]);
    const outputRaw = pickNestedField(raw, [
      "maxOutputTokens",
      "max_output_tokens",
      "max_output",
      "maxOutput",
      "output_tokens",
      "outputTokens",
      "max_completion_tokens",
      "maxCompletionTokens",
      "completion_tokens",
      "completionTokens",
    ]);
    const contextWindow = Number(contextRaw);
    const maxOutputTokens = Number(outputRaw);
    const visionRaw = pickField(raw, [
      "supportsVision",
      "supports_vision",
      "vision",
      "multimodal",
    ]);
    const model = { id, label, enabled: true };
    if (Number.isFinite(contextWindow) && contextWindow >= 1024) {
      model.contextWindow = Math.floor(contextWindow);
    }
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      model.maxOutputTokens = Math.floor(maxOutputTokens);
    }
    if (visionRaw === true || visionRaw === "true" || visionRaw === 1) {
      model.supportsVision = true;
    } else if (
      visionRaw === false ||
      visionRaw === "false" ||
      visionRaw === 0
    ) {
      model.supportsVision = false;
    }
    return model;
  }

  function cloneModel(model) {
    return {
      id: model.id || "",
      label: model.label || "",
      providerId: model.providerId || "",
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      enabled: model.enabled !== false,
      favorite: model.favorite === true,
      supportsVision:
        typeof model.supportsVision === "boolean"
          ? model.supportsVision
          : guessModelSupportsVision(model.id),
    };
  }

  function sortSettingsModels() {
    settingsModels.sort((a, b) => {
      const favA = a.favorite === true ? 0 : 1;
      const favB = b.favorite === true ? 0 : 1;
      if (favA !== favB) {
        return favA - favB;
      }
      const labelA = String(a.label || a.id || "").trim();
      const labelB = String(b.label || b.id || "").trim();
      const byLabel = labelA.localeCompare(labelB, "ru", {
        sensitivity: "base",
        numeric: true,
      });
      if (byLabel !== 0) {
        return byLabel;
      }
      return String(a.id || "").localeCompare(String(b.id || ""), "ru", {
        sensitivity: "base",
        numeric: true,
      });
    });
  }

  function upsertModels(incoming) {
    const byId = new Map();
    for (const model of settingsModels) {
      const id = String(model.id || "").trim();
      if (id) {
        byId.set(id, cloneModel(model));
      }
    }
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      const model = normalizeModelEntry(item);
      if (!model) {
        continue;
      }
      if (byId.has(model.id)) {
        const prev = byId.get(model.id);
        byId.set(model.id, {
          id: model.id,
          label: model.label || prev.label || model.id,
          providerId: prev.providerId || "",
          contextWindow:
            model.contextWindow || prev.contextWindow || undefined,
          maxOutputTokens:
            model.maxOutputTokens || prev.maxOutputTokens || undefined,
          enabled: prev.enabled !== false,
          favorite: prev.favorite === true,
          supportsVision:
            typeof model.supportsVision === "boolean"
              ? model.supportsVision
              : typeof prev.supportsVision === "boolean"
                ? prev.supportsVision
                : guessModelSupportsVision(model.id),
        });
        updated += 1;
      } else {
        byId.set(model.id, cloneModel(model));
        added += 1;
      }
    }
    settingsModels = Array.from(byId.values());
    sortSettingsModels();
    renderSettingsModels();
    return { added, updated, total: settingsModels.filter((m) => m.id).length };
  }

  function looksLikeModelEntry(item) {
    if (typeof item === "string") {
      return Boolean(item.trim());
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    return Boolean(
      pickField(item, [
        "id",
        "model",
        "model_id",
        "modelId",
        "modelID",
        "slug",
        "value",
        "key",
        "name",
      ])
    );
  }

  function extractModelsList(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (looksLikeModelEntry(parsed)) {
      return [parsed];
    }

    const wrapperKeys = [
      "models",
      "data",
      "items",
      "results",
      "list",
      "model_list",
      "modelList",
      "available_models",
      "availableModels",
      "choices",
      "entries",
      "values",
      "records",
      "payload",
      "response",
      "body",
      "result",
    ];

    for (const key of wrapperKeys) {
      const value = pickField(parsed, [key]);
      if (Array.isArray(value)) {
        return value;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = extractModelsList(value);
        if (nested) {
          return nested;
        }
      }
    }

    for (const value of Object.values(parsed)) {
      if (!Array.isArray(value) || !value.length) {
        continue;
      }
      if (value.some(looksLikeModelEntry)) {
        return value;
      }
    }

    return null;
  }

  function parseModelsJson(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      throw new Error("Вставьте JSON со списком моделей.");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Некорректный JSON.");
    }
    const items = extractModelsList(parsed);
    if (!items) {
      throw new Error("В JSON не найден список моделей.");
    }
    return items;
  }

  function importModelsFromJson() {
    try {
      const items = parseModelsJson(settingsModelsJson?.value || "");
      const normalized = items
        .map((item) => normalizeModelEntry(item))
        .filter(Boolean);
      if (!normalized.length) {
        throw new Error("В JSON нет ни одной модели с id.");
      }
      const result = upsertModels(normalized);
      setJsonHint(
        `Готово: +${result.added}, обновлено ${result.updated}, всего ${result.total}.`
      );
      return true;
    } catch (error) {
      setJsonHint(error.message || "Не удалось импортировать.", true);
      return false;
    }
  }

  function exportModelsToJson() {
    const payload = settingsModels
      .filter((m) => String(m.id || "").trim())
      .map((m) => {
        const row = {
          id: m.id,
          label: m.label || m.id,
        };
        if (m.contextWindow) {
          row.contextWindow = m.contextWindow;
        }
        if (m.maxOutputTokens) {
          row.maxOutputTokens = m.maxOutputTokens;
        }
        if (typeof m.supportsVision === "boolean") {
          row.supportsVision = m.supportsVision;
        }
        return row;
      });
    const text = JSON.stringify(payload, null, 2);
    if (settingsModelsJson) {
      settingsModelsJson.value = text;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setJsonHint("Список скопирован в буфер."),
        () => setJsonHint("JSON заполнен в поле ниже.")
      );
    } else {
      setJsonHint("JSON заполнен в поле ниже.");
    }
  }

  function syncDefaultModelSelect() {
    if (!settingsDefaultModel) {
      return;
    }
    const current = settingsDefaultModelId;
    settingsDefaultModel.innerHTML = "";
    for (const model of settingsModels) {
      const id = String(model.id || "").trim();
      if (!id || model.enabled === false) {
        continue;
      }
      const option = document.createElement("option");
      option.value = id;
      option.textContent = model.label ? `${model.label} (${id})` : id;
      settingsDefaultModel.appendChild(option);
    }
    if (
      current &&
      Array.from(settingsDefaultModel.options).some((o) => o.value === current)
    ) {
      settingsDefaultModel.value = current;
    } else if (settingsDefaultModel.options.length) {
      settingsDefaultModel.selectedIndex = 0;
      settingsDefaultModelId = settingsDefaultModel.value;
    } else {
      settingsDefaultModelId = "";
    }
  }

  function setModelEditMode(mode) {
    modelEditMode = mode === "json" ? "json" : "manual";
    if (modelEditTabs) {
      modelEditTabs.querySelectorAll("[data-model-mode]").forEach((btn) => {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-model-mode") === modelEditMode
        );
      });
    }
    if (modelEditManualPane) {
      modelEditManualPane.hidden = modelEditMode !== "manual";
    }
    if (modelEditJsonPane) {
      modelEditJsonPane.hidden = modelEditMode !== "json";
    }
    if (modelEditDoneBtn) {
      modelEditDoneBtn.textContent =
        modelEditMode === "json" ? "Применить" : "Готово";
    }
  }

  function openModelEditModal(index) {
    if (!modelEditModal) {
      return;
    }
    modelEditIndex = index;
    const isNew = index === -1;
    const model = isNew
      ? {
          id: "",
          label: "",
          providerId: "",
          contextWindow: undefined,
          maxOutputTokens: undefined,
        }
      : settingsModels[index] || { id: "", label: "", providerId: "" };
    if (modelEditTitle) {
      modelEditTitle.textContent = isNew ? "Добавить модели" : "Настройки модели";
    }
    if (modelEditTabs) {
      modelEditTabs.hidden = !isNew;
    }
    setModelEditMode("manual");
    setJsonHint("");
    if (modelEditId) {
      modelEditId.value = model.id || "";
    }
    if (modelEditLabel) {
      modelEditLabel.value = model.label || "";
    }
    fillModelProviderSelect(model.providerId || primaryProviderId());
    if (modelEditContext) {
      modelEditContext.value =
        model.contextWindow && Number(model.contextWindow) > 0
          ? String(model.contextWindow)
          : "";
    }
    if (modelEditOutput) {
      modelEditOutput.value =
        model.maxOutputTokens && Number(model.maxOutputTokens) > 0
          ? String(model.maxOutputTokens)
          : "";
    }
    if (modelEditVision) {
      modelEditVision.checked =
        typeof model.supportsVision === "boolean"
          ? model.supportsVision
          : guessModelSupportsVision(model.id);
    }
    if (isNew && settingsModelsJson && !settingsModelsJson.value.trim()) {
      settingsModelsJson.value = "";
    }
    modelEditModal.hidden = false;
    if (isNew) {
      modelEditId?.focus();
    } else {
      modelEditId?.focus();
    }
  }

  function closeModelEditModal() {
    if (!modelEditModal) {
      return;
    }
    modelEditModal.hidden = true;
    modelEditIndex = null;
    setModelEditMode("manual");
    setJsonHint("");
  }

  function applyModelEditModal() {
    if (modelEditIndex === -1 && modelEditMode === "json") {
      if (importModelsFromJson()) {
        closeModelEditModal();
        setModelsHint("Модели из JSON добавлены.");
        schedulePersistSettings(0);
      }
      return;
    }

    const id = modelEditId ? modelEditId.value.trim() : "";
    if (!id) {
      setModelsHint("Укажите id модели.", true);
      setModelEditMode("manual");
      modelEditId?.focus();
      return;
    }
    const label = modelEditLabel ? modelEditLabel.value.trim() : "";
    const providerId = modelEditProvider ? modelEditProvider.value.trim() : "";
    if (!providerId) {
      setModelsHint("Выберите провайдера (или сначала добавьте его).", true);
      setModelEditMode("manual");
      modelEditProvider?.focus();
      return;
    }
    const contextWindow = Number(modelEditContext?.value);
    const maxOutputTokens = Number(modelEditOutput?.value);
    const next = {
      id,
      label: label || id,
      providerId,
      enabled: true,
      supportsVision: modelEditVision ? Boolean(modelEditVision.checked) : false,
    };
    if (Number.isFinite(contextWindow) && contextWindow >= 1024) {
      next.contextWindow = Math.floor(contextWindow);
    }
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      next.maxOutputTokens = Math.floor(maxOutputTokens);
    }

    if (modelEditIndex === -1) {
      const existing = settingsModels.findIndex((m) => m.id === id);
      if (existing >= 0) {
        const prev = settingsModels[existing];
        settingsModels[existing] = {
          ...next,
          enabled: prev.enabled !== false,
          favorite: prev.favorite === true,
        };
      } else {
        settingsModels.push(next);
      }
    } else if (
      Number.isFinite(modelEditIndex) &&
      modelEditIndex >= 0 &&
      modelEditIndex < settingsModels.length
    ) {
      const prev = settingsModels[modelEditIndex];
      const duplicate = settingsModels.findIndex(
        (m, i) => i !== modelEditIndex && m.id === id
      );
      if (duplicate >= 0) {
        setModelsHint(`Модель с id «${id}» уже есть.`, true);
        return;
      }
      settingsModels[modelEditIndex] = {
        ...next,
        enabled: prev.enabled !== false,
        favorite: prev.favorite === true,
      };
    }
    closeModelEditModal();
    setModelsHint("");
    sortSettingsModels();
    renderSettingsModels();
    schedulePersistSettings(0);
  }

  function formatModelTokens(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return "—";
    }
    return Math.floor(n).toLocaleString("ru-RU");
  }

  function ensureSettingsModelTip() {
    if (settingsModelTipEl) {
      return settingsModelTipEl;
    }
    settingsModelTipEl = document.createElement("div");
    settingsModelTipEl.className = "settings-model-tip";
    settingsModelTipEl.hidden = true;
    settingsModelTipEl.setAttribute("role", "tooltip");
    const labels = [
      "ID",
      "Название",
      "Провайдер",
      "Контекст (вход)",
      "Ответ (выход)",
      "Статус",
      "Избранное",
      "Vision",
    ];
    settingsModelTipRows = labels.map((label) => {
      const line = document.createElement("div");
      line.className = "settings-model-tip-row";
      const key = document.createElement("span");
      key.className = "settings-model-tip-key";
      key.textContent = label;
      const val = document.createElement("span");
      val.className = "settings-model-tip-val";
      line.appendChild(key);
      line.appendChild(val);
      settingsModelTipEl.appendChild(line);
      return val;
    });
    document.body.appendChild(settingsModelTipEl);
    return settingsModelTipEl;
  }

  function hideSettingsModelTip() {
    if (settingsModelTipHideTimer) {
      clearTimeout(settingsModelTipHideTimer);
      settingsModelTipHideTimer = null;
    }
    settingsModelTipIndex = null;
    if (settingsModelTipEl) {
      settingsModelTipEl.hidden = true;
    }
  }

  function fillSettingsModelTip(model) {
    const vals = [
      model.id || "—",
      model.label || model.id || "—",
      providerLabel(model.providerId),
      formatModelTokens(model.contextWindow),
      formatModelTokens(model.maxOutputTokens),
      model.enabled !== false ? "Включена" : "Выключена",
      model.favorite === true ? "Да" : "Нет",
      resolveModelSupportsVision(model) ? "Да" : "Нет",
    ];
    ensureSettingsModelTip();
    for (let i = 0; i < settingsModelTipRows.length; i += 1) {
      settingsModelTipRows[i].textContent = vals[i];
    }
  }

  function positionSettingsModelTip(anchor) {
    const tip = ensureSettingsModelTip();
    if (!anchor || tip.hidden) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const tipWidth = tip.offsetWidth || 220;
    const tipHeight = tip.offsetHeight || 120;
    let left = rect.left;
    if (left + tipWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - tipWidth - margin);
    }
    let top = rect.bottom + 6;
    if (top + tipHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - tipHeight - 6);
    }
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function showSettingsModelTip(anchor, model, index) {
    if (!anchor || !model) {
      return;
    }
    if (settingsModelTipHideTimer) {
      clearTimeout(settingsModelTipHideTimer);
      settingsModelTipHideTimer = null;
    }
    const tip = ensureSettingsModelTip();
    if (settingsModelTipIndex !== index) {
      fillSettingsModelTip(model);
      settingsModelTipIndex = index;
    }
    tip.hidden = false;
    positionSettingsModelTip(anchor);
  }

  function scheduleHideSettingsModelTip() {
    if (settingsModelTipHideTimer) {
      clearTimeout(settingsModelTipHideTimer);
    }
    settingsModelTipHideTimer = setTimeout(() => {
      settingsModelTipHideTimer = null;
      hideSettingsModelTip();
    }, 40);
  }

  function renderSettingsModels() {
    if (!settingsModelsList) {
      return;
    }
    hideSettingsModelTip();
    sortSettingsModels();
    settingsModelsList.innerHTML = "";
    if (!settingsModels.length) {
      settingsModelsList.innerHTML =
        '<div class="settings-models-empty">Список пуст — добавьте модель.</div>';
      syncDefaultModelSelect();
      return;
    }
    settingsModels.forEach((model, index) => {
      const row = document.createElement("div");
      const enabled = model.enabled !== false;
      const favorite = model.favorite === true;
      row.className =
        "settings-model-row" + (enabled ? "" : " is-disabled");
      row.dataset.index = String(index);
      const title = model.label || model.id || "Без id";
      const parts = [];
      if (model.label && model.id && model.label !== model.id) {
        parts.push(model.id);
      }
      parts.push(providerLabel(model.providerId));
      const subtitle = parts.join(" · ");
      row.innerHTML =
        `<label class="settings-model-switch" title="${enabled ? "Выключить" : "Включить"}">` +
        `<input type="checkbox" class="settings-model-toggle" data-index="${index}" ${
          enabled ? "checked" : ""
        } />` +
        `<span class="settings-model-switch-ui" aria-hidden="true"></span>` +
        `</label>` +
        `<div class="settings-model-info">` +
        `<div class="settings-model-title">` +
        `<div class="settings-model-name"></div>` +
        `<button type="button" class="icon-btn settings-model-info-btn" data-index="${index}" title="Параметры модели" aria-label="Параметры модели">` +
        INFO_ICON +
        `</button>` +
        `</div>` +
        `<div class="settings-model-id"></div>` +
        `</div>` +
        `<button type="button" class="icon-btn settings-model-fav${
          favorite ? " is-on" : ""
        }" data-index="${index}" title="${
          favorite ? "Убрать из избранного" : "В избранное"
        }" aria-label="${
          favorite ? "Убрать из избранного" : "В избранное"
        }" aria-pressed="${favorite ? "true" : "false"}">` +
        HEART_ICON +
        `</button>` +
        `<button type="button" class="icon-btn settings-model-edit" data-index="${index}" title="Настройки" aria-label="Настройки">` +
        SETTINGS_ICON +
        `</button>` +
        `<button type="button" class="icon-btn settings-model-remove" data-index="${index}" title="Удалить" aria-label="Удалить">` +
        DELETE_ICON +
        `</button>`;
      row.querySelector(".settings-model-name").textContent = title;
      row.querySelector(".settings-model-id").textContent = subtitle;
      settingsModelsList.appendChild(row);
    });
    syncDefaultModelSelect();
  }

  function readModelsFromDom() {
    return settingsModels
      .map((m) => cloneModel(m))
      .filter((m) => String(m.id || "").trim());
  }

  function showSettingsSaved() {
    if (!settingsSaveStatus) {
      return;
    }
    settingsSaveStatus.hidden = false;
    if (settingsSaveStatusTimer) {
      clearTimeout(settingsSaveStatusTimer);
    }
    settingsSaveStatusTimer = setTimeout(() => {
      settingsSaveStatus.hidden = true;
    }, 1200);
  }

  function persistSettingsNow() {
    if (settingsHydrating) {
      return;
    }
    vscode.postMessage({
      type: "saveSettings",
      settings: collectSettings(),
    });
    showSettingsSaved();
  }

  function persistModesNow() {
    if (settingsHydrating) {
      return;
    }
    vscode.postMessage({
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
    settingsProviders = Array.isArray(settings.providers)
      ? settings.providers.map((p) => ({
          id: p.id || "",
          name: p.name || "",
          baseUrl: p.baseUrl || "",
          apiKey: p.apiKey || "",
        }))
      : [];
    if (
      !settingsProviders.length &&
      (settings.baseUrl || settings.apiKey)
    ) {
      settingsProviders.push({
        id: "default",
        name: "Основной",
        baseUrl: String(settings.baseUrl || "").replace(/\/$/, ""),
        apiKey: settings.apiKey || "",
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
    settingsDefaultContextWindow =
      Number(settings.defaultContextWindow) > 0
        ? Number(settings.defaultContextWindow)
        : 128000;
    if (settingsRejectUnauthorized) {
      settingsRejectUnauthorized.checked = Boolean(settings.rejectUnauthorized);
    }
    if (settingsCaBundle) {
      settingsCaBundle.value = settings.caBundlePath || "";
    }
    if (settingsSystemPrompt) {
      settingsSystemPrompt.value = settings.systemPrompt || "";
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
        settings.maxResponseChars || 12000
      );
    }
    closeModelEditModal();
    closeProviderEditModal();
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
      defaultModel: settingsDefaultModel
        ? settingsDefaultModel.value
        : settingsDefaultModelId,
      defaultContextWindow: settingsDefaultContextWindow,
      baseUrl: primary ? String(primary.baseUrl || "").replace(/\/$/, "") : "",
      apiKey: primary ? primary.apiKey || "" : "",
      rejectUnauthorized: settingsRejectUnauthorized
        ? settingsRejectUnauthorized.checked
        : false,
      caBundlePath: settingsCaBundle ? settingsCaBundle.value.trim() : "",
      systemPrompt: settingsSystemPrompt ? settingsSystemPrompt.value : "",
      maxToolRounds: Number(settingsMaxToolRounds?.value || 20),
      maxTokens: Number(settingsMaxTokens?.value || 4096),
      maxResponseChars: Number(settingsMaxResponseChars?.value || 12000),
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
        if (m.enabled === false) {
          row.enabled = false;
        }
        return row;
      });
  }

  const DEFAULT_CHAT_MODES = [
    {
      id: "agent",
      label: "Агент",
      description: "Читает и правит код",
      tools: "agent",
      builtin: true,
      placeholder: "Задача для агента... (@ — файл)",
    },
    {
      id: "plan",
      label: "План",
      description: "Только план, без правок",
      tools: "readonly",
      builtin: true,
      placeholder:
        "Опишите задачу — агент составит план без правок… (@ — файл)",
    },
    {
      id: "ask",
      label: "Спросить",
      description: "Ответы и объяснения",
      tools: "readonly",
      builtin: true,
      placeholder: "Спросите про код или задачу… (@ — файл)",
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
      placeholder: m.placeholder || "",
      enabled: m.enabled !== false,
      builtin: Boolean(m.builtin) || ["agent", "plan", "ask"].includes(m.id),
      overridden: Boolean(m.overridden),
    }));
  }

  function applyModes(list, { keepSelection = true } = {}) {
    const next = normalizeModesList(list);
    settingsModes = next.map((m) => ({ ...m }));
    chatModes = next.filter((m) => m.enabled !== false);
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    const still =
      keepSelection && chatModes.some((m) => m.id === agentMode)
        ? agentMode
        : chatModes[0]?.id || "agent";
    if (typeof setAgentMode === "function") {
      setAgentMode(still, { close: false });
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
        '<div class="settings-models-empty">Нет режимов.</div>';
      return;
    }
    settingsModes.forEach((mode, index) => {
      const row = document.createElement("div");
      row.className = "settings-model-row";
      row.dataset.index = String(index);
      const toolsLabel =
        mode.tools === "readonly" ? "только чтение" : "агент";
      const subtitle = mode.builtin
        ? `встроенный · ${toolsLabel}`
        : toolsLabel;
      row.innerHTML =
        `<div class="settings-model-info">` +
        `<div class="settings-model-name"></div>` +
        `<div class="settings-model-id"></div>` +
        `</div>` +
        `<button type="button" class="icon-btn settings-mode-edit" data-index="${index}" title="Изменить" aria-label="Изменить">` +
        SETTINGS_ICON +
        `</button>` +
        (mode.builtin
          ? ""
          : `<button type="button" class="icon-btn settings-mode-remove" data-index="${index}" title="Удалить" aria-label="Удалить">` +
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

  function openModeEditModal(index, source) {
    if (!modeEditModal) {
      return;
    }
    modeEditSource = source || "settings";
    modeEditIndex = Number.isInteger(index) ? index : -1;
    const existing =
      modeEditIndex >= 0 ? settingsModes[modeEditIndex] : null;
    if (modeEditTitle) {
      modeEditTitle.textContent = existing ? "Режим" : "Новый режим";
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
    modeEditModal.hidden = false;
    if (modeEditLabel) {
      modeEditLabel.focus();
    }
  }

  function commitModeEdit() {
    const label = modeEditLabel ? modeEditLabel.value.trim() : "";
    if (!label) {
      showCopyToast("Укажите название режима");
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
      enabled: true,
      builtin: isBuiltin,
      overridden: true,
      placeholder:
        existing?.placeholder ||
        (tools === "readonly"
          ? `${label}… (@ — файл)`
          : `Задача (${label})… (@ — файл)`),
    };
    if (existing && modeEditIndex >= 0) {
      settingsModes[modeEditIndex] = next;
    } else {
      settingsModes.push(next);
    }
    chatModes = settingsModes.filter((m) => m.enabled !== false);
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    closeModeEditModal();
    persistModesNow();
    if (modeEditSource === "composer" && typeof setAgentMode === "function") {
      setAgentMode(id, { focus: true });
    }
  }

  function renderArchiveList() {
    if (!archiveListEl) {
      return;
    }
    const agents = archiveAgentsData || [];
    if (!agents.length) {
      archiveListEl.innerHTML =
        '<div class="agents-empty">Архив пуст.</div>';
      return;
    }

    archiveListEl.innerHTML = agents
      .map(
        (a) =>
          `<div class="agent-block archive-block" data-agent="${a.id}">` +
          `<div class="agent-row-wrap archive-row-wrap">` +
          `<div class="agent-row flat">` +
          `<span class="agent-main">` +
          `<div class="agent-name"></div>` +
          `<div class="agent-meta"><span class="agent-preview"></span></div>` +
          `</span>` +
          `</div>` +
          `<div class="row-actions">` +
          `<button type="button" class="row-action row-restore" data-restore-agent="${a.id}" title="Восстановить" aria-label="Восстановить">` +
          RESTORE_ICON +
          `</button>` +
          `<button type="button" class="row-action row-delete" data-delete-agent="${a.id}" title="Удалить" aria-label="Удалить">` +
          DELETE_ICON +
          `</button>` +
          `</div>` +
          `<span class="agent-time"></span>` +
          `</div>` +
          `</div>`
      )
      .join("");

    agents.forEach((a, index) => {
      const block = archiveListEl.children[index];
      if (!block) {
        return;
      }
      block.querySelector(".agent-name").textContent = a.name || "Агент";
      block.querySelector(".agent-preview").textContent = a.preview || "";
      block.querySelector(".agent-time").textContent = a.time || "";
    });
  }

  function renderAgentsList() {
    if (!agentsListEl) {
      return;
    }
    if (renamingAgentId) {
      return;
    }
    const list = agentsData;

    if (!list.length) {
      agentsListEl.innerHTML =
        '<div class="agents-empty">Нет агентов. Нажмите +, чтобы создать.</div>';
      return;
    }

    agentsListEl.innerHTML = list
      .map((a) => {
        const action = a.empty
          ? `<button type="button" class="row-action row-delete" data-delete-agent="${a.id}" title="Удалить" aria-label="Удалить">` +
            DELETE_ICON +
            `</button>`
          : `<button type="button" class="row-action row-archive" data-archive-agent="${a.id}" title="В архив" aria-label="В архив">` +
            ARCHIVE_ICON +
            `</button>`;
        return (
          `<div class="agent-block${a.active ? " is-active" : ""}" data-agent="${a.id}">` +
          `<div class="agent-row-wrap">` +
          `<div class="agent-row flat" role="button" tabindex="0" data-agent="${a.id}">` +
          `<span class="agent-main">` +
          `<div class="agent-name" title="Переименовать"></div>` +
          `<div class="agent-meta"><span class="agent-chip"></span><span class="agent-preview"></span></div>` +
          `</span>` +
          `</div>` +
          `<div class="row-actions">` +
          action +
          `</div>` +
          `<span class="agent-time"></span>` +
          `</div>` +
          `</div>`
        );
      })
      .join("");

    list.forEach((a, index) => {
      const block = agentsListEl.children[index];
      if (!block) {
        return;
      }
      block.querySelector(".agent-name").textContent = a.name || "Агент";
      block.querySelector(".agent-chip").textContent = a.model || "—";
      block.querySelector(".agent-preview").textContent = a.preview || "";
      block.querySelector(".agent-time").textContent = a.time || "";
    });
  }

  function getAgentNameById(agentId) {
    const row = agentsData.find((a) => a.id === agentId);
    return (row && row.name) || "Агент";
  }

  function startAgentRename(agentId, nameEl) {
    if (!agentId || !nameEl || renamingAgentId) {
      return;
    }
    if (nameEl.tagName === "INPUT" || nameEl.querySelector(".agent-name-input")) {
      return;
    }
    const previous =
      (nameEl.textContent || "").trim() || getAgentNameById(agentId);
    renamingAgentId = agentId;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "agent-name-input";
    input.value = previous;
    input.maxLength = 80;
    input.setAttribute("aria-label", "Название агента");
    input.spellcheck = false;

    const isChat = nameEl === chatAgentNameEl;
    if (isChat) {
      input.classList.add("is-chat");
    }

    const fitInputWidth = () => {
      input.style.width = "0px";
      input.style.width = `${Math.max(input.scrollWidth, 1)}px`;
    };

    const measured = Math.ceil(nameEl.getBoundingClientRect().width);
    input.style.width = `${Math.max(measured, 1)}px`;

    nameEl.classList.add("is-renaming");
    nameEl.after(input);
    requestAnimationFrame(() => {
      fitInputWidth();
      input.focus();
      input.setSelectionRange(0, input.value.length);
    });

    let finished = false;
    const cleanup = () => {
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("input", fitInputWidth);
      input.remove();
      nameEl.classList.remove("is-renaming");
      if (renamingAgentId === agentId) {
        renamingAgentId = null;
      }
    };

    const finish = (save) => {
      if (finished || renamingAgentId !== agentId) {
        return;
      }
      finished = true;
      const next = input.value.replace(/\s+/g, " ").trim().slice(0, 80);
      cleanup();
      if (!save || !next || next === previous) {
        nameEl.textContent = previous;
        return;
      }
      nameEl.textContent = next;
      const item = agentsData.find((a) => a.id === agentId);
      if (item) {
        item.name = next;
      }
      if (agentId === activeAgentId && chatAgentNameEl) {
        chatAgentNameEl.textContent = next;
      }
      vscode.postMessage({
        type: "renameAgent",
        agentId,
        name: next,
      });
    };

    const onKeyDown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    const onBlur = () => {
      finish(true);
    };
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("blur", onBlur);
    input.addEventListener("input", fitInputWidth);
  }

    function focusPrompt() {
    requestAnimationFrame(() => {
      promptEl.focus();
    });
  }

  function parseReviewData(raw) {
    if (Array.isArray(raw)) {
      return { files: raw, showScm: false };
    }
    if (raw && typeof raw === "object") {
      return {
        files: Array.isArray(raw.files) ? raw.files : [],
        showScm: Boolean(raw.showScm),
      };
    }
    if (typeof raw === "string") {
      try {
        return parseReviewData(JSON.parse(raw));
      } catch {
        return { files: [], showScm: false };
      }
    }
    return { files: [], showScm: false };
  }

  function appendReview(filesOrPayload, showScmFlag) {
    let parsed = parseReviewData(filesOrPayload);
    if (Array.isArray(filesOrPayload)) {
      parsed = {
        files: filesOrPayload,
        showScm:
          showScmFlag === undefined ? parsed.showScm : Boolean(showScmFlag),
      };
    } else if (showScmFlag !== undefined) {
      parsed = { ...parsed, showScm: Boolean(showScmFlag) };
    }
    const list = Array.isArray(parsed.files) ? parsed.files : [];
    if (!list.length) {
      return;
    }

    const card = document.createElement("div");
    card.className = "review-card";

    const title = document.createElement("div");
    title.className = "review-title";
    const totalAdd = list.reduce((s, f) => s + (f.added || 0), 0);
    const totalDel = list.reduce((s, f) => s + (f.removed || 0), 0);
    title.textContent = `Изменено файлов: ${list.length} · +${totalAdd} −${totalDel}`;
    card.appendChild(title);

    const fileList = document.createElement("div");
    fileList.className = "review-files";
    for (const file of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "review-file";
      row.title = "Открыть файл";
      row.innerHTML =
        `<span class="review-file-path"></span>` +
        `<span class="review-file-stats">` +
        `<span class="add">+${file.added || 0}</span> ` +
        `<span class="del">−${file.removed || 0}</span>` +
        `</span>`;
      row.querySelector(".review-file-path").textContent = file.path;
      row.addEventListener("click", () => {
        vscode.postMessage({ type: "openFile", path: file.path });
      });
      fileList.appendChild(row);
    }
    card.appendChild(fileList);
    card.dataset.paths = list.map((f) => f.path).join("\n");
    messagesEl.appendChild(card);

    const actions = document.createElement("div");
    actions.className = "review-actions";
    actions.dataset.paths = list.map((f) => f.path).join("\n");
    actions.hidden = !parsed.showScm;
    const scmBtn = document.createElement("button");
    scmBtn.type = "button";
    scmBtn.className = "review-scm";
    scmBtn.title = "Открыть Source Control";
    scmBtn.setAttribute("aria-label", "Открыть Source Control");
    scmBtn.innerHTML = SCM_ICON;
    scmBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "openScm" });
    });
    actions.appendChild(scmBtn);
    messagesEl.appendChild(actions);
    keepStatusAtEnd();
    scrollToBottom();
  }

  function applyScmButtons(reviews) {
    const list = Array.isArray(reviews) ? reviews : [];
    const entries = list.map((r) => ({
      key: [...(r.paths || [])].map(String).sort().join("\n"),
      show: Boolean(r.showScm),
    }));
    for (const el of messagesEl.querySelectorAll(".review-actions")) {
      const key = (el.dataset.paths || "")
        .split("\n")
        .filter(Boolean)
        .sort()
        .join("\n");
      const hit = entries.find((e) => e.key === key);
      // если не нашли соответствие — прячем (безопаснее, чем оставлять кнопку)
      el.hidden = hit ? !hit.show : true;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const FILE_EXT =
    "ts|tsx|js|jsx|mjs|cjs|json|css|scss|less|sass|md|mdx|py|go|rs|java|kt|kts|vue|svelte|html|htm|yml|yaml|toml|xml|svg|sh|bash|zsh|env|lock|swift|dart|php|rb|cs|cpp|cc|cxx|h|hpp|sql|graphql|gql|proto|txt|csv|gitignore|dockerignore|editorconfig";

  function isFilePath(value) {
    const s = String(value || "").trim();
    if (!s || /\s/.test(s) || s.includes("://")) {
      return false;
    }
    if (/^https?:\/\//i.test(s)) {
      return false;
    }
    if (s.includes("/")) {
      if (new RegExp(`\\.(?:${FILE_EXT})$`, "i").test(s)) {
        return true;
      }
      if (/^(?:\.\/|\.\.\/)?(?:[\w.-]+\/)+[\w.-]+$/.test(s)) {
        return true;
      }
      return false;
    }
    return new RegExp(`^[\\w.-]+\\.(?:${FILE_EXT})$`, "i").test(s);
  }

  function fileLinkHtml(path) {
    const safe = escapeHtml(path);
    return `<a class="md-file" href="#" data-path="${safe}">${safe}</a>`;
  }

  function splitTrailingPunctuation(url) {
    let href = String(url);
    let trailing = "";
    while (href.length > 8 && /[*_~.,);:!?]$/.test(href)) {
      trailing = href.slice(-1) + trailing;
      href = href.slice(0, -1);
    }
    return { href, trailing };
  }

  function linkifyPlainText(raw, alreadyEscaped) {
    const tokens = [];
    let text = String(raw || "");

    text = text.replace(/(https?:\/\/[^\s<>"'`]+)/g, (url) => {
      const { href, trailing } = splitTrailingPunctuation(url);
      if (!/^https?:\/\/\S+$/i.test(href)) {
        return url;
      }
      const id = tokens.length;
      tokens.push(
        `<a class="md-link" href="${escapeHtml(href)}" data-href="${escapeHtml(
          href
        )}">${escapeHtml(href)}</a>`
      );
      return `\u0001T${id}\u0001${trailing}`;
    });

    text = text.replace(
      new RegExp(
        `(?<![\\w./-])((?:\\.?\\.?/)?(?:[\\w.-]+/)+[\\w.-]+(?:\\.(?:${FILE_EXT}))?|[\\w.-]+\\.(?:${FILE_EXT}))(?![\\w./-])`,
        "gi"
      ),
      (full, path) => {
        if (!isFilePath(path)) {
          return full;
        }
        const id = tokens.length;
        tokens.push(fileLinkHtml(path));
        return `\u0001T${id}\u0001`;
      }
    );

    const html = (alreadyEscaped ? text : escapeHtml(text)).replace(
      /\u0001T(\d+)\u0001/g,
      (_, id) => tokens[Number(id)] || ""
    );
    return html;
  }

  let markdownReady = false;

  function ensureMarkdownRenderer() {
    if (markdownReady) {
      return typeof marked !== "undefined";
    }
    if (typeof marked === "undefined" || !marked.Renderer) {
      return false;
    }
    markdownReady = true;

    const renderer = new marked.Renderer();

    renderer.code = function ({ text }) {
      const inner = String(text || "").replace(/\n$/, "");
      if (isFilePath(inner.trim()) && !inner.includes("\n")) {
        return fileLinkHtml(inner.trim());
      }
      return (
        `<div class="md-pre-wrap">` +
        `<pre class="md-pre"><code>${escapeHtml(inner)}</code></pre>` +
        `<button type="button" class="icon-btn md-pre-copy" title="Копировать код" aria-label="Копировать код">` +
        COPY_ICON +
        `</button>` +
        `</div>\n`
      );
    };

    renderer.codespan = function ({ text }) {
      const value = String(text || "");
      if (isFilePath(value)) {
        return fileLinkHtml(value);
      }
      return `<code class="md-code">${escapeHtml(value)}</code>`;
    };

    renderer.heading = function ({ tokens, depth }) {
      const level = Math.min(3, Math.max(1, depth || 1));
      return `<div class="md-h md-h${level}">${this.parser.parseInline(
        tokens
      )}</div>\n`;
    };

    renderer.paragraph = function ({ tokens }) {
      return `<div class="md-p">${this.parser.parseInline(tokens)}</div>\n`;
    };

    renderer.blockquote = function ({ tokens }) {
      return `<blockquote class="md-quote">${this.parser.parse(
        tokens
      )}</blockquote>\n`;
    };

    renderer.list = function ({ items, ordered, start }) {
      const tag = ordered ? "ol" : "ul";
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
      const body = items.map((item) => this.listitem(item)).join("");
      return `<${tag} class="md-list md-${tag}"${startAttr}>${body}</${tag}>\n`;
    };

    renderer.listitem = function (item) {
      let body = "";
      if (item.task) {
        const checked = item.checked ? " checked" : "";
        body += `<input class="md-task" type="checkbox" disabled${checked} /> `;
      }
      body += this.parser.parse(item.tokens, !!item.loose);
      return `<li class="md-li">${body}</li>\n`;
    };

    renderer.checkbox = function () {
      return "";
    };

    renderer.strong = function ({ tokens }) {
      return `<strong class="md-strong">${this.parser.parseInline(
        tokens
      )}</strong>`;
    };

    renderer.em = function ({ tokens }) {
      return `<em class="md-em">${this.parser.parseInline(tokens)}</em>`;
    };

    renderer.del = function ({ tokens }) {
      return `<del class="md-del">${this.parser.parseInline(tokens)}</del>`;
    };

    renderer.link = function ({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safeHref = String(href || "");
      if (!/^https?:\/\//i.test(safeHref)) {
        if (isFilePath(safeHref)) {
          return fileLinkHtml(safeHref);
        }
        return label;
      }
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a class="md-link" href="${escapeHtml(
        safeHref
      )}" data-href="${escapeHtml(safeHref)}"${t}>${label}</a>`;
    };

    renderer.image = function ({ text, href }) {
      return escapeHtml(text || href || "");
    };

    renderer.html = function ({ text }) {
      return escapeHtml(text || "");
    };

    renderer.hr = function () {
      return '<hr class="md-hr" />\n';
    };

    renderer.br = function () {
      return "<br />";
    };

    renderer.table = function (token) {
      let header = "";
      for (const cell of token.header) {
        header += this.tablecell(cell);
      }
      let body = "";
      for (const row of token.rows) {
        let cells = "";
        for (const cell of row) {
          cells += this.tablecell(cell);
        }
        body += this.tablerow({ text: cells });
      }
      return (
        `<div class="md-table-wrap"><table class="md-table"><thead>${this.tablerow(
          { text: header }
        )}</thead><tbody>${body}</tbody></table></div>\n`
      );
    };

    renderer.tablerow = function ({ text }) {
      return `<tr>${text}</tr>\n`;
    };

    renderer.tablecell = function (cell) {
      const tag = cell.header ? "th" : "td";
      const align = cell.align ? ` style="text-align:${cell.align}"` : "";
      return `<${tag} class="md-td"${align}>${this.parser.parseInline(
        cell.tokens
      )}</${tag}>`;
    };

    renderer.text = function (token) {
      if (token.tokens && token.tokens.length) {
        return this.parser.parseInline(token.tokens);
      }
      return linkifyPlainText(String(token.text || ""), !!token.escaped);
    };

    marked.use({
      renderer,
      gfm: true,
      breaks: true,
      pedantic: false,
    });
    return true;
  }

  /** Markdown (GFM): таблицы, списки, заголовки, код, ссылки, жирный/курсив и т.д. */
  function renderInlineMarkdown(text) {
    const raw = String(text || "");
    if (!raw) {
      return "";
    }
    if (ensureMarkdownRenderer()) {
      try {
        return marked.parse(raw, { async: false });
      } catch {
        // fallback below
      }
    }
    return `<div class="md-p">${linkifyPlainText(raw, false).replace(
      /\n/g,
      "<br />"
    )}</div>`;
  }

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
    toast.textContent = text || "Скопировано";
    toast.hidden = false;
    if (copyToastTimer) {
      clearTimeout(copyToastTimer);
    }
    copyToastTimer = setTimeout(() => {
      copyToastTimer = null;
      toast.hidden = true;
    }, 1200);
  }

  function requestCopyText(text) {
    const value = String(text || "");
    if (!value) {
      return;
    }
    vscode.postMessage({ type: "copyText", text: value });
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
    if (role === "assistant" || role === "error") {
      body.innerHTML = renderInlineMarkdown(raw);
      return;
    }
    if (role === "user") {
      body.innerHTML = renderUserTextWithMentions(raw);
      return;
    }
    body.textContent = role === "tool" ? formatToolLine(raw) : raw;
  }

  function appendMessage(role, text, index, regenAssistantIndex, attachments) {
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
      return appendToolToGroup(text, index);
    }

    sealToolGroups();

    const el = document.createElement("div");
    el.className = `msg ${role}`;
    if (typeof index === "number") {
      el.dataset.index = String(index);
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
        const editModelLabel = modelDisplayName(
          editingModelId || selectedModelId
        );
        body.innerHTML =
          `<div class="msg-edit-composer">` +
          (msgAttachments.length
            ? renderMessageAttachments(msgAttachments)
            : "") +
          `<textarea class="msg-edit-input" data-index="${index}" rows="3" aria-label="Редактирование сообщения"></textarea>` +
          `<div class="msg-edit-footer">` +
          `<div class="msg-edit-footer-left">` +
          `<div class="model-picker msg-edit-model-picker" id="msgEditModelPicker">` +
          `<button type="button" class="model-trigger msg-edit-model-trigger" aria-haspopup="listbox" aria-expanded="false" title="Модель">` +
          `<span class="model-label msg-edit-model-label">${escapeHtml(
            editModelLabel
          )}</span>` +
          `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
          `</button>` +
          `<div class="model-menu msg-edit-model-menu" role="listbox" hidden></div>` +
          `</div>` +
          `</div>` +
          `<div class="msg-edit-footer-right">` +
          `<button type="button" class="primary msg-edit-save" data-index="${index}" title="Сохранить и переотправить" aria-label="Сохранить и переотправить">` +
          `<span class="material-symbols-outlined icon-send" aria-hidden="true">arrow_upward</span>` +
          `</button>` +
          `</div>` +
          `</div>` +
          `</div>`;
        const input = body.querySelector(".msg-edit-input");
        if (input) {
          input.value = editingUserText;
        }
      } else if (msgAttachments.length) {
        const attachHtml = renderMessageAttachments(msgAttachments);
        if (attachHtml) {
          body.insertAdjacentHTML("afterbegin", attachHtml);
        }
      }
      const wrap = document.createElement("div");
      wrap.className = "msg-wrap msg-wrap-user";
      if (!isEditing) {
        const actions = document.createElement("div");
        actions.className = "msg-actions";
        actions.innerHTML =
          `<button type="button" class="icon-btn msg-copy" data-index="${index}" title="Копировать" aria-label="Копировать">` +
          COPY_ICON +
          `</button>`;
        wrap.appendChild(actions);
      }
      wrap.appendChild(el);
      messagesEl.appendChild(wrap);
      keepStatusAtEnd();
      scrollToBottom();
      return el;
    }

    if (
      role === "assistant" &&
      typeof index === "number" &&
      regenAssistantIndex >= 0 &&
      index === regenAssistantIndex &&
      canRegenerate
    ) {
      const wrap = document.createElement("div");
      wrap.className = "msg-wrap msg-wrap-assistant";
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      actions.innerHTML =
        `<button type="button" class="icon-btn msg-regenerate" title="Перегенерировать последний ответ" aria-label="Перегенерировать последний ответ">` +
        REGENERATE_ICON +
        `</button>`;
      wrap.appendChild(actions);
      wrap.appendChild(el);
      messagesEl.appendChild(wrap);
      keepStatusAtEnd();
      scrollToBottom();
      return el;
    }

    messagesEl.appendChild(el);
    keepStatusAtEnd();
    scrollToBottom();
    return el;
  }

  function renderMessages(list) {
    messagesEl.innerHTML = "";
    uiMessagesCache = Array.isArray(list) ? list : [];
    if (!Array.isArray(list)) {
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
        item.attachments
      );
    }
    restoreAgentStatus();
    focusEditingInput();
    if (chatSearchOpen && chatSearchInput) {
      applyInChatSearchHighlights(chatSearchInput.value);
    }
  }

  function getSelectedModel() {
    return selectedModelId;
  }

  function updateTriggerLabel() {
    const model = models.find((m) => m.id === selectedModelId);
    modelLabel.textContent = model
      ? model.label || model.id
      : selectedModelId || "Нет моделей";
  }

  function stripPendingImagesIfNeeded(notify) {
    const before = pendingAttachments.length;
    if (currentModelSupportsVision()) {
      return;
    }
    pendingAttachments = pendingAttachments.filter((a) => a.kind !== "image");
    if (pendingAttachments.length < before) {
      renderAttachPreview();
      if (notify) {
        showCopyToast("Модель не поддерживает изображения");
      }
    }
  }

  function updateVisionUi() {
    stripPendingImagesIfNeeded(true);
    const visionOk = currentModelSupportsVision();
    if (!composerPlusMenu) {
      return;
    }
    const imageItem = composerPlusMenu.querySelector(
      '.composer-plus-item[data-action="image"]'
    );
    if (!imageItem) {
      return;
    }
    imageItem.disabled = !visionOk;
    imageItem.classList.toggle("is-disabled", !visionOk);
    imageItem.setAttribute("aria-disabled", visionOk ? "false" : "true");
    imageItem.title = visionOk
      ? "Прикрепить изображение"
      : "Текущая модель не поддерживает изображения";
  }

  function setSelectedModel(id, notify) {
    selectedModelId = id || "";
    state.selectedModel = selectedModelId;
    vscode.setState(state);
    updateTriggerLabel();
    updateVisionUi();
    if (menuOpen) {
      renderMenu();
    }
    if (notify && selectedModelId) {
      vscode.postMessage({ type: "modelChanged", model: selectedModelId });
    }
  }

  function renderMenu() {
    modelMenu.innerHTML = "";
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = "Нет моделей в настройках";
      modelMenu.appendChild(empty);
      return;
    }

    for (const model of models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (model.id === selectedModelId ? " is-active" : "");
      btn.setAttribute("role", "option");
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
    if (busy) {
      return;
    }
    closePlusMenu();
    menuOpen = true;
    renderMenu();
    modelPicker.classList.add("is-open");
    modelTrigger.setAttribute("aria-expanded", "true");
    modelMenu.hidden = false;
  }

  function closeMenu() {
    menuOpen = false;
    modelPicker.classList.remove("is-open");
    modelTrigger.setAttribute("aria-expanded", "false");
    modelMenu.hidden = true;
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
  }

  function openPlusMenu() {
    closeMenu();
    closeModeMenu();
    closeEditModelMenu();
    plusMenuOpen = true;
    if (composerPlusEl) {
      composerPlusEl.classList.add("is-open");
    }
    if (composerPlusBtn) {
      composerPlusBtn.setAttribute("aria-expanded", "true");
    }
    if (composerPlusMenu) {
      composerPlusMenu.hidden = false;
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
    for (const mode of modes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (mode.id === agentMode ? " is-active" : "");
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
    addLabel.textContent = "+ Добавить режим";
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
  }

  function openModeMenu() {
    closeMenu();
    closePlusMenu();
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
    }
  }

  function toggleModeMenu() {
    if (modeMenuOpen) {
      closeModeMenu();
    } else {
      openModeMenu();
    }
  }

  function setAgentMode(next, { focus = false, close = true } = {}) {
    agentMode = normalizeAgentModeUi(next);
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const meta = modes.find((m) => m.id === agentMode) || modes[0] || {
      id: "agent",
      label: "Агент",
      placeholder: "Задача для агента... (@ — файл)",
    };
    if (modePicker) {
      modePicker.dataset.mode = agentMode;
    }
    if (modeLabel) {
      modeLabel.textContent = meta.label || meta.id;
    }
    if (modeTrigger) {
      modeTrigger.title = meta.description
        ? `${meta.label}: ${meta.description}`
        : meta.label || "Режим";
    }
    if (modeMenu && !modeMenu.hidden) {
      renderModeMenu();
    }
    if (promptEl) {
      promptEl.placeholder =
        meta.placeholder || "Задача для агента... (@ — файл)";
    }
    if (close) {
      closeModeMenu();
    }
    if (focus && promptEl && typeof promptEl.focus === "function") {
      promptEl.focus();
    }
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    promptEl.disabled = busy;
    modelTrigger.disabled = busy;
    if (composerPlusBtn) {
      composerPlusBtn.disabled = busy;
    }
    if (modeTrigger) {
      modeTrigger.disabled = busy;
    }
    if (busy) {
      closeMenu();
      closePlusMenu();
      closeModeMenu();
      closeMentionMenu();
    }
    sendBtn.dataset.mode = busy ? "stop" : "send";
    sendBtn.title = busy ? "Остановить" : "Отправить";
    sendBtn.setAttribute("aria-label", busy ? "Остановить" : "Отправить");
    sendBtn.classList.toggle("is-stop", busy);
    if (!busy) {
      focusPrompt();
    }
  }

  function fillModels(nextModels, preferredId) {
    const incoming = Array.isArray(nextModels) ? nextModels : [];
    models = incoming.length ? incoming : DEFAULT_MODELS.slice();
    const preferred =
      preferredId ||
      selectedModelId ||
      state.selectedModel ||
      models[0]?.id ||
      "";
    const exists = models.some((m) => m.id === preferred);
    setSelectedModel(exists ? preferred : models[0]?.id || "", false);
  }

  // сразу показать модель, не дожидаясь init
  fillModels(DEFAULT_MODELS, selectedModelId);

  function selectModelById(id) {
    if (!id || busy) {
      return;
    }
    setSelectedModel(id, true);
    closeMenu();
  }

  modelTrigger.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  modelTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) {
      return;
    }
    toggleMenu();
  });

  modelMenu.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const option = event.target.closest(".model-option");
    if (!option || option.classList.contains("is-empty")) {
      return;
    }
    selectModelById(option.dataset.id);
  });

  modelMenu.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  document.addEventListener("mousedown", (event) => {
    if (menuOpen && !modelPicker.contains(event.target)) {
      closeMenu();
    }
    if (
      plusMenuOpen &&
      composerPlusEl &&
      !composerPlusEl.contains(event.target)
    ) {
      closePlusMenu();
    }
    if (
      modeMenuOpen &&
      modePicker &&
      !modePicker.contains(event.target)
    ) {
      closeModeMenu();
    }
    if (
      mentionOpen &&
      mentionMenuEl &&
      !mentionMenuEl.contains(event.target) &&
      event.target !== mentionTarget
    ) {
      closeMentionMenu();
    }
    if (editModelMenuOpen) {
      const picker = getEditModelPicker();
      if (!picker || !picker.contains(event.target)) {
        closeEditModelMenu();
      }
    }
    if (Number.isInteger(editingUserIndex) && !busy) {
      const composer = messagesEl.querySelector(".msg-edit-composer");
      if (composer && !composer.contains(event.target)) {
        cancelEditingUserMessage();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
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
    if (event.key === "Escape" && editModelMenuOpen) {
      closeEditModelMenu();
    }
  });


  function sendPrompt() {
    const text = promptEl.value.trim();
    const attachments = pendingAttachments.slice();
    if ((!text && !attachments.length) || busy) {
      return;
    }
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingAttachments = [];
    uiMessagesCache.push({ role: "user", text, attachments });
    appendMessage("user", text, uiMessagesCache.length - 1, -1, attachments);
    promptEl.value = "";
    clearPendingAttachments();
    closeMentionMenu();
    setBusy(true);
    vscode.postMessage({
      type: "send",
      text,
      model: getSelectedModel(),
      agentMode,
      attachments: attachments.map(attachmentPayload),
    });
  }

  sendBtn.addEventListener("click", () => {
    if (busy) {
      vscode.postMessage({ type: "stop" });
      return;
    }
    sendPrompt();
  });

  if (composerPlusBtn) {
    composerPlusBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) {
        return;
      }
      togglePlusMenu();
    });
  }

  if (modeTrigger) {
    modeTrigger.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    modeTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) {
        return;
      }
      toggleModeMenu();
    });
  }

  if (modeMenu) {
    modeMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
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
      if (!option || busy || option.dataset.action === "add-mode") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setAgentMode(option.dataset.mode, { focus: true });
    });
  }

  setAgentMode(agentMode, { close: false });
  renderModeMenu();

  if (composerPlusMenu) {
    composerPlusMenu.addEventListener("click", (event) => {
      const item = event.target.closest(".composer-plus-item");
      if (!item || busy || item.disabled || item.classList.contains("is-disabled")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = item.getAttribute("data-action");
      closePlusMenu();
      if (action === "image") {
        if (!currentModelSupportsVision()) {
          showCopyToast("Модель не поддерживает изображения");
          return;
        }
        vscode.postMessage({ type: "pickAttachments", imagesOnly: true });
      }
    });
  }

  if (attachPreviewEl) {
    attachPreviewEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".attach-chip-remove");
      if (!btn) {
        return;
      }
      event.preventDefault();
      removePendingAttachment(btn.getAttribute("data-id"));
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
      if (busy) {
        return;
      }
      const uris = extractDropUris(event.dataTransfer);
      if (uris.length) {
        vscode.postMessage({ type: "attachUris", uris });
        return;
      }
      if (event.dataTransfer?.files?.length) {
        void ingestDroppedFiles(event.dataTransfer.files);
        return;
      }
      showCopyToast("Не удалось прочитать файл");
    });
  }

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
    if (busy || !chatScreen || chatScreen.hidden) {
      return;
    }
    let imageFiles = extractClipboardImages(event.clipboardData);
    if (!imageFiles.length) {
      imageFiles = await readClipboardImagesFallback();
    }
    if (!imageFiles.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!currentModelSupportsVision()) {
      showCopyToast("Модель не поддерживает изображения");
      return;
    }
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
    if (!isPaste || busy || !chatScreen || chatScreen.hidden) {
      return;
    }
    // Если фокус не в поле ввода — всё равно даём шанс прочитать буфер
    const active = document.activeElement;
    const inPrompt = active === promptEl;
    if (inPrompt) {
      return;
    }
    void (async () => {
      const imageFiles = await readClipboardImagesFallback();
      if (!imageFiles.length) {
        return;
      }
      if (!currentModelSupportsVision()) {
        showCopyToast("Модель не поддерживает изображения");
        return;
      }
      event.preventDefault();
      await ingestDroppedFiles(imageFiles);
      if (promptEl && typeof promptEl.focus === "function") {
        promptEl.focus();
      }
    })();
  });

  if (newAgentBtn) {
    newAgentBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "newAgent" });
    });
  }

  if (openArchiveBtn) {
    openArchiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showArchive" });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showSettings" });
    });
  }

  if (backFromArchiveBtn) {
    backFromArchiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showAgents" });
    });
  }

  if (backFromSettingsBtn) {
    backFromSettingsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showAgents" });
    });
  }

  const settingsBody = document.getElementById("settingsBody");
  if (settingsBody) {
    settingsBody.addEventListener("scroll", hideSettingsModelTip, { passive: true });
    settingsBody.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest(
          "#settingsCaBundle, #settingsSystemPrompt, #settingsMaxToolRounds, #settingsMaxTokens, #settingsMaxResponseChars"
        )
      ) {
        schedulePersistSettings();
      }
    });
    settingsBody.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.closest("#settingsRejectUnauthorized")) {
        persistSettingsNow();
      }
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

  if (settingsProvidersList) {
    settingsProvidersList.addEventListener("click", (event) => {
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

  if (settingsDefaultModel) {
    settingsDefaultModel.addEventListener("change", () => {
      settingsDefaultModelId = settingsDefaultModel.value;
      schedulePersistSettings(0);
    });
  }

  if (backToAgentsBtn) {
    backToAgentsBtn.addEventListener("click", () => {
      if (busy) {
        return;
      }
      vscode.postMessage({ type: "showAgents" });
    });
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
    archiveListEl.addEventListener("click", (event) => {
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          vscode.postMessage({
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
        vscode.postMessage({
          type: "restoreAgent",
          agentId: restoreBtn.dataset.restoreAgent,
        });
      }
    });
  }

  if (agentsListEl) {
    agentsListEl.addEventListener("click", (event) => {
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          vscode.postMessage({
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
          vscode.postMessage({
            type: "archiveAgent",
            agentId: archiveBtn.dataset.archiveAgent,
          });
        }
        return;
      }
      const nameEl = event.target.closest(".agent-name");
      if (nameEl && agentsListEl.contains(nameEl)) {
        event.preventDefault();
        event.stopPropagation();
        const block = nameEl.closest("[data-agent]");
        const agentId = block ? block.dataset.agent : "";
        if (agentId) {
          startAgentRename(agentId, nameEl);
        }
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (agentRow) {
        event.preventDefault();
        vscode.postMessage({
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
      vscode.postMessage({
        type: "openAgent",
        agentId: agentRow.dataset.agent,
      });
    });
  }

  if (chatAgentNameEl) {
    chatAgentNameEl.title = "Переименовать";
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

  messagesEl.addEventListener("click", (event) => {
    const toolToggle = event.target.closest(".tool-group-toggle");
    if (toolToggle && messagesEl.contains(toolToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const group = toolToggle.closest(".tool-group");
      if (!group) {
        return;
      }
      const collapsed = group.classList.toggle("is-collapsed");
      toolToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      updateToolGroupSummary(group);
      return;
    }
    const editModelTrigger = event.target.closest(".msg-edit-model-trigger");
    if (editModelTrigger && messagesEl.contains(editModelTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      toggleEditModelMenu();
      return;
    }
    const editModelOption = event.target.closest(
      ".msg-edit-model-menu .model-option"
    );
    if (editModelOption && messagesEl.contains(editModelOption)) {
      event.preventDefault();
      event.stopPropagation();
      if (!editModelOption.classList.contains("is-empty")) {
        selectEditingModel(editModelOption.dataset.id);
      }
      return;
    }
    const saveEditBtn = event.target.closest(".msg-edit-save");
    if (saveEditBtn && messagesEl.contains(saveEditBtn)) {
      event.preventDefault();
      event.stopPropagation();
      submitEditedUserMessage();
      return;
    }
    const regenBtn = event.target.closest(".msg-regenerate");
    if (regenBtn && messagesEl.contains(regenBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (busy || !canRegenerate) {
        return;
      }
      setBusy(true);
      vscode.postMessage({ type: "regenerate", agentMode });
      return;
    }
    const copyCodeBtn = event.target.closest(".md-pre-copy");
    if (copyCodeBtn && messagesEl.contains(copyCodeBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const wrap = copyCodeBtn.closest(".md-pre-wrap");
      const code = wrap ? wrap.querySelector("code") : null;
      const text = code ? code.textContent || "" : "";
      requestCopyText(text);
      return;
    }
    const copyMsgBtn = event.target.closest(".msg-copy");
    if (copyMsgBtn && messagesEl.contains(copyMsgBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const wrap = copyMsgBtn.closest(".msg-wrap");
      const msg = wrap
        ? wrap.querySelector(".msg")
        : copyMsgBtn.closest(".msg");
      const text = msg ? msg.dataset.raw || "" : "";
      requestCopyText(text);
      return;
    }
    const mentionBtn = event.target.closest(".msg-mention");
    if (mentionBtn && messagesEl.contains(mentionBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const path = mentionBtn.getAttribute("data-path");
      if (path) {
        vscode.postMessage({ type: "openFile", path });
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
        vscode.postMessage({ type: "openFile", path });
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
      vscode.postMessage({ type: "openExternal", url: href });
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
    if (event.key === "Escape" && editModelMenuOpen) {
      event.preventDefault();
      closeEditModelMenu();
    }
  });

  promptEl.addEventListener("input", () => {
    onMentionInput(promptEl);
  });

  promptEl.addEventListener("keydown", (event) => {
    if (onMentionKeydown(event, promptEl)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });

  if (mentionMenuEl) {
    mentionMenuEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
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

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        fillModels(msg.models, msg.selectedModel);
        if (msg.modes) {
          applyModes(msg.modes);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingAttachments = [];
        clearPendingAttachments();
        setCanRegenerate(msg.canRegenerate);
        renderMessages(msg.uiMessages || []);
        if (msg.agentId) {
          activeAgentId = msg.agentId;
        }
        if (chatAgentNameEl && msg.agentName && renamingAgentId !== activeAgentId) {
          chatAgentNameEl.textContent = msg.agentName;
        }
        if (chatTitleEl && msg.chatTitle) {
          chatTitleEl.textContent = msg.chatTitle;
        }
        if (msg.contextMax !== undefined || msg.contextUsed !== undefined) {
          setContextUsage(msg.contextUsed || 0, msg.contextMax || contextMax);
        }
        showScreen(msg.screen || "agents");
        setBusy(false);
        break;
      case "attachmentsAdded":
        mergePendingAttachments(msg.attachments || []);
        break;
      case "fileSearchResults":
        handleMentionResults(msg);
        break;
      case "chatSearchResults":
        if (
          !chatSearchOpen ||
          (chatSearchPendingRequestId &&
            msg.requestId &&
            msg.requestId !== chatSearchPendingRequestId)
        ) {
          break;
        }
        renderChatSearchResults(
          msg.hits || [],
          chatSearchInput ? chatSearchInput.value : ""
        );
        break;
      case "agentsList":
        agentsData = Array.isArray(msg.agents) ? msg.agents : [];
        {
          const active = agentsData.find((a) => a.active);
          if (active) {
            activeAgentId = active.id;
          }
        }
        renderAgentsList();
        if (msg.screen === "agents" || msg.screen === "chat") {
          showScreen(msg.screen);
        }
        break;
      case "archiveList":
        archiveAgentsData = Array.isArray(msg.agents) ? msg.agents : [];
        renderArchiveList();
        showScreen("archive");
        setBusy(false);
        break;
      case "showAgents":
        showScreen("agents");
        setBusy(false);
        break;
      case "showArchive":
        showScreen("archive");
        setBusy(false);
        break;
      case "showSettings":
        showScreen("settings");
        setBusy(false);
        break;
      case "settings":
        fillSettings(msg.settings);
        showScreen("settings");
        setBusy(false);
        break;
      case "showChat":
        if (msg.models) {
          fillModels(msg.models, msg.selectedModel);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        setCanRegenerate(msg.canRegenerate);
        if (msg.uiMessages) {
          renderMessages(msg.uiMessages);
        }
        if (msg.agentId) {
          activeAgentId = msg.agentId;
        }
        if (
          chatAgentNameEl &&
          msg.agentName &&
          renamingAgentId !== activeAgentId
        ) {
          chatAgentNameEl.textContent = msg.agentName;
        }
        if (chatTitleEl && msg.chatTitle) {
          chatTitleEl.textContent = msg.chatTitle;
        }
        if (msg.contextMax !== undefined || msg.contextUsed !== undefined) {
          setContextUsage(msg.contextUsed || 0, msg.contextMax || contextMax);
        }
        showScreen("chat");
        setBusy(false);
        {
          const highlight =
            typeof msg.highlightMessageIndex === "number"
              ? msg.highlightMessageIndex
              : pendingHighlightIndex;
          pendingHighlightIndex = null;
          if (pendingOpenSearch) {
            const opts = pendingOpenSearch;
            pendingOpenSearch = null;
            openChatSearch(opts);
          } else if (typeof highlight === "number") {
            requestAnimationFrame(() => {
              highlightMessageByIndex(highlight);
            });
          }
        }
        break;
      case "agentRenamed":
        if (msg.agentId && msg.name) {
          const item = agentsData.find((a) => a.id === msg.agentId);
          if (item) {
            item.name = msg.name;
          }
          if (msg.agentId === activeAgentId && chatAgentNameEl) {
            if (renamingAgentId !== msg.agentId) {
              chatAgentNameEl.textContent = msg.name;
            }
          }
          if (renamingAgentId !== msg.agentId) {
            renderAgentsList();
          }
        }
        break;
      case "contextUsage":
        setContextUsage(msg.used || 0, msg.max || contextMax);
        break;
      case "modelsUpdated":
        fillModels(msg.models, getSelectedModel() || msg.selectedModel);
        break;
      case "modesUpdated":
        applyModes(msg.modes);
        break;
      case "regenerateState":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel);
        }
        setCanRegenerate(msg.canRegenerate);
        ensureRegenerateButton();
        break;
      case "messagesReplaced":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingAttachments = [];
        setCanRegenerate(msg.canRegenerate);
        renderMessages(msg.uiMessages || []);
        break;
      case "copied":
        showCopyToast("Скопировано");
        break;
      case "append":
        uiMessagesCache.push({
          role: msg.role,
          text: msg.text,
          attachments: msg.attachments,
        });
        appendMessage(
          msg.role,
          msg.text,
          uiMessagesCache.length - 1,
          -1,
          msg.attachments
        );
        break;
      case "status":
        setAgentStatus(msg.text || "", Boolean(msg.hidden), msg.phase);
        break;
      case "review":
        uiMessagesCache.push({
          role: "review",
          text: JSON.stringify({ files: msg.files || [], showScm: msg.showScm }),
        });
        appendReview(msg.files || [], msg.showScm);
        break;
      case "scmButtons":
        applyScmButtons(msg.reviews || []);
        break;
      case "assistantDelta":
        if (!streamingEl) {
          streamingEl = appendMessage("assistant", "");
          streamingEl.dataset.raw = "";
        }
        streamingEl.dataset.raw = (streamingEl.dataset.raw || "") + msg.text;
        setMessageContent(streamingEl, "assistant", streamingEl.dataset.raw);
        scrollToBottom();
        break;
      case "assistantDone":
        if (!streamingEl && msg.text) {
          uiMessagesCache.push({ role: "assistant", text: msg.text });
          appendMessage("assistant", msg.text);
        } else if (streamingEl) {
          const raw = msg.text || streamingEl.dataset.raw || "";
          setMessageContent(streamingEl, "assistant", raw);
          uiMessagesCache.push({ role: "assistant", text: raw });
        }
        streamingEl = null;
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        setBusy(false);
        ensureRegenerateButton();
        break;
      case "idle":
        streamingEl = null;
        setAgentStatus("", true);
        setBusy(false);
        break;
      case "stopped":
        streamingEl = null;
        setAgentStatus("", true);
        setBusy(false);
        break;
      case "cleared":
        messagesEl.innerHTML = "";
        uiMessagesCache = [];
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        streamingEl = null;
        setAgentStatus("", true);
        setContextUsage(0, contextMax);
        setBusy(false);
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
  setContextUsage(0, contextMax);

  // если init потерялся — перезапросим модели
  setTimeout(() => {
    if (!models.length) {
      vscode.postMessage({ type: "ready" });
    }
  }, 400);
})();

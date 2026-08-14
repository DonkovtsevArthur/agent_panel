  function showSettingsCategory(category) {
    const allowed = [
      "models",
      "modes",
      "language",
      "appearance",
      "commit",
      "mcp",
      "skills",
      "browser",
      "agent",
      "advanced",
    ];
    const cat = allowed.includes(category) ? category : "models";
    const nav = document.getElementById("settingsNav");
    if (nav) {
      nav.querySelectorAll(".settings-nav-item").forEach((btn) => {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-settings-cat") === cat
        );
      });
    }
    document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-settings-panel") !== cat;
    });
    mcpScreenOpen = cat === "mcp";
    if (cat === "mcp") {
      renderMcpServersList();
      host.postMessage({ type: "figmaRefreshStatus" });
      host.postMessage({ type: "mcpRefreshList" });
    } else {
      closeMcpEditModal();
      closeMcpCustomEditModal();
    }
    if (cat === "skills") {
      renderSkillsSettings();
      host.postMessage({ type: "skillsRefreshList" });
    }
    if (settingsBody) {
      settingsBody.scrollTop = 0;
    }
  }

  function syncAgentsRailToggleUi() {
    if (!toggleAgentsRailBtn) {
      return;
    }
    const label = agentsRailOpen ? t("hideAgentsList") : t("showAgentsList");
    toggleAgentsRailBtn.title = label;
    toggleAgentsRailBtn.setAttribute("aria-label", label);
    toggleAgentsRailBtn.setAttribute(
      "aria-pressed",
      agentsRailOpen ? "true" : "false"
    );
    const icon = toggleAgentsRailBtn.querySelector(".material-symbols-outlined");
    if (icon) {
      icon.textContent = agentsRailOpen ? "menu_open" : "menu";
    }
  }

  function persistAgentsRailOpen() {
    state.agentsRailOpen = agentsRailOpen;
    host.setState(state);
  }

  function applyAgentsRailVisibility() {
    if (workspaceShell) {
      workspaceShell.classList.toggle("is-rail-open", agentsRailOpen);
      workspaceShell.classList.toggle("is-narrow", workspaceNarrow);
    }
    if (agentsScreen) {
      agentsScreen.hidden = !(currentScreen === "chat" && agentsRailOpen);
    }
    if (agentsRailBackdrop) {
      agentsRailBackdrop.hidden = !(
        currentScreen === "chat" &&
        agentsRailOpen &&
        workspaceNarrow
      );
    }
    syncAgentsRailToggleUi();
  }

  function setAgentsRailOpen(open, opts) {
    const next = Boolean(open);
    if (agentsRailOpen === next && !(opts && opts.force)) {
      applyAgentsRailVisibility();
      return;
    }
    agentsRailOpen = next;
    persistAgentsRailOpen();
    applyAgentsRailVisibility();
  }

  function updateWorkspaceNarrow() {
    if (!workspaceShell) {
      return;
    }
    const width = workspaceShell.getBoundingClientRect().width;
    const nextNarrow = width > 0 && width < 600;
    if (nextNarrow === workspaceNarrow) {
      return;
    }
    workspaceNarrow = nextNarrow;
    applyAgentsRailVisibility();
  }

  /** On narrow panels, collapse model + intelligence chips to icons so they
   *  never get clipped off the composer's right edge. */
  function updateComposerCompact() {
    if (!composerEl) {
      return;
    }
    const w = composerEl.getBoundingClientRect().width;
    composerEl.classList.toggle("is-compact", w > 0 && w < 360);
  }

  function showScreen(name) {
    let screen =
      name === "chat" ||
      name === "archive" ||
      name === "settings" ||
      name === "mcp"
        ? name
        : "agents";
    if (screen === "agents") {
      setAgentsRailOpen(true);
      screen = "chat";
    }
    currentScreen = screen;
    const settingsVisible = screen === "settings" || screen === "mcp";
    mcpScreenOpen = screen === "mcp";
    if (workspaceShell) {
      workspaceShell.hidden = screen !== "chat";
    }
    if (screen === "chat") {
      updateComposerCompact();
    }
    if (archiveScreen) {
      archiveScreen.hidden = screen !== "archive";
    }
    if (settingsScreen) {
      settingsScreen.hidden = !settingsVisible;
    }
    if (mcpScreen) {
      // Modals only — never show as a full screen.
      mcpScreen.hidden = true;
    }
    if (chatScreen) {
      chatScreen.hidden = screen !== "chat";
    }
    applyAgentsRailVisibility();
    if (screen === "chat") {
      setContextUsage(contextUsed, contextMax);
      if (!chatSearchOpen) {
        focusPrompt();
      }
      updateWorkspaceNarrow();
    }
    if (settingsVisible) {
      showSettingsCategory(screen === "mcp" ? "mcp" : "models");
    } else {
      closeMcpEditModal();
      closeMcpCustomEditModal();
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
        `<div class="chat-search-empty">${t("nothingFound")}</div>`;
      return;
    }

    chatSearchResults.innerHTML = chatSearchHits
      .map((hit, index) => {
        const roleLabel = hit.role === "user" ? t("you") : t("agent");
        return (
          `<button type="button" class="chat-search-hit${
            index === chatSearchActiveIndex ? " is-active" : ""
          }" role="option" data-index="${index}">` +
          `<div class="chat-search-hit-meta">` +
          `<span class="chat-search-hit-role">${escapeHtml(roleLabel)}</span>` +
          `<span class="chat-search-hit-agent">${escapeHtml(
            hit.agentName || t("agent")
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
    host.postMessage({
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
    if (
      hit.agentId === activeAgentId &&
      (!hit.chatId || hit.chatId === activeChatId) &&
      chatScreen &&
      !chatScreen.hidden
    ) {
      highlightMessageByIndex(messageIndex);
      return;
    }
    pendingHighlightIndex = messageIndex;
    const payload = {
      type: "openSearchHit",
      agentId: hit.agentId,
      messageIndex,
    };
    if (hit.chatId) {
      payload.chatId = hit.chatId;
    }
    host.postMessage(payload);
  }

  function openChatSearch(opts) {
    if (!chatSearchPanel) {
      return;
    }
    const fromAgents = Boolean(opts && opts.fromAgents);
    if (chatScreen && chatScreen.hidden) {
      pendingOpenSearch = opts || { fromAgents: true };
      if (activeAgentId) {
        host.postMessage({ type: "openAgent", agentId: activeAgentId });
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


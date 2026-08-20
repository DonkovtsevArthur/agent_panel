    input.addEventListener("input", fitInputWidth);
  }

    function focusPrompt() {
    requestAnimationFrame(() => {
      promptEl.focus();
    });
  }

  function insertComposerText(text) {
    if (!promptEl) {
      return;
    }
    const snippet = String(text || "");
    if (!snippet) {
      return;
    }
    showScreen("chat");
    const cur = promptEl.value || "";
    const start =
      typeof promptEl.selectionStart === "number"
        ? promptEl.selectionStart
        : cur.length;
    const end =
      typeof promptEl.selectionEnd === "number"
        ? promptEl.selectionEnd
        : start;
    const before = cur.slice(0, start);
    const after = cur.slice(end);
    let padBefore = "";
    if (before.length && !/\n$/.test(before)) {
      padBefore = "\n\n";
    } else if (before.length && !/\n\n$/.test(before) && before.endsWith("\n")) {
      padBefore = "\n";
    }
    const padAfter = after.length && !after.startsWith("\n") ? "\n" : "";
    const next = before + padBefore + snippet + padAfter + after;
    const caret = (before + padBefore + snippet).length;
    promptEl.value = next;
    promptEl.disabled = false;
    promptEl.focus();
    promptEl.setSelectionRange(caret, caret);
    promptEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** Вставить @path упоминания в composer чипами (как в пузыре пользователя). */
  function insertComposerMentions(paths) {
    const list = (Array.isArray(paths) ? paths : [])
      .map((p) => String(p || "").trim().replace(/^@+/, ""))
      .filter(Boolean);
    if (!list.length) {
      return;
    }
    showScreen("chat");
    for (const path of list) {
      addPendingMention(path);
    }
    if (promptEl) {
      promptEl.disabled = false;
      promptEl.focus();
    }
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
    title.textContent = `Changed files: ${list.length} · +${totalAdd} −${totalDel}`;
    card.appendChild(title);

    const fileList = document.createElement("div");
    fileList.className = "review-files";
    for (const file of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "review-file";
      row.title = t("openChanges");
      row.innerHTML =
        `<span class="review-file-path"></span>` +
        `<span class="review-file-stats">` +
        `<span class="add">+${file.added || 0}</span> ` +
        `<span class="del">−${file.removed || 0}</span>` +
        `</span>`;
      row.querySelector(".review-file-path").textContent = file.path;
      row.addEventListener("click", () => {
        host.postMessage({ type: "openFileDiff", path: file.path });
      });
      fileList.appendChild(row);
    }
    card.appendChild(fileList);
    card.dataset.paths = list.map((f) => f.path).join("\n");
    const mount = ensureChatTurn();
    mount.appendChild(card);
    setComposerScmActions(list, Boolean(parsed.showScm));
    syncComposerPlanFromCache({ openEditor: false });
    keepStatusAtEnd();
    scrollToBottom();
  }

  /**
   * Strip Build handoff chrome ([[harbor:implement_plan]] + implement prefix)
   * so plan cards / Plan.md show only the plan markdown.
   */
  function stripPlanImplementWrapper(text) {
    let value = String(text || "")
      .replace(/^\uFEFF/, "")
      .trim();
    if (!value) {
      return "";
    }
    value = value.replace(/\[\[harbor:implement_plan\]\]\s*/gi, "");
    value = value.replace(
      /^(?:Implement the following plan(?:\s+exactly)?[^\n]*|Реализуй следующий план(?:\s+точно)?[^\n]*)\s*/i,
      ""
    );
    return value.trim();
  }

  function looksLikePlanImplementDisplay(text) {
    const value = String(text || "").trim();
    if (!value) {
      return false;
    }
    if (/\[\[harbor:implement_plan\]\]/i.test(value)) {
      return true;
    }
    return /^(?:Implement the following plan|Реализуй следующий план)/i.test(
      value
    );
  }

  /**
   * Inner body of the latest <proposed_plan>…</proposed_plan>.
   * Also recovers truncated plans (open tag, no close) — same as the plan card
   * — so composer «Собрать» still appears when maxResponseChars cut the close tag.
   */
  function extractLatestProposedPlan(raw) {
    const text = String(raw || "");
    const re =
      /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*?)\s*(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/gi;
    let last = "";
    let match;
    while ((match = re.exec(text)) !== null) {
      last = String(match[1] || "").trim();
    }
    if (!last) {
      const openRe =
        /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*)/i;
      const openMatch = openRe.exec(text);
      if (openMatch) {
        last = String(openMatch[1] || "")
          .replace(/\n*\[ответ обрезан[^\]]*\]\s*$/i, "")
          .trim();
      }
    }
    return stripPlanImplementWrapper(last);
  }

  let livePlanBuildRequestId = 0;

  function sendImplementPlanWithText(planText) {
    const text = stripPlanImplementWrapper(planText);
    if (!text || busy) {
      return;
    }
    const payload =
      `[[harbor:implement_plan]]\n${t("proposedPlanImplementPrefix")}\n\n${text}`;
    setAgentMode("agent", { notify: true });
    stickToBottom = true;
    // Mirror sendPrompt: keep implement handoff in local cache so Build stays
    // hidden after syncComposerPlanFromCache / history re-renders.
    uiMessagesCache.push({ role: "user", text: payload, attachments: [] });
    appendMessage("user", payload, uiMessagesCache.length - 1, -1, []);
    setBusy(true);
    setComposerPlanBuild("", false);
    host.postMessage({
      type: "send",
      text: payload,
      model: getSelectedModel(),
      agentMode: "agent",
      reasoningEffort: selectedReasoningEffort || undefined,
      attachments: [],
    });
  }

  /** Build: prefer live editable Plan.md (incl. unsaved edits), else card text. */
  function sendImplementPlan(planText) {
    if (busy) {
      return;
    }
    const fallback = stripPlanImplementWrapper(planText || pendingPlanText);
    livePlanBuildRequestId += 1;
    const requestId = `plan-build-${livePlanBuildRequestId}`;
    host.postMessage({
      type: "requestLivePlanForBuild",
      requestId,
      fallbackText: fallback,
    });
  }

  function setComposerPlanBuild(planText, show) {
    if (!composerPlanActionsEl) {
      return;
    }
    const text = stripPlanImplementWrapper(planText);
    composerPlanActionsEl.replaceChildren();
    if (!show || !text) {
      composerPlanActionsEl.hidden = true;
      pendingPlanText = "";
      return;
    }
    pendingPlanText = text;
    composerPlanActionsEl.hidden = false;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "composer-plan-build";
    btn.title = t("proposedPlanBuild");
    btn.disabled = busy;
    btn.innerHTML =
      `<span class="material-symbols-outlined" aria-hidden="true">construction</span>` +
      `<span>${escapeHtml(t("proposedPlanBuild"))}</span>`;
    btn.addEventListener("click", () => {
      sendImplementPlan(pendingPlanText);
    });
    composerPlanActionsEl.appendChild(btn);
  }

  function precedingUserIndex(list, index) {
    for (let j = index - 1; j >= 0; j--) {
      if (list[j]?.role === "user") {
        return j;
      }
    }
    return -1;
  }

  /**
   * True when this assistant "plan" is the recap of an already-executed plan
   * (Build handoff, or a review/file-edit turn before the finale).
   */
  function assistantPlanIsExecutedRecap(list, planIndex) {
    const userIndex = precedingUserIndex(list, planIndex);
    if (userIndex < 0) {
      return false;
    }
    if (looksLikePlanImplementDisplay(list[userIndex].text)) {
      return true;
    }
    for (let j = userIndex + 1; j < planIndex; j++) {
      if (list[j]?.role === "review") {
        return true;
      }
    }
    return false;
  }

  /** True when Build already ran, or files were edited, after this plan. */
  function planAlreadyImplementedAfter(list, planIndex) {
    for (let j = planIndex + 1; j < list.length; j++) {
      const item = list[j];
      if (item?.role === "user" && looksLikePlanImplementDisplay(item.text)) {
        return true;
      }
      if (item?.role === "review") {
        return true;
      }
    }
    return false;
  }

  function planIsAlreadyExecuted(list, planIndex) {
    return (
      assistantPlanIsExecutedRecap(list, planIndex) ||
      planAlreadyImplementedAfter(list, planIndex)
    );
  }

  /**
   * When a complete proposed_plan is available: show composer Build tag and
   * sync the live editable Plan.md tab (reveal "editor"). Card «Open in tab»
   * can still open markdown preview. Skip if this plan is already executed.
   */
  function presentProposedPlan(
    raw,
    { openEditor = false, forceOpen = false, reveal = "editor" } = {}
  ) {
    const plan = extractLatestProposedPlan(raw);
    if (!plan) {
      return false;
    }
    const list = Array.isArray(uiMessagesCache) ? uiMessagesCache : [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (
        list[i]?.role === "assistant" &&
        extractLatestProposedPlan(list[i].text) === plan
      ) {
        if (planIsAlreadyExecuted(list, i)) {
          setComposerPlanBuild("", false);
          return false;
        }
        break;
      }
    }
    setComposerPlanBuild(plan, true);
    if (openEditor) {
      const key = plan.replace(/\s+/g, " ").trim();
      if (forceOpen || key !== lastOpenedPlanKey) {
        lastOpenedPlanKey = key;
        host.postMessage({
          type: "openPlanMarkdown",
          text: plan,
          reveal: reveal === "preview" ? "preview" : "editor",
        });
      }
    }
    return true;
  }

  function syncComposerPlanFromCache({ openEditor = false } = {}) {
    const list = Array.isArray(uiMessagesCache) ? uiMessagesCache : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item?.role !== "assistant") {
        continue;
      }
      const plan = extractLatestProposedPlan(item.text);
      if (!plan) {
        continue;
      }
      if (planIsAlreadyExecuted(list, i)) {
        continue;
      }
      presentProposedPlan(item.text, { openEditor });
      return;
    }
    setComposerPlanBuild("", false);
    lastOpenedPlanKey = "";
  }

  function setComposerScmActions(filesOrPaths, show) {
    if (!composerScmActionsEl) {
      return;
    }
    const files = [];
    const seen = new Set();
    for (const item of Array.isArray(filesOrPaths) ? filesOrPaths : []) {
      if (!item) {
        continue;
      }
      const path =
        typeof item === "string"
          ? item
          : String(item.path || "").trim();
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      files.push({
        path,
        added: Number(item.added) || 0,
        removed: Number(item.removed) || 0,
      });
    }
    composerScmActionsEl.replaceChildren();
    if (!show || !files.length) {
      composerScmActionsEl.hidden = true;
      composerScmActionsEl.dataset.paths = "";
      return;
    }

    const paths = files.map((f) => f.path);
    const totalAdd = files.reduce((s, f) => s + (f.added || 0), 0);
    const totalDel = files.reduce((s, f) => s + (f.removed || 0), 0);

    composerScmActionsEl.hidden = false;
    composerScmActionsEl.dataset.paths = paths.join("\n");

    const commitPushBtn = document.createElement("button");
    commitPushBtn.type = "button";
    commitPushBtn.className = "review-commit-push";
    commitPushBtn.title = t("commitAndPush");
    commitPushBtn.disabled = busy;
    commitPushBtn.innerHTML =
      `<span class="material-symbols-outlined" aria-hidden="true">commit</span>` +
      `<span>${escapeHtml(t("commitAndPushShort"))}</span>`;
    commitPushBtn.addEventListener("click", () => {
      if (busy) {
        return;
      }
      setBusy(true);
      host.postMessage({
        type: "commitAndPush",
        paths,
      });
    });
    composerScmActionsEl.appendChild(commitPushBtn);

    const scmBtn = document.createElement("button");
    scmBtn.type = "button";
    scmBtn.className = "review-scm-stats";
    scmBtn.title = t("openSourceControl");
    scmBtn.setAttribute("aria-label", t("openSourceControl"));
    scmBtn.innerHTML =
      `<span class="label">${escapeHtml(t("changesTag"))}</span>` +
      `<span class="add">+${totalAdd}</span>` +
      `<span class="del">−${totalDel}</span>`;
    scmBtn.addEventListener("click", () => {
      host.postMessage({ type: "openScm" });
    });
    composerScmActionsEl.appendChild(scmBtn);
  }

  function findReviewFilesByPaths(paths) {
    const wanted = [...new Set((paths || []).map(String).filter(Boolean))]
      .slice()
      .sort()
      .join("\n");
    if (!wanted) {
      return [];
    }
    const list = Array.isArray(uiMessagesCache) ? uiMessagesCache : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item?.role !== "review") {
        continue;
      }
      const parsed = parseReviewData(item.text);
      const files = Array.isArray(parsed.files) ? parsed.files : [];
      const key = files
        .map((f) => String(f.path || ""))
        .filter(Boolean)
        .sort()
        .join("\n");
      if (key === wanted) {
        return files;
      }
    }
    return (paths || []).map((path) => ({ path, added: 0, removed: 0 }));
  }

  function renderReviewCardBody(card, files) {
    const list = Array.isArray(files) ? files : [];
    const title = card.querySelector(".review-title");
    const fileList = card.querySelector(".review-files");
    if (!title || !fileList) {
      return;
    }
    const totalAdd = list.reduce((s, f) => s + (f.added || 0), 0);
    const totalDel = list.reduce((s, f) => s + (f.removed || 0), 0);
    title.textContent = `Changed files: ${list.length} · +${totalAdd} −${totalDel}`;
    fileList.replaceChildren();
    for (const file of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "review-file";
      row.title = t("openChanges");
      row.innerHTML =
        `<span class="review-file-path"></span>` +
        `<span class="review-file-stats">` +
        `<span class="add">+${file.added || 0}</span> ` +
        `<span class="del">−${file.removed || 0}</span>` +
        `</span>`;
      row.querySelector(".review-file-path").textContent = file.path;
      row.addEventListener("click", () => {
        host.postMessage({ type: "openFileDiff", path: file.path });
      });
      fileList.appendChild(row);
    }
    card.dataset.paths = list.map((f) => f.path).join("\n");
  }

  function syncReviewCardsFromScm(reviews) {
    const cards = Array.from(
      document.querySelectorAll(".review-card")
    );
    const entries = Array.isArray(reviews) ? reviews : [];
    const count = Math.min(cards.length, entries.length);
    for (let i = 0; i < count; i++) {
      const entry = entries[i];
      const files = Array.isArray(entry?.files) ? entry.files : [];
      if (!files.length && !(entry?.paths || []).length) {
        continue;
      }
      const nextFiles = files.length
        ? files
        : (entry.paths || []).map((path) => ({
            path,
            added: 0,
            removed: 0,
          }));
      renderReviewCardBody(cards[i], nextFiles);
    }

    // Keep cache in sync so commit tags use remaining dirty paths.
    let reviewIdx = 0;
    for (let i = 0; i < uiMessagesCache.length; i++) {
      const item = uiMessagesCache[i];
      if (item?.role !== "review") {
        continue;
      }
      const entry = entries[reviewIdx++];
      if (!entry) {
        break;
      }
      const files = Array.isArray(entry.files)
        ? entry.files
        : (entry.paths || []).map((path) => ({
            path,
            added: 0,
            removed: 0,
          }));
      uiMessagesCache[i] = {
        ...item,
        text: JSON.stringify({
          files,
          showScm: Boolean(entry.showScm),
        }),
      };
    }
  }

  function syncComposerScmFromCache() {
    const list = Array.isArray(uiMessagesCache) ? uiMessagesCache : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item?.role !== "review") {
        continue;
      }
      const parsed = parseReviewData(item.text);
      const files = Array.isArray(parsed.files) ? parsed.files : [];
      if (parsed.showScm && files.length) {
        setComposerScmActions(files, true);
        return;
      }
    }
    setComposerScmActions([], false);
  }

  function applyScmButtons(reviews) {
    const list = Array.isArray(reviews) ? reviews : [];
    syncReviewCardsFromScm(list);
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      const files = Array.isArray(entry?.files)
        ? entry.files
        : (entry?.paths || []).map((path) => ({
            path: String(path),
            added: 0,
            removed: 0,
          }));
      const paths = files
        .map((f) => String(f.path || ""))
        .filter(Boolean);
      if (entry?.showScm && paths.length) {
        setComposerScmActions(
          files.length ? files : findReviewFilesByPaths(paths),
          true
        );
        return;
      }
    }
    setComposerScmActions([], false);
  }

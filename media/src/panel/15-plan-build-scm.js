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
    card.appendChild(title);

    const fileList = document.createElement("div");
    fileList.className = "review-files";
    card.appendChild(fileList);
    const mount = ensureChatTurn();
    mount.appendChild(card);
    // Общее построение (заголовок, строки, диф-итоги в сводку шагов) —
    // в одном месте, чтобы live-рендер и SCM-обновления не расходились.
    renderReviewCardBody(card, list);
    if (parsed.showScm) {
      // Кнопка коммитит все незакоммиченные файлы чата, не только этот ход.
      setComposerScmActions(
        collectChatScmFiles([
          ...reviewEntriesFromCache(),
          { files: list, showScm: true },
        ]),
        true
      );
    } else {
      syncComposerScmFromCache();
    }
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
   * — so composer «Собрать» still appears when the stream cut the close tag.
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
    setBusy(true, { restartRun: true });
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

  /** Plan key (whitespace-normalized) → collapsed, for cards the user toggled. */
  const planCardUserCollapsed = new Map();
  /** Latest Plan.md text from the host (null — not asked yet). */
  let livePlanEditorText = null;

  function planCardKey(text) {
    return stripPlanImplementWrapper(text).replace(/\s+/g, " ").trim();
  }

  /**
   * Card state per plan: streaming (being written), ready (latest, Build
   * available), done (Build ran / files edited after it), superseded (a newer
   * plan exists). Latest card is expanded unless the user collapsed it.
   */
  function syncPlanCardStates() {
    if (!messagesEl) {
      return;
    }
    const list = Array.isArray(uiMessagesCache) ? uiMessagesCache : [];
    let latestIndex = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.role === "assistant" && extractLatestProposedPlan(list[i].text)) {
        latestIndex = i;
        break;
      }
    }
    const cards = Array.from(messagesEl.querySelectorAll(".proposed-plan-card"));
    cards.forEach((card) => {
      const msgEl = card.closest(".msg");
      const index = Number(msgEl?.dataset.index);
      const isStreaming = Boolean(
        msgEl && typeof streamingEl !== "undefined" && streamingEl === msgEl
      );
      let state = "ready";
      if (isStreaming) {
        state = "streaming";
      } else if (Number.isInteger(index) && index >= 0 && list[index]) {
        if (planIsAlreadyExecuted(list, index)) {
          state = "done";
        } else if (latestIndex >= 0 && index !== latestIndex) {
          state = "superseded";
        }
      }
      card.dataset.planState = state;
      card.classList.toggle(
        "is-truncated",
        card.classList.contains("is-partial") && state !== "streaming"
      );
      const key = planCardKey(card.dataset.planRaw || "");
      const edited =
        state === "ready" &&
        livePlanEditorText !== null &&
        key === lastOpenedPlanKey &&
        Boolean(planCardKey(livePlanEditorText)) &&
        planCardKey(livePlanEditorText) !== key;
      card.classList.toggle("is-edited", edited);
      const buildBtn = card.querySelector("[data-plan-action='build']");
      if (buildBtn instanceof HTMLButtonElement) {
        buildBtn.disabled = busy;
      }
      const continueBtn = card.querySelector("[data-plan-action='continue']");
      if (continueBtn instanceof HTMLButtonElement) {
        continueBtn.disabled = busy;
      }
      const collapsed = planCardUserCollapsed.has(key)
        ? planCardUserCollapsed.get(key)
        : state === "done" || state === "superseded";
      setProposedPlanCollapsed(card, collapsed);
    });
  }

  /** Ask the host for Plan.md text (panel regained focus — user may have edited it). */
  function requestLivePlanStatus() {
    if (!lastOpenedPlanKey || !messagesEl) {
      return;
    }
    if (!messagesEl.querySelector(".proposed-plan-card[data-plan-state='ready']")) {
      return;
    }
    host.postMessage({ type: "requestLivePlanStatus" });
  }

  function applyLivePlanStatus(text) {
    livePlanEditorText = String(text || "");
    syncPlanCardStates();
  }

  function copyPlanFromCard(card) {
    const raw = stripPlanImplementWrapper(card?.dataset.planRaw || "");
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

  /** «Continue plan» on a cut-off card: re-ask in the current mode. */
  function sendPlanContinue() {
    sendPlanFollowup(t("proposedPlanContinuePrompt"));
  }

  /** «Complete» on a plan missing required sections. */
  function sendPlanComplete(card) {
    const summary = summarizePlanMarkdown(card?.dataset.planRaw || "");
    const keys = summary.missing.length ? summary.missing : ["verify"];
    const names = keys.map((key) => t(`proposedPlanSection_${key}`)).join(", ");
    sendPlanFollowup(t("proposedPlanCompletePrompt", names));
  }

  /** Card follow-up prompt in the current mode (Plan stays Plan). */
  function sendPlanFollowup(text) {
    if (busy || !text) {
      return;
    }
    const mode = agentMode;
    stickToBottom = true;
    uiMessagesCache.push({ role: "user", text, attachments: [], mode });
    appendMessage("user", text, uiMessagesCache.length - 1, -1, []);
    setBusy(true, { restartRun: true });
    host.postMessage({
      type: "send",
      text,
      model: getSelectedModel(),
      agentMode: mode,
      reasoningEffort: selectedReasoningEffort || undefined,
      attachments: [],
    });
  }

  function setComposerPlanBuild(planText, show) {
    syncPlanCardStates();
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
      setBusy(true, { restartRun: true });
      host.postMessage({
        type: "commitAndPush",
        paths,
      });
    });
    // Одна сегментированная кнопка «Закоммитить | +N −M»: цифры уже есть в
    // карточке изменений, здесь — только действия.
    const split = document.createElement("div");
    split.className = "composer-scm-split";
    split.setAttribute("role", "group");
    split.appendChild(commitPushBtn);
    composerScmActionsEl.appendChild(split);

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
    split.appendChild(scmBtn);
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
    title.textContent = t("changedFiles", list.length, totalAdd, totalDel);
    // Тихая лента: диф-итоги хода уходят и в свернутую сводку шагов
    // («выполнено · N шага · +A −D»), чтобы карточку можно было не разворачивать.
    const turn = card.closest(".chat-turn");
    if (turn) {
      const timelines = turn.querySelectorAll(
        ".tool-group.agent-timeline[data-sealed='1']"
      );
      const timeline = timelines[timelines.length - 1];
      if (timeline) {
        timeline.dataset.reviewAdded = String(totalAdd);
        timeline.dataset.reviewRemoved = String(totalDel);
        updateToolGroupSummary(timeline);
      }
    }
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

  /** Карточки изменений чата из кэша сообщений, по порядку ходов. */
  function reviewEntriesFromCache() {
    const list = Array.isArray(uiMessagesCache) ? uiMessagesCache : [];
    const entries = [];
    for (const item of list) {
      if (item?.role !== "review") {
        continue;
      }
      const parsed = parseReviewData(item.text);
      entries.push({
        files: Array.isArray(parsed.files) ? parsed.files : [],
        showScm: Boolean(parsed.showScm),
      });
    }
    return entries;
  }

  /**
   * Незакоммиченные файлы всех ходов чата для «Закоммитить». Путь из
   * нескольких ходов берётся один раз — со статистикой из самого позднего.
   */
  function collectChatScmFiles(entries) {
    const out = [];
    const seen = new Set();
    const list = Array.isArray(entries) ? entries : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (!entry?.showScm) {
        continue;
      }
      for (const f of Array.isArray(entry.files) ? entry.files : []) {
        const path = String(f?.path || "").trim();
        if (!path || seen.has(path)) {
          continue;
        }
        seen.add(path);
        out.push(f);
      }
    }
    return out;
  }

  function syncComposerScmFromCache() {
    const files = collectChatScmFiles(reviewEntriesFromCache());
    setComposerScmActions(files, files.length > 0);
  }

  function applyScmButtons(reviews) {
    const list = Array.isArray(reviews) ? reviews : [];
    syncReviewCardsFromScm(list);
    const entries = list.map((entry) => {
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
      return {
        files: files.length ? files : findReviewFilesByPaths(paths),
        showScm: Boolean(entry?.showScm),
      };
    });
    const files = collectChatScmFiles(entries);
    setComposerScmActions(files, files.length > 0);
  }

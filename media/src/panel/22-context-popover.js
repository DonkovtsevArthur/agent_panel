
  // --- «Context» popover: context window split by category ---
  // Opens from the composer context ring. Data: `breakdown` on contextUsage /
  // `contextBreakdown` on hydrate + showChat (src/contextBreakdown.ts, both hosts).

  const CONTEXT_CATEGORY_LABEL_KEYS = {
    messages: "contextCatMessages",
    systemTools: "contextCatSystemTools",
    mcpTools: "contextCatMcpTools",
    systemPrompt: "contextCatSystemPrompt",
    skills: "contextCatSkills",
    memoryFiles: "contextCatMemoryFiles",
    mcpInstructions: "contextCatMcpInstructions",
    autocompactBuffer: "contextCatAutocompactBuffer",
    freeSpace: "contextCatFreeSpace",
  };

  /** Categories that fill the window; the buffer / free space follow. */
  const CONTEXT_USED_CATEGORIES = [
    "messages",
    "systemTools",
    "mcpTools",
    "systemPrompt",
    "skills",
    "memoryFiles",
    "mcpInstructions",
  ];

  let contextBreakdownData = null;
  let contextPopoverEl = null;
  let contextPopoverCollapsed = false;
  const contextPopoverExpanded = { mcpTools: false, memoryFiles: false };

  function setContextBreakdown(breakdown) {
    contextBreakdownData =
      breakdown && typeof breakdown === "object" && Array.isArray(breakdown.categories)
        ? breakdown
        : null;
    if (isContextPopoverOpen()) {
      renderContextPopover();
    }
  }

  function isContextPopoverOpen() {
    return Boolean(contextPopoverEl && !contextPopoverEl.hidden);
  }

  function formatContextPercent(tokens, max, digits) {
    const value = (Math.max(0, Number(tokens) || 0) / Math.max(1, Number(max) || 1)) * 100;
    return value.toLocaleString(UI_LANG === "ru" ? "ru-RU" : "en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  /** 18900 → "18.9k", 886300 → "886.3k" (ring tooltip rounds coarser). */
  function formatContextTokens(n) {
    const value = Math.max(0, Math.round(Number(n) || 0));
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    }
    return String(value);
  }

  /** `mcp__figma__get_screenshot` → `figma · get_screenshot`. */
  function contextMcpToolLabel(name) {
    const match = /^mcp__(.+?)__(.+)$/.exec(String(name || ""));
    return match ? `${match[1]} · ${match[2]}` : String(name || "");
  }

  function contextRowHtml(id, label, tokens, max, opts) {
    const options = opts || {};
    const cls = ["context-pop-row"];
    if (options.muted) {
      cls.push("is-muted");
    }
    const pct = options.noPct ? "—" : `${formatContextPercent(tokens, max, 1)} %`;
    const title = options.title ? ` title="${escapeHtml(options.title)}"` : "";
    return (
      `<div class="${cls.join(" ")}"${title}>` +
      `<span class="context-pop-swatch ctx-c-${escapeHtml(id)}" aria-hidden="true"></span>` +
      `<span class="context-pop-name">${escapeHtml(label)}</span>` +
      `<span class="context-pop-tokens">${escapeHtml(formatContextTokens(tokens))}</span>` +
      `<span class="context-pop-pct">${escapeHtml(pct)}</span>` +
      `</div>`
    );
  }

  function contextListHtml(key, label, items) {
    const open = contextPopoverExpanded[key] === true;
    const rows = open
      ? `<div class="context-pop-list-body">` +
        items
          .map(
            (item) =>
              `<div class="context-pop-list-item${item.deferred ? " is-muted" : ""}"` +
              `${item.deferred ? ` title="${escapeHtml(t("contextDeferredHint"))}"` : ""}>` +
              `<span class="context-pop-list-name">${escapeHtml(
                key === "mcpTools" ? contextMcpToolLabel(item.name) : item.name
              )}</span>` +
              `<span class="context-pop-tokens">${escapeHtml(formatContextTokens(item.tokens))}</span>` +
              `</div>`
          )
          .join("") +
        `</div>`
      : "";
    return (
      `<div class="context-pop-list">` +
      `<button type="button" class="context-pop-list-toggle" data-ctx-list="${key}" aria-expanded="${open}"` +
      `${items.length ? "" : " disabled"}>` +
      `<span class="material-symbols-outlined" aria-hidden="true">${open ? "expand_more" : "chevron_right"}</span>` +
      `<span class="context-pop-name">${escapeHtml(label)}</span>` +
      `<span class="context-pop-count">${items.length}</span>` +
      `</button>` +
      rows +
      `</div>`
    );
  }

  /** Last request cache share + chat totals (was the ring hover tooltip). */
  function contextUsageStatsHtml() {
    const rows = [];
    if (lastPromptTokens > 0) {
      const cached = Math.min(lastCacheReadTokens, lastPromptTokens);
      rows.push([
        t("contextStatLastRequest"),
        t(
          "contextStatCached",
          formatContextTokens(lastPromptTokens),
          formatContextTokens(cached),
          Math.round((cached / lastPromptTokens) * 100)
        ),
      ]);
    }
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      const parts = [
        `${t("contextStatIn")} ${formatContextTokens(totalInputTokens)}`,
        `${t("contextStatOut")} ${formatContextTokens(totalOutputTokens)}`,
      ];
      if (totalCacheReadTokens > 0 || totalCacheWriteTokens > 0) {
        parts.push(
          `${t("contextStatCacheRead")} ${formatContextTokens(totalCacheReadTokens)}`,
          `${t("contextStatCacheWrite")} ${formatContextTokens(totalCacheWriteTokens)}`
        );
      }
      rows.push([t("contextStatChatTotal"), parts.join(" · ")]);
    }
    if (!rows.length) {
      return "";
    }
    return (
      `<div class="context-pop-stats">` +
      rows
        .map(
          ([label, value]) =>
            `<div class="context-pop-stat"><span>${escapeHtml(label)}</span>` +
            `<span class="context-pop-tokens">${escapeHtml(value)}</span></div>`
        )
        .join("") +
      `</div>`
    );
  }

  function renderContextPopover() {
    if (!contextPopoverEl) {
      return;
    }
    const data = contextBreakdownData;
    const windowTokens = data ? data.contextWindow : contextMax;
    const used = data ? data.used : contextUsed;
    const byId = {};
    for (const c of data ? data.categories : []) {
      byId[c.id] = Math.max(0, Number(c.tokens) || 0);
    }
    // Percentages are of the auto-compact budget: the chat never grows past
    // it (Cline compacts there), so «11 % of 256k» would overstate the room.
    const trigger = data ? contextCompactTrigger(data, byId) : 0;
    const max = trigger > 0 ? trigger : windowTokens;
    const head =
      `<button type="button" class="context-pop-head" data-ctx-collapse aria-expanded="${!contextPopoverCollapsed}">` +
      `<span class="context-pop-title">${escapeHtml(t("contextPopTitle"))}</span>` +
      `<span class="material-symbols-outlined" aria-hidden="true">${
        contextPopoverCollapsed ? "expand_more" : "expand_less"
      }</span>` +
      `</button>`;
    const usedPct = formatContextPercent(used, max, 0);
    const summary =
      `<div class="context-pop-summary">` +
      `<span>${escapeHtml(
        trigger > 0 ? t("contextPopUsedBeforeCompact", usedPct) : t("contextPopUsed", usedPct)
      )}</span>` +
      `<span class="context-pop-total">${escapeHtml(
        `${formatContextTokens(used)} / ${formatContextTokens(max)}`
      )}</span>` +
      `</div>` +
      (trigger > 0
        ? `<div class="context-pop-budget">${escapeHtml(
            t("contextPopBudget", formatContextTokens(trigger), formatContextTokens(windowTokens))
          )}</div>`
        : "");

    const barIds = data ? CONTEXT_USED_CATEGORIES : ["messages"];
    const barTokens = data ? byId : { messages: used };
    // Widths go through CSSOM after innerHTML: the VS Code webview CSP has no
    // 'unsafe-inline' for styles, so a style="" attribute would be dropped.
    const bar =
      `<div class="context-pop-bar" aria-hidden="true">` +
      barIds
        .filter((id) => (barTokens[id] || 0) > 0)
        .map((id) => {
          const width = Math.min(100, ((barTokens[id] || 0) / Math.max(1, max)) * 100);
          return `<span class="context-pop-seg ctx-c-${id}" data-ctx-width="${Math.max(0.6, width).toFixed(2)}"></span>`;
        })
        .join("") +
      `</div>`;

    if (contextPopoverCollapsed) {
      setContextPopoverHtml(head + summary + bar);
      return;
    }
    if (!data) {
      setContextPopoverHtml(
        head +
        summary +
        bar +
        contextUsageStatsHtml() +
        `<div class="context-pop-note">${escapeHtml(t("contextPopEmpty"))}</div>`
      );
      return;
    }

    const rows = data.categories
      .filter((c) => c.id !== "autocompactBuffer" || c.tokens > 0)
      .map((c) =>
        contextRowHtml(
          c.id,
          t(CONTEXT_CATEGORY_LABEL_KEYS[c.id] || c.id),
          c.tokens,
          max,
          c.id === "autocompactBuffer"
            ? { noPct: true, title: t("contextBufferHint") }
            : undefined
        )
      )
      .join("");
    const deferred = data.deferred || {};
    const deferredRows =
      (deferred.mcpTools > 0
        ? contextRowHtml("deferred", t("contextCatMcpToolsDeferred"), deferred.mcpTools, max, {
            muted: true,
            noPct: true,
            title: t("contextDeferredHint"),
          })
        : "") +
      (deferred.systemTools > 0
        ? contextRowHtml(
            "deferred",
            t("contextCatSystemToolsDeferred"),
            deferred.systemTools,
            max,
            { muted: true, noPct: true, title: t("contextDeferredHint") }
          )
        : "");
    const lists =
      contextListHtml("mcpTools", t("contextListMcpTools"), data.mcpTools || []) +
      contextListHtml("memoryFiles", t("contextListMemoryFiles"), data.memoryFiles || []);
    setContextPopoverHtml(
      head +
      summary +
      bar +
      `<div class="context-pop-rows">${rows}</div>` +
      (deferredRows ? `<div class="context-pop-rows context-pop-deferred">${deferredRows}</div>` : "") +
      `<div class="context-pop-lists">${lists}</div>` +
      contextUsageStatsHtml() +
      `<div class="context-pop-note">${escapeHtml(
        data.calibrated ? t("contextPopCalibrated") : t("contextPopEstimated")
      )}</div>`
    );
  }

  function setContextPopoverHtml(html) {
    contextPopoverEl.innerHTML = html;
    for (const seg of contextPopoverEl.querySelectorAll("[data-ctx-width]")) {
      seg.style.width = `${seg.getAttribute("data-ctx-width")}%`;
    }
  }

  /** Auto-compact trigger; older payloads only carry the buffer size. */
  function contextCompactTrigger(data, byId) {
    const trigger = Number(data.compactTriggerTokens) || 0;
    if (trigger > 0) {
      return trigger;
    }
    const buffer = byId.autocompactBuffer || 0;
    return buffer > 0 ? Math.max(1, data.contextWindow - buffer) : 0;
  }

  function ensureContextPopover() {
    if (contextPopoverEl || !contextRingEl || !contextRingEl.parentElement) {
      return contextPopoverEl;
    }
    contextPopoverEl = document.createElement("div");
    contextPopoverEl.className = "context-popover";
    contextPopoverEl.id = "contextPopover";
    contextPopoverEl.setAttribute("role", "dialog");
    contextPopoverEl.hidden = true;
    contextPopoverEl.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      if (target.closest("[data-ctx-collapse]")) {
        contextPopoverCollapsed = !contextPopoverCollapsed;
        renderContextPopover();
        return;
      }
      const toggle = target.closest("[data-ctx-list]");
      if (toggle) {
        const key = toggle.getAttribute("data-ctx-list");
        contextPopoverExpanded[key] = !contextPopoverExpanded[key];
        renderContextPopover();
      }
    });
    contextRingEl.parentElement.appendChild(contextPopoverEl);
    return contextPopoverEl;
  }

  /** Click pins the popover; a hover-opened one closes when the pointer leaves. */
  let contextPopoverPinned = false;
  let contextHoverOpenTimer = 0;
  let contextHoverCloseTimer = 0;
  const CONTEXT_HOVER_OPEN_MS = 150;
  const CONTEXT_HOVER_CLOSE_MS = 250;

  function clearContextHoverTimers() {
    clearTimeout(contextHoverOpenTimer);
    clearTimeout(contextHoverCloseTimer);
    contextHoverOpenTimer = 0;
    contextHoverCloseTimer = 0;
  }

  function setContextPopoverOpen(open, pinned) {
    const el = ensureContextPopover();
    if (!el) {
      return;
    }
    clearContextHoverTimers();
    contextPopoverPinned = open && pinned === true;
    el.hidden = !open;
    contextRingEl.classList.toggle("is-open", open);
    contextRingEl.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      renderContextPopover();
    }
  }

  function onContextHoverEnter(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }
    clearTimeout(contextHoverCloseTimer);
    contextHoverCloseTimer = 0;
    if (isContextPopoverOpen() || contextHoverOpenTimer) {
      return;
    }
    contextHoverOpenTimer = setTimeout(() => {
      contextHoverOpenTimer = 0;
      setContextPopoverOpen(true, false);
    }, CONTEXT_HOVER_OPEN_MS);
  }

  function onContextHoverLeave(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }
    clearTimeout(contextHoverOpenTimer);
    contextHoverOpenTimer = 0;
    if (!isContextPopoverOpen() || contextPopoverPinned) {
      return;
    }
    clearTimeout(contextHoverCloseTimer);
    contextHoverCloseTimer = setTimeout(() => {
      contextHoverCloseTimer = 0;
      if (!contextPopoverPinned) {
        setContextPopoverOpen(false);
      }
    }, CONTEXT_HOVER_CLOSE_MS);
  }

  if (contextRingEl) {
    contextRingEl.setAttribute("aria-haspopup", "dialog");
    contextRingEl.setAttribute("aria-expanded", "false");
    contextRingEl.addEventListener("click", (event) => {
      event.stopPropagation();
      // Hover-opened → click pins it; pinned → click closes.
      if (isContextPopoverOpen() && contextPopoverPinned) {
        setContextPopoverOpen(false);
      } else {
        setContextPopoverOpen(true, true);
      }
    });
    contextRingEl.addEventListener("pointerenter", onContextHoverEnter);
    contextRingEl.addEventListener("pointerleave", onContextHoverLeave);
    const popover = ensureContextPopover();
    if (popover) {
      popover.addEventListener("pointerenter", onContextHoverEnter);
      popover.addEventListener("pointerleave", onContextHoverLeave);
    }
  }
  document.addEventListener("click", (event) => {
    if (!isContextPopoverOpen()) {
      return;
    }
    const target = event.target instanceof Node ? event.target : null;
    if (target && contextPopoverEl.contains(target)) {
      return;
    }
    setContextPopoverOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isContextPopoverOpen()) {
      setContextPopoverOpen(false);
      contextRingEl?.focus();
    }
  });

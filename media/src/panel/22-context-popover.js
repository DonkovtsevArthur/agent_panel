
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

  function renderContextPopover() {
    if (!contextPopoverEl) {
      return;
    }
    const data = contextBreakdownData;
    const max = data ? data.contextWindow : contextMax;
    const used = data ? data.used : contextUsed;
    const head =
      `<button type="button" class="context-pop-head" data-ctx-collapse aria-expanded="${!contextPopoverCollapsed}">` +
      `<span class="context-pop-title">${escapeHtml(t("contextPopTitle"))}</span>` +
      `<span class="material-symbols-outlined" aria-hidden="true">${
        contextPopoverCollapsed ? "expand_more" : "expand_less"
      }</span>` +
      `</button>`;
    const summary =
      `<div class="context-pop-summary">` +
      `<span>${escapeHtml(t("contextPopUsed", formatContextPercent(used, max, 0)))}</span>` +
      `<span class="context-pop-total">${escapeHtml(
        `${formatContextTokens(used)} / ${formatContextTokens(max)}`
      )}</span>` +
      `</div>`;

    const byId = {};
    for (const c of data ? data.categories : []) {
      byId[c.id] = Math.max(0, Number(c.tokens) || 0);
    }
    const barIds = data
      ? [...CONTEXT_USED_CATEGORIES, "autocompactBuffer"]
      : ["messages"];
    const barTokens = data ? byId : { messages: used };
    const bar =
      `<div class="context-pop-bar" aria-hidden="true">` +
      barIds
        .filter((id) => (barTokens[id] || 0) > 0)
        .map((id) => {
          const width = Math.min(100, ((barTokens[id] || 0) / Math.max(1, max)) * 100);
          return `<span class="context-pop-seg ctx-c-${id}" style="width:${Math.max(0.6, width).toFixed(2)}%"></span>`;
        })
        .join("") +
      `</div>`;

    if (contextPopoverCollapsed) {
      contextPopoverEl.innerHTML = head + summary + bar;
      return;
    }
    if (!data) {
      contextPopoverEl.innerHTML =
        head +
        summary +
        bar +
        `<div class="context-pop-note">${escapeHtml(t("contextPopEmpty"))}</div>`;
      return;
    }

    const rows = data.categories
      .map((c) =>
        contextRowHtml(c.id, t(CONTEXT_CATEGORY_LABEL_KEYS[c.id] || c.id), c.tokens, max)
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
    contextPopoverEl.innerHTML =
      head +
      summary +
      bar +
      `<div class="context-pop-rows">${rows}</div>` +
      (deferredRows ? `<div class="context-pop-rows context-pop-deferred">${deferredRows}</div>` : "") +
      `<div class="context-pop-lists">${lists}</div>` +
      `<div class="context-pop-note">${escapeHtml(
        data.calibrated ? t("contextPopCalibrated") : t("contextPopEstimated")
      )}</div>`;
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

  function setContextPopoverOpen(open) {
    const el = ensureContextPopover();
    if (!el) {
      return;
    }
    el.hidden = !open;
    contextRingEl.classList.toggle("is-open", open);
    contextRingEl.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      renderContextPopover();
    }
  }

  if (contextRingEl) {
    contextRingEl.setAttribute("aria-haspopup", "dialog");
    contextRingEl.setAttribute("aria-expanded", "false");
    contextRingEl.addEventListener("click", (event) => {
      event.stopPropagation();
      setContextPopoverOpen(!isContextPopoverOpen());
    });
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

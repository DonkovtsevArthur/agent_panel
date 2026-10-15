
  function renderArchiveList() {
    if (!archiveListEl) {
      return;
    }
    const agents = archiveAgentsData || [];
    if (deleteAllArchiveBtn) {
      deleteAllArchiveBtn.hidden = agents.length === 0;
    }
    if (!agents.length) {
      archiveListEl.innerHTML =
        `<div class="agents-empty">${t("archiveEmpty")}</div>`;
      return;
    }

    archiveListEl.innerHTML = agents
      .map(
        (a) =>
          `<div class="agent-block archive-block" data-agent="${a.id}">` +
          `<div class="agent-row-wrap archive-row-wrap">` +
          `<div class="agent-row flat">` +
          `<div class="agent-main">` +
          `<div class="agent-name-row">` +
          `<div class="agent-name-wrap"><div class="agent-name"></div></div>` +
          `<div class="agent-trailing">` +
          `<span class="agent-time"></span>` +
          `<div class="row-actions">` +
          `<button type="button" class="row-action row-restore" data-restore-agent="${a.id}" title="${t("restore")}" aria-label="${t("restore")}">` +
          RESTORE_ICON +
          `</button>` +
          `<button type="button" class="row-action row-delete" data-delete-agent="${a.id}" title="${t("delete")}" aria-label="${t("delete")}">` +
          DELETE_ICON +
          `</button>` +
          `</div>` +
          `</div>` +
          `</div>` +
          `<div class="agent-preview"></div>` +
          `</div>` +
          `</div>` +
          `</div>` +
          `</div>`
      )
      .join("");

    agents.forEach((a, index) => {
      const block = archiveListEl.children[index];
      if (!block) {
        return;
      }
      block.querySelector(".agent-name").textContent = a.name || t("agent");
      block.querySelector(".agent-preview").innerHTML = renderPreviewMarkdown(
        a.preview
      );
      block.querySelector(".agent-time").textContent = a.time || "";
    });
  }

  function shortModelChip(raw) {
    const s = String(raw || "").trim();
    if (!s || s === "—") {
      return "—";
    }
    const last = s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
    if (/^claude-sonnet-/i.test(last)) {
      return last.replace(/^claude-sonnet-/i, "Sonnet ");
    }
    if (/^claude-opus-/i.test(last)) {
      return last.replace(/^claude-opus-/i, "Opus ");
    }
    if (/^claude-haiku-/i.test(last)) {
      return last.replace(/^claude-haiku-/i, "Haiku ");
    }
    if (/^glm-/i.test(last)) {
      return last.replace(/^glm-/i, "GLM ");
    }
    if (/^gpt-/i.test(last)) {
      return last.replace(/^gpt-/i, "GPT-");
    }
    return last;
  }

  /**
   * Список агентов: плотные строки, группы по дате, закреплённые сверху,
   * фильтр по названию, меню «⋯». Пустые агенты (без сообщений) не
   * показываются, кроме активного.
   *
   * Классы .agent-block / .agent-row[data-agent] / .agent-name / .row-archive /
   * .row-delete сохранены — на них завязаны обработчики открытия (в т.ч.
   * JCEF pointerdown), подсветка активного и переименование.
   */
  let agentsArchivedCount = 0;
  let agentsFilterQuery = "";
  let agentsFilterEl = null;
  let agentsFooterEl = null;
  let agentMenuEl = null;
  let agentMenuAgentId = "";

  const AGENT_MORE_ICON =
    `<span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>`;

  function agentDayStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** "today" | "yesterday" | "week" | "earlier" по локальной дате. */
  function agentDateGroup(ts) {
    const n = Number(ts) || 0;
    if (n <= 0) {
      return "earlier";
    }
    const today = agentDayStart(new Date());
    const day = agentDayStart(new Date(n));
    const dayMs = 86_400_000;
    if (day >= today) {
      return "today";
    }
    if (day >= today - dayMs) {
      return "yesterday";
    }
    if (day >= today - 6 * dayMs) {
      return "week";
    }
    return "earlier";
  }

  /** Время в строке: часы для сегодня/вчера, день недели, иначе дата. */
  function agentTimeLabel(a, group) {
    const n = Number(a.ts) || 0;
    if (n <= 0) {
      return a.time || "";
    }
    const locale = UI_LANG === "ru" ? "ru-RU" : "en-US";
    const d = new Date(n);
    try {
      if (group === "today" || group === "yesterday") {
        return d.toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      if (group === "week") {
        return d.toLocaleDateString(locale, { weekday: "short" });
      }
      return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
    } catch {
      return a.time || "";
    }
  }

  function agentStatusHtml(a) {
    if (a.runState === "running") {
      const mode = String(a.runMode || "").trim();
      return (
        `<span class="agent-list-status is-running"${mode ? ` data-mode="${escapeHtml(mode)}"` : ""} role="img" aria-label="${escapeHtml(t("agentRunRunning"))}" title="${escapeHtml(t("agentRunRunning"))}">` +
        `<span class="material-symbols-outlined" aria-hidden="true">progress_activity</span></span>`
      );
    }
    if (a.runState === "error") {
      return (
        `<span class="agent-list-status is-error" role="img" aria-label="${escapeHtml(t("agentRunError"))}" title="${escapeHtml(t("agentRunError"))}">` +
        `<span class="material-symbols-outlined" aria-hidden="true">error</span></span>`
      );
    }
    if (a.runState === "success") {
      return (
        `<span class="agent-list-status is-unread" role="img" aria-label="${escapeHtml(t("agentUnread"))}" title="${escapeHtml(t("agentUnread"))}">` +
        `<span class="agent-unread-dot"></span></span>`
      );
    }
    if (a.pinned) {
      return (
        `<span class="agent-list-status is-pinned" role="img" aria-label="${escapeHtml(t("agentPinned"))}" title="${escapeHtml(t("agentPinned"))}">` +
        `<span class="material-symbols-outlined" aria-hidden="true">keep</span></span>`
      );
    }
    return `<span class="agent-list-status" aria-hidden="true"></span>`;
  }

  /** Строка мета: «Работает · модель», «Ошибка · 10:02», «модель · 14:20 · +87 −3». */
  function fillAgentMeta(metaEl, a, group) {
    metaEl.replaceChildren();
    const parts = [];
    const add = (text, cls) => {
      const span = document.createElement("span");
      if (cls) {
        span.className = cls;
      }
      span.textContent = text;
      parts.push(span);
    };
    const model = shortModelChip(a.model);
    const hasModel = model && model !== "—";
    if (a.runState === "running") {
      add(t("agentRunRunning"), "agent-meta-running");
      if (hasModel) {
        add(model);
      }
    } else if (a.runState === "error") {
      add(t("agentRunErrorShort"), "agent-meta-error");
      add(agentTimeLabel(a, group));
    } else {
      if (hasModel) {
        add(model);
      }
      add(agentTimeLabel(a, group));
    }
    const added = Number(a.diffAdded) || 0;
    const removed = Number(a.diffRemoved) || 0;
    if (added > 0 || removed > 0) {
      const diff = document.createElement("span");
      diff.className = "agent-meta-diff";
      diff.innerHTML =
        `<span class="add">+${added}</span> <span class="del">−${removed}</span>`;
      parts.push(diff);
    }
    parts
      .filter((el) => el.textContent)
      .forEach((el, i) => {
        if (i > 0) {
          metaEl.appendChild(document.createTextNode(" · "));
        }
        metaEl.appendChild(el);
      });
  }

  function agentMatchesFilter(a, query) {
    if (!query) {
      return true;
    }
    const hay = `${a.name || ""}\n${a.preview || ""}`.toLowerCase();
    return hay.includes(query);
  }

  function ensureAgentsChrome() {
    if (!agentsScreen || !agentsListEl) {
      return;
    }
    agentsListEl.classList.add("is-v2");
    if (!agentsFilterEl) {
      const wrap = document.createElement("label");
      wrap.className = "agents-filter";
      wrap.innerHTML =
        `<span class="material-symbols-outlined" aria-hidden="true">search</span>` +
        `<input type="text" class="agents-filter-input" autocomplete="off" spellcheck="false">`;
      const input = wrap.querySelector("input");
      input.addEventListener("input", () => {
        agentsFilterQuery = input.value.trim().toLowerCase();
        renderAgentsList();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && input.value) {
          event.preventDefault();
          event.stopPropagation();
          input.value = "";
          agentsFilterQuery = "";
          renderAgentsList();
        } else if (event.key === "ArrowDown") {
          const first = agentsListEl.querySelector(".agent-row[data-agent]");
          if (first) {
            event.preventDefault();
            first.focus();
          }
        }
      });
      agentsListEl.before(wrap);
      agentsFilterEl = wrap;
    }
    const filterInput = agentsFilterEl.querySelector("input");
    if (filterInput) {
      filterInput.placeholder = t("agentsFilter");
      filterInput.setAttribute("aria-label", t("agentsFilter"));
    }
    if (!agentsFooterEl) {
      const footer = document.createElement("button");
      footer.type = "button";
      footer.className = "agents-footer-archive";
      footer.innerHTML =
        `<span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>` +
        `<span class="agents-footer-label"></span>` +
        `<span class="agents-footer-count"></span>`;
      footer.addEventListener("click", () => {
        openArchiveBtn?.click();
      });
      agentsListEl.after(footer);
      agentsFooterEl = footer;
    }
    agentsFooterEl.querySelector(".agents-footer-label").textContent =
      t("archive");
    agentsFooterEl.querySelector(".agents-footer-count").textContent = String(
      agentsArchivedCount
    );
    agentsFooterEl.hidden = !(agentsArchivedCount > 0);
  }

  function renderAgentsList() {
    if (!agentsListEl) {
      return;
    }
    if (renamingAgentId) {
      syncActiveAgentHighlight();
      return;
    }
    ensureAgentsChrome();
    const visible = agentsData.filter((a) => !a.empty || a.active);
    if (!visible.length) {
      agentsListEl.innerHTML = `<div class="agents-empty">${t("noAgentsYet")}</div>`;
      return;
    }
    const query = agentsFilterQuery;
    const shown = visible.filter((a) => agentMatchesFilter(a, query));
    if (!shown.length) {
      agentsListEl.innerHTML = `<div class="agents-empty">${escapeHtml(t("agentsFilterEmpty"))}</div>`;
      return;
    }

    const order = ["pinned", "today", "yesterday", "week", "earlier"];
    const titles = {
      pinned: t("agentsGroupPinned"),
      today: t("agentsGroupToday"),
      yesterday: t("agentsGroupYesterday"),
      week: t("agentsGroupWeek"),
      earlier: t("agentsGroupEarlier"),
    };
    const groups = new Map(order.map((key) => [key, []]));
    for (const a of shown) {
      const dateGroup = agentDateGroup(a.ts);
      groups.get(a.pinned ? "pinned" : dateGroup).push({ a, dateGroup });
    }

    const frag = document.createDocumentFragment();
    for (const key of order) {
      const items = groups.get(key);
      if (!items.length) {
        continue;
      }
      const head = document.createElement("div");
      head.className = "agents-group-title";
      head.textContent = titles[key];
      frag.appendChild(head);
      for (const { a, dateGroup } of items) {
        const block = document.createElement("div");
        block.className = "agent-block";
        block.dataset.agent = a.id;
        block.classList.toggle("is-active", Boolean(a.active));
        block.classList.toggle("is-unread", a.runState === "success");
        block.classList.toggle("is-running", a.runState === "running");
        const showBadge = a.mode && a.mode !== "agent" && a.mode !== "auto";
        block.innerHTML =
          `<div class="agent-row-wrap">` +
          `<div class="agent-row flat" role="button" tabindex="0" data-agent="${escapeHtml(a.id)}">` +
          agentStatusHtml(a) +
          `<div class="agent-text">` +
          `<div class="agent-name-row">` +
          `<div class="agent-name"></div>` +
          (showBadge
            ? `<span class="agent-mode-badge" data-mode="${escapeHtml(a.mode)}"></span>`
            : "") +
          `</div>` +
          `<div class="agent-meta"></div>` +
          `<div class="agent-preview"></div>` +
          `</div>` +
          `</div>` +
          `<button type="button" class="agent-more" data-agent-menu="${escapeHtml(a.id)}" title="${escapeHtml(t("agentMenu"))}" aria-label="${escapeHtml(t("agentMenu"))}" aria-haspopup="menu" aria-expanded="false">` +
          AGENT_MORE_ICON +
          `</button>` +
          `</div>`;
        block.querySelector(".agent-name").textContent = a.name || t("agent");
        const badge = block.querySelector(".agent-mode-badge");
        if (badge) {
          badge.textContent = modeDisplayName(a.mode);
        }
        fillAgentMeta(block.querySelector(".agent-meta"), a, dateGroup);
        const preview = block.querySelector(".agent-preview");
        if (a.active && a.preview && !a.empty) {
          preview.innerHTML = renderPreviewMarkdown(a.preview);
        } else {
          preview.remove();
        }
        if (a.active) {
          block.querySelector(".agent-row").setAttribute("aria-current", "true");
        }
        frag.appendChild(block);
      }
    }
    agentsListEl.replaceChildren(frag);
    if (agentMenuEl && !agentMenuEl.hidden) {
      closeAgentMenu();
    }
  }

  function agentRowById(agentId) {
    if (!agentsListEl || !agentId) {
      return null;
    }
    return agentsListEl.querySelector(
      `.agent-block[data-agent="${CSS.escape(agentId)}"]`
    );
  }

  function closeAgentMenu() {
    if (!agentMenuEl) {
      return;
    }
    agentMenuEl.hidden = true;
    const btn = agentsListEl?.querySelector(
      `.agent-more[aria-expanded="true"]`
    );
    btn?.setAttribute("aria-expanded", "false");
    agentMenuAgentId = "";
  }

  function runAgentMenuAction(action, agentId) {
    const a = agentsData.find((item) => item.id === agentId);
    closeAgentMenu();
    if (!a) {
      return;
    }
    if (action === "rename") {
      const nameEl = agentRowById(agentId)?.querySelector(".agent-name");
      if (nameEl) {
        startAgentRename(agentId, nameEl);
      }
    } else if (action === "pin") {
      host.postMessage({ type: "pinAgent", agentId, pinned: !a.pinned });
    } else if (action === "duplicate") {
      if (workspaceNarrow) {
        setAgentsRailOpen(false);
      }
      host.postMessage({ type: "duplicateAgent", agentId });
    } else if (action === "archive") {
      host.postMessage({ type: "archiveAgent", agentId });
    } else if (action === "delete") {
      host.postMessage({ type: "deleteAgent", agentId });
    }
  }

  function openAgentMenu(agentId, anchor) {
    const a = agentsData.find((item) => item.id === agentId);
    if (!a || !agentsScreen) {
      return;
    }
    if (agentMenuAgentId === agentId && agentMenuEl && !agentMenuEl.hidden) {
      closeAgentMenu();
      return;
    }
    closeAgentMenu();
    if (!agentMenuEl) {
      agentMenuEl = document.createElement("div");
      agentMenuEl.className = "agent-menu";
      agentMenuEl.setAttribute("role", "menu");
      agentMenuEl.hidden = true;
      agentMenuEl.addEventListener("click", (event) => {
        const item = event.target.closest("[data-agent-action]");
        if (!item) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        runAgentMenuAction(
          item.getAttribute("data-agent-action"),
          agentMenuAgentId
        );
      });
      agentMenuEl.addEventListener("keydown", (event) => {
        const items = [...agentMenuEl.querySelectorAll("[data-agent-action]")];
        const idx = items.indexOf(document.activeElement);
        if (event.key === "Escape") {
          event.preventDefault();
          const back = agentMenuAgentId;
          closeAgentMenu();
          agentRowById(back)?.querySelector(".agent-more")?.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          items[(idx + step + items.length) % items.length]?.focus();
        }
      });
      agentsScreen.appendChild(agentMenuEl);
    }
    const item = (action, icon, label, extra = "") =>
      `<button type="button" class="agent-menu-item${extra}" role="menuitem" data-agent-action="${action}">` +
      `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>` +
      `<span class="agent-menu-label">${escapeHtml(label)}</span>` +
      (action === "rename" ? `<span class="agent-menu-key">F2</span>` : "") +
      `</button>`;
    agentMenuEl.setAttribute("aria-label", t("agentMenu"));
    agentMenuEl.innerHTML =
      item("rename", "edit", t("agentRename")) +
      item("pin", "keep", a.pinned ? t("agentUnpin") : t("agentPin")) +
      (a.empty ? "" : item("duplicate", "content_copy", t("agentDuplicate"))) +
      `<div class="agent-menu-sep" role="separator"></div>` +
      (a.empty
        ? item("delete", "delete", t("agentDelete"), " is-danger")
        : item("archive", "inventory_2", t("agentArchive")));
    agentMenuAgentId = agentId;
    agentMenuEl.hidden = false;
    anchor?.setAttribute("aria-expanded", "true");
    // Под кнопкой «⋯», по её правому краю (position: fixed — от окна);
    // если не влезает вниз — над ней.
    const r = (anchor || agentRowById(agentId))?.getBoundingClientRect();
    if (r) {
      const menuH = agentMenuEl.offsetHeight;
      let top = r.bottom + 4;
      if (top + menuH > window.innerHeight - 4) {
        top = Math.max(4, r.top - menuH - 4);
      }
      agentMenuEl.style.top = `${Math.round(top)}px`;
      agentMenuEl.style.right = `${Math.max(6, Math.round(window.innerWidth - r.right))}px`;
    }
    agentMenuEl.querySelector("[data-agent-action]")?.focus();
  }

  /** ↑/↓ по строкам, F2 — переименовать, Shift+F10 / ContextMenu — меню. */
  function onAgentsListKeyNav(event) {
    const row = event.target.closest?.(".agent-row[data-agent]");
    if (!row || !agentsListEl.contains(row)) {
      return false;
    }
    if (event.target.closest(".agent-name-input")) {
      return false;
    }
    const agentId = row.getAttribute("data-agent");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const rows = [...agentsListEl.querySelectorAll(".agent-row[data-agent]")];
      const idx = rows.indexOf(row);
      const next = rows[idx + (event.key === "ArrowDown" ? 1 : -1)];
      event.preventDefault();
      if (next) {
        next.focus();
      } else if (event.key === "ArrowUp") {
        agentsFilterEl?.querySelector("input")?.focus();
      }
      return true;
    }
    if (event.key === "F2") {
      event.preventDefault();
      runAgentMenuAction("rename", agentId);
      return true;
    }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      openAgentMenu(
        agentId,
        agentRowById(agentId)?.querySelector(".agent-more")
      );
      return true;
    }
    return false;
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        agentMenuEl &&
        !agentMenuEl.hidden &&
        !agentMenuEl.contains(event.target) &&
        !event.target.closest?.(".agent-more")
      ) {
        closeAgentMenu();
      }
    },
    true
  );

  function syncActiveAgentHighlight() {
    if (!agentsListEl) {
      return;
    }
    for (const a of agentsData) {
      a.active = Boolean(activeAgentId) && a.id === activeAgentId;
    }
    agentsListEl.querySelectorAll(".agent-block[data-agent]").forEach((el) => {
      el.classList.toggle(
        "is-active",
        Boolean(activeAgentId) && el.getAttribute("data-agent") === activeAgentId
      );
    });
  }

  function getAgentNameById(agentId) {
    const row = agentsData.find((a) => a.id === agentId);
    return (row && row.name) || t("agent");
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
    input.setAttribute("aria-label", UI_LANG === "ru" ? "Название агента" : "Agent name");
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
      host.postMessage({
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

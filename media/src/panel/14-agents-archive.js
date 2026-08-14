
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

  function renderAgentsList() {
    if (!agentsListEl) {
      return;
    }
    if (renamingAgentId) {
      syncActiveAgentHighlight();
      return;
    }
    const list = agentsData;

    if (!list.length) {
      agentsListEl.innerHTML =
        `<div class="agents-empty">${t("noAgentsYet")}</div>`;
      return;
    }

    agentsListEl.innerHTML = list
      .map((a) => {
        const action = a.empty
          ? `<button type="button" class="row-action row-delete" data-delete-agent="${a.id}" title="${t("delete")}" aria-label="${t("delete")}">` +
            DELETE_ICON +
            `</button>`
          : `<button type="button" class="row-action row-archive" data-archive-agent="${a.id}" title="${t("archive")}" aria-label="${t("archive")}">` +
            ARCHIVE_ICON +
            `</button>`;
        const runMode = String(a.runMode || "").trim();
        const runModeAttr = runMode
          ? ` data-mode="${escapeHtml(runMode)}"`
          : "";
        const statusHtml =
          a.runState === "running"
            ? `<span class="agent-run-status agent-run-status-running"${runModeAttr} aria-label="Running"><span class="cube-bit cube-bit-1"></span><span class="cube-bit cube-bit-2"></span><span class="cube-bit cube-bit-3"></span><span class="cube-bit cube-bit-4"></span></span>`
            : a.runState === "success"
              ? '<span class="agent-run-status agent-run-status-success" aria-label="Done"><span class="cube-bit cube-bit-1"></span><span class="cube-bit cube-bit-2"></span><span class="cube-bit cube-bit-3"></span><span class="cube-bit cube-bit-4"></span></span>'
              : a.runState === "error"
                ? '<span class="agent-run-status agent-run-status-error" aria-label="Error"><span class="cube-bit cube-bit-1"></span><span class="cube-bit cube-bit-2"></span><span class="cube-bit cube-bit-3"></span><span class="cube-bit cube-bit-4"></span></span>'
                : '<span class="agent-run-status agent-run-status-empty" aria-hidden="true"></span>';
        return (
          `<div class="agent-block${a.active ? " is-active" : ""}" data-agent="${a.id}">` +
          `<div class="agent-row-wrap">` +
          `<div class="agent-row flat" role="button" tabindex="0" data-agent="${a.id}">` +
          `<div class="agent-main">` +
          statusHtml +
          `<div class="agent-name-row">` +
          `<div class="agent-name-wrap"><div class="agent-name"></div></div>` +
          `<div class="agent-trailing">` +
          `<span class="agent-time"></span>` +
          `<div class="row-actions">` +
          action +
          `</div>` +
          `</div>` +
          `</div>` +
          `<div class="agent-preview"></div>` +
          `<span class="agent-chip"></span>` +
          `</div>` +
          `</div>` +
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
      block.querySelector(".agent-name").textContent = a.name || t("agent");
      const chip = block.querySelector(".agent-chip");
      const chipText = shortModelChip(a.model);
      chip.textContent = chipText === "—" ? "" : chipText;
      if (chip.textContent && a.model) {
        chip.title = String(a.model);
      } else {
        chip.removeAttribute("title");
      }
      block.querySelector(".agent-preview").innerHTML = renderPreviewMarkdown(
        a.preview
      );
      block.querySelector(".agent-time").textContent = a.time || "";
    });
  }

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

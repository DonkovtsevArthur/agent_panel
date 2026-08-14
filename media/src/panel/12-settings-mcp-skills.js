  }

  function getMcpServers() {
    if (Array.isArray(mcpServersCache) && mcpServersCache.length) {
      return mcpServersCache.map((s) => ({
        id: s.id,
        name: s.name || s.id,
        enabled: s.enabled !== false,
        state: s.state || "disconnected",
        mode: s.transport || "",
        tools: Number(s.toolCount) || 0,
        transport: s.detail || String(s.transport || ""),
        error: s.state === "error" ? s.message || "" : "",
        builtin: Boolean(s.builtin),
        hasCredentials: Boolean(s.hasCredentials),
      }));
    }
    const tools = Number(figmaStatus.toolCount) || 0;
    const state = figmaStatus.state || "disconnected";
    const mode = figmaStatus.mode || "remote";
    const transport =
      mode === "pat"
        ? "stdio · figma-developer-mcp"
        : "http · https://mcp.figma.com/mcp";
    return [
      {
        id: "figma",
        name: t("figma"),
        enabled: figmaStatus.enabled !== false,
        state,
        mode,
        tools,
        transport,
        error: state === "error" ? figmaStatus.message || "" : "",
        builtin: true,
        hasCredentials: Boolean(figmaStatus.hasPat),
      },
    ];
  }

  function renderMcpServersList() {
    if (!mcpServersList) {
      return;
    }
    const q = String(mcpSearchQuery || "")
      .trim()
      .toLowerCase();
    const servers = getMcpServers().filter((s) => {
      if (!q) {
        return true;
      }
      return (
        s.name.toLowerCase().includes(q) ||
        s.transport.toLowerCase().includes(q) ||
        String(s.error || "")
          .toLowerCase()
          .includes(q)
      );
    });
    if (mcpConfiguredCount) {
      mcpConfiguredCount.textContent = t("mcpConfiguredCount", servers.length);
    }
    if (mcpEmpty) {
      mcpEmpty.hidden = servers.length > 0;
      mcpEmpty.textContent = t("mcpEmpty");
    }
    mcpServersList.innerHTML = "";
    for (const server of servers) {
      const card = document.createElement("article");
      card.className = "mcp-server-card";
      card.dataset.id = server.id;

      const statusClass =
        server.state === "connected"
          ? "is-connected"
          : server.state === "error"
            ? "is-error"
            : server.state === "connecting"
              ? "is-connecting"
              : "";

      const switchOn =
        server.state === "connected" || server.state === "connecting";

      card.innerHTML =
        `<div class="mcp-server-icon"><span class="material-symbols-outlined" aria-hidden="true">electrical_services</span></div>` +
        `<div class="mcp-server-main">` +
        `<div class="mcp-server-title-row">` +
        `<span class="mcp-status-dot ${statusClass}" aria-hidden="true"></span>` +
        `<span class="mcp-server-name"></span>` +
        `<span class="mcp-badge"></span>` +
        `<span class="mcp-badge mcp-badge-tools"></span>` +
        `</div>` +
        `<p class="mcp-server-meta"></p>` +
        `<p class="mcp-server-error" hidden></p>` +
        `</div>` +
        `<div class="mcp-server-actions">` +
        `<label class="mcp-switch" title="${escapeHtml(t("mcpEnable"))}">` +
        `<input type="checkbox" class="mcp-enable-toggle" data-id="${escapeHtml(
          server.id
        )}" ${switchOn ? "checked" : ""} />` +
        `<span class="mcp-switch-track"></span>` +
        `</label>` +
        `<button type="button" class="icon-btn mcp-edit-btn" data-id="${escapeHtml(
          server.id
        )}" title="${escapeHtml(t("settings"))}" aria-label="${escapeHtml(
          t("settings")
        )}">` +
        `<span class="material-symbols-outlined" aria-hidden="true">settings</span>` +
        `</button>` +
        `<button type="button" class="icon-btn mcp-delete-btn" data-id="${escapeHtml(
          server.id
        )}" title="${escapeHtml(t("delete"))}" aria-label="${escapeHtml(
          t("delete")
        )}">` +
        `<span class="material-symbols-outlined" aria-hidden="true">delete</span>` +
        `</button>` +
        `</div>`;

      card.querySelector(".mcp-server-name").textContent = server.name;
      const badges = card.querySelectorAll(".mcp-badge");
      if (badges[0]) badges[0].textContent = t("mcpBadgeUser");
      if (badges[1]) badges[1].textContent = t("mcpBadgeTools", server.tools);
      card.querySelector(".mcp-server-meta").textContent = server.transport;
      const errEl = card.querySelector(".mcp-server-error");
      if (server.error) {
        errEl.hidden = false;
        errEl.textContent = server.error;
      }
      mcpServersList.appendChild(card);
    }
  }

  function skillSourceLabel(source) {
    if (source === "workspace") return t("skillsSourceWorkspace");
    if (source === "global") return t("skillsSourceGlobal");
    return t("skillsSourceExtra");
  }

  function renderSkillsSettings() {
    const directories = Array.isArray(skillsCache.directories)
      ? skillsCache.directories
      : [];
    if (skillsFoldersList) {
      skillsFoldersList.innerHTML = "";
      for (const dir of directories) {
        const source = dir.source || (dir.removable ? "extra" : "workspace");
        const enabled = dir.enabled !== false;
        const displayPath = dir.displayPath || dir.path || "";
        const absPath = dir.path || "";
        const row = document.createElement("div");
        row.className =
          "skills-folder-row" + (enabled ? "" : " skills-folder-row--off");
        row.dataset.source = source;
        row.dataset.path = absPath;

        const titles = document.createElement("div");
        titles.className = "skills-folder-titles";
        const title = document.createElement("div");
        title.className = "skills-folder-title";
        title.textContent = skillSourceLabel(source);
        const pathEl = document.createElement("code");
        pathEl.className = "skills-folder-path";
        pathEl.textContent = displayPath;
        pathEl.title = absPath || displayPath;
        titles.appendChild(title);
        titles.appendChild(pathEl);

        const actions = document.createElement("div");
        actions.className = "skills-folder-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "icon-btn";
        openBtn.setAttribute("data-skills-open", absPath);
        openBtn.title = t("skillsOpen");
        openBtn.setAttribute("aria-label", t("skillsOpen"));
        const openIcon = document.createElement("span");
        openIcon.className = "material-symbols-outlined";
        openIcon.setAttribute("aria-hidden", "true");
        openIcon.textContent = "folder_open";
        openBtn.appendChild(openIcon);
        actions.appendChild(openBtn);

        if (dir.removable) {
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "icon-btn";
          removeBtn.setAttribute("data-skills-remove-dir", absPath);
          removeBtn.title = t("skillsRemoveFolder");
          removeBtn.setAttribute("aria-label", t("skillsRemoveFolder"));
          const removeIcon = document.createElement("span");
          removeIcon.className = "material-symbols-outlined";
          removeIcon.setAttribute("aria-hidden", "true");
          removeIcon.textContent = "delete";
          removeBtn.appendChild(removeIcon);
          actions.appendChild(removeBtn);
        }

        const toggleLabel = document.createElement("label");
        toggleLabel.className = "mcp-switch";
        toggleLabel.title = t("skillsEnabled");
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = enabled;
        toggle.setAttribute("data-skills-source-toggle", source);
        toggle.setAttribute("data-skills-source-path", absPath);
        const track = document.createElement("span");
        track.className = "mcp-switch-track";
        toggleLabel.appendChild(toggle);
        toggleLabel.appendChild(track);
        actions.appendChild(toggleLabel);

        row.appendChild(titles);
        row.appendChild(actions);
        skillsFoldersList.appendChild(row);
      }
    }
  }

  function openMcpEditModal(serverId) {
    if (serverId && serverId !== "figma") {
      openMcpCustomEditModal(serverId);
      return;
    }
    if (!mcpEditModal) {
      return;
    }
    if (mcpEditTitle) {
      mcpEditTitle.textContent = t("figma");
    }
    renderFigmaStatus(figmaStatus);
    mcpEditModal.hidden = false;
  }

  function closeMcpEditModal() {
    if (mcpEditModal) {
      mcpEditModal.hidden = true;
    }
  }

  function syncMcpCustomTransportFields() {
    const isHttp = mcpCustomTransport && mcpCustomTransport.value === "http";
    if (mcpCustomStdioFields) {
      mcpCustomStdioFields.hidden = Boolean(isHttp);
    }
    if (mcpCustomHttpFields) {
      mcpCustomHttpFields.hidden = !isHttp;
    }
  }

  function openMcpCustomEditModal(serverId, presetPrefill) {
    if (!mcpCustomEditModal) {
      return;
    }
    const existing = (mcpServersCache || []).find((s) => s.id === serverId);
    if (mcpCustomEditTitle) {
      mcpCustomEditTitle.textContent = existing
        ? t("mcpCustomTitleEdit")
        : t("mcpCustomTitleNew");
    }
    if (mcpCustomEditId) {
      mcpCustomEditId.value = existing ? existing.id : "";
    }
    if (mcpCustomName) {
      mcpCustomName.value = existing
        ? existing.name || ""
        : presetPrefill?.name || "";
    }
    if (mcpCustomTransport) {
      mcpCustomTransport.value =
        existing && existing.transport === "http"
          ? "http"
          : presetPrefill?.transport === "http"
            ? "http"
            : "stdio";
    }
    if (mcpCustomCommand) {
      mcpCustomCommand.value =
        existing?.command || presetPrefill?.command || "";
    }
    if (mcpCustomArgs) {
      mcpCustomArgs.value = Array.isArray(existing?.args)
        ? existing.args.join(" ")
        : presetPrefill?.argsText || "";
    }
    if (mcpCustomEnv) {
      const env = existing?.env || {};
      mcpCustomEnv.value = existing
        ? Object.entries(env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : presetPrefill?.envText || "";
    }
    if (mcpCustomCwd) {
      mcpCustomCwd.value = existing?.cwd || "";
    }
    if (mcpCustomUrl) {
      mcpCustomUrl.value = existing?.url || presetPrefill?.url || "";
    }
    if (mcpCustomToken) {
      mcpCustomToken.value = "";
    }
    if (existing) {
      if (mcpCustomTransport) {
        mcpCustomTransport.value =
          existing.transport === "http" ? "http" : "stdio";
      }
    } else if (mcpCustomTransport && !presetPrefill) {
      mcpCustomTransport.value = "stdio";
    }
    // Prefill from detail string when config fields are missing
    if (existing?.detail && !existing.command && !existing.url) {
      if (String(existing.transport) === "http" || existing.detail.startsWith("http")) {
        const url = existing.detail.replace(/^http\s*·\s*/i, "").trim();
        if (mcpCustomUrl) mcpCustomUrl.value = url;
        if (mcpCustomTransport) mcpCustomTransport.value = "http";
      } else {
        const rest = existing.detail.replace(/^stdio\s*·\s*/i, "").trim();
        const parts = rest.split(/\s+/).filter(Boolean);
        if (mcpCustomCommand) mcpCustomCommand.value = parts[0] || "";
        if (mcpCustomArgs) mcpCustomArgs.value = parts.slice(1).join(" ");
        if (mcpCustomTransport) mcpCustomTransport.value = "stdio";
      }
    }
    if (mcpCustomNameLabel) mcpCustomNameLabel.textContent = t("mcpCustomName");
    if (mcpCustomTransportLabel) {
      mcpCustomTransportLabel.textContent = t("mcpCustomTransport");
    }
    if (mcpCustomCommandLabel) {
      mcpCustomCommandLabel.textContent = t("mcpCustomCommand");
    }
    if (mcpCustomArgsLabel) mcpCustomArgsLabel.textContent = t("mcpCustomArgs");
    if (mcpCustomEnvLabel) mcpCustomEnvLabel.textContent = t("mcpCustomEnv");
    if (mcpCustomCwdLabel) mcpCustomCwdLabel.textContent = t("mcpCustomCwd");
    if (mcpCustomUrlLabel) mcpCustomUrlLabel.textContent = t("mcpCustomUrl");
    if (mcpCustomTokenLabel) {
      mcpCustomTokenLabel.textContent = t("mcpCustomToken");
    }
    if (mcpCustomEditSaveBtn) {
      mcpCustomEditSaveBtn.textContent = t("mcpCustomSave");
    }
    if (mcpCustomEditCancelBtn) {
      mcpCustomEditCancelBtn.textContent = t("cancel");
    }
    if (mcpPresetsNote) {
      if (presetPrefill?.note) {
        mcpPresetsNote.hidden = false;
        mcpPresetsNote.textContent = presetPrefill.note;
      } else {
        mcpPresetsNote.hidden = true;
        mcpPresetsNote.textContent = "";
      }
    }
    syncMcpCustomTransportFields();
    mcpCustomEditModal.hidden = false;
    if (presetPrefill?.needsBearerToken && mcpCustomToken) {
      mcpCustomToken.focus();
    } else if (mcpCustomName) {
      mcpCustomName.focus();
    }
  }

  const MCP_PRESET_DEFS = {
    playwright: {
      name: "Playwright Browser",
      transport: "stdio",
      command: "npx",
      argsText: "-y @playwright/mcp@latest --headless",
      envText: "",
      url: "",
      needsBearerToken: false,
      noteKey: "mcpPresetPlaywrightNote",
      matchIds: ["playwright", "playwright-browser"],
    },
    github: {
      name: "GitHub",
      transport: "http",
      command: "",
      argsText: "",
      envText: "",
      url: "https://api.githubcopilot.com/mcp/",
      needsBearerToken: true,
      noteKey: "mcpPresetGithubNote",
      matchIds: ["github"],
    },
  };

  function openMcpPreset(presetId) {
    const def = MCP_PRESET_DEFS[presetId];
    if (!def) {
      return;
    }
    const existing = (mcpServersCache || []).find((s) => {
      const id = String(s.id || "").toLowerCase();
      const name = String(s.name || "").toLowerCase();
      return (
        def.matchIds.includes(id) ||
        name === def.name.toLowerCase() ||
        name === String(presetId).toLowerCase()
      );
    });
    if (existing) {
      showCopyToast(t("mcpPresetAlready", existing.name || existing.id));
      openMcpCustomEditModal(existing.id);
      return;
    }
    openMcpCustomEditModal("", {
      name: def.name,
      transport: def.transport,
      command: def.command,
      argsText: def.argsText,
      envText: def.envText,
      url: def.url,
      needsBearerToken: def.needsBearerToken,
      note: t(def.noteKey),
    });
  }

  function closeMcpCustomEditModal() {
    if (mcpCustomEditModal) {
      mcpCustomEditModal.hidden = true;
    }
    if (mcpPresetsNote) {
      mcpPresetsNote.hidden = true;
      mcpPresetsNote.textContent = "";
    }
  }

  function saveMcpCustomServer() {
    const name = mcpCustomName ? mcpCustomName.value.trim() : "";
    if (!name) {
      showCopyToast(t("mcpNameRequired"));
      return;
    }
    const transport =
      mcpCustomTransport && mcpCustomTransport.value === "http"
        ? "http"
        : "stdio";
    if (transport === "stdio") {
      const command = mcpCustomCommand ? mcpCustomCommand.value.trim() : "";
      if (!command) {
        showCopyToast(t("mcpCommandRequired"));
        return;
      }
    } else {
      const url = mcpCustomUrl ? mcpCustomUrl.value.trim() : "";
      if (!url) {
        showCopyToast(t("mcpUrlRequired"));
        return;
      }
    }
    host.postMessage({
      type: "mcpUpsertServer",
      server: {
        id: mcpCustomEditId ? mcpCustomEditId.value.trim() : "",
        name,
        transport,
        command: mcpCustomCommand ? mcpCustomCommand.value.trim() : "",
        argsText: mcpCustomArgs ? mcpCustomArgs.value : "",
        envText: mcpCustomEnv ? mcpCustomEnv.value : "",
        cwd: mcpCustomCwd ? mcpCustomCwd.value.trim() : "",
        url: mcpCustomUrl ? mcpCustomUrl.value.trim() : "",
        bearerToken: mcpCustomToken ? mcpCustomToken.value : "",
        enabled: true,
        connect: true,
      },
    });
    closeMcpCustomEditModal();
  }


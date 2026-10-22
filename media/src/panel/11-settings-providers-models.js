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

  // Mirror of src/config.ts baseUrlSuggestsPromptCache — used to pre-check the
  // per-provider prompt-cache checkbox for newly added providers whose baseUrl
  // looks like an upstream that accepts Anthropic-style cache_control markers
  // (LiteLLM / OpenRouter / Anthropic-compatible). Conservative: plain OpenAI
  // stays off to avoid 400s.
  function baseUrlSuggestsPromptCache(baseUrl) {
    const url = String(baseUrl || "").toLowerCase();
    if (!url) {
      return false;
    }
    if (/api\.openai\.com/.test(url)) {
      return false;
    }
    return (
      /litellm/.test(url) ||
      /openrouter\.ai/.test(url) ||
      /anthropic\.com/.test(url) ||
      /claude\.ai/.test(url) ||
      /aihubmix|sapaicore|vertex|ai-sdk/.test(url)
    );
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
      statusUrl: provider.statusUrl || "",
      ...(typeof provider.promptCache === "boolean"
        ? { promptCache: provider.promptCache }
        : {}),
      ...(provider.protocol ? { protocol: provider.protocol } : {}),
    };
  }

  function fillModelProviderSelect(selectedId) {
    if (!modelEditProvider) {
      return;
    }
    const fallback = primaryProviderId();
    const current = selectedId || fallback || NEW_PROVIDER_VALUE;
    modelEditProvider.innerHTML = "";
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
    const createOpt = document.createElement("option");
    createOpt.value = NEW_PROVIDER_VALUE;
    createOpt.textContent = t("newProviderOption");
    modelEditProvider.appendChild(createOpt);
    if (
      current &&
      Array.from(modelEditProvider.options).some((o) => o.value === current)
    ) {
      modelEditProvider.value = current;
    } else if (modelEditProvider.options.length) {
      modelEditProvider.selectedIndex = 0;
    }
    syncModelNewProviderFields();
  }

  function syncModelNewProviderFields() {
    const show =
      Boolean(modelEditNewProvider) &&
      modelEditProvider &&
      modelEditProvider.value === NEW_PROVIDER_VALUE;
    if (modelEditNewProvider) {
      modelEditNewProvider.hidden = !show;
    }
  }

  function clearModelNewProviderFields() {
    if (modelEditNewProviderId) modelEditNewProviderId.value = "";
    if (modelEditNewProviderName) modelEditNewProviderName.value = "";
    if (modelEditNewProviderUrl) modelEditNewProviderUrl.value = "";
    if (modelEditNewProviderKey) modelEditNewProviderKey.value = "";
  }

  function createProviderFromModelForm() {
    const id = modelEditNewProviderId
      ? modelEditNewProviderId.value.trim()
      : "";
    const baseUrl = modelEditNewProviderUrl
      ? modelEditNewProviderUrl.value.trim().replace(/\/$/, "")
      : "";
    const fail = (msg) => {
      setModelsHint(msg, true);
      setJsonHint(msg, true);
    };
    if (!id) {
      fail(t("providerIdRequired"));
      modelEditNewProviderId?.focus();
      return null;
    }
    if (!baseUrl) {
      fail(t("providerBaseUrlRequired"));
      modelEditNewProviderUrl?.focus();
      return null;
    }
    if (settingsProviders.some((p) => p.id === id)) {
      fail(t("providerExists", id));
      modelEditNewProviderId?.focus();
      return null;
    }
    const name = modelEditNewProviderName
      ? modelEditNewProviderName.value.trim()
      : "";
    const apiKey = modelEditNewProviderKey
      ? modelEditNewProviderKey.value
      : "";
    const next = {
      id,
      name: name || id,
      baseUrl,
      apiKey,
      promptCache: baseUrlSuggestsPromptCache(baseUrl),
    };
    settingsProviders.push(next);
    selectedSettingsProviderKey = id;
    return id;
  }

  function openProviderEditModal(index, preset) {
    if (!providerEditModal) {
      return;
    }
    providerEditIndex = index;
    const isNew = index === -1;
    const provider = isNew
      ? preset || { id: "", name: "", baseUrl: "", apiKey: "", statusUrl: "" }
      : settingsProviders[index] || {
          id: "",
          name: "",
          baseUrl: "",
          apiKey: "",
          statusUrl: "",
        };
    if (providerEditTitle) {
      providerEditTitle.textContent = isNew ? t("newProvider") : t("providerTitle");
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
    if (providerEditStatusUrl) {
      providerEditStatusUrl.value = provider.statusUrl || "";
      providerEditStatusUrl.placeholder = provider.baseUrl
        ? `${String(provider.baseUrl).replace(/\/$/, "")}/models`
        : "https://…/models";
    }
    if (providerEditApiKey) {
      providerEditApiKey.value = provider.apiKey || "";
    }
    if (providerEditPromptCache) {
      // Existing provider: honor its stored flag. New provider: smart default
      // based on the baseUrl (litellm / openrouter / anthropic → on, plain
      // OpenAI → off). User can always toggle. Re-evaluated on base URL change
      // while the provider is still unset (isNew && no explicit prior value).
      const stored = provider.promptCache;
      if (typeof stored === "boolean") {
        providerEditPromptCache.checked = stored;
      } else if (isNew) {
        providerEditPromptCache.checked = baseUrlSuggestsPromptCache(
          provider.baseUrl || ""
        );
      } else {
        providerEditPromptCache.checked = true;
      }
    }
    if (providerEditProtocol) {
      providerEditProtocol.value = provider.protocol || "openai-compatible";
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
      setProvidersHint(t("providerIdRequired"), true);
      providerEditId?.focus();
      return;
    }
    if (!baseUrl) {
      setProvidersHint(t("providerBaseUrlRequired"), true);
      providerEditBaseUrl?.focus();
      return;
    }
    const name = providerEditName ? providerEditName.value.trim() : "";
    const apiKey = providerEditApiKey ? providerEditApiKey.value : "";
    const statusUrl = providerEditStatusUrl
      ? providerEditStatusUrl.value.trim().replace(/\/$/, "")
      : "";
    const promptCache = providerEditPromptCache
      ? providerEditPromptCache.checked === true
      : false;
    const protocol = providerEditProtocol
      ? providerEditProtocol.value
      : "openai-compatible";
    const next = { id, name: name || id, baseUrl, apiKey, promptCache };
    if (protocol && protocol !== "openai-compatible") {
      next.protocol = protocol;
    }
    if (statusUrl && statusUrl !== baseUrl) {
      next.statusUrl = statusUrl;
    }

    if (providerEditIndex === -1) {
      if (settingsProviders.some((p) => p.id === id)) {
        setProvidersHint(t("providerExists", id), true);
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
    if (next.id) {
      selectedSettingsProviderKey = String(next.id).trim();
    }
    renderSettingsProviders();
    renderSettingsModels();
    fillModelProviderSelect(modelEditProvider?.value || "");
    schedulePersistSettings(0);
    // Corporate Gennadiy gateway: open the login form as soon as the
    // provider is saved — no need to hit 401 first.
    if (looksLikeGennadiyProvider(next)) {
      host.postMessage({ type: "gennadiyLogin" });
    }
  }

  function renderSettingsProviders() {
    renderSettingsCatalog();
  }

  const ORPHANS_PROVIDER_KEY = "__orphans__";

  function providerSelectionKey(provider) {
    return String(provider?.id || "").trim();
  }

  function modelsForProviderKey(key) {
    if (key === ORPHANS_PROVIDER_KEY) {
      const usedIds = new Set(
        settingsProviders.map((p) => String(p.id || "").trim()).filter(Boolean)
      );
      return settingsModels
        .map((model, index) => ({ model, index }))
        .filter(({ model }) => {
          const pid = String(model.providerId || "").trim();
          return !pid || !usedIds.has(pid);
        });
    }
    return settingsModels
      .map((model, index) => ({ model, index }))
      .filter(
        ({ model }) => String(model.providerId || "").trim() === key
      );
  }

  function listProviderSelectionKeys() {
    const keys = settingsProviders
      .map(providerSelectionKey)
      .filter(Boolean);
    if (modelsForProviderKey(ORPHANS_PROVIDER_KEY).length) {
      keys.push(ORPHANS_PROVIDER_KEY);
    }
    return keys;
  }

  function ensureSelectedSettingsProvider() {
    const keys = listProviderSelectionKeys();
    if (!keys.length) {
      selectedSettingsProviderKey = "";
      return;
    }
    if (!keys.includes(selectedSettingsProviderKey)) {
      selectedSettingsProviderKey = keys[0];
    }
  }

  function selectSettingsProvider(key) {
    const next = String(key || "");
    if (next && next === selectedSettingsProviderKey) {
      return;
    }
    selectedSettingsProviderKey = next;
    renderSettingsCatalog();
  }

  function selectedProviderLabel() {
    if (!selectedSettingsProviderKey) {
      return "";
    }
    if (selectedSettingsProviderKey === ORPHANS_PROVIDER_KEY) {
      return t("otherProvider");
    }
    return providerLabel(selectedSettingsProviderKey);
  }

  function looksLikeGennadiyProvider(provider) {
    const id = String(provider?.id || "").toLowerCase();
    const name = String(provider?.name || "").toLowerCase();
    const baseUrl = String(provider?.baseUrl || "").toLowerCase();
    return (
      id.includes("gennadiy") ||
      name.includes("gennadiy") ||
      baseUrl.includes("gennadiy")
    );
  }

  function appendProviderHead(listEl, provider, index) {
    const row = document.createElement("div");
    const providerId = String(provider.id || "").trim();
    const selectionKey = providerId || ORPHANS_PROVIDER_KEY;
    const selected = selectedSettingsProviderKey === selectionKey;
    const gennadiy = looksLikeGennadiyProvider(provider);
    row.className =
      "settings-provider-head settings-provider-select" +
      (selected ? " is-selected" : "");
    row.dataset.providerIndex = String(index);
    row.dataset.providerKey = selectionKey;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", selected ? "true" : "false");
    row.tabIndex = 0;
    if (providerId) {
      row.dataset.providerId = providerId;
    }
    const title = provider.name || provider.id || t("providerTitle");
    const modelCount = modelsForProviderKey(selectionKey).length;
    row.innerHTML =
      `<div class="settings-model-info">` +
      `<div class="settings-model-name">` +
      `<span class="provider-status-dot" data-state="unknown" aria-hidden="true"></span>` +
      `<span class="provider-status-title"></span>` +
      `<span class="provider-status-text" data-state="unknown"></span>` +
      `</div>` +
      `<div class="settings-model-id"></div>` +
      `</div>` +
      `<span class="settings-provider-count" aria-hidden="true"></span>` +
      (gennadiy
        ? `<button type="button" class="text-btn settings-provider-login" data-index="${index}" title="${t("gennadiyLogin")}" aria-label="${t("gennadiyLogin")}">${t("gennadiyLogin")}</button>`
        : "") +
      `<button type="button" class="icon-btn settings-provider-fetch" data-index="${index}" title="${t("fetchModels")}" aria-label="${t("fetchModels")}">` +
      CLOUD_DOWNLOAD_ICON +
      `</button>` +
      `<button type="button" class="icon-btn settings-provider-edit" data-index="${index}" title="${t("settings")}" aria-label="${t("settings")}">` +
      SETTINGS_ICON +
      `</button>` +
      `<button type="button" class="icon-btn settings-provider-remove" data-index="${index}" title="${t("delete")}" aria-label="${t("delete")}">` +
      DELETE_ICON +
      `</button>`;
    row.querySelector(".provider-status-title").textContent = title;
    row.querySelector(".settings-model-id").textContent =
      provider.baseUrl || provider.id || "";
    const countEl = row.querySelector(".settings-provider-count");
    if (countEl) {
      countEl.textContent = String(modelCount);
    }
    listEl.appendChild(row);
    applyProviderHeadStatus(row, providerConnById[providerId]);
  }

  function providerConnShortLabel(state, message) {
    if (state === "connecting") {
      return t("providerConnShortConnecting");
    }
    if (state === "connected") {
      return t("providerConnShortConnected");
    }
    if (state === "error") {
      return t("providerConnShortError", message || "");
    }
    return t("providerConnShortUnknown");
  }

  function applyProviderHeadStatus(row, status) {
    if (!row) {
      return;
    }
    const state = status?.state || "unknown";
    const message = status?.message || "";
    const label = providerConnShortLabel(state, message);
    const dot = row.querySelector(".provider-status-dot");
    const text = row.querySelector(".provider-status-text");
    if (dot) {
      dot.dataset.state = state;
    }
    if (text) {
      text.dataset.state = state;
      text.textContent = label;
    }
    row.title = label;
  }

  function applyProviderStatusDots() {
    document
      .querySelectorAll(".settings-provider-head[data-provider-id]")
      .forEach((row) => {
        const id = row.dataset.providerId || "";
        applyProviderHeadStatus(row, providerConnById[id]);
      });
  }

  function ingestProviderConnStatuses(list) {
    if (!Array.isArray(list)) {
      return;
    }
    for (const status of list) {
      const id = String(status?.providerId || "").trim();
      if (!id) {
        continue;
      }
      providerConnById[id] = status;
    }
    applyProviderStatusDots();
  }

  function appendModelRow(listEl, model, index, nested) {
    const row = document.createElement("div");
    const enabled = model.enabled !== false;
    const favorite = model.favorite === true;
    row.className =
      "settings-model-row" +
      (enabled ? "" : " is-disabled") +
      (nested ? " is-under-provider" : "");
    row.dataset.index = String(index);
    const title = model.label || model.id || t("noId");
    const parts = [];
    if (model.label && model.id && model.label !== model.id) {
      parts.push(model.id);
    }
    if (!nested) {
      parts.push(providerLabel(model.providerId));
    }
    const subtitle = parts.join(" · ");
    row.innerHTML =
      `<label class="settings-model-switch" title="${enabled ? t("disable") : t("enable")}">` +
      `<input type="checkbox" class="settings-model-toggle" data-index="${index}" ${
        enabled ? "checked" : ""
      } />` +
      `<span class="settings-model-switch-ui" aria-hidden="true"></span>` +
      `</label>` +
      `<div class="settings-model-info">` +
      `<div class="settings-model-title">` +
      `<div class="settings-model-name"></div>` +
      `<button type="button" class="icon-btn settings-model-info-btn" data-index="${index}" title="${t("modelParameters")}" aria-label="${t("modelParameters")}">` +
      INFO_ICON +
      `</button>` +
      `</div>` +
      `<div class="settings-model-id"></div>` +
      `</div>` +
      `<button type="button" class="icon-btn settings-model-fav${
        favorite ? " is-on" : ""
      }" data-index="${index}" title="${
        favorite ? t("removeFromFavorites") : t("addToFavorites")
      }" aria-label="${
        favorite ? t("removeFromFavorites") : t("addToFavorites")
      }" aria-pressed="${favorite ? "true" : "false"}">` +
      HEART_ICON +
      `</button>` +
      `<button type="button" class="icon-btn settings-model-edit" data-index="${index}" title="${t("settings")}" aria-label="${t("settings")}">` +
      SETTINGS_ICON +
      `</button>` +
      `<button type="button" class="icon-btn settings-model-remove" data-index="${index}" title="${t("delete")}" aria-label="${t("delete")}">` +
      DELETE_ICON +
      `</button>`;
    row.querySelector(".settings-model-name").textContent = title;
    row.querySelector(".settings-model-id").textContent = subtitle;
    listEl.appendChild(row);
  }

  function appendOrphanProviderHead(listEl) {
    const selected = selectedSettingsProviderKey === ORPHANS_PROVIDER_KEY;
    const modelCount = modelsForProviderKey(ORPHANS_PROVIDER_KEY).length;
    const row = document.createElement("div");
    row.className =
      "settings-provider-head settings-provider-select" +
      (selected ? " is-selected" : "");
    row.dataset.providerKey = ORPHANS_PROVIDER_KEY;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", selected ? "true" : "false");
    row.tabIndex = 0;
    row.innerHTML =
      `<div class="settings-model-info">` +
      `<div class="settings-model-name">` +
      `<span class="provider-status-title"></span>` +
      `</div>` +
      `<div class="settings-model-id"></div>` +
      `</div>` +
      `<span class="settings-provider-count" aria-hidden="true"></span>`;
    row.querySelector(".provider-status-title").textContent =
      t("otherProvider");
    row.querySelector(".settings-model-id").textContent = "";
    const countEl = row.querySelector(".settings-provider-count");
    if (countEl) {
      countEl.textContent = String(modelCount);
    }
    listEl.appendChild(row);
  }

  /**
   * Первый запуск: вместо голого «Нет провайдеров» — карточка с пресетами.
   * Пресет только заполняет форму провайдера (адрес); ключ вводит
   * пользователь, ничего не отправляется до сохранения.
   */
  const PROVIDER_ONBOARDING_PRESETS = [
    {
      id: "gennadiy",
      name: "Gennadiy",
      baseUrl: "https://gennadiy-test.kube.severstal.severstalgroup.com/gennadiy/v1",
    },
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
    { id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1" },
    { id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  ];

  function buildProvidersOnboarding() {
    const card = document.createElement("div");
    card.className = "providers-onboarding";
    const title = document.createElement("div");
    title.className = "providers-onboarding-title";
    title.textContent = t("providersEmptyTitle");
    const note = document.createElement("div");
    note.className = "providers-onboarding-note";
    note.textContent = t("providersEmptyNote");
    const presets = document.createElement("div");
    presets.className = "providers-onboarding-presets";
    const addPreset = (label, preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "text-btn providers-onboarding-preset";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        setProvidersHint("");
        openProviderEditModal(
          -1,
          preset
            ? {
                id: preset.id,
                name: preset.name,
                baseUrl: preset.baseUrl,
                apiKey: "",
                statusUrl: "",
              }
            : undefined
        );
      });
      presets.appendChild(btn);
    };
    for (const preset of PROVIDER_ONBOARDING_PRESETS) {
      addPreset(preset.name, preset);
    }
    addPreset(t("providersEmptyCustom"), null);
    card.append(title, note, presets);
    return card;
  }

  function renderSettingsCatalog() {
    if (!settingsProvidersList || !settingsModelsList) {
      return;
    }
    hideSettingsModelTip();
    sortSettingsModels();
    ensureSelectedSettingsProvider();
    settingsProvidersList.innerHTML = "";
    settingsModelsList.innerHTML = "";

    if (!settingsProviders.length && !settingsModels.length) {
      settingsProvidersList.innerHTML = "";
      settingsProvidersList.appendChild(buildProvidersOnboarding());
      settingsModelsList.innerHTML =
        `<div class="settings-models-empty">${t("selectProviderToSeeModels")}</div>`;
      syncDefaultModelSelect();
      return;
    }

    if (!settingsProviders.length) {
      settingsProvidersList.innerHTML =
        `<div class="settings-models-empty">${t("noProvidersOrModels")}</div>`;
    } else {
      settingsProvidersList.setAttribute("role", "listbox");
      settingsProviders.forEach((provider, providerIndex) => {
        appendProviderHead(settingsProvidersList, provider, providerIndex);
      });
    }

    const orphanEntries = modelsForProviderKey(ORPHANS_PROVIDER_KEY);
    if (orphanEntries.length) {
      appendOrphanProviderHead(settingsProvidersList);
    }

    const header = document.createElement("div");
    header.className = "settings-catalog-models-head";
    const titleEl = document.createElement("div");
    titleEl.className = "settings-catalog-models-title";
    titleEl.textContent =
      selectedSettingsProviderKey === ORPHANS_PROVIDER_KEY
        ? t("otherProvider")
        : selectedProviderLabel() || t("models");
    header.appendChild(titleEl);
    const countEl = document.createElement("div");
    countEl.className = "settings-catalog-models-count";
    const entries = selectedSettingsProviderKey
      ? modelsForProviderKey(selectedSettingsProviderKey)
      : [];
    countEl.textContent = String(entries.length);
    header.appendChild(countEl);
    if (entries.length) {
      appendDeleteAllModelsControl(header, entries.length);
    } else {
      settingsModelsDeleteAllConfirmKey = "";
    }
    settingsModelsList.appendChild(header);

    if (!selectedSettingsProviderKey) {
      const empty = document.createElement("div");
      empty.className = "settings-models-empty";
      empty.textContent = t("selectProviderToSeeModels");
      settingsModelsList.appendChild(empty);
    } else if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "settings-models-empty";
      empty.textContent = t("noModelsForProvider");
      settingsModelsList.appendChild(empty);
    } else {
      for (const { model, index } of entries) {
        appendModelRow(settingsModelsList, model, index, true);
      }
    }

    syncDefaultModelSelect();
  }

  /** Provider key whose «Delete all» is awaiting the inline confirmation. */
  let settingsModelsDeleteAllConfirmKey = "";

  function appendDeleteAllModelsControl(header, count) {
    const confirming =
      settingsModelsDeleteAllConfirmKey === selectedSettingsProviderKey;
    if (!confirming) {
      settingsModelsDeleteAllConfirmKey = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-btn settings-models-delete-all";
      btn.title = t("deleteAllModels");
      btn.setAttribute("aria-label", t("deleteAllModels"));
      btn.innerHTML = DELETE_SWEEP_ICON;
      btn.addEventListener("click", () => {
        settingsModelsDeleteAllConfirmKey = selectedSettingsProviderKey;
        renderSettingsCatalog();
      });
      header.appendChild(btn);
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "settings-models-delete-all-confirm";
    const text = document.createElement("span");
    text.className = "settings-models-delete-all-text";
    text.textContent = t("deleteAllModelsConfirm", count);
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "text-btn settings-models-delete-all-yes";
    yes.textContent = t("delete");
    yes.addEventListener("click", () => {
      deleteAllModelsOfSelectedProvider();
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "text-btn";
    no.textContent = t("cancel");
    no.addEventListener("click", () => {
      settingsModelsDeleteAllConfirmKey = "";
      renderSettingsCatalog();
    });
    wrap.append(text, yes, no);
    header.appendChild(wrap);
  }

  function deleteAllModelsOfSelectedProvider() {
    const key = selectedSettingsProviderKey;
    settingsModelsDeleteAllConfirmKey = "";
    if (!key) {
      return;
    }
    const drop = new Set(modelsForProviderKey(key).map(({ index }) => index));
    if (!drop.size) {
      renderSettingsCatalog();
      return;
    }
    settingsModels = settingsModels.filter((_, index) => !drop.has(index));
    setModelsHint("");
    renderSettingsModels();
    schedulePersistSettings(0);
  }

  function renderSettingsModels() {
    renderSettingsCatalog();
    fillCommitMessageModelCheckboxes(readCommitMessageModelIdsFromDom());
    fillVisionModelCheckboxes(readVisionModelIdsFromDom());
  }

  function fillCommitMessageModelCheckboxes(selectedIds) {
    if (!settingsCommitModelList) {
      return;
    }
    const selected = new Set(
      (Array.isArray(selectedIds) ? selectedIds : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    );
    settingsCommitMessageModelIds = [...selected];
    const enabled = settingsModels
      .filter((m) => m && m.id && m.enabled !== false)
      .slice()
      .sort((a, b) =>
        String(a.label || a.id).localeCompare(String(b.label || b.id))
      );
    settingsCommitModelList.innerHTML = "";
    for (const model of enabled) {
      const label = document.createElement("label");
      label.className = "settings-fetch-model-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.modelId = model.id;
      if (selected.has(model.id)) {
        cb.checked = true;
      }
      const span = document.createElement("span");
      span.className = "settings-fetch-model-id";
      span.textContent = model.label || model.id;
      label.appendChild(cb);
      label.appendChild(span);
      settingsCommitModelList.appendChild(label);
    }
  }

  function readCommitMessageModelIdsFromDom() {
    if (!settingsCommitModelList) {
      return settingsCommitMessageModelIds.slice();
    }
    const fromDom = [
      ...settingsCommitModelList.querySelectorAll("input:checked"),
    ]
      .map((el) => String(el.dataset.modelId || "").trim())
      .filter(Boolean);
    // Empty list while models still loading — keep last known selection.
    if (
      fromDom.length === 0 &&
      settingsCommitModelList.querySelectorAll("input").length === 0 &&
      settingsCommitMessageModelIds.length > 0
    ) {
      return settingsCommitMessageModelIds.slice();
    }
    settingsCommitMessageModelIds = fromDom;
    return fromDom;
  }

  function fillVisionModelCheckboxes(selectedIds) {
    if (!settingsVisionModelList) {
      return;
    }
    const selected = new Set(
      (Array.isArray(selectedIds) ? selectedIds : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    );
    settingsVisionModelIds = [...selected];
    const enabled = settingsModels
      .filter((m) => m && m.id && m.enabled !== false)
      .slice()
      .sort((a, b) => {
        const aVis = mSupportsVision(a);
        const bVis = mSupportsVision(b);
        if (aVis !== bVis) {
          return aVis ? -1 : 1;
        }
        return String(a.label || a.id).localeCompare(String(b.label || b.id));
      });
    settingsVisionModelList.innerHTML = "";
    for (const model of enabled) {
      const label = document.createElement("label");
      label.className = "settings-fetch-model-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.modelId = model.id;
      if (selected.has(model.id)) {
        cb.checked = true;
      }
      const span = document.createElement("span");
      span.className = "settings-fetch-model-id";
      const name = model.label || model.id;
      span.textContent = mSupportsVision(model)
        ? name
        : name + " · text";
      label.appendChild(cb);
      label.appendChild(span);
      settingsVisionModelList.appendChild(label);
    }
  }

  function mSupportsVision(model) {
    if (!model) {
      return false;
    }
    if (typeof model.supportsVision === "boolean") {
      return model.supportsVision;
    }
    return Boolean(guessModelSupportsVision && guessModelSupportsVision(model.id));
  }

  function readVisionModelIdsFromDom() {
    if (!settingsVisionModelList) {
      return settingsVisionModelIds.slice();
    }
    const fromDom = [
      ...settingsVisionModelList.querySelectorAll("input:checked"),
    ]
      .map((el) => String(el.dataset.modelId || "").trim())
      .filter(Boolean);
    if (
      fromDom.length === 0 &&
      settingsVisionModelList.querySelectorAll("input").length === 0 &&
      settingsVisionModelIds.length > 0
    ) {
      return settingsVisionModelIds.slice();
    }
    settingsVisionModelIds = fromDom;
    return fromDom;
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

  function readVisionFromArchitecture(raw) {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const nested = [raw.architecture, raw.model_info, raw.modelInfo, raw.info];
    for (const src of nested) {
      if (!src || typeof src !== "object") {
        continue;
      }
      const modalities =
        src.input_modalities || src.inputModalities || src.modality;
      if (Array.isArray(modalities)) {
        if (modalities.some((item) => /image/i.test(String(item)))) {
          return true;
        }
      } else if (typeof modalities === "string" && /image/i.test(modalities)) {
        return true;
      }
    }
    // opencode: "modalities": {"input": ["text", "image"], "output": [...]}
    const modalities = raw.modalities;
    if (modalities && typeof modalities === "object" && !Array.isArray(modalities)) {
      const input = modalities.input;
      if (Array.isArray(input)) {
        return input.some((item) => /image/i.test(String(item)));
      }
    }
    return undefined;
  }

  /** Model `options` (opencode) → extra chat/completions body fields. */
  const RESERVED_REQUEST_OPTION_KEYS = new Set([
    "model",
    "messages",
    "tools",
    "tool_choice",
    "stream",
    "stream_options",
  ]);

  function readModelRequestOptions(raw) {
    const value = pickField(raw, [
      "requestOptions",
      "options",
      "extra_body",
      "extraBody",
    ]);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (!key || RESERVED_REQUEST_OPTION_KEYS.has(key) || item === undefined) {
        continue;
      }
      out[key] = item;
    }
    return Object.keys(out).length ? out : undefined;
  }

  function cloneRequestOptions(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      return undefined;
    }
    try {
      const copy = JSON.parse(JSON.stringify(options));
      return Object.keys(copy).length ? copy : undefined;
    } catch {
      return undefined;
    }
  }

  function pickPositiveIntField(raw, keys) {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const lowerMap = new Map(
      Object.entries(raw).map(([k, v]) => [String(k).toLowerCase(), v])
    );
    for (const key of keys) {
      const value = Object.prototype.hasOwnProperty.call(raw, key)
        ? raw[key]
        : lowerMap.get(String(key).toLowerCase());
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) {
        return Math.floor(n);
      }
    }
    return undefined;
  }

  function collectTokenLimitSources(raw) {
    const sources = [raw];
    for (const value of Object.values(raw)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        sources.push(value);
      }
    }
    return sources;
  }

  function pickTokenLimitFromSources(sources, keys) {
    for (const source of sources) {
      const value = pickPositiveIntField(source, keys);
      if (value != null) {
        return value;
      }
    }
    return undefined;
  }

  function readModelTokenLimits(raw) {
    if (!raw || typeof raw !== "object") {
      return {};
    }
    const sources = collectTokenLimitSources(raw);
    const contextWindow = pickTokenLimitFromSources(sources, [
      "max_input_tokens",
      "maxInputTokens",
      "max_input",
      "maxInput",
      "input_tokens",
      "inputTokens",
      "context_window",
      "contextWindow",
      "context_length",
      "contextLength",
      "max_context_tokens",
      "maxContextTokens",
      "max_context",
      "maxContext",
      "context",
    ]);
    const maxOutputTokens =
      pickTokenLimitFromSources(sources, [
        "max_output_tokens",
        "maxOutputTokens",
        "max_output",
        "maxOutput",
        "max_completion_tokens",
        "maxCompletionTokens",
        "output_tokens",
        "outputTokens",
        "completion_tokens",
        "completionTokens",
        "output",
      ]) ??
      pickTokenLimitFromSources(sources, ["max_tokens", "maxTokens"]);
    const limits = {};
    if (contextWindow != null && contextWindow >= 1024) {
      limits.contextWindow = contextWindow;
    }
    if (maxOutputTokens != null) {
      limits.maxOutputTokens = maxOutputTokens;
    }
    return limits;
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

    const limits = readModelTokenLimits(raw);
    const visionRaw = pickField(raw, [
      "supportsVision",
      "supports_vision",
      "vision",
      "multimodal",
    ]);
    const visionFromArchitecture = readVisionFromArchitecture(raw);
    const requestOptions = readModelRequestOptions(raw);
    const providerId = String(
      pickField(raw, [
        "providerId",
        "provider_id",
        "provider",
        "providerID",
      ]) || ""
    ).trim();
    const model = { id, label, enabled: true };
    if (providerId) {
      model.providerId = providerId;
    }
    if (limits.contextWindow) {
      model.contextWindow = limits.contextWindow;
    }
    if (limits.maxOutputTokens) {
      model.maxOutputTokens = limits.maxOutputTokens;
    }
    if (requestOptions) {
      model.requestOptions = requestOptions;
    }
    if (
      visionRaw === true ||
      visionRaw === "true" ||
      visionRaw === 1 ||
      visionFromArchitecture === true
    ) {
      model.supportsVision = true;
    } else if (
      ((visionRaw === false ||
        visionRaw === "false" ||
        visionRaw === 0) &&
        !guessModelSupportsVision(id)) ||
      // Explicit opencode modalities without "image" — text-only model.
      (visionRaw == null && visionFromArchitecture === false)
    ) {
      model.supportsVision = false;
    }
    return model;
  }

  function wireModelId(model) {
    return String(model?.apiModelId || model?.id || "").trim();
  }

  function cloneModel(model) {
    return {
      id: model.id || "",
      label: model.label || "",
      providerId: model.providerId || "",
      apiModelId: model.apiModelId || "",
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      enabled: model.enabled !== false,
      favorite: model.favorite === true,
      supportsVision:
        typeof model.supportsVision === "boolean"
          ? model.supportsVision
          : guessModelSupportsVision(model.id),
      requestOptions: cloneRequestOptions(model.requestOptions),
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

  function upsertModels(incoming, defaultProviderId) {
    const fallbackProvider = String(defaultProviderId || "").trim();
    const byId = new Map();
    const rowKey = (m) =>
      `${String(m.providerId || "").trim()}|${String(m.id || "").trim()}`;
    for (const model of settingsModels) {
      const id = String(model.id || "").trim();
      if (id) {
        byId.set(rowKey(model), cloneModel(model));
      }
    }
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      const model = normalizeModelEntry(item);
      if (!model) {
        continue;
      }
      const providerId =
        String(model.providerId || "").trim() || fallbackProvider;
      const key = `${providerId}|${model.id}`;
      if (byId.has(key)) {
        const prev = byId.get(key);
        byId.set(key, {
          id: model.id,
          label: model.label || prev.label || model.id,
          apiModelId: model.apiModelId || prev.apiModelId || "",
          providerId: providerId || prev.providerId || "",
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
          requestOptions: cloneRequestOptions(
            model.requestOptions || prev.requestOptions
          ),
        });
        updated += 1;
      } else {
        const next = cloneModel(model);
        next.providerId = providerId || next.providerId || "";
        // Newly added models start switched off — the user enables them explicitly.
        next.enabled = false;
        byId.set(`${next.providerId || ""}|${model.id}`, next);
        added += 1;
      }
    }
    settingsModels = Array.from(byId.values());
    sortSettingsModels();
    renderSettingsModels();
    return { added, updated, total: settingsModels.filter((m) => m.id).length };
  }

  function addMissingModelsFromIds(ids, providerId) {
    const provider = String(providerId || "").trim();
    // Key by provider+id: the same wire id can exist on several providers
    // (ai-platform + гена both serve `deepseek-v4.1-flash`).
    const existing = new Set(
      settingsModels
        .map((m) => `${String(m.providerId || "").trim()}|${String(m.id || "").trim()}`)
        .filter((k) => !k.endsWith("|"))
    );
    const incoming = [];
    let skipped = 0;
    for (const raw of ids) {
      const id = String(raw || "").trim();
      if (!id) {
        continue;
      }
      const key = `${provider}|${id}`;
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      const extra = fetchModelsById.get(id) || {};
      // Unique picker id when another provider already owns this wire id.
      const idTaken = settingsModels.some(
        (m) => String(m.id || "").trim() === id
      );
      const pickerId = idTaken ? `${provider}/${id}` : id;
      incoming.push({
        id: pickerId,
        apiModelId: idTaken ? id : "",
        label: extra.label || (idTaken ? `${provider} · ${id}` : id),
        providerId: provider,
        contextWindow: extra.contextWindow,
        maxOutputTokens: extra.maxOutputTokens,
        enabled: true,
        supportsVision: guessModelSupportsVision(id),
      });
      existing.add(key);
    }
    if (!incoming.length) {
      return { added: 0, skipped, total: settingsModels.filter((m) => m.id).length };
    }
    const result = upsertModels(incoming, provider);
    return { added: result.added, skipped, total: result.total };
  }

  function fillExistingModelLimitsFromFetch() {
    const provider = String(fetchModelsProviderId || "").trim();
    let changed = 0;
    for (const model of settingsModels) {
      const id = String(model.id || "").trim();
      if (!id) {
        continue;
      }
      const extra = fetchModelsById.get(id);
      if (!extra) {
        continue;
      }
      const modelProvider = String(model.providerId || "").trim();
      if (provider && modelProvider && modelProvider !== provider) {
        continue;
      }
      if (!model.contextWindow && extra.contextWindow) {
        model.contextWindow = extra.contextWindow;
        changed += 1;
      }
      if (!model.maxOutputTokens && extra.maxOutputTokens) {
        model.maxOutputTokens = extra.maxOutputTokens;
        changed += 1;
      }
    }
    if (changed) {
      renderSettingsModels();
      schedulePersistSettings(0);
    }
    return changed;
  }

  function providerById(providerId) {
    const id = String(providerId || "").trim();
    if (!id) {
      return null;
    }
    return settingsProviders.find((p) => p.id === id) || null;
  }

  function setFetchModelsHint(el, text, isError) {
    if (!el) {
      return;
    }
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function resetFetchModelsState() {
    fetchModelsIds = [];
    fetchModelsById = new Map();
    fetchModelsSelected = new Set();
    fetchModelsExisting = new Set();
    fetchModelsLoading = false;
    fetchModelsError = "";
  }

  function currentFetchListEls() {
    if (fetchModelsTarget === "editApi") {
      return {
        list: modelEditApiList,
        status: modelEditApiStatus,
        searchWrap: modelEditApiSearchWrap,
        search: modelEditApiSearch,
        selectBtn: modelEditApiSelectNewBtn,
        selectWrap: null,
      };
    }
    return {
      list: fetchModelsList,
      status: fetchModelsStatus,
      searchWrap: fetchModelsSearchWrap,
      search: fetchModelsSearch,
      selectBtn: fetchModelsSelectNewBtn,
      selectWrap: fetchModelsSelectWrap,
    };
  }

  function renderFetchModelsPicker() {
    const els = currentFetchListEls();
    const filter = String(els.search?.value || "")
      .trim()
      .toLowerCase();
    const newIds = fetchModelsIds.filter((id) => !fetchModelsExisting.has(id));
    const ids = (filter
      ? newIds.filter((id) => id.toLowerCase().includes(filter))
      : newIds.slice()
    );
    const staleIds = fetchStaleModelIds();
    const staleShown = filter
      ? staleIds.filter((id) => id.toLowerCase().includes(filter))
      : staleIds;
    const hasNew = newIds.length > 0;
    const hasChanges = hasNew || staleIds.length > 0;
    const showList = hasChanges && !fetchModelsLoading && !fetchModelsError;

    if (els.searchWrap) {
      els.searchWrap.hidden = !showList;
    }
    // No per-model selection: every new model is added (switched off).
    if (els.selectWrap) {
      els.selectWrap.hidden = true;
    }
    if (els.selectBtn) {
      els.selectBtn.hidden = true;
    }
    if (els.list) {
      els.list.hidden = !showList;
      els.list.innerHTML = "";
    }

    if (fetchModelsLoading) {
      setFetchModelsHint(els.status, t("fetchModelsLoading"), false);
      if (fetchModelsAddBtn && fetchModelsTarget === "modal") {
        fetchModelsAddBtn.disabled = true;
      }
      syncFetchModelsAddEnabled();
      return;
    }
    if (fetchModelsError) {
      setFetchModelsHint(
        els.status,
        t("fetchModelsFailed", fetchModelsError),
        true
      );
      if (fetchModelsAddBtn && fetchModelsTarget === "modal") {
        fetchModelsAddBtn.disabled = true;
      }
      syncFetchModelsAddEnabled();
      return;
    }
    if (!fetchModelsIds.length) {
      setFetchModelsHint(els.status, t("fetchModelsEmpty"), false);
      if (fetchModelsAddBtn && fetchModelsTarget === "modal") {
        fetchModelsAddBtn.disabled = true;
      }
      syncFetchModelsAddEnabled();
      return;
    }

    if (!hasChanges) {
      setFetchModelsHint(
        els.status,
        t("fetchModelsNoneNew", fetchModelsIds.length),
        false
      );
      syncFetchModelsAddEnabled();
      return;
    }

    setFetchModelsHint(
      els.status,
      t("fetchModelsCount", fetchModelsIds.length, newIds.length, staleIds.length),
      false
    );

    if (!els.list) {
      syncFetchModelsAddEnabled();
      return;
    }
    for (const id of ids) {
      const row = document.createElement("div");
      row.className = "settings-fetch-model-row is-readonly";
      row.innerHTML = `<span class="settings-fetch-model-id"></span>`;
      row.querySelector(".settings-fetch-model-id").textContent = id;
      els.list.appendChild(row);
    }
    // Models gone from the provider's /models — removed on apply.
    for (const id of staleShown) {
      const row = document.createElement("div");
      row.className = "settings-fetch-model-row is-readonly is-removed";
      row.title = t("fetchModelsWillRemove");
      row.innerHTML =
        DELETE_ICON + `<span class="settings-fetch-model-id"></span>`;
      row.querySelector(".settings-fetch-model-id").textContent = id;
      els.list.appendChild(row);
    }
    syncFetchModelsAddEnabled();
  }

  /**
   * Ids of this provider's saved models that the provider no longer lists.
   * An empty /models answer never counts as «everything is gone».
   */
  function fetchStaleModelIds() {
    const provider = String(fetchModelsProviderId || "").trim();
    if (
      !provider ||
      fetchModelsLoading ||
      fetchModelsError ||
      !fetchModelsIds.length
    ) {
      return [];
    }
    const listed = new Set(fetchModelsIds.map((id) => String(id || "").trim()));
    return settingsModels
      .filter((m) => String(m.providerId || "").trim() === provider)
      .map((m) => wireModelId(m))
      .filter((id) => id && !listed.has(id));
  }

  function syncFetchModelsAddEnabled() {
    const selectedNew = Array.from(fetchModelsSelected).filter(
      (id) => !fetchModelsExisting.has(id)
    );
    const hasChanges = selectedNew.length > 0 || fetchStaleModelIds().length > 0;
    if (fetchModelsAddBtn && fetchModelsTarget === "modal") {
      fetchModelsAddBtn.disabled =
        fetchModelsLoading || Boolean(fetchModelsError) || !hasChanges;
    }
    if (modelEditDoneBtn && fetchModelsTarget === "editApi" && modelEditMode === "api") {
      modelEditDoneBtn.disabled =
        fetchModelsLoading || Boolean(fetchModelsError) || !hasChanges;
      if (!fetchModelsLoading && !fetchModelsError && fetchModelsIds.length === 0) {
        modelEditDoneBtn.disabled = true;
      }
    }
  }

  function selectNewFetchModels() {
    fetchModelsSelected = new Set(
      fetchModelsIds.filter((id) => !fetchModelsExisting.has(id))
    );
    renderFetchModelsPicker();
  }

  function requestProviderModels(providerId, target) {
    const provider = providerById(providerId);
    if (!provider) {
      setModelsHint(t("fetchModelsNeedProvider"), true);
      return false;
    }
    const baseUrl = String(provider.baseUrl || "")
      .trim()
      .replace(/\/$/, "");
    if (!baseUrl) {
      setModelsHint(t("fetchModelsNeedBaseUrl"), true);
      return false;
    }

    fetchModelsTarget = target === "editApi" ? "editApi" : "modal";
    fetchModelsProviderId = provider.id;
    fetchModelsRequestId += 1;
    const requestId = `fetch-models-${fetchModelsRequestId}`;
    fetchModelsActiveRequestId = requestId;
    resetFetchModelsState();
    fetchModelsLoading = true;
    // Wire ids already saved under THIS provider (apiModelId || id).
    // Do not treat other providers' rows as "already here" — the same
    // `deepseek-v4.1-flash` can exist on default and on гена.
    fetchModelsExisting = new Set(
      settingsModels
        .filter((m) => String(m.providerId || "").trim() === provider.id)
        .map((m) => wireModelId(m))
        .filter(Boolean)
    );
    renderFetchModelsPicker();

    host.postMessage({
      type: "listProviderModels",
      requestId,
      providerId: provider.id,
      baseUrl,
      apiKey: provider.apiKey || "",
      rejectUnauthorized: settingsRejectUnauthorized
        ? settingsRejectUnauthorized.checked
        : false,
    });
    return requestId;
  }

  function openFetchModelsModal(providerIndex) {
    if (!fetchModelsModal) {
      return;
    }
    const provider = settingsProviders[providerIndex];
    if (!provider) {
      return;
    }
    if (fetchModelsTitle) {
      const name = provider.name || provider.id || t("providerTitle");
      fetchModelsTitle.textContent = `${t("fetchModelsTitle")} · ${name}`;
    }
    if (fetchModelsSearch) {
      fetchModelsSearch.value = "";
    }
    fetchModelsModal.hidden = false;
    if (!requestProviderModels(provider.id, "modal")) {
      closeFetchModelsModal();
    }
  }

  function closeFetchModelsModal() {
    if (!fetchModelsModal) {
      return;
    }
    fetchModelsModal.hidden = true;
    if (fetchModelsTarget === "modal") {
      resetFetchModelsState();
      fetchModelsProviderId = "";
    }
  }

  function applyFetchedModels() {
    const selectedNew = Array.from(fetchModelsSelected).filter(
      (id) => !fetchModelsExisting.has(id)
    );
    const stale = new Set(fetchStaleModelIds());
    if (!selectedNew.length && !stale.size) {
      if (fetchModelsTarget === "editApi") {
        setFetchModelsHint(modelEditApiStatus, t("fetchModelsNoneSelected"), true);
      } else {
        setFetchModelsHint(fetchModelsStatus, t("fetchModelsNoneSelected"), true);
      }
      return false;
    }
    // Sync with the provider: drop models it no longer lists, add new ones.
    const provider = String(fetchModelsProviderId || "").trim();
    let removed = 0;
    if (stale.size) {
      const before = settingsModels.length;
      settingsModels = settingsModels.filter(
        (m) =>
          String(m.providerId || "").trim() !== provider ||
          !stale.has(wireModelId(m))
      );
      removed = before - settingsModels.length;
    }
    const result = selectedNew.length
      ? addMissingModelsFromIds(selectedNew, fetchModelsProviderId)
      : { added: 0, skipped: 0 };
    if (removed) {
      renderSettingsModels();
    }
    setModelsHint(t("fetchModelsDone", result.added, result.skipped, removed));
    schedulePersistSettings(0);
    return true;
  }

  function normalizeListedProviderModel(item) {
    if (typeof item === "string") {
      const id = item.trim();
      return id ? { id } : null;
    }
    if (!item || typeof item !== "object") {
      return null;
    }
    const id = String(item.id || "").trim();
    if (!id) {
      return null;
    }
    const model = { id };
    const label = String(item.label || "").trim();
    if (label && label !== id) {
      model.label = label;
    }
    const limits = readModelTokenLimits(item);
    if (limits.contextWindow) {
      model.contextWindow = limits.contextWindow;
    }
    if (limits.maxOutputTokens) {
      model.maxOutputTokens = limits.maxOutputTokens;
    }
    return model;
  }

  function onProviderModelsListed(msg) {
    const requestId = String(msg?.requestId || "");
    if (!requestId || requestId !== fetchModelsActiveRequestId) {
      return;
    }
    if (String(msg.providerId || "") !== fetchModelsProviderId) {
      return;
    }
    fetchModelsLoading = false;
    if (msg.error) {
      fetchModelsError = String(msg.error);
      fetchModelsIds = [];
      fetchModelsById = new Map();
      fetchModelsSelected = new Set();
    } else {
      fetchModelsError = "";
      const listed = Array.isArray(msg.models)
        ? msg.models.map(normalizeListedProviderModel).filter(Boolean)
        : [];
      fetchModelsById = new Map(listed.map((model) => [model.id, model]));
      fetchModelsIds = listed.map((model) => model.id);
      fetchModelsSelected = new Set(
        fetchModelsIds.filter((id) => !fetchModelsExisting.has(id))
      );
      fillExistingModelLimitsFromFetch();
    }
    renderFetchModelsPicker();
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

    return modelsFromKeyedMap(parsed);
  }

  /**
   * opencode-style map keyed by model id:
   * {"deepseek-v4.1-flash": {"limit": {...}, "options": {...}, "modalities": {...}}}
   * (also under "provider" → <id> → "models").
   */
  function modelsFromKeyedMap(parsed) {
    const provider = pickField(parsed, ["provider", "providers"]);
    if (provider && typeof provider === "object" && !Array.isArray(provider)) {
      const fromProviders = [];
      for (const entry of Object.values(provider)) {
        const models =
          entry && typeof entry === "object" ? pickField(entry, ["models"]) : null;
        if (models && typeof models === "object" && !Array.isArray(models)) {
          fromProviders.push(...(modelsFromKeyedMap(models) || []));
        }
      }
      if (fromProviders.length) {
        return fromProviders;
      }
    }
    const entries = Object.entries(parsed);
    if (
      !entries.length ||
      !entries.every(
        ([key, value]) =>
          String(key).trim() &&
          (value === true ||
            (value && typeof value === "object" && !Array.isArray(value)))
      )
    ) {
      return null;
    }
    return entries.map(([key, value]) => {
      const body = value && typeof value === "object" ? value : {};
      const ownId = pickField(body, ["id", "model", "model_id", "modelId"]);
      return { ...body, id: String(ownId || key).trim() };
    });
  }

  /**
   * Pasted opencode fragments: `["id": {...}]` (map in array brackets) or a
   * bare `"id": {...}` without the outer braces.
   */
  function parseLooseKeyedModels(text) {
    let inner = text;
    if (inner.startsWith("[") && inner.endsWith("]")) {
      inner = inner.slice(1, -1).trim();
    }
    inner = inner.replace(/,\s*$/, "");
    if (!inner.startsWith('"')) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(`{${inner}}`);
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  function parseModelsJson(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      throw new Error(t("pasteModelJson"));
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = parseLooseKeyedModels(text);
      if (parsed === undefined) {
        throw new Error(t("invalidJson"));
      }
    }
    const items = extractModelsList(parsed);
    if (!items) {
      throw new Error(t("noModelListInJson"));
    }
    return items;
  }

  function resolveProviderFromModelForm() {
    let providerId = modelEditProvider ? modelEditProvider.value.trim() : "";
    if (providerId === NEW_PROVIDER_VALUE) {
      const createdId = createProviderFromModelForm();
      if (!createdId) {
        return null;
      }
      providerId = createdId;
      clearModelNewProviderFields();
      fillModelProviderSelect(providerId);
    }
    if (!providerId) {
      return null;
    }
    return providerId;
  }

  function importModelsFromJson() {
    try {
      const providerId = resolveProviderFromModelForm();
      if (!providerId) {
        if (modelEditProvider?.value === NEW_PROVIDER_VALUE) {
          return false;
        }
        throw new Error(t("providerRequired"));
      }
      const items = parseModelsJson(settingsModelsJson?.value || "");
      const normalized = items
        .map((item) => normalizeModelEntry(item))
        .filter(Boolean);
      if (!normalized.length) {
        throw new Error(t("noModelsWithId"));
      }
      const result = upsertModels(normalized, providerId);
      setJsonHint(t("doneImport", result.added, result.updated, result.total));
      return true;
    } catch (error) {
      setJsonHint(error.message || t("importFailed"), true);
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
        if (m.requestOptions) {
          row.options = m.requestOptions;
        }
        return row;
      });
    const text = JSON.stringify(payload, null, 2);
    if (settingsModelsJson) {
      settingsModelsJson.value = text;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setJsonHint(t("listCopied")),
        () => setJsonHint(t("jsonFilledBelow"))
      );
    } else {
      setJsonHint(t("jsonFilledBelow"));
    }
  }

  function firstEnabledSettingsModelId() {
    const model = settingsModels.find(
      (m) => String(m.id || "").trim() && m.enabled !== false
    );
    return model ? String(model.id).trim() : "";
  }

  function syncDefaultModelSelect() {
    settingsDefaultModelId = firstEnabledSettingsModelId();
  }

  function setModelEditMode(mode) {
    modelEditMode =
      mode === "json" ? "json" : mode === "api" ? "api" : "manual";
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
    if (modelEditApiPane) {
      modelEditApiPane.hidden = modelEditMode !== "api";
    }
    if (modelEditDoneBtn) {
      modelEditDoneBtn.disabled = false;
      if (modelEditMode === "json") {
        modelEditDoneBtn.textContent = t("apply");
      } else if (modelEditMode === "api") {
        modelEditDoneBtn.textContent = t("fetchModelsAddSelected");
      } else {
        modelEditDoneBtn.textContent = t("done");
      }
    }
    if (modelEditMode === "api") {
      fetchModelsTarget = "editApi";
      if (modelEditApiSearch) {
        modelEditApiSearch.value = "";
      }
      const providerId = modelEditProvider?.value?.trim() || "";
      if (providerId && providerId !== NEW_PROVIDER_VALUE) {
        requestProviderModels(providerId, "editApi");
      } else {
        resetFetchModelsState();
        setFetchModelsHint(
          modelEditApiStatus,
          t("fetchModelsNeedProvider"),
          true
        );
        if (modelEditApiList) {
          modelEditApiList.hidden = true;
          modelEditApiList.innerHTML = "";
        }
        if (modelEditApiSearchWrap) modelEditApiSearchWrap.hidden = true;
        if (modelEditApiSelectNewBtn) modelEditApiSelectNewBtn.hidden = true;
        if (modelEditDoneBtn) modelEditDoneBtn.disabled = true;
      }
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
      modelEditTitle.textContent = isNew ? t("addModels") : t("modelSettings");
    }
    if (modelEditTabs) {
      modelEditTabs.hidden = !isNew;
    }
    setModelEditMode("manual");
    setJsonHint("");
    clearModelNewProviderFields();
    if (modelEditId) {
      modelEditId.value = model.id || "";
    }
    if (modelEditLabel) {
      modelEditLabel.value = model.label || "";
    }
    const preferredProvider = isNew
      ? (selectedSettingsProviderKey &&
        selectedSettingsProviderKey !== ORPHANS_PROVIDER_KEY
          ? selectedSettingsProviderKey
          : primaryProviderId()) || NEW_PROVIDER_VALUE
      : model.providerId || primaryProviderId() || NEW_PROVIDER_VALUE;
    fillModelProviderSelect(preferredProvider);
    syncModelNewProviderFields();
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
    if (modelEditProvider?.value === NEW_PROVIDER_VALUE) {
      modelEditNewProviderId?.focus();
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
    clearModelNewProviderFields();
    if (modelEditDoneBtn) {
      modelEditDoneBtn.disabled = false;
      modelEditDoneBtn.textContent = t("done");
    }
    if (modelEditNewProvider) {
      modelEditNewProvider.hidden = true;
    }
  }

  function applyModelEditModal() {
    if (modelEditIndex === -1 && modelEditMode === "json") {
      if (importModelsFromJson()) {
        closeModelEditModal();
        setModelsHint(t("modelsAddedFromJson"));
        schedulePersistSettings(0);
      }
      return;
    }
    if (modelEditIndex === -1 && modelEditMode === "api") {
      if (applyFetchedModels()) {
        closeModelEditModal();
      }
      return;
    }

    const id = modelEditId ? modelEditId.value.trim() : "";
    if (!id) {
      setModelsHint(t("modelIdRequired"), true);
      setModelEditMode("manual");
      modelEditId?.focus();
      return;
    }
    const providerId = resolveProviderFromModelForm();
    if (!providerId) {
      setModelsHint(t("providerRequired"), true);
      setModelEditMode("manual");
      if (modelEditProvider?.value === NEW_PROVIDER_VALUE) {
        modelEditNewProviderId?.focus();
      } else {
        modelEditProvider?.focus();
      }
      return;
    }
    const label = modelEditLabel ? modelEditLabel.value.trim() : "";
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
          requestOptions: cloneRequestOptions(prev.requestOptions),
        };
      } else {
        settingsModels.push({ ...next, enabled: false });
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
        setModelsHint(`A model with id "${id}" already exists.`, true);
        return;
      }
      settingsModels[modelEditIndex] = {
        ...next,
        enabled: prev.enabled !== false,
        favorite: prev.favorite === true,
        // Manual form has no field for model JSON `options` — keep them.
        requestOptions: cloneRequestOptions(prev.requestOptions),
      };
    }
    closeModelEditModal();
    setModelsHint("");
    setProvidersHint("");
    sortSettingsModels();
    renderSettingsCatalog();
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
      t("name"),
      t("provider"),
      t("contextInput"),
      t("responseOutput"),
      t("status"),
      t("favorite"),
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
      model.enabled !== false ? t("enabled") : t("disabled"),
      model.favorite === true ? t("yes") : t("no"),
      resolveModelSupportsVision(model) ? t("yes") : t("no"),
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

  function renderProviderConnStatus(status) {
    const id = String(status?.providerId || "").trim();
    if (id) {
      providerConnById[id] = status || providerConnById[id] || {};
      applyProviderStatusDots();
    }
    if (!providerConnStatusEl) {
      return;
    }
    const state = status?.state || "unknown";
    const name = String(status?.providerName || status?.providerId || "").trim();
    let text = t("providerConnUnknown");
    if (state === "connecting") {
      text = t("providerConnConnecting");
    } else if (state === "connected") {
      text = t("providerConnConnected", name);
    } else if (state === "error") {
      text = t("providerConnError", status?.message || "");
    }
    providerConnStatusEl.hidden = false;
    providerConnStatusEl.dataset.state = state;
    providerConnStatusEl.textContent = text;
    providerConnStatusEl.title = name
      ? `${name}${status?.message ? ` — ${status.message}` : ""}`
      : text;
  }

  function renderFigmaStatus(status) {
    figmaStatus = status || figmaStatus || { state: "disconnected", enabled: true };
    const state = figmaStatus.state || "disconnected";
    const mode = figmaStatus.mode || "";
    const toolCount = figmaStatus.toolCount;
    if (settingsFigmaStatus) {
      if (state === "connected") {
        settingsFigmaStatus.textContent = t(
          "figmaStatusConnected",
          mode,
          toolCount
        );
      } else if (state === "connecting") {
        settingsFigmaStatus.textContent = t("figmaStatusConnecting");
      } else if (state === "error") {
        settingsFigmaStatus.textContent = t(
          "figmaStatusError",
          figmaStatus.message || ""
        );
      } else {
        settingsFigmaStatus.textContent = t("figmaStatusDisconnected");
      }
    }
    const connected = state === "connected";
    const connecting = state === "connecting";
    // OAuth Connect Figma is primary; PAT stays visible as fallback.
    if (settingsFigmaConnectBtn) {
      settingsFigmaConnectBtn.hidden = connected;
      settingsFigmaConnectBtn.disabled = connecting;
    }
    if (settingsFigmaDisconnectBtn) {
      settingsFigmaDisconnectBtn.hidden = !connected && state !== "error";
      settingsFigmaDisconnectBtn.disabled = connecting;
    }
    if (settingsFigmaPatBlock) {
      settingsFigmaPatBlock.hidden = false;
    }
    if (settingsFigmaPatConnectBtn) {
      settingsFigmaPatConnectBtn.disabled = connecting;
    }
    renderMcpServersList();

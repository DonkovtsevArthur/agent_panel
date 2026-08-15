(function () {
  /**
   * Host bridge: JetBrains JCEF injects `globalThis.__harborHost`.
   * VS Code webview falls back to acquireVsCodeApi() — zero behavior change.
   * @type {{ postMessage: (msg: unknown) => void, getState: () => any, setState: (s: any) => void }}
   */
  const host =
    (typeof globalThis !== "undefined" && globalThis.__harborHost) ||
    acquireVsCodeApi();
  const state = host.getState() || {
    selectedModel: null,
    draftPrompt: "",
    modelByChat: {},
    modeByChat: {},
    reasonByChat: {},
    agentsRailOpen: false,
  };
  if (typeof state.draftPrompt !== "string") {
    state.draftPrompt = "";
  }
  if (!state.modelByChat || typeof state.modelByChat !== "object") {
    state.modelByChat = {};
  }
  if (!state.modeByChat || typeof state.modeByChat !== "object") {
    state.modeByChat = {};
  }
  if (!state.reasonByChat || typeof state.reasonByChat !== "object") {
    state.reasonByChat = {};
  }
  if (typeof state.agentsRailOpen !== "boolean") {
    state.agentsRailOpen = false;
  }
  let UI_LANG = document.documentElement.lang.startsWith("ru") ? "ru" : "en";
  /** Host-resolved language for setting `auto` (IDE / VS Code display language). */
  let hostResolvedUiLang = UI_LANG;
  const UI_SURFACE =
    document.documentElement.getAttribute("data-surface") === "settings"
      ? "settings"
      : "panel";
  const UI_STRINGS = {
    en: {
      agents: "Agents",
      settings: "Settings",
      archive: "Archive",
      newAgent: "New Agent",
      backToAgents: "Back to agents",
      showAgentsList: "Show agents",
      hideAgentsList: "Hide agents",
      closeSettings: "Close settings",
      saved: "Saved",
      providers: "Providers",
      providersNote:
        "Base URL and API key for each OpenAI-compatible API. Models are grouped under their provider.",
      addProvider: "+ Provider",
      models: "Models",
      modelsProviders: "Models & providers",
      defaultModel: "Default model",
      addModel: "+ Model",
      newProviderOption: "+ New provider…",
      providerIdLabel: "Provider ID",
      providerNameLabel: "Provider name",
      otherProvider: "Other",
      noProvidersOrModels: "No providers yet — add a provider or a model.",
      baseUrl: "Base URL",
      statusUrl: "Status URL",
      statusUrlHint: "Empty = Base URL + /models",
      apiKey: "API Key",
      modes: "Modes",
      modesNote:
        "Agent, Plan, and Ask are built in and can also be edited. Custom modes can be added and removed.",
      addModeShort: "+ Mode",
      languageSection: "Language",
      pluginUiLanguage: "Plugin UI language",
      languageAuto: "Auto (follow VS Code)",
      languageEn: "English",
      languageRu: "Русский",
      appearanceSection: "Appearance",
      appearanceNote: "Chat text and composer size in the panel.",
      fontSize: "Font size",
      fontSizeHint: "Applies to messages and the input field.",
      fontSizeValue: (n) => `${n} px`,
      fontSizePreview: "The agent will reply at this size.",
      tls: "TLS",
      validateTls: "Validate TLS certificate",
      agentBehavior: "Agent behavior",
      browserAgent: "Browser agent",
      browserAgentTitle: "Browser agent",
      browserAgentNote: "Multi-step tasks in your Chrome or Edge.",
      autoglmEnabled: "Enable browser agent",
      autoglmEnabledNote:
        "The browser_task tool. Needs AutoGLM CLI and the extension.",
      autoglmBrowser: "Browser",
      autoglmBrowserHint: "Install the AutoGLM extension and enable it.",
      autoglmAutoApprove: "Auto-approve sensitive actions",
      autoglmAutoApproveNote:
        "No prompt for sensitive steps. Login and captcha still need you.",
      autoglmConnection: "Connection",
      autoglmBinaryPath: "CLI path",
      autoglmBinaryPathPlaceholder: "autoglm on PATH, or full path",
      autoglmBinaryPathHint:
        "Empty — taken from PATH. Saving writes ~/.openclaw-autoclaw/config.json",
      advancedSettings: "Advanced",
      commitMessages: "Commit messages",
      commitMessagesNote: "Generate SCM commit messages from the diff.",
      commitGeneration: "Generation",
      commitStorage: "Save location",
      commitScope: "Apply to",
      commitScopeGlobal: "All workspaces",
      commitScopeWorkspace: "This workspace",
      commitScopeWorkspaceNamed: (name) =>
        name ? `This workspace (${name})` : "This workspace",
      commitScopeHint: "Where these settings are saved.",
      commitLanguage: "Language",
      commitLanguageAuto: "Auto (follow UI language)",
      commitModel: "Model",
      commitModelEmpty: "Auto (light model)",
      commitPrompt: "Prompt / rule",
      commitPromptEmpty: "Empty — project rules, then the built-in default.",
      commitPromptPlaceholder:
        "Optional. Example: write short English commit messages focused on why.",
      figma: "Figma",
      mcpServers: "MCP Servers",
      mcpServersNote: "Manage MCP connections used by Harbor Agents (Figma and more).",
      skillsSection: "Skills",
      skillsNote:
        "Skills are SKILL.md packs that load when relevant. Put them in the project or global folders listed below.",
      skillsEnabled: "Enable skills",
      skillsRefresh: "Refresh",
      skillsAddFolder: "Add folder",
      skillsOpenHarbor: "Open workspace folder",
      skillsOpenGlobal: "Open global folder",
      skillsListTitle: "Installed skills",
      skillsFoldersTitle: "Where Harbor looks",
      skillsFoldersDisabledHint: "A disabled folder is not sent to the model.",
      skillsEmpty: "",
      skillsSourceWorkspace: "This workspace",
      skillsSourceGlobal: "All workspaces",
      skillsSourceExtra: "Extra folder",
      skillsOpen: "Open",
      skillsRemoveFolder: "Remove",
      skillsBuiltinFolder: "Built-in",
      mcpServersOpen: "Open connection list",
      mcpSubtitle: "Manage MCP server configurations used by Harbor Agents.",
      mcpSearchPlaceholder: "Search MCP servers...",
      mcpConfigured: "Configured MCP servers",
      mcpConfiguredCount: (n) => (n === 1 ? "1 item" : `${n} items`),
      mcpEmpty: "No MCP servers yet.",
      mcpBadgeUser: "User",
      mcpBadgeTools: (n) => `${n} tools`,
      mcpEditNote:
        "Connect Figma via browser OAuth. Personal Access Token is an optional fallback.",
      mcpCustomTitleNew: "Add MCP server",
      mcpCustomTitleEdit: "Edit MCP server",
      mcpCustomName: "Name",
      mcpCustomTransport: "Transport",
      mcpCustomCommand: "Command",
      mcpCustomArgs: "Args",
      mcpCustomEnv: "Env (KEY=value per line)",
      mcpCustomCwd: "Working directory (optional)",
      mcpCustomUrl: "URL",
      mcpCustomToken: "Bearer token (optional)",
      mcpCustomSave: "Save & Connect",
      mcpNameRequired: "Enter a server name.",
      mcpCommandRequired: "Enter a command for stdio.",
      mcpUrlRequired: "Enter a URL for HTTP.",
      mcpPresetsLabel: "Quick add",
      mcpPresetPlaywright: "Playwright",
      mcpPresetGithub: "GitHub",
      mcpPresetPlaywrightNote:
        "Interactive browser via Playwright MCP. Needs Node.js / npx. Harbor also has builtin browser_* tools.",
      mcpPresetGithubNote:
        "GitHub remote MCP. Paste a Personal Access Token into Bearer token, then Save & Connect.",
      mcpPresetAlready: (name) => `«${name}» is already in the list — open settings on the card to edit.`,
      mcpEnable: "Enable",
      mcpReconnect: "Reconnect",
      figmaEnable: "Enable Figma MCP",
      figmaStatusDisconnected: "Status: Disconnected",
      figmaStatusConnecting: "Status: Connecting…",
      figmaStatusConnected: (mode, n) =>
        `Status: Connected (${mode || "MCP"}${typeof n === "number" ? `, ${n} tools` : ""})`,
      figmaStatusError: (msg) =>
        msg ? `Status: Error — ${msg}` : "Status: Error",
      providerConnUnknown: "Status: Unknown",
      providerConnConnecting: "Status: Connecting…",
      providerConnConnected: (name) =>
        name ? `Status: Connected · ${name}` : "Status: Connected",
      providerConnError: (msg) =>
        msg ? `Status: Offline (${msg})` : "Status: Offline",
      providerConnShortUnknown: "Unknown",
      providerConnShortConnecting: "Connecting…",
      providerConnShortConnected: "Connected",
      providerConnShortError: (msg) =>
        msg ? `Offline (${msg})` : "Offline",
      figmaConnect: "Connect Figma",
      figmaDisconnect: "Disconnect",
      figmaPatNote:
        "Optional fallback: create a token in Figma → Settings → Security → Personal access tokens, paste it here, then Connect with token.",
      figmaPatLabel: "Personal Access Token",
      figmaPatConnect: "Connect with token",
      figmaNeedsConnectToast:
        "Figma is not connected — open Settings → MCP Servers → Connect Figma",
      figmaOpenTokenHelp: "Open token settings",
      backToSettings: "Back to settings",
      systemPrompt: "System prompt",
      systemPromptEmpty: "Empty",
      agentLimits: "Limits",
      agentExecution: "Execution",
      agentInterface: "Interface",
      maxToolRounds: "Max tool rounds",
      maxTokens: "Response limit",
      maxTokensHint: "tokens",
      maxResponseLength: "Max length",
      maxResponseCharsHint: "characters",
      soundNotifications: "Sound notifications",
      soundNotificationsNote: "Signal when the agent finishes a turn.",
      parallelAgents: "Parallel agents",
      parallelAgentsNote: "Child agents. In Plan and Ask they only read.",
      parallelToolCalls: "Parallel tool calls",
      parallelToolCallsNote:
        "Independent tools from one response run together.",
      autoCompact: "Auto compact",
      autoCompactNote: "Compress the chat near the model window limit.",
      toolsAutoApprove: "Auto-approve tools",
      toolsAutoApproveNote: "No prompt. Off — ask every time.",
      approvalReads: "Reads",
      approvalReadsNote: "read_files, search_codebase, skills",
      approvalWeb: "Web fetch",
      approvalWebNote: "fetch_web_content",
      approvalEdits: "Edits",
      approvalEditsNote: "editor, apply_patch",
      approvalCommands: "Commands",
      approvalCommandsNote: "run_commands (terminal)",
      approvalMcp: "MCP tools",
      approvalMcpNote: "Figma and custom MCP servers",
      approvalSubagents: "Subagents",
      approvalSubagentsNote: "spawn_agent",
      approvalInherit: "Like master",
      approvalAuto: "Auto",
      approvalAsk: "Ask",
      focusChain: "Focus chain",
      focusChainNote:
        "Agent keeps a task checklist; re-injected each turn.",
      checkpoints: "Workspace checkpoints",
      checkpointsNote:
        "Git snapshot at the start of a turn. The card rolls back files.",
      checkpointRestore: "Restore workspace files from this checkpoint?",
      checkpointCompare: "Compare checkpoint with workspace",
      todoPlanTitle: "Plan",
      todoPlanStepDone: "done",
      todoPlanStepInProgress: "in progress",
      todoPlanStepPending: "pending",
      cancelledByUser: "Cancelled by user",
      tabAutocomplete: "Tab autocomplete",
      tabAutocompleteEnable: "Enable Tab autocomplete",
      tabAutocompleteNote:
        "Quiet prefetch. ⌘⏎ to show, Tab to accept.",
      tabAutocompleteModel: "Tab model",
      tabAutocompleteModelEmpty: "Select a model",
      tabAutocompleteModelHint:
        "Coder models usually beat chat/flash for Tab.",
      tabAutocompleteAgg: "Aggressiveness",
      tabAutocompleteAggLow: "Low — fewer requests",
      tabAutocompleteAggMedium: "Medium — balanced",
      tabAutocompleteAggHigh: "High — faster, more calls",
      tabAutocompleteAlts: "Alternatives",
      tabAutocompleteAlts1: "1 — single suggestion",
      tabAutocompleteAlts2: "2 — two alternatives",
      tabAutocompleteAlts3: "3 — three alternatives",
      tabAutocompleteAltsHint:
        "Distinct ghost texts in one request. Cycle Alt+[ / Alt+].",
      tabAutocompleteExclude: "Exclude globs",
      tabAutocompleteExcludeEmpty: "Empty",
      tabAutocompleteExcludeHint:
        "One glob per line. Tab stays silent on matches.",
      tabAutocompleteNextEdit: "Next Edit after Accept",
      tabAutocompleteNextEditHint:
        "After Tab, a Next chip at the likely next edit.",
      tabAutocompleteShowMode: "Show mode",
      tabAutocompleteShowModeChip: "Chip — ⌘⏎ / Ctrl+Enter to show",
      tabAutocompleteShowModeInline: "Inline — ghost text automatically",
      tabAutocompleteShowModeHint:
        "Chip = shortcut. Inline = ghost appears by itself.",
      tabAutocompleteFim: "FIM (/completions)",
      tabAutocompleteFimHint:
        "prompt+suffix if the provider supports it.",
      tabAutocompleteKeysHint:
        "Show: Ctrl+Enter / ⌘⏎ · Accept: Tab · Statement: ⌘⇧⏎ / Ctrl+Shift+Enter · Cycle: Alt+[ / Alt+] · Word: Ctrl/Alt+Right · Line: Ctrl/Alt+Down",
      tabAutocompleteCoderTag: "coder",
      selectionHints: "Selection hints",
      selectionHintsNote: "Action chip over selected code.",
      model: "Model",
      provider: "Provider",
      mode: "Mode",
      intelligence: "Intelligence",
      reasonLow: "Low",
      reasonMedium: "Medium",
      reasonHigh: "High",
      reasonExtraHigh: "Extra high",
      close: "Close",
      cancel: "Cancel",
      done: "Done",
      search: "Search",
      searchChat: "Search chat",
      searchResults: "Search results",
      taskPlaceholder: "Task for the agent... (@ for file)",
      add: "Add",
      file: "File",
      send: "Send",
      stop: "Stop",
      queue: "Queue",
      queueRemove: "Remove from queue",
      queueFull: "Message queue is full (10).",
      queuePending: "Queued messages",
      runFailedSummary: "Error",
      runFailedTransport:
        "Model server error: API 500. Send the request again.",
      errorShowDetail: "Show full error",
      errorHideDetail: "Hide full error",
      contextUsage: "Context usage",
      noModels: "No models",
      noModelsInSettings: "No models in settings",
      noFiles: "No files",
      searching: "Searching...",
      copied: "Copied",
      copy: "Copy",
      agent: "Agent",
      plan: "Plan",
      ask: "Ask",
      branch: "Branch",
      branchDefault: "Branch",
      regenerateLast: "Regenerate last answer",
      deleteBranch: "Delete branch",
      nothingFound: "Nothing found",
      you: "You",
      addProviderFirst: "Add a provider first",
      newProvider: "New Provider",
      providerTitle: "Provider",
      providerIdRequired: "Enter a provider id.",
      providerBaseUrlRequired: "Enter a base URL.",
      noProvidersYet: "No providers yet — add at least one.",
      providerExists: (id) => `Provider "${id}" already exists.`,
      pasteModelJson: "Paste JSON with a model list.",
      invalidJson: "Invalid JSON.",
      noModelListInJson: "No model list found in the JSON.",
      noModelsWithId: "The JSON does not contain any model with an id.",
      importFailed: "Import failed.",
      listCopied: "List copied to clipboard.",
      jsonFilledBelow: "JSON filled into the field below.",
      apply: "Apply",
      addModels: "Add Models",
      modelSettings: "Model Settings",
      modelsAddedFromJson: "Models from JSON were added.",
      modelIdRequired: "Enter a model id.",
      providerRequired: "Choose a provider (or add one first).",
      fetchModels: "Fetch models",
      fetchModelsTitle: "Fetch models",
      fetchModelsNote: "Select models to add from the provider API.",
      fetchModelsFromApi: "From API",
      fetchModelsManual: "Manual",
      fetchModelsJson: "JSON",
      fetchModelsApiNote: "Loads model ids from the provider’s /models endpoint.",
      fetchModelsLoading: "Loading models…",
      fetchModelsEmpty: "No models returned by the API.",
      fetchModelsNoneNew: (n) =>
        n === 1
          ? "The only model from the API is already in the list."
          : `All ${n} models from the API are already in the list.`,
      fetchModelsNoneSelected: "Select at least one new model.",
      fetchModelsNeedProvider: "Choose a provider with a base URL first.",
      fetchModelsNeedBaseUrl: "Set a base URL for this provider first.",
      fetchModelsAlready: "Already added",
      fetchModelsSelectNew: "Select new",
      fetchModelsAddSelected: "Add selected",
      fetchModelsFilter: "Filter",
      fetchModelsCount: (total, neu) =>
        neu > 0 ? `${neu} new · ${total} from API` : `${total} from API`,
      fetchModelsDone: (a, skipped) =>
        skipped > 0
          ? `Added ${a} model(s). ${skipped} already in the list.`
          : `Added ${a} model(s).`,
      fetchModelsFailed: (msg) => `Could not fetch models: ${msg}`,
      name: "Name",
      contextInput: "Context (input)",
      responseOutput: "Response (output)",
      status: "Status",
      favorite: "Favorite",
      enabled: "Enabled",
      disabled: "Disabled",
      yes: "Yes",
      no: "No",
      listEmptyAddModel: "List is empty — add a model.",
      noId: "No id",
      enable: "Enable",
      disable: "Disable",
      modelParameters: "Model parameters",
      addToFavorites: "Add to favorites",
      removeFromFavorites: "Remove from favorites",
      defaultProviderName: "Default",
      noModes: "No modes.",
      readOnly: "read only",
      builtIn: "built-in",
      edit: "Edit",
      newMode: "New Mode",
      enterModeName: "Enter a mode name",
      modeDescription: "Description",
      modeTools: "Tools",
      modeToolsAgent: "Agent — read and edit",
      modeToolsReadonly: "Read only",
      modePrompt: "Mode prompt",
      modePromptPlaceholder: "Instructions for this mode...",
      modeNamePlaceholder: "e.g. Review",
      modeDescriptionPlaceholder: "Short tooltip text",
      modeColor: "Color",
      modeColorNone: "None",
      modeColorCustom: "Custom",
      modeColorHint: "Composer border and user messages in this mode.",
      archiveEmpty: "Archive is empty.",
      restore: "Restore",
      delete: "Delete",
      deleteAll: "Delete all",
      noAgentsYet: "No agents yet. Click + to create one.",
      rename: "Rename",
      openFile: "Open file",
      openChanges: "Open changes",
      openSourceControl: "Open Source Control",
      editMessage: "Edit message",
      saveAndResend: "Save and resend",
      attachFile: "Attach file",
      currentModelNoImages: "Current model does not support images",
      addMode: "+ Add mode",
      modelNoImages: "This model does not support images",
      tooManySelections: "Too many selections",
      remove: "Remove",
      contextLabel: (tip) => `Context: ${tip}`,
      line: (n) => `line ${n}`,
      lines: (a, b) => `lines ${a}–${b}`,
      stepsZero: "0 steps",
      showSteps: "Show steps",
      hideSteps: "Hide steps",
      showThinking: "Show thoughts",
      hideThinking: "Hide thoughts",
      thinkingLabel: "Thoughts",
      thinkingWorking: "Thoughts…",
      textStepLabel: "Note",
      zoomImage: "Zoom image",
      stepsOne: "1 step",
      stepsMany: (n) => `${n} steps`,
      toolHumanRead: (path) => (path ? `read ${path}` : "read"),
      toolHumanWrite: (path) => (path ? `write ${path}` : "write"),
      toolHumanReplace: (path) => (path ? `edit ${path}` : "edit"),
      toolHumanList: (path) => (path ? `list ${path}` : "list"),
      toolHumanSearch: (query) => (query ? `search ${query}` : "search"),
      toolHumanRun: (cmd) => (cmd ? `run ${cmd}` : "run"),
      toolHumanFetch: (url) => (url ? `Fetch ${url}` : "Fetch URL"),
      toolHumanOpen: (url) => (url ? `Open ${url}` : "Open URL"),
      toolHumanScreenshot: (url) =>
        url ? `Screenshot ${url}` : "Screenshot URL",
      toolHumanBrowserNav: (url) =>
        url ? `Browser · ${url}` : "Browser navigate",
      toolHumanBrowserSnap: "Browser snapshot",
      toolHumanBrowserClick: "Browser click",
      toolHumanBrowserType: "Browser type",
      toolHumanBrowserClose: "Browser close",
      toolHumanDiagnostics: "Diagnostics",
      toolHumanVisionAttached: "Vision · attached screenshot",
      toolHumanVisionPageUrl: "Vision · page URL",
      toolHumanScreenshotExplore: "Explore · screenshot probes",
      toolHumanSpawn: (task) =>
        task ? `Sub-agent · ${task}` : "Sub-agent",
      toolSpawnError: (err) => (err ? `error: ${err}` : "error"),
      toolHumanMcp: (name) => (name ? `MCP · ${name}` : "MCP"),
      toolHumanTool: (name) => name || "Tool",
      toolHumanCreate: (path) => (path ? `Create ${path}` : "Create file"),
      toolHumanAskQuestion: (q) => (q ? `Ask: ${q}` : "Ask question"),
      toolHumanSubmitExit: "Submit final answer",
      toolHumanSkill: (name) => (name ? `Skill · ${name}` : "Skill"),
      toolHumanApplyPatch: "Apply patch",
      toolMetricLines: "lines",
      toolMetricExit: "exit",
      toolWorking: "Working…",
      runWorking: "Running",
      runDone: "Done",
      toolReading: "Reading…",
      toolListing: "Listing…",
      toolSearching: "Searching…",
      toolWriting: "Writing…",
      toolRunning: "Running…",
      toolFetching: "Fetching…",
      toolOpening: "Opening…",
      toolMcp: "MCP…",
      toolVision: "Vision…",
      toolExploring: "Exploring…",
      toolKindRead: "read",
      toolKindWrite: "write",
      toolKindReplace: "replace",
      toolKindList: "list",
      toolKindSearch: "search",
      toolKindRun: "run",
      toolKindFetch: "fetch",
      toolKindOpen: "open",
      toolKindMcp: "mcp",
      toolKindVision: "Vision",
      toolKindExplore: "explore",
      toolKindTool: "tool",
      toolTypeCount: (kind, n) => (n > 1 ? `${kind} ×${n}` : kind),
      toolFiles: (n) => (n === 1 ? "1 file" : `${n} files`),
      doneImport: (a, u, t) => `Done: +${a}, updated ${u}, total ${t}.`,
      changedFiles: (n, a, d) => `Changed files: ${n} · +${a} −${d}`,
      commitAndPush: "Commit and push",
      commitAndPushShort: "Commit",
      changesTag: "Changes",
      taskForMode: (label) => `Task (${label})... (@ for file)`,
      modePlaceholder: (label) => `${label}... (@ for file)`,
      failedReadFile: "Failed to read file",
      slashModeSwitched: (label) => `Mode: ${label}`,
      slashInitDefault:
        "Inspect this repository and create or update AGENTS.md at the workspace root. Keep exploration short: prefer package.json, README, and a quick src/ layout — do not read the whole tree. After 1–2 tool rounds, write AGENTS.md as a concise agent orientation guide: what the project does, stack, how to build/run, main entry points, key folders/files, important conventions/constraints, and the best next steps. Prefer updating an existing AGENTS.md instead of overwriting useful content. Use write_file or search_replace, then briefly confirm in chat what you wrote.",
      slashInitWithTarget: (target) =>
        `Inspect this repository with a focus on ${target} and create or update AGENTS.md at the workspace root. Keep exploration short — after 1–2 tool rounds, write the file. Cover what this part does, key files, how it fits the project, important risks/constraints, and the best next steps. Prefer updating an existing AGENTS.md instead of overwriting useful content. Use write_file or search_replace, then briefly confirm in chat what you wrote.`,
      slashCompactDefault:
        "Compact this chat into a short working summary. Include: goal, what is already done, important files/symbols, current constraints, open questions, and the exact next step. Keep it concise and easy to continue from.",
      slashCompactWithTarget: (target) =>
        `Compact this chat into a short working summary focused on ${target}. Include: goal, what is already done, important files/symbols, current constraints, open questions, and the exact next step. Keep it concise and easy to continue from.`,
      proposedPlanTitle: "Plan",
      proposedPlanBuild: "Build",
      proposedPlanOpenTab: "Preview",
      proposedPlanExpand: "Show plan",
      proposedPlanCollapse: "Hide plan",
      proposedPlanCodeSection: "Plan code",
      proposedPlanCodeBlock: "Code",
      proposedPlanCodeLines: (n) => (n === 1 ? "1 line" : `${n} lines`),
      proposedPlanCodeToggle: "Show or hide code",
      proposedPlanImplementBubble: "Build plan",
      proposedPlanImplementPrefix:
        "Implement the following plan exactly (components, paths, and steps as written — do not substitute your own):",
    },
    ru: {
      agents: "Агенты",
      settings: "Настройки",
      archive: "Архив",
      newAgent: "Новый агент",
      backToAgents: "К списку агентов",
      showAgentsList: "Показать агентов",
      hideAgentsList: "Скрыть агентов",
      closeSettings: "Закрыть настройки",
      saved: "Сохранено",
      providers: "Провайдеры",
      providersNote:
        "Base URL и API key для каждого OpenAI-compatible API. Модели сгруппированы по провайдеру.",
      addProvider: "+ Провайдер",
      models: "Модели",
      modelsProviders: "Модели и провайдеры",
      defaultModel: "Модель по умолчанию",
      addModel: "+ Модель",
      newProviderOption: "+ Новый провайдер…",
      providerIdLabel: "ID провайдера",
      providerNameLabel: "Имя провайдера",
      otherProvider: "Другое",
      noProvidersOrModels: "Нет провайдеров — добавьте провайдера или модель.",
      baseUrl: "Base URL",
      statusUrl: "URL проверки статуса",
      statusUrlHint: "Пусто = Base URL + /models",
      apiKey: "API Key",
      modes: "Режимы",
      modesNote:
        "Agent, Plan и Ask встроены и тоже редактируются. Можно добавлять и удалять свои режимы.",
      addModeShort: "+ Режим",
      languageSection: "Язык",
      pluginUiLanguage: "Язык интерфейса плагина",
      languageAuto: "Авто (как в VS Code)",
      languageEn: "English",
      languageRu: "Русский",
      appearanceSection: "Внешний вид",
      appearanceNote: "Размер текста чата и поля ввода в панели.",
      fontSize: "Размер шрифта",
      fontSizeHint: "Действует на сообщения и поле ввода.",
      fontSizeValue: (n) => `${n} px`,
      fontSizePreview: "Агент будет отвечать таким размером.",
      tls: "TLS",
      validateTls: "Проверять TLS-сертификат",
      agentBehavior: "Поведение агента",
      browserAgent: "Браузерный агент",
      browserAgentTitle: "Браузерный агент",
      browserAgentNote: "Многошаговые задачи в вашем Chrome или Edge.",
      autoglmEnabled: "Включить браузерный агент",
      autoglmEnabledNote:
        "Инструмент browser_task. Нужны CLI AutoGLM и расширение.",
      autoglmBrowser: "Браузер",
      autoglmBrowserHint: "Установите расширение AutoGLM и включите его.",
      autoglmAutoApprove: "Автоподтверждение чувствительных действий",
      autoglmAutoApproveNote:
        "Без запроса на чувствительные шаги. Логин и капча — вручную.",
      autoglmConnection: "Подключение",
      autoglmBinaryPath: "Путь к CLI",
      autoglmBinaryPathPlaceholder: "autoglm в PATH или полный путь",
      autoglmBinaryPathHint:
        "Пусто — берётся из PATH. При сохранении пишется ~/.openclaw-autoclaw/config.json",
      advancedSettings: "Доп. настройки",
      commitMessages: "Сообщения коммитов",
      commitMessagesNote: "Генерация сообщений коммита в SCM по diff.",
      commitGeneration: "Генерация",
      commitStorage: "Область сохранения",
      commitScope: "Применить к",
      commitScopeGlobal: "Все workspace",
      commitScopeWorkspace: "Этот workspace",
      commitScopeWorkspaceNamed: (name) =>
        name ? `Этот workspace (${name})` : "Этот workspace",
      commitScopeHint: "Куда сохранить эти настройки.",
      commitLanguage: "Язык",
      commitLanguageAuto: "Авто (как язык интерфейса)",
      commitModel: "Модель",
      commitModelEmpty: "Авто (лёгкая модель)",
      commitPrompt: "Промпт / правило",
      commitPromptEmpty: "Пусто — правила проекта, затем встроенный дефолт.",
      commitPromptPlaceholder:
        "Необязательно. Пример: пиши короткие русские commit message с акцентом на зачем.",
      figma: "Figma",
      mcpServers: "MCP Servers",
      mcpServersNote:
        "Управление MCP-подключениями Harbor Agents (Figma и другие).",
      skillsSection: "Skills",
      skillsNote:
        "Skills — пакеты SKILL.md, подключаются когда нужны. Кладите их в папки проекта или глобальную — список ниже.",
      skillsEnabled: "Включить skills",
      skillsRefresh: "Обновить",
      skillsAddFolder: "Добавить папку",
      skillsOpenHarbor: "Папка проекта",
      skillsOpenGlobal: "Глобальная папка",
      skillsListTitle: "Установленные skills",
      skillsFoldersTitle: "Где Harbor ищет",
      skillsFoldersDisabledHint: "Выключенная папка не отдаётся модели.",
      skillsEmpty: "",
      skillsSourceWorkspace: "Этот проект",
      skillsSourceGlobal: "Все проекты",
      skillsSourceExtra: "Доп. папка",
      skillsOpen: "Открыть",
      skillsRemoveFolder: "Убрать",
      skillsBuiltinFolder: "Встроенная",
      mcpServersOpen: "Открыть список подключений",
      mcpSubtitle: "Управление конфигурациями MCP-серверов для Harbor Agents.",
      mcpSearchPlaceholder: "Поиск MCP-серверов...",
      mcpConfigured: "Настроенные MCP-серверы",
      mcpConfiguredCount: (n) =>
        n === 1 ? "1 шт." : n < 5 ? `${n} шт.` : `${n} шт.`,
      mcpEmpty: "Пока нет MCP-серверов.",
      mcpBadgeUser: "User",
      mcpBadgeTools: (n) => `${n} tools`,
      mcpEditNote:
        "Подключайте Figma через Connect Figma (OAuth в браузере). Personal Access Token — запасной вариант.",
      mcpCustomTitleNew: "Добавить MCP-сервер",
      mcpCustomTitleEdit: "Редактировать MCP-сервер",
      mcpCustomName: "Имя",
      mcpCustomTransport: "Транспорт",
      mcpCustomCommand: "Команда",
      mcpCustomArgs: "Аргументы",
      mcpCustomEnv: "Env (KEY=value по строкам)",
      mcpCustomCwd: "Рабочая папка (опционально)",
      mcpCustomUrl: "URL",
      mcpCustomToken: "Bearer token (опционально)",
      mcpCustomSave: "Сохранить и подключить",
      mcpNameRequired: "Укажите имя сервера.",
      mcpCommandRequired: "Укажите команду для stdio.",
      mcpUrlRequired: "Укажите URL для HTTP.",
      mcpPresetsLabel: "Быстро добавить",
      mcpPresetPlaywright: "Playwright",
      mcpPresetGithub: "GitHub",
      mcpPresetPlaywrightNote:
        "Интерактивный браузер через Playwright MCP. Нужен Node.js / npx. В Harbor также есть builtin browser_* tools.",
      mcpPresetGithubNote:
        "Удалённый GitHub MCP. Вставьте Personal Access Token в Bearer token, затем Save & Connect.",
      mcpPresetAlready: (name) =>
        `«${name}» уже в списке — откройте настройки на карточке, чтобы править.`,
      mcpEnable: "Включить",
      mcpReconnect: "Переподключить",
      figmaEnable: "Включить Figma MCP",
      figmaStatusDisconnected: "Статус: не подключено",
      figmaStatusConnecting: "Статус: подключение…",
      figmaStatusConnected: (mode, n) =>
        `Статус: подключено (${mode || "MCP"}${typeof n === "number" ? `, ${n} tools` : ""})`,
      figmaStatusError: (msg) =>
        msg ? `Статус: ошибка — ${msg}` : "Статус: ошибка",
      providerConnUnknown: "Статус: не проверено",
      providerConnConnecting: "Статус: подключение…",
      providerConnConnected: (name) =>
        name ? `Статус: подключено · ${name}` : "Статус: подключено",
      providerConnError: (msg) =>
        msg ? `Статус: не в сети (${msg})` : "Статус: не в сети",
      providerConnShortUnknown: "Не проверено",
      providerConnShortConnecting: "Подключение…",
      providerConnShortConnected: "Подключено",
      providerConnShortError: (msg) =>
        msg ? `Не в сети (${msg})` : "Не в сети",
      figmaConnect: "Connect Figma",
      figmaDisconnect: "Отключить",
      figmaPatNote:
        "Запасной вариант: создайте токен в Figma → Settings → Security → Personal access tokens, вставьте сюда и нажмите «Подключить по токену».",
      figmaPatLabel: "Personal Access Token",
      figmaPatConnect: "Подключить по токену",
      figmaNeedsConnectToast:
        "Figma не подключён — откройте Settings → MCP Servers → Connect Figma",
      figmaOpenTokenHelp: "Открыть настройки токена",
      backToSettings: "К настройкам",
      systemPrompt: "Системный промпт",
      systemPromptEmpty: "Пусто",
      agentLimits: "Лимиты",
      agentExecution: "Выполнение",
      agentInterface: "Интерфейс",
      maxToolRounds: "Макс. раундов tools",
      maxTokens: "Лимит ответа",
      maxTokensHint: "токены",
      maxResponseLength: "Макс. длина",
      maxResponseCharsHint: "символы",
      soundNotifications: "Звуковые уведомления",
      soundNotificationsNote: "Сигнал, когда агент закончил ход.",
      parallelAgents: "Параллельные агенты",
      parallelAgentsNote: "Дочерние агенты. В Plan и Ask — только чтение.",
      parallelToolCalls: "Параллельные tool calls",
      parallelToolCallsNote:
        "Независимые tools из одного ответа — сразу.",
      autoCompact: "Автосжатие контекста",
      autoCompactNote: "Сжимать диалог у лимита окна модели.",
      toolsAutoApprove: "Автоподтверждение tools",
      toolsAutoApproveNote: "Без запроса. Выкл. — спрашивать каждый раз.",
      approvalReads: "Чтение",
      approvalReadsNote: "read_files, search_codebase, skills",
      approvalWeb: "Веб-запросы",
      approvalWebNote: "fetch_web_content",
      approvalEdits: "Правки",
      approvalEditsNote: "editor, apply_patch",
      approvalCommands: "Команды",
      approvalCommandsNote: "run_commands (терминал)",
      approvalMcp: "MCP-инструменты",
      approvalMcpNote: "Figma и кастомные MCP-серверы",
      approvalSubagents: "Субагенты",
      approvalSubagentsNote: "spawn_agent",
      approvalInherit: "Как общий",
      approvalAuto: "Авто",
      approvalAsk: "Спрашивать",
      focusChain: "Focus chain",
      focusChainNote:
        "Агент ведёт чеклист задач; подставляется в каждый ход.",
      checkpoints: "Чекпоинты workspace",
      checkpointsNote:
        "Git-снимок в начале хода. Карточка откатывает файлы.",
      checkpointRestore: "Восстановить файлы из этого чекпоинта?",
      checkpointCompare: "Сравнить чекпоинт с текущими файлами",
      todoPlanTitle: "План",
      todoPlanStepDone: "выполнено",
      todoPlanStepInProgress: "выполняется",
      todoPlanStepPending: "в очереди",
      cancelledByUser: "Отменено пользователем",
      tabAutocomplete: "Tab autocomplete",
      tabAutocompleteEnable: "Включить Tab autocomplete",
      tabAutocompleteNote:
        "Тихий prefetch. ⌘⏎ показать, Tab принять.",
      tabAutocompleteModel: "Модель для Tab",
      tabAutocompleteModelEmpty: "Выберите модель",
      tabAutocompleteModelHint:
        "Coder-модели обычно лучше chat/flash для Tab.",
      tabAutocompleteAgg: "Агрессивность",
      tabAutocompleteAggLow: "Низкая — меньше запросов",
      tabAutocompleteAggMedium: "Средняя — баланс",
      tabAutocompleteAggHigh: "Высокая — быстрее, больше вызовов",
      tabAutocompleteAlts: "Варианты",
      tabAutocompleteAlts1: "1 — один вариант",
      tabAutocompleteAlts2: "2 — два варианта",
      tabAutocompleteAlts3: "3 — три варианта",
      tabAutocompleteAltsHint:
        "Разные ghost text за один запрос. Цикл Alt+[ / Alt+].",
      tabAutocompleteExclude: "Исключить (globs)",
      tabAutocompleteExcludeEmpty: "Пусто",
      tabAutocompleteExcludeHint:
        "По одному glob на строку. Tab молчит на совпадениях.",
      tabAutocompleteNextEdit: "Next Edit после Accept",
      tabAutocompleteNextEditHint:
        "После Tab — чип Next в следующей правке.",
      tabAutocompleteShowMode: "Режим показа",
      tabAutocompleteShowModeChip: "Chip — ⌘⏎ / Ctrl+Enter",
      tabAutocompleteShowModeInline: "Inline — ghost сразу",
      tabAutocompleteShowModeHint:
        "Chip = шорткат. Inline = ghost появляется сам.",
      tabAutocompleteFim: "FIM (/completions)",
      tabAutocompleteFimHint:
        "prompt+suffix, если провайдер умеет.",
      tabAutocompleteKeysHint:
        "Показать: Ctrl+Enter / ⌘⏎ · Принять: Tab · Стейтмент: ⌘⇧⏎ / Ctrl+Shift+Enter · Цикл: Alt+[ / Alt+] · Слово: Ctrl/Alt+Right · Строка: Ctrl/Alt+Down",
      tabAutocompleteCoderTag: "coder",
      selectionHints: "Подсказки при выделении кода",
      selectionHintsNote: "Чип действий над выделенным кодом.",
      model: "Модель",
      provider: "Провайдер",
      mode: "Режим",
      intelligence: "Intelligence",
      reasonLow: "Low",
      reasonMedium: "Medium",
      reasonHigh: "High",
      reasonExtraHigh: "Extra high",
      close: "Закрыть",
      cancel: "Отмена",
      done: "Готово",
      search: "Поиск",
      searchChat: "Поиск по чату",
      searchResults: "Результаты поиска",
      taskPlaceholder: "Задача для агента... (@ — файл)",
      add: "Добавить",
      file: "Файл",
      image: "Изображение",
      send: "Отправить",
      stop: "Остановить",
      queue: "В очередь",
      queueRemove: "Убрать из очереди",
      queueFull: "Очередь сообщений заполнена (10).",
      queuePending: "Сообщения в очереди",
      runFailedSummary: "Ошибка",
      runFailedTransport:
        "Ошибка сервера модели: API 500. Отправьте запрос ещё раз.",
      errorShowDetail: "Показать полный ответ",
      errorHideDetail: "Скрыть полный ответ",
      contextUsage: "Использование контекста",
      noModels: "Нет моделей",
      noModelsInSettings: "Нет моделей в настройках",
      noFiles: "Нет файлов",
      searching: "Поиск…",
      copied: "Скопировано",
      copy: "Копировать",
      agent: "Агент",
      plan: "План",
      ask: "Спросить",
      branch: "Ответвить",
      branchDefault: "Ветка",
      regenerateLast: "Перегенерировать последний ответ",
      deleteBranch: "Удалить ветку",
      nothingFound: "Ничего не найдено",
      you: "Вы",
      addProviderFirst: "Сначала добавьте провайдера",
      newProvider: "Новый провайдер",
      providerTitle: "Провайдер",
      providerIdRequired: "Укажите id провайдера.",
      providerBaseUrlRequired: "Укажите base URL.",
      noProvidersYet: "Нет провайдеров — добавьте хотя бы один.",
      providerExists: (id) => `Провайдер «${id}» уже есть.`,
      pasteModelJson: "Вставьте JSON со списком моделей.",
      invalidJson: "Некорректный JSON.",
      noModelListInJson: "В JSON не найден список моделей.",
      noModelsWithId: "В JSON нет ни одной модели с id.",
      importFailed: "Не удалось импортировать.",
      listCopied: "Список скопирован в буфер.",
      jsonFilledBelow: "JSON заполнен в поле ниже.",
      apply: "Применить",
      addModels: "Добавить модели",
      modelSettings: "Настройки модели",
      modelsAddedFromJson: "Модели из JSON добавлены.",
      modelIdRequired: "Укажите id модели.",
      providerRequired: "Выберите провайдера (или сначала добавьте его).",
      fetchModels: "Подтянуть модели",
      fetchModelsTitle: "Подтянуть модели",
      fetchModelsNote: "Выберите модели, которые добавить из API провайдера.",
      fetchModelsFromApi: "Из API",
      fetchModelsManual: "Вручную",
      fetchModelsJson: "JSON",
      fetchModelsApiNote: "Загружает id моделей с endpoint /models провайдера.",
      fetchModelsLoading: "Загрузка моделей…",
      fetchModelsEmpty: "API не вернул ни одной модели.",
      fetchModelsNoneNew: (n) =>
        n === 1
          ? "Единственная модель из API уже в списке."
          : `Все ${n} моделей из API уже в списке.`,
      fetchModelsNoneSelected: "Выберите хотя бы одну новую модель.",
      fetchModelsNeedProvider: "Сначала выберите провайдера с base URL.",
      fetchModelsNeedBaseUrl: "Сначала укажите base URL у этого провайдера.",
      fetchModelsAlready: "Уже есть",
      fetchModelsSelectNew: "Выбрать новые",
      fetchModelsAddSelected: "Добавить выбранные",
      fetchModelsFilter: "Фильтр",
      fetchModelsCount: (total, neu) =>
        neu > 0 ? `${neu} новых · ${total} с API` : `${total} с API`,
      fetchModelsDone: (a, skipped) =>
        skipped > 0
          ? `Добавлено: ${a}. Уже в списке: ${skipped}.`
          : `Добавлено моделей: ${a}.`,
      fetchModelsFailed: (msg) => `Не удалось загрузить модели: ${msg}`,
      name: "Название",
      contextInput: "Контекст (вход)",
      responseOutput: "Ответ (выход)",
      status: "Статус",
      favorite: "Избранное",
      enabled: "Включена",
      disabled: "Выключена",
      yes: "Да",
      no: "Нет",
      listEmptyAddModel: "Список пуст — добавьте модель.",
      noId: "Без id",
      enable: "Включить",
      disable: "Выключить",
      modelParameters: "Параметры модели",
      addToFavorites: "В избранное",
      removeFromFavorites: "Убрать из избранного",
      defaultProviderName: "Основной",
      noModes: "Нет режимов.",
      readOnly: "только чтение",
      builtIn: "встроенный",
      edit: "Изменить",
      newMode: "Новый режим",
      enterModeName: "Укажите название режима",
      modeDescription: "Описание",
      modeTools: "Инструменты",
      modeToolsAgent: "Agent — чтение и правки",
      modeToolsReadonly: "Только чтение",
      modePrompt: "Промпт режима",
      modePromptPlaceholder: "Инструкции для этого режима…",
      modeNamePlaceholder: "например, Review",
      modeDescriptionPlaceholder: "Краткий текст подсказки",
      modeColor: "Цвет",
      modeColorNone: "Без цвета",
      modeColorCustom: "Свой",
      modeColorHint: "Обводка композера и сообщений пользователя в этом режиме.",
      archiveEmpty: "Архив пуст.",
      restore: "Восстановить",
      delete: "Удалить",
      deleteAll: "Удалить все",
      noAgentsYet: "Нет агентов. Нажмите +, чтобы создать.",
      rename: "Переименовать",
      openFile: "Открыть файл",
      openChanges: "Открыть изменения",
      openSourceControl: "Открыть Source Control",
      editMessage: "Редактирование сообщения",
      saveAndResend: "Сохранить и переотправить",
      attachFile: "Прикрепить файл",
      currentModelNoImages: "Текущая модель не поддерживает изображения",
      addMode: "+ Добавить режим",
      modelNoImages: "Модель не поддерживает изображения",
      tooManySelections: "Слишком много выделений",
      remove: "Убрать",
      contextLabel: (tip) => `Контекст: ${tip}`,
      line: (n) => `стр. ${n}`,
      lines: (a, b) => `стр. ${a}–${b}`,
      stepsZero: "0 шагов",
      showSteps: "Показать шаги",
      hideSteps: "Скрыть шаги",
      showThinking: "Показать мысли",
      hideThinking: "Скрыть мысли",
      thinkingLabel: "Мысли",
      thinkingWorking: "Мысли…",
      textStepLabel: "Сообщение",
      zoomImage: "Увеличить изображение",
      stepsOne: "1 шаг",
      stepsMany: (n) => `${n} шагов`,
      toolHumanRead: (path) => (path ? `чтение ${path}` : "чтение"),
      toolHumanWrite: (path) => (path ? `запись ${path}` : "запись"),
      toolHumanReplace: (path) => (path ? `правка ${path}` : "правка"),
      toolHumanList: (path) => (path ? `список ${path}` : "список"),
      toolHumanSearch: (query) => (query ? `поиск ${query}` : "поиск"),
      toolHumanRun: (cmd) => (cmd ? `команда ${cmd}` : "команда"),
      toolHumanFetch: (url) => (url ? `Fetch ${url}` : "Fetch URL"),
      toolHumanOpen: (url) => (url ? `Open ${url}` : "Open URL"),
      toolHumanScreenshot: (url) =>
        url ? `Screenshot ${url}` : "Screenshot URL",
      toolHumanBrowserNav: (url) =>
        url ? `Browser · ${url}` : "Browser navigate",
      toolHumanBrowserSnap: "Browser snapshot",
      toolHumanBrowserClick: "Browser click",
      toolHumanBrowserType: "Browser type",
      toolHumanBrowserClose: "Browser close",
      toolHumanDiagnostics: "Diagnostics",
      toolHumanVisionAttached: "Vision · attached screenshot",
      toolHumanVisionPageUrl: "Vision · page URL",
      toolHumanScreenshotExplore: "Explore · screenshot probes",
      toolHumanSpawn: (task) =>
        task ? `Субагент · ${task}` : "Субагент",
      toolSpawnError: (err) => (err ? `ошибка: ${err}` : "ошибка"),
      toolHumanMcp: (name) => (name ? `MCP · ${name}` : "MCP"),
      toolHumanTool: (name) => name || "Tool",
      toolHumanCreate: (path) => (path ? `Создать ${path}` : "Создать файл"),
      toolHumanAskQuestion: (q) => (q ? `Спросить: ${q}` : "Задать вопрос"),
      toolHumanSubmitExit: "Финальный ответ",
      toolHumanSkill: (name) => (name ? `Скилл · ${name}` : "Скилл"),
      toolHumanApplyPatch: "Применить патч",
      toolMetricLines: "строк",
      toolMetricExit: "exit",
      toolWorking: "Работаю…",
      runWorking: "выполняю",
      runDone: "выполнено",
      toolReading: "Читаю…",
      toolListing: "Смотрю…",
      toolSearching: "Ищу…",
      toolWriting: "Пишу…",
      toolRunning: "Запускаю…",
      toolFetching: "Загружаю…",
      toolOpening: "Открываю…",
      toolMcp: "MCP…",
      toolVision: "Vision…",
      toolExploring: "Исследую…",
      toolKindRead: "чтение",
      toolKindWrite: "запись",
      toolKindReplace: "замена",
      toolKindList: "список",
      toolKindSearch: "поиск",
      toolKindRun: "команда",
      toolKindFetch: "загрузка",
      toolKindOpen: "открытие",
      toolKindMcp: "mcp",
      toolKindVision: "Vision",
      toolKindExplore: "explore",
      toolKindTool: "tool",
      toolTypeCount: (kind, n) => (n > 1 ? `${kind} ×${n}` : kind),
      toolFiles: (n) => {
        const abs = Math.abs(n) % 100;
        const d = abs % 10;
        if (abs > 10 && abs < 20) {
          return `${n} файлов`;
        }
        if (d === 1) {
          return `${n} файл`;
        }
        if (d >= 2 && d <= 4) {
          return `${n} файла`;
        }
        return `${n} файлов`;
      },
      doneImport: (a, u, t) => `Готово: +${a}, обновлено ${u}, всего ${t}.`,
      changedFiles: (n, a, d) => `Изменено файлов: ${n} · +${a} −${d}`,
      commitAndPush: "Закоммитить и запушить",
      commitAndPushShort: "Закоммитить",
      changesTag: "Изменения",
      taskForMode: (label) => `Задача (${label})… (@ — файл)`,
      modePlaceholder: (label) => `${label}… (@ — файл)`,
      failedReadFile: "Не удалось прочитать файл",
      slashModeSwitched: (label) => `Режим: ${label}`,
      slashInitDefault:
        "Изучи этот репозиторий и создай или обнови файл AGENTS.md в корне workspace. Исследуй кратко: хватит package.json, README и быстрого взгляда на src/ — не читай всё дерево. После 1–2 раундов инструментов сразу запиши AGENTS.md — краткий ориентир для агента: что делает проект, стек, как собирать/запускать, основные entry points, ключевые папки/файлы, важные соглашения/ограничения и с чего лучше продолжать. Если AGENTS.md уже есть — обнови его, не затирая полезное. Используй write_file или search_replace, затем коротко подтверди в чате, что именно записал.",
      slashInitWithTarget: (target) =>
        `Изучи этот репозиторий с фокусом на ${target} и создай или обнови файл AGENTS.md в корне workspace. Исследуй кратко — после 1–2 раундов инструментов сразу пиши файл. Опиши, что делает эта часть, какие файлы ключевые, как она связана с остальным кодом, какие есть ограничения/риски и с чего лучше продолжать. Если AGENTS.md уже есть — обнови его, не затирая полезное. Используй write_file или search_replace, затем коротко подтверди в чате, что именно записал.`,
      slashCompactDefault:
        "Сожми текущий чат в короткое рабочее резюме. Включи: цель, что уже сделано, важные файлы/символы, текущие ограничения, открытые вопросы и точный следующий шаг. Пиши коротко, чтобы по summary можно было сразу продолжить работу.",
      slashCompactWithTarget: (target) =>
        `Сожми текущий чат в короткое рабочее резюме с фокусом на ${target}. Включи: цель, что уже сделано, важные файлы/символы, текущие ограничения, открытые вопросы и точный следующий шаг. Пиши коротко, чтобы по summary можно было сразу продолжить работу.`,
      proposedPlanTitle: "План",
      proposedPlanBuild: "Собрать",
      proposedPlanOpenTab: "Просмотр",
      proposedPlanExpand: "Показать план",
      proposedPlanCollapse: "Скрыть план",
      proposedPlanCodeSection: "Код плана",
      proposedPlanCodeBlock: "Код",
      proposedPlanCodeLines: (n) =>
        n === 1 ? "1 строка" : n < 5 ? `${n} строки` : `${n} строк`,
      proposedPlanCodeToggle: "Показать или скрыть код",
      proposedPlanImplementBubble: "Собрать план",
      proposedPlanImplementPrefix:
        "Реализуй следующий план точно (компоненты, пути и шаги — как написано, без подмены своими):",
    }
  };
  let STR = UI_STRINGS[UI_LANG];
  const t = (key, ...args) => {
    const value = STR[key];
    return typeof value === "function" ? value(...args) : value;
  };

  function effectiveUiLangFromSetting(setting) {
    if (setting === "ru" || setting === "en") {
      return setting;
    }
    return hostResolvedUiLang === "ru" ? "ru" : "en";
  }

  /** Switch panel chrome language without reloading the IDE / webview. */
  function applyUiLanguage(nextLang) {
    const lang = nextLang === "ru" ? "ru" : "en";
    const changed = UI_LANG !== lang;
    UI_LANG = lang;
    STR = UI_STRINGS[lang];
    document.documentElement.lang = lang;
    if (!changed) {
      return;
    }
    localizeStaticUi();
    try {
      if (typeof applySelectedMode === "function") {
        applySelectedMode(
          typeof agentMode === "string" && agentMode ? agentMode : "agent",
          { notify: false }
        );
      }
    } catch {
      /* mode helpers may not be ready yet */
    }
    try {
      if (typeof updateReasonPickerVisibility === "function") {
        updateReasonPickerVisibility();
      }
    } catch {
      /* ignore */
    }
    try {
      if (typeof forceHarborUiRepaint === "function") {
        forceHarborUiRepaint();
      }
    } catch {
      /* ignore */
    }
  }

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
  const reasonPicker = document.getElementById("reasonPicker");
  const reasonTrigger = document.getElementById("reasonTrigger");
  const reasonLabel = document.getElementById("reasonLabel");
  const reasonMenu = document.getElementById("reasonMenu");
  const attachPreviewEl = document.getElementById("attachPreview");
  const selectionPreviewEl = document.getElementById("selectionPreview");
  const mentionMenuEl = document.getElementById("mentionMenu");
  const composerEl = document.getElementById("composer");
  const composerWrapEl = document.getElementById("composerWrap");
  const composerScmActionsEl = document.getElementById("composerScmActions");
  const composerPlanActionsEl = document.getElementById("composerPlanActions");
  /** Latest proposed_plan markdown for the composer Build tag. */
  let pendingPlanText = "";
  /** Avoid re-opening the same plan markdown repeatedly. */
  let lastOpenedPlanKey = "";
  const composerDropHintEl = document.getElementById("composerDropHint");
  const messageQueueEl = document.getElementById("messageQueue");
  const modelPicker = document.getElementById("modelPicker");
  const modelTrigger = document.getElementById("modelTrigger");
  const modelLabel = document.getElementById("modelLabel");
  const modelMenu = document.getElementById("modelMenu");

  let agentStatusEl = null;
  let agentStatusState = { text: "", hidden: true, phase: "", modelLabel: "" };
  const workspaceShell = document.getElementById("workspaceShell");
  const agentsRailBackdrop = document.getElementById("agentsRailBackdrop");
  const agentsScreen = document.getElementById("agentsScreen");
  const archiveScreen = document.getElementById("archiveScreen");
  const settingsScreen = document.getElementById("settingsScreen");
  const chatScreen = document.getElementById("chatScreen");
  const chatBranchesEl = document.getElementById("chatBranches");
  const agentsListEl = document.getElementById("agentsList");
  const archiveListEl = document.getElementById("archiveList");
  const settingsModelsList = document.getElementById(
    "settingsProvidersModelsList"
  );
  const settingsProvidersList = settingsModelsList;
  const newAgentBtn = document.getElementById("newAgentBtn");
  const chatNewAgentBtn = document.getElementById("chatNewAgentBtn");
  const openArchiveBtn = document.getElementById("openArchiveBtn");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const backFromArchiveBtn = document.getElementById("backFromArchiveBtn");
  const deleteAllArchiveBtn = document.getElementById("deleteAllArchiveBtn");
  const settingsSaveStatus = document.getElementById("settingsSaveStatus");
  const addModelBtn = document.getElementById("addModelBtn");
  const settingsModelsHint = document.getElementById("settingsModelsHint");
  const settingsModelsJson = document.getElementById("settingsModelsJson");
  const importModelsJsonBtn = document.getElementById("importModelsJsonBtn");
  const exportModelsJsonBtn = document.getElementById("exportModelsJsonBtn");
  const settingsJsonHint = document.getElementById("settingsJsonHint");
  const modelEditApiPane = document.getElementById("modelEditApiPane");
  const modelEditApiNote = document.getElementById("modelEditApiNote");
  const modelEditApiFetchBtn = document.getElementById("modelEditApiFetchBtn");
  const modelEditApiSelectNewBtn = document.getElementById(
    "modelEditApiSelectNewBtn"
  );
  const modelEditApiStatus = document.getElementById("modelEditApiStatus");
  const modelEditApiSearchWrap = document.getElementById(
    "modelEditApiSearchWrap"
  );
  const modelEditApiSearchLabel = document.getElementById(
    "modelEditApiSearchLabel"
  );
  const modelEditApiSearch = document.getElementById("modelEditApiSearch");
  const modelEditApiList = document.getElementById("modelEditApiList");
  const fetchModelsModal = document.getElementById("fetchModelsModal");
  const fetchModelsTitle = document.getElementById("fetchModelsTitle");
  const fetchModelsNote = document.getElementById("fetchModelsNote");
  const fetchModelsStatus = document.getElementById("fetchModelsStatus");
  const fetchModelsSearchWrap = document.getElementById("fetchModelsSearchWrap");
  const fetchModelsSearchLabel = document.getElementById(
    "fetchModelsSearchLabel"
  );
  const fetchModelsSearch = document.getElementById("fetchModelsSearch");
  const fetchModelsSelectWrap = document.getElementById(
    "fetchModelsSelectWrap"
  );
  const fetchModelsSelectNewBtn = document.getElementById(
    "fetchModelsSelectNewBtn"
  );
  const fetchModelsList = document.getElementById("fetchModelsList");
  const fetchModelsCloseBtn = document.getElementById("fetchModelsCloseBtn");
  const fetchModelsCancelBtn = document.getElementById("fetchModelsCancelBtn");
  const fetchModelsAddBtn = document.getElementById("fetchModelsAddBtn");
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
  const modelEditNewProvider = document.getElementById("modelEditNewProvider");
  const modelEditNewProviderId = document.getElementById(
    "modelEditNewProviderId"
  );
  const modelEditNewProviderName = document.getElementById(
    "modelEditNewProviderName"
  );
  const modelEditNewProviderUrl = document.getElementById(
    "modelEditNewProviderUrl"
  );
  const modelEditNewProviderKey = document.getElementById(
    "modelEditNewProviderKey"
  );
  const NEW_PROVIDER_VALUE = "__new__";
  const modelEditCloseBtn = document.getElementById("modelEditCloseBtn");
  const modelEditCancelBtn = document.getElementById("modelEditCancelBtn");
  const modelEditDoneBtn = document.getElementById("modelEditDoneBtn");
  const settingsProvidersHint = document.getElementById("settingsProvidersHint");
  const addProviderBtn = document.getElementById("addProviderBtn");
  const providerEditModal = document.getElementById("providerEditModal");
  const providerEditTitle = document.getElementById("providerEditTitle");
  const providerEditId = document.getElementById("providerEditId");
  const providerEditName = document.getElementById("providerEditName");
  const providerEditBaseUrl = document.getElementById("providerEditBaseUrl");
  const providerEditStatusUrl = document.getElementById("providerEditStatusUrl");
  const providerEditApiKey = document.getElementById("providerEditApiKey");
  const providerEditCloseBtn = document.getElementById("providerEditCloseBtn");
  const providerEditCancelBtn = document.getElementById("providerEditCancelBtn");
  const providerEditDoneBtn = document.getElementById("providerEditDoneBtn");
  const toggleAgentsRailBtn = document.getElementById("toggleAgentsRailBtn");
  const chatAgentNameEl = document.getElementById("chatAgentName");
  const chatTitleEl = document.getElementById("chatTitle");
  const providerConnStatusEl = document.getElementById("providerConnStatus");
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

  let agentsRailOpen = Boolean(state.agentsRailOpen);
  let workspaceNarrow = false;
  let currentScreen = "chat";

  const settingsDefaultModel = document.getElementById("settingsDefaultModel");
  const settingsLanguage = document.getElementById("settingsLanguage");
  const settingsFontSize = document.getElementById("settingsFontSize");
  const settingsFontSizeValue = document.getElementById("settingsFontSizeValue");
  const FONT_SIZE_MIN = 11;
  const FONT_SIZE_MAX = 20;
  const FONT_SIZE_DEFAULT = 13;

  function clampUiFontSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return FONT_SIZE_DEFAULT;
    }
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));
  }

  function applyUiFontSize(value) {
    const px = clampUiFontSize(value);
    const fill =
      ((px - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100;
    document.documentElement.style.setProperty("--harbor-font-size", px + "px");
    if (settingsFontSize) {
      if (settingsFontSize.value !== String(px)) {
        settingsFontSize.value = String(px);
      }
      settingsFontSize.style.setProperty("--harbor-range-fill", fill + "%");
    }
    if (settingsFontSizeValue) {
      settingsFontSizeValue.textContent = t("fontSizeValue", px);
    }
    return px;
  }

  const settingsRejectUnauthorized = document.getElementById(
    "settingsRejectUnauthorized"
  );
  const settingsSoundNotificationsEnabled = document.getElementById(
    "settingsSoundNotificationsEnabled"
  );
  const settingsSubagentsEnabled = document.getElementById(
    "settingsSubagentsEnabled"
  );
  const settingsParallelToolCallsEnabled = document.getElementById(
    "settingsParallelToolCallsEnabled"
  );
  const settingsAutoCompactEnabled = document.getElementById(
    "settingsAutoCompactEnabled"
  );
  const settingsToolsAutoApprove = document.getElementById(
    "settingsToolsAutoApprove"
  );
  const settingsApprovalSelects = {
    reads: document.getElementById("settingsApprovalReads"),
    web: document.getElementById("settingsApprovalWeb"),
    edits: document.getElementById("settingsApprovalEdits"),
    commands: document.getElementById("settingsApprovalCommands"),
    mcp: document.getElementById("settingsApprovalMcp"),
    subagents: document.getElementById("settingsApprovalSubagents"),
  };
  const settingsFocusChainEnabled = document.getElementById(
    "settingsFocusChainEnabled"
  );
  const settingsCheckpointsEnabled = document.getElementById(
    "settingsCheckpointsEnabled"
  );
  const settingsTabAutocompleteEnabled = document.getElementById(
    "settingsTabAutocompleteEnabled"
  );
  const settingsTabAutocompleteModel = document.getElementById(
    "settingsTabAutocompleteModel"
  );
  const settingsTabAutocompleteAggressiveness = document.getElementById(
    "settingsTabAutocompleteAggressiveness"
  );
  const settingsTabAutocompleteAlternatives = document.getElementById(
    "settingsTabAutocompleteAlternatives"
  );
  const settingsTabAutocompleteExcludeGlobs = document.getElementById(
    "settingsTabAutocompleteExcludeGlobs"
  );
  const settingsTabAutocompleteNextEdit = document.getElementById(
    "settingsTabAutocompleteNextEdit"
  );
  const settingsTabAutocompleteShowMode = document.getElementById(
    "settingsTabAutocompleteShowMode"
  );
  const settingsTabAutocompleteFim = document.getElementById(
    "settingsTabAutocompleteFim"
  );
  const settingsSelectionHintsEnabled = document.getElementById(
    "settingsSelectionHintsEnabled"
  );
  const settingsAutoglmEnabled = document.getElementById(
    "settingsAutoglmEnabled"
  );
  const settingsAutoglmBrowser = document.getElementById(
    "settingsAutoglmBrowser"
  );
  const settingsAutoglmAutoApprove = document.getElementById(
    "settingsAutoglmAutoApprove"
  );
  const settingsAutoglmBinaryPath = document.getElementById(
    "settingsAutoglmBinaryPath"
  );
  const settingsSystemPrompt = document.getElementById("settingsSystemPrompt");
  const settingsSystemPromptToggle = document.getElementById(
    "settingsSystemPromptToggle"
  );
  const settingsSystemPromptCard = document.getElementById(
    "settingsSystemPromptCard"
  );
  const settingsSystemPromptBody = document.getElementById(
    "settingsSystemPromptBody"
  );
  const settingsSystemPromptPreview = document.getElementById(
    "settingsSystemPromptPreview"
  );
  const settingsTabExcludeToggle = document.getElementById(
    "settingsTabExcludeToggle"
  );
  const settingsTabExcludeCard = document.getElementById(
    "settingsTabExcludeCard"
  );
  const settingsTabExcludeBody = document.getElementById(
    "settingsTabExcludeBody"
  );
  const settingsTabExcludePreview = document.getElementById(
    "settingsTabExcludePreview"
  );

  function updateSystemPromptPreview() {
    if (!settingsSystemPromptPreview) {
      return;
    }
    const raw = String(settingsSystemPrompt?.value || "")
      .replace(/\s+/g, " ")
      .trim();
    settingsSystemPromptPreview.textContent = raw || t("systemPromptEmpty");
  }

  function updateTabExcludePreview() {
    if (!settingsTabExcludePreview) {
      return;
    }
    const lines = String(settingsTabAutocompleteExcludeGlobs?.value || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    settingsTabExcludePreview.textContent = lines.length
      ? lines.join(", ")
      : t("tabAutocompleteExcludeEmpty");
  }
  const settingsCommitScope = document.getElementById("settingsCommitScope");
  const settingsCommitLanguage = document.getElementById(
    "settingsCommitLanguage"
  );
  const settingsCommitModel = document.getElementById("settingsCommitModel");
  const settingsCommitPrompt = document.getElementById("settingsCommitPrompt");
  const settingsCommitPromptToggle = document.getElementById(
    "settingsCommitPromptToggle"
  );
  const settingsCommitPromptCard = document.getElementById(
    "settingsCommitPromptCard"
  );
  const settingsCommitPromptBody = document.getElementById(
    "settingsCommitPromptBody"
  );
  const settingsCommitPromptPreview = document.getElementById(
    "settingsCommitPromptPreview"
  );
  const settingsCommitNote = document.getElementById("settingsCommitNote");
  const settingsCommitScopeLabel = document.getElementById(
    "settingsCommitScopeLabel"
  );
  const settingsCommitLanguageLabel = document.getElementById(
    "settingsCommitLanguageLabel"
  );
  const settingsCommitModelLabel = document.getElementById(
    "settingsCommitModelLabel"
  );
  const settingsCommitPromptLabel = document.getElementById(
    "settingsCommitPromptLabel"
  );

  function updateCommitPromptPreview() {
    if (!settingsCommitPromptPreview) {
      return;
    }
    const raw = String(settingsCommitPrompt?.value || "")
      .replace(/\s+/g, " ")
      .trim();
    settingsCommitPromptPreview.textContent = raw || t("commitPromptEmpty");
  }

  function updateCommitScopeWorkspaceOption() {
    if (!settingsCommitScope) {
      return;
    }
    const workspaceOpt = settingsCommitScope.querySelector(
      'option[value="workspace"]'
    );
    if (workspaceOpt) {
      workspaceOpt.textContent = t(
        "commitScopeWorkspaceNamed",
        settingsWorkspaceName
      );
    }
  }
  const settingsFigmaTitle = null;
  const settingsMcpTitle = document.getElementById("settingsMcpTitle");
  const settingsMcpNote = document.getElementById("settingsMcpNote");
  const settingsMcpEntryTitle = document.getElementById(
    "settingsMcpEntryTitle"
  );
  const settingsMcpEntrySub = document.getElementById("settingsMcpEntrySub");
  const openMcpServersBtn = document.getElementById("openMcpServersBtn");
  const mcpScreen = document.getElementById("mcpScreen");
  const backFromMcpBtn = document.getElementById("backFromMcpBtn");
  const mcpScreenTitle = document.getElementById("mcpScreenTitle");
  const mcpSubtitle = document.getElementById("mcpSubtitle");
  const mcpSearchInput = document.getElementById("mcpSearchInput");
  const mcpAddBtn = document.getElementById("mcpAddBtn");
  const mcpPresetsLabel = document.getElementById("mcpPresetsLabel");
  const mcpPresetsNote = document.getElementById("mcpPresetsNote");
  const mcpPresetPlaywright = document.getElementById("mcpPresetPlaywright");
  const mcpPresetGithub = document.getElementById("mcpPresetGithub");
  const mcpConfiguredTitle = document.getElementById("mcpConfiguredTitle");
  const mcpConfiguredCount = document.getElementById("mcpConfiguredCount");
  const mcpServersList = document.getElementById("mcpServersList");
  const mcpEmpty = document.getElementById("mcpEmpty");
  const mcpEditModal = document.getElementById("mcpEditModal");
  const mcpEditTitle = document.getElementById("mcpEditTitle");
  const mcpEditCloseBtn = document.getElementById("mcpEditCloseBtn");
  const mcpEditNote = document.getElementById("mcpEditNote");
  const mcpEditStatus = document.getElementById("mcpEditStatus");
  const mcpCustomEditModal = document.getElementById("mcpCustomEditModal");
  const mcpCustomEditTitle = document.getElementById("mcpCustomEditTitle");
  const mcpCustomEditCloseBtn = document.getElementById(
    "mcpCustomEditCloseBtn"
  );
  const mcpCustomEditCancelBtn = document.getElementById(
    "mcpCustomEditCancelBtn"
  );
  const mcpCustomEditSaveBtn = document.getElementById("mcpCustomEditSaveBtn");
  const mcpCustomEditId = document.getElementById("mcpCustomEditId");
  const mcpCustomName = document.getElementById("mcpCustomName");
  const mcpCustomTransport = document.getElementById("mcpCustomTransport");
  const mcpCustomStdioFields = document.getElementById("mcpCustomStdioFields");
  const mcpCustomHttpFields = document.getElementById("mcpCustomHttpFields");
  const mcpCustomCommand = document.getElementById("mcpCustomCommand");
  const mcpCustomArgs = document.getElementById("mcpCustomArgs");
  const mcpCustomEnv = document.getElementById("mcpCustomEnv");
  const mcpCustomCwd = document.getElementById("mcpCustomCwd");
  const mcpCustomUrl = document.getElementById("mcpCustomUrl");
  const mcpCustomToken = document.getElementById("mcpCustomToken");
  const mcpCustomNameLabel = document.getElementById("mcpCustomNameLabel");
  const mcpCustomTransportLabel = document.getElementById(
    "mcpCustomTransportLabel"
  );
  const mcpCustomCommandLabel = document.getElementById(
    "mcpCustomCommandLabel"
  );
  const mcpCustomArgsLabel = document.getElementById("mcpCustomArgsLabel");
  const mcpCustomEnvLabel = document.getElementById("mcpCustomEnvLabel");
  const mcpCustomCwdLabel = document.getElementById("mcpCustomCwdLabel");
  const mcpCustomUrlLabel = document.getElementById("mcpCustomUrlLabel");
  const mcpCustomTokenLabel = document.getElementById("mcpCustomTokenLabel");
  let mcpServersCache = [];
  const skillsRefreshBtn = document.getElementById("skillsRefreshBtn");
  const skillsFoldersList = document.getElementById("skillsFoldersList");
  let skillsCache = { enabled: true, directories: [], skills: [] };
  /** User slash commands from .harbor/commands/*.md (host-side). */
  let userSlashCommands = [];
  const settingsFigmaEnabled = null;
  const settingsFigmaEnabledLabel = null;
  const settingsFigmaStatus = mcpEditStatus;
  const settingsFigmaNote = null;
  const settingsFigmaConnectBtn = document.getElementById(
    "settingsFigmaConnectBtn"
  );
  const settingsFigmaDisconnectBtn = document.getElementById(
    "settingsFigmaDisconnectBtn"
  );
  const settingsFigmaPatBlock = document.getElementById(
    "settingsFigmaPatBlock"
  );
  const settingsFigmaPatNote = document.getElementById("settingsFigmaPatNote");
  const settingsFigmaPatLabel = document.getElementById(
    "settingsFigmaPatLabel"
  );
  const settingsFigmaPat = document.getElementById("settingsFigmaPat");
  const settingsFigmaPatConnectBtn = document.getElementById(
    "settingsFigmaPatConnectBtn"
  );
  const settingsFigmaPatHelpBtn = document.getElementById(
    "settingsFigmaPatHelpBtn"
  );
  let figmaStatus = { state: "disconnected", enabled: true };
  let mcpSearchQuery = "";
  let mcpScreenOpen = false;
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
  const modeEditColor = document.getElementById("modeEditColor");
  const modeEditColorRow = document.getElementById("modeEditColorRow");
  const modeEditCloseBtn = document.getElementById("modeEditCloseBtn");
  const modeEditCancelBtn = document.getElementById("modeEditCancelBtn");
  const modeEditDoneBtn = document.getElementById("modeEditDoneBtn");

  let agentsData = [];
  let archiveAgentsData = [];
  let activeAgentId = "";
  let activeChatId = "";
  let chatBranches = [];
  let renamingAgentId = null;
  let settingsModels = [];
  let settingsProviders = [];
  /** @type {Record<string, { providerId?: string, providerName?: string, state?: string, message?: string }>} */
  let providerConnById = {};
  let settingsModes = [];
  let settingsDefaultModelId = "";
  let settingsLanguageValue = "auto";
  let settingsWorkspaceName = "";
  let settingsDefaultContextWindow = 128000;
  let modelEditIndex = null;
  let modelEditMode = "manual";
  let providerEditIndex = null;
  let fetchModelsRequestId = 0;
  let fetchModelsActiveRequestId = "";
  let fetchModelsProviderId = "";
  let fetchModelsIds = [];
  let fetchModelsById = new Map();
  let fetchModelsSelected = new Set();
  let fetchModelsExisting = new Set();
  let fetchModelsLoading = false;
  let fetchModelsError = "";
  let fetchModelsTarget = "modal"; // "modal" | "editApi"
  let settingsHydrating = false;
  let settingsSaveTimer = null;
  let settingsSaveStatusTimer = null;
  let settingsModelTipEl = null;
  let settingsModelTipRows = null;
  let settingsModelTipIndex = null;
  let settingsModelTipHideTimer = null;
  let contextUsed = 0;
  let contextMax = 128000;
  let notificationAudioContext = null;

  function ensureNotificationAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    if (
      !notificationAudioContext ||
      notificationAudioContext.state === "closed"
    ) {
      notificationAudioContext = new AudioContextCtor();
    }
    return notificationAudioContext;
  }

  function unlockNotificationAudio() {
    const ctx = ensureNotificationAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
  }

  function scheduleNotificationTone(ctx, frequency, start, duration) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + Math.max(0.05, duration)
    );
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playRunFinishedSound(outcome) {
    const ctx = ensureNotificationAudioContext();
    if (!ctx) {
      return;
    }
    const play = () => {
      const start = ctx.currentTime + 0.02;
      if (outcome === "error") {
        scheduleNotificationTone(ctx, 220, start, 0.16);
        scheduleNotificationTone(ctx, 165, start + 0.17, 0.24);
      } else {
        scheduleNotificationTone(ctx, 523.25, start, 0.12);
        scheduleNotificationTone(ctx, 659.25, start + 0.13, 0.2);
      }
    };
    if (ctx.state === "suspended") {
      void ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  }

  document.addEventListener("pointerdown", unlockNotificationAudio, {
    once: true,
    capture: true,
  });
  document.addEventListener("keydown", unlockNotificationAudio, {
    once: true,
    capture: true,
  });

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

  const CLOUD_DOWNLOAD_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">cloud_download</span>';

  const INFO_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">info</span>';

  const HEART_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">favorite</span>';

  const REGENERATE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">refresh</span>';

  const BRANCH_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">fork_right</span>';

  const COPY_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">content_copy</span>';

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
  let restoringChatScroll = false;
  let pendingScrollSync = 0;
  /** Follow live output only while the viewport is pinned to the bottom. */
  let stickToBottom = true;
  const NEAR_BOTTOM_PX = 80;
  let scrollBottomRaf = 0;

  function localizeStaticUi() {
    document.title = "Harbor Agents";
    const agentTitles = document.querySelectorAll(".agents-title");
    if (agentTitles[0]) agentTitles[0].textContent = t("agents");
    if (agentTitles[1]) agentTitles[1].textContent = t("archive");
    if (openSettingsBtn) {
      openSettingsBtn.title =
        openSettingsBtn.setAttribute("aria-label", t("settings")) || t("settings");
    }
    if (openArchiveBtn) {
      openArchiveBtn.title =
        openArchiveBtn.setAttribute("aria-label", t("archive")) || t("archive");
    }
    if (newAgentBtn) {
      newAgentBtn.title =
        newAgentBtn.setAttribute("aria-label", t("newAgent")) || t("newAgent");
    }
    if (chatNewAgentBtn) {
      chatNewAgentBtn.title =
        chatNewAgentBtn.setAttribute("aria-label", t("newAgent")) || t("newAgent");
    }
    if (backFromArchiveBtn) {
      backFromArchiveBtn.title =
        backFromArchiveBtn.setAttribute("aria-label", t("backToAgents")) ||
        t("backToAgents");
    }
    if (deleteAllArchiveBtn) {
      deleteAllArchiveBtn.textContent = t("deleteAll");
      deleteAllArchiveBtn.title =
        deleteAllArchiveBtn.setAttribute("aria-label", t("deleteAll")) ||
        t("deleteAll");
    }
    syncAgentsRailToggleUi();
    if (settingsSaveStatus) {
      settingsSaveStatus.textContent = t("saved");
    }
    if (openChatSearchBtn) {
      openChatSearchBtn.title =
        openChatSearchBtn.setAttribute("aria-label", t("searchChat")) ||
        t("searchChat");
    }
    if (closeChatSearchBtn) {
      closeChatSearchBtn.title =
        closeChatSearchBtn.setAttribute("aria-label", t("close")) || t("close");
    }
    chatBranchesEl.setAttribute("aria-label", UI_LANG === "ru" ? "Ветки диалога" : "Conversation branches");
    if (chatSearchInput) {
      chatSearchInput.placeholder = t("search");
      chatSearchInput.setAttribute("aria-label", t("searchChat"));
    }
    if (chatSearchResults) {
      chatSearchResults.setAttribute("aria-label", t("searchResults"));
    }
    promptEl.placeholder = t("taskPlaceholder");
    composerPlusBtn.title = composerPlusBtn.setAttribute("aria-label", t("add")) || t("add");
    composerPlusMenu.querySelectorAll(".composer-plus-item").forEach((item) => {
      const action = item.getAttribute("data-action");
      const label = item.querySelector("span:last-child");
      if (!label) {
        return;
      }
      if (action === "file") {
        label.textContent = t("file");
        item.title = t("attachFile");
      }
    });
    modeTrigger.title = t("mode");
    modelTrigger.title = t("model");
    modeLabel.textContent = t("agent");
    modelLabel.textContent = t("model");
    if (reasonTrigger) {
      reasonTrigger.title = t("intelligence");
    }
    if (reasonLabel) {
      reasonLabel.textContent = t("reasonMedium");
    }
    sendBtn.title = sendBtn.setAttribute("aria-label", t("send")) || t("send");
    if (messageQueueEl) {
      messageQueueEl.setAttribute("aria-label", t("queuePending"));
    }
    composerDropHintEl.querySelector(".composer-drop-hint-text").textContent =
      UI_LANG === "ru" ? "Отпустите файл, чтобы прикрепить" : "Drop file to attach";
    contextRingEl.setAttribute("aria-label", t("contextUsage"));
    chatAgentNameEl.textContent = t("agent");
    const setText = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t(key);
    };
    setText("settingsModelsProvidersTitle", "modelsProviders");
    setText("settingsModesTitle", "modes");
    setText("settingsLanguageTitle", "languageSection");
    setText("settingsAppearanceTitle", "appearanceSection");
    setText("settingsAppearanceNote", "appearanceNote");
    setText("settingsFontSizeLabel", "fontSize");
    setText("settingsFontSizeHint", "fontSizeHint");
    setText("settingsFontPreview", "fontSizePreview");
    setText("settingsCommitTitle", "commitMessages");
    setText("settingsCommitGenerationTitle", "commitGeneration");
    setText("settingsCommitStorageTitle", "commitStorage");
    setText("settingsCommitScopeHint", "commitScopeHint");
    setText("settingsMcpTitle", "mcpServers");
    setText("settingsSkillsTitle", "skillsSection");
    setText("settingsBrowserTitle", "browserAgentTitle");
    setText("settingsAutoglmConnectionTitle", "autoglmConnection");
    setText("settingsAgentTitle", "agentBehavior");
    setText("settingsLimitsTitle", "agentLimits");
    setText("settingsExecutionTitle", "agentExecution");
    setText("settingsInterfaceTitle", "agentInterface");
    setText("settingsAdvancedTitle", "advancedSettings");
    document.querySelectorAll("[data-i18n-nav]").forEach((el) => {
      const key = el.getAttribute("data-i18n-nav");
      if (key && t(key)) el.textContent = t(key);
    });
    const settingsProvidersNote = document.getElementById(
      "settingsProvidersNote"
    );
    if (settingsProvidersNote) {
      settingsProvidersNote.textContent = t("providersNote");
    }
    if (addProviderBtn) addProviderBtn.textContent = t("addProvider");
    if (addModelBtn) addModelBtn.textContent = t("addModel");
    const newProviderIdLabel = document.getElementById(
      "modelEditNewProviderIdLabel"
    );
    const newProviderNameLabel = document.getElementById(
      "modelEditNewProviderNameLabel"
    );
    const newProviderUrlLabel = document.getElementById(
      "modelEditNewProviderUrlLabel"
    );
    const newProviderKeyLabel = document.getElementById(
      "modelEditNewProviderKeyLabel"
    );
    if (newProviderIdLabel) newProviderIdLabel.textContent = t("providerIdLabel");
    if (newProviderNameLabel) {
      newProviderNameLabel.textContent = t("providerNameLabel");
    }
    if (newProviderUrlLabel) newProviderUrlLabel.textContent = t("baseUrl");
    if (newProviderKeyLabel) newProviderKeyLabel.textContent = t("apiKey");
    const providerEditStatusUrlLabel = document.getElementById(
      "providerEditStatusUrlLabel"
    );
    const providerEditStatusUrlHint = document.getElementById(
      "providerEditStatusUrlHint"
    );
    if (providerEditStatusUrlLabel) {
      providerEditStatusUrlLabel.textContent = t("statusUrl");
    }
    if (providerEditStatusUrlHint) {
      providerEditStatusUrlHint.textContent = t("statusUrlHint");
    }
    const modelEditProviderLabel = document.getElementById(
      "modelEditProviderLabel"
    );
    if (modelEditProviderLabel) {
      modelEditProviderLabel.textContent = t("provider");
    }
    if (modelEditTabs) {
      const manualTab = modelEditTabs.querySelector('[data-model-mode="manual"]');
      const apiTab = modelEditTabs.querySelector('[data-model-mode="api"]');
      const jsonTab = modelEditTabs.querySelector('[data-model-mode="json"]');
      if (manualTab) manualTab.textContent = t("fetchModelsManual");
      if (apiTab) apiTab.textContent = t("fetchModelsFromApi");
      if (jsonTab) jsonTab.textContent = t("fetchModelsJson");
    }
    if (modelEditApiNote) modelEditApiNote.textContent = t("fetchModelsApiNote");
    if (modelEditApiFetchBtn) {
      modelEditApiFetchBtn.textContent = t("fetchModels");
    }
    if (modelEditApiSelectNewBtn) {
      modelEditApiSelectNewBtn.textContent = t("fetchModelsSelectNew");
    }
    if (modelEditApiSearchLabel) {
      modelEditApiSearchLabel.textContent = t("fetchModelsFilter");
    }
    if (fetchModelsTitle) fetchModelsTitle.textContent = t("fetchModelsTitle");
    if (fetchModelsNote) fetchModelsNote.textContent = t("fetchModelsNote");
    if (fetchModelsSearchLabel) {
      fetchModelsSearchLabel.textContent = t("fetchModelsFilter");
    }
    if (fetchModelsSelectNewBtn) {
      fetchModelsSelectNewBtn.textContent = t("fetchModelsSelectNew");
    }
    if (fetchModelsAddBtn) {
      fetchModelsAddBtn.textContent = t("fetchModelsAddSelected");
    }
    if (fetchModelsCancelBtn) fetchModelsCancelBtn.textContent = t("cancel");
    const settingsModesNote = document.getElementById("settingsModesNote");
    if (settingsModesNote) settingsModesNote.textContent = t("modesNote");
    const addModeBtnEl = document.getElementById("addModeBtn");
    if (addModeBtnEl) addModeBtnEl.textContent = t("addModeShort");
    applyModeEditModalStrings();
    const settingsLanguageLabel = document.getElementById(
      "settingsLanguageLabel"
    );
    if (settingsLanguageLabel) {
      settingsLanguageLabel.textContent = t("pluginUiLanguage");
    }
    if (settingsLanguage) {
      const autoOpt = settingsLanguage.querySelector('option[value="auto"]');
      const enOpt = settingsLanguage.querySelector('option[value="en"]');
      const ruOpt = settingsLanguage.querySelector('option[value="ru"]');
      if (autoOpt) {
        autoOpt.textContent = harborHostAvailable()
          ? UI_LANG === "ru"
            ? "Авто (как в IDE)"
            : "Auto (follow IDE)"
          : t("languageAuto");
      }
      if (enOpt) enOpt.textContent = t("languageEn");
      if (ruOpt) ruOpt.textContent = t("languageRu");
    }
    if (settingsFontSize) {
      applyUiFontSize(settingsFontSize.value);
    }
    const settingsTlsValidateLabel = document.getElementById(
      "settingsTlsValidateLabel"
    );
    if (settingsTlsValidateLabel) {
      settingsTlsValidateLabel.textContent = t("validateTls");
    }
    const settingsSystemPromptLabel = document.getElementById(
      "settingsSystemPromptLabel"
    );
    if (settingsSystemPromptLabel) {
      settingsSystemPromptLabel.textContent = t("systemPrompt");
    }
    const settingsMaxToolRoundsLabel = document.getElementById(
      "settingsMaxToolRoundsLabel"
    );
    if (settingsMaxToolRoundsLabel) {
      settingsMaxToolRoundsLabel.textContent = t("maxToolRounds");
    }
    const settingsMaxTokensLabel = document.getElementById(
      "settingsMaxTokensLabel"
    );
    if (settingsMaxTokensLabel) {
      settingsMaxTokensLabel.textContent = t("maxTokens");
    }
    setText("settingsMaxTokensHint", "maxTokensHint");
    const settingsMaxResponseCharsLabel = document.getElementById(
      "settingsMaxResponseCharsLabel"
    );
    if (settingsMaxResponseCharsLabel) {
      settingsMaxResponseCharsLabel.textContent = t("maxResponseLength");
    }
    setText("settingsMaxResponseCharsHint", "maxResponseCharsHint");
    const settingsSoundNotificationsLabel = document.getElementById(
      "settingsSoundNotificationsLabel"
    );
    if (settingsSoundNotificationsLabel) {
      settingsSoundNotificationsLabel.textContent = t("soundNotifications");
    }
    setText("settingsSoundNotificationsNote", "soundNotificationsNote");
    const settingsSubagentsLabel = document.getElementById(
      "settingsSubagentsLabel"
    );
    if (settingsSubagentsLabel) {
      settingsSubagentsLabel.textContent = t("parallelAgents");
    }
    const settingsSubagentsNote = document.getElementById(
      "settingsSubagentsNote"
    );
    if (settingsSubagentsNote) {
      settingsSubagentsNote.textContent = t("parallelAgentsNote");
    }
    const settingsParallelToolCallsLabel = document.getElementById(
      "settingsParallelToolCallsLabel"
    );
    if (settingsParallelToolCallsLabel) {
      settingsParallelToolCallsLabel.textContent = t("parallelToolCalls");
    }
    const settingsParallelToolCallsNote = document.getElementById(
      "settingsParallelToolCallsNote"
    );
    if (settingsParallelToolCallsNote) {
      settingsParallelToolCallsNote.textContent = t("parallelToolCallsNote");
    }
    const settingsAutoCompactLabel = document.getElementById(
      "settingsAutoCompactLabel"
    );
    if (settingsAutoCompactLabel) {
      settingsAutoCompactLabel.textContent = t("autoCompact");
    }
    const settingsAutoCompactNote = document.getElementById(
      "settingsAutoCompactNote"
    );
    if (settingsAutoCompactNote) {
      settingsAutoCompactNote.textContent = t("autoCompactNote");
    }
    const settingsToolsAutoApproveLabel = document.getElementById(
      "settingsToolsAutoApproveLabel"
    );
    if (settingsToolsAutoApproveLabel) {
      settingsToolsAutoApproveLabel.textContent = t("toolsAutoApprove");
    }
    const settingsToolsAutoApproveNote = document.getElementById(
      "settingsToolsAutoApproveNote"
    );
    if (settingsToolsAutoApproveNote) {
      settingsToolsAutoApproveNote.textContent = t("toolsAutoApproveNote");
    }
    const approvalGroups = [
      "Reads",
      "Web",
      "Edits",
      "Commands",
      "Mcp",
      "Subagents",
    ];
    const approvalKeyByGroup = {
      Reads: "approvalReads",
      Web: "approvalWeb",
      Edits: "approvalEdits",
      Commands: "approvalCommands",
      Mcp: "approvalMcp",
      Subagents: "approvalSubagents",
    };
    const approvalOptionLabels = {
      inherit: t("approvalInherit"),
      auto: t("approvalAuto"),
      ask: t("approvalAsk"),
    };
    for (const group of approvalGroups) {
      const label = document.getElementById(`settingsApproval${group}Label`);
      if (label) {
        label.textContent = t(approvalKeyByGroup[group]);
      }
      const note = document.getElementById(`settingsApproval${group}Note`);
      if (note) {
        note.textContent = t(`${approvalKeyByGroup[group]}Note`);
      }
      const select = document.getElementById(
        `settingsApproval${group}`
      );
      if (select) {
        for (const option of select.options || []) {
          const optionLabel = approvalOptionLabels[option.value];
          if (optionLabel) {
            option.textContent = optionLabel;
          }
        }
      }
    }
    const settingsFocusChainLabel = document.getElementById(
      "settingsFocusChainLabel"
    );
    if (settingsFocusChainLabel) {
      settingsFocusChainLabel.textContent = t("focusChain");
    }
    const settingsFocusChainNote = document.getElementById(
      "settingsFocusChainNote"
    );
    if (settingsFocusChainNote) {
      settingsFocusChainNote.textContent = t("focusChainNote");
    }
    const settingsCheckpointsLabel = document.getElementById(
      "settingsCheckpointsLabel"
    );
    if (settingsCheckpointsLabel) {
      settingsCheckpointsLabel.textContent = t("checkpoints");
    }
    const settingsCheckpointsNote = document.getElementById(
      "settingsCheckpointsNote"
    );
    if (settingsCheckpointsNote) {
      settingsCheckpointsNote.textContent = t("checkpointsNote");
    }
    const settingsTabAutocompleteTitle = document.getElementById(
      "settingsTabAutocompleteTitle"
    );
    if (settingsTabAutocompleteTitle) {
      settingsTabAutocompleteTitle.textContent = t("tabAutocomplete");
    }
    const settingsTabAutocompleteLabel = document.getElementById(
      "settingsTabAutocompleteLabel"
    );
    if (settingsTabAutocompleteLabel) {
      settingsTabAutocompleteLabel.textContent = t("tabAutocompleteEnable");
    }
    const settingsTabAutocompleteNote = document.getElementById(
      "settingsTabAutocompleteNote"
    );
    if (settingsTabAutocompleteNote) {
      settingsTabAutocompleteNote.textContent = t("tabAutocompleteNote");
    }
    const settingsTabAutocompleteModelLabel = document.getElementById(
      "settingsTabAutocompleteModelLabel"
    );
    if (settingsTabAutocompleteModelLabel) {
      settingsTabAutocompleteModelLabel.textContent = t("tabAutocompleteModel");
    }
    const settingsTabAutocompleteModelHint = document.getElementById(
      "settingsTabAutocompleteModelHint"
    );
    if (settingsTabAutocompleteModelHint) {
      settingsTabAutocompleteModelHint.textContent = t(
        "tabAutocompleteModelHint"
      );
    }
    const settingsTabAutocompleteAggLabel = document.getElementById(
      "settingsTabAutocompleteAggLabel"
    );
    if (settingsTabAutocompleteAggLabel) {
      settingsTabAutocompleteAggLabel.textContent = t("tabAutocompleteAgg");
    }
    if (settingsTabAutocompleteAggressiveness) {
      const optLow = settingsTabAutocompleteAggressiveness.querySelector(
        'option[value="low"]'
      );
      const optMed = settingsTabAutocompleteAggressiveness.querySelector(
        'option[value="medium"]'
      );
      const optHigh = settingsTabAutocompleteAggressiveness.querySelector(
        'option[value="high"]'
      );
      if (optLow) optLow.textContent = t("tabAutocompleteAggLow");
      if (optMed) optMed.textContent = t("tabAutocompleteAggMedium");
      if (optHigh) optHigh.textContent = t("tabAutocompleteAggHigh");
    }
    const settingsTabAutocompleteAltsLabel = document.getElementById(
      "settingsTabAutocompleteAltsLabel"
    );
    if (settingsTabAutocompleteAltsLabel) {
      settingsTabAutocompleteAltsLabel.textContent = t("tabAutocompleteAlts");
    }
    if (settingsTabAutocompleteAlternatives) {
      const a1 = settingsTabAutocompleteAlternatives.querySelector(
        'option[value="1"]'
      );
      const a2 = settingsTabAutocompleteAlternatives.querySelector(
        'option[value="2"]'
      );
      const a3 = settingsTabAutocompleteAlternatives.querySelector(
        'option[value="3"]'
      );
      if (a1) a1.textContent = t("tabAutocompleteAlts1");
      if (a2) a2.textContent = t("tabAutocompleteAlts2");
      if (a3) a3.textContent = t("tabAutocompleteAlts3");
    }
    const settingsTabAutocompleteAltsHint = document.getElementById(
      "settingsTabAutocompleteAltsHint"
    );
    if (settingsTabAutocompleteAltsHint) {
      settingsTabAutocompleteAltsHint.textContent = t("tabAutocompleteAltsHint");
    }
    const settingsTabAutocompleteExcludeLabel = document.getElementById(
      "settingsTabAutocompleteExcludeLabel"
    );
    if (settingsTabAutocompleteExcludeLabel) {
      settingsTabAutocompleteExcludeLabel.textContent = t(
        "tabAutocompleteExclude"
      );
    }
    const settingsTabAutocompleteExcludeHint = document.getElementById(
      "settingsTabAutocompleteExcludeHint"
    );
    if (settingsTabAutocompleteExcludeHint) {
      settingsTabAutocompleteExcludeHint.textContent = t(
        "tabAutocompleteExcludeHint"
      );
    }
    const settingsTabAutocompleteNextEditLabel = document.getElementById(
      "settingsTabAutocompleteNextEditLabel"
    );
    if (settingsTabAutocompleteNextEditLabel) {
      settingsTabAutocompleteNextEditLabel.textContent = t(
        "tabAutocompleteNextEdit"
      );
    }
    const settingsTabAutocompleteNextEditHint = document.getElementById(
      "settingsTabAutocompleteNextEditHint"
    );
    if (settingsTabAutocompleteNextEditHint) {
      settingsTabAutocompleteNextEditHint.textContent = t(
        "tabAutocompleteNextEditHint"
      );
    }
    const settingsTabAutocompleteShowModeLabel = document.getElementById(
      "settingsTabAutocompleteShowModeLabel"
    );
    if (settingsTabAutocompleteShowModeLabel) {
      settingsTabAutocompleteShowModeLabel.textContent = t(
        "tabAutocompleteShowMode"
      );
    }
    if (settingsTabAutocompleteShowMode) {
      const chip = settingsTabAutocompleteShowMode.querySelector(
        'option[value="chip"]'
      );
      const inline = settingsTabAutocompleteShowMode.querySelector(
        'option[value="inline"]'
      );
      if (chip) chip.textContent = t("tabAutocompleteShowModeChip");
      if (inline) inline.textContent = t("tabAutocompleteShowModeInline");
    }
    const settingsTabAutocompleteShowModeHint = document.getElementById(
      "settingsTabAutocompleteShowModeHint"
    );
    if (settingsTabAutocompleteShowModeHint) {
      settingsTabAutocompleteShowModeHint.textContent = t(
        "tabAutocompleteShowModeHint"
      );
    }
    const settingsTabAutocompleteFimLabel = document.getElementById(
      "settingsTabAutocompleteFimLabel"
    );
    if (settingsTabAutocompleteFimLabel) {
      settingsTabAutocompleteFimLabel.textContent = t("tabAutocompleteFim");
    }
    const settingsTabAutocompleteFimHint = document.getElementById(
      "settingsTabAutocompleteFimHint"
    );
    if (settingsTabAutocompleteFimHint) {
      settingsTabAutocompleteFimHint.textContent = t("tabAutocompleteFimHint");
    }
    const settingsTabAutocompleteKeysHint = document.getElementById(
      "settingsTabAutocompleteKeysHint"
    );
    if (settingsTabAutocompleteKeysHint) {
      settingsTabAutocompleteKeysHint.textContent = t("tabAutocompleteKeysHint");
    }
    const settingsSelectionHintsLabel = document.getElementById(
      "settingsSelectionHintsLabel"
    );
    if (settingsSelectionHintsLabel) {
      settingsSelectionHintsLabel.textContent = t("selectionHints");
    }
    setText("settingsSelectionHintsNote", "selectionHintsNote");
    updateSystemPromptPreview();
    updateTabExcludePreview();
    if (settingsMcpNote) settingsMcpNote.textContent = t("mcpServersNote");
    const settingsSkillsNote = document.getElementById("settingsSkillsNote");
    if (settingsSkillsNote) settingsSkillsNote.textContent = t("skillsNote");
    setText("skillsRefreshLabel", "skillsRefresh");
    setText("skillsFoldersTitle", "skillsFoldersTitle");
    setText("skillsFoldersDisabledHint", "skillsFoldersDisabledHint");
    const settingsBrowserNote = document.getElementById("settingsBrowserNote");
    if (settingsBrowserNote) {
      settingsBrowserNote.textContent = t("browserAgentNote");
    }
    setText("settingsAutoglmEnabledLabel", "autoglmEnabled");
    setText("settingsAutoglmEnabledNote", "autoglmEnabledNote");
    setText("settingsAutoglmAutoApproveLabel", "autoglmAutoApprove");
    setText("settingsAutoglmAutoApproveNote", "autoglmAutoApproveNote");
    setText("settingsAutoglmBrowserLabel", "autoglmBrowser");
    setText("settingsAutoglmBrowserHint", "autoglmBrowserHint");
    setText("settingsAutoglmBinaryPathLabel", "autoglmBinaryPath");
    setText("settingsAutoglmBinaryPathHint", "autoglmBinaryPathHint");
    if (settingsAutoglmBinaryPath) {
      settingsAutoglmBinaryPath.placeholder = t("autoglmBinaryPathPlaceholder");
    }
    if (mcpConfiguredTitle) mcpConfiguredTitle.textContent = t("mcpConfigured");
    if (mcpSearchInput) {
      mcpSearchInput.placeholder = t("mcpSearchPlaceholder");
    }
    if (mcpAddBtn) {
      mcpAddBtn.title = mcpAddBtn.setAttribute("aria-label", t("add")) || t("add");
    }
    if (mcpPresetsLabel) mcpPresetsLabel.textContent = t("mcpPresetsLabel");
    if (mcpPresetPlaywright) {
      const label = mcpPresetPlaywright.querySelector(".mcp-preset-btn-label");
      if (label) label.textContent = t("mcpPresetPlaywright");
    }
    if (mcpPresetGithub) {
      const label = mcpPresetGithub.querySelector(".mcp-preset-btn-label");
      if (label) label.textContent = t("mcpPresetGithub");
    }
    if (mcpEditNote) mcpEditNote.textContent = t("mcpEditNote");
    if (settingsFigmaConnectBtn) {
      settingsFigmaConnectBtn.textContent = t("figmaConnect");
    }
    if (settingsFigmaDisconnectBtn) {
      settingsFigmaDisconnectBtn.textContent = t("figmaDisconnect");
    }
    if (settingsFigmaPatNote) {
      settingsFigmaPatNote.textContent = t("figmaPatNote");
    }
    if (settingsFigmaPatLabel) {
      settingsFigmaPatLabel.textContent = t("figmaPatLabel");
    }
    if (settingsFigmaPatConnectBtn) {
      settingsFigmaPatConnectBtn.textContent = t("figmaPatConnect");
    }
    if (settingsFigmaPatHelpBtn) {
      settingsFigmaPatHelpBtn.textContent = t("figmaOpenTokenHelp");
    }
    renderFigmaStatus(figmaStatus);
    if (settingsCommitNote) {
      settingsCommitNote.textContent = t("commitMessagesNote");
    }
    if (settingsCommitScopeLabel) {
      settingsCommitScopeLabel.textContent = t("commitScope");
    }
    if (settingsCommitLanguageLabel) {
      settingsCommitLanguageLabel.textContent = t("commitLanguage");
    }
    if (settingsCommitModelLabel) {
      settingsCommitModelLabel.textContent = t("commitModel");
    }
    if (settingsCommitPromptLabel) {
      settingsCommitPromptLabel.textContent = t("commitPrompt");
    }
    if (settingsCommitPrompt) {
      settingsCommitPrompt.placeholder = t("commitPromptPlaceholder");
    }
    updateCommitPromptPreview();
    if (settingsCommitScope) {
      const globalOpt = settingsCommitScope.querySelector(
        'option[value="global"]'
      );
      if (globalOpt) globalOpt.textContent = t("commitScopeGlobal");
      updateCommitScopeWorkspaceOption();
    }
    if (settingsCommitLanguage) {
      const autoOpt = settingsCommitLanguage.querySelector(
        'option[value="auto"]'
      );
      const enOpt = settingsCommitLanguage.querySelector('option[value="en"]');
      const ruOpt = settingsCommitLanguage.querySelector('option[value="ru"]');
      if (autoOpt) autoOpt.textContent = t("commitLanguageAuto");
      if (enOpt) enOpt.textContent = t("languageEn");
      if (ruOpt) ruOpt.textContent = t("languageRu");
    }
  }

  localizeStaticUi();

  function localizeModeMeta(meta) {
    if (!meta || typeof meta !== "object") {
      return meta;
    }
    if (meta.id === "agent") {
      return {
        ...meta,
        label: t("agent"),
        description: UI_LANG === "ru" ? "Читает и правит код" : "Reads and edits code",
        placeholder: t("taskPlaceholder"),
      };
    }
    if (meta.id === "plan") {
      return {
        ...meta,
        label: t("plan"),
        description: UI_LANG === "ru" ? "Только план, без правок" : "Plan only, no edits",
        placeholder:
          UI_LANG === "ru"
            ? "Опишите задачу — агент составит план без правок… (@ — файл)"
            : "Describe the task — the agent will draft a plan without edits... (@ for file)",
      };
    }
    if (meta.id === "ask") {
      return {
        ...meta,
        label: t("ask"),
        description: UI_LANG === "ru" ? "Ответы и объяснения" : "Answers and explanations",
        placeholder:
          UI_LANG === "ru"
            ? "Спросите про код или задачу… (@ — файл)"
            : "Ask about code or a task... (@ for file)",
      };
    }
    return meta;
  }

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
    const id = typeof model === "string" ? model : model.id;
    const stored =
      typeof model === "string"
        ? models.find((m) => m.id === model)?.supportsVision
        : model.supportsVision;
    if (stored === true) {
      return true;
    }
    return guessModelSupportsVision(id);
  }

  let busy = false;
  let canRegenerate = false;
  let uiMessagesCache = [];
  let pendingAttachments = [];
  let pendingSelections = [];
  /** @type {Array<{id: string, path: string, startLine: number, endLine: number}>} */
  let pendingMentions = [];
  /** @type {Map<string, Array<{id: string, text: string, attachments: any[], mode: string, model: string, reasoningEffort?: string}>>} */
  const messageQueues = new Map();
  const MAX_MESSAGE_QUEUE = 10;
  let drainingQueue = false;
  let drainScheduled = false;
  let mentionOpen = false;
  let mentionItems = [];
  let mentionActiveIndex = 0;
  let mentionRequestId = 0;
  let mentionQuery = "";
  let mentionStart = -1;
  /** @type {HTMLTextAreaElement | null} */
  let mentionTarget = null;
  let mentionSearchTimer = null;
  let slashOpen = false;
  let slashItems = [];
  let slashActiveIndex = 0;
  let slashQuery = "";
  let slashStart = -1;
  let editingUserIndex = null;
  let editingUserText = "";
  let editingModelId = "";
  let editingModeId = "";
  let editingReasoningEffort = "";
  let editingAttachments = [];
  let editModelMenuOpen = false;
  let editModeMenuOpen = false;
  let editPlusMenuOpen = false;
  let editReasonMenuOpen = false;
  /** True while a host file picker was opened from the edit-composer "+" button. */
  let pickAttachmentsForEdit = false;
  let harborEditPickerOpenedAt = 0;
  /** Timestamp of last edit-save / regenerate / branch pointer or submit. */
  let harborEditSaveAt = 0;
  /** Timestamp of last JetBrains pointerdown for agents-rail / branch-pill switch. */
  let harborAgentNavAt = 0;
  let models = DEFAULT_MODELS.slice();
  let selectedModelId = "";
  let menuOpen = false;
  let plusMenuOpen = false;
  let modeMenuOpen = false;
  let reasonMenuOpen = false;
  let agentMode = "agent";
  let selectedReasoningEffort = "medium";
  let modeEditIndex = null;
  let modeEditSource = "settings";
  let chatModes = [];
  let streamingEl = null;
  let streamingRenderScheduled = false;
  let composerDragDepth = 0;

  const MAX_PENDING_ATTACHMENTS = 8;
  const MAX_PENDING_SELECTIONS = 8;
  const MAX_PENDING_MENTIONS = 8;

  function buildSlashInitPrompt(args) {
    const target = String(args || "").trim();
    return target ? t("slashInitWithTarget", target) : t("slashInitDefault");
  }

  function buildSlashCompactPrompt(args) {
    const target = String(args || "").trim();
    return target ? t("slashCompactWithTarget", target) : t("slashCompactDefault");
  }

  function parseSlashCommand(raw) {
    const text = String(raw || "").trim();
    if (!text.startsWith("/")) {
      return null;
    }
    const match = text.match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
    if (!match) {
      return null;
    }
    const name = String(match[1] || "").toLowerCase();
    const args = String(match[2] || "").trim();
    switch (name) {
      case "agent":
        return { kind: "mode", mode: "agent", sendText: args };
      case "plan":
        return { kind: "mode", mode: "plan", sendText: args };
      case "ask":
        return { kind: "mode", mode: "ask", sendText: args };
      case "init":
        return {
          kind: "prompt",
          mode: "agent",
          sendText: buildSlashInitPrompt(args),
        };
      case "compact":
        return {
          kind: "prompt",
          mode: "ask",
          sendText: buildSlashCompactPrompt(args),
        };
      default:
        // User command from .harbor/commands/*.md — send as-is; the host
        // expands the template. Keep the current mode.
        if (
          Array.isArray(userSlashCommands) &&
          userSlashCommands.some((c) => c.name === name)
        ) {
          return { kind: "user", mode: "inherit", sendText: text };
        }
        return null;
    }
  }

  function getSlashCommands() {
    const builtins = [
      {
        id: "agent",
        label: "/agent",
        description:
          UI_LANG === "ru"
            ? "Переключить в режим Agent"
            : "Switch to Agent mode",
        kind: "mode",
      },
      {
        id: "plan",
        label: "/plan",
        description:
          UI_LANG === "ru"
            ? "Переключить в режим Plan"
            : "Switch to Plan mode",
        kind: "mode",
      },
      {
        id: "ask",
        label: "/ask",
        description:
          UI_LANG === "ru"
            ? "Переключить в режим Ask"
            : "Switch to Ask mode",
        kind: "mode",
      },
      {
        id: "init",
        label: "/init",
        description:
          UI_LANG === "ru"
            ? "Создать AGENTS.md — ориентир для агента"
            : "Create AGENTS.md agent orientation guide",
        kind: "prompt",
      },
      {
        id: "compact",
        label: "/compact",
        description:
          UI_LANG === "ru"
            ? "Сжать текущий контекст чата"
            : "Compact current chat context",
        kind: "prompt",
      },
    ];
    const users = (Array.isArray(userSlashCommands) ? userSlashCommands : [])
      .map((c) => ({
        id: String(c.name || "").toLowerCase(),
        label: `/${c.name}`,
        description: String(c.description || "").slice(0, 80),
        kind: "user",
      }));
    return [...builtins, ...users];
  }

  function attachmentPayload(att) {
    const row = {
      id: att.id,
      kind: att.kind,
      name: att.name,
      mime: att.mime,
      path: att.path,
      storageKey: att.storageKey,
      size: att.size,
    };
    // JCEF JSQuery truncates multi-MB JSON. Kotlin HarborAttachmentStore
    // already has picker/clipboard/drop bytes — omit huge payloads.
    // Small screenshots still fit JSQuery; include them so a cache miss
    // (paste decoded only in the webview) does not drop the image.
    const data = att.dataBase64;
    const MAX_JSQUERY_BASE64 = 400000;
    if (!harborHostAvailable()) {
      row.dataBase64 = data;
    } else if (
      typeof data === "string" &&
      data.length > 0 &&
      data.length <= MAX_JSQUERY_BASE64
    ) {
      row.dataBase64 = data;
    }
    return row;
  }

  function mergePendingAttachments(list) {
    if (!Array.isArray(list) || !list.length) {
      return;
    }
    for (const item of list) {
      if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      const id = item.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (pendingAttachments.some((a) => a.id === id)) {
        continue;
      }
      const kind = attachmentLooksLikeImage(item)
        ? "image"
        : item.kind || "file";
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
    showScreen("chat");
    renderAttachPreview();
    focusPrompt();
  }

  function removePendingAttachment(id) {
    pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
    renderAttachPreview();
  }

  function clearPendingAttachments() {
    pendingAttachments = [];
    renderAttachPreview();
  }

  function composerHasContent() {
    return Boolean(
      String(promptEl.value || "").trim() ||
        pendingAttachments.length ||
        pendingSelections.length ||
        pendingMentions.length
    );
  }

  function queueChipId() {
    return `q_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function getQueueForChat(chatId) {
    const id = String(chatId || "").trim();
    if (!id) {
      return [];
    }
    if (!messageQueues.has(id)) {
      messageQueues.set(id, []);
    }
    return messageQueues.get(id);
  }

  function getActiveQueue() {
    return getQueueForChat(activeChatId);
  }

  function clearMessageQueue(chatId) {
    const id = String(chatId || "").trim();
    if (!id) {
      return;
    }
    messageQueues.delete(id);
    if (id === activeChatId) {
      renderMessageQueue();
    }
  }

  function queuePreviewText(text) {
    const plain = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) {
      return UI_LANG === "ru" ? "(вложение)" : "(attachment)";
    }
    return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain;
  }

  function renderMessageQueue() {
    if (!messageQueueEl) {
      return;
    }
    const queue = getActiveQueue();
    if (!queue.length) {
      messageQueueEl.hidden = true;
      messageQueueEl.replaceChildren();
      return;
    }
    messageQueueEl.hidden = false;
    messageQueueEl.setAttribute("aria-label", t("queuePending"));
    messageQueueEl.replaceChildren();
    for (const item of queue) {
      const row = document.createElement("div");
      row.className = "message-queue-item";
      row.setAttribute("role", "listitem");
      row.dataset.queueId = item.id;
      row.title = t("queue");
      row.tabIndex = 0;

      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined message-queue-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "schedule";

      const textEl = document.createElement("span");
      textEl.className = "message-queue-text";
      textEl.textContent = queuePreviewText(item.text);

      row.appendChild(icon);
      row.appendChild(textEl);

      const attCount = Array.isArray(item.attachments)
        ? item.attachments.length
        : 0;
      if (attCount > 0) {
        const meta = document.createElement("span");
        meta.className = "message-queue-meta";
        meta.textContent = `×${attCount}`;
        row.appendChild(meta);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "message-queue-remove";
      removeBtn.title = t("queueRemove");
      removeBtn.setAttribute("aria-label", t("queueRemove"));
      removeBtn.dataset.queueId = item.id;
      const removeIcon = document.createElement("span");
      removeIcon.className = "material-symbols-outlined";
      removeIcon.setAttribute("aria-hidden", "true");
      removeIcon.textContent = "close";
      removeBtn.appendChild(removeIcon);
      row.appendChild(removeBtn);

      messageQueueEl.appendChild(row);
    }
  }

  function removeQueuedMessage(queueId) {
    const queue = getActiveQueue();
    const next = queue.filter((item) => item.id !== queueId);
    if (next.length === queue.length) {
      return;
    }
    if (activeChatId) {
      messageQueues.set(activeChatId, next);
    }
    renderMessageQueue();
  }

  function restoreQueuedMessage(queueId) {
    const queue = getActiveQueue();
    const index = queue.findIndex((item) => item.id === queueId);
    if (index < 0) {
      return;
    }
    const [item] = queue.splice(index, 1);
    if (activeChatId) {
      messageQueues.set(activeChatId, queue);
    }
    renderMessageQueue();
    promptEl.value = String(item.text || "");
    autoResizePrompt();
    persistDraftPrompt();
    clearPendingAttachments();
    clearPendingMentions();
    pullMentionsFromPrompt();
    if (Array.isArray(item.attachments) && item.attachments.length) {
      mergePendingAttachments(item.attachments);
    }
    if (item.mode) {
      setAgentMode(item.mode, { close: true, notify: false });
    }
    updateSendButton();
    focusPrompt();
  }

  function enqueueComposerMessage({
    text,
    attachments,
    mode,
    model,
    reasoningEffort,
  }) {
    if (!activeChatId) {
      return false;
    }
    const queue = getActiveQueue();
    if (queue.length >= MAX_MESSAGE_QUEUE) {
      showCopyToast(t("queueFull"));
      return false;
    }
    queue.push({
      id: queueChipId(),
      text,
      attachments: (attachments || []).map((att) => ({ ...att })),
      mode,
      model: model || getSelectedModel(),
      reasoningEffort: reasoningEffort || undefined,
    });
    messageQueues.set(activeChatId, queue);
    renderMessageQueue();
    return true;
  }

  function dispatchQueuedSend(item) {
    const text = String(item.text || "").trim();
    const attachments = Array.isArray(item.attachments)
      ? item.attachments.slice()
      : [];
    if (!text && !attachments.length) {
      return;
    }
    const modeForSend = normalizeAgentModeUi(item.mode || agentMode);
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingModeId = "";
    editingAttachments = [];
    stickToBottom = true;
    uiMessagesCache.push({
      role: "user",
      text,
      attachments,
      mode: modeForSend,
    });
    appendMessage("user", text, uiMessagesCache.length - 1, -1, attachments);
    setBusy(true);
    host.postMessage({
      type: "send",
      text,
      model: item.model || getSelectedModel(),
      agentMode: modeForSend,
      reasoningEffort: item.reasoningEffort || undefined,
      attachments: attachments.map(attachmentPayload),
    });
  }

  function tryDrainQueue() {
    if (busy || drainingQueue) {
      return;
    }
    const queue = getActiveQueue();
    if (!queue.length) {
      return;
    }
    drainingQueue = true;
    try {
      const item = queue.shift();
      if (activeChatId) {
        messageQueues.set(activeChatId, queue);
      }
      renderMessageQueue();
      if (item) {
        dispatchQueuedSend(item);
      }
    } finally {
      drainingQueue = false;
    }
  }

  function updateSendButton() {
    if (!sendBtn) {
      return;
    }
    sendBtn.classList.remove("is-stop", "is-queue");
    if (!busy) {
      sendBtn.dataset.mode = "send";
      sendBtn.title = t("send");
      sendBtn.setAttribute("aria-label", t("send"));
      return;
    }
    if (composerHasContent()) {
      sendBtn.dataset.mode = "queue";
      sendBtn.classList.add("is-queue");
      sendBtn.title = t("queue");
      sendBtn.setAttribute("aria-label", t("queue"));
      return;
    }
    sendBtn.dataset.mode = "stop";
    sendBtn.classList.add("is-stop");
    sendBtn.title = t("stop");
    sendBtn.setAttribute("aria-label", t("stop"));
  }

  function selectionChipId() {
    return `sel_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function formatSelectionLabel(sel) {
    const path = sel.path || "file";
    const start = Number(sel.startLine) || 0;
    const end = Number(sel.endLine) || start;
    if (!start) {
      return path;
    }
    return start === end ? `${path}:${start}` : `${path}:${start}–${end}`;
  }

  function selectionFileType(sel) {
    const path = String(sel.path || "");
    const fileName = path.split(/[\\/]/).pop() || "";
    const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
    const languageAliases = {
      typescript: "ts",
      typescriptreact: "tsx",
      javascript: "js",
      javascriptreact: "jsx",
      shellscript: "sh",
      plaintext: "txt",
      markdown: "md",
      python: "py",
      rust: "rs",
      csharp: "cs",
    };
    const language = String(sel.language || "").toLowerCase();
    const extension =
      (match && match[1]) || languageAliases[language] || language || "code";
    const normalized = extension.replace(/[^a-z0-9]/g, "").slice(0, 8) || "code";
    const labels = {
      javascript: "JS",
      javascriptreact: "JSX",
      typescript: "TS",
      typescriptreact: "TSX",
      markdown: "MD",
      plaintext: "TXT",
      shellscript: "SH",
      yaml: "YML",
    };
    return {
      className: normalized,
      label: (labels[normalized] || normalized).slice(0, 4).toUpperCase(),
    };
  }

  function selectionToFence(sel) {
    const start = Number(sel.startLine) || 1;
    const end = Number(sel.endLine) || start;
    const path = sel.path || "file";
    const body = String(sel.text || "").replace(/\n$/, "");
    return `\`\`\`${start}:${end}:${path}\n${body}\n\`\`\``;
  }

  function mentionChipId() {
    return `mn_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function addPendingMention(pathRaw) {
    const parsed = parseMentionTarget(String(pathRaw || "").replace(/^@+/, ""));
    const path = String(parsed.path || "").trim();
    if (!path) {
      return false;
    }
    const startLine = Number(parsed.startLine) || 0;
    const endLine = Number(parsed.endLine) || startLine;
    const dup = pendingMentions.find(
      (m) =>
        m.path === path && m.startLine === startLine && m.endLine === endLine
    );
    if (dup) {
      return false;
    }
    if (pendingMentions.length >= MAX_PENDING_MENTIONS) {
      showCopyToast(t("tooManySelections"));
      return false;
    }
    pendingMentions.push({
      id: mentionChipId(),
      path,
      startLine,
      endLine,
    });
    renderAttachPreview();
    updateSendButton();
    return true;
  }

  function removePendingMention(id) {
    pendingMentions = pendingMentions.filter((m) => m.id !== id);
    renderAttachPreview();
    updateSendButton();
  }

  function clearPendingMentions() {
    pendingMentions = [];
    renderAttachPreview();
  }

  function mentionToken(meta) {
    const suffix =
      meta.startLine > 0
        ? meta.startLine === meta.endLine
          ? `:${meta.startLine}`
          : `:${meta.startLine}-${meta.endLine}`
        : "";
    return `@${meta.path}${suffix}`;
  }

  function buildMessageWithMentions(userText) {
    const chips = pendingMentions.map(mentionToken);
    const text = String(userText || "").trim();
    if (!chips.length) {
      return text;
    }
    if (!text) {
      return chips.join(" ");
    }
    return `${chips.join(" ")} ${text}`;
  }

  function renderComposerMentionChip(meta) {
    const path = String(meta.path || "file");
    const fileType = selectionFileType({ path });
    const name = pathBasename(path);
    const line =
      meta.startLine > 0
        ? meta.startLine === meta.endLine
          ? `· ${meta.startLine}`
          : `· ${meta.startLine}–${meta.endLine}`
        : "";
    const remove =
      `<button type="button" class="attach-chip-remove mention-chip-remove" data-id="${escapeHtml(
        meta.id
      )}" title="${t("remove")}" aria-label="${t("remove")}">` +
      `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
      `</button>`;
    return (
      `<div class="msg-file-chip composer-mention-chip" data-id="${escapeHtml(
        meta.id
      )}" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">` +
      `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(
        fileType.label
      )}</span>` +
      `<span class="msg-file-chip-name">${escapeHtml(name)}</span>` +
      (line ? `<span class="msg-file-chip-line">${escapeHtml(line)}</span>` : "") +
      remove +
      `</div>`
    );
  }

  function tryCommitComposerMention(textarea) {
    if (textarea !== promptEl) {
      return false;
    }
    const mention = findMentionAtCursor(textarea);
    if (!mention || !mention.query) {
      return false;
    }
    const parsed = parseMentionTarget(mention.query);
    if (!isFilePath(parsed.path)) {
      return false;
    }
    if (!addPendingMention(mention.query)) {
      return false;
    }
    const value = textarea.value;
    const next = value.slice(0, mention.start) + value.slice(mention.end);
    textarea.value = next;
    textarea.setSelectionRange(mention.start, mention.start);
    autoResizePrompt();
    persistDraftPrompt();
    closeMentionMenu();
    return true;
  }

  function pullMentionsFromPrompt() {
    if (!(promptEl instanceof HTMLTextAreaElement)) {
      return;
    }
    const re = /@([^\s@]+)/g;
    let value = promptEl.value || "";
    const hits = [];
    let match;
    while ((match = re.exec(value))) {
      const path = match[1];
      if (path.includes("://") || path.includes(":")) {
        continue;
      }
      if (!isFilePath(path) && !path.includes("/")) {
        continue;
      }
      hits.push({
        start: match.index,
        end: match.index + match[0].length,
        path,
      });
    }
    if (!hits.length) {
      return;
    }
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const hit = hits[i];
      if (!addPendingMention(hit.path)) {
        continue;
      }
      value = `${value.slice(0, hit.start)}${value.slice(hit.end)}`;
    }
    promptEl.value = value.replace(/[ \t]{2,}/g, " ").replace(/^ +| +$/gm, "");
    autoResizePrompt();
    persistDraftPrompt();
  }

  function addPendingSelection(sel) {
    if (!sel || !String(sel.text || "").trim()) {
      return;
    }
    if (pendingSelections.length >= MAX_PENDING_SELECTIONS) {
      showCopyToast(t("tooManySelections"));
      return;
    }
    const path = String(sel.path || "").trim() || "file";
    const startLine = Number(sel.startLine) || 1;
    const endLine = Number(sel.endLine) || startLine;
    const text = String(sel.text || "").replace(/\n$/, "");
    const dup = pendingSelections.find(
      (s) =>
        s.path === path &&
        s.startLine === startLine &&
        s.endLine === endLine &&
        s.text === text
    );
    if (dup) {
      showScreen("chat");
      focusPrompt();
      return;
    }
    pendingSelections.push({
      id: selectionChipId(),
      path,
      startLine,
      endLine,
      text,
      language: sel.language || "",
    });
    renderSelectionPreview();
    showScreen("chat");
    focusPrompt();
  }

  function removePendingSelection(id) {
    pendingSelections = pendingSelections.filter((s) => s.id !== id);
    renderSelectionPreview();
  }

  function clearPendingSelections() {
    pendingSelections = [];
    renderSelectionPreview();
  }

  function renderSelectionPreview() {
    if (!selectionPreviewEl) {
      return;
    }
    if (!pendingSelections.length) {
      selectionPreviewEl.hidden = true;
      selectionPreviewEl.innerHTML = "";
      updateSendButton();
      forceHarborUiRepaint();
      return;
    }
    selectionPreviewEl.hidden = false;
    selectionPreviewEl.innerHTML = pendingSelections
      .map((sel) => {
        const label = escapeHtml(formatSelectionLabel(sel));
        const fileType = selectionFileType(sel);
        const lines =
          sel.startLine === sel.endLine
            ? `line ${sel.startLine}`
            : `lines ${sel.startLine}–${sel.endLine}`;
        return (
          `<div class="selection-chip" data-id="${escapeHtml(sel.id)}" title="${label}">` +
          `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(fileType.label)}</span>` +
          `<span class="selection-chip-body">` +
          `<span class="selection-chip-path">${escapeHtml(sel.path || "file")}</span>` +
          `<span class="selection-chip-lines">${escapeHtml(lines)}</span>` +
          `</span>` +
          `<button type="button" class="selection-chip-remove" data-id="${escapeHtml(
            sel.id
          )}" title="${t("remove")}" aria-label="${t("remove")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
          `</button></div>`
        );
      })
      .join("");
    updateSendButton();
    forceHarborUiRepaint();
    setTimeout(forceHarborUiRepaint, 32);
    setTimeout(forceHarborUiRepaint, 120);
  }

  function buildMessageWithSelections(userText) {
    const fences = pendingSelections.map(selectionToFence);
    const text = String(userText || "").trim();
    if (!fences.length) {
      return text;
    }
    if (!text) {
      return fences.join("\n\n");
    }
    return `${fences.join("\n\n")}\n\n${text}`;
  }

  function harborHostAvailable() {
    return Boolean(
      typeof globalThis !== "undefined" && globalThis.__harborHost
    );
  }

  /** JetBrains: hide VS Code–only settings (Tab autocomplete). */
  function applyJetBrainsSettingsVisibility() {
    if (!harborHostAvailable()) {
      return;
    }
    document.documentElement.setAttribute("data-harbor-host", "jetbrains");
    const tabBlock = document.getElementById("settingsTabAutocompleteBlock");
    if (tabBlock) {
      tabBlock.hidden = true;
    }
  }

  applyJetBrainsSettingsVisibility();

  /**
   * JCEF OSR: CSS cursor is applied by the Kotlin host; HTML title tooltips are
   * drawn in-page (native title never shows in OSR).
   */
  function installJetBrainsChromeUx() {
    if (!harborHostAvailable()) {
      return;
    }
    let lastCursor = "";
    let tipTimer = 0;
    let tipEl = document.getElementById("harborJcefTip");
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.id = "harborJcefTip";
      tipEl.setAttribute("role", "tooltip");
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }

    function resolveCursor(el) {
      let node = el;
      while (node && node.nodeType === 1) {
        const value = window.getComputedStyle(node).cursor;
        if (value && value !== "auto") {
          return value;
        }
        node = node.parentElement;
      }
      return "default";
    }

    function resolveTitle(el) {
      const titled = el && el.closest ? el.closest("[title]") : null;
      if (!titled) {
        return "";
      }
      return String(titled.getAttribute("title") || "").trim();
    }

    function hideTip() {
      if (tipTimer) {
        clearTimeout(tipTimer);
        tipTimer = 0;
      }
      tipEl.hidden = true;
      tipEl.textContent = "";
    }

    function placeTip(x, y) {
      const pad = 12;
      const rect = tipEl.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      let left = x + pad;
      let top = y + 18;
      if (left + rect.width > vw - 4) {
        left = Math.max(4, x - rect.width - pad);
      }
      if (top + rect.height > vh - 4) {
        top = Math.max(4, y - rect.height - 8);
      }
      tipEl.style.left = `${Math.round(left)}px`;
      tipEl.style.top = `${Math.round(top)}px`;
    }

    function showTip(text, x, y) {
      if (!text) {
        hideTip();
        return;
      }
      if (tipTimer) {
        clearTimeout(tipTimer);
      }
      tipTimer = window.setTimeout(() => {
        tipTimer = 0;
        tipEl.textContent = text;
        tipEl.hidden = false;
        placeTip(x, y);
        // Reposition after layout with real size.
        requestAnimationFrame(() => placeTip(x, y));
      }, 450);
    }

    function publishCursor(cursor) {
      if (cursor === lastCursor) {
        return;
      }
      lastCursor = cursor;
      try {
        host.postMessage({ type: "jcefChrome", cursor });
      } catch {
        /* ignore */
      }
    }

    let raf = 0;
    let pending = null;
    function onPointer(event) {
      const el =
        event.target && event.target.nodeType === 1
          ? event.target
          : document.elementFromPoint(event.clientX, event.clientY);
      if (!el) {
        return;
      }
      const cursor = resolveCursor(el);
      const title = resolveTitle(el);
      const x = event.clientX;
      const y = event.clientY;
      pending = { cursor, title, x, y };
      if (raf) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = pending;
        pending = null;
        if (!next) {
          return;
        }
        publishCursor(next.cursor);
        if (next.title) {
          if (tipEl.hidden || tipEl.textContent !== next.title) {
            showTip(next.title, next.x, next.y);
          } else {
            placeTip(next.x, next.y);
          }
        } else {
          hideTip();
        }
      });
    }

    document.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerdown", hideTip, { passive: true });
    document.addEventListener(
      "pointerleave",
      () => {
        hideTip();
        publishCursor("default");
      },
      { passive: true }
    );
  }

  installJetBrainsChromeUx();

  /** JCEF OSR often skips paints after DOM updates until a click — nudge it. */
  function forceHarborUiRepaint() {
    if (!harborHostAvailable()) {
      return;
    }
    const root = document.documentElement;
    root.classList.add("harbor-force-paint");
    void (attachPreviewEl && attachPreviewEl.offsetHeight);
    void (selectionPreviewEl && selectionPreviewEl.offsetHeight);
    void root.offsetHeight;
    requestAnimationFrame(() => {
      root.classList.remove("harbor-force-paint");
      void document.body.offsetHeight;
      try {
        host.postMessage({ type: "uiRepaint" });
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Settings <select> → composer mode-picker chrome (trigger + in-page listbox).
   * Native select stays in the DOM (hidden) so existing value/change wiring works.
   * JetBrains OSR: pick on pointerdown — click is often never synthesized.
   */
  function installHarborSelectPolyfill() {
    let activePicker = null;
    let nativeMenuEl = null;
    let nativeSelect = null;
    let pointerHandled = false;
    let suppressDismiss = false;
    const pickerMenus = new WeakMap();

    function armDismissGuard() {
      suppressDismiss = true;
      const clear = () => {
        suppressDismiss = false;
        document.removeEventListener("pointerup", clear, true);
        document.removeEventListener("mouseup", clear, true);
      };
      document.addEventListener("pointerup", clear, true);
      document.addEventListener("mouseup", clear, true);
      setTimeout(clear, 400);
    }

    function demoteFieldLabel(select) {
      const field = select.closest("label.settings-field");
      if (!field || field.tagName !== "LABEL") {
        return;
      }
      const div = document.createElement("div");
      div.className = field.className;
      Array.from(field.attributes).forEach((attr) => {
        if (attr.name === "class" || attr.name === "for") {
          return;
        }
        div.setAttribute(attr.name, attr.value);
      });
      while (field.firstChild) {
        div.appendChild(field.firstChild);
      }
      field.replaceWith(div);
    }
    const valueDesc = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    );
    const indexDesc = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "selectedIndex"
    );

    function selectedOptionLabel(select) {
      const opt =
        (select && select.options && select.options[select.selectedIndex]) ||
        null;
      if (!opt) {
        return "";
      }
      return String(opt.label || opt.textContent || opt.value || "").trim();
    }

    function syncPicker(select) {
      const picker = select && select.closest(".settings-select-picker");
      if (!picker) {
        return;
      }
      const trigger = picker.querySelector(".model-trigger");
      const label = picker.querySelector(".model-label");
      if (label) {
        label.textContent = selectedOptionLabel(select) || "\u00a0";
      }
      if (trigger) {
        trigger.disabled = Boolean(select.disabled);
        trigger.title = selectedOptionLabel(select);
      }
      if (select.disabled && picker.classList.contains("is-open")) {
        closePicker(picker);
      }
    }

    function patchSelectAccessors(select) {
      if (!valueDesc || !valueDesc.get || !valueDesc.set) {
        return;
      }
      Object.defineProperty(select, "value", {
        configurable: true,
        enumerable: true,
        get() {
          return valueDesc.get.call(this);
        },
        set(next) {
          valueDesc.set.call(this, next);
          syncPicker(this);
        },
      });
      if (indexDesc && indexDesc.get && indexDesc.set) {
        Object.defineProperty(select, "selectedIndex", {
          configurable: true,
          enumerable: true,
          get() {
            return indexDesc.get.call(this);
          },
          set(next) {
            indexDesc.set.call(this, next);
            syncPicker(this);
          },
        });
      }
    }

    function applySelectValue(select, value) {
      if (!select) {
        return;
      }
      const previous = select.value;
      const wanted = value == null ? "" : String(value);
      select.value = wanted;
      if (select.value !== previous || wanted !== previous) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    function menuForPicker(picker) {
      if (!picker) {
        return null;
      }
      return (
        pickerMenus.get(picker) ||
        picker.querySelector(".settings-select-menu")
      );
    }

    function closePicker(picker) {
      if (!picker) {
        return;
      }
      const trigger = picker.querySelector(".model-trigger");
      const menu = menuForPicker(picker);
      picker.classList.remove("is-open");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
      if (menu) {
        menu.hidden = true;
        if (typeof resetModelMenuPlacement === "function") {
          resetModelMenuPlacement(picker, menu);
        }
      }
      if (activePicker === picker) {
        activePicker = null;
      }
    }

    function closeActivePicker() {
      if (activePicker) {
        closePicker(activePicker);
      }
      closeNativeHarborSelectMenu();
    }

    function fillPickerMenu(select, menu) {
      menu.innerHTML = "";
      const options = Array.from(select.options || []);
      for (const opt of options) {
        if (opt.hidden || (opt.disabled && opt.hidden)) {
          continue;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        const isActive = opt.selected || opt.value === select.value;
        btn.className = "model-option" + (isActive ? " is-active" : "");
        btn.setAttribute("role", "option");
        btn.setAttribute("data-harbor-value", opt.value);
        btn.dataset.value = opt.value;
        if (opt.disabled) {
          btn.disabled = true;
        }
        if (isActive) {
          btn.setAttribute("aria-selected", "true");
        }
        const label = document.createElement("span");
        label.className = "model-option-label";
        label.textContent = opt.label || opt.textContent || opt.value || "";
        btn.appendChild(label);
        if (isActive) {
          const check = document.createElement("span");
          check.className = "model-check";
          check.innerHTML = CHECK_ICON;
          btn.appendChild(check);
        }
        menu.appendChild(btn);
      }
    }

    function placeSettingsMenu(picker, menu, trigger) {
      if (typeof placeModelMenu !== "function" || !picker || !menu || !trigger) {
        return;
      }
      placeModelMenu(picker, menu, document.documentElement);
    }

    function openPicker(picker) {
      const select = picker.querySelector("select");
      const trigger = picker.querySelector(".model-trigger");
      const menu = menuForPicker(picker);
      if (!select || !trigger || !menu || select.disabled) {
        return;
      }
      if (activePicker && activePicker !== picker) {
        closePicker(activePicker);
      }
      fillPickerMenu(select, menu);
      picker.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      activePicker = picker;
      armDismissGuard();
      placeSettingsMenu(picker, menu, trigger);
      forceHarborUiRepaint();
    }

    function togglePicker(picker) {
      if (!picker) {
        return;
      }
      if (picker.classList.contains("is-open")) {
        closePicker(picker);
      } else {
        openPicker(picker);
      }
    }

    function wrapSelect(select) {
      if (!select || select.closest(".settings-select-picker")) {
        return;
      }
      demoteFieldLabel(select);
      const picker = document.createElement("div");
      picker.className = "model-picker settings-select-picker";
      picker.dataset.selectId = select.id || `select-${Math.random().toString(36).slice(2, 9)}`;

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "model-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const field = select.closest(".settings-field");
      const fieldLabel = field && field.querySelector(".settings-label");
      if (fieldLabel && fieldLabel.textContent) {
        trigger.setAttribute("aria-label", fieldLabel.textContent.trim());
      }

      const label = document.createElement("span");
      label.className = "model-label";

      const chevron = document.createElement("span");
      chevron.className = "material-symbols-outlined model-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "expand_more";

      trigger.appendChild(label);
      trigger.appendChild(chevron);

      const menu = document.createElement("div");
      menu.className = "model-menu settings-select-menu";
      menu.setAttribute("role", "listbox");
      menu.dataset.selectId = picker.dataset.selectId;
      menu.hidden = true;

      select.classList.add("settings-select-native");
      select.setAttribute("tabindex", "-1");
      select.setAttribute("aria-hidden", "true");

      const parent = select.parentNode;
      parent.insertBefore(picker, select);
      picker.appendChild(trigger);
      picker.appendChild(select);
      picker.appendChild(menu);
      pickerMenus.set(picker, menu);

      patchSelectAccessors(select);
      syncPicker(select);

      const observer = new MutationObserver(() => {
        syncPicker(select);
        if (picker.classList.contains("is-open")) {
          const liveMenu = menuForPicker(picker);
          if (liveMenu) {
            fillPickerMenu(select, liveMenu);
            placeSettingsMenu(picker, liveMenu, trigger);
          }
        }
      });
      observer.observe(select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "hidden"],
        characterData: true,
      });
      select.addEventListener("change", () => syncPicker(select));

      let triggerPointerHandled = false;
      trigger.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        triggerPointerHandled = true;
        event.preventDefault();
        event.stopPropagation();
        togglePicker(picker);
        setTimeout(() => {
          triggerPointerHandled = false;
        }, 0);
      });
      trigger.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (triggerPointerHandled || event.button !== 0) {
          return;
        }
        togglePicker(picker);
      });
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      trigger.addEventListener("keydown", (event) => {
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowDown"
        ) {
          event.preventDefault();
          openPicker(picker);
        } else if (event.key === "Escape" && picker.classList.contains("is-open")) {
          event.preventDefault();
          closePicker(picker);
        }
      });

      const onMenuOption = (event) => {
        const option = event.target && event.target.closest
          ? event.target.closest(".model-option")
          : null;
        if (!option || !menu.contains(option) || option.disabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const value =
          option.getAttribute("data-harbor-value") != null
            ? option.getAttribute("data-harbor-value")
            : option.dataset.value !== undefined
              ? option.dataset.value
              : "";
        applySelectValue(select, value);
        closePicker(picker);
        forceHarborUiRepaint();
      };
      menu.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        onMenuOption(event);
      });
      menu.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      menu.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    document.querySelectorAll("select.settings-input").forEach(wrapSelect);

    function closeNativeHarborSelectMenu() {
      if (nativeMenuEl) {
        nativeMenuEl.remove();
        nativeMenuEl = null;
      }
      if (nativeSelect) {
        nativeSelect.classList.remove("harbor-select-open");
      }
      nativeSelect = null;
    }

    function openNativeHarborSelectMenu(select) {
      closeNativeHarborSelectMenu();
      if (!select || select.disabled) {
        return;
      }
      nativeSelect = select;
      select.classList.add("harbor-select-open");
      nativeMenuEl = document.createElement("div");
      nativeMenuEl.className = "harbor-select-menu";
      nativeMenuEl.setAttribute("role", "listbox");
      const options = Array.from(select.options || []);
      for (const opt of options) {
        if (opt.disabled && opt.hidden) {
          continue;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "harbor-select-option";
        btn.setAttribute("role", "option");
        btn.setAttribute("data-harbor-value", opt.value);
        btn.dataset.value = opt.value;
        if (opt.selected || opt.value === select.value) {
          btn.classList.add("is-selected");
          btn.setAttribute("aria-selected", "true");
        }
        btn.textContent = opt.label || opt.textContent || opt.value || "";
        nativeMenuEl.appendChild(btn);
      }
      document.body.appendChild(nativeMenuEl);
      const rect = select.getBoundingClientRect();
      const maxH = Math.min(280, Math.max(120, window.innerHeight - 24));
      nativeMenuEl.style.maxHeight = `${maxH}px`;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
      const width = Math.max(rect.width, 180);
      nativeMenuEl.style.minWidth = `${Math.min(width, window.innerWidth - 16)}px`;
      nativeMenuEl.style.left = `${Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8)
      )}px`;
      if (openUp) {
        nativeMenuEl.classList.add("opens-up");
        nativeMenuEl.style.bottom = `${Math.max(
          8,
          window.innerHeight - rect.top + 4
        )}px`;
        nativeMenuEl.style.top = "auto";
      } else {
        nativeMenuEl.style.top = `${Math.min(
          rect.bottom + 4,
          window.innerHeight - 40
        )}px`;
        nativeMenuEl.style.bottom = "auto";
      }
      forceHarborUiRepaint();
    }

    const onPointer = (event) => {
      const target = event.target;
      if (!target || !target.closest) {
        return;
      }

      const pickerOption = target.closest(
        ".settings-select-menu .model-option"
      );
      if (pickerOption) {
        return;
      }
      if (target.closest(".settings-select-menu")) {
        event.stopPropagation();
        return;
      }
      if (target.closest(".settings-select-picker .model-trigger")) {
        return;
      }
      if (target.closest(".settings-field > .settings-label")) {
        return;
      }

      const nativeOption = target.closest(".harbor-select-option");
      if (nativeOption && nativeMenuEl && nativeMenuEl.contains(nativeOption)) {
        event.preventDefault();
        event.stopPropagation();
        const select = nativeSelect;
        const value =
          nativeOption.getAttribute("data-harbor-value") != null
            ? nativeOption.getAttribute("data-harbor-value")
            : nativeOption.dataset.value !== undefined
              ? nativeOption.dataset.value
              : "";
        applySelectValue(select, value);
        closeNativeHarborSelectMenu();
        forceHarborUiRepaint();
        return;
      }

      if (nativeMenuEl && nativeMenuEl.contains(target)) {
        event.stopPropagation();
        return;
      }

      const pathSelect = target.closest("select");
      if (
        pathSelect &&
        harborHostAvailable() &&
        !pathSelect.closest(".settings-select-picker")
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (nativeSelect === pathSelect && nativeMenuEl) {
          closeNativeHarborSelectMenu();
        } else {
          closeActivePicker();
          openNativeHarborSelectMenu(pathSelect);
        }
        return;
      }

      if (
        !suppressDismiss &&
        activePicker &&
        !target.closest(".settings-select-picker")
      ) {
        closePicker(activePicker);
      }
      if (nativeMenuEl) {
        closeNativeHarborSelectMenu();
      }
    };

    document.addEventListener(
      "pointerdown",
      (event) => {
        pointerHandled = true;
        onPointer(event);
        setTimeout(() => {
          pointerHandled = false;
        }, 0);
      },
      true
    );
    document.addEventListener(
      "mousedown",
      (event) => {
        if (pointerHandled) {
          return;
        }
        onPointer(event);
      },
      true
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          closeActivePicker();
          return;
        }
        const el = document.activeElement;
        if (
          harborHostAvailable() &&
          el &&
          el.tagName === "SELECT" &&
          !el.closest(".settings-select-picker") &&
          (event.key === "Enter" ||
            event.key === " " ||
            event.key === "ArrowDown")
        ) {
          event.preventDefault();
          openNativeHarborSelectMenu(el);
        }
      },
      true
    );
    window.addEventListener("resize", closeActivePicker);
    document.addEventListener(
      "scroll",
      (event) => {
        if (suppressDismiss || (!activePicker && !nativeMenuEl)) {
          return;
        }
        const scrolled = event.target;
        if (nativeMenuEl && (scrolled === nativeMenuEl || nativeMenuEl.contains(scrolled))) {
          return;
        }
        if (activePicker) {
          const menu = menuForPicker(activePicker);
          if (menu && (scrolled === menu || menu.contains(scrolled))) {
            return;
          }
        }
        closeActivePicker();
      },
      true
    );
  }

  installHarborSelectPolyfill();

  /**
   * OSR often drops the synthesized `click` after pointerup on icon/primary
   * controls (edit-resend, send, regenerate). Retry via el.click() if needed.
   * Mode/model edit pickers and edit-save open/act on pointerdown — click is
   * unreliable in OSR and a delayed synthetic click would toggle/double-fire.
   */
  function installHarborClickPolyfill() {
    if (!harborHostAvailable()) {
      return;
    }
    const SELECTOR =
      "#sendBtn, .msg-edit-save, .msg-regenerate, .msg-copy, .msg-branch, .msg-edit-mode-trigger, .msg-edit-model-trigger, .msg-edit-plus-btn, .msg-edit-reason-trigger, .composer-plan-build";
    const POINTER_ACTION_SELECTOR =
      ".msg-edit-mode-trigger, .msg-edit-model-trigger, .msg-edit-plus-btn, .msg-edit-reason-trigger, .msg-edit-save, .msg-regenerate, .msg-copy, .msg-branch, .composer-plan-build, #sendBtn";
    let downEl = null;
    let clickSeen = false;

    function runPointerAction(el) {
      if (!el || el.disabled) {
        return false;
      }
      if (el.classList.contains("msg-edit-mode-trigger")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditModeMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-model-trigger")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditModelMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-plus-btn")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditPlusMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-reason-trigger")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditReasonMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-save")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditSaveAt = Date.now();
        submitEditedUserMessage();
        return true;
      }
      if (el.classList.contains("msg-copy")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        copyAssistantFromButton(el);
        return true;
      }
      if (el.classList.contains("msg-regenerate")) {
        if (!messagesEl || !messagesEl.contains(el) || !canRegenerate) {
          return false;
        }
        harborEditSaveAt = Date.now();
        pinChatToBottom();
        setBusy(true);
        host.postMessage({
          type: "regenerate",
          agentMode,
          reasoningEffort: selectedReasoningEffort || undefined,
        });
        return true;
      }
      if (el.classList.contains("msg-branch")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        const index = Number(el.dataset.index);
        if (!Number.isInteger(index) || index < 0) {
          return false;
        }
        harborEditSaveAt = Date.now();
        host.postMessage({ type: "branchFromMessage", messageIndex: index });
        return true;
      }
      if (el.classList.contains("composer-plan-build") || el.id === "sendBtn") {
        // Do NOT set harborEditSaveAt here — activateSendButton() sets it
        // internally. Setting it before el.click() causes the < 450 ms guard
        // inside activateSendButton to bail immediately, making Send inert
        // on JetBrains (OSR pointerdown → polyfill → el.click → guard fires).
        try {
          el.click();
        } catch {
          /* ignore */
        }
        return true;
      }
      return false;
    }

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) {
          return;
        }
        const actionEl =
          event.target && event.target.closest
            ? event.target.closest(POINTER_ACTION_SELECTOR)
            : null;
        if (actionEl && runPointerAction(actionEl)) {
          event.preventDefault();
          event.stopPropagation();
          downEl = null;
          clickSeen = true;
          forceHarborUiRepaint();
          setTimeout(forceHarborUiRepaint, 32);
          setTimeout(forceHarborUiRepaint, 120);
          return;
        }
        const el =
          event.target && event.target.closest
            ? event.target.closest(SELECTOR)
            : null;
        downEl = el && !el.disabled ? el : null;
        clickSeen = false;
      },
      true
    );

    document.addEventListener(
      "click",
      () => {
        if (downEl) {
          clickSeen = true;
        }
      },
      true
    );

    document.addEventListener(
      "pointerup",
      (event) => {
        if (event.button !== 0 || !downEl) {
          downEl = null;
          return;
        }
        const start = downEl;
        downEl = null;
        const el =
          event.target && event.target.closest
            ? event.target.closest(SELECTOR)
            : null;
        if (!el || (el !== start && !start.contains(el) && !el.contains(start))) {
          return;
        }
        if (el.matches(POINTER_ACTION_SELECTOR)) {
          return;
        }
        window.setTimeout(() => {
          if (clickSeen) {
            return;
          }
          try {
            el.click();
          } catch {
            /* ignore */
          }
          forceHarborUiRepaint();
        }, 40);
      },
      true
    );
  }

  installHarborClickPolyfill();

  function attachmentLooksLikeImage(att) {
    const mime = String(att?.mime || "").toLowerCase();
    if (mime.startsWith("image/") && mime !== "image/svg+xml") {
      return true;
    }
    if (att?.kind === "image") {
      return true;
    }
    return /\.(png|jpe?g|gif|webp|bmp)$/i.test(
      String(att?.name || att?.path || "")
    );
  }

  function attachmentPreviewSrc(att) {
    if (att?.previewDataUrl) {
      return String(att.previewDataUrl);
    }
    if (att?.dataBase64) {
      return `data:${att.mime || "image/png"};base64,${att.dataBase64}`;
    }
    return "";
  }

  function renderFileTypeChip(att, extraClass, extraHtml) {
    const full = String(att.path || att.name || "file");
    const label = displayAttachmentName(att);
    const fileType = selectionFileType({ path: full });
    return (
      `<div class="msg-file-chip ${extraClass || ""}" data-id="${escapeHtml(
        att.id || ""
      )}" title="${escapeHtml(full)}">` +
      `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(
        fileType.label
      )}</span>` +
      `<span class="msg-file-chip-name">${escapeHtml(label)}</span>` +
      (extraHtml || "") +
      `</div>`
    );
  }

  function renderAttachPreview() {
    if (!attachPreviewEl) {
      return;
    }
    const mentionHtml = pendingMentions.map(renderComposerMentionChip).join("");
    if (!pendingAttachments.length && !mentionHtml) {
      attachPreviewEl.hidden = true;
      attachPreviewEl.innerHTML = "";
      updateSendButton();
      forceHarborUiRepaint();
      return;
    }
    attachPreviewEl.hidden = false;
    attachPreviewEl.innerHTML =
      mentionHtml +
      pendingAttachments
        .map((att) => {
        const full = String(att.path || att.name || "file");
        const title = escapeHtml(full);
        const src = attachmentPreviewSrc(att);
        const remove =
          `<button type="button" class="attach-chip-remove" data-id="${escapeHtml(
            att.id
          )}" title="${t("remove")}" aria-label="${t("remove")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
          `</button>`;
        if (attachmentLooksLikeImage(att) && src) {
          return (
            `<div class="attach-chip attach-chip-image" data-id="${escapeHtml(att.id)}" title="${title}">` +
            `<img class="attach-thumb" src="${src}" alt="" decoding="sync" />` +
            `<span class="msg-attach-image-badge" aria-hidden="true">` +
            `<span class="material-symbols-outlined">image</span>` +
            `</span>` +
            remove +
            `</div>`
          );
        }
        return renderFileTypeChip(att, "attach-chip", remove);
        })
        .join("");
    attachPreviewEl.querySelectorAll("img.attach-thumb").forEach((img) => {
      if (img.complete) {
        return;
      }
      img.addEventListener(
        "load",
        () => {
          forceHarborUiRepaint();
        },
        { once: true }
      );
    });
    updateSendButton();
    forceHarborUiRepaint();
    setTimeout(forceHarborUiRepaint, 32);
    setTimeout(forceHarborUiRepaint, 120);
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

  function closeSlashMenu() {
    slashOpen = false;
    slashItems = [];
    slashActiveIndex = 0;
    slashQuery = "";
    slashStart = -1;
    if (!mentionOpen && mentionMenuEl) {
      mentionMenuEl.hidden = true;
      mentionMenuEl.innerHTML = "";
    }
  }

  function renderSlashMenu() {
    if (!mentionMenuEl) {
      return;
    }
    if (!slashOpen) {
      if (!mentionOpen) {
        mentionMenuEl.hidden = true;
        mentionMenuEl.innerHTML = "";
      }
      return;
    }
    if (!slashItems.length) {
      mentionMenuEl.hidden = false;
      mentionMenuEl.innerHTML =
        `<div class="mention-empty">${
          UI_LANG === "ru" ? "Нет команд" : "No commands"
        }</div>`;
      return;
    }
    mentionMenuEl.hidden = false;
    mentionMenuEl.innerHTML = slashItems
      .map((item, index) => {
        const active = index === slashActiveIndex ? " is-active" : "";
        return (
          `<button type="button" class="mention-option${active}" role="option" data-slash-index="${index}" data-command="${escapeHtml(
            item.id
          )}" aria-selected="${index === slashActiveIndex ? "true" : "false"}">` +
          `<span class="mention-option-text">` +
          `<span class="mention-option-name">${escapeHtml(item.label)}</span>` +
          `<span class="mention-option-path">${escapeHtml(
            item.description || ""
          )}</span>` +
          `</span></button>`
        );
      })
      .join("");
    const activeEl = mentionMenuEl.querySelector(".mention-option.is-active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
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
        `<div class="mention-empty">No files</div>`;
      return;
    }
    mentionMenuEl.hidden = false;
    mentionMenuEl.innerHTML = mentionItems
      .map((item, index) => {
        const active = index === mentionActiveIndex ? " is-active" : "";
        if (item.special) {
          const hint = escapeHtml(item.hint || "");
          return (
            `<button type="button" class="mention-option${active}" role="option" data-index="${index}" data-special="${escapeHtml(item.special)}" aria-selected="${
              index === mentionActiveIndex ? "true" : "false"
            }">` +
            `<span class="material-symbols-outlined mention-option-icon" aria-hidden="true">${item.icon || "draft"}</span>` +
            `<span class="mention-option-text">` +
            `<span class="mention-option-name">${escapeHtml(item.name)}</span>` +
            `<span class="mention-option-path">${hint}</span>` +
            `</span></button>`
          );
        }
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
    const query = match[2] || "";
    // Не рассматриваем @https://... / @...:... как упоминание файла.
    // Иначе появляется mention-панель с файлами (searchFiles по "https://...").
    if (query.includes("://") || query.includes(":")) {
      return null;
    }
    const atIndex = before.length - match[2].length - 1;
    return {
      start: atIndex,
      query,
      end: cursor,
    };
  }

  function findSlashAtCursor(textarea) {
    if (textarea !== promptEl) {
      return null;
    }
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/^\s*\/([^\s]*)$/);
    if (!match) {
      return null;
    }
    const query = match[1] || "";
    const slashIndex = before.lastIndexOf("/");
    if (slashIndex < 0) {
      return null;
    }
    return {
      start: slashIndex,
      query,
      end: cursor,
    };
  }

  function openSlashMenu(start, query) {
    closeMentionMenu();
    slashOpen = true;
    slashStart = start;
    slashQuery = String(query || "").toLowerCase();
    slashItems = getSlashCommands().filter((item) =>
      !slashQuery
        ? true
        : item.id.toLowerCase().includes(slashQuery) ||
          item.label.toLowerCase().includes(slashQuery)
    );
    slashActiveIndex = 0;
    closePlusMenu();
    closeMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    renderSlashMenu();
  }

  function applySlashSelection(index) {
    const item = slashItems[index];
    if (!item || !(promptEl instanceof HTMLTextAreaElement) || slashStart < 0) {
      closeSlashMenu();
      return;
    }
    if (item.kind === "mode") {
      const nextMode = item.id === "compose" ? "agent" : item.id;
      setAgentMode(nextMode, { focus: true, close: true });
      promptEl.value = "";
      promptEl.dispatchEvent(new Event("input", { bubbles: true }));
      closeSlashMenu();
      showCopyToast(
        t("slashModeSwitched", modeLabel ? modeLabel.textContent : item.label)
      );
      return;
    }
    const value = promptEl.value;
    const cursor =
      typeof promptEl.selectionStart === "number"
        ? promptEl.selectionStart
        : value.length;
    const insert = `/${item.id} `;
    const next = value.slice(0, slashStart) + insert + value.slice(cursor);
    const caret = slashStart + insert.length;
    promptEl.value = next;
    promptEl.focus();
    promptEl.setSelectionRange(caret, caret);
    autoResizePrompt();
    closeSlashMenu();
  }

  function requestMentionSearch(query) {
    mentionRequestId += 1;
    const requestId = String(mentionRequestId);
    host.postMessage({
      type: "searchFiles",
      query: String(query || ""),
      requestId,
    });
  }

  function specialMentionItems(query) {
    const q = String(query || "").toLowerCase();
    const specials = [
      {
        special: "problems",
        name: "@problems",
        hint: UI_LANG === "ru"
          ? "Все ошибки и предупреждения workspace"
          : "All workspace errors and warnings",
        icon: "error",
      },
      {
        special: "terminal",
        name: "@terminal",
        hint: UI_LANG === "ru"
          ? "Последний вывод терминала / Run"
          : "Last terminal / Run output",
        icon: "terminal",
      },
      {
        special: "url",
        name: "@url",
        hint: UI_LANG === "ru"
          ? "Вставить страницу: @url https://…"
          : "Fetch a page: @url https://…",
        icon: "language",
      },
    ];
    return specials.filter(
      (item) =>
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.special.includes(q)
    );
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
        `<div class="mention-empty">Searching...</div>`;
    }
    const specials = specialMentionItems(query);
    if (specials.length) {
      mentionItems = specials;
      renderMentionMenu();
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
    if (item.special) {
      const value = textarea.value;
      const cursor = textarea.selectionStart;
      const insert = item.special === "url" ? "@url " : `${item.name} `;
      const next = value.slice(0, mentionStart) + insert + value.slice(cursor);
      const caret = mentionStart + insert.length;
      textarea.value = next;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      if (textarea.classList.contains("msg-edit-input")) {
        editingUserText = next;
      }
      autoResizePrompt();
      persistDraftPrompt();
      closeMentionMenu();
      return;
    }
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    if (textarea === promptEl) {
      const next = value.slice(0, mentionStart) + value.slice(cursor);
      textarea.value = next;
      textarea.focus();
      textarea.setSelectionRange(mentionStart, mentionStart);
      addPendingMention(item.path);
      autoResizePrompt();
      persistDraftPrompt();
      closeMentionMenu();
      return;
    }
    const insert = `@${item.path} `;
    const next = value.slice(0, mentionStart) + insert + value.slice(cursor);
    const caret = mentionStart + insert.length;
    textarea.value = next;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    if (textarea.classList.contains("msg-edit-input")) {
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
    mentionItems = [
      ...specialMentionItems(mentionQuery),
      ...(Array.isArray(msg.files) ? msg.files : []),
    ];
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

  function onSlashInput(textarea) {
    const slash = findSlashAtCursor(textarea);
    if (!slash) {
      if (slashOpen) {
        closeSlashMenu();
      }
      return false;
    }
    openSlashMenu(slash.start, slash.query);
    return true;
  }

  function onSlashKeydown(event, textarea) {
    if (!slashOpen || textarea !== promptEl) {
      return false;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!slashItems.length) {
        return true;
      }
      slashActiveIndex = (slashActiveIndex + 1) % slashItems.length;
      renderSlashMenu();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!slashItems.length) {
        return true;
      }
      slashActiveIndex = (slashActiveIndex - 1 + slashItems.length) % slashItems.length;
      renderSlashMenu();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (!slashItems.length) {
        closeSlashMenu();
        return false;
      }
      event.preventDefault();
      applySlashSelection(slashActiveIndex);
      return true;
    }
    return false;
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

  function parseMentionTarget(raw) {
    const s = String(raw || "").trim();
    const m = s.match(
      /^(.*?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/
    );
    if (!m) {
      return { path: s, startLine: 0, endLine: 0 };
    }
    const startLine = Number(m[2] || m[4] || 0);
    const endLine = Number(m[3] || m[5] || startLine);
    return { path: m[1] || s, startLine, endLine };
  }

  function renderMentionChip(pathRaw) {
    const parsed = parseMentionTarget(pathRaw);
    const name = pathBasename(parsed.path);
    const fileType = selectionFileType({ path: parsed.path });
    const line =
      parsed.startLine > 0
        ? parsed.startLine === parsed.endLine
          ? `· ${parsed.startLine}`
          : `· ${parsed.startLine}–${parsed.endLine}`
        : "";
    return (
      `<button type="button" class="msg-mention msg-file-chip" data-path="${escapeHtml(
        parsed.path
      )}" title="${escapeHtml(parsed.path)}">` +
      `<span class="selection-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(
        fileType.label
      )}</span>` +
      `<span class="msg-file-chip-name">${escapeHtml(name)}</span>` +
      (line
        ? `<span class="msg-file-chip-line">${escapeHtml(line)}</span>`
        : "") +
      `</button>`
    );
  }

  function renderUserTextWithMentions(text) {
    const raw = String(text || "");
    const re = /@([^\s@]+)/g;
    let html = "";
    let last = 0;
    let match;
    while ((match = re.exec(raw))) {
      html += escapeHtml(raw.slice(last, match.index));
      html += renderMentionChip(match[1]);
      last = match.index + match[0].length;
    }
    html += escapeHtml(raw.slice(last));
    return html;
  }

  function displayAttachmentName(att) {
    const kind = String(att?.kind || "");
    const raw = String(att?.name || att?.path || "").trim();
    const base = raw.split(/[/\\]/).pop() || raw;
    const extMatch = base.match(/(\.[a-z0-9]{1,8})$/i);
    const ext = extMatch ? extMatch[1] : "";
    let stem = ext ? base.slice(0, -ext.length) : base;
    stem = stem.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      " "
    );
    stem = stem.replace(/[0-9a-f]{16,}/gi, " ");
    stem = stem.replace(/^[_-\s]+|[_-\s]+$/g, "").replace(/[_-\s]{2,}/g, " ");
    stem = stem.replace(/\s+/g, " ").trim();
    if (!stem) {
      return kind === "image" ? `image${ext || ".png"}` : ext ? `file${ext}` : "file";
    }
    const name = `${stem}${ext}`;
    return name.length > 42 ? `${stem.slice(0, 28)}…${ext}` : name;
  }

  function renderMessageAttachments(attachments) {
    if (!Array.isArray(attachments) || !attachments.length) {
      return "";
    }
    return (
      `<div class="msg-attachments">` +
      attachments
        .map((att) => {
          const full = String(att.path || att.name || "file");
          const title = escapeHtml(full);
          const src = attachmentPreviewSrc(att);
          if (attachmentLooksLikeImage(att) && src) {
            return (
              `<button type="button" class="msg-attach msg-attach-image" data-preview-src="${escapeHtml(
                src
              )}" title="${title}" aria-label="${t("zoomImage")}">` +
              `<img src="${src}" alt="" />` +
              `<span class="msg-attach-image-badge" aria-hidden="true">` +
              `<span class="material-symbols-outlined">zoom_in</span>` +
              `</span>` +
              `</button>`
            );
          }
          return renderFileTypeChip(att, "msg-attach");
        })
        .join("") +
      `</div>`
    );
  }

  let imgLightboxEl = null;

  function ensureImgLightbox() {
    if (imgLightboxEl) {
      return imgLightboxEl;
    }
    imgLightboxEl = document.createElement("div");
    imgLightboxEl.className = "img-lightbox";
    imgLightboxEl.hidden = true;
    imgLightboxEl.innerHTML =
      `<button type="button" class="img-lightbox-close" title="${t("close")}" aria-label="${t("close")}">` +
      `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
      `</button>` +
      `<img class="img-lightbox-img" alt="" />`;
    imgLightboxEl.addEventListener("click", (event) => {
      if (event.target.closest(".img-lightbox-close") || event.target === imgLightboxEl) {
        closeImgLightbox();
      }
    });
    document.body.appendChild(imgLightboxEl);
    return imgLightboxEl;
  }

  function openImgLightbox(src) {
    const url = String(src || "").trim();
    if (!url) {
      return;
    }
    const box = ensureImgLightbox();
    const img = box.querySelector(".img-lightbox-img");
    if (img) {
      img.src = url;
    }
    box.hidden = false;
  }

  function closeImgLightbox() {
    if (!imgLightboxEl) {
      return;
    }
    imgLightboxEl.hidden = true;
    const img = imgLightboxEl.querySelector(".img-lightbox-img");
    if (img) {
      img.removeAttribute("src");
    }
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
      host.postMessage({ type: "attachUris", uris: withPath });
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
      host.postMessage({
        type: "attachFiles",
        files: parsed.map(attachmentPayload),
      });
    }
  }

  function isNearBottom(threshold = NEAR_BOTTOM_PX) {
    if (!messagesEl) {
      return true;
    }
    const distance =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    return distance <= threshold;
  }

  function applyScrollToBottom() {
    if (!messagesEl) {
      return;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /** Scroll to end only if pinned (or forced — new send / full re-render). */
  function scrollToBottom(options) {
    const force = Boolean(options && options.force);
    if (!force && !stickToBottom) {
      return;
    }
    stickToBottom = true;
    applyScrollToBottom();
    if (scrollBottomRaf) {
      return;
    }
    // Second pass after layout (user bubble, «выполняю», composer/context).
    scrollBottomRaf = requestAnimationFrame(() => {
      applyScrollToBottom();
      requestAnimationFrame(() => {
        applyScrollToBottom();
        scrollBottomRaf = 0;
      });
    });
  }

  function pinChatToBottom() {
    stickToBottom = true;
    scrollToBottom({ force: true });
  }

  function persistUiState() {
    host.setState(state);
  }

  function persistDraftPrompt() {
    if (!promptEl) {
      return;
    }
    state.draftPrompt = promptEl.value || "";
    persistUiState();
  }

  /** Grow #prompt with content up to CSS max-height (~15 lines). */
  function autoResizePrompt() {
    if (!(promptEl instanceof HTMLTextAreaElement)) {
      return;
    }
    promptEl.style.height = "auto";
    const styles = window.getComputedStyle(promptEl);
    const minHeight = parseFloat(styles.minHeight);
    const maxHeight = parseFloat(styles.maxHeight);
    const contentHeight = promptEl.scrollHeight;
    let next = contentHeight;
    if (Number.isFinite(minHeight)) {
      next = Math.max(next, minHeight);
    }
    if (Number.isFinite(maxHeight)) {
      next = Math.min(next, maxHeight);
    }
    promptEl.style.height = `${Math.ceil(next)}px`;
  }

  function restoreDraftPrompt() {
    if (!promptEl || UI_SURFACE !== "panel") {
      return;
    }
    const draft = typeof state.draftPrompt === "string" ? state.draftPrompt : "";
    if (draft && !promptEl.value) {
      promptEl.value = draft;
    }
    autoResizePrompt();
  }

  function clearDraftPrompt() {
    state.draftPrompt = "";
    persistUiState();
  }

  function syncChatScroll(chatId) {
    if (!chatId || !messagesEl || restoringChatScroll) {
      return;
    }
    const scrollTop = messagesEl.scrollTop;
    window.clearTimeout(pendingScrollSync);
    pendingScrollSync = window.setTimeout(() => {
      host.postMessage({
        type: "chatScroll",
        chatId,
        scrollTop,
      });
    }, 120);
  }

  function restoreChatScroll(scrollTop) {
    if (typeof scrollTop === "number" && Number.isFinite(scrollTop)) {
      messagesEl.scrollTop = scrollTop;
      stickToBottom = isNearBottom();
    } else {
      scrollToBottom({ force: true });
    }
  }

  let currentChatTurnEl = null;

  function resetChatTurns() {
    currentChatTurnEl = null;
  }

  function startChatTurn() {
    currentChatTurnEl = document.createElement("div");
    currentChatTurnEl.className = "chat-turn";
    const status = messagesEl.querySelector(
      "#agentStatus, .agent-status-in-messages"
    );
    if (status && status.parentElement === messagesEl) {
      messagesEl.insertBefore(currentChatTurnEl, status);
    } else {
      messagesEl.appendChild(currentChatTurnEl);
    }
    return currentChatTurnEl;
  }

  function ensureChatTurn() {
    if (currentChatTurnEl && messagesEl.contains(currentChatTurnEl)) {
      return currentChatTurnEl;
    }
    return startChatTurn();
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

  function applyAgentStatusState(text, hidden, phase, modelLabel) {
    const nextHidden = Boolean(hidden || !text);
    agentStatusState = {
      text: nextHidden ? "" : text,
      hidden: nextHidden,
      phase: nextHidden ? "" : phase || "",
      modelLabel: nextHidden ? "" : modelLabel || "",
    };
  }

  function isAgentTimelineBusy() {
    return Boolean(
      currentChatTurnEl?.querySelector?.(
        ".tool-group.agent-timeline:not([data-sealed])"
      )
    );
  }

  /** Old «Думаю…» line — the run group («выполняю») is the only live status. */
  function shouldSuppressStatusPhase(phase) {
    return (
      !phase ||
      phase === "cline" ||
      phase === "reading" ||
      phase === "listing" ||
      phase === "editing" ||
      phase === "running" ||
      phase === "thinking" ||
      phase === "verifying"
    );
  }

  function setAgentStatus(text, hidden, phase, modelLabel) {
    // «выполняю» replaces the pulsing «Думаю…» line for the whole run,
    // even before the first tool/thinking step arrives.
    const suppressPhase =
      !hidden && (busy || isAgentTimelineBusy() || shouldSuppressStatusPhase(phase || ""));
    if (suppressPhase) {
      applyAgentStatusState(text, false, phase, modelLabel);
      if (agentStatusEl) {
        agentStatusEl.hidden = true;
      }
      return;
    }

    applyAgentStatusState(text, hidden, phase, modelLabel);

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
    el.replaceChildren();
    const label = document.createElement("span");
    label.className = "agent-status-text";
    label.textContent = agentStatusState.text;
    el.appendChild(label);
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
      agentStatusState.phase,
      agentStatusState.modelLabel
    );
  }

  function keepStatusAtEnd() {
    if (agentStatusState.hidden) {
      return;
    }
    if (
      busy ||
      isAgentTimelineBusy() ||
      shouldSuppressStatusPhase(agentStatusState.phase || "")
    ) {
      if (agentStatusEl) {
        agentStatusEl.hidden = true;
      }
      return;
    }
    if (agentStatusEl && agentStatusEl.hidden) {
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
    const preservedScrollTop = messagesEl.scrollTop;
    closeMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    pickAttachmentsForEdit = false;
    editingUserIndex = index;
    editingUserText = String(item.text || "");
    editingModelId = selectedModelId || models[0]?.id || "";
    editingModeId = normalizeAgentModeUi(item.mode || agentMode || "agent");
    editingReasoningEffort = modelSupportsReasoning(editingModelId)
      ? normalizeReasonLevel(selectedReasoningEffort) ||
        defaultReasonForModel(editingModelId)
      : "";
    editingAttachments = Array.isArray(item.attachments)
      ? item.attachments.slice()
      : [];
    renderMessages(uiMessagesCache, "restore", preservedScrollTop);
  }

  function cancelEditingUserMessage() {
    const preservedScrollTop = messagesEl.scrollTop;
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    pickAttachmentsForEdit = false;
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingModeId = "";
    editingReasoningEffort = "";
    editingAttachments = [];
    renderMessages(uiMessagesCache, "restore", preservedScrollTop);
  }

  function submitEditedUserMessage() {
    if (!Number.isInteger(editingUserIndex)) {
      return;
    }
    if (busy) {
      showCopyToast(
        UI_LANG === "ru"
          ? "Дождитесь окончания текущего хода или остановите его."
          : "Wait for the current turn to finish, or stop it."
      );
      return;
    }
    const input = messagesEl.querySelector(
      `.msg-edit-input[data-index="${editingUserIndex}"]`
    );
    if (input instanceof HTMLTextAreaElement) {
      editingUserText = input.value;
    }
    const nextText = editingUserText.trim();
    const attachments = editingAttachments.slice();
    if (!nextText && !attachments.length) {
      showCopyToast(
        UI_LANG === "ru" ? "Введите текст сообщения." : "Enter a message."
      );
      return;
    }
    const model =
      editingModelId || selectedModelId || models[0]?.id || "";
    const mode = normalizeAgentModeUi(editingModeId || agentMode);
    if (model && model !== selectedModelId) {
      setSelectedModel(model, true);
    }
    if (mode && mode !== agentMode) {
      setAgentMode(mode, { close: true, notify: true, focus: false });
    }
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    pickAttachmentsForEdit = false;
    harborEditSaveAt = Date.now();
    stickToBottom = true;
    setBusy(true);
    host.postMessage({
      type: "editUserMessage",
      index: editingUserIndex,
      text: nextText,
      model,
      agentMode: mode,
      reasoningEffort:
        editingReasoningEffort || selectedReasoningEffort || undefined,
      attachments: attachments.map(attachmentPayload),
    });
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingModeId = "";
    editingReasoningEffort = "";
    editingAttachments = [];
  }

  function eventTargetElement(event) {
    const target = event.target;
    if (target instanceof Element) {
      return target;
    }
    if (target && target.parentElement instanceof Element) {
      return target.parentElement;
    }
    return null;
  }

  /** VS Code webview often drops `click` on the sticky edit-save control. */
  function trySubmitEditedUserMessageFromPointer(event) {
    if (event.button != null && event.button !== 0) {
      return false;
    }
    const target = eventTargetElement(event);
    if (!target || !messagesEl) {
      return false;
    }
    const saveBtn = target.closest(".msg-edit-save");
    if (!saveBtn || !messagesEl.contains(saveBtn) || saveBtn.disabled) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() - harborEditSaveAt < 450) {
      return true;
    }
    submitEditedUserMessage();
    return true;
  }

  function modelDisplayName(id) {
    const model = models.find((m) => m.id === id);
    return model ? model.label || model.id : id || t("noModels");
  }

  function modeDisplayName(id) {
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const wanted = String(id || "").trim();
    const raw =
      modes.find((m) => m.id === wanted) ||
      modes.find((m) => m.id === "agent") ||
      modes[0];
    if (!raw) {
      return t("mode");
    }
    const mode = localizeModeMeta(raw);
    return mode.label || mode.id || t("mode");
  }

  function renderEditModelMenu(menuEl) {
    if (!menuEl) {
      return;
    }
    menuEl.innerHTML = "";
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = t("noModelsInSettings");
      menuEl.appendChild(empty);
      return;
    }
    for (const model of models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (model.id === editingModelId ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("data-model-id", model.id);
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

  const modelMenuHomes = new WeakMap();

  function ensureModelMenuFloated(menu) {
    if (!menu || menu.parentElement === document.body) {
      return;
    }
    if (!modelMenuHomes.has(menu)) {
      modelMenuHomes.set(menu, {
        parent: menu.parentElement,
        next: menu.nextSibling,
      });
    }
    document.body.appendChild(menu);
  }

  function restoreModelMenuHome(menu) {
    if (!menu) {
      return;
    }
    const home = modelMenuHomes.get(menu);
    modelMenuHomes.delete(menu);
    if (!home || !home.parent || !home.parent.isConnected) {
      return;
    }
    if (home.next && home.next.parentNode === home.parent) {
      home.parent.insertBefore(menu, home.next);
    } else {
      home.parent.appendChild(menu);
    }
  }

  function findEditModelMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-model-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-model-menu");
  }

  function clearModelMenuPlacementStyles(menu) {
    if (!menu) {
      return;
    }
    menu.classList.remove("opens-down", "is-fixed");
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.bottom = "";
    menu.style.width = "";
    menu.style.minWidth = "";
    menu.style.maxHeight = "";
    menu.style.zIndex = "";
    menu.style.visibility = "";
  }

  function resetModelMenuPlacement(picker, menu) {
    if (picker) {
      picker.classList.remove("opens-down");
    }
    clearModelMenuPlacementStyles(menu);
    restoreModelMenuHome(menu);
  }

  /**
   * Float the menu to document.body + position:fixed so #messages overflow
   * and sticky stacking contexts cannot clip it.
   */
  function placeModelMenu(picker, menu, boundaryEl) {
    if (!picker || !menu || menu.hidden) {
      return;
    }
    if (picker) {
      picker.classList.remove("opens-down");
    }
    clearModelMenuPlacementStyles(menu);

    const gap = 6;
    const cssMax = 240;
    const edgePad = 8;
    const boundary =
      boundaryEl || chatScreen || document.documentElement;
    const trigger =
      picker.querySelector(".model-trigger") || picker;
    const triggerRect = trigger.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();

    ensureModelMenuFloated(menu);
    menu.classList.add("is-fixed");
    menu.style.position = "fixed";
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.visibility = "hidden";
    menu.style.zIndex = "10000";
    menu.style.minWidth =
      Math.round(Math.max(220, triggerRect.width)) + "px";

    const naturalHeight = Math.min(
      Math.max(menu.scrollHeight, 1),
      cssMax
    );
    const menuWidth = Math.min(
      320,
      Math.max(220, triggerRect.width, menu.offsetWidth || 0)
    );

    const availAbove =
      Math.min(
        triggerRect.top - boundaryRect.top,
        triggerRect.top
      ) - gap;
    const availBelow =
      Math.min(
        boundaryRect.bottom - triggerRect.bottom,
        window.innerHeight - triggerRect.bottom
      ) - gap;
    const openDown =
      availAbove < naturalHeight && availBelow > availAbove;

    let left = triggerRect.left;
    const maxLeft = window.innerWidth - menuWidth - edgePad;
    if (left > maxLeft) {
      left = Math.max(edgePad, maxLeft);
    }
    if (left < edgePad) {
      left = edgePad;
    }

    menu.style.visibility = "";
    menu.style.left = Math.round(left) + "px";

    const minMenu = 120;
    if (openDown) {
      picker.classList.add("opens-down");
      menu.classList.add("opens-down");
      menu.style.top = Math.round(triggerRect.bottom + gap) + "px";
      menu.style.bottom = "auto";
      let below = Math.floor(availBelow);
      if (below < minMenu) {
        below = Math.min(
          cssMax,
          Math.max(minMenu, window.innerHeight - triggerRect.bottom - gap - edgePad)
        );
      }
      menu.style.maxHeight = Math.max(minMenu, Math.min(cssMax, below)) + "px";
    } else {
      menu.style.top = "auto";
      menu.style.bottom =
        Math.round(window.innerHeight - triggerRect.top + gap) + "px";
      let above = Math.floor(availAbove);
      if (above < minMenu) {
        above = Math.min(
          cssMax,
          Math.max(minMenu, triggerRect.top - gap - edgePad)
        );
      }
      menu.style.maxHeight = Math.max(minMenu, Math.min(cssMax, above)) + "px";
    }
    if (typeof forceHarborUiRepaint === "function") {
      forceHarborUiRepaint();
      setTimeout(forceHarborUiRepaint, 32);
    }
  }

  function closeEditModelMenu() {
    editModelMenuOpen = false;
    const picker = getEditModelPicker();
    const menu = findEditModelMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-model-trigger");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditModelMenu() {
    const picker = getEditModelPicker();
    if (!picker) {
      return;
    }
    if (busy) {
      showCopyToast(
        UI_LANG === "ru"
          ? "Дождитесь окончания текущего хода или остановите его."
          : "Wait for the current turn to finish, or stop it."
      );
      return;
    }
    closeMenu();
    closeEditModeMenu();
    editModelMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-model-trigger");
    const menu = findEditModelMenu(picker);
    renderEditModelMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
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
    const next = String(id || "").trim();
    if (!next) {
      closeEditModelMenu();
      return;
    }
    editingModelId = next;
    if (modelSupportsReasoning(editingModelId)) {
      editingReasoningEffort =
        normalizeReasonLevel(editingReasoningEffort) ||
        defaultReasonForModel(editingModelId);
    } else {
      editingReasoningEffort = "";
    }
    const picker = getEditModelPicker();
    const label = picker
      ? picker.querySelector(".msg-edit-model-label")
      : null;
    const trigger = picker
      ? picker.querySelector(".msg-edit-model-trigger")
      : null;
    const full = modelDisplayName(editingModelId);
    if (label) {
      label.textContent = shortModelChip(full);
    }
    if (trigger) {
      trigger.title = full;
    }
    updateEditReasonPickerUI();
    closeEditModelMenu();
  }

  function editingModelIdFromOption(option) {
    if (!(option instanceof Element)) {
      return "";
    }
    return (
      option.getAttribute("data-model-id") ||
      option.getAttribute("data-id") ||
      option.dataset.id ||
      ""
    );
  }

  function selectEditingModelFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-model-menu .model-option")
        : null;
    if (!option || option.classList.contains("is-empty")) {
      return false;
    }
    selectEditingModel(editingModelIdFromOption(option));
    return true;
  }

  function getEditModePicker() {
    return messagesEl.querySelector(".msg-edit-mode-picker");
  }

  function findEditModeMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-mode-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-mode-menu");
  }

  function renderEditModeMenu(menuEl) {
    if (!menuEl) {
      return;
    }
    menuEl.innerHTML = "";
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    if (!modes.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = t("noModes");
      menuEl.appendChild(empty);
      return;
    }
    const activeId = normalizeAgentModeUi(editingModeId || agentMode);
    for (const sourceMode of modes) {
      const mode = localizeModeMeta(sourceMode);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (mode.id === activeId ? " is-active" : "");
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
      if (mode.id === activeId) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML = CHECK_ICON;
        btn.appendChild(check);
      }
      menuEl.appendChild(btn);
    }
  }

  function closeEditModeMenu() {
    editModeMenuOpen = false;
    const picker = getEditModePicker();
    const menu = findEditModeMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-mode-trigger");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditModeMenu() {
    const picker = getEditModePicker();
    if (!picker) {
      return;
    }
    if (busy) {
      showCopyToast(
        UI_LANG === "ru"
          ? "Дождитесь окончания текущего хода или остановите его."
          : "Wait for the current turn to finish, or stop it."
      );
      return;
    }
    closeMenu();
    closeModeMenu();
    closeEditModelMenu();
    editModeMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-mode-trigger");
    const menu = findEditModeMenu(picker);
    renderEditModeMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
    }
  }

  function toggleEditModeMenu() {
    if (editModeMenuOpen) {
      closeEditModeMenu();
    } else {
      openEditModeMenu();
    }
  }

  function selectEditingMode(id) {
    const next = normalizeAgentModeUi(id);
    editingModeId = next;
    const picker = getEditModePicker();
    const label = picker
      ? picker.querySelector(".msg-edit-mode-label")
      : null;
    if (label) {
      label.textContent = modeDisplayName(editingModeId);
    }
    if (picker) {
      applyModeAccentToElement(picker, editingModeId);
    }
    const editComposer = messagesEl
      ? messagesEl.querySelector(".msg-edit-composer")
      : null;
    if (editComposer) {
      applyModeAccentToElement(editComposer, editingModeId);
    }
    closeEditModeMenu();
  }

  function selectEditingModeFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-mode-menu .model-option")
        : null;
    if (!option || option.classList.contains("is-empty")) {
      return false;
    }
    const modeId = String(option.dataset.mode || "").trim();
    if (!modeId) {
      return false;
    }
    selectEditingMode(modeId);
    return true;
  }

  /* --- Edit-composer "+" (attachments) picker — mirrors composerPlus. --- */

  function getEditPlusPicker() {
    return messagesEl.querySelector(".msg-edit-plus");
  }

  function findEditPlusMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-plus-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-plus-menu");
  }

  function closeEditPlusMenu() {
    editPlusMenuOpen = false;
    const picker = getEditPlusPicker();
    const menu = findEditPlusMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-plus-btn");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditPlusMenu() {
    const picker = getEditPlusPicker();
    if (!picker) {
      return;
    }
    closeMenu();
    closeModeMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditReasonMenu();
    editPlusMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-plus-btn");
    const menu = findEditPlusMenu(picker);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
    }
  }

  function toggleEditPlusMenu() {
    if (editPlusMenuOpen) {
      closeEditPlusMenu();
    } else {
      openEditPlusMenu();
    }
  }

  /* --- Edit-composer reason (Intelligence) picker — mirrors reasonPicker. --- */

  function getEditReasonPicker() {
    return messagesEl.querySelector(".msg-edit-reason-picker");
  }

  function findEditReasonMenu(picker) {
    if (picker) {
      const nested = picker.querySelector(".msg-edit-reason-menu");
      if (nested) {
        return nested;
      }
    }
    return document.body.querySelector(":scope > .msg-edit-reason-menu");
  }

  function updateEditReasonPickerUI() {
    const picker = getEditReasonPicker();
    if (!picker) {
      return;
    }
    const supported = modelSupportsReasoning(
      editingModelId || selectedModelId
    );
    picker.hidden = !supported;
    if (!supported) {
      closeEditReasonMenu();
      return;
    }
    const level =
      normalizeReasonLevel(editingReasoningEffort) ||
      defaultReasonForModel(editingModelId || selectedModelId);
    const label = picker.querySelector(".msg-edit-reason-label");
    const trigger = picker.querySelector(".msg-edit-reason-trigger");
    if (label) {
      label.textContent = reasonLevelLabel(level);
    }
    if (trigger) {
      trigger.title = `${t("intelligence")}: ${reasonLevelLabel(level)}`;
    }
  }

  function renderEditReasonMenu(menuEl) {
    if (!menuEl) {
      return;
    }
    menuEl.innerHTML = "";
    const activeLevel = normalizeReasonLevel(editingReasoningEffort);
    for (const level of REASON_LEVELS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (level.id === activeLevel ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.dataset.reason = level.id;
      const label = document.createElement("span");
      label.className = "model-option-label";
      label.textContent = t(level.labelKey);
      btn.appendChild(label);
      if (level.id === activeLevel) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML = CHECK_ICON;
        btn.appendChild(check);
      }
      menuEl.appendChild(btn);
    }
  }

  function closeEditReasonMenu() {
    editReasonMenuOpen = false;
    const picker = getEditReasonPicker();
    const menu = findEditReasonMenu(picker);
    if (picker) {
      picker.classList.remove("is-open");
      const trigger = picker.querySelector(".msg-edit-reason-trigger");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }
    if (menu) {
      menu.hidden = true;
    }
    resetModelMenuPlacement(picker, menu);
  }

  function openEditReasonMenu() {
    const picker = getEditReasonPicker();
    if (!picker || picker.hidden) {
      return;
    }
    closeMenu();
    closeModeMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    editReasonMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-reason-trigger");
    const menu = findEditReasonMenu(picker);
    renderEditReasonMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
      placeModelMenu(picker, menu, chatScreen);
    }
  }

  function toggleEditReasonMenu() {
    if (editReasonMenuOpen) {
      closeEditReasonMenu();
    } else {
      openEditReasonMenu();
    }
  }

  function selectEditingReasoningEffort(id) {
    const next = normalizeReasonLevel(id);
    if (!modelSupportsReasoning(editingModelId || selectedModelId)) {
      editingReasoningEffort = "";
      updateEditReasonPickerUI();
      closeEditReasonMenu();
      return;
    }
    editingReasoningEffort =
      next || defaultReasonForModel(editingModelId || selectedModelId);
    updateEditReasonPickerUI();
    closeEditReasonMenu();
  }

  /* --- Edit-composer attachments — mirrors pendingAttachments flow. --- */

  function refreshEditingAttachmentsPreview() {
    const composer = messagesEl.querySelector(".msg-edit-composer");
    if (!composer) {
      return;
    }
    // Replace the read-only render (plain .msg-attachments) — edit mode
    // shows removable chips instead.
    composer
      .querySelectorAll(
        ".msg-attachments:not(.msg-edit-attach-preview)"
      )
      .forEach((el) => el.remove());
    let container = composer.querySelector(
      ".msg-attachments.msg-edit-attach-preview"
    );
    if (!editingAttachments.length) {
      if (container) {
        container.remove();
      }
      return;
    }
    if (!container) {
      container = document.createElement("div");
      container.className = "msg-attachments msg-edit-attach-preview";
      const textarea = composer.querySelector(".msg-edit-input");
      if (textarea) {
        composer.insertBefore(container, textarea);
      } else {
        composer.prepend(container);
      }
    }
    container.innerHTML = editingAttachments
      .map((att) => {
        const full = String(att.path || att.name || "file");
        const title = escapeHtml(full);
        const src = attachmentPreviewSrc(att);
        const remove =
          `<button type="button" class="attach-chip-remove" data-id="${escapeHtml(
            att.id
          )}" title="${t("remove")}" aria-label="${t("remove")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
          `</button>`;
        if (attachmentLooksLikeImage(att) && src) {
          return (
            `<div class="attach-chip attach-chip-image" data-id="${escapeHtml(
              att.id
            )}" title="${title}">` +
            `<img class="attach-thumb" src="${src}" alt="" decoding="sync" />` +
            `<span class="msg-attach-image-badge" aria-hidden="true">` +
            `<span class="material-symbols-outlined">image</span>` +
            `</span>` +
            remove +
            `</div>`
          );
        }
        return renderFileTypeChip(att, "attach-chip", remove);
      })
      .join("");
  }

  function mergeEditingAttachments(list) {
    if (!Array.isArray(list) || !list.length) {
      return;
    }
    let changed = false;
    for (const item of list) {
      if (editingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      const id =
        item.id ||
        `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (editingAttachments.some((a) => a.id === id)) {
        continue;
      }
      const kind = attachmentLooksLikeImage(item)
        ? "image"
        : item.kind || "file";
      editingAttachments.push({
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
      changed = true;
    }
    if (changed) {
      refreshEditingAttachmentsPreview();
    }
  }

  function removeEditingAttachment(id) {
    const before = editingAttachments.length;
    editingAttachments = editingAttachments.filter((a) => a.id !== id);
    if (editingAttachments.length !== before) {
      refreshEditingAttachmentsPreview();
    }
  }

  function selectEditingReasonFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-reason-menu .model-option")
        : null;
    if (!option) {
      return false;
    }
    selectEditingReasoningEffort(String(option.dataset.reason || ""));
    return true;
  }

  function selectEditPlusItemFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const item =
      event.target instanceof Element
        ? event.target.closest(".msg-edit-plus-menu .composer-plus-item")
        : null;
    if (!item || item.disabled || item.classList.contains("is-disabled")) {
      return false;
    }
    const action = item.getAttribute("data-action");
    closeEditPlusMenu();
    if (action === "file") {
      pickAttachmentsForEdit = true;
      host.postMessage({ type: "pickAttachments" });
    }
    return true;
  }

  function removeRegenerateButtons() {
    const btns = messagesEl.querySelectorAll(".msg-regenerate");
    btns.forEach((b) => b.remove());
  }

  function branchButtonHtml(index) {
    return (
      `<button type="button" class="icon-btn msg-branch" data-index="${index}" title="${t("branch")}" aria-label="${t("branch")}">` +
      BRANCH_ICON +
      `</button>`
    );
  }

  function copyAssistantFromButton(btn) {
    const wrap = btn.closest(".msg-wrap-assistant");
    const msg = wrap?.querySelector(".msg.assistant");
    const raw = String(msg?.dataset.raw || msg?.querySelector(".msg-body")?.innerText || "").trim();
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

  function assistantActionsHtml(index, showRegen) {
    const copyHtml =
      `<button type="button" class="icon-btn msg-copy" data-index="${index}" title="${t("copy")}" aria-label="${t("copy")}">` +
      COPY_ICON +
      `</button>`;
    const branchHtml = Number.isInteger(index) ? branchButtonHtml(index) : "";
    const regenHtml = showRegen
      ? `<button type="button" class="icon-btn msg-regenerate" title="${t("regenerateLast")}" aria-label="${t("regenerateLast")}">` +
        REGENERATE_ICON +
        `</button>`
      : "";
    return copyHtml + branchHtml + regenHtml;
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
    const index = Number(last.dataset.index);
    const actionsHtml = assistantActionsHtml(index, true);

    const parent = last.parentElement;
    if (parent && parent.classList.contains("msg-wrap-assistant")) {
      let actions = parent.querySelector(".msg-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "msg-actions";
        parent.appendChild(actions);
      }
      actions.innerHTML = actionsHtml;
      return;
    }

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = actionsHtml;

    const wrap = document.createElement("div");
    wrap.className = "msg-wrap msg-wrap-assistant";
    (parent || messagesEl).insertBefore(wrap, last);
    wrap.appendChild(last);
    wrap.appendChild(actions);
  }

  function renderChatBranches(list) {
    chatBranches = Array.isArray(list) ? list : [];
    if (!chatBranchesEl) {
      return;
    }
    if (chatBranches.length < 2) {
      chatBranchesEl.hidden = true;
      chatBranchesEl.innerHTML = "";
      forceHarborUiRepaint();
      return;
    }
    chatBranchesEl.hidden = false;
    chatBranchesEl.innerHTML = chatBranches
      .map((b) => {
        const active = b.active ? " is-active" : "";
        const selected = b.active ? "true" : "false";
        const closeBtn = b.canDelete
          ? `<button type="button" class="chat-branch-close" data-chat-id="${escapeHtml(
              b.id || ""
            )}" title="${t("deleteBranch")}" aria-label="${t("deleteBranch")}">` +
            `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
            `</button>`
          : "";
        return (
          `<div class="chat-branch-item${active}" role="presentation">` +
          `<button type="button" class="chat-branch-pill${active}" role="tab" aria-selected="${selected}" data-chat-id="${escapeHtml(
            b.id || ""
          )}" title="${escapeHtml(b.label || t("branchDefault"))}">` +
          escapeHtml(b.label || t("branchDefault")) +
          `</button>` +
          closeBtn +
          `</div>`
        );
      })
      .join("");
    forceHarborUiRepaint();
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
    contextRingEl.setAttribute("aria-label", `Context: ${tip}`);
    contextRingEl.hidden = false;
    if (stickToBottom) {
      scrollToBottom();
    }
  }

  /**
   * Map legacy tool names to current Cline names so labels stay correct even
   * if a stale bundle is loaded. Keys are old Harbor names; values are the
   * canonical Cline tool name.
   */
  const TOOL_NAME_ALIASES = {
    read_file: "read_files",
    write_file: "editor",
    search_replace: "editor",
    search_text: "search_codebase",
    run_command: "run_commands",
    list_files: "list_files",
    fetch_url: "fetch_web_content",
  };

  function canonicalToolName(raw) {
    const n = String(raw || "").trim();
    return TOOL_NAME_ALIASES[n] || n;
  }

  /** Shorten a filesystem path for one-line display (keep basename + parent). */
  function shortPath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const parts = s.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) return s;
    return `…/${parts.slice(-2).join("/")}`;
  }

  /** Basename only — option C timeline rows. */
  function fileBase(p) {
    const s = String(p || "").trim().replace(/[\\/]+$/, "");
    if (!s) {
      return "";
    }
    const parts = s.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || s;
  }

  function argsPreviewFromToolText(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^[a-zA-Z0-9_]+\(([\s\S]*)\)$/);
    return match ? match[1] : "";
  }

  function toolStepMatchKey(name, argsPreview, label) {
    const tool = canonicalToolName(name || parseToolName(label) || "");
    let path = "";
    const rawArgs = String(argsPreview || "").trim();
    if (rawArgs) {
      // Scalar field: "path":"...", "command":"...", "url":"...", etc.
      // url/task/skill/question cover fetch/open/skills/ask/spawn cards whose
      // args carry no path — with an empty key their "⚙ name(args)" text twin
      // renders as a duplicate card instead of merging into the step.
      let pathMatch = rawArgs.match(
        /"(?:relativePath|path|file_path|command|query|queries|url|task|skill|question)"\s*:\s*"((?:\\.|[^"\\])*)"/
      );
      // Truncated preview: opening quote present, closing quote cut off.
      if (!pathMatch) {
        pathMatch = rawArgs.match(
          /"(?:relativePath|path|file_path|command|query|queries|url|task|skill|question)"\s*:\s*"((?:\\.|[^"\\])*)/
        );
      }
      if (pathMatch) {
        path = pathMatch[1].replace(/\\"/g, '"');
      }
      // Array field: "commands":["..."], "paths":["..."], "files":["..."], etc.
      // Take the first element so two cards for the same tool_use collapse into
      // one (onStep + onTool both produce the same non-empty key → merge).
      if (!path) {
        const arrayMatch = rawArgs.match(
          /"(?:commands|paths|file_paths|files|queries)"\s*:\s*\["((?:\\.|[^"\\])*)"/
        );
        if (arrayMatch) {
          path = arrayMatch[1].replace(/\\"/g, '"');
        }
      }
      // fetch_web_content ships urls as "requests":[{"url":"..."}].
      if (!path) {
        const requestMatch = rawArgs.match(
          /"requests"\s*:\s*\[\s*\{\s*"url"\s*:\s*"((?:\\.|[^"\\])*)/
        );
        if (requestMatch) {
          path = requestMatch[1].replace(/\\"/g, '"');
        }
      }
    }
    if (!path && label) {
      path = String(label)
        .replace(/^(чтение|запись|правка|список|поиск|команда|read|write|edit|list|search|run)\s+/i, "")
        .replace(/\s*·\s*\d+\s+\S+$/u, "")
        .replace(/\s*\(\+\d+\)\s*$/, "")
        .trim();
    }
    return `${tool}::${fileBase(path)}`;
  }

  /** Format a single command entry — string or {command, args?} object. */
  function formatCmdEntry(entry) {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      if (typeof entry.command === "string") {
        const a = Array.isArray(entry.args) ? entry.args.map(String) : [];
        return a.length > 0 ? `${entry.command} ${a.join(" ")}` : entry.command;
      }
    }
    return String(entry);
  }

  function formatToolHumanLabel(name, argsPreview, metrics, status, resultPreview) {
    const toolName = canonicalToolName(name);
    let args = {};
    const rawArgs = String(argsPreview || "").trim();
    if (rawArgs) {
      try {
        args = JSON.parse(rawArgs);
      } catch {
        // Truncated JSON from step preview — try to pull common fields by regex.
        let pathMatch = rawArgs.match(
          /"(?:relativePath|path|file_path)"\s*:\s*"((?:\\.|[^"\\])*)"/
        );
        if (!pathMatch) {
          pathMatch = rawArgs.match(
            /"(?:relativePath|path|file_path)"\s*:\s*"((?:\\.|[^"\\])*)/
          );
        }
        if (pathMatch) {
          args.path = pathMatch[1].replace(/\\"/g, '"');
          args.relativePath = args.path;
        }
        const cmdMatch = rawArgs.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (cmdMatch) {
          args.command = cmdMatch[1].replace(/\\"/g, '"');
        } else {
          // Truncated mid-string: opening quote present but closing quote cut off.
          const cmdPartial = rawArgs.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)/);
          if (cmdPartial) {
            args.command = cmdPartial[1].replace(/\\"/g, '"');
          }
        }
        // Also try "commands" array for run_commands with truncated JSON.
        if (!cmdMatch) {
          const cmdsMatch = rawArgs.match(
            /"commands"\s*:\s*\[((?:[^\]]{0,200}))/
          );
          if (cmdsMatch) {
            const inner = cmdsMatch[1];
            const items = [];
            const re = /"((?:\\.|[^"\\])*)"/g;
            let m;
            while ((m = re.exec(inner)) !== null) {
              items.push(m[1].replace(/\\"/g, '"'));
            }
            // If no complete quoted string matched (truncated mid-string),
            // try to grab the first quoted prefix.
            if (!items.length) {
              const partial = inner.match(/"((?:\\.|[^"\\])*)/);
              if (partial) {
                items.push(partial[1].replace(/\\"/g, '"'));
              }
            }
            if (items.length) {
              args.commands = items;
            }
          }
        }
        const queryMatch = rawArgs.match(
          /"(?:query|queries)"\s*:\s*"((?:\\.|[^"\\])*)"/
        );
        if (queryMatch) {
          args.query = queryMatch[1].replace(/\\"/g, '"');
        }
        // No trailing quote requirement: task is often truncated mid-string.
        const taskMatch = rawArgs.match(/"task"\s*:\s*"((?:\\.|[^"\\])*)/);
        if (taskMatch) {
          args.task = taskMatch[1].replace(/\\"/g, '"');
        }
        // Legacy previews truncated inside systemPrompt before task appeared.
        const systemPromptMatch = rawArgs.match(
          /"systemPrompt"\s*:\s*"((?:\\.|[^"\\])*)/
        );
        if (systemPromptMatch) {
          args.systemPrompt = systemPromptMatch[1].replace(/\\"/g, '"');
        }
        const urlMatch = rawArgs.match(/"url"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (urlMatch) {
          args.url = urlMatch[1].replace(/\\"/g, '"');
        }
      }
    }

    // Helpers to read common Cline input shapes.
    const firstString = (v) =>
      typeof v === "string" ? v.trim() : Array.isArray(v) && v.length ? String(v[0] || "").trim() : "";
    const filesFromArgs = () => {
      const out = [];
      const push = (v) => {
        if (typeof v === "string" && v.trim()) out.push(v.trim());
        else if (v && typeof v === "object") {
          const p = v.path || v.relativePath || v.file_path;
          if (typeof p === "string" && p.trim()) out.push(p.trim());
        }
      };
      for (const key of ["files", "paths", "file_paths"]) {
        const v = args[key];
        if (Array.isArray(v)) v.forEach(push);
        else if (v) push(v);
      }
      if (!out.length && (args.path || args.relativePath)) {
        out.push(String(args.path || args.relativePath).trim());
      }
      return out;
    };
    const m = metrics || {};

    switch (toolName) {
      case "read_files": {
        const paths = (m.files && m.files.length ? m.files : filesFromArgs());
        const first = paths[0] || "";
        const extra = paths.length > 1 ? ` +${paths.length - 1}` : "";
        return t("toolHumanRead", fileBase(first)) + extra;
      }
      case "editor": {
        const filePath =
          (m.files && m.files[0]) || args.path || args.relativePath || "";
        const isCreate = m.created === true || (!args.old_text && !args.insert_line && !!args.new_text);
        return isCreate
          ? t("toolHumanCreate", fileBase(filePath))
          : t("toolHumanReplace", fileBase(filePath));
      }
      case "list_files":
        return t("toolHumanList", fileBase(args.path || args.relativePath) || ".");
      case "search_codebase": {
        const query = firstString(args.queries || args.query);
        const countSuffix =
          status === "done" && typeof m.matches === "number" && m.matches > 0
            ? ` (${m.matches})`
            : "";
        return t("toolHumanSearch", query) + countSuffix;
      }
      case "run_commands": {
        let cmd = "";
        if (Array.isArray(args.commands) && args.commands.length) {
          cmd = args.commands.map(formatCmdEntry).join(" && ");
        } else if (typeof args.command === "string") {
          cmd = args.command;
        } else if (typeof args.cmd === "string") {
          cmd = args.cmd;
        } else if (typeof args === "string") {
          cmd = args;
        }
        const exitSuffix =
          status === "error" && typeof m.exitCode === "number"
            ? ` · ${t("toolMetricExit")} ${m.exitCode}`
            : "";
        return t("toolHumanRun", cmd) + exitSuffix;
      }
      case "fetch_web_content":
      case "fetch_url":
        return t("toolHumanFetch", String(args.url || firstString(args.requests && args.requests[0] && args.requests[0].url) || "").trim());
      case "screenshot_url":
        return t("toolHumanScreenshot", String(args.url || "").trim());
      case "open_external":
        return t("toolHumanOpen", String(args.url || "").trim());
      case "browser_navigate":
        return t("toolHumanBrowserNav", String(args.url || "").trim());
      case "browser_snapshot":
        return t("toolHumanBrowserSnap");
      case "browser_click":
        return t("toolHumanBrowserClick");
      case "browser_type":
        return t("toolHumanBrowserType");
      case "browser_close":
        return t("toolHumanBrowserClose");
      case "get_diagnostics":
        return t("toolHumanDiagnostics");
      case "ask_question":
        return t("toolHumanAskQuestion", String(args.question || "").trim());
      case "submit_and_exit":
        return t("toolHumanSubmitExit");
      case "skills":
        return t("toolHumanSkill", String(args.skill || "").trim());
      case "apply_patch":
        return t("toolHumanApplyPatch");
      case "spawn_agent": {
        const task = String(
          args.task || args.prompt || args.systemPrompt || ""
        ).trim();
        const short = task.length > 80 ? `${task.slice(0, 77)}…` : task;
        const base = t("toolHumanSpawn", short);
        if (status === "error") {
          const err = String(resultPreview || "")
            .replace(/^Субагент ошибка:\s*/i, "")
            .replace(/^Sub-agent error:\s*/i, "")
            .trim();
          if (err) {
            const errShort = err.length > 100 ? `${err.slice(0, 97)}…` : err;
            return `${base} · ${t("toolSpawnError", errShort)}`;
          }
          return `${base} · ${t("toolSpawnError", "")}`;
        }
        return base;
      }
      case "vision_attached_screenshot":
        return t("toolHumanVisionAttached");
      case "vision_page_url":
        return t("toolHumanVisionPageUrl");
      case "screenshot_plan_explore":
        return t("toolHumanScreenshotExplore");
      default: {
        if (toolName.startsWith("mcp__")) {
          const short = toolName.replace(/^mcp__[^_]+__/, "") || toolName;
          return t("toolHumanMcp", short);
        }
        if (toolName.startsWith("subagent_")) {
          return t("toolHumanSpawn", toolName.replace(/^subagent_/, ""));
        }
        return t("toolHumanTool", toolName);
      }
    }
  }

  function formatToolLine(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^([a-zA-Z0-9_]+)\(([\s\S]*)\)$/);
    if (!match) {
      return raw;
    }
    return formatToolHumanLabel(match[1], match[2]);
  }

  function parseToolName(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^([a-zA-Z0-9_]+)\(/);
    if (match) {
      return match[1];
    }
    const line = String(text || "");
    const prefix = line.split("·")[0].trim().toLowerCase();
    if (
      prefix === "read" ||
      prefix === t("toolKindRead").toLowerCase()
    ) {
      return "read_file";
    }
    if (
      prefix === "write" ||
      prefix === t("toolKindWrite").toLowerCase()
    ) {
      return "write_file";
    }
    if (
      prefix === "replace" ||
      prefix === t("toolKindReplace").toLowerCase()
    ) {
      return "search_replace";
    }
    if (
      prefix === "list" ||
      prefix === t("toolKindList").toLowerCase()
    ) {
      return "list_files";
    }
    if (
      prefix === "search" ||
      prefix === t("toolKindSearch").toLowerCase()
    ) {
      return "search_text";
    }
    if (
      prefix === "run" ||
      prefix === t("toolKindRun").toLowerCase()
    ) {
      return "run_command";
    }
    if (
      prefix === "fetch" ||
      prefix === t("toolKindFetch").toLowerCase()
    ) {
      return "fetch_url";
    }
    if (
      prefix === "open" ||
      prefix === t("toolKindOpen").toLowerCase()
    ) {
      return "open_external";
    }
    if (prefix === "mcp" || prefix === t("toolKindMcp").toLowerCase()) {
      return "mcp__tool";
    }
    return "";
  }

  function toolKind(name) {
    const n = canonicalToolName(name);
    if (n === "read_files") {
      return "read";
    }
    if (n === "editor" || n === "apply_patch") {
      return "replace";
    }
    if (n === "list_files") {
      return "list";
    }
    if (n === "search_codebase") {
      return "search";
    }
    if (n === "run_commands") {
      return "run";
    }
    if (n === "fetch_web_content" || n === "fetch_url") {
      return "fetch";
    }
    if (n === "open_external") {
      return "open";
    }
    if (
      n === "vision" ||
      n === "inspect_images" ||
      n === "vision_attached_screenshot" ||
      n === "vision_page_url" ||
      n === "vision_figma_screenshot" ||
      n === "vision_page_screenshot"
    ) {
      return "vision";
    }
    if (n === "screenshot_plan_explore" || n === "delegate_task") {
      return "explore";
    }
    if (n === "spawn_agent" || n.startsWith("subagent_")) {
      return "explore";
    }
    if (n === "ask_question") {
      return "open";
    }
    if (n.startsWith("mcp__")) {
      return "mcp";
    }
    return n ? "tool" : "";
  }

  function toolKindLabel(kind) {
    switch (kind) {
      case "read":
        return t("toolKindRead");
      case "list":
        return t("toolKindList");
      case "write":
        return t("toolKindWrite");
      case "replace":
        return t("toolKindReplace");
      case "run":
        return t("toolKindRun");
      case "fetch":
        return t("toolKindFetch");
      case "open":
        return t("toolKindOpen");
      case "mcp":
        return t("toolKindMcp");
      case "vision":
        return t("toolKindVision");
      case "explore":
        return t("toolKindExplore");
      case "search":
        return t("toolKindSearch");
      default:
        return t("toolKindTool");
    }
  }

  function toolWorkingLabel(kind) {
    switch (kind) {
      case "read":
        return t("toolReading");
      case "list":
        return t("toolListing");
      case "write":
      case "replace":
        return t("toolWriting");
      case "run":
        return t("toolRunning");
      case "fetch":
        return t("toolFetching");
      case "open":
        return t("toolOpening");
      case "mcp":
        return t("toolMcp");
      case "vision":
        return t("toolVision");
      case "explore":
        return t("toolExploring");
      case "search":
        return t("toolSearching");
      default:
        return t("toolWorking");
    }
  }

  function toolTypeLabels(group) {
    const counts = new Map();
    for (const el of group.querySelectorAll(".msg.tool")) {
      if (el.classList.contains("agent-step")) {
        const stepKind = el.dataset.stepKind || "";
        if (stepKind && stepKind !== "tool") {
          continue;
        }
      }
      const name = el.dataset.toolName || parseToolName(el.dataset.raw || "");
      const kind = toolKind(name) || "tool";
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    const order = [
      "vision",
      "read",
      "search",
      "list",
      "write",
      "replace",
      "run",
      "fetch",
      "open",
      "mcp",
      "explore",
    ];
    const parts = [];
    for (const kind of order) {
      const n = counts.get(kind);
      if (!n) {
        continue;
      }
      if (kind === "read") {
        parts.push(t("toolFiles", n));
        continue;
      }
      parts.push(t("toolTypeCount", toolKindLabel(kind), n));
    }
    for (const [kind, n] of counts) {
      if (!order.includes(kind) && n) {
        parts.push(t("toolTypeCount", toolKindLabel(kind), n));
      }
    }
    return parts;
  }

  function toolTypesSummary(group) {
    return toolTypeLabels(group).join(" · ");
  }

  /** Count timeline steps: tools + thinking + compaction/retry (not text deltas). */
  function countAgentSteps(group) {
    if (!group) {
      return 0;
    }
    let n = 0;
    for (const el of group.querySelectorAll(".msg.tool")) {
      if (el.classList.contains("agent-step")) {
        const kind = el.dataset.stepKind || "";
        if (kind === "text") {
          continue;
        }
        n += 1;
        continue;
      }
      n += 1;
    }
    return n;
  }

  function stepsCountLabel(n) {
    if (n <= 0) {
      return "";
    }
    if (n === 1) {
      return t("stepsOne");
    }
    return t("stepsMany")(n);
  }

  function timelineLooksLikeTransportFailure(group) {
    if (!group) {
      return false;
    }
    const body = group.querySelector(".tool-group-body");
    const steps = agentStepsInBody(body);
    if (!steps.length) {
      return false;
    }
    return steps.some((el) => {
      if (el.dataset.stepKind !== "retry") {
        return false;
      }
      const label = String(
        el.querySelector(".agent-step-label")?.textContent ||
          el.dataset.raw ||
          ""
      );
      return /API\s*5\d\d\b|Internal Server Error|ECONNRESET|fetch failed/i.test(
        label
      );
    });
  }

  function markFailedToolGroups() {
    for (const group of messagesEl.querySelectorAll(
      ".tool-group.agent-timeline"
    )) {
      if (!timelineLooksLikeTransportFailure(group)) {
        continue;
      }
      const summary = group.querySelector(".tool-group-summary");
      if (summary) {
        summary.textContent = t("runFailedSummary");
      }
      group.dataset.failed = "1";
    }
  }

  /**
   * End a failed run in the live UI: seal «Работаю…», show error bubble, clear busy.
   * Idempotent — safe if host also sent append/idle.
   */
  function finishRunWithError(text, detail) {
    const msg = String(text || "").trim();
    const full = String(detail || "").trim();
    sealToolGroups();
    markFailedToolGroups();
    if (msg) {
      const last = uiMessagesCache[uiMessagesCache.length - 1];
      const same =
        last &&
        last.role === "error" &&
        String(last.text || "") === msg &&
        String(last.detail || "") === full;
      if (!same) {
        uiMessagesCache.push({
          role: "error",
          text: msg,
          ...(full ? { detail: full } : {}),
        });
        appendMessage(
          "error",
          msg,
          uiMessagesCache.length - 1,
          -1,
          undefined,
          true,
          undefined,
          undefined,
          full || undefined
        );
      }
    }
    setAgentStatus("", true);
    setIdleAndDrain();
    scrollToBottom();
  }

  function sealToolGroups() {
    for (const group of messagesEl.querySelectorAll(
      ".tool-group:not([data-sealed])"
    )) {
      if (countAgentSteps(group) === 0) {
        group.remove();
        continue;
      }
      dedupeThinkingSteps(group);
      dropPlaceholderThinkingSteps(group);
      if (countAgentSteps(group) === 0) {
        group.remove();
        continue;
      }
      group.dataset.sealed = "1";
      dropRawToolRows(group);
      // Collapse the whole work timeline into a single header («N шагов»).
      group.classList.add("is-collapsed");
      const toggle = group.querySelector(".tool-group-toggle");
      if (toggle) {
        toggle.hidden = false;
        toggle.setAttribute("aria-expanded", "false");
      }
      if (timelineLooksLikeTransportFailure(group)) {
        const summary = group.querySelector(".tool-group-summary");
        if (summary) {
          summary.textContent = t("runFailedSummary");
        }
        group.dataset.failed = "1";
      } else {
        updateToolGroupSummary(group);
      }
      // Auto-collapse long Thinking blocks once the turn advances to tools/text.
      collapseLongThinkingSteps(group);
    }
    // Legacy separate reasoning blocks: drop if timeline already has thinking,
    // or if the legacy block itself never received real reasoning content.
    for (const group of messagesEl.querySelectorAll(
      ".reasoning-group:not([data-sealed])"
    )) {
      const turn = group.closest(".chat-turn") || messagesEl;
      const timeline = turn.querySelector(
        ".tool-group.agent-timeline .agent-step[data-step-kind='thinking']"
      );
      if (timeline) {
        group.remove();
        continue;
      }
      const legacyRaw = String(group.dataset.raw || "").trim();
      if (!legacyRaw || isThinkingPlaceholder(legacyRaw)) {
        group.remove();
        continue;
      }
      group.dataset.sealed = "1";
      updateReasoningGroupSummary(group);
    }
    // Merge leftover duplicate timelines / identical Thinking in the same turn.
    collapseTurnThinkingDuplicates();
  }

  function normalizeThinkingKey(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function thinkingStepsIn(scope) {
    if (!scope) {
      return [];
    }
    return [...scope.querySelectorAll(".agent-step[data-step-kind='thinking']")];
  }

  function agentStepsInBody(body) {
    if (!body) {
      return [];
    }
    return [...body.children].filter(
      (el) => el.classList && el.classList.contains("agent-step")
    );
  }

  /** Drop identical Thinking cards across the whole turn (keep first). */
  function collapseTurnThinkingDuplicates() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
    const seen = new Set();
    for (const el of thinkingStepsIn(turn)) {
      const key = normalizeThinkingKey(el.dataset.raw);
      if (!key || isThinkingPlaceholder(key)) {
        continue;
      }
      if (seen.has(key)) {
        el.remove();
      } else {
        seen.add(key);
      }
    }
    // Also merge leftover empty / duplicate timeline groups.
    dedupeTurnTimelines();
  }

  function dedupeThinkingSteps(group) {
    if (!group) {
      return;
    }
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return;
    }
    const seenThinking = new Set();
    for (const el of agentStepsInBody(body)) {
      if (el.dataset.stepKind !== "thinking") {
        continue;
      }
      const key = normalizeThinkingKey(el.dataset.raw);
      if (!key || isThinkingPlaceholder(key)) {
        continue;
      }
      if (seenThinking.has(key)) {
        el.remove();
      } else {
        seenThinking.add(key);
      }
    }
  }

  /**
   * Drop Thinking steps that never received real reasoning content (still on
   * the «Thinking…» / «Continuing…» placeholder). At seal time the turn is
   * complete — if real reasoning had been streamed, it would have replaced the
   * placeholder during streaming. A placeholder at seal means no reasoning was
   * produced, so we remove it when the turn has other real content (assistant
   * text in .msg-wrap-assistant, tool/compaction/retry steps, or non-placeholder
   * thinking). Text answer lives outside the tool-group (.msg-wrap-assistant),
   * so we check the parent .chat-turn too. Fixes the empty Thinking card shown
   * for models that don't stream reasoning_content (e.g. Qwen3-Coder-Next).
   */
  function dropPlaceholderThinkingSteps(group) {
    if (!group) {
      return;
    }
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return;
    }
    const steps = agentStepsInBody(body);
    const thinkingSteps = steps.filter(
      (el) => el.dataset.stepKind === "thinking"
    );
    if (!thinkingSteps.length) {
      return;
    }
    // Non-placeholder thinking or non-thinking steps (tools/compaction/retry)
    // inside the timeline count as real content.
    const hasRealInGroup =
      thinkingSteps.some((el) => !isThinkingPlaceholder(el.dataset.raw)) ||
      steps.some((el) => el.dataset.stepKind !== "thinking");
    // Assistant text answer lives in .msg-wrap-assistant (outside the tool-group),
    // so check the parent .chat-turn. Covers both committed and streaming text.
    const turn = group.closest(".chat-turn") || messagesEl;
    const hasAssistantText = Boolean(
      [...turn.querySelectorAll(".msg-wrap-assistant .msg")].some(
        (el) => String(el.dataset.raw || "").trim()
      )
    );
    if (!hasRealInGroup && !hasAssistantText) {
      return;
    }
    for (const el of thinkingSteps) {
      if (isThinkingPlaceholder(el.dataset.raw)) {
        el.remove();
      }
    }
  }

  /**
   * Clean placeholder-only Thinking cards from ALREADY-SEALED groups in the
   * current turn. sealToolGroups() runs inside appendMessage BEFORE the
   * assistant text element is appended to the DOM, so dropPlaceholderThinkingSteps
   * can't see the text at seal time. This second pass runs after the text is in
   * the DOM and removes placeholders that should have been dropped at seal.
   */
  function cleanSealedThinkingPlaceholders() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    if (!turn) {
      return;
    }
    const hasAssistantText = Boolean(
      [...turn.querySelectorAll(".msg-wrap-assistant .msg")].some(
        (el) => String(el.dataset.raw || "").trim()
      )
    );
    if (!hasAssistantText) {
      return;
    }
    for (const group of turn.querySelectorAll(
      ".tool-group.agent-timeline[data-sealed='1']"
    )) {
      const body = group.querySelector(".tool-group-body");
      if (!body) {
        continue;
      }
      const thinkingSteps = [
        ...body.querySelectorAll(
          ".agent-step[data-step-kind='thinking']"
        ),
      ];
      if (!thinkingSteps.length) {
        continue;
      }
      const hasRealInGroup =
        thinkingSteps.some((el) => !isThinkingPlaceholder(el.dataset.raw)) ||
        Boolean(
          body.querySelector(
            ".agent-step:not([data-step-kind='thinking'])"
          )
        );
      // Remove placeholder thinking steps regardless of whether the group
      // has other real content (tools, non-placeholder thinking). The
      // placeholder means no reasoning was streamed for that round — it
      // should not stay visible next to tool calls or the final answer.
      void hasRealInGroup;
      for (const el of thinkingSteps) {
        if (isThinkingPlaceholder(el.dataset.raw)) {
          el.remove();
        }
      }
      if (countAgentSteps(group) === 0) {
        group.remove();
      }
    }
  }

  function findTurnThinkingByText(text) {
    const key = normalizeThinkingKey(text);
    if (!key || isThinkingPlaceholder(key)) {
      return null;
    }
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
    for (const el of thinkingStepsIn(turn)) {
      if (normalizeThinkingKey(el.dataset.raw) === key) {
        return el;
      }
    }
    return null;
  }

  function findLatestTurnThinking() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
    const all = thinkingStepsIn(turn);
    return all.length ? all[all.length - 1] : null;
  }

  /** True if a committed (non-queued) tool appears after `el` in the turn. */
  function hasCommittedToolAfter(el) {
    if (!el) {
      return false;
    }
    const turn = el.closest(".chat-turn") || messagesEl;
    const steps = [...turn.querySelectorAll(".agent-step")];
    const ix = steps.indexOf(el);
    if (ix < 0) {
      return false;
    }
    for (let i = ix + 1; i < steps.length; i += 1) {
      if (
        steps[i].dataset.stepKind === "tool" &&
        steps[i].dataset.status &&
        steps[i].dataset.status !== "queued"
      ) {
        return true;
      }
    }
    return false;
  }

  function dedupeTurnTimelines() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    if (!turn) {
      return;
    }
    const groups = [...turn.querySelectorAll(".tool-group.agent-timeline")];
    if (groups.length < 2) {
      return;
    }
    const primary = groups[0];
    const primaryBody = primary.querySelector(".tool-group-body");
    if (!primaryBody) {
      return;
    }
    const known = new Set(
      [...primaryBody.querySelectorAll(".agent-step[data-step-kind='thinking']")].map(
        (el) => normalizeThinkingKey(el.dataset.raw)
      )
    );
    for (let i = 1; i < groups.length; i += 1) {
      const body = groups[i].querySelector(".tool-group-body");
      if (!body) {
        groups[i].remove();
        continue;
      }
      for (const el of agentStepsInBody(body)) {
        if (el.dataset.stepKind === "thinking") {
          const key = normalizeThinkingKey(el.dataset.raw);
          if (key && known.has(key)) {
            el.remove();
            continue;
          }
          if (key) {
            known.add(key);
          }
        }
        primaryBody.appendChild(el);
      }
      groups[i].remove();
    }
    dedupeThinkingSteps(primary);
  }

  function updateReasoningGroupSummary(group) {
    if (!group) {
      return;
    }
    const summary = group.querySelector(".reasoning-group-summary");
    const raw = String(group.dataset.raw || "").trim();
    if (summary) {
      summary.textContent = raw ? t("thinkingLabel") : t("thinkingWorking");
    }
    group.title = "";
    const toggle = group.querySelector(".reasoning-group-toggle");
    if (toggle) {
      toggle.title = group.classList.contains("is-collapsed")
        ? t("showThinking")
        : t("hideThinking");
    }
  }

  function createReasoningGroup() {
    const group = document.createElement("div");
    group.className = "reasoning-group is-collapsed";
    group.innerHTML =
      `<button type="button" class="reasoning-group-toggle" aria-expanded="false">` +
      `<span class="material-symbols-outlined reasoning-group-chevron" aria-hidden="true">expand_more</span>` +
      `<span class="material-symbols-outlined reasoning-group-icon" aria-hidden="true">psychology</span>` +
      `<span class="reasoning-group-summary">${escapeHtml(t("thinkingWorking"))}</span>` +
      `</button>` +
      `<div class="reasoning-group-body"><div class="reasoning-text"></div></div>`;
    return group;
  }

  function getActiveReasoningGroup() {
    return null;
  }

  function ensureActiveReasoningGroup() {
    return null;
  }

  function isThinkingPlaceholder(text) {
    const raw = String(text || "").trim();
    return (
      !raw ||
      raw === "Thinking…" ||
      raw === "Thinking..." ||
      raw === "Planning…" ||
      raw === "Planning..." ||
      raw === "Reviewing…" ||
      raw === "Reviewing..." ||
      raw === "Reason…" ||
      raw === "Reason..." ||
      raw === "Thoughts…" ||
      raw === "Thoughts..." ||
      raw === "Разум…" ||
      raw === "Разум..." ||
      raw === "Мысли…" ||
      raw === "Мысли..." ||
      raw === "Думаю…" ||
      raw === "Думаю..." ||
      raw === "Планирую…" ||
      raw === "Планирую..." ||
      raw === "Изучаю…" ||
      raw === "Изучаю..." ||
      raw === "Continuing…" ||
      raw === "Continuing..."
    );
  }

  /**
   * Reasoning goes into the unified timeline (Zed-like), not a separate card.
   */
  function upsertReasoning(text, options = {}) {
    const raw = String(text || "").trim();
    if (!raw) {
      return null;
    }
    return upsertAgentStep({
      stepId: options.stepId || "thinking-live",
      kind: "thinking",
      text: raw,
    });
  }

  function clearStoppedRunArtifacts() {
    if (streamingEl) {
      const wrap = streamingEl.closest(".msg-wrap-assistant");
      (wrap || streamingEl).remove();
      streamingEl = null;
    }
    streamingRenderScheduled = false;

    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    if (turn) {
      for (const group of turn.querySelectorAll(".tool-group")) {
        group.remove();
      }
      for (const group of turn.querySelectorAll(".reasoning-group")) {
        group.remove();
      }
    } else {
      // Fallback для старой/восстановленной разметки: незапечатанная группа
      // всегда относится к текущему незавершённому запуску.
      for (const group of messagesEl.querySelectorAll(
        ".tool-group:not([data-sealed])"
      )) {
        group.remove();
      }
      for (const group of messagesEl.querySelectorAll(
        ".reasoning-group:not([data-sealed])"
      )) {
        group.remove();
      }
    }

    while (
      uiMessagesCache.length &&
      uiMessagesCache[uiMessagesCache.length - 1]?.role === "tool"
    ) {
      uiMessagesCache.pop();
    }

    // Stop button: the host may not succeed in re-posting the todo card with
    // an "error" status (postToRunChat is gated on isChatRunCurrent, which is
    // false after abort). As a client-side fallback, force any still-running
    // todo plan cards into a cancelled state so the header spinner and the
    // in_progress item spinners stop immediately.
    cancelRunningTodoPlans();
  }

  /**
   * Force every visible todo plan card that's still "running" into a
   * cancelled/error state. Recovers the step list from the rendered item DOM
   * (data attributes) so it doesn't depend on the host re-posting anything.
   */
  function cancelRunningTodoPlans() {
    const cards = messagesEl.querySelectorAll(
      '.agent-step-todo[data-status="running"]'
    );
    if (!cards.length) {
      return;
    }
    const cancelledText = t("cancelledByUser") || "Cancelled by user";
    for (const el of cards) {
      // Rebuild steps[] from rendered item DOM: data-todo-status / title.
      const items = el.querySelectorAll(".todo-plan-item");
      const steps = [];
      items.forEach((row) => {
        const titleEl = row.querySelector(".todo-plan-item-title");
        const rawStatus =
          row.getAttribute("data-todo-status") || "pending";
        const status =
          rawStatus === "done"
            ? "done"
            : rawStatus === "in_progress"
              ? "pending" // turn the in_progress one into pending on cancel
              : "pending";
        steps.push({
          title: titleEl ? titleEl.textContent || "" : "",
          status,
        });
      });
      el.dataset.status = "error";
      el.dataset.cancelled = "1";
      renderTodoStep(el, {
        stepId: el.getAttribute("data-step-id") || "",
        kind: "todo",
        name: "update_todo",
        status: "error",
        steps,
        resultPreview: cancelledText,
      });
    }
  }

  /**
   * When the assistant finishes successfully without a final update_todo call
   * that marks every step "done", auto-complete any still-running todo plan
   * cards so the user sees a finished checklist instead of a stuck spinner.
   */
  function completeRunningTodoPlans() {
    const cards = messagesEl.querySelectorAll(
      '.agent-step-todo[data-status="running"]'
    );
    if (!cards.length) {
      return;
    }
    for (const el of cards) {
      const items = el.querySelectorAll(".todo-plan-item");
      const steps = [];
      items.forEach((row) => {
        const titleEl = row.querySelector(".todo-plan-item-title");
        steps.push({
          title: titleEl ? titleEl.textContent || "" : "",
          status: "done",
        });
      });
      el.dataset.status = "done";
      el.dataset.todoOpen = "0";
      renderTodoStep(el, {
        stepId: el.getAttribute("data-step-id") || "",
        kind: "todo",
        name: "update_todo",
        status: "done",
        steps,
      });
    }
  }

  function toolGroupHasContent(group) {
    const body = group?.querySelector(".tool-group-body");
    if (!body) {
      return false;
    }
    for (const el of agentStepsInBody(body)) {
      const kind = el.dataset.stepKind || "";
      if (kind === "text") {
        continue;
      }
      if (kind === "thinking") {
        if (!isThinkingPlaceholder(el.dataset.raw)) {
          return true;
        }
        continue;
      }
      return true;
    }
    return Boolean(body.querySelector(".msg.tool:not(.agent-step)"));
  }

  function updateToolGroupSummary(group) {
    if (!group) {
      return;
    }
    const hasSteps = toolGroupHasContent(group);
    group.classList.toggle("has-steps", hasSteps);
    const toggle = group.querySelector(".tool-group-toggle");
    const chevron = group.querySelector(".tool-group-chevron");
    if (toggle) {
      toggle.hidden = false;
      toggle.disabled = !hasSteps;
      toggle.setAttribute(
        "aria-expanded",
        hasSteps && !group.classList.contains("is-collapsed")
          ? "true"
          : "false"
      );
    }
    if (chevron) {
      chevron.hidden = !hasSteps;
    }
    const summary = group.querySelector(".tool-group-summary");
    if (summary) {
      const types = toolTypesSummary(group);
      const base = group.dataset.failed === "1"
        ? t("runFailedSummary")
        : group.dataset.sealed === "1"
          ? t("runDone")
          : t("runWorking");
      summary.textContent = types ? `${base} · ${types}` : base;
    }
    if (toggle) {
      toggle.title = !hasSteps
        ? ""
        : group.classList.contains("is-collapsed")
          ? t("showSteps")
          : t("hideSteps");
    }
  }

  function createToolGroup() {
    const group = document.createElement("div");
    group.className = "tool-group agent-timeline is-collapsed";
    group.innerHTML =
      `<button type="button" class="tool-group-toggle" aria-expanded="false" disabled>` +
      `<span class="tool-group-summary">${escapeHtml(t("runWorking"))}</span>` +
      `<span class="material-symbols-outlined tool-group-chevron" aria-hidden="true" hidden>expand_more</span>` +
      `</button>` +
      `<div class="tool-group-body agent-timeline-body"></div>`;
    return group;
  }

  function getActiveToolGroup() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    const scope = turn || messagesEl;
    // Keep one open timeline for the turn even if assistant stream
    // was inserted after it (otherwise we spawn a second «Работаю…»).
    const open = scope.querySelectorAll(".tool-group:not([data-sealed])");
    if (open.length > 0) {
      return open[open.length - 1];
    }
    return null;
  }

  /** Latest thinking step after the last committed tool in this timeline body. */
  function findOpenThinkingStep(body) {
    if (!body) {
      return null;
    }
    const steps = agentStepsInBody(body);
    let lastToolIx = -1;
    for (let i = 0; i < steps.length; i += 1) {
      // Early stream "queued" tools must not open a new Thinking phase —
      // the model often abandons them and only answers in text.
      if (
        steps[i].dataset.stepKind === "tool" &&
        steps[i].dataset.status &&
        steps[i].dataset.status !== "queued"
      ) {
        lastToolIx = i;
      }
    }
    for (let i = steps.length - 1; i > lastToolIx; i -= 1) {
      if (steps[i].dataset.stepKind === "thinking") {
        return steps[i];
      }
    }
    return null;
  }

  function ensureActiveToolGroup() {
    const existing = getActiveToolGroup();
    if (existing) {
      return existing;
    }
    // Always start collapsed; user can expand via the toggle. Summary still
    // updates with the current step while the run is live.
    const group = createToolGroup();
    ensureChatTurn().appendChild(group);
    keepStatusAtEnd();
    return group;
  }

  function agentStepStatusIcon(status, kind) {
    if (kind === "thinking") {
      return "psychology";
    }
    if (kind === "compaction") {
      return "compress";
    }
    if (kind === "checkpoint") {
      return "restore";
    }
    if (kind === "retry") {
      return "replay";
    }
    if (kind === "todo") {
      return "checklist";
    }
    if (kind === "tool" || !kind) {
      const nameHint = "";
      void nameHint;
    }
    if (status === "done") {
      return "check";
    }
    if (status === "error") {
      return "error";
    }
    if (status === "running") {
      return "progress_activity";
    }
    if (status === "queued") {
      return "schedule";
    }
    return "info";
  }

  function toolStepIcon(name, status) {
    if (status === "error") {
      return "error";
    }
    // Type icon stays after done — option C rows, not checkmarks.
    const toolName = canonicalToolName(name);
    switch (toolName) {
      case "read_files":
        return "draft";
      case "list_files":
        return "folder_open";
      case "editor":
      case "apply_patch":
        return "edit";
      case "run_commands":
        return "terminal";
      case "search_codebase":
        return "search";
      case "fetch_web_content":
      case "fetch_url":
      case "open_external":
      case "screenshot_url":
        return "link";
      case "browser_navigate":
      case "browser_snapshot":
      case "browser_click":
      case "browser_type":
      case "browser_close":
        return "web";
      case "get_diagnostics":
        return "bug_report";
      case "ask_question":
        return "help";
      case "submit_and_exit":
        return "check_circle";
      case "skills":
        return "bolt";
      case "spawn_agent":
        return "account_tree";
      default:
        if (toolName.startsWith("mcp__")) {
          return "extension";
        }
        if (toolName.startsWith("subagent_")) {
          return "account_tree";
        }
        return status === "queued" ? "schedule" : "build";
    }
  }

  /**
   * Intermediate assistant text (a completed text block from an earlier
   * model round of this turn). Rendered as a muted markdown card INSIDE the
   * collapsed tool group so the finale-only bubble does not wipe mid-turn
   * lists / answers the model keeps referring to.
   */
  function upsertTextBlockStep(step) {
    const raw = String(step.text || "").trim();
    if (!raw) {
      return null;
    }
    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return null;
    }
    const stepId = String(step.stepId || "");
    let el = body.querySelector(
      `.agent-step[data-step-id="${stepId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
    );
    if (!el) {
      el = document.createElement("div");
      el.className = "msg tool agent-step";
      el.dataset.stepId = stepId;
      body.appendChild(el);
    }
    el.dataset.stepKind = "text";
    el.dataset.status = "done";
    el.classList.add("agent-step-text");
    el.innerHTML =
      `<div class="agent-step-head">` +
      `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">subject</span>` +
      `<span class="agent-step-label">${escapeHtml(t("textStepLabel"))}</span>` +
      `</div>` +
      `<div class="agent-step-text-body">${renderInlineMarkdown(raw)}</div>`;
    keepStatusAtEnd();
    scrollToBottom();
    return el;
  }

  function upsertAgentStep(step) {
    if (!step || !step.stepId) {
      return null;
    }
    if (step.kind === "text") {
      return upsertTextBlockStep(step);
    }

    // Plan card (update_todo) lives OUTSIDE the collapsed tool group — it must
    // stay visible while the steps timeline is folded. Upsert into the turn.
    if (step.kind === "todo") {
      const turnScope = currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : messagesEl;
      const todoSel = `.agent-step[data-step-id="${String(step.stepId).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      let todoEl = turnScope.querySelector(todoSel);
      // No tasks → no plan card. Avoids an empty «План» placeholder
      // (e.g. a failed update_todo that carried no step items).
      const todoSteps = Array.isArray(step.steps) ? step.steps : [];
      if (todoSteps.length === 0) {
        if (todoEl) {
          todoEl.remove();
        }
        return null;
      }
      if (!todoEl) {
        todoEl = document.createElement("div");
        todoEl.className = "msg tool agent-step";
        todoEl.dataset.stepId = step.stepId;
        ensureChatTurn().appendChild(todoEl);
      }
      // A plan card cancelled by Stop must not be revived by a late/queued
      // "step" message still in the host pipe after the abort.
      if (todoEl.dataset.cancelled === "1") {
        return todoEl;
      }
      todoEl.dataset.stepKind = "todo";
      if (step.status) {
        todoEl.dataset.status = step.status;
      }
      todoEl.classList.add("agent-step-todo");
      renderTodoStep(todoEl, step);
      // Pin the plan card right under the user's prompt, above the step /
      // thinking timeline, regardless of the order events arrive in.
      positionTodoPlanAfterUser(turnScope, todoEl);
      keepStatusAtEnd();
      scrollToBottom();
      return todoEl;
    }

    // Thinking: resolve target node BEFORE opening a new timeline group.
    if (step.kind === "thinking") {
      const incoming = String(step.text || "").trim();
      const incomingKey = normalizeThinkingKey(incoming);

      // Same text already on screen → update that card, never clone.
      const sameText = findTurnThinkingByText(incoming);
      if (sameText) {
        sameText.dataset.stepId = step.stepId;
        renderThinkingStep(sameText, incoming);
        collapseTurnThinkingDuplicates();
        keepStatusAtEnd();
        scrollToBottom();
        return sameText;
      }

      // Reuse latest Thinking when still in the same phase (no committed tool after it).
      const latest = findLatestTurnThinking();
      if (latest && !hasCommittedToolAfter(latest)) {
        latest.dataset.stepId = step.stepId;
        renderThinkingStep(latest, incoming);
        collapseTurnThinkingDuplicates();
        keepStatusAtEnd();
        scrollToBottom();
        return latest;
      }
    }

    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    if (!body) {
      return null;
    }

    let el = body.querySelector(
      `.agent-step[data-step-id="${String(step.stepId).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
    );

    if (!el && step.kind === "tool") {
      const key = toolStepMatchKey(step.name, step.argsPreview, "");
      const match = findMatchingToolStep(body, key);
      if (match && String(match.dataset.stepId || "").startsWith("tool-text-")) {
        el = match;
        el.dataset.stepId = step.stepId;
      }
    }

    if (step.kind === "thinking") {
      const openThinking = findOpenThinkingStep(body);
      if (openThinking) {
        el = openThinking;
        el.dataset.stepId = step.stepId;
      } else if (!el) {
        el = document.createElement("div");
        el.className = "msg tool agent-step";
        el.dataset.stepId = step.stepId;
        body.appendChild(el);
      }
    } else if (!el) {
      el = document.createElement("div");
      el.className = "msg tool agent-step";
      el.dataset.stepId = step.stepId;
      body.appendChild(el);
    }
    el.dataset.stepKind = step.kind || "tool";
    if (step.status) {
      el.dataset.status = step.status;
    }
    if (step.name) {
      el.dataset.toolName = step.name;
    }
    if (step.kind === "tool") {
      el.dataset.toolMatchKey = toolStepMatchKey(
        step.name,
        step.argsPreview,
        // Same label the "⚙ name(args)" text line derives its key from —
        // without it url/skill/mcp tools get an empty key and never merge
        // with their text twin.
        formatToolHumanLabel(
          step.name,
          step.argsPreview,
          step.metrics,
          step.status,
          step.resultPreview || ""
        )
      );
    }

    if (step.kind === "thinking") {
      renderThinkingStep(el, String(step.text || "").trim());
      collapseTurnThinkingDuplicates();
    } else if (step.kind === "tool") {
      el.classList.remove("agent-step-thinking");
      if (step.resultPreview) {
        el.dataset.resultPreview = String(step.resultPreview);
      }
      const icon = toolStepIcon(step.name, step.status);
      el.innerHTML =
        `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">${icon}</span>` +
        `<span class="agent-step-label"></span>`;
      const labelEl = el.querySelector(".agent-step-label");
      if (labelEl) {
        const toolName = String(step.name || "");
        const isSpawn =
          toolName === "spawn_agent" || toolName.startsWith("subagent_");
        if (isSpawn && step.status === "error") {
          let task = "";
          try {
            const args = JSON.parse(String(step.argsPreview || "{}"));
            task = String(
              args.task || args.prompt || args.systemPrompt || ""
            ).trim();
          } catch {
            const m = String(step.argsPreview || "").match(
              /"task"\s*:\s*"((?:\\.|[^"\\])*)/
            );
            if (m) {
              task = m[1].replace(/\\"/g, '"');
            }
            if (!task) {
              const sp = String(step.argsPreview || "").match(
                /"systemPrompt"\s*:\s*"((?:\\.|[^"\\])*)/
              );
              if (sp) {
                task = sp[1].replace(/\\"/g, '"');
              }
            }
          }
          const short = task.length > 80 ? `${task.slice(0, 77)}…` : task;
          const title = t("toolHumanSpawn", short);
          let err = String(step.resultPreview || el.dataset.resultPreview || "")
            .replace(/^Субагент ошибка:\s*/i, "")
            .replace(/^Sub-agent error:\s*/i, "")
            .trim();
          if (err.length > 100) {
            err = `${err.slice(0, 97)}…`;
          }
          labelEl.textContent = "";
          const titleSpan = document.createElement("span");
          titleSpan.className = "agent-step-title";
          titleSpan.textContent = title;
          labelEl.appendChild(titleSpan);
          const errSpan = document.createElement("span");
          errSpan.className = "agent-step-error";
          errSpan.textContent = ` · ${t("toolSpawnError", err)}`;
          labelEl.appendChild(errSpan);
        } else {
          labelEl.textContent = formatToolHumanLabel(
            step.name,
            step.argsPreview,
            step.metrics,
            step.status,
            step.resultPreview || el.dataset.resultPreview || ""
          );
        }
      }
    } else {
      el.classList.remove("agent-step-thinking");
      const icon = agentStepStatusIcon(step.status, step.kind);
      const label =
        step.kind === "compaction"
          ? step.text || "Context compacted"
          : step.kind === "checkpoint"
            ? step.text || "Workspace checkpoint"
            : step.kind === "retry"
            ? step.text ||
              `Retry ${step.attempt || "?"}/${step.maxAttempts || "?"}`
            : step.text || step.kind || "";
      el.innerHTML =
        `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">${icon}</span>` +
        `<span class="agent-step-label"></span>`;
      const labelEl = el.querySelector(".agent-step-label");
      if (labelEl) {
        labelEl.textContent = label;
      }
    }

    if (step.kind === "checkpoint") {
      el.classList.add("agent-step-checkpoint");
      el.style.cursor = "pointer";
      el.title = t("checkpointRestore");
      if (!el.querySelector(".agent-step-checkpoint-compare")) {
        const compareBtn = document.createElement("button");
        compareBtn.type = "button";
        compareBtn.className = "agent-step-checkpoint-compare";
        compareBtn.title = t("checkpointCompare");
        compareBtn.innerHTML =
          '<span class="material-symbols-outlined" aria-hidden="true">difference</span>';
        compareBtn.onclick = (event) => {
          event.stopPropagation();
          host.postMessage({
            type: "compareCheckpoint",
            chatId: activeChatId || "",
            checkpointRunCount: Number(step.checkpointRunCount) || undefined,
          });
        };
        el.appendChild(compareBtn);
      }
      el.onclick = () => {
        if (!window.confirm(t("checkpointRestore"))) {
          return;
        }
        host.postMessage({
          type: "restoreCheckpoint",
          chatId: activeChatId || "",
          checkpointRunCount: Number(step.checkpointRunCount) || undefined,
        });
      };
    }

    updateToolGroupSummary(group);
    dropRawToolRows(group);
    keepStatusAtEnd();
    scrollToBottom();
    return el;
  }

  /**
   * Keep the update_todo plan card pinned as the first element of the turn's
   * work area — directly under the user prompt and above the tool/thinking
   * timeline. Repeated calls are safe (same-position moves are no-ops) and the
   * card is re-pinned on every update so an assistant message or tool group
   * appended later never pushes it down.
   */
  function positionTodoPlanAfterUser(turnScope, todoEl) {
    const users = turnScope.querySelectorAll(".msg-wrap-user");
    const user = users.length ? users[users.length - 1] : null;
    if (user) {
      const after = user.nextSibling;
      if (todoEl !== after) {
        turnScope.insertBefore(todoEl, after);
      }
      harborSyncTodoTop(todoEl, user);
    } else if (turnScope.firstChild !== todoEl) {
      turnScope.insertBefore(todoEl, turnScope.firstChild);
      todoEl.style.removeProperty("--harbor-todo-top");
    }
  }

  /**
   * Set --harbor-todo-top = user bubble height so the sticky todo card pins
   * directly below the (opaque, higher z-index) user message. A
   * ResizeObserver keeps the variable in sync when the bubble reflows.
   */
  function harborSyncTodoTop(todoEl, userEl) {
    if (!todoEl || !userEl) return;
    const setTop = () => {
      const h = userEl.offsetHeight || 0;
      todoEl.style.setProperty("--harbor-todo-top", h + "px");
    };
    setTop();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(setTop);
      ro.observe(userEl);
    }
  }

  /** update_todo plan card: «План · 1/4» header + collapsible step list. */
  function renderTodoStep(el, step) {
    const steps = Array.isArray(step.steps) ? step.steps : [];
    const prevOpen = el.dataset.todoOpen === "1";
    const open = prevOpen;
    const failed = String(step.status || "") === "error";

    let doneCount = 0;
    let currentTitle = "";
    for (const item of steps) {
      if (String(item.status || "") === "done") {
        doneCount += 1;
      } else if (!currentTitle && String(item.status || "") === "in_progress") {
        currentTitle = String(item.title || "");
      }
    }
    if (!currentTitle) {
      const next = steps.find(
        (item) => String(item.status || "") !== "done" && item.title
      );
      currentTitle = next ? String(next.title) : "";
    }

    const counter = steps.length ? `${doneCount}/${steps.length}` : "";
    el.dataset.todoOpen = open ? "1" : "0";

    // Full card collapse: when data-todo-card-collapsed="1", only a compact
    // chip is visible — click it to restore the card.
    const cardCollapsed = el.dataset.todoCardCollapsed === "1";
    if (cardCollapsed) {
      el.innerHTML = "";
      const chip = document.createElement("div");
      chip.className = "todo-plan-chip";
      const chipIcon = failed
        ? "error"
        : steps.length && doneCount === steps.length
          ? "check"
          : "checklist";
      chip.innerHTML =
        `<span class="material-symbols-outlined todo-plan-chip-icon" aria-hidden="true">${chipIcon}</span>` +
        `<span class="todo-plan-chip-label">${t("todoPlanTitle")}</span>` +
        (counter ? `<span class="todo-plan-chip-counter">${counter}</span>` : "");
      chip.addEventListener("click", () => {
        el.dataset.todoCardCollapsed = "0";
        renderTodoStep(el, { steps, status: step.status });
      });
      el.appendChild(chip);
      return;
    }

    const head = document.createElement("div");
    head.className = "todo-plan-head";
    const statusIcon = failed
      ? "error"
      : steps.length && doneCount === steps.length
        ? "check"
        : "checklist";
    head.innerHTML =
      `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">${statusIcon}</span>` +
      `<span class="todo-plan-title"></span>` +
      `<span class="todo-plan-counter"></span>` +
      `<span class="material-symbols-outlined todo-plan-minimize" title="Свернуть панель" aria-hidden="true">minimize</span>` +
      `<span class="material-symbols-outlined todo-plan-chevron" aria-hidden="true">${open ? "expand_less" : "expand_more"}</span>`;
    const titleEl = head.querySelector(".todo-plan-title");
    if (titleEl) {
      titleEl.textContent = t("todoPlanTitle");
    }
    const counterEl = head.querySelector(".todo-plan-counter");
    if (counterEl) {
      counterEl.textContent = counter;
    }
    head.addEventListener("click", (e) => {
      // Minimize button: collapse entire card into compact chip.
      if (e.target.closest(".todo-plan-minimize")) {
        e.stopPropagation();
        el.dataset.todoCardCollapsed = "1";
        renderTodoStep(el, { steps, status: step.status });
        return;
      }
      el.dataset.todoOpen = el.dataset.todoOpen === "1" ? "0" : "1";
      renderTodoStep(el, { steps, status: step.status });
    });

    const list = document.createElement("div");
    list.className = "todo-plan-list";
    if (!open) {
      list.setAttribute("hidden", "");
    }
    steps.forEach((item) => {
      const status = failed ? "pending" : String(item.status || "pending");
      const icon = failed
        ? "schedule"
        : status === "done"
          ? "check"
          : status === "in_progress"
            ? "progress_activity"
            : "schedule";
      const row = document.createElement("div");
      row.className = "todo-plan-item";
      row.dataset.todoStatus = status;
      row.title = t(
        status === "done"
          ? "todoPlanStepDone"
          : status === "in_progress"
            ? "todoPlanStepInProgress"
            : "todoPlanStepPending"
      );
      row.innerHTML =
        `<span class="material-symbols-outlined todo-plan-item-icon" aria-hidden="true">${icon}</span>` +
        `<span class="todo-plan-item-title"></span>`;
      const rowTitle = row.querySelector(".todo-plan-item-title");
      if (rowTitle) {
        rowTitle.textContent = String(item.title || "");
      }
      list.appendChild(row);
    });

    el.innerHTML = "";
    el.appendChild(head);
    if (!open && currentTitle) {
      const current = document.createElement("div");
      current.className = "todo-plan-current";
      current.textContent = currentTitle;
      el.appendChild(current);
    }
    if (failed && step.resultPreview) {
      const err = document.createElement("div");
      err.className = "todo-plan-error";
      err.textContent = String(step.resultPreview);
      el.appendChild(err);
    }
    el.appendChild(list);
  }

  function renderThinkingStep(el, incoming) {
    if (!el) {
      return;
    }
    const prev = String(el.dataset.raw || "").trim();
    let full =
      isThinkingPlaceholder(incoming) && prev && !isThinkingPlaceholder(prev)
        ? prev
        : incoming;
    if (
      !isThinkingPlaceholder(incoming) &&
      !isThinkingPlaceholder(prev) &&
      incoming.length < prev.length &&
      prev.startsWith(incoming)
    ) {
      full = prev;
    } else if (
      !isThinkingPlaceholder(incoming) &&
      !isThinkingPlaceholder(prev) &&
      prev.length < incoming.length &&
      incoming.startsWith(prev)
    ) {
      full = incoming;
    } else if (
      !isThinkingPlaceholder(incoming) &&
      !isThinkingPlaceholder(prev) &&
      incoming === prev
    ) {
      full = prev;
    }
    el.dataset.stepKind = "thinking";
    el.dataset.raw = full;
    el.classList.add("agent-step-thinking");
    const userOpened = el.dataset.thinkingOpen === "1";
    el.innerHTML =
      `<div class="agent-step-head">` +
      `<span class="material-symbols-outlined agent-step-icon" aria-hidden="true">psychology</span>` +
      `<span class="agent-step-label">${escapeHtml(t("thinkingLabel"))}</span>` +
      `<button type="button" class="agent-step-thinking-toggle" hidden>` +
      `<span class="agent-step-thinking-toggle-label"></span>` +
      `</button>` +
      `</div>` +
      `<div class="agent-step-thinking-text"></div>`;
    const textEl = el.querySelector(".agent-step-thinking-text");
    if (textEl) {
      textEl.textContent = isThinkingPlaceholder(full) ? "" : full;
    }
    if (userOpened) {
      el.dataset.thinkingOpen = "1";
    }
    updateThinkingCollapse(el, full);
  }

  /** Thoughts stay a plain row; full text only after «Показать мысли». */
  function updateThinkingCollapse(el, text) {
    const toggle = el.querySelector(".agent-step-thinking-toggle");
    const toggleLabel = el.querySelector(
      ".agent-step-thinking-toggle-label"
    );
    if (!toggle || !toggleLabel) {
      return;
    }
    const raw = String(text || "").trim();
    const isPlaceholder = !raw || isThinkingPlaceholder(raw);
    if (isPlaceholder) {
      el.classList.add("is-thinking-collapsed");
      toggle.hidden = true;
      return;
    }
    const open = el.dataset.thinkingOpen === "1";
    el.classList.toggle("is-thinking-collapsed", !open);
    toggle.hidden = false;
    toggleLabel.textContent = open ? t("hideThinking") : t("showThinking");
    toggle.setAttribute("aria-expanded", String(open));
  }

  /** Collapse thinking rows when the turn seals (unless the user opened one). */
  function collapseLongThinkingSteps(scope) {
    const root = scope || messagesEl;
    for (const el of root.querySelectorAll(
      ".agent-step[data-step-kind='thinking']"
    )) {
      if (el.dataset.thinkingOpen === "1") {
        continue;
      }
      const raw = String(el.dataset.raw || "").trim();
      if (raw && !isThinkingPlaceholder(raw)) {
        el.classList.add("is-thinking-collapsed");
        updateThinkingCollapse(el, raw);
      }
    }
  }

  function findMatchingToolStep(body, key) {
    if (!body || !key || key.endsWith("::")) {
      return null;
    }
    for (const el of body.querySelectorAll(
      ".agent-step[data-step-kind='tool']"
    )) {
      if (el.dataset.toolMatchKey === key) {
        return el;
      }
    }
    return null;
  }

  function dropRawToolRows(group) {
    const body = group?.querySelector(".tool-group-body");
    if (!body) {
      return;
    }
    for (const el of [...body.querySelectorAll(".msg.tool:not(.agent-step)")]) {
      el.remove();
    }
  }

  function appendToolToGroup(text, index, step) {
    if (step && step.stepId) {
      const el = upsertAgentStep(step);
      if (el && typeof index === "number") {
        el.dataset.index = String(index);
      }
      dropRawToolRows(el?.closest(".tool-group"));
      return el;
    }
    const toolName = parseToolName(text);
    const argsPreview = argsPreviewFromToolText(text);
    const key = toolStepMatchKey(toolName, argsPreview, formatToolLine(text));
    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    const existing = findMatchingToolStep(body, key);
    if (existing) {
      if (typeof index === "number") {
        existing.dataset.index = String(index);
      }
      dropRawToolRows(group);
      return existing;
    }
    const el = upsertAgentStep({
      stepId: `tool-text-${index ?? Date.now()}`,
      kind: "tool",
      name: toolName,
      argsPreview,
      status: "done",
    });
    if (el && typeof index === "number") {
      el.dataset.index = String(index);
    }
    dropRawToolRows(group);
    return el;
  }

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
      statusUrl: provider.statusUrl || "",
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
    const next = { id, name: name || id, baseUrl, apiKey };
    settingsProviders.push(next);
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
    const next = { id, name: name || id, baseUrl, apiKey };
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
    renderSettingsProviders();
    renderSettingsModels();
    fillModelProviderSelect(modelEditProvider?.value || "");
    schedulePersistSettings(0);
  }

  function renderSettingsProviders() {
    renderSettingsCatalog();
  }

  function appendProviderHead(listEl, provider, index) {
    const row = document.createElement("div");
    row.className = "settings-provider-head";
    row.dataset.providerIndex = String(index);
    const providerId = String(provider.id || "").trim();
    if (providerId) {
      row.dataset.providerId = providerId;
    }
    const title = provider.name || provider.id || t("providerTitle");
    row.innerHTML =
      `<div class="settings-model-info">` +
      `<div class="settings-model-name">` +
      `<span class="provider-status-dot" data-state="unknown" aria-hidden="true"></span>` +
      `<span class="provider-status-title"></span>` +
      `<span class="provider-status-text" data-state="unknown"></span>` +
      `</div>` +
      `<div class="settings-model-id"></div>` +
      `</div>` +
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

  function renderSettingsCatalog() {
    if (!settingsModelsList) {
      return;
    }
    hideSettingsModelTip();
    sortSettingsModels();
    settingsModelsList.innerHTML = "";
    if (!settingsProviders.length && !settingsModels.length) {
      settingsModelsList.innerHTML =
        `<div class="settings-models-empty">${t("noProvidersOrModels")}</div>`;
      syncDefaultModelSelect();
      return;
    }

    const used = new Set();

    const appendModels = (entries, nested, parentEl) => {
      const target = parentEl || settingsModelsList;
      for (const { model, index } of entries) {
        used.add(index);
        appendModelRow(target, model, index, nested);
      }
    };

    settingsProviders.forEach((provider, providerIndex) => {
      const group = document.createElement("div");
      group.className = "settings-provider-group";
      appendProviderHead(group, provider, providerIndex);
      const pid = String(provider.id || "").trim();
      const entries = settingsModels
        .map((model, index) => ({ model, index }))
        .filter(
          ({ model }) => String(model.providerId || "").trim() === pid
        );
      appendModels(entries, true, group);
      settingsModelsList.appendChild(group);
    });

    const orphans = settingsModels
      .map((model, index) => ({ model, index }))
      .filter(({ index }) => !used.has(index));
    if (orphans.length) {
      if (settingsProviders.length) {
        const group = document.createElement("div");
        group.className = "settings-provider-group";
        const orphanHead = document.createElement("div");
        orphanHead.className = "settings-provider-head";
        orphanHead.innerHTML =
          `<div class="settings-model-info">` +
          `<div class="settings-model-name"></div>` +
          `<div class="settings-model-id"></div>` +
          `</div>`;
        orphanHead.querySelector(".settings-model-name").textContent =
          t("otherProvider");
        group.appendChild(orphanHead);
        appendModels(orphans, true, group);
        settingsModelsList.appendChild(group);
      } else {
        appendModels(orphans, false, settingsModelsList);
      }
    }

    syncDefaultModelSelect();
  }

  function renderSettingsModels() {
    renderSettingsCatalog();
    fillTabAutocompleteModelSelect(
      settingsTabAutocompleteModel
        ? settingsTabAutocompleteModel.value
        : ""
    );
    fillCommitMessageModelSelect(
      settingsCommitModel ? settingsCommitModel.value : ""
    );
  }

  function isCoderLikeModelId(id, label) {
    const s = `${id || ""} ${label || ""}`.toLowerCase();
    return /coder|code-|codestral|deepseek|grok-code|starcoder|codellama|qwen2\.5-coder|qwen3-coder/.test(
      s
    );
  }

  function fillTabAutocompleteModelSelect(selectedId) {
    if (!settingsTabAutocompleteModel) {
      return;
    }
    const previous = String(
      selectedId != null && selectedId !== ""
        ? selectedId
        : settingsTabAutocompleteModel.value || ""
    ).trim();
    const enabled = settingsModels
      .filter((m) => m && m.id && m.enabled !== false)
      .slice()
      .sort((a, b) => {
        const ac = isCoderLikeModelId(a.id, a.label) ? 0 : 1;
        const bc = isCoderLikeModelId(b.id, b.label) ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return String(a.label || a.id).localeCompare(String(b.label || b.id));
      });
    settingsTabAutocompleteModel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = t("tabAutocompleteModelEmpty");
    settingsTabAutocompleteModel.appendChild(empty);
    for (const model of enabled) {
      const opt = document.createElement("option");
      opt.value = model.id;
      const base = model.label || model.id;
      opt.textContent = isCoderLikeModelId(model.id, model.label)
        ? `${base} (${t("tabAutocompleteCoderTag")})`
        : base;
      settingsTabAutocompleteModel.appendChild(opt);
    }
    if (previous && enabled.some((m) => m.id === previous)) {
      settingsTabAutocompleteModel.value = previous;
    } else {
      settingsTabAutocompleteModel.value = "";
    }
  }

  function fillCommitMessageModelSelect(selectedId) {
    if (!settingsCommitModel) {
      return;
    }
    const previous = String(
      selectedId != null && selectedId !== ""
        ? selectedId
        : settingsCommitModel.value || ""
    ).trim();
    const enabled = settingsModels
      .filter((m) => m && m.id && m.enabled !== false)
      .slice()
      .sort((a, b) =>
        String(a.label || a.id).localeCompare(String(b.label || b.id))
      );
    settingsCommitModel.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = t("commitModelEmpty");
    settingsCommitModel.appendChild(empty);
    for (const model of enabled) {
      const opt = document.createElement("option");
      opt.value = model.id;
      opt.textContent = model.label || model.id;
      settingsCommitModel.appendChild(opt);
    }
    if (previous && enabled.some((m) => m.id === previous)) {
      settingsCommitModel.value = previous;
    } else {
      settingsCommitModel.value = "";
    }
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
    return undefined;
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
    if (
      visionRaw === true ||
      visionRaw === "true" ||
      visionRaw === 1 ||
      visionFromArchitecture === true
    ) {
      model.supportsVision = true;
    } else if (
      (visionRaw === false ||
        visionRaw === "false" ||
        visionRaw === 0) &&
      !guessModelSupportsVision(id)
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

  function upsertModels(incoming, defaultProviderId) {
    const fallbackProvider = String(defaultProviderId || "").trim();
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
      const providerId =
        String(model.providerId || "").trim() || fallbackProvider;
      if (byId.has(model.id)) {
        const prev = byId.get(model.id);
        byId.set(model.id, {
          id: model.id,
          label: model.label || prev.label || model.id,
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
        });
        updated += 1;
      } else {
        const next = cloneModel(model);
        next.providerId = providerId || next.providerId || "";
        byId.set(model.id, next);
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
    const existing = new Set(
      settingsModels.map((m) => String(m.id || "").trim()).filter(Boolean)
    );
    const incoming = [];
    let skipped = 0;
    for (const raw of ids) {
      const id = String(raw || "").trim();
      if (!id) {
        continue;
      }
      if (existing.has(id)) {
        skipped += 1;
        continue;
      }
      const extra = fetchModelsById.get(id) || {};
      incoming.push({
        id,
        label: extra.label || id,
        providerId: provider,
        contextWindow: extra.contextWindow,
        maxOutputTokens: extra.maxOutputTokens,
        enabled: true,
        supportsVision: guessModelSupportsVision(id),
      });
      existing.add(id);
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
    const hasNew = newIds.length > 0;
    const showList = hasNew && !fetchModelsLoading && !fetchModelsError;

    if (els.searchWrap) {
      els.searchWrap.hidden = !showList;
    }
    if (els.selectWrap) {
      els.selectWrap.hidden = !showList;
    }
    if (els.selectBtn) {
      els.selectBtn.hidden = !showList;
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

    if (!hasNew) {
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
      t("fetchModelsCount", fetchModelsIds.length, newIds.length),
      false
    );

    if (!els.list) {
      syncFetchModelsAddEnabled();
      return;
    }
    for (const id of ids) {
      const row = document.createElement("label");
      row.className = "settings-fetch-model-row";
      const checked = fetchModelsSelected.has(id);
      row.innerHTML =
        `<input type="checkbox" ${checked ? "checked" : ""} data-model-id="" />` +
        `<span class="settings-fetch-model-id"></span>`;
      const input = row.querySelector("input");
      input.dataset.modelId = id;
      row.querySelector(".settings-fetch-model-id").textContent = id;
      input.addEventListener("change", () => {
        if (input.checked) {
          fetchModelsSelected.add(id);
        } else {
          fetchModelsSelected.delete(id);
        }
        syncFetchModelsAddEnabled();
      });
      els.list.appendChild(row);
    }
    syncFetchModelsAddEnabled();
  }

  function syncFetchModelsAddEnabled() {
    const selectedNew = Array.from(fetchModelsSelected).filter(
      (id) => !fetchModelsExisting.has(id)
    );
    if (fetchModelsAddBtn && fetchModelsTarget === "modal") {
      fetchModelsAddBtn.disabled =
        fetchModelsLoading || Boolean(fetchModelsError) || !selectedNew.length;
    }
    if (modelEditDoneBtn && fetchModelsTarget === "editApi" && modelEditMode === "api") {
      modelEditDoneBtn.disabled =
        fetchModelsLoading || Boolean(fetchModelsError) || !selectedNew.length;
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
    fetchModelsExisting = new Set(
      settingsModels
        .filter((m) => String(m.providerId || "").trim() === provider.id)
        .map((m) => String(m.id || "").trim())
        .filter(Boolean)
    );
    // Also treat same id under other providers as existing globally
    for (const m of settingsModels) {
      const id = String(m.id || "").trim();
      if (id) {
        fetchModelsExisting.add(id);
      }
    }
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
    if (!selectedNew.length) {
      if (fetchModelsTarget === "editApi") {
        setFetchModelsHint(modelEditApiStatus, t("fetchModelsNoneSelected"), true);
      } else {
        setFetchModelsHint(fetchModelsStatus, t("fetchModelsNoneSelected"), true);
      }
      return false;
    }
    const result = addMissingModelsFromIds(selectedNew, fetchModelsProviderId);
    setModelsHint(t("fetchModelsDone", result.added, result.skipped));
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

    return null;
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
      throw new Error(t("invalidJson"));
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
      ? primaryProviderId() || NEW_PROVIDER_VALUE
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
        setModelsHint(`A model with id "${id}" already exists.`, true);
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

  function persistSettingsNow() {
    if (settingsHydrating) {
      return;
    }
    host.postMessage({
      type: "saveSettings",
      settings: collectSettings(),
    });
    showSettingsSaved();
  }

  function persistModesNow() {
    if (settingsHydrating) {
      return;
    }
    host.postMessage({
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
    settingsLanguageValue =
      settings.language === "ru"
        ? "ru"
        : settings.language === "en"
          ? "en"
          : "auto";
    if (
      settings.resolvedLanguage === "ru" ||
      settings.resolvedLanguage === "en"
    ) {
      hostResolvedUiLang = settings.resolvedLanguage;
    }
    applyUiLanguage(effectiveUiLangFromSetting(settingsLanguageValue));
    if (settingsLanguage) {
      settingsLanguage.value = settingsLanguageValue;
    }
    applyUiFontSize(settings.fontSize);
    settingsProviders = Array.isArray(settings.providers)
      ? settings.providers.map((p) => ({
          id: p.id || "",
          name: p.name || "",
          baseUrl: p.baseUrl || "",
          apiKey: p.apiKey || "",
          statusUrl: p.statusUrl || "",
        }))
      : [];
    if (
      !settingsProviders.length &&
      (settings.baseUrl || settings.apiKey)
    ) {
      settingsProviders.push({
        id: "default",
        name: t("defaultProviderName"),
        baseUrl: String(settings.baseUrl || "").replace(/\/$/, ""),
        apiKey: settings.apiKey || "",
        statusUrl: "",
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
    settingsWorkspaceName = String(settings.workspaceName || "").trim();
    if (settingsCommitScope) {
      settingsCommitScope.value =
        settings.commitMessageScope === "workspace" ? "workspace" : "global";
      updateCommitScopeWorkspaceOption();
    }
    settingsDefaultContextWindow =
      Number(settings.defaultContextWindow) > 0
        ? Number(settings.defaultContextWindow)
        : 128000;
    if (settingsRejectUnauthorized) {
      settingsRejectUnauthorized.checked = Boolean(settings.rejectUnauthorized);
    }
    if (settingsSystemPrompt) {
      settingsSystemPrompt.value = settings.systemPrompt || "";
      updateSystemPromptPreview();
    }
    if (settingsCommitLanguage) {
      settingsCommitLanguage.value =
        settings.commitMessageLanguage === "ru"
          ? "ru"
          : settings.commitMessageLanguage === "en"
            ? "en"
            : "auto";
    }
    if (settingsCommitPrompt) {
      settingsCommitPrompt.value = settings.commitMessagePrompt || "";
      updateCommitPromptPreview();
    }
    fillCommitMessageModelSelect(settings.commitMessageModelId || "");
    if (typeof settings.figmaEnabled === "boolean") {
      figmaStatus = {
        ...figmaStatus,
        enabled: settings.figmaEnabled === true,
      };
    }
    if (settings.figma) {
      renderFigmaStatus({ ...figmaStatus, ...settings.figma });
    } else {
      host.postMessage({ type: "figmaRefreshStatus" });
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
        settings.maxResponseChars || 64000
      );
    }
    if (settingsSoundNotificationsEnabled) {
      settingsSoundNotificationsEnabled.checked =
        settings.soundNotificationsEnabled !== false;
    }
    if (settingsSubagentsEnabled) {
      settingsSubagentsEnabled.checked = settings.subagentsEnabled !== false;
    }
    if (settingsParallelToolCallsEnabled) {
      settingsParallelToolCallsEnabled.checked =
        settings.parallelToolCallsEnabled !== false;
    }
    if (settingsAutoCompactEnabled) {
      settingsAutoCompactEnabled.checked =
        settings.autoCompactEnabled !== false;
    }
    if (settingsToolsAutoApprove) {
      settingsToolsAutoApprove.checked = settings.toolsAutoApprove !== false;
    }
    const approvalOverrides =
      settings.toolsApprovals &&
      typeof settings.toolsApprovals === "object"
        ? settings.toolsApprovals
        : {};
    for (const [group, select] of Object.entries(settingsApprovalSelects)) {
      if (!select) {
        continue;
      }
      const value = approvalOverrides[group];
      select.value =
        value === true ? "auto" : value === false ? "ask" : "inherit";
    }
    if (settingsFocusChainEnabled) {
      settingsFocusChainEnabled.checked = settings.focusChainEnabled !== false;
    }
    if (settingsCheckpointsEnabled) {
      settingsCheckpointsEnabled.checked = settings.checkpointsEnabled !== false;
    }
    if (
      Array.isArray(settings.skillsExtraDirectories) ||
      Array.isArray(settings.skillsDisabled)
    ) {
      // Keep cache in sync when settings hydrate; full list comes via skillsList.
      skillsCache = {
        ...skillsCache,
        enabled: settings.skillsEnabled !== false,
      };
    }
    fillTabAutocompleteModelSelect(settings.tabAutocompleteModelId || "");
    if (settingsTabAutocompleteEnabled) {
      settingsTabAutocompleteEnabled.checked =
        settings.tabAutocompleteEnabled === true;
    }
    if (settingsTabAutocompleteAggressiveness) {
      const agg = String(settings.tabAutocompleteAggressiveness || "medium")
        .trim()
        .toLowerCase();
      settingsTabAutocompleteAggressiveness.value =
        agg === "low" || agg === "high" ? agg : "medium";
    }
    if (settingsTabAutocompleteAlternatives) {
      const alts = Number(settings.tabAutocompleteAlternatives);
      settingsTabAutocompleteAlternatives.value = String(
        alts === 1 || alts === 3 ? alts : 2
      );
    }
    if (settingsTabAutocompleteExcludeGlobs) {
      const globs = Array.isArray(settings.tabAutocompleteExcludeGlobs)
        ? settings.tabAutocompleteExcludeGlobs
        : [];
      settingsTabAutocompleteExcludeGlobs.value = globs.join("\n");
      updateTabExcludePreview();
    }
    if (settingsTabAutocompleteNextEdit) {
      settingsTabAutocompleteNextEdit.checked =
        settings.tabAutocompleteNextEdit === true;
    }
    if (settingsTabAutocompleteShowMode) {
      settingsTabAutocompleteShowMode.value =
        String(settings.tabAutocompleteShowMode || "chip").toLowerCase() ===
        "inline"
          ? "inline"
          : "chip";
    }
    if (settingsTabAutocompleteFim) {
      settingsTabAutocompleteFim.checked = settings.tabAutocompleteFim === true;
    }
    if (settingsSelectionHintsEnabled) {
      settingsSelectionHintsEnabled.checked =
        settings.selectionHintsEnabled !== false;
    }
    if (settingsAutoglmEnabled) {
      settingsAutoglmEnabled.checked = settings.autoglmEnabled === true;
    }
    if (settingsAutoglmBrowser) {
      settingsAutoglmBrowser.value =
        settings.autoglmBrowser === "edge" ? "edge" : "chrome";
    }
    if (settingsAutoglmAutoApprove) {
      settingsAutoglmAutoApprove.checked = settings.autoglmAutoApprove === true;
    }
    if (settingsAutoglmBinaryPath) {
      settingsAutoglmBinaryPath.value = settings.autoglmBinaryPath || "";
    }
    closeModelEditModal();
    closeProviderEditModal();
    ingestProviderConnStatuses(settings.providerConnStatuses);
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
        const statusUrl = String(p.statusUrl || "").replace(/\/$/, "");
        if (statusUrl && statusUrl !== row.baseUrl) {
          row.statusUrl = statusUrl;
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
      language: settingsLanguage ? settingsLanguage.value : settingsLanguageValue,
      fontSize: clampUiFontSize(settingsFontSize ? settingsFontSize.value : FONT_SIZE_DEFAULT),
      defaultModel: firstEnabledSettingsModelId() || settingsDefaultModelId,
      defaultContextWindow: settingsDefaultContextWindow,
      baseUrl: primary ? String(primary.baseUrl || "").replace(/\/$/, "") : "",
      apiKey: primary ? primary.apiKey || "" : "",
      rejectUnauthorized: settingsRejectUnauthorized
        ? settingsRejectUnauthorized.checked
        : false,
      systemPrompt: settingsSystemPrompt ? settingsSystemPrompt.value : "",
      commitMessagePrompt: settingsCommitPrompt
        ? settingsCommitPrompt.value
        : "",
      commitMessageLanguage: settingsCommitLanguage
        ? settingsCommitLanguage.value
        : "auto",
      commitMessageModelId: settingsCommitModel
        ? settingsCommitModel.value.trim()
        : "",
      commitMessageScope: settingsCommitScope
        ? settingsCommitScope.value === "workspace"
          ? "workspace"
          : "global"
        : "global",
      figmaEnabled: figmaStatus.enabled === true,
      maxToolRounds: Number(settingsMaxToolRounds?.value || 20),
      maxTokens: Number(settingsMaxTokens?.value || 4096),
      maxResponseChars: Number(settingsMaxResponseChars?.value || 64000),
      soundNotificationsEnabled: settingsSoundNotificationsEnabled
        ? settingsSoundNotificationsEnabled.checked
        : true,
      subagentsEnabled: settingsSubagentsEnabled
        ? settingsSubagentsEnabled.checked
        : true,
      parallelToolCallsEnabled: settingsParallelToolCallsEnabled
        ? settingsParallelToolCallsEnabled.checked
        : true,
      autoCompactEnabled: settingsAutoCompactEnabled
        ? settingsAutoCompactEnabled.checked
        : true,
      toolsAutoApprove: settingsToolsAutoApprove
        ? settingsToolsAutoApprove.checked
        : true,
      toolsApprovals: Object.fromEntries(
        Object.entries(settingsApprovalSelects)
          .filter(([, select]) => select && select.value !== "inherit")
          .map(([group, select]) => [group, select.value === "auto"])
      ),
      focusChainEnabled: settingsFocusChainEnabled
        ? settingsFocusChainEnabled.checked
        : true,
      checkpointsEnabled: settingsCheckpointsEnabled
        ? settingsCheckpointsEnabled.checked
        : true,
      skillsEnabled: skillsCache.enabled !== false,
      skillsExtraDirectories: Array.isArray(skillsCache.directories)
        ? skillsCache.directories
            .filter((d) => d && d.removable)
            .map((d) => d.path)
            .filter(Boolean)
        : [],
      skillsDisabled: Array.isArray(skillsCache.skills)
        ? skillsCache.skills
            .filter((s) => s && s.disabled)
            .map((s) => s.name)
            .filter(Boolean)
        : [],
      tabAutocompleteEnabled:
        harborHostAvailable()
          ? false
          : settingsTabAutocompleteEnabled
            ? settingsTabAutocompleteEnabled.checked
            : false,
      tabAutocompleteModelId: settingsTabAutocompleteModel
        ? settingsTabAutocompleteModel.value.trim()
        : "",
      tabAutocompleteAggressiveness: settingsTabAutocompleteAggressiveness
        ? settingsTabAutocompleteAggressiveness.value
        : "medium",
      tabAutocompleteAlternatives: settingsTabAutocompleteAlternatives
        ? Number(settingsTabAutocompleteAlternatives.value) || 2
        : 2,
      tabAutocompleteExcludeGlobs: settingsTabAutocompleteExcludeGlobs
        ? settingsTabAutocompleteExcludeGlobs.value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      tabAutocompleteNextEdit: settingsTabAutocompleteNextEdit
        ? settingsTabAutocompleteNextEdit.checked
        : false,
      tabAutocompleteShowMode: settingsTabAutocompleteShowMode
        ? settingsTabAutocompleteShowMode.value
        : "chip",
      tabAutocompleteFim: settingsTabAutocompleteFim
        ? settingsTabAutocompleteFim.checked
        : false,
      selectionHintsEnabled: settingsSelectionHintsEnabled
        ? settingsSelectionHintsEnabled.checked
        : true,
      autoglmEnabled: settingsAutoglmEnabled
        ? settingsAutoglmEnabled.checked
        : false,
      autoglmBrowser: settingsAutoglmBrowser
        ? settingsAutoglmBrowser.value === "edge"
          ? "edge"
          : "chrome"
        : "chrome",
      autoglmAutoApprove: settingsAutoglmAutoApprove
        ? settingsAutoglmAutoApprove.checked
        : false,
      autoglmBinaryPath: settingsAutoglmBinaryPath
        ? settingsAutoglmBinaryPath.value.trim()
        : "",
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
        if (m.color) {
          row.color = m.color;
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
      label: t("agent"),
      description: UI_LANG === "ru" ? "Читает и правит код" : "Reads and edits code",
      tools: "agent",
      builtin: true,
      placeholder: t("taskPlaceholder"),
    },
    {
      id: "plan",
      label: t("plan"),
      description: UI_LANG === "ru" ? "Только план, без правок" : "Plan only, no edits",
      tools: "readonly",
      builtin: true,
      placeholder:
        UI_LANG === "ru"
          ? "Опишите задачу — агент составит план без правок… (@ — файл)"
          : "Describe the task — the agent will draft a plan without edits... (@ for file)",
    },
    {
      id: "ask",
      label: t("ask"),
      description: UI_LANG === "ru" ? "Ответы и объяснения" : "Answers and explanations",
      tools: "readonly",
      builtin: true,
      placeholder:
        UI_LANG === "ru"
          ? "Спросите про код или задачу… (@ — файл)"
          : "Ask about code or a task... (@ for file)",
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
      color: normalizeModeColorUi(m.color) || "",
      placeholder: m.placeholder || "",
      enabled: m.enabled !== false,
      builtin: Boolean(m.builtin) || ["agent", "plan", "ask"].includes(m.id),
      overridden: Boolean(m.overridden),
    }));
  }

  function applyModes(list, { keepSelection = true } = {}) {
    const next = normalizeModesList(list);
    settingsModes = next.map((m) => localizeModeMeta({ ...m }));
    chatModes = next
      .filter((m) => m.enabled !== false)
      .map((m) => localizeModeMeta({ ...m }));
    syncModeAccentStyles();
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    const still =
      keepSelection && chatModes.some((m) => m.id === agentMode)
        ? agentMode
        : chatModes[0]?.id || "agent";
    const modeChanged = still !== agentMode;
    if (typeof setAgentMode === "function") {
      setAgentMode(still, { close: false, notify: modeChanged });
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
        `<div class="settings-models-empty">${t("noModes")}</div>`;
      return;
    }
    settingsModes.forEach((mode, index) => {
      const row = document.createElement("div");
      row.className = "settings-model-row";
      row.dataset.index = String(index);
      const toolsLabel =
        mode.tools === "readonly" ? t("readOnly") : t("agent").toLowerCase();
      const subtitle = mode.builtin
        ? `${t("builtIn")} · ${toolsLabel}`
        : toolsLabel;
      row.innerHTML =
        `<div class="settings-model-info">` +
        `<div class="settings-model-name"></div>` +
        `<div class="settings-model-id"></div>` +
        `</div>` +
        `<button type="button" class="icon-btn settings-mode-edit" data-index="${index}" title="${t("edit")}" aria-label="${t("edit")}">` +
        SETTINGS_ICON +
        `</button>` +
        (mode.builtin
          ? ""
          : `<button type="button" class="icon-btn settings-mode-remove" data-index="${index}" title="${t("delete")}" aria-label="${t("delete")}">` +
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

  const MODE_ACCENT_DEFAULTS = {
    plan: "#a67c00",
    ask: "#2d6a4f",
  };

  function normalizeModeColorUi(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) {
      return "";
    }
    const hex = match[1];
    if (hex.length === 3) {
      const [a, b, c] = hex.split("");
      return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
    }
    return `#${hex}`.toLowerCase();
  }

  function resolveModeAccent(modeId) {
    const id = String(modeId || "").trim();
    if (!id) {
      return "";
    }
    const modes = chatModes.length
      ? chatModes
      : settingsModes.length
        ? settingsModes
        : DEFAULT_CHAT_MODES;
    const mode = modes.find((m) => m.id === id);
    const custom = normalizeModeColorUi(mode?.color);
    if (custom) {
      return custom;
    }
    return MODE_ACCENT_DEFAULTS[id] || "";
  }

  /** Webview CSP blocks element.style / inline vars — accents go through a nonced <style>. */
  function getWebviewStyleNonce() {
    const tagged =
      document.querySelector("style[nonce]") ||
      document.querySelector("script[nonce]");
    if (!tagged) {
      return "";
    }
    return tagged.nonce || tagged.getAttribute("nonce") || "";
  }

  function ensureModeAccentStyleEl() {
    let el = document.getElementById("harborModeAccents");
    if (el) {
      return el;
    }
    el = document.createElement("style");
    el.id = "harborModeAccents";
    const nonce = getWebviewStyleNonce();
    if (nonce) {
      el.setAttribute("nonce", nonce);
    }
    document.head.appendChild(el);
    return el;
  }

  function cssAttrValue(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  function syncModeAccentStyles() {
    const styleEl = ensureModeAccentStyleEl();
    const modes = settingsModes.length
      ? settingsModes
      : chatModes.length
        ? chatModes
        : DEFAULT_CHAT_MODES;
    const seen = new Set();
    const chunks = [];
    for (const mode of modes) {
      const id = String(mode?.id || "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const custom = normalizeModeColorUi(mode?.color);
      const accent = custom || MODE_ACCENT_DEFAULTS[id] || "";
      if (!accent) {
        continue;
      }
      // Built-in plan/ask already styled in panel.css unless user overrode color.
      if (!custom && (id === "plan" || id === "ask")) {
        continue;
      }
      const attr = cssAttrValue(id);
      // Override CSS vars so panel.css cube rules for plan/ask pick up custom color.
      if (custom && id === "plan") {
        chunks.push(`:root{--mode-plan:${accent};}`);
      } else if (custom && id === "ask") {
        chunks.push(`:root{--mode-ask:${accent};}`);
      }
      chunks.push(
        `.msg.user[data-mode="${attr}"]{background:color-mix(in srgb,${accent} 14%,var(--harbor-chat-bg));}` +
          `.composer[data-mode="${attr}"],` +
          `.msg-edit-composer[data-mode="${attr}"]{border-color:color-mix(in srgb,${accent} var(--mode-border-composer),transparent);}` +
          `.mode-picker[data-mode="${attr}"] .model-trigger,` +
          `.mode-picker[data-mode="${attr}"] .model-trigger:hover:not(:disabled),` +
          `.mode-picker[data-mode="${attr}"].is-open .model-trigger,` +
          `.msg-edit-mode-picker[data-mode="${attr}"] .model-trigger{color:${accent};}` +
          `.mode-picker .model-option[data-mode="${attr}"] .model-option-label,` +
          `#modeMenu .model-option[data-mode="${attr}"] .model-option-label,` +
          `.msg-edit-mode-menu .model-option[data-mode="${attr}"] .model-option-label{color:${accent};}` +
          `.agents-list .agent-run-status-running[data-mode="${attr}"]{--cube-accent:${accent};}`
      );
    }
    styleEl.textContent = chunks.join("\n");
  }

  function applyModeAccentToElement(el, modeId) {
    if (!el) {
      return;
    }
    const id = String(modeId || "").trim();
    if (id) {
      el.dataset.mode = id;
    } else {
      delete el.dataset.mode;
    }
    // Colors: panel.css for plan/ask; #harborModeAccents for custom.
    // Do not use has-mode-accent + --mode-accent (CSP blocks the var; class overrides builtins).
    el.classList.remove("has-mode-accent");
    el.style.removeProperty("--mode-accent");
  }

  function getModeEditColor() {
    if (!modeEditColorRow) {
      return "";
    }
    const active = modeEditColorRow.querySelector(
      ".mode-color-swatch.is-active"
    );
    if (active) {
      return normalizeModeColorUi(active.getAttribute("data-color"));
    }
    if (modeEditColorRow.dataset.customActive === "1" && modeEditColor) {
      return normalizeModeColorUi(modeEditColor.value);
    }
    return "";
  }

  function setModeEditColor(value) {
    const color = normalizeModeColorUi(value);
    if (!modeEditColorRow) {
      return;
    }
    modeEditColorRow.dataset.customActive = "";
    modeEditColorRow.querySelectorAll(".mode-color-swatch").forEach((btn) => {
      const swatch = normalizeModeColorUi(btn.getAttribute("data-color"));
      const isNone = btn.classList.contains("is-none");
      btn.classList.toggle("is-active", color ? swatch === color : isNone);
    });
    if (color && modeEditColor) {
      modeEditColor.value = color;
      const matched = [...modeEditColorRow.querySelectorAll(".mode-color-swatch")].some(
        (btn) =>
          !btn.classList.contains("is-none") &&
          normalizeModeColorUi(btn.getAttribute("data-color")) === color
      );
      if (!matched) {
        modeEditColorRow.dataset.customActive = "1";
        modeEditColorRow
          .querySelectorAll(".mode-color-swatch")
          .forEach((btn) => btn.classList.remove("is-active"));
      }
    }
  }

  function applyModeEditModalStrings() {
    const nameLabel = document.getElementById("modeEditNameLabel");
    if (nameLabel) nameLabel.textContent = t("name");
    const descLabel = document.getElementById("modeEditDescriptionLabel");
    if (descLabel) descLabel.textContent = t("modeDescription");
    const toolsLabel = document.getElementById("modeEditToolsLabel");
    if (toolsLabel) toolsLabel.textContent = t("modeTools");
    const promptLabel = document.getElementById("modeEditPromptLabel");
    if (promptLabel) promptLabel.textContent = t("modePrompt");
    const colorLabel = document.getElementById("modeEditColorLabel");
    if (colorLabel) colorLabel.textContent = t("modeColor");
    const colorHint = document.getElementById("modeEditColorHint");
    if (colorHint) colorHint.textContent = t("modeColorHint");
    if (modeEditLabel) {
      modeEditLabel.placeholder = t("modeNamePlaceholder");
    }
    if (modeEditDescription) {
      modeEditDescription.placeholder = t("modeDescriptionPlaceholder");
    }
    if (modeEditPrompt) {
      modeEditPrompt.placeholder = t("modePromptPlaceholder");
    }
    if (modeEditTools) {
      const agentOpt = modeEditTools.querySelector('option[value="agent"]');
      const roOpt = modeEditTools.querySelector('option[value="readonly"]');
      if (agentOpt) agentOpt.textContent = t("modeToolsAgent");
      if (roOpt) roOpt.textContent = t("modeToolsReadonly");
    }
    if (modeEditColorRow) {
      const noneBtn = modeEditColorRow.querySelector(
        ".mode-color-swatch.is-none"
      );
      if (noneBtn) {
        noneBtn.title = t("modeColorNone");
        noneBtn.setAttribute("aria-label", t("modeColorNone"));
      }
      const custom = modeEditColorRow.querySelector(".mode-color-custom");
      if (custom) {
        custom.title = t("modeColorCustom");
      }
      if (modeEditColor) {
        modeEditColor.setAttribute("aria-label", t("modeColorCustom"));
      }
    }
    if (modeEditCancelBtn) modeEditCancelBtn.textContent = t("cancel");
    if (modeEditDoneBtn) modeEditDoneBtn.textContent = t("done");
    if (modeEditCloseBtn) {
      modeEditCloseBtn.title = t("close");
      modeEditCloseBtn.setAttribute("aria-label", t("close"));
    }
  }

  function openModeEditModal(index, source) {
    if (!modeEditModal) {
      return;
    }
    applyModeEditModalStrings();
    modeEditSource = source || "settings";
    modeEditIndex = Number.isInteger(index) ? index : -1;
    const existing =
      modeEditIndex >= 0 ? settingsModes[modeEditIndex] : null;
    if (modeEditTitle) {
      modeEditTitle.textContent = existing ? t("mode") : t("newMode");
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
    setModeEditColor(existing?.color || "");
    modeEditModal.hidden = false;
    if (modeEditLabel) {
      modeEditLabel.focus();
    }
  }

  function commitModeEdit() {
    const label = modeEditLabel ? modeEditLabel.value.trim() : "";
    if (!label) {
      showCopyToast(t("enterModeName"));
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
    const color = getModeEditColor();
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
      color,
      enabled: true,
      builtin: isBuiltin,
      overridden: true,
      placeholder:
        existing?.placeholder ||
        (tools === "readonly"
          ? `${label}... (@ for file)`
          : `Task (${label})... (@ for file)`),
    };
    if (existing && modeEditIndex >= 0) {
      settingsModes[modeEditIndex] = next;
    } else {
      settingsModes.push(next);
    }
    chatModes = settingsModes.filter((m) => m.enabled !== false);
    syncModeAccentStyles();
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    closeModeEditModal();
    persistModesNow();
    if (modeEditSource === "composer" && typeof setAgentMode === "function") {
      setAgentMode(id, { focus: true });
    } else if (typeof setAgentMode === "function" && agentMode === id) {
      setAgentMode(id, { close: false, notify: false });
    }
  }

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
    const full = String(path || "");
    const safePath = escapeHtml(full);
    const label = escapeHtml(pathBasename(full));
    return `<a class="md-file" href="#" data-path="${safePath}" title="${safePath}">${label}</a>`;
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

    text = text.replace(/@([^\s@]+)/g, (full, path) => {
      const id = tokens.length;
      tokens.push(renderMentionChip(path));
      return `\u0001T${id}\u0001`;
    });

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

  function parseCodeFenceMeta(langRaw) {
    const lang = String(langRaw || "").trim();
    if (!lang) {
      return { language: "", path: "", startLine: 0, endLine: 0 };
    }
    // language start:end:path  (напр. css 27:29:src/foo.module.css)
    const langCite = lang.match(
      /^([\w.+#-]+)\s+(\d+)(?::(\d+))?:(.+)$/
    );
    if (langCite) {
      return {
        language: langCite[1],
        path: langCite[4].trim(),
        startLine: Number(langCite[2]),
        endLine: langCite[3] ? Number(langCite[3]) : Number(langCite[2]),
      };
    }
    // start:end:path  или  start:path
    const cite = lang.match(/^(\d+)(?::(\d+))?:(.+)$/);
    if (cite) {
      const startLine = Number(cite[1]);
      const endLine = cite[2] ? Number(cite[2]) : startLine;
      return {
        language: "",
        path: cite[3].trim(),
        startLine,
        endLine,
      };
    }
    // language path:start-end  /  language path:start
    const withPath = lang.match(
      /^([\w.+#-]+)\s+(.+?):(\d+)(?:-(\d+))?$/
    );
    if (withPath) {
      return {
        language: withPath[1],
        path: withPath[2].trim(),
        startLine: Number(withPath[3]),
        endLine: withPath[4] ? Number(withPath[4]) : Number(withPath[3]),
      };
    }
    // language path
    const langPath = lang.match(/^([\w.+#-]+)\s+(\S.+)$/);
    if (langPath && (langPath[2].includes("/") || langPath[2].includes("."))) {
      return {
        language: langPath[1],
        path: langPath[2].trim(),
        startLine: 0,
        endLine: 0,
      };
    }
    return { language: lang, path: "", startLine: 0, endLine: 0 };
  }

  /**
   * Citation-fence ```start:end:path ... ``` — вытаскиваем до marked,
   * чтобы пути вроде foo.module.css и CSS с ~= не ломали разбор.
   */
  function renderUserFileChip(meta) {
    const path = meta.path || "file";
    const suffix =
      meta.startLine > 0
        ? meta.startLine === meta.endLine
          ? `:${meta.startLine}`
          : `:${meta.startLine}-${meta.endLine}`
        : "";
    return renderMentionChip(`${path}${suffix}`);
  }

  /** File chips (@path / citation fences) go above the user text, not inline. */
  function extractUserFileChips(raw) {
    const chips = [];
    const cited = replaceCitationFences(String(raw || ""), true);
    for (const html of cited.blocks) {
      if (html) {
        chips.push(html);
      }
    }
    let text = cited.text.replace(/\u0002CITE\d+\u0002/g, "");
    text = text.replace(/@([^\s@]+)/g, (full, path) => {
      if (String(path).includes("://")) {
        return full;
      }
      chips.push(renderMentionChip(path));
      return "";
    });
    text = text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { chips, text };
  }

  function replaceCitationFences(raw, compact) {
    const blocks = [];
    // ```27:29:path/to/file.module.css ... ```
    const re =
      /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(\d+:\d+:[^\n]+|\d+:[^\n]+)\r?\n([\s\S]*?)\r?\n?[ \t]*\2[ \t]*(?=\r?\n|$)/g;
    const out = String(raw || "").replace(
      re,
      (full, lead, _fence, meta, body) => {
        const id = blocks.length;
        blocks.push(
          compact
            ? renderUserFileChip(parseCodeFenceMeta(meta.trim()))
            : renderCodeBlockHtml(body.replace(/\r/g, ""), meta.trim())
        );
        return `${lead}\n\n\u0002CITE${id}\u0002\n\n`;
      }
    );
    return { text: out, blocks };
  }

  function restoreCitationFences(html, blocks) {
    if (!blocks.length) {
      return html;
    }
    return String(html || "").replace(/\u0002CITE(\d+)\u0002/g, (_, id) => {
      return blocks[Number(id)] || "";
    });
  }

  /**
   * <proposed_plan>…</proposed_plan> — plan block with Build button.
   * Called on raw assistant text BEFORE marked.parse, so match raw tags.
   * Also accept escaped form for re-renders / history edge cases.
   */
  function replaceProposedPlanBlocks(raw) {
    const blocks = [];
    const re =
      /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*?)\s*(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/gi;
    // Промпт требует «полная замена, не патч». Если модель выдала несколько
    // <proposed_plan> блоков (черновик + финал, ревизия) — рендерим в
    // карточку только последний, остальные выкидываем, чтобы не плодить
    // лишние Build-кнопки.
    let text = String(raw || "");
    const allMatches = [];
    text.replace(re, (...args) => {
      allMatches.push(args);
      return "";
    });
    // Recovery: обрезанный <proposed_plan> без закрывающего тега (модель
    // упёрлась в max_tokens посередине плана). Regex выше не матчит —
    // достраиваем: если есть открывающий тег, но нет закрывающего, берём
    // остаток текста как тело плана, чтобы карточка всё-таки отрисовалась.
    // с кнопкой Build (пользователь увидит, что план обрезан, и сможет
    // попросить продолжение).
    if (!allMatches.length) {
      const openRe =
        /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*)/i;
      const openMatch = openRe.exec(text);
      if (openMatch) {
        allMatches.push(openMatch);
      }
    }
    const lastIdx = allMatches.length - 1;
    let matchIdx = 0;
    let out = text;
    if (allMatches.length) {
      let usedRecovery = !re.test(text);
      if (usedRecovery) {
        // Обрезанный случай: заменяем вручную, regex не матчит.
        const body = allMatches[0][1];
        const id = blocks.length;
        blocks.push(renderProposedPlanCard(String(body || "").trim()));
        out = text.replace(
          /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*)/i,
          `\n\n\u0002PLAN${id}\u0002\n\n`
        );
      } else {
        out = text.replace(re, (_full, body) => {
          const isLast = matchIdx === lastIdx;
          matchIdx += 1;
          if (!isLast) {
            return "";
          }
          const id = blocks.length;
          blocks.push(renderProposedPlanCard(body.trim()));
          return `\n\n\u0002PLAN${id}\u0002\n\n`;
        });
      }
    }
    return { text: out, blocks };
  }

  function restoreProposedPlanBlocks(html, blocks) {
    if (!blocks.length) {
      return html;
    }
    return String(html || "").replace(/\u0002PLAN(\d+)\u0002/g, (_, id) => {
      return blocks[Number(id)] || "";
    });
  }

  const PLAN_SECTION_NEXT_RE =
    /^(Цель|Goal|Шаги|Steps|Затрагиваемые(?:\s+файлы)?|Affected(?:\s+files)?|Риски|Risks|Acceptance)\b/i;

  /** Drop blank paragraphs / lone <br> that inflate vertical gaps. */
  function stripEmptyPlanBlocks(root) {
    if (!(root instanceof HTMLElement)) {
      return;
    }
    root.querySelectorAll(".md-p").forEach((el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }
      const text = String(el.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        return;
      }
      el.remove();
    });
    root.querySelectorAll("br").forEach((br) => {
      const prev = br.previousSibling;
      const next = br.nextSibling;
      const onlyPad =
        (!prev || (prev.nodeType === 3 && !String(prev.textContent || "").trim())) &&
        (!next || (next.nodeType === 3 && !String(next.textContent || "").trim()));
      if (onlyPad && br.parentElement && br.parentElement.children.length === 1) {
        br.parentElement.remove();
        return;
      }
      if (
        prev &&
        prev.nodeName === "BR" &&
        br.parentElement &&
        br.parentElement.classList.contains("md-p")
      ) {
        br.remove();
      }
    });
  }

  /**
   * After marked.parse: wrap optional Implementation section.
   * Keeps preview-like code blocks (no chat chrome bars).
   */
  function enhancePlanBodyHtml(html) {
    const raw = String(html || "");
    if (!raw.trim()) {
      return raw;
    }
    const root = document.createElement("div");
    root.innerHTML = raw;
    stripEmptyPlanBlocks(root);

    const kids = Array.from(root.children);
    let implStart = -1;
    for (let i = 0; i < kids.length; i++) {
      const label = String(kids[i].textContent || "")
        .trim()
        .replace(/^#+\s*/, "");
      if (/^Implementation\b/i.test(label)) {
        implStart = i;
        break;
      }
    }
    if (implStart >= 0) {
      let implEnd = kids.length;
      for (let j = implStart + 1; j < kids.length; j++) {
        const label = String(kids[j].textContent || "")
          .trim()
          .replace(/^#+\s*/, "");
        if (PLAN_SECTION_NEXT_RE.test(label) && label.length < 96) {
          implEnd = j;
          break;
        }
      }
      const wrap = document.createElement("div");
      wrap.className = "proposed-plan-impl";
      const heading = document.createElement("div");
      heading.className = "proposed-plan-impl-label";
      heading.innerHTML =
        `<span class="material-symbols-outlined" aria-hidden="true">code</span>` +
        `<span>${escapeHtml(t("proposedPlanCodeSection"))}</span>`;
      const body = document.createElement("div");
      body.className = "proposed-plan-impl-body";
      const anchor = kids[implStart];
      root.insertBefore(wrap, anchor);
      wrap.appendChild(heading);
      wrap.appendChild(body);
      for (let k = implStart; k < implEnd; k++) {
        body.appendChild(kids[k]);
      }
    }

    return root.innerHTML;
  }

  /**
   * Markdown for plan card body — same GFM pipeline as chat / Preview
   * (no nested proposed_plan extraction).
   */
  function renderPlanBodyHtml(planBody) {
    const text = String(planBody || "");
    if (!text) {
      return "";
    }
    const extracted = replaceCitationFences(text);
    const api = getMarkedApi();
    if (ensureMarkdownRenderer() && api) {
      try {
        const html = api.parse(extracted.text, { async: false });
        return enhancePlanBodyHtml(
          restoreCitationFences(html, extracted.blocks)
        );
      } catch {
        // fall through
      }
    }
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br />");
  }

  function renderProposedPlanCard(planBody) {
    const raw = stripPlanImplementWrapper(planBody);
    const title = escapeHtml(t("proposedPlanTitle"));
    const openTab = escapeHtml(t("proposedPlanOpenTab"));
    const expand = escapeHtml(t("proposedPlanExpand"));
    return `<div class="proposed-plan-card is-collapsed" data-plan-raw="${escapeHtml(raw)}">`
      + `<div class="proposed-plan-head">`
      + `<button class="proposed-plan-toggle" type="button" data-plan-action="toggle" aria-expanded="false" title="${expand}">`
      + `<span class="material-symbols-outlined proposed-plan-chevron" aria-hidden="true">expand_more</span>`
      + `<span class="proposed-plan-title">${title}</span>`
      + `</button>`
      + `<div class="proposed-plan-actions">`
      + `<button class="proposed-plan-open-tab" type="button" data-plan-action="open-tab" title="${openTab}">`
      + `<span class="material-symbols-outlined" aria-hidden="true">preview</span>`
      + `<span>${openTab}</span>`
      + `</button>`
      + `</div>`
      + `</div>`
      + `<div class="proposed-plan-body" hidden>${renderPlanBodyHtml(raw)}</div>`
      + `</div>`;
  }

  function setProposedPlanCollapsed(card, collapsed) {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const body = card.querySelector(".proposed-plan-body");
    const toggle = card.querySelector("[data-plan-action='toggle']");
    if (!body || !(toggle instanceof HTMLButtonElement)) {
      return;
    }
    card.classList.toggle("is-collapsed", collapsed);
    body.hidden = collapsed;
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = collapsed
      ? t("proposedPlanExpand")
      : t("proposedPlanCollapse");
  }

  function openProposedPlanInTab(card) {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const raw = stripPlanImplementWrapper(card.dataset.planRaw || "");
    if (!raw) {
      return;
    }
    const key = raw.replace(/\s+/g, " ").trim();
    lastOpenedPlanKey = key;
    // Explicit card action: markdown preview beside the editor.
    host.postMessage({
      type: "openPlanMarkdown",
      text: raw,
      reveal: "preview",
    });
  }

  function getMarkedApi() {
    if (typeof marked === "undefined") {
      return null;
    }
    // UMD: window.marked = { marked, parse, Renderer, use, ... }
    if (marked && typeof marked.parse === "function" && marked.Renderer) {
      return marked;
    }
    if (marked && typeof marked.marked === "function") {
      return {
        parse: marked.marked.parse || marked.marked,
        parseInline: marked.marked.parseInline || marked.parseInline,
        Renderer: marked.Renderer || marked.marked.Renderer,
        use: marked.use || marked.marked.use,
      };
    }
    return null;
  }

  const CODE_KEYWORDS = new Set([
    "as",
    "async",
    "await",
    "any",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "def",
    "default",
    "delete",
    "do",
    "elif",
    "else",
    "enum",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "keyof",
    "let",
    "new",
    "never",
    "number",
    "of",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "string",
    "switch",
    "throw",
    "try",
    "type",
    "typeof",
    "unknown",
    "var",
    "void",
    "while",
    "with",
    "yield",
  ]);
  const CODE_LITERALS = new Set([
    "false",
    "None",
    "null",
    "super",
    "this",
    "true",
    "undefined",
  ]);

  function inferCodeLanguage(meta) {
    const explicit = String(meta?.language || "").trim().toLowerCase();
    if (explicit) {
      return explicit;
    }
    const path = String(meta?.path || "").split(/[?#]/)[0];
    const ext = path.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase() || "";
    const aliases = {
      cjs: "javascript",
      htm: "html",
      js: "javascript",
      jsonc: "json",
      jsx: "javascript",
      mjs: "javascript",
      py: "python",
      rb: "ruby",
      sh: "shell",
      ts: "typescript",
      tsx: "typescript",
      yml: "yaml",
    };
    return aliases[ext] || ext;
  }

  function codeTokenClass(token, language, precedingText, followingText) {
    if (
      token.startsWith("//") ||
      token.startsWith("/*") ||
      (language === "python" && token.startsWith("#"))
    ) {
      return "comment";
    }
    if (/^['"`]/.test(token)) {
      return "string";
    }
    if (/^\d/.test(token)) {
      return "number";
    }
    if (CODE_KEYWORDS.has(token)) {
      return "keyword";
    }
    if (CODE_LITERALS.has(token)) {
      return "literal";
    }
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(token)) {
      return "type";
    }
    if (/\.\s*$/.test(precedingText)) {
      return "property";
    }
    if (/^\s*\(/.test(followingText)) {
      return "function";
    }
    return "variable";
  }

  function highlightCode(text, language) {
    const source = String(text || "");
    const commentPattern =
      language === "python" || language === "ruby" || language === "shell"
        ? "#[^\\n]*"
        : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
    const tokenRe = new RegExp(
      "(" +
        commentPattern +
        "|'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\"|`(?:\\\\.|[^`\\\\])*`|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][\\w$]*\\b)",
      "g"
    );
    let html = "";
    let cursor = 0;
    let match;
    while ((match = tokenRe.exec(source))) {
      html += escapeHtml(source.slice(cursor, match.index));
      const token = match[0];
      const kind = codeTokenClass(
        token,
        language,
        source.slice(0, match.index),
        source.slice(match.index + token.length)
      );
      html += kind
        ? `<span class="syntax-${kind}">${escapeHtml(token)}</span>`
        : escapeHtml(token);
      cursor = match.index + token.length;
    }
    return html + escapeHtml(source.slice(cursor));
  }

  function renderCodeBlockHtml(text, langRaw) {
    const inner = String(text || "").replace(/\n$/, "");
    if (isFilePath(inner.trim()) && !inner.includes("\n")) {
      return fileLinkHtml(inner.trim());
    }
    const meta = parseCodeFenceMeta(langRaw);
    const language = inferCodeLanguage(meta);
    const lines = inner.split("\n");
    const showLines =
      meta.startLine > 0 &&
      Number.isFinite(meta.startLine) &&
      lines.length > 0;
    const codeHtml = showLines
      ? lines
          .map((line, i) => {
            const n = meta.startLine + i;
            return (
              `<span class="md-line">` +
              `<span class="md-ln" aria-hidden="true">${n}</span>` +
              `<span class="md-line-text">${highlightCode(line, language)}</span>` +
              `</span>`
            );
          })
          .join("\n")
      : highlightCode(inner, language);

    let metaHtml = "";
    if (meta.path || showLines) {
      const fileType = selectionFileType({
        path: meta.path,
        language: meta.language,
      });
      const fileTypePart = meta.path
        ? `<span class="selection-file-icon md-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(fileType.label)}</span>`
        : "";
      const pathPart = meta.path
        ? isFilePath(meta.path) || meta.path.includes("/")
          ? fileLinkHtml(meta.path)
          : `<span class="md-pre-path">${escapeHtml(meta.path)}</span>`
        : "";
      const linesPart = showLines
        ? `<span class="md-pre-lines">${
            meta.startLine === meta.endLine
              ? `line ${meta.startLine}`
              : `lines ${meta.startLine}–${meta.endLine}`
          }</span>`
        : "";
      metaHtml =
        `<div class="md-pre-meta${showLines ? " md-pre-toggle" : ""}"` +
        (showLines
          ? ` role="button" tabindex="0" aria-expanded="false" aria-label="${
              UI_LANG === "ru" ? "Показать или скрыть код" : "Show or hide code"
            }">`
          : `>`) +
        `<span class="md-pre-meta-main">` +
        fileTypePart +
        pathPart +
        (pathPart && linesPart ? `<span class="md-pre-meta-sep">·</span>` : "") +
        linesPart +
        `</span>` +
        (showLines
          ? `<span class="material-symbols-outlined md-pre-chevron" aria-hidden="true">expand_more</span>`
          : "") +
        `</div>`;
    }

    return (
      `<div class="md-pre-wrap${showLines ? " has-lines is-collapsible is-collapsed" : ""}">` +
      metaHtml +
      `<pre class="md-pre"><code>${codeHtml}</code></pre>` +
      `</div>\n`
    );
  }

  function toggleCodeBlock(toggle) {
    const wrap = toggle?.closest(".md-pre-wrap.is-collapsible");
    if (!wrap) {
      return;
    }
    const collapsed = wrap.classList.toggle("is-collapsed");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  let markdownReady = false;

  function ensureMarkdownRenderer() {
    const api = getMarkedApi();
    if (markdownReady) {
      return Boolean(api);
    }
    if (!api || !api.Renderer) {
      return false;
    }
    markdownReady = true;

    const renderer = new api.Renderer();

    renderer.code = function (token) {
      return renderCodeBlockHtml(token.text, token.lang);
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

    api.use({
      renderer,
      gfm: true,
      breaks: true,
      pedantic: false,
    });
    return true;
  }

  /** Markdown (GFM): таблицы, списки, заголовки, код, ссылки, жирный/курсив и т.д. */
  function renderInlineMarkdown(text, opts) {
    const raw = String(text || "");
    if (!raw) {
      return "";
    }
    const extracted = replaceCitationFences(raw, Boolean(opts && opts.userChrome));
    const plans = replaceProposedPlanBlocks(extracted.text);
    const api = getMarkedApi();
    if (ensureMarkdownRenderer() && api) {
      try {
        const html = api.parse(plans.text, { async: false });
        return restoreProposedPlanBlocks(
          restoreCitationFences(html, extracted.blocks),
          plans.blocks
        );
      } catch {
        // fallback below
      }
    }
    if (extracted.blocks.length || plans.blocks.length) {
      return restoreProposedPlanBlocks(
        restoreCitationFences(
          `<div class="md-p">${linkifyPlainText(plans.text, false).replace(
            /\n/g,
            "<br />"
          )}</div>`,
          extracted.blocks
        ),
        plans.blocks
      );
    }
    return `<div class="md-p">${linkifyPlainText(raw, false).replace(
      /\n/g,
      "<br />"
    )}</div>`;
  }

  /** Однострочный Markdown для короткого описания агента. */
  function renderPreviewMarkdown(text) {
    const raw = String(text || "");
    if (!raw) {
      return "";
    }
    const api = getMarkedApi();
    if (ensureMarkdownRenderer() && api && typeof api.parseInline === "function") {
      try {
        return api.parseInline(raw, { async: false });
      } catch {
        // fallback below
      }
    }
    return escapeHtml(raw);
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
    toast.textContent = text || t("copied");
    toast.hidden = false;
    if (copyToastTimer) {
      clearTimeout(copyToastTimer);
    }
    copyToastTimer = setTimeout(() => {
      copyToastTimer = null;
      toast.hidden = true;
    }, 1200);
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
    if (role === "user" && looksLikePlanImplementDisplay(raw)) {
      // Keep full Build payload in dataset.raw for the model / edit-resend;
      // in chat show a short handoff chip — not a second copy of the plan.
      el.classList.add("is-plan-implement");
      body.innerHTML =
        `<span class="plan-implement-chip">` +
        `<span class="material-symbols-outlined" aria-hidden="true">construction</span>` +
        `<span>${escapeHtml(t("proposedPlanImplementBubble"))}</span>` +
        `</span>`;
      return;
    }
    if (role === "user") {
      const extracted = extractUserFileChips(raw);
      const md = extracted.text
        ? renderInlineMarkdown(extracted.text, { userChrome: true })
        : "";
      const chipsHtml = extracted.chips.length
        ? `<div class="msg-attachments">${extracted.chips.join("")}</div>`
        : "";
      if (extracted.chips.length) {
        el.classList.add("has-attach");
      }
      body.innerHTML =
        chipsHtml + (md ? `<div class="msg-text">${md}</div>` : "");
      return;
    }
    if (role === "assistant" || role === "error") {
      body.innerHTML = renderInlineMarkdown(raw);
      return;
    }
    if (role === "tool") {
      const formatted = formatToolLine(raw);
      // Сырой вывод (git remote, MR URL) — с кликабельными ссылками.
      if (/https?:\/\//i.test(formatted) || /`[^`]+`/.test(formatted)) {
        body.innerHTML = `<div class="tool-output">${linkifyPlainText(
          formatted,
          false
        ).replace(/\n/g, "<br />")}</div>`;
      } else {
        body.textContent = formatted;
      }
      return;
    }
    body.textContent = raw;
  }

  function appendMessage(
    role,
    text,
    index,
    regenAssistantIndex,
    attachments,
    shouldScroll = true,
    reasoning,
    step
  ) {
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
      return appendToolToGroup(text, index, step);
    }

    sealToolGroups();

    // History restore only — live turns already painted Thinking via steps.
    if (role === "assistant" && String(reasoning || "").trim()) {
      const turn =
        currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
          ? currentChatTurnEl
          : null;
      const alreadyHasThinking = Boolean(
        turn?.querySelector(".agent-step[data-step-kind='thinking']")
      );
      if (!alreadyHasThinking) {
        upsertReasoning(String(reasoning).trim());
        sealToolGroups();
      }
    }

    const el = document.createElement("div");
    el.className = `msg ${role}`;
    if (typeof index === "number") {
      el.dataset.index = String(index);
    }
    if (role === "user") {
      const cachedMode =
        typeof index === "number"
          ? String(uiMessagesCache[index]?.mode || "").trim()
          : "";
      if (cachedMode) {
        applyModeAccentToElement(el, cachedMode);
      }
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
        const editModeId = normalizeAgentModeUi(editingModeId || agentMode);
        const editModeLabel = modeDisplayName(editModeId);
        const editModelFull = modelDisplayName(
          editingModelId || selectedModelId
        );
        const editModelLabel = shortModelChip(editModelFull);
        const editReasonSupported = modelSupportsReasoning(
          editingModelId || selectedModelId
        );
        const editReasonLabel = editReasonSupported
          ? reasonLevelLabel(
              normalizeReasonLevel(editingReasoningEffort) ||
                defaultReasonForModel(editingModelId || selectedModelId)
            )
          : "";
        body.innerHTML =
          `<div class="msg-edit-composer">` +
          (msgAttachments.length
            ? renderMessageAttachments(msgAttachments)
            : "") +
          `<textarea class="msg-edit-input" data-index="${index}" rows="3" aria-label="${t("editMessage")}"></textarea>` +
          `<div class="msg-edit-footer">` +
          `<div class="msg-edit-footer-left">` +
          `<div class="composer-plus msg-edit-plus">` +
          `<button type="button" class="icon-btn msg-edit-plus-btn" aria-haspopup="menu" aria-expanded="false" title="${t("add")}" aria-label="${t("add")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">add</span>` +
          `</button>` +
          `<div class="composer-plus-menu msg-edit-plus-menu" role="menu" hidden>` +
          `<button type="button" class="composer-plus-item" data-action="file" role="menuitem">` +
          `<span class="material-symbols-outlined" aria-hidden="true">attach_file</span>` +
          `<span>${escapeHtml(t("file"))}</span>` +
          `</button>` +
          `</div>` +
          `</div>` +
          `<div class="model-picker mode-picker msg-edit-mode-picker" data-mode="${escapeHtml(
            editModeId
          )}">` +
          `<button type="button" class="model-trigger msg-edit-mode-trigger" aria-haspopup="listbox" aria-expanded="false" title="${t("mode")}">` +
          `<span class="model-label msg-edit-mode-label">${escapeHtml(
            editModeLabel
          )}</span>` +
          `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
          `</button>` +
          `<div class="model-menu msg-edit-mode-menu" role="listbox" hidden></div>` +
          `</div>` +
          `</div>` +
          `<div class="msg-edit-footer-right">` +
          `<div class="model-picker msg-edit-model-picker" id="msgEditModelPicker">` +
          `<button type="button" class="model-trigger msg-edit-model-trigger" aria-haspopup="listbox" aria-expanded="false" title="${escapeHtml(
            editModelFull
          )}">` +
          `<span class="model-label msg-edit-model-label">${escapeHtml(
            editModelLabel
          )}</span>` +
          `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
          `</button>` +
          `<div class="model-menu msg-edit-model-menu" role="listbox" hidden></div>` +
          `</div>` +
          (editReasonSupported
            ? `<div class="model-picker reason-picker msg-edit-reason-picker">` +
              `<button type="button" class="model-trigger msg-edit-reason-trigger" aria-haspopup="listbox" aria-expanded="false" title="${escapeHtml(
                t("intelligence")
              )}">` +
              `<span class="material-symbols-outlined reason-icon" aria-hidden="true">neurology</span>` +
              `<span class="model-label msg-edit-reason-label">${escapeHtml(
                editReasonLabel
              )}</span>` +
              `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
              `</button>` +
              `<div class="model-menu msg-edit-reason-menu" role="listbox" hidden></div>` +
              `</div>`
            : "") +
          `<button type="button" class="primary msg-edit-save" data-index="${index}" title="${t("saveAndResend")}" aria-label="${t("saveAndResend")}">` +
          `<span class="material-symbols-outlined icon-send" aria-hidden="true">arrow_upward</span>` +
          `</button>` +
          `</div>` +
          `</div>` +
          `</div>`;
        const editModePicker = body.querySelector(".msg-edit-mode-picker");
        if (editModePicker) {
          applyModeAccentToElement(editModePicker, editModeId);
        }
        const editComposer = body.querySelector(".msg-edit-composer");
        if (editComposer) {
          applyModeAccentToElement(editComposer, editModeId);
        }
        const input = body.querySelector(".msg-edit-input");
        if (input) {
          input.value = editingUserText;
        }
        // Removable attachment chips replace the read-only preview in edit mode.
        if (msgAttachments.length) {
          refreshEditingAttachmentsPreview();
        }
        const saveBtn = body.querySelector(".msg-edit-save");
        if (saveBtn) {
          saveBtn.addEventListener("pointerdown", (event) => {
            trySubmitEditedUserMessageFromPointer(event);
          });
        }
      } else if (msgAttachments.length) {
        const attachHtml = renderMessageAttachments(msgAttachments);
        if (attachHtml) {
          el.classList.add("has-attach");
          const existing = body.querySelector(".msg-attachments");
          if (existing) {
            const tmp = document.createElement("div");
            tmp.innerHTML = attachHtml;
            const incoming = tmp.querySelector(".msg-attachments");
            if (incoming) {
              existing.insertAdjacentHTML("afterbegin", incoming.innerHTML);
            }
          } else {
            const textHtml = body.innerHTML;
            body.innerHTML =
              attachHtml +
              (String(text || "").trim()
                ? `<div class="msg-text">${textHtml}</div>`
                : "");
          }
        }
      }
      const wrap = document.createElement("div");
      wrap.className = "msg-wrap msg-wrap-user";
      wrap.appendChild(el);
      startChatTurn().appendChild(wrap);
      keepStatusAtEnd();
      if (shouldScroll) {
        scrollToBottom();
      }
      return el;
    }

    if (role === "assistant" && typeof index === "number") {
      const wrap = document.createElement("div");
      wrap.className = "msg-wrap msg-wrap-assistant";
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const showRegen =
        regenAssistantIndex >= 0 &&
        index === regenAssistantIndex &&
        canRegenerate;
      actions.innerHTML = assistantActionsHtml(index, showRegen);
      wrap.appendChild(el);
      wrap.appendChild(actions);
      ensureChatTurn().appendChild(wrap);
      keepStatusAtEnd();
      if (shouldScroll) {
        scrollToBottom();
      }
      return el;
    }

    ensureChatTurn().appendChild(el);
    keepStatusAtEnd();
    if (shouldScroll) {
      scrollToBottom();
    }
    return el;
  }

  function renderMessages(list, scrollMode = "bottom", restoredScrollTop) {
    restoringChatScroll = true;
    // Full remount destroys DOM nodes — drop the streaming ref so later
    // assistantDelta/Done do not paint into a detached element (invisible
    // until the next chat remount from store).
    streamingEl = null;
    streamingRenderScheduled = false;
    messagesEl.innerHTML = "";
    resetChatTurns();
    uiMessagesCache = Array.isArray(list) ? list : [];
    if (!Array.isArray(list)) {
      restoringChatScroll = false;
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
        item.attachments,
        false,
        item.reasoning,
        item.step,
        item.detail
      );
    }
    restoreAgentStatus();
    syncComposerScmFromCache();
    syncComposerPlanFromCache({ openEditor: false });
    focusEditingInput();
    requestAnimationFrame(() => {
      if (scrollMode === "restore") {
        restoreChatScroll(restoredScrollTop);
      } else {
        scrollToBottom({ force: true });
      }
      restoringChatScroll = false;
    });
    if (chatSearchOpen && chatSearchInput) {
      applyInChatSearchHighlights(chatSearchInput.value);
    }
  }

  function getSelectedModel() {
    return selectedModelId;
  }

  function updateTriggerLabel() {
    if (!modelLabel) {
      return;
    }
    const model = models.find((m) => m.id === selectedModelId);
    const full = model
      ? model.label || model.id
      : selectedModelId || t("noModels");
    modelLabel.textContent = shortModelChip(full);
    if (modelTrigger) {
      modelTrigger.title = full;
    }
  }

  function updateVisionUi() {
    if (!composerPlusMenu) {
      return;
    }
    const fileItem = composerPlusMenu.querySelector(
      '.composer-plus-item[data-action="file"]'
    );
    if (fileItem) {
      fileItem.title = t("attachFile");
    }
  }

  /** Ignore briefly-stale host selectedModel after a local picker change. */
  let localModelChangeAt = 0;
  const LOCAL_MODEL_GUARD_MS = 5000;

  function setSelectedModel(id, notify) {
    const next = String(id || "").trim();
    selectedModelId = next;
    state.selectedModel = selectedModelId;
    if (activeChatId) {
      state.modelByChat[activeChatId] = selectedModelId;
    }
    host.setState(state);
    updateTriggerLabel();
    updateVisionUi();
    applySelectedReasoningEffort(
      activeChatId ? state.reasonByChat[activeChatId] : selectedReasoningEffort,
      { notify: false }
    );
    if (notify && selectedModelId) {
      localModelChangeAt = Date.now();
      host.postMessage({
        type: "modelChanged",
        model: selectedModelId,
        chatId: activeChatId || "",
      });
    }
  }

  function resolvePreferredModelId(preferredId, forceHost = false) {
    const fromHost = String(preferredId || "").trim();
    // При переключении чата / init / regenerate модель хоста авторитетна —
    // не даём локальному guard перекрывать модель нового чата.
    if (forceHost) {
      localModelChangeAt = 0;
      if (fromHost && models.some((m) => m.id === fromHost)) {
        return fromHost;
      }
      if (activeChatId && state.modelByChat[activeChatId]) {
        const fromChat = String(state.modelByChat[activeChatId] || "").trim();
        if (fromChat && models.some((m) => m.id === fromChat)) {
          return fromChat;
        }
      }
      return selectedModelId && models.some((m) => m.id === selectedModelId)
        ? selectedModelId
        : fromHost;
    }
    const localIsFresh =
      localModelChangeAt > 0 &&
      Date.now() - localModelChangeAt < LOCAL_MODEL_GUARD_MS &&
      selectedModelId &&
      models.some((m) => m.id === selectedModelId);
    if (localIsFresh) {
      return selectedModelId;
    }
    if (fromHost && models.some((m) => m.id === fromHost)) {
      return fromHost;
    }
    if (activeChatId && state.modelByChat[activeChatId]) {
      const fromChat = String(state.modelByChat[activeChatId] || "").trim();
      if (fromChat && models.some((m) => m.id === fromChat)) {
        return fromChat;
      }
    }
    if (selectedModelId && models.some((m) => m.id === selectedModelId)) {
      return selectedModelId;
    }
    if (fromHost) {
      return models[0]?.id || "";
    }
    return models[0]?.id || "";
  }

  function fillModels(nextModels, preferredId, forceHost = false) {
    const incoming = Array.isArray(nextModels) ? nextModels : [];
    models = incoming.length ? incoming : DEFAULT_MODELS.slice();
    const preferred = resolvePreferredModelId(preferredId, forceHost);
    setSelectedModel(preferred, false);
    if (menuOpen) {
      renderMenu();
    }
  }

  function renderMenu() {
    modelMenu.innerHTML = "";
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "model-option is-empty";
      empty.textContent = t("noModelsInSettings");
      modelMenu.appendChild(empty);
      return;
    }

    for (const model of models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (model.id === selectedModelId ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("data-model-id", model.id);
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
    closePlusMenu();
    closeModeMenu();
    closeReasonMenu();
    menuOpen = true;
    renderMenu();
    modelPicker.classList.add("is-open");
    modelTrigger.setAttribute("aria-expanded", "true");
    modelMenu.hidden = false;
    placeModelMenu(modelPicker, modelMenu, chatScreen);
  }

  function closeMenu() {
    menuOpen = false;
    modelPicker.classList.remove("is-open");
    modelTrigger.setAttribute("aria-expanded", "false");
    modelMenu.hidden = true;
    resetModelMenuPlacement(modelPicker, modelMenu);
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
    resetModelMenuPlacement(composerPlusEl, composerPlusMenu);
  }

  function openPlusMenu() {
    closeMenu();
    closeModeMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    closeEditPlusMenu();
    closeEditReasonMenu();
    plusMenuOpen = true;
    if (composerPlusEl) {
      composerPlusEl.classList.add("is-open");
    }
    if (composerPlusBtn) {
      composerPlusBtn.setAttribute("aria-expanded", "true");
    }
    if (composerPlusMenu) {
      composerPlusMenu.hidden = false;
      placeModelMenu(composerPlusEl, composerPlusMenu, chatScreen);
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
    for (const sourceMode of modes) {
      const mode = localizeModeMeta(sourceMode);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" + (mode.id === agentMode ? " is-active" : "");
      btn.dataset.mode = mode.id;
      applyModeAccentToElement(btn, mode.id);
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
    addLabel.textContent = t("addMode");
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
    resetModelMenuPlacement(modePicker, modeMenu);
  }

  function openModeMenu() {
    closeMenu();
    closePlusMenu();
    closeReasonMenu();
    closeEditModelMenu();
    closeEditModeMenu();
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
      placeModelMenu(modePicker, modeMenu, chatScreen);
    }
  }

  function toggleModeMenu() {
    if (modeMenuOpen) {
      closeModeMenu();
    } else {
      openModeMenu();
    }
  }

  function setAgentMode(next, { focus = false, close = true, notify = true } = {}) {
    agentMode = normalizeAgentModeUi(next);
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const meta = localizeModeMeta(
      modes.find((m) => m.id === agentMode) || modes[0] || {
      id: "agent",
      label: t("agent"),
      placeholder: t("taskPlaceholder"),
      }
    );
    if (activeChatId) {
      state.modeByChat[activeChatId] = agentMode;
      host.setState(state);
    }
    if (modePicker) {
      applyModeAccentToElement(modePicker, agentMode);
    }
    if (composerEl) {
      applyModeAccentToElement(composerEl, agentMode);
    }
    if (modeLabel) {
      modeLabel.textContent = meta.label || meta.id;
    }
    if (modeTrigger) {
      modeTrigger.title = meta.description
        ? `${meta.label}: ${meta.description}`
        : meta.label || t("mode");
    }
    if (modeMenu && !modeMenu.hidden) {
      renderModeMenu();
      placeModelMenu(modePicker, modeMenu, chatScreen);
    }
    if (promptEl) {
      promptEl.placeholder =
        meta.placeholder || t("taskPlaceholder");
    }
    if (close) {
      closeModeMenu();
    }
    if (focus && promptEl && typeof promptEl.focus === "function") {
      promptEl.focus();
    }
    if (notify && agentMode) {
      host.postMessage({
        type: "modeChanged",
        mode: agentMode,
        chatId: activeChatId || "",
      });
    }
  }

  function resolvePreferredModeId(preferredId) {
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const fromHost = String(preferredId || "").trim();
    if (fromHost && modes.some((m) => m.id === fromHost)) {
      return fromHost;
    }
    if (activeChatId && state.modeByChat[activeChatId]) {
      const fromChat = String(state.modeByChat[activeChatId] || "").trim();
      if (fromChat && modes.some((m) => m.id === fromChat)) {
        return fromChat;
      }
    }
    if (fromHost) {
      return modes[0]?.id || "agent";
    }
    return modes.some((m) => m.id === "agent")
      ? "agent"
      : modes[0]?.id || "agent";
  }

  function applySelectedMode(preferredId, { notify = false } = {}) {
    setAgentMode(resolvePreferredModeId(preferredId), {
      close: false,
      notify,
    });
  }

  const REASON_LEVELS = [
    { id: "low", labelKey: "reasonLow" },
    { id: "medium", labelKey: "reasonMedium" },
    { id: "high", labelKey: "reasonHigh" },
    { id: "xhigh", labelKey: "reasonExtraHigh" },
  ];

  function normalizeReasonLevel(value) {
    const id = String(value || "")
      .trim()
      .toLowerCase();
    if (id === "extra" || id === "extra-high" || id === "extrahigh" || id === "extra_high" || id === "max") {
      return "xhigh";
    }
    return REASON_LEVELS.some((item) => item.id === id) ? id : "";
  }

  function reasonLevelLabel(id) {
    const level = REASON_LEVELS.find((item) => item.id === id);
    return level ? t(level.labelKey) : t("reasonMedium");
  }

  function modelSupportsReasoning(modelId) {
    const id = String(modelId || selectedModelId || "").trim();
    const model = models.find((m) => m.id === id);
    return model?.supportsReasoningEffort === true;
  }

  function defaultReasonForModel(modelId) {
    const id = String(modelId || selectedModelId || "").trim();
    const model = models.find((m) => m.id === id);
    return (
      normalizeReasonLevel(model?.reasoningEffortDefault) ||
      normalizeReasonLevel(model?.reasoningEffort) ||
      "medium"
    );
  }

  function resolvePreferredReasonLevel(preferredId, modelId) {
    if (!modelSupportsReasoning(modelId || selectedModelId)) {
      return "";
    }
    const fromHost = normalizeReasonLevel(preferredId);
    if (fromHost) {
      return fromHost;
    }
    if (activeChatId && state.reasonByChat[activeChatId]) {
      const fromChat = normalizeReasonLevel(state.reasonByChat[activeChatId]);
      if (fromChat) {
        return fromChat;
      }
    }
    const current = normalizeReasonLevel(selectedReasoningEffort);
    if (current) {
      return current;
    }
    return defaultReasonForModel(modelId || selectedModelId);
  }

  function updateReasonPickerVisibility() {
    if (!reasonPicker) {
      return;
    }
    const supported = modelSupportsReasoning(selectedModelId);
    reasonPicker.hidden = !supported;
    if (!supported) {
      closeReasonMenu();
    }
  }

  function renderReasonMenu() {
    if (!reasonMenu) {
      return;
    }
    reasonMenu.innerHTML = "";
    for (const level of REASON_LEVELS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "model-option" +
        (level.id === selectedReasoningEffort ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.dataset.reason = level.id;
      const label = document.createElement("span");
      label.className = "model-option-label";
      label.textContent = t(level.labelKey);
      btn.appendChild(label);
      if (level.id === selectedReasoningEffort) {
        const check = document.createElement("span");
        check.className = "model-check";
        check.innerHTML = CHECK_ICON;
        btn.appendChild(check);
      }
      reasonMenu.appendChild(btn);
    }
  }

  function closeReasonMenu() {
    reasonMenuOpen = false;
    if (reasonPicker) {
      reasonPicker.classList.remove("is-open");
    }
    if (reasonTrigger) {
      reasonTrigger.setAttribute("aria-expanded", "false");
    }
    if (reasonMenu) {
      reasonMenu.hidden = true;
      resetModelMenuPlacement(reasonPicker, reasonMenu);
    }
  }

  function openReasonMenu() {
    if (!reasonPicker || reasonPicker.hidden) {
      return;
    }
    closePlusMenu();
    closeMenu();
    closeModeMenu();
    closeEditModelMenu();
    closeEditModeMenu();
    renderReasonMenu();
    reasonMenuOpen = true;
    reasonPicker.classList.add("is-open");
    if (reasonTrigger) {
      reasonTrigger.setAttribute("aria-expanded", "true");
    }
    if (reasonMenu) {
      reasonMenu.hidden = false;
      placeModelMenu(reasonPicker, reasonMenu, chatScreen);
    }
  }

  function toggleReasonMenu() {
    if (reasonMenuOpen) {
      closeReasonMenu();
    } else {
      openReasonMenu();
    }
  }

  function setReasoningEffort(
    next,
    { close = true, notify = true, modelId } = {}
  ) {
    if (!modelSupportsReasoning(modelId || selectedModelId)) {
      selectedReasoningEffort = "";
      updateReasonPickerVisibility();
      if (close) {
        closeReasonMenu();
      }
      return;
    }
    const level =
      normalizeReasonLevel(next) ||
      defaultReasonForModel(modelId || selectedModelId);
    selectedReasoningEffort = level;
    if (activeChatId) {
      state.reasonByChat[activeChatId] = level;
      host.setState(state);
    }
    if (reasonLabel) {
      reasonLabel.textContent = reasonLevelLabel(level);
    }
    if (reasonTrigger) {
      reasonTrigger.title = `${t("intelligence")}: ${reasonLevelLabel(level)}`;
    }
    if (reasonMenu && !reasonMenu.hidden) {
      renderReasonMenu();
    }
    updateReasonPickerVisibility();
    if (close) {
      closeReasonMenu();
    }
    if (notify && level) {
      host.postMessage({
        type: "reasoningEffortChanged",
        reasoningEffort: level,
        chatId: activeChatId || "",
      });
    }
  }

  function applySelectedReasoningEffort(preferredId, { notify = false } = {}) {
    setReasoningEffort(resolvePreferredReasonLevel(preferredId), {
      close: false,
      notify,
    });
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    // Keep composer editable while a run is active so the user can queue
    // the next message. Model/mode/plus stay available for that draft.
    promptEl.disabled = false;
    modelTrigger.disabled = false;
    if (composerPlusBtn) {
      composerPlusBtn.disabled = false;
    }
    if (modeTrigger) {
      modeTrigger.disabled = false;
    }
    if (reasonTrigger) {
      reasonTrigger.disabled = false;
    }
    if (composerScmActionsEl) {
      const commitBtn = composerScmActionsEl.querySelector(".review-commit-push");
      if (commitBtn) {
        commitBtn.disabled = busy;
      }
    }
    if (composerPlanActionsEl) {
      const planBtn = composerPlanActionsEl.querySelector(".composer-plan-build");
      if (planBtn) {
        planBtn.disabled = busy;
      }
    }
    if (busy) {
      closePlusMenu();
      closeModeMenu();
      closeSlashMenu();
      closeMentionMenu();
      if (currentChatTurnEl && messagesEl.contains(currentChatTurnEl)) {
        ensureActiveToolGroup();
      }
    }
    updateSendButton();
    if (!busy) {
      focusPrompt();
    }
  }

  function setIdleAndDrain() {
    setBusy(false);
    if (drainScheduled) {
      return;
    }
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      tryDrainQueue();
    });
  }

  updateSendButton();

  // сразу показать модель, не дожидаясь init
  fillModels(DEFAULT_MODELS, "");

  function selectModelById(id) {
    const next = String(id || "").trim();
    if (!next) {
      closeMenu();
      return;
    }
    setSelectedModel(next, true);
    closeMenu();
  }

  function modelIdFromOption(option) {
    if (!(option instanceof Element)) {
      return "";
    }
    return (
      option.getAttribute("data-model-id") ||
      option.getAttribute("data-id") ||
      option.dataset.id ||
      ""
    );
  }

  function selectModelFromEvent(event) {
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    const option =
      event.target instanceof Element
        ? event.target.closest(".model-option")
        : null;
    if (!option || option.classList.contains("is-empty")) {
      return false;
    }
    selectModelById(modelIdFromOption(option));
    return true;
  }

  modelTrigger.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  modelTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  });

  // Do NOT preventDefault on mousedown/pointerdown: in VS Code webviews that
  // often suppresses the following click. Only stopPropagation so the floated
  // menu is not closed by the document outside-click handler.
  modelMenu.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  modelMenu.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  // Select on pointerup (primary). click remains for keyboard activation.
  modelMenu.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectModelFromEvent(event);
  });

  modelMenu.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectModelFromEvent(event);
  });

  document.addEventListener("pointerup", (event) => {
    if (editModeMenuOpen && selectEditingModeFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (editReasonMenuOpen && selectEditingReasonFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (editPlusMenuOpen && selectEditPlusItemFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!editModelMenuOpen) {
      return;
    }
    if (selectEditingModelFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  document.addEventListener("click", (event) => {
    if (editModeMenuOpen) {
      const editModeOption = event.target.closest(
        ".msg-edit-mode-menu .model-option"
      );
      if (editModeOption && !editModeOption.classList.contains("is-empty")) {
        event.preventDefault();
        event.stopPropagation();
        selectEditingMode(String(editModeOption.dataset.mode || "").trim());
        return;
      }
    }
    if (editReasonMenuOpen) {
      const editReasonOption = event.target.closest(
        ".msg-edit-reason-menu .model-option"
      );
      if (editReasonOption) {
        event.preventDefault();
        event.stopPropagation();
        selectEditingReasoningEffort(
          String(editReasonOption.dataset.reason || "")
        );
        return;
      }
    }
    if (editPlusMenuOpen && selectEditPlusItemFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!editModelMenuOpen) {
      return;
    }
    const editModelOption = event.target.closest(
      ".msg-edit-model-menu .model-option"
    );
    if (!editModelOption) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!editModelOption.classList.contains("is-empty")) {
      selectEditingModel(editingModelIdFromOption(editModelOption));
    }
  });

  document.addEventListener("mousedown", (event) => {
    const target = event.target;
    const targetNode = target instanceof Node ? target : null;
    const inModelMenu =
      Boolean(targetNode && modelMenu.contains(targetNode)) ||
      Boolean(
        target instanceof Element &&
          target.closest("#modelMenu, .model-menu.is-fixed")
      );
    if (
      menuOpen &&
      targetNode &&
      !modelPicker.contains(targetNode) &&
      !inModelMenu
    ) {
      closeMenu();
    }
    const inPlusMenu =
      Boolean(
        composerPlusEl &&
          targetNode &&
          composerPlusEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element &&
          target.closest("#composerPlusMenu, .composer-plus-menu.is-fixed")
      );
    if (plusMenuOpen && !inPlusMenu) {
      closePlusMenu();
    }
    if (
      modeMenuOpen &&
      !(
        (modePicker && targetNode && modePicker.contains(targetNode)) ||
        (target instanceof Element && target.closest("#modeMenu"))
      )
    ) {
      closeModeMenu();
    }
    if (
      reasonMenuOpen &&
      !(
        (reasonPicker && targetNode && reasonPicker.contains(targetNode)) ||
        (target instanceof Element && target.closest("#reasonMenu"))
      )
    ) {
      closeReasonMenu();
    }
    if (
      mentionOpen &&
      mentionMenuEl &&
      !mentionMenuEl.contains(event.target) &&
      event.target !== mentionTarget
    ) {
      closeMentionMenu();
    }
    const editModelPickerEl = getEditModelPicker();
    const editModelMenuEl = findEditModelMenu(editModelPickerEl);
    const editModePickerEl = getEditModePicker();
    const editModeMenuEl = findEditModeMenu(editModePickerEl);
    const editPlusPickerEl = getEditPlusPicker();
    const editPlusMenuEl = findEditPlusMenu(editPlusPickerEl);
    const editReasonPickerEl = getEditReasonPicker();
    const editReasonMenuEl = findEditReasonMenu(editReasonPickerEl);
    const inEditModelMenu =
      Boolean(
        editModelMenuEl && targetNode && editModelMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-model-menu")
      );
    const inEditModeMenu =
      Boolean(
        editModeMenuEl && targetNode && editModeMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-mode-menu")
      );
    const inEditPlusMenu =
      Boolean(
        editPlusMenuEl && targetNode && editPlusMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-plus-menu")
      );
    const inEditReasonMenu =
      Boolean(
        editReasonMenuEl && targetNode && editReasonMenuEl.contains(targetNode)
      ) ||
      Boolean(
        target instanceof Element && target.closest(".msg-edit-reason-menu")
      );
    if (editModelMenuOpen) {
      const inPicker =
        editModelPickerEl &&
        targetNode &&
        editModelPickerEl.contains(targetNode);
      if (!inPicker && !inEditModelMenu) {
        closeEditModelMenu();
      }
    }
    if (editModeMenuOpen) {
      const inPicker =
        editModePickerEl &&
        targetNode &&
        editModePickerEl.contains(targetNode);
      if (!inPicker && !inEditModeMenu) {
        closeEditModeMenu();
      }
    }
    if (editPlusMenuOpen) {
      const inPicker =
        editPlusPickerEl &&
        targetNode &&
        editPlusPickerEl.contains(targetNode);
      if (!inPicker && !inEditPlusMenu) {
        closeEditPlusMenu();
      }
    }
    if (editReasonMenuOpen) {
      const inPicker =
        editReasonPickerEl &&
        targetNode &&
        editReasonPickerEl.contains(targetNode);
      if (!inPicker && !inEditReasonMenu) {
        closeEditReasonMenu();
      }
    }
    // Floated edit menus live on document.body — must not cancel the edit.
    // Save/resend is inside the composer; still exclude it explicitly so a
    // VS Code webview retarget (sticky user bubble) cannot abort the click.
    const inEditSave =
      target instanceof Element &&
      Boolean(target.closest(".msg-edit-save, .msg-edit-footer-right"));
    if (Number.isInteger(editingUserIndex) && !busy) {
      const composer = messagesEl.querySelector(".msg-edit-composer");
      if (
        composer &&
        targetNode &&
        !composer.contains(targetNode) &&
        !inEditModelMenu &&
        !inEditModeMenu &&
        !inEditPlusMenu &&
        !inEditReasonMenu &&
        !inEditSave
      ) {
        cancelEditingUserMessage();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && imgLightboxEl && !imgLightboxEl.hidden) {
      closeImgLightbox();
      return;
    }
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
    if (event.key === "Escape" && reasonMenuOpen) {
      closeReasonMenu();
    }
    if (event.key === "Escape" && editModelMenuOpen) {
      closeEditModelMenu();
    }
    if (event.key === "Escape" && editModeMenuOpen) {
      closeEditModeMenu();
    }
    if (event.key === "Escape" && editPlusMenuOpen) {
      closeEditPlusMenu();
    }
    if (event.key === "Escape" && editReasonMenuOpen) {
      closeEditReasonMenu();
    }
  });


  function sendPrompt() {
    const rawInput = promptEl.value || "";
    const command = parseSlashCommand(rawInput);
    let typed = rawInput.trim();
    let modeForSend = agentMode;
    if (command) {
      if (command.mode !== "inherit") {
        setAgentMode(command.mode, { close: true });
        modeForSend = normalizeAgentModeUi(command.mode);
      }
      if (command.kind === "mode" && !command.sendText) {
        promptEl.value = "";
        autoResizePrompt();
        clearDraftPrompt();
        closeMentionMenu();
        showCopyToast(t("slashModeSwitched", modeLabel ? modeLabel.textContent : command.mode));
        focusPrompt();
        updateSendButton();
        return;
      }
      typed = command.sendText;
    }
    const text = buildMessageWithSelections(buildMessageWithMentions(typed));
    const attachments = pendingAttachments.slice();
    if (!text && !attachments.length) {
      return;
    }
    if (busy) {
      const queued = enqueueComposerMessage({
        text,
        attachments,
        mode: modeForSend,
        model: getSelectedModel(),
        reasoningEffort: selectedReasoningEffort || undefined,
      });
      if (!queued) {
        return;
      }
      promptEl.value = "";
      autoResizePrompt();
      clearDraftPrompt();
      clearPendingAttachments();
      clearPendingSelections();
      clearPendingMentions();
      closeSlashMenu();
      closeMentionMenu();
      updateSendButton();
      focusPrompt();
      return;
    }
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingModeId = "";
    editingAttachments = [];
    stickToBottom = true;
    uiMessagesCache.push({
      role: "user",
      text,
      attachments,
      mode: modeForSend,
    });
    appendMessage("user", text, uiMessagesCache.length - 1, -1, attachments);
    promptEl.value = "";
    autoResizePrompt();
    clearDraftPrompt();
    clearPendingAttachments();
    clearPendingSelections();
    clearPendingMentions();
    closeSlashMenu();
    closeMentionMenu();
    setBusy(true);
    pinChatToBottom();
    host.postMessage({
      type: "send",
      text,
      model: getSelectedModel(),
      agentMode: modeForSend,
      reasoningEffort: selectedReasoningEffort || undefined,
      attachments: attachments.map(attachmentPayload),
    });
  }

  function activateSendButton(event) {
    if (event && typeof event.button === "number" && event.button !== 0) {
      return;
    }
    if (Date.now() - harborEditSaveAt < 450) {
      return;
    }
    harborEditSaveAt = Date.now();
    if (busy) {
      if (composerHasContent()) {
        sendPrompt();
        return;
      }
      host.postMessage({ type: "stop" });
      return;
    }
    sendPrompt();
  }

  sendBtn.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    activateSendButton(event);
  });
  sendBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateSendButton(event);
  });

  if (messageQueueEl) {
    messageQueueEl.addEventListener("click", (event) => {
      const removeBtn =
        event.target instanceof Element
          ? event.target.closest(".message-queue-remove")
          : null;
      if (removeBtn && messageQueueEl.contains(removeBtn)) {
        event.preventDefault();
        event.stopPropagation();
        removeQueuedMessage(removeBtn.dataset.queueId || "");
        return;
      }
      const item =
        event.target instanceof Element
          ? event.target.closest(".message-queue-item")
          : null;
      if (!item || !messageQueueEl.contains(item)) {
        return;
      }
      event.preventDefault();
      restoreQueuedMessage(item.dataset.queueId || "");
    });
    messageQueueEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const item =
        event.target instanceof Element
          ? event.target.closest(".message-queue-item")
          : null;
      if (!item || !messageQueueEl.contains(item)) {
        return;
      }
      event.preventDefault();
      restoreQueuedMessage(item.dataset.queueId || "");
    });
  }

  if (composerPlusBtn) {
    let plusPointerHandled = false;
    // JCEF OSR often skips `click` after pointerdown; open on pointerdown.
    composerPlusBtn.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      plusPointerHandled = true;
      event.preventDefault();
      event.stopPropagation();
      togglePlusMenu();
      setTimeout(() => {
        plusPointerHandled = false;
      }, 0);
    });
    composerPlusBtn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (plusPointerHandled || event.button !== 0) {
        return;
      }
      togglePlusMenu();
    });
    composerPlusBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  if (modeTrigger) {
    let modePointerHandled = false;
    modeTrigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      modePointerHandled = true;
      event.preventDefault();
      event.stopPropagation();
      toggleModeMenu();
      setTimeout(() => {
        modePointerHandled = false;
      }, 0);
    });
    modeTrigger.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (modePointerHandled || event.button !== 0) {
        return;
      }
      toggleModeMenu();
    });
    modeTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  if (modeMenu) {
    modeMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    modeMenu.addEventListener("pointerdown", (event) => {
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
      if (!option || option.dataset.action === "add-mode") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setAgentMode(option.dataset.mode, { focus: true });
    });
  }

  if (reasonTrigger) {
    reasonTrigger.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    reasonTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (reasonPicker && reasonPicker.hidden) {
        return;
      }
      toggleReasonMenu();
    });
  }

  if (reasonMenu) {
    reasonMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    reasonMenu.addEventListener("click", (event) => {
      const option = event.target.closest(".model-option");
      if (!option) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setReasoningEffort(option.dataset.reason, { focus: false });
    });
  }

  setAgentMode(agentMode, { close: false, notify: false });
  syncModeAccentStyles();
  renderModeMenu();
  applySelectedReasoningEffort(selectedReasoningEffort, { notify: false });

  if (composerPlusMenu) {
    composerPlusMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    composerPlusMenu.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    composerPlusMenu.addEventListener("click", (event) => {
      const item = event.target.closest(".composer-plus-item");
      if (!item || item.disabled || item.classList.contains("is-disabled")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = item.getAttribute("data-action");
      closePlusMenu();
      if (action === "file") {
        pickAttachmentsForEdit = false;
        host.postMessage({ type: "pickAttachments" });
      }
    });
  }

  if (attachPreviewEl) {
    attachPreviewEl.addEventListener("click", (event) => {
      const mentionRemove = event.target.closest(".mention-chip-remove");
      if (mentionRemove) {
        event.preventDefault();
        event.stopPropagation();
        removePendingMention(mentionRemove.getAttribute("data-id"));
        return;
      }
      const mentionChip = event.target.closest(".composer-mention-chip");
      if (mentionChip) {
        event.preventDefault();
        const path = mentionChip.getAttribute("data-path");
        if (path) {
          host.postMessage({ type: "openFile", path });
        }
        return;
      }
      const btn = event.target.closest(".attach-chip-remove");
      if (!btn) {
        return;
      }
      event.preventDefault();
      removePendingAttachment(btn.getAttribute("data-id"));
    });
  }

  if (selectionPreviewEl) {
    selectionPreviewEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".selection-chip-remove");
      if (!btn) {
        return;
      }
      event.preventDefault();
      removePendingSelection(btn.getAttribute("data-id"));
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
      const uris = extractDropUris(event.dataTransfer);
      if (uris.length) {
        host.postMessage({ type: "attachUris", uris });
        return;
      }
      if (event.dataTransfer?.files?.length) {
        void ingestDroppedFiles(event.dataTransfer.files);
        return;
      }
      showCopyToast(t("failedReadFile"));
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
    if (!chatScreen || chatScreen.hidden) {
      return;
    }
    let imageFiles = extractClipboardImages(event.clipboardData);
    if (!imageFiles.length) {
      imageFiles = await readClipboardImagesFallback();
    }
    if (!imageFiles.length) {
      // JCEF / JetBrains: clipboard images rarely appear in paste event —
      // ask the IDE host to read the system clipboard.
      if (harborHostAvailable()) {
        event.preventDefault();
        event.stopPropagation();
        host.postMessage({ type: "requestClipboardImage" });
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
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
    if (!isPaste || !chatScreen || chatScreen.hidden) {
      return;
    }
    // Если фокус не в поле ввода — всё равно даём шанс прочитать буфер
    const active = document.activeElement;
    const inPrompt = active === promptEl;
    if (inPrompt) {
      // Still help JetBrains: paste event may arrive empty for images.
      if (harborHostAvailable()) {
        // Let native paste run for text; also probe host clipboard for images.
        // Host will no-op if clipboard has no image.
        setTimeout(() => {
          host.postMessage({ type: "requestClipboardImage" });
        }, 0);
      }
      return;
    }
    void (async () => {
      const imageFiles = await readClipboardImagesFallback();
      if (imageFiles.length) {
        event.preventDefault();
        await ingestDroppedFiles(imageFiles);
        if (promptEl && typeof promptEl.focus === "function") {
          promptEl.focus();
        }
        return;
      }
      if (harborHostAvailable()) {
        host.postMessage({ type: "requestClipboardImage" });
      }
    })();
  });

  if (newAgentBtn) {
    newAgentBtn.addEventListener("click", () => {
      host.postMessage({ type: "newAgent" });
    });
  }

  if (chatNewAgentBtn) {
    chatNewAgentBtn.addEventListener("click", () => {
      host.postMessage({ type: "newAgent" });
    });
  }

  if (openArchiveBtn) {
    openArchiveBtn.addEventListener("click", () => {
      host.postMessage({ type: "showArchive" });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      host.postMessage({ type: "showSettings" });
    });
  }

  if (backFromArchiveBtn) {
    backFromArchiveBtn.addEventListener("click", () => {
      host.postMessage({ type: "showAgents" });
    });
  }

  if (deleteAllArchiveBtn) {
    deleteAllArchiveBtn.addEventListener("click", () => {
      host.postMessage({ type: "deleteAllArchived" });
    });
  }

  const settingsBody = document.getElementById("settingsBody");
  if (settingsSystemPromptToggle && settingsSystemPromptCard) {
    settingsSystemPromptToggle.addEventListener("click", () => {
      const open = !settingsSystemPromptCard.classList.contains("is-open");
      settingsSystemPromptCard.classList.toggle("is-open", open);
      settingsSystemPromptToggle.setAttribute(
        "aria-expanded",
        open ? "true" : "false"
      );
      if (settingsSystemPromptBody) {
        settingsSystemPromptBody.hidden = !open;
      }
      if (open && settingsSystemPrompt) {
        settingsSystemPrompt.focus();
      }
    });
  }
  if (settingsTabExcludeToggle && settingsTabExcludeCard) {
    settingsTabExcludeToggle.addEventListener("click", () => {
      const open = !settingsTabExcludeCard.classList.contains("is-open");
      settingsTabExcludeCard.classList.toggle("is-open", open);
      settingsTabExcludeToggle.setAttribute(
        "aria-expanded",
        open ? "true" : "false"
      );
      if (settingsTabExcludeBody) {
        settingsTabExcludeBody.hidden = !open;
      }
      if (open && settingsTabAutocompleteExcludeGlobs) {
        settingsTabAutocompleteExcludeGlobs.focus();
      }
    });
  }
  if (settingsCommitPromptToggle && settingsCommitPromptCard) {
    settingsCommitPromptToggle.addEventListener("click", () => {
      const open = !settingsCommitPromptCard.classList.contains("is-open");
      settingsCommitPromptCard.classList.toggle("is-open", open);
      settingsCommitPromptToggle.setAttribute(
        "aria-expanded",
        open ? "true" : "false"
      );
      if (settingsCommitPromptBody) {
        settingsCommitPromptBody.hidden = !open;
      }
      if (open && settingsCommitPrompt) {
        settingsCommitPrompt.focus();
      }
    });
  }
  if (settingsBody) {
    settingsBody.addEventListener("scroll", hideSettingsModelTip, { passive: true });
    settingsBody.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest(
          "#settingsSystemPrompt, #settingsCommitPrompt, #settingsMaxToolRounds, #settingsMaxTokens, #settingsMaxResponseChars, #settingsFontSize, #settingsAutoglmBinaryPath, #settingsTabAutocompleteExcludeGlobs"
        )
      ) {
        if (target.closest("#settingsSystemPrompt")) {
          updateSystemPromptPreview();
        }
        if (target.closest("#settingsCommitPrompt")) {
          updateCommitPromptPreview();
        }
        if (target.closest("#settingsTabAutocompleteExcludeGlobs")) {
          updateTabExcludePreview();
        }
        if (target.closest("#settingsFontSize")) {
          applyUiFontSize(settingsFontSize.value);
        }
        schedulePersistSettings();
      }
    });
    settingsBody.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest(
          "#settingsRejectUnauthorized, #settingsSoundNotificationsEnabled, #settingsSubagentsEnabled, #settingsParallelToolCallsEnabled, #settingsAutoCompactEnabled, #settingsToolsAutoApprove, #settingsCheckpointsEnabled, #settingsTabAutocompleteEnabled, #settingsTabAutocompleteModel, #settingsTabAutocompleteAggressiveness, #settingsTabAutocompleteAlternatives, #settingsTabAutocompleteNextEdit, #settingsTabAutocompleteShowMode, #settingsTabAutocompleteFim, #settingsSelectionHintsEnabled, #settingsCommitScope, #settingsCommitLanguage, #settingsCommitModel, #settingsAutoglmEnabled, #settingsAutoglmBrowser, #settingsAutoglmAutoApprove"
        )
      ) {
        persistSettingsNow();
      }
    });
  }

  if (skillsRefreshBtn) {
    skillsRefreshBtn.addEventListener("click", () => {
      host.postMessage({ type: "skillsRefreshList" });
    });
  }
  if (skillsFoldersList) {
    skillsFoldersList.addEventListener("click", (event) => {
      const openBtn = event.target.closest("[data-skills-open]");
      if (openBtn) {
        const path = openBtn.getAttribute("data-skills-open") || "";
        if (path) {
          host.postMessage({ type: "skillsOpenPath", path });
        }
        return;
      }
      const removeBtn = event.target.closest("[data-skills-remove-dir]");
      if (removeBtn) {
        const path = removeBtn.getAttribute("data-skills-remove-dir") || "";
        if (path) {
          host.postMessage({ type: "skillsRemoveDirectory", path });
        }
      }
    });
    skillsFoldersList.addEventListener("change", (event) => {
      const toggle = event.target.closest("[data-skills-source-toggle]");
      if (!toggle) {
        return;
      }
      const source = toggle.getAttribute("data-skills-source-toggle") || "";
      const path = toggle.getAttribute("data-skills-source-path") || "";
      host.postMessage({
        type: "skillsSetSourceEnabled",
        source,
        path,
        enabled: toggle.checked === true,
      });
    });
  }

  if (openMcpServersBtn) {
    openMcpServersBtn.addEventListener("click", () => {
      showScreen("settings");
      showSettingsCategory("mcp");
    });
  }
  const settingsNav = document.getElementById("settingsNav");
  if (settingsNav) {
    settingsNav.addEventListener("click", (event) => {
      const btn = event.target.closest(".settings-nav-item");
      if (!btn) {
        return;
      }
      const cat = btn.getAttribute("data-settings-cat");
      if (cat) {
        showSettingsCategory(cat);
      }
    });
  }
  if (backFromMcpBtn) {
    backFromMcpBtn.addEventListener("click", () => {
      closeMcpEditModal();
      showSettingsCategory("models");
    });
  }
  if (mcpSearchInput) {
    mcpSearchInput.addEventListener("input", () => {
      mcpSearchQuery = mcpSearchInput.value || "";
      renderMcpServersList();
    });
  }
  if (mcpAddBtn) {
    mcpAddBtn.addEventListener("click", () => {
      openMcpCustomEditModal("");
    });
  }
  if (mcpPresetPlaywright) {
    mcpPresetPlaywright.addEventListener("click", () => {
      openMcpPreset("playwright");
    });
  }
  if (mcpPresetGithub) {
    mcpPresetGithub.addEventListener("click", () => {
      openMcpPreset("github");
    });
  }
  if (mcpServersList) {
    mcpServersList.addEventListener("click", (event) => {
      const editBtn = event.target.closest(".mcp-edit-btn");
      if (editBtn) {
        openMcpEditModal(editBtn.dataset.id || "figma");
        return;
      }
      const deleteBtn = event.target.closest(".mcp-delete-btn");
      if (deleteBtn) {
        const id = deleteBtn.dataset.id || "";
        host.postMessage({ type: "mcpDeleteServer", id });
      }
    });
    mcpServersList.addEventListener("change", (event) => {
      const toggle = event.target.closest(".mcp-enable-toggle");
      if (!toggle) {
        return;
      }
      const id = toggle.dataset.id || "";
      const enabled = Boolean(toggle.checked);
      if (!enabled) {
        if (id === "figma") {
          figmaStatus = { ...figmaStatus, enabled: false };
        }
        host.postMessage({ type: "mcpSetEnabled", id, enabled: false });
        return;
      }
      if (id === "figma") {
        const server = getMcpServers().find((s) => s.id === "figma");
        const hasCreds =
          Boolean(server && server.hasCredentials) ||
          Boolean(figmaStatus.hasPat);
        if (!hasCreds) {
          toggle.checked = false;
          openMcpEditModal("figma");
          return;
        }
        figmaStatus = { ...figmaStatus, enabled: true };
      }
      host.postMessage({ type: "mcpSetEnabled", id, enabled: true });
    });
  }
  if (mcpEditCloseBtn) {
    mcpEditCloseBtn.addEventListener("click", () => closeMcpEditModal());
  }
  if (mcpEditModal) {
    mcpEditModal.addEventListener("click", (event) => {
      if (event.target?.dataset?.mcpDismiss === "1") {
        closeMcpEditModal();
      }
    });
  }
  if (mcpCustomEditCloseBtn) {
    mcpCustomEditCloseBtn.addEventListener("click", () =>
      closeMcpCustomEditModal()
    );
  }
  if (mcpCustomEditCancelBtn) {
    mcpCustomEditCancelBtn.addEventListener("click", () =>
      closeMcpCustomEditModal()
    );
  }
  if (mcpCustomEditSaveBtn) {
    mcpCustomEditSaveBtn.addEventListener("click", () => saveMcpCustomServer());
  }
  if (mcpCustomTransport) {
    mcpCustomTransport.addEventListener("change", () =>
      syncMcpCustomTransportFields()
    );
  }
  if (mcpCustomEditModal) {
    mcpCustomEditModal.addEventListener("click", (event) => {
      if (event.target?.dataset?.mcpCustomDismiss === "1") {
        closeMcpCustomEditModal();
      }
    });
  }

  if (settingsFigmaConnectBtn) {
    settingsFigmaConnectBtn.addEventListener("click", () => {
      host.postMessage({ type: "figmaConnect" });
    });
  }
  if (settingsFigmaDisconnectBtn) {
    settingsFigmaDisconnectBtn.addEventListener("click", () => {
      host.postMessage({ type: "figmaDisconnect" });
    });
  }
  if (settingsFigmaPatConnectBtn) {
    settingsFigmaPatConnectBtn.addEventListener("click", () => {
      const token = settingsFigmaPat ? settingsFigmaPat.value.trim() : "";
      host.postMessage({ type: "figmaConnectPat", token });
      if (settingsFigmaPat) {
        settingsFigmaPat.value = "";
      }
    });
  }
  if (settingsFigmaPatHelpBtn) {
    settingsFigmaPatHelpBtn.addEventListener("click", () => {
      host.postMessage({
        type: "openExternal",
        url: "https://www.figma.com/settings",
      });
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
        syncModeAccentStyles();
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
  if (modeEditColorRow) {
    modeEditColorRow.addEventListener("click", (event) => {
      const swatch =
        event.target instanceof Element
          ? event.target.closest(".mode-color-swatch")
          : null;
      if (swatch && modeEditColorRow.contains(swatch)) {
        event.preventDefault();
        setModeEditColor(swatch.getAttribute("data-color") || "");
      }
    });
  }
  if (modeEditColor) {
    modeEditColor.addEventListener("input", () => {
      const color = normalizeModeColorUi(modeEditColor.value);
      if (!modeEditColorRow || !color) {
        return;
      }
      modeEditColorRow.dataset.customActive = "1";
      modeEditColorRow
        .querySelectorAll(".mode-color-swatch")
        .forEach((btn) => btn.classList.remove("is-active"));
    });
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

  if (modelEditProvider) {
    modelEditProvider.addEventListener("change", () => {
      syncModelNewProviderFields();
      if (modelEditProvider.value === NEW_PROVIDER_VALUE) {
        modelEditNewProviderId?.focus();
      }
      if (modelEditMode === "api" && modelEditIndex === -1) {
        setModelEditMode("api");
      }
    });
  }

  if (modelEditApiFetchBtn) {
    modelEditApiFetchBtn.addEventListener("click", () => {
      const providerId = modelEditProvider?.value?.trim() || "";
      if (!providerId || providerId === NEW_PROVIDER_VALUE) {
        setFetchModelsHint(
          modelEditApiStatus,
          t("fetchModelsNeedProvider"),
          true
        );
        return;
      }
      requestProviderModels(providerId, "editApi");
    });
  }

  if (modelEditApiSelectNewBtn) {
    modelEditApiSelectNewBtn.addEventListener("click", () => {
      selectNewFetchModels();
    });
  }

  if (modelEditApiSearch) {
    modelEditApiSearch.addEventListener("input", () => {
      renderFetchModelsPicker();
    });
  }

  function bindFetchModelsDismiss(el) {
    if (!el) {
      return;
    }
    el.addEventListener("click", () => {
      closeFetchModelsModal();
    });
  }

  bindFetchModelsDismiss(fetchModelsCloseBtn);
  bindFetchModelsDismiss(fetchModelsCancelBtn);

  if (fetchModelsAddBtn) {
    fetchModelsAddBtn.addEventListener("click", () => {
      if (applyFetchedModels()) {
        closeFetchModelsModal();
      }
    });
  }

  if (fetchModelsSelectNewBtn) {
    fetchModelsSelectNewBtn.addEventListener("click", () => {
      selectNewFetchModels();
    });
  }

  if (fetchModelsSearch) {
    fetchModelsSearch.addEventListener("input", () => {
      renderFetchModelsPicker();
    });
  }

  if (fetchModelsModal) {
    fetchModelsModal.addEventListener("click", (event) => {
      if (event.target?.getAttribute?.("data-fetch-models-dismiss") === "1") {
        closeFetchModelsModal();
      }
    });
    fetchModelsModal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeFetchModelsModal();
      }
    });
  }

  if (settingsProvidersList) {
    settingsProvidersList.addEventListener("click", (event) => {
      const fetchBtn = event.target.closest(".settings-provider-fetch");
      if (fetchBtn) {
        const index = Number(fetchBtn.dataset.index);
        if (Number.isFinite(index)) {
          openFetchModelsModal(index);
        }
        return;
      }
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
      } else if (modelEditMode === "api") {
        modelEditApiFetchBtn?.focus();
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

  if (settingsLanguage) {
    settingsLanguage.addEventListener("change", () => {
      settingsLanguageValue = settingsLanguage.value || "auto";
      applyUiLanguage(effectiveUiLangFromSetting(settingsLanguageValue));
      schedulePersistSettings(0);
      if (harborHostAvailable()) {
        // JetBrains: no window reload — language already applied above.
        showCopyToast(t("saved"));
      } else {
        showCopyToast(
          UI_LANG === "ru" ? "Перезагрузка окна…" : "Reloading window…"
        );
      }
    });
  }

  if (toggleAgentsRailBtn) {
    toggleAgentsRailBtn.addEventListener("click", () => {
      setAgentsRailOpen(!agentsRailOpen);
    });
  }

  if (agentsRailBackdrop) {
    agentsRailBackdrop.addEventListener("click", () => {
      setAgentsRailOpen(false);
    });
  }

  if (workspaceShell && typeof ResizeObserver === "function") {
    const shellRo = new ResizeObserver(() => {
      updateWorkspaceNarrow();
      updateComposerCompact();
    });
    shellRo.observe(workspaceShell);
  }
  updateWorkspaceNarrow();
  updateComposerCompact();
  applyAgentsRailVisibility();

  if (chatBranchesEl) {
    const onBranchClosePointer = (event) => {
      if (event.button != null && event.button !== 0) {
        return;
      }
      const closeBtn = event.target.closest(".chat-branch-close");
      if (!closeBtn || !chatBranchesEl.contains(closeBtn)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Allow delete while a run is active — host aborts then deletes.
      // pointerdown + capture: JCEF OSR often drops click on tiny close targets.
      const chatId = closeBtn.getAttribute("data-chat-id") || "";
      if (!chatId) {
        return;
      }
      clearMessageQueue(chatId);
      host.postMessage({ type: "deleteBranch", chatId });
    };
    const onBranchSwitchPointer = (event) => {
      if (!harborHostAvailable()) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (event.target.closest(".chat-branch-close")) {
        return;
      }
      const pill = event.target.closest(".chat-branch-pill");
      if (!pill || !chatBranchesEl.contains(pill)) {
        return;
      }
      const chatId = pill.getAttribute("data-chat-id") || "";
      if (!chatId || chatId === activeChatId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      harborAgentNavAt = Date.now();
      host.postMessage({ type: "switchBranch", chatId });
      if (typeof forceHarborUiRepaint === "function") {
        forceHarborUiRepaint();
      }
    };
    const onBranchClick = (event) => {
      if (event.target.closest(".chat-branch-close")) {
        // Handled on pointerdown — do not also switch branch.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (Date.now() - harborAgentNavAt < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const pill = event.target.closest(".chat-branch-pill");
      if (!pill || !chatBranchesEl.contains(pill)) {
        return;
      }
      event.preventDefault();
      const chatId = pill.getAttribute("data-chat-id") || "";
      if (!chatId || chatId === activeChatId) {
        return;
      }
      host.postMessage({ type: "switchBranch", chatId });
    };
    chatBranchesEl.addEventListener("pointerdown", onBranchClosePointer, true);
    chatBranchesEl.addEventListener("pointerdown", onBranchSwitchPointer, true);
    chatBranchesEl.addEventListener("click", onBranchClick);
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
    const onArchivePointer = (event) => {
      if (!harborHostAvailable()) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn && archiveListEl.contains(deleteBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
            type: "deleteAgent",
            agentId: deleteBtn.dataset.deleteAgent,
          });
        }
        return;
      }
      const restoreBtn = event.target.closest(".row-restore");
      if (restoreBtn && archiveListEl.contains(restoreBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (restoreBtn.dataset.restoreAgent) {
          host.postMessage({
            type: "restoreAgent",
            agentId: restoreBtn.dataset.restoreAgent,
          });
        }
      }
    };
    archiveListEl.addEventListener("pointerdown", onArchivePointer, true);
    archiveListEl.addEventListener("click", (event) => {
      if (Date.now() - harborAgentNavAt < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
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
        host.postMessage({
          type: "restoreAgent",
          agentId: restoreBtn.dataset.restoreAgent,
        });
      }
    });
  }

  if (agentsListEl) {
    const onAgentsPointer = (event) => {
      if (!harborHostAvailable()) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (event.target.closest(".agent-name-input")) {
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn && agentsListEl.contains(deleteBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
            type: "deleteAgent",
            agentId: deleteBtn.dataset.deleteAgent,
          });
        }
        return;
      }
      const archiveBtn = event.target.closest(".row-archive");
      if (archiveBtn && agentsListEl.contains(archiveBtn)) {
        event.preventDefault();
        event.stopPropagation();
        harborAgentNavAt = Date.now();
        if (archiveBtn.dataset.archiveAgent) {
          host.postMessage({
            type: "archiveAgent",
            agentId: archiveBtn.dataset.archiveAgent,
          });
        }
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (!agentRow || !agentsListEl.contains(agentRow)) {
        return;
      }
      // JCEF OSR often drops synthesized click on the agents rail — open on
      // pointerdown (same pattern as branch close / edit-save).
      event.preventDefault();
      event.stopPropagation();
      harborAgentNavAt = Date.now();
      if (workspaceNarrow) {
        setAgentsRailOpen(false);
      }
      host.postMessage({
        type: "openAgent",
        agentId: agentRow.dataset.agent || agentRow.getAttribute("data-agent"),
      });
      if (typeof forceHarborUiRepaint === "function") {
        forceHarborUiRepaint();
        setTimeout(forceHarborUiRepaint, 32);
      }
    };
    agentsListEl.addEventListener("pointerdown", onAgentsPointer, true);
    agentsListEl.addEventListener("click", (event) => {
      if (Date.now() - harborAgentNavAt < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          host.postMessage({
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
          host.postMessage({
            type: "archiveAgent",
            agentId: archiveBtn.dataset.archiveAgent,
          });
        }
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (agentRow) {
        event.preventDefault();
        if (workspaceNarrow) {
          setAgentsRailOpen(false);
        }
        host.postMessage({
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
      if (workspaceNarrow) {
        setAgentsRailOpen(false);
      }
      host.postMessage({
        type: "openAgent",
        agentId: agentRow.dataset.agent,
      });
    });
  }

  if (chatAgentNameEl) {
    chatAgentNameEl.title = t("rename");
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

  messagesEl.addEventListener(
    "pointerdown",
    (event) => {
      trySubmitEditedUserMessageFromPointer(event);
    },
    true
  );

  messagesEl.addEventListener("click", (event) => {
    const previewBtn = event.target.closest(".msg-attach-image[data-preview-src]");
    if (previewBtn && messagesEl.contains(previewBtn)) {
      event.preventDefault();
      event.stopPropagation();
      openImgLightbox(previewBtn.getAttribute("data-preview-src") || "");
      return;
    }
    const codeToggle = event.target.closest(".md-pre-toggle");
    if (
      codeToggle &&
      messagesEl.contains(codeToggle) &&
      !event.target.closest("a.md-file")
    ) {
      event.preventDefault();
      event.stopPropagation();
      toggleCodeBlock(codeToggle);
      return;
    }
    const toolToggle = event.target.closest(".tool-group-toggle");
    if (toolToggle && messagesEl.contains(toolToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const group = toolToggle.closest(".tool-group");
      if (!group || !toolGroupHasContent(group)) {
        return;
      }
      const collapsed = group.classList.toggle("is-collapsed");
      toolToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      updateToolGroupSummary(group);
      return;
    }
    const reasoningToggle = event.target.closest(".reasoning-group-toggle");
    if (reasoningToggle && messagesEl.contains(reasoningToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const group = reasoningToggle.closest(".reasoning-group");
      if (!group) {
        return;
      }
      const collapsed = group.classList.toggle("is-collapsed");
      reasoningToggle.setAttribute(
        "aria-expanded",
        collapsed ? "false" : "true"
      );
      updateReasoningGroupSummary(group);
      return;
    }
    const thinkingToggle = event.target.closest(
      ".agent-step-thinking-toggle"
    );
    if (thinkingToggle && messagesEl.contains(thinkingToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const step = thinkingToggle.closest(".agent-step");
      if (!step) {
        return;
      }
      const collapsed = step.classList.toggle("is-thinking-collapsed");
      step.dataset.thinkingOpen = collapsed ? "0" : "1";
      thinkingToggle.setAttribute(
        "aria-expanded",
        collapsed ? "false" : "true"
      );
      const label = thinkingToggle.querySelector(
        ".agent-step-thinking-toggle-label"
      );
      if (label) {
        label.textContent = collapsed
          ? t("showThinking")
          : t("hideThinking");
      }
      return;
    }
    const planToggleBtn = event.target.closest("[data-plan-action='toggle']");
    if (planToggleBtn && messagesEl.contains(planToggleBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const card = planToggleBtn.closest(".proposed-plan-card");
      if (card) {
        setProposedPlanCollapsed(
          card,
          !card.classList.contains("is-collapsed")
        );
      }
      return;
    }
    const planOpenTabBtn = event.target.closest("[data-plan-action='open-tab']");
    if (planOpenTabBtn && messagesEl.contains(planOpenTabBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const card = planOpenTabBtn.closest(".proposed-plan-card");
      if (card) {
        openProposedPlanInTab(card);
      }
      return;
    }
    const editModeTrigger = event.target.closest(".msg-edit-mode-trigger");
    if (editModeTrigger && messagesEl.contains(editModeTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      // JetBrains OSR may already have toggled on pointerdown.
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditModeMenu();
      return;
    }
    const editModelTrigger = event.target.closest(".msg-edit-model-trigger");
    if (editModelTrigger && messagesEl.contains(editModelTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditModelMenu();
      return;
    }
    const editPlusTrigger = event.target.closest(".msg-edit-plus-btn");
    if (editPlusTrigger && messagesEl.contains(editPlusTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditPlusMenu();
      return;
    }
    const editReasonTrigger = event.target.closest(".msg-edit-reason-trigger");
    if (editReasonTrigger && messagesEl.contains(editReasonTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditPickerOpenedAt < 450) {
        return;
      }
      toggleEditReasonMenu();
      return;
    }
    const editAttachRemove = event.target.closest(
      ".msg-edit-attach-preview .attach-chip-remove"
    );
    if (editAttachRemove && messagesEl.contains(editAttachRemove)) {
      event.preventDefault();
      event.stopPropagation();
      removeEditingAttachment(editAttachRemove.getAttribute("data-id"));
      return;
    }
    const saveEditTarget = eventTargetElement(event);
    const saveEditBtn = saveEditTarget
      ? saveEditTarget.closest(".msg-edit-save")
      : null;
    if (saveEditBtn && messagesEl.contains(saveEditBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditSaveAt < 450) {
        return;
      }
      submitEditedUserMessage();
      return;
    }
    const copyBtn = event.target.closest(".msg-copy");
    if (copyBtn && messagesEl.contains(copyBtn)) {
      event.preventDefault();
      event.stopPropagation();
      copyAssistantFromButton(copyBtn);
      return;
    }
    const regenBtn = event.target.closest(".msg-regenerate");
    if (regenBtn && messagesEl.contains(regenBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditSaveAt < 450) {
        return;
      }
      // Allow while busy — host aborts the current run, then regenerates.
      if (!canRegenerate) {
        return;
      }
      pinChatToBottom();
      setBusy(true);
      host.postMessage({
        type: "regenerate",
        agentMode,
        reasoningEffort: selectedReasoningEffort || undefined,
      });
      return;
    }
    const branchBtn = event.target.closest(".msg-branch");
    if (branchBtn && messagesEl.contains(branchBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - harborEditSaveAt < 450) {
        return;
      }
      // Allow while busy — host forks into a new chat; the old run keeps going.
      const index = Number(branchBtn.dataset.index);
      if (!Number.isInteger(index) || index < 0) {
        return;
      }
      host.postMessage({ type: "branchFromMessage", messageIndex: index });
      return;
    }
    const mentionBtn = event.target.closest(".msg-mention");
    if (mentionBtn && messagesEl.contains(mentionBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const path = mentionBtn.getAttribute("data-path");
      if (path) {
        host.postMessage({ type: "openFile", path });
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
        host.postMessage({ type: "openFile", path });
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
      host.postMessage({ type: "openExternal", url: href });
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
    const codeToggle = event.target.closest(".md-pre-toggle");
    if (
      codeToggle &&
      event.target === codeToggle &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      toggleCodeBlock(codeToggle);
      return;
    }
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
    if (event.key === "Escape" && editModeMenuOpen) {
      event.preventDefault();
      closeEditModeMenu();
      return;
    }
    if (event.key === "Escape" && editModelMenuOpen) {
      event.preventDefault();
      closeEditModelMenu();
    }
  });

  promptEl.addEventListener("input", () => {
    autoResizePrompt();
    persistDraftPrompt();
    updateSendButton();
    if (!onSlashInput(promptEl)) {
      onMentionInput(promptEl);
    }
  });

  promptEl.addEventListener("keydown", (event) => {
    if (onSlashKeydown(event, promptEl)) {
      return;
    }
    if (onMentionKeydown(event, promptEl)) {
      return;
    }
    if (event.key === " " && tryCommitComposerMention(promptEl)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });

  messagesEl.addEventListener(
    "scroll",
    () => {
      if (editModelMenuOpen) {
        closeEditModelMenu();
      }
      if (!restoringChatScroll) {
        stickToBottom = isNearBottom();
      }
      if (!restoringChatScroll && chatScreen && !chatScreen.hidden && activeChatId) {
        syncChatScroll(activeChatId);
      }
    },
    { passive: true }
  );

  if (typeof ResizeObserver !== "undefined") {
    const keepPinnedOnResize = () => {
      if (stickToBottom && !restoringChatScroll) {
        scrollToBottom();
      }
      // user-пузырь мог поменять высоту при reflow — переприбить план-карточку.
      try {
        relpinAllTodoTops();
      } catch (_) {}
    };
    const resizePin = new ResizeObserver(keepPinnedOnResize);
    resizePin.observe(messagesEl);
    if (composerWrapEl) {
      resizePin.observe(composerWrapEl);
    }
  }
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      if (stickToBottom && !restoringChatScroll) {
        scrollToBottom();
      }
    }).observe(messagesEl, { childList: true, subtree: true });
  }

  if (mentionMenuEl) {
    mentionMenuEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const slashOption = event.target.closest("[data-slash-index]");
      if (slashOption) {
        const index = Number(slashOption.getAttribute("data-slash-index"));
        if (Number.isInteger(index)) {
          applySlashSelection(index);
        }
        return;
      }
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
        if (msg.chatId) {
          activeChatId = msg.chatId;
        }
        fillModels(msg.models, msg.selectedModel, true);
        if (msg.fontSize != null) {
          applyUiFontSize(msg.fontSize);
        }
        if (msg.modes) {
          applyModes(msg.modes);
        }
        applySelectedMode(msg.selectedMode, { notify: false });
        applySelectedReasoningEffort(msg.selectedReasoningEffort, {
          notify: false,
        });
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        editingReasoningEffort = "";
        editingAttachments = [];
        pickAttachmentsForEdit = false;
        clearPendingAttachments();
        clearPendingMentions();
        setCanRegenerate(msg.canRegenerate);
        applyAgentStatusState(
          msg.status?.text || "",
          Boolean(msg.status?.hidden),
          msg.status?.phase,
          msg.status?.modelLabel || ""
        );
        renderMessages(msg.uiMessages || [], "restore", msg.scrollTop);
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
        renderChatBranches(msg.branches);
        showScreen(msg.screen || "agents");
        setBusy(Boolean(msg.busy));
        renderMessageQueue();
        break;
      case "attachmentsAdded":
        if (pickAttachmentsForEdit) {
          // Picker was opened from the edit-composer "+" — attachments go to
          // the message being edited, not the main composer draft.
          pickAttachmentsForEdit = false;
          mergeEditingAttachments(msg.attachments || []);
        } else {
          mergePendingAttachments(msg.attachments || []);
        }
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
        break;
      case "showAgents":
        showScreen("agents");
        setBusy(Boolean(msg.busy));
        break;
      case "showArchive":
        showScreen("archive");
        setBusy(Boolean(msg.busy));
        break;
      case "showSettings":
        showScreen("settings");
        showSettingsCategory(msg.openMcp ? "mcp" : "models");
        setBusy(Boolean(msg.busy));
        break;
      case "openChatSearch":
        openChatSearch({ fromAgents: false });
        break;
      case "settings":
        fillSettings(msg.settings);
        if (UI_SURFACE === "settings" && settingsScreen && settingsScreen.hidden) {
          showScreen("settings");
        }
        break;
      case "uiFontSize":
        applyUiFontSize(msg.fontSize);
        break;
      case "providerModelsListed":
        onProviderModelsListed(msg);
        break;
      case "figmaStatus":
        renderFigmaStatus(msg.status || {});
        break;
      case "providerConnStatus":
        renderProviderConnStatus(msg.status || {});
        break;
      case "mcpServers":
        mcpServersCache = Array.isArray(msg.servers) ? msg.servers : [];
        renderMcpServersList();
        break;
      case "skillsList":
        skillsCache = {
          enabled: msg.enabled !== false,
          directories: Array.isArray(msg.directories) ? msg.directories : [],
          skills: Array.isArray(msg.skills) ? msg.skills : [],
        };
        renderSkillsSettings();
        break;
      case "slashCommandsList":
        userSlashCommands = Array.isArray(msg.commands) ? msg.commands : [];
        break;
      case "figmaNeedsConnect":
        showCopyToast(t("figmaNeedsConnectToast"));
        break;
      case "showChat":
        if (msg.chatId) {
          activeChatId = msg.chatId;
        }
        if (msg.models) {
          fillModels(msg.models, msg.selectedModel, true);
        }
        if (msg.fontSize != null) {
          applyUiFontSize(msg.fontSize);
        }
        applySelectedMode(msg.selectedMode, { notify: false });
        applySelectedReasoningEffort(msg.selectedReasoningEffort, {
          notify: false,
        });
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        setCanRegenerate(msg.canRegenerate);
        applyAgentStatusState(
          msg.status?.text || "",
          Boolean(msg.status?.hidden),
          msg.status?.phase,
          msg.status?.modelLabel || ""
        );
        if (msg.providerConnStatus) {
          renderProviderConnStatus(msg.providerConnStatus);
        }
        if (msg.uiMessages) {
          renderMessages(msg.uiMessages, "restore", msg.scrollTop);
        }
        if (msg.agentId) {
          activeAgentId = msg.agentId;
        }
        syncActiveAgentHighlight();
        renderChatBranches(msg.branches);
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
        setBusy(Boolean(msg.busy));
        renderMessageQueue();
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
      case "insertComposerText":
        insertComposerText(msg.text || "");
        setBusy(false);
        break;
      case "insertComposerMentions":
        insertComposerMentions(msg.paths);
        setBusy(false);
        forceHarborUiRepaint();
        break;
      case "insertComposerSelection":
        addPendingSelection(msg.selection);
        setBusy(false);
        forceHarborUiRepaint();
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
          if (msg.agentId === activeAgentId && chatTitleEl && msg.name) {
            chatTitleEl.textContent = msg.name;
          }
          if (msg.agentId === activeAgentId && Array.isArray(msg.branches)) {
            renderChatBranches(msg.branches);
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
        fillModels(msg.models, msg.selectedModel);
        if (msg.selectedReasoningEffort !== undefined) {
          applySelectedReasoningEffort(msg.selectedReasoningEffort, {
            notify: false,
          });
        } else {
          updateReasonPickerVisibility();
        }
        break;
      case "modesUpdated":
        applyModes(msg.modes);
        break;
      case "regenerateState":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel, true);
        }
        setCanRegenerate(msg.canRegenerate);
        ensureRegenerateButton();
        break;
      case "messagesReplaced":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel, true);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        editingReasoningEffort = "";
        editingAttachments = [];
        pickAttachmentsForEdit = false;
        setCanRegenerate(msg.canRegenerate);
        renderMessages(msg.uiMessages || []);
        break;
      case "copied":
        showCopyToast(t("copied"));
        break;
      case "runFinished":
        playRunFinishedSound(msg.outcome === "error" ? "error" : "success");
        break;
      case "runFailed":
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        finishRunWithError(msg.text || "", msg.detail || "");
        break;
      case "append":
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        if (msg.role === "error") {
          finishRunWithError(msg.text || "", msg.detail || "");
          break;
        }
        uiMessagesCache.push({
          role: msg.role,
          text: msg.text,
          attachments: msg.attachments,
          ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
          ...(msg.step ? { step: msg.step } : {}),
          ...(msg.detail ? { detail: msg.detail } : {}),
        });
        appendMessage(
          msg.role,
          msg.text,
          uiMessagesCache.length - 1,
          -1,
          msg.attachments,
          true,
          msg.reasoning,
          msg.step,
          msg.detail
        );
        if (msg.role === "assistant") {
          if (
            !presentProposedPlan(msg.text || "", {
              openEditor: true,
              reveal: "editor",
            })
          ) {
            syncComposerPlanFromCache({ openEditor: false });
          }
        }
        break;
      case "livePlanForBuild": {
        const text = stripPlanImplementWrapper(msg.text || "");
        if (!text) {
          break;
        }
        sendImplementPlanWithText(text);
        break;
      }
      case "step":
        upsertAgentStep(msg);
        break;
      case "status":
        if (!msg.chatId || msg.chatId === activeChatId) {
          setAgentStatus(
            msg.text || "",
            Boolean(msg.hidden),
            msg.phase,
            msg.modelLabel || ""
          );
        }
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
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        // Remount can leave streamingEl pointing at a detached node.
        if (streamingEl && !streamingEl.isConnected) {
          streamingEl = null;
        }
        if (!streamingEl) {
          streamingEl = appendMessage("assistant", "");
          streamingEl.dataset.raw = "";
        }
        streamingEl.dataset.raw = (streamingEl.dataset.raw || "") + msg.text;
        if (!streamingRenderScheduled) {
          streamingRenderScheduled = true;
          requestAnimationFrame(() => {
            streamingRenderScheduled = false;
            if (streamingEl && streamingEl.isConnected) {
              setMessageContent(
                streamingEl,
                "assistant",
                streamingEl.dataset.raw || ""
              );
              scrollToBottom();
            }
          });
        }
        break;
      case "assistantStreamClear":
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        if (streamingEl) {
          const wrap = streamingEl.closest(".msg-wrap-assistant");
          (wrap || streamingEl).remove();
          streamingEl = null;
        }
        streamingRenderScheduled = false;
        break;
      case "assistantDone": {
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        if (streamingEl && !streamingEl.isConnected) {
          streamingEl = null;
        }
        const incomingText = String(msg.text || "");
        // Host may re-send the finale after idle (catch-up). Skip duplicates.
        const alreadyCached = uiMessagesCache.some(
          (m, i) =>
            i >= Math.max(0, uiMessagesCache.length - 6) &&
            m?.role === "assistant" &&
            String(m.text || "") === incomingText &&
            Boolean(incomingText)
        );
        let assistantDoneText = "";
        if (alreadyCached) {
          assistantDoneText = incomingText;
          if (streamingEl) {
            if (streamingEl.isConnected) {
              setMessageContent(
                streamingEl,
                "assistant",
                incomingText || streamingEl.dataset.raw || ""
              );
            }
            streamingEl = null;
          }
          sealToolGroups();
          cleanSealedThinkingPlaceholders();
        } else if (!streamingEl && incomingText) {
          assistantDoneText = incomingText;
          uiMessagesCache.push({
            role: "assistant",
            text: incomingText,
            ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
          });
          // Reasoning already rendered via live steps — do not upsert again
          // (that raced after seal and duplicated Thinking).
          // Append text FIRST so sealToolGroups can detect assistant text in
          // the .chat-turn and drop placeholder-only Thinking cards.
          appendMessage(
            "assistant",
            incomingText,
            uiMessagesCache.length - 1,
            canRegenerate ? uiMessagesCache.length - 1 : -1,
            undefined,
            true,
            undefined
          );
          sealToolGroups();
          cleanSealedThinkingPlaceholders();
        } else if (streamingEl) {
          const raw = incomingText || streamingEl.dataset.raw || "";
          assistantDoneText = raw;
          setMessageContent(streamingEl, "assistant", raw);
          uiMessagesCache.push({
            role: "assistant",
            text: raw,
            ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
          });
          streamingEl.dataset.index = String(uiMessagesCache.length - 1);
          sealToolGroups();
          cleanSealedThinkingPlaceholders();
        }
        streamingEl = null;
        streamingRenderScheduled = false;
        completeRunningTodoPlans();
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        setBusy(false);
        ensureRegenerateButton();
        // Re-sync Build from history: hide if Build already ran; show only for
        // a fresh unanswered plan (do not resurrect after implement).
        if (
          assistantDoneText &&
          !presentProposedPlan(assistantDoneText, {
            openEditor: true,
            reveal: "editor",
          })
        ) {
          syncComposerPlanFromCache({ openEditor: false });
        } else if (!assistantDoneText) {
          syncComposerPlanFromCache({ openEditor: false });
        }
        break;
      }
      case "reasoning":
        // Live Thinking comes from step events. Late/duplicate reasoning
        // messages must not open a second card after seal.
        if (msg.text) {
          upsertReasoning(msg.text);
          dedupeTurnTimelines();
          scrollToBottom();
        }
        break;
      case "idle":
        // Only ignore when both sides know a chat id and they disagree.
        // If activeChatId was never hydrated (empty), still clear busy —
        // otherwise a 500 leaves the Stop button stuck forever.
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        // If assistantDone never arrived, commit whatever streamed so far
        // instead of orphaning a visible bubble without a cache entry.
        if (streamingEl && streamingEl.isConnected) {
          const raw = String(streamingEl.dataset.raw || "").trim();
          if (raw) {
            const last = uiMessagesCache[uiMessagesCache.length - 1];
            if (!(last?.role === "assistant" && String(last.text || "") === raw)) {
              uiMessagesCache.push({ role: "assistant", text: raw });
              streamingEl.dataset.index = String(uiMessagesCache.length - 1);
            }
          }
        }
        streamingEl = null;
        streamingRenderScheduled = false;
        sealToolGroups();
        markFailedToolGroups();
        // If retries show API 5xx but the host never delivered runFailed/append,
        // synthesize the error bubble so the user is not stuck on «Работаю…».
        if (
          busy &&
          !uiMessagesCache.some(
            (m, i) =>
              i >= uiMessagesCache.length - 3 && m && m.role === "error"
          )
        ) {
          const failedGroup = [...messagesEl.querySelectorAll(".tool-group")].find(
            (g) => g.dataset.failed === "1" || timelineLooksLikeTransportFailure(g)
          );
          if (failedGroup) {
            finishRunWithError(t("runFailedTransport"));
            break;
          }
        }
        completeRunningTodoPlans();
        setAgentStatus("", true);
        setIdleAndDrain();
        break;
      case "stopped":
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        clearStoppedRunArtifacts();
        sealToolGroups();
        setAgentStatus("", true);
        setIdleAndDrain();
        break;
      case "cleared":
        messagesEl.innerHTML = "";
        uiMessagesCache = [];
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        streamingEl = null;
        setComposerPlanBuild("", false);
        lastOpenedPlanKey = "";
        setAgentStatus("", true);
        setContextUsage(0, contextMax);
        clearMessageQueue(activeChatId || msg.chatId);
        setBusy(false);
        break;
    }
  });

  host.postMessage({ type: "ready", surface: UI_SURFACE });
  setContextUsage(0, contextMax);
  restoreDraftPrompt();

  // если init потерялся — перезапросим модели
  setTimeout(() => {
    if (UI_SURFACE === "panel" && !models.length) {
      host.postMessage({ type: "ready", surface: UI_SURFACE });
    }
  }, 400);
})();

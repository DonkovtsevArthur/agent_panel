(function () {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || {
    selectedModel: null,
    draftPrompt: "",
    modelByChat: {},
    agentsRailOpen: false,
  };
  if (typeof state.draftPrompt !== "string") {
    state.draftPrompt = "";
  }
  if (!state.modelByChat || typeof state.modelByChat !== "object") {
    state.modelByChat = {};
  }
  if (typeof state.agentsRailOpen !== "boolean") {
    state.agentsRailOpen = false;
  }
  const UI_LANG = document.documentElement.lang.startsWith("ru") ? "ru" : "en";
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
      tls: "TLS",
      validateTls: "Validate TLS certificate",
      caBundlePath: "CA bundle path",
      agentBehavior: "Agent behavior",
      advancedSettings: "Advanced",
      commitMessages: "Commit messages",
      commitMessagesNote:
        "Prompt for SCM commit message generation. Empty uses project rules, then the built-in default.",
      commitScope: "Apply to",
      commitScopeGlobal: "All workspaces",
      commitScopeWorkspace: "This workspace",
      commitScopeWorkspaceNamed: (name) => name || "This workspace",
      commitLanguage: "Commit message language",
      commitLanguageAuto: "Auto (follow UI language)",
      commitPrompt: "Commit prompt / rule",
      commitPromptPlaceholder:
        "Optional. Example: write short English commit messages focused on why.",
      maxTokens: "max_tokens",
      figma: "Figma",
      mcpServers: "MCP Servers",
      mcpServersNote: "Manage MCP connections used by Harbor Agents (Figma and more).",
      mcpServersOpen: "Open connection list",
      mcpSubtitle: "Manage MCP server configurations used by Harbor Agents.",
      mcpSearchPlaceholder: "Search MCP servers...",
      mcpConfigured: "Configured MCP servers",
      mcpConfiguredCount: (n) => (n === 1 ? "1 item" : `${n} items`),
      mcpEmpty: "No MCP servers yet.",
      mcpBadgeUser: "User",
      mcpBadgeTools: (n) => `${n} tools`,
      mcpEditNote:
        "Use a Personal Access Token. Remote OAuth from Figma is usually unavailable to Harbor Agents.",
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
      mcpEnable: "Enable",
      mcpReconnect: "Reconnect",
      figmaEnable: "Enable Figma MCP",
      figmaStatusDisconnected: "Status: Disconnected",
      figmaStatusConnecting: "Status: Connecting…",
      figmaStatusConnected: (mode, n) =>
        `Status: Connected (${mode || "MCP"}${typeof n === "number" ? `, ${n} tools` : ""})`,
      figmaStatusError: (msg) =>
        msg ? `Status: Error — ${msg}` : "Status: Error",
      figmaConnect: "Connect Figma",
      figmaDisconnect: "Disconnect",
      figmaPatNote:
        "Create a token in Figma → Settings → Security → Personal access tokens, paste it here, then Connect with token.",
      figmaPatLabel: "Personal Access Token",
      figmaPatConnect: "Connect with token",
      figmaNeedsConnectToast:
        "Figma is not connected — open Settings → MCP Servers",
      figmaOpenTokenHelp: "Open token settings",
      backToSettings: "Back to settings",
      systemPrompt: "System prompt",
      maxToolRounds: "Max tool rounds",
      maxResponseLength: "Max response length (chars)",
      model: "Model",
      provider: "Provider",
      mode: "Mode",
      close: "Close",
      cancel: "Cancel",
      done: "Done",
      search: "Search",
      searchChat: "Search chat",
      searchResults: "Search results",
      taskPlaceholder: "Task for the agent... (@ for file)",
      add: "Add",
      image: "Image",
      send: "Send",
      stop: "Stop",
      contextUsage: "Context usage",
      noModels: "No models",
      noModelsInSettings: "No models in settings",
      noFiles: "No files",
      searching: "Searching...",
      copied: "Copied",
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
      archiveEmpty: "Archive is empty.",
      restore: "Restore",
      delete: "Delete",
      noAgentsYet: "No agents yet. Click + to create one.",
      rename: "Rename",
      openFile: "Open file",
      openSourceControl: "Open Source Control",
      editMessage: "Edit message",
      saveAndResend: "Save and resend",
      attachImage: "Attach image",
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
      stepsOne: "1 step",
      stepsMany: (n) => `${n} steps`,
      toolWorking: "Working…",
      toolReading: "Reading…",
      toolListing: "Listing…",
      toolWriting: "Writing…",
      toolRunning: "Running…",
      toolFetching: "Fetching…",
      toolOpening: "Opening…",
      toolMcp: "MCP…",
      toolKindRead: "read",
      toolKindWrite: "write",
      toolKindList: "list",
      toolKindRun: "run",
      toolKindFetch: "fetch",
      toolKindOpen: "open",
      toolKindMcp: "mcp",
      toolKindTool: "tool",
      toolTypeCount: (kind, n) => `${kind} ×${n}`,
      doneImport: (a, u, t) => `Done: +${a}, updated ${u}, total ${t}.`,
      changedFiles: (n, a, d) => `Changed files: ${n} · +${a} −${d}`,
      taskForMode: (label) => `Task (${label})... (@ for file)`,
      modePlaceholder: (label) => `${label}... (@ for file)`,
      failedReadFile: "Failed to read file",
      slashModeSwitched: (label) => `Mode: ${label}`,
      slashInitDefault:
        "Inspect this repository and write a short onboarding summary: what the project does, the stack, how to build/run it, the main entry points, key folders/files, and the best next steps for working on it.",
      slashInitWithTarget: (target) =>
        `Inspect this repository with a focus on ${target}. Write a short onboarding summary: what this part does, the key files, how it fits into the project, important risks/constraints, and the best next steps for working on it.`,
      slashCompactDefault:
        "Compact this chat into a short working summary. Include: goal, what is already done, important files/symbols, current constraints, open questions, and the exact next step. Keep it concise and easy to continue from.",
      slashCompactWithTarget: (target) =>
        `Compact this chat into a short working summary focused on ${target}. Include: goal, what is already done, important files/symbols, current constraints, open questions, and the exact next step. Keep it concise and easy to continue from.`
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
      tls: "TLS",
      validateTls: "Проверять TLS-сертификат",
      caBundlePath: "Путь к CA bundle",
      agentBehavior: "Поведение агента",
      advancedSettings: "Доп. настройки",
      commitMessages: "Сообщения коммитов",
      commitMessagesNote:
        "Промпт для генерации сообщений коммита в SCM. Пусто — правила проекта, затем встроенный дефолт.",
      commitScope: "Применить к",
      commitScopeGlobal: "Всем workspace",
      commitScopeWorkspace: "Текущему workspace",
      commitScopeWorkspaceNamed: (name) => name || "Текущему workspace",
      commitLanguage: "Язык сообщения коммита",
      commitLanguageAuto: "Авто (как язык интерфейса)",
      commitPrompt: "Промпт / правило коммита",
      commitPromptPlaceholder:
        "Необязательно. Пример: пиши короткие русские commit message с акцентом на зачем.",
      maxTokens: "max_tokens",
      figma: "Figma",
      mcpServers: "MCP Servers",
      mcpServersNote:
        "Управление MCP-подключениями Harbor Agents (Figma и другие).",
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
        "Подключайте через Personal Access Token. Remote OAuth у Figma для Harbor Agents обычно недоступен.",
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
      mcpEnable: "Включить",
      mcpReconnect: "Переподключить",
      figmaEnable: "Включить Figma MCP",
      figmaStatusDisconnected: "Статус: не подключено",
      figmaStatusConnecting: "Статус: подключение…",
      figmaStatusConnected: (mode, n) =>
        `Статус: подключено (${mode || "MCP"}${typeof n === "number" ? `, ${n} tools` : ""})`,
      figmaStatusError: (msg) =>
        msg ? `Статус: ошибка — ${msg}` : "Статус: ошибка",
      figmaConnect: "Connect Figma",
      figmaDisconnect: "Отключить",
      figmaPatNote:
        "Создайте токен в Figma → Settings → Security → Personal access tokens, вставьте сюда и нажмите «Подключить по токену».",
      figmaPatLabel: "Personal Access Token",
      figmaPatConnect: "Подключить по токену",
      figmaNeedsConnectToast:
        "Figma не подключён — откройте Settings → MCP Servers",
      figmaOpenTokenHelp: "Открыть настройки токена",
      backToSettings: "К настройкам",
      systemPrompt: "Системный промпт",
      maxToolRounds: "Макс. раундов tools",
      maxResponseLength: "Макс. длина ответа (символы)",
      model: "Модель",
      provider: "Провайдер",
      mode: "Режим",
      close: "Закрыть",
      cancel: "Отмена",
      done: "Готово",
      search: "Поиск",
      searchChat: "Поиск по чату",
      searchResults: "Результаты поиска",
      taskPlaceholder: "Задача для агента... (@ — файл)",
      add: "Добавить",
      image: "Изображение",
      send: "Отправить",
      stop: "Остановить",
      contextUsage: "Использование контекста",
      noModels: "Нет моделей",
      noModelsInSettings: "Нет моделей в настройках",
      noFiles: "Нет файлов",
      searching: "Поиск…",
      copied: "Скопировано",
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
      archiveEmpty: "Архив пуст.",
      restore: "Восстановить",
      delete: "Удалить",
      noAgentsYet: "Нет агентов. Нажмите +, чтобы создать.",
      rename: "Переименовать",
      openFile: "Открыть файл",
      openSourceControl: "Открыть Source Control",
      editMessage: "Редактирование сообщения",
      saveAndResend: "Сохранить и переотправить",
      attachImage: "Прикрепить изображение",
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
      stepsOne: "1 шаг",
      stepsMany: (n) => `${n} шагов`,
      toolWorking: "Работаю…",
      toolReading: "Читаю…",
      toolListing: "Смотрю…",
      toolWriting: "Пишу…",
      toolRunning: "Запускаю…",
      toolFetching: "Загружаю…",
      toolOpening: "Открываю…",
      toolMcp: "MCP…",
      toolKindRead: "чтение",
      toolKindWrite: "запись",
      toolKindList: "список",
      toolKindRun: "команда",
      toolKindFetch: "загрузка",
      toolKindOpen: "открытие",
      toolKindMcp: "mcp",
      toolKindTool: "tool",
      toolTypeCount: (kind, n) => `${kind} ×${n}`,
      doneImport: (a, u, t) => `Готово: +${a}, обновлено ${u}, всего ${t}.`,
      changedFiles: (n, a, d) => `Изменено файлов: ${n} · +${a} −${d}`,
      taskForMode: (label) => `Задача (${label})… (@ — файл)`,
      modePlaceholder: (label) => `${label}… (@ — файл)`,
      failedReadFile: "Не удалось прочитать файл",
      slashModeSwitched: (label) => `Режим: ${label}`,
      slashInitDefault:
        "Изучи этот репозиторий и дай короткое onboarding-резюме: что делает проект, какой стек используется, как его собирать/запускать, где основные entry points, какие папки и файлы ключевые, и с чего лучше продолжать работу.",
      slashInitWithTarget: (target) =>
        `Изучи этот репозиторий с фокусом на ${target}. Дай короткое onboarding-резюме: что делает эта часть проекта, какие файлы здесь ключевые, как она связана с остальным кодом, какие есть ограничения/риски, и с чего лучше продолжать работу.`,
      slashCompactDefault:
        "Сожми текущий чат в короткое рабочее резюме. Включи: цель, что уже сделано, важные файлы/символы, текущие ограничения, открытые вопросы и точный следующий шаг. Пиши коротко, чтобы по summary можно было сразу продолжить работу.",
      slashCompactWithTarget: (target) =>
        `Сожми текущий чат в короткое рабочее резюме с фокусом на ${target}. Включи: цель, что уже сделано, важные файлы/символы, текущие ограничения, открытые вопросы и точный следующий шаг. Пиши коротко, чтобы по summary можно было сразу продолжить работу.`
    }
  };
  const STR = UI_STRINGS[UI_LANG];
  const t = (key, ...args) => {
    const value = STR[key];
    return typeof value === "function" ? value(...args) : value;
  };

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
  const attachPreviewEl = document.getElementById("attachPreview");
  const selectionPreviewEl = document.getElementById("selectionPreview");
  const mentionMenuEl = document.getElementById("mentionMenu");
  const composerEl = document.getElementById("composer");
  const composerWrapEl = document.getElementById("composerWrap");
  const composerDropHintEl = document.getElementById("composerDropHint");
  const modelPicker = document.getElementById("modelPicker");
  const modelTrigger = document.getElementById("modelTrigger");
  const modelLabel = document.getElementById("modelLabel");
  const modelMenu = document.getElementById("modelMenu");

  let agentStatusEl = null;
  let agentStatusState = { text: "", hidden: true, phase: "" };
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
  const settingsSaveStatus = document.getElementById("settingsSaveStatus");
  const addModelBtn = document.getElementById("addModelBtn");
  const settingsModelsHint = document.getElementById("settingsModelsHint");
  const settingsModelsJson = document.getElementById("settingsModelsJson");
  const importModelsJsonBtn = document.getElementById("importModelsJsonBtn");
  const exportModelsJsonBtn = document.getElementById("exportModelsJsonBtn");
  const settingsJsonHint = document.getElementById("settingsJsonHint");
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
  const providerEditApiKey = document.getElementById("providerEditApiKey");
  const providerEditCloseBtn = document.getElementById("providerEditCloseBtn");
  const providerEditCancelBtn = document.getElementById("providerEditCancelBtn");
  const providerEditDoneBtn = document.getElementById("providerEditDoneBtn");
  const toggleAgentsRailBtn = document.getElementById("toggleAgentsRailBtn");
  const chatAgentNameEl = document.getElementById("chatAgentName");
  const chatTitleEl = document.getElementById("chatTitle");
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
  const settingsRejectUnauthorized = document.getElementById(
    "settingsRejectUnauthorized"
  );
  const settingsCaBundle = document.getElementById("settingsCaBundle");
  const settingsSystemPrompt = document.getElementById("settingsSystemPrompt");
  const settingsCommitScope = document.getElementById("settingsCommitScope");
  const settingsCommitLanguage = document.getElementById(
    "settingsCommitLanguage"
  );
  const settingsCommitPrompt = document.getElementById("settingsCommitPrompt");
  const settingsCommitNote = document.getElementById("settingsCommitNote");
  const settingsCommitScopeLabel = document.getElementById(
    "settingsCommitScopeLabel"
  );
  const settingsCommitLanguageLabel = document.getElementById(
    "settingsCommitLanguageLabel"
  );
  const settingsCommitPromptLabel = document.getElementById(
    "settingsCommitPromptLabel"
  );
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
  let settingsModes = [];
  let settingsDefaultModelId = "";
  let settingsLanguageValue = "auto";
  let settingsWorkspaceName = "";
  let settingsDefaultContextWindow = 128000;
  let modelEditIndex = null;
  let modelEditMode = "manual";
  let providerEditIndex = null;
  let settingsHydrating = false;
  let settingsSaveTimer = null;
  let settingsSaveStatusTimer = null;
  let settingsModelTipEl = null;
  let settingsModelTipRows = null;
  let settingsModelTipIndex = null;
  let settingsModelTipHideTimer = null;
  let contextUsed = 0;
  let contextMax = 128000;

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

  const INFO_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">info</span>';

  const HEART_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">favorite</span>';

  const REGENERATE_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">refresh</span>';

  const BRANCH_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">fork_right</span>';

  const SCM_ICON =
    '<span class="material-symbols-outlined" aria-hidden="true">account_tree</span>';

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
    syncAgentsRailToggleUi();
    if (settingsSaveStatus) {
      settingsSaveStatus.textContent = t("saved");
    }
    openChatSearchBtn.title = openChatSearchBtn.setAttribute("aria-label", t("searchChat")) || t("searchChat");
    closeChatSearchBtn.title = closeChatSearchBtn.setAttribute("aria-label", t("close")) || t("close");
    chatBranchesEl.setAttribute("aria-label", UI_LANG === "ru" ? "Ветки диалога" : "Conversation branches");
    chatSearchInput.placeholder = t("search");
    chatSearchInput.setAttribute("aria-label", t("searchChat"));
    chatSearchResults.setAttribute("aria-label", t("searchResults"));
    promptEl.placeholder = t("taskPlaceholder");
    composerPlusBtn.title = composerPlusBtn.setAttribute("aria-label", t("add")) || t("add");
    composerPlusMenu.querySelector("span:last-child").textContent = t("image");
    modeTrigger.title = t("mode");
    modelTrigger.title = t("model");
    modeLabel.textContent = t("agent");
    modelLabel.textContent = t("model");
    sendBtn.title = sendBtn.setAttribute("aria-label", t("send")) || t("send");
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
    setText("settingsCommitTitle", "commitMessages");
    setText("settingsMcpTitle", "mcpServers");
    setText("settingsAgentTitle", "agentBehavior");
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
    const modelEditProviderLabel = document.getElementById(
      "modelEditProviderLabel"
    );
    if (modelEditProviderLabel) {
      modelEditProviderLabel.textContent = t("provider");
    }
    const settingsModesNote = document.getElementById("settingsModesNote");
    if (settingsModesNote) settingsModesNote.textContent = t("modesNote");
    const addModeBtnEl = document.getElementById("addModeBtn");
    if (addModeBtnEl) addModeBtnEl.textContent = t("addModeShort");
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
      if (autoOpt) autoOpt.textContent = t("languageAuto");
      if (enOpt) enOpt.textContent = t("languageEn");
      if (ruOpt) ruOpt.textContent = t("languageRu");
    }
    const settingsTlsValidateLabel = document.getElementById(
      "settingsTlsValidateLabel"
    );
    if (settingsTlsValidateLabel) {
      settingsTlsValidateLabel.textContent = t("validateTls");
    }
    const settingsCaBundleLabel = document.getElementById(
      "settingsCaBundleLabel"
    );
    if (settingsCaBundleLabel) {
      settingsCaBundleLabel.textContent = t("caBundlePath");
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
    const settingsMaxResponseCharsLabel = document.getElementById(
      "settingsMaxResponseCharsLabel"
    );
    if (settingsMaxResponseCharsLabel) {
      settingsMaxResponseCharsLabel.textContent = t("maxResponseLength");
    }
    if (settingsMcpNote) settingsMcpNote.textContent = t("mcpServersNote");
    if (mcpConfiguredTitle) mcpConfiguredTitle.textContent = t("mcpConfigured");
    if (mcpSearchInput) {
      mcpSearchInput.placeholder = t("mcpSearchPlaceholder");
    }
    if (mcpAddBtn) {
      mcpAddBtn.title = mcpAddBtn.setAttribute("aria-label", t("add")) || t("add");
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
    if (settingsCommitPromptLabel) {
      settingsCommitPromptLabel.textContent = t("commitPrompt");
    }
    if (settingsCommitPrompt) {
      settingsCommitPrompt.placeholder = t("commitPromptPlaceholder");
    }
    if (settingsCommitScope) {
      const globalOpt = settingsCommitScope.querySelector(
        'option[value="global"]'
      );
      const workspaceOpt = settingsCommitScope.querySelector(
        'option[value="workspace"]'
      );
      if (globalOpt) globalOpt.textContent = t("commitScopeGlobal");
      if (workspaceOpt) {
        workspaceOpt.textContent = t(
          "commitScopeWorkspaceNamed",
          settingsWorkspaceName
        );
      }
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
    if (typeof model === "string") {
      const found = models.find((m) => m.id === model);
      if (found && typeof found.supportsVision === "boolean") {
        return found.supportsVision;
      }
      return guessModelSupportsVision(model);
    }
    if (typeof model.supportsVision === "boolean") {
      return model.supportsVision;
    }
    return guessModelSupportsVision(model.id);
  }

  function currentModelSupportsVision() {
    return resolveModelSupportsVision(
      models.find((m) => m.id === selectedModelId) || selectedModelId
    );
  }

  let busy = false;
  let canRegenerate = false;
  let uiMessagesCache = [];
  let pendingAttachments = [];
  let pendingSelections = [];
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
  let editingAttachments = [];
  let editModelMenuOpen = false;
  let models = DEFAULT_MODELS.slice();
  let selectedModelId = "";
  let menuOpen = false;
  let plusMenuOpen = false;
  let modeMenuOpen = false;
  let agentMode = "agent";
  let modeEditIndex = null;
  let modeEditSource = "settings";
  let chatModes = [];
  let streamingEl = null;
  let composerDragDepth = 0;

  const MAX_PENDING_ATTACHMENTS = 8;
  const MAX_PENDING_SELECTIONS = 8;

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
          mode: "ask",
          sendText: buildSlashInitPrompt(args),
        };
      case "compact":
        return {
          kind: "prompt",
          mode: "ask",
          sendText: buildSlashCompactPrompt(args),
        };
      default:
        return null;
    }
  }

  function getSlashCommands() {
    return [
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
            ? "Короткий обзор проекта"
            : "Quick project onboarding",
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
  }

  function attachmentPayload(att) {
    return {
      id: att.id,
      kind: att.kind,
      name: att.name,
      mime: att.mime,
      path: att.path,
      storageKey: att.storageKey,
      size: att.size,
      dataBase64: att.dataBase64,
    };
  }

  function mergePendingAttachments(list) {
    if (!Array.isArray(list) || !list.length) {
      return;
    }
    const visionOk = currentModelSupportsVision();
    let skippedImages = 0;
    for (const item of list) {
      if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
        break;
      }
      const id = item.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (pendingAttachments.some((a) => a.id === id)) {
        continue;
      }
      const kind =
        item.kind ||
        (String(item.mime || "").startsWith("image/") ? "image" : "file");
      if (kind === "image" && !visionOk) {
        skippedImages += 1;
        continue;
      }
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
    if (skippedImages) {
      showCopyToast(t("modelNoImages"));
    }
    renderAttachPreview();
  }

  function removePendingAttachment(id) {
    pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
    renderAttachPreview();
  }

  function clearPendingAttachments() {
    pendingAttachments = [];
    renderAttachPreview();
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

  function selectionToFence(sel) {
    const start = Number(sel.startLine) || 1;
    const end = Number(sel.endLine) || start;
    const path = sel.path || "file";
    const body = String(sel.text || "").replace(/\n$/, "");
    return `\`\`\`${start}:${end}:${path}\n${body}\n\`\`\``;
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
      return;
    }
    selectionPreviewEl.hidden = false;
    selectionPreviewEl.innerHTML = pendingSelections
      .map((sel) => {
        const label = escapeHtml(formatSelectionLabel(sel));
        const lines =
          sel.startLine === sel.endLine
            ? `line ${sel.startLine}`
            : `lines ${sel.startLine}–${sel.endLine}`;
        return (
          `<div class="selection-chip" data-id="${escapeHtml(sel.id)}" title="${label}">` +
          `<span class="material-symbols-outlined selection-chip-icon" aria-hidden="true">code</span>` +
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

  function renderAttachPreview() {
    if (!attachPreviewEl) {
      return;
    }
    if (!pendingAttachments.length) {
      attachPreviewEl.hidden = true;
      attachPreviewEl.innerHTML = "";
      return;
    }
    attachPreviewEl.hidden = false;
    attachPreviewEl.innerHTML = pendingAttachments
      .map((att) => {
        const label = escapeHtml(att.path || att.name || "file");
        if (att.kind === "image" && (att.previewDataUrl || att.dataBase64)) {
          const src =
            att.previewDataUrl ||
            `data:${att.mime || "image/png"};base64,${att.dataBase64}`;
          return (
            `<div class="attach-chip attach-chip-image" data-id="${escapeHtml(att.id)}" title="${label}">` +
            `<img class="attach-thumb" src="${src}" alt="" />` +
            `<button type="button" class="attach-chip-remove" data-id="${escapeHtml(
              att.id
            )}" title="${t("remove")}" aria-label="${t("remove")}">` +
            `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
            `</button></div>`
          );
        }
        return (
          `<div class="attach-chip" data-id="${escapeHtml(att.id)}">` +
          `<span class="material-symbols-outlined attach-chip-icon" aria-hidden="true">draft</span>` +
          `<span class="attach-chip-name" title="${label}">${label}</span>` +
          `<button type="button" class="attach-chip-remove" data-id="${escapeHtml(
            att.id
          )}" title="${t("remove")}" aria-label="${t("remove")}">` +
          `<span class="material-symbols-outlined" aria-hidden="true">close</span>` +
          `</button></div>`
        );
      })
      .join("");
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
    const atIndex = before.length - match[2].length - 1;
    return {
      start: atIndex,
      query: match[2],
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
    closeSlashMenu();
  }

  function requestMentionSearch(query) {
    mentionRequestId += 1;
    const requestId = String(mentionRequestId);
    vscode.postMessage({
      type: "searchFiles",
      query: String(query || ""),
      requestId,
    });
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
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const insert = `@${item.path} `;
    const next = value.slice(0, mentionStart) + insert + value.slice(cursor);
    const caret = mentionStart + insert.length;
    textarea.value = next;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    if (textarea === promptEl) {
      // keep as is
    } else if (textarea.classList.contains("msg-edit-input")) {
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
    mentionItems = Array.isArray(msg.files) ? msg.files : [];
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

  function renderUserTextWithMentions(text) {
    const raw = String(text || "");
    const re = /@([^\s@]+)/g;
    let html = "";
    let last = 0;
    let match;
    while ((match = re.exec(raw))) {
      html += escapeHtml(raw.slice(last, match.index));
      const filePath = match[1];
      const label = pathBasename(filePath);
      html +=
        `<button type="button" class="msg-mention" data-path="${escapeHtml(
          filePath
        )}" title="${escapeHtml(filePath)}">@${escapeHtml(label)}</button>`;
      last = match.index + match[0].length;
    }
    html += escapeHtml(raw.slice(last));
    return html;
  }

  function renderMessageAttachments(attachments) {
    if (!Array.isArray(attachments) || !attachments.length) {
      return "";
    }
    return (
      `<div class="msg-attachments">` +
      attachments
        .map((att) => {
          const label = escapeHtml(att.path || att.name || "file");
          if (att.kind === "image" && att.previewDataUrl) {
            return (
              `<div class="msg-attach msg-attach-image" title="${label}">` +
              `<img src="${att.previewDataUrl}" alt="" />` +
              `</div>`
            );
          }
          return (
            `<div class="msg-attach" title="${label}">` +
            `<span class="material-symbols-outlined" aria-hidden="true">${
              att.kind === "image" ? "image" : "draft"
            }</span>` +
            `<span class="msg-attach-name">${label}</span>` +
            `</div>`
          );
        })
        .join("") +
      `</div>`
    );
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
      vscode.postMessage({ type: "attachUris", uris: withPath });
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
      vscode.postMessage({
        type: "attachFiles",
        files: parsed.map(attachmentPayload),
      });
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function persistUiState() {
    vscode.setState(state);
  }

  function persistDraftPrompt() {
    if (!promptEl) {
      return;
    }
    state.draftPrompt = promptEl.value || "";
    persistUiState();
  }

  function restoreDraftPrompt() {
    if (!promptEl || UI_SURFACE !== "panel") {
      return;
    }
    const draft = typeof state.draftPrompt === "string" ? state.draftPrompt : "";
    if (draft && !promptEl.value) {
      promptEl.value = draft;
    }
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
      vscode.postMessage({
        type: "chatScroll",
        chatId,
        scrollTop,
      });
    }, 120);
  }

  function restoreChatScroll(scrollTop) {
    if (typeof scrollTop === "number" && Number.isFinite(scrollTop)) {
      messagesEl.scrollTop = scrollTop;
    } else {
      scrollToBottom();
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

  function applyAgentStatusState(text, hidden, phase) {
    const nextHidden = Boolean(hidden || !text);
    agentStatusState = {
      text: nextHidden ? "" : text,
      hidden: nextHidden,
      phase: nextHidden ? "" : phase || "",
    };
  }

  function setAgentStatus(text, hidden, phase) {
    applyAgentStatusState(text, hidden, phase);

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
    el.textContent = agentStatusState.text;
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
      agentStatusState.phase
    );
  }

  function keepStatusAtEnd() {
    if (agentStatusState.hidden) {
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
    closeMenu();
    closeEditModelMenu();
    editingUserIndex = index;
    editingUserText = String(item.text || "");
    editingModelId = selectedModelId || models[0]?.id || "";
    editingAttachments = Array.isArray(item.attachments)
      ? item.attachments.slice()
      : [];
    renderMessages(uiMessagesCache);
  }

  function cancelEditingUserMessage() {
    closeEditModelMenu();
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingAttachments = [];
    renderMessages(uiMessagesCache);
  }

  function submitEditedUserMessage() {
    if (!Number.isInteger(editingUserIndex) || busy) {
      return;
    }
    const nextText = editingUserText.trim();
    const attachments = editingAttachments.slice();
    if (!nextText && !attachments.length) {
      return;
    }
    const model =
      editingModelId || selectedModelId || models[0]?.id || "";
    if (model && model !== selectedModelId) {
      setSelectedModel(model, true);
    }
    closeEditModelMenu();
    setBusy(true);
    vscode.postMessage({
      type: "editUserMessage",
      index: editingUserIndex,
      text: nextText,
      model,
      agentMode,
      attachments: attachments.map(attachmentPayload),
    });
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingAttachments = [];
  }

  function modelDisplayName(id) {
    const model = models.find((m) => m.id === id);
    return model ? model.label || model.id : id || t("noModels");
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

  function closeEditModelMenu() {
    editModelMenuOpen = false;
    const picker = getEditModelPicker();
    if (!picker) {
      return;
    }
    picker.classList.remove("is-open");
    const trigger = picker.querySelector(".msg-edit-model-trigger");
    const menu = picker.querySelector(".msg-edit-model-menu");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    }
    if (menu) {
      menu.hidden = true;
    }
  }

  function openEditModelMenu() {
    const picker = getEditModelPicker();
    if (!picker || busy) {
      return;
    }
    closeMenu();
    editModelMenuOpen = true;
    const trigger = picker.querySelector(".msg-edit-model-trigger");
    const menu = picker.querySelector(".msg-edit-model-menu");
    renderEditModelMenu(menu);
    picker.classList.add("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
    if (menu) {
      menu.hidden = false;
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
    if (!id || busy) {
      return;
    }
    editingModelId = id;
    const picker = getEditModelPicker();
    const label = picker
      ? picker.querySelector(".msg-edit-model-label")
      : null;
    if (label) {
      label.textContent = modelDisplayName(editingModelId);
    }
    closeEditModelMenu();
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

  function assistantActionsHtml(index, showRegen) {
    const branchHtml = Number.isInteger(index) ? branchButtonHtml(index) : "";
    const regenHtml = showRegen
      ? `<button type="button" class="icon-btn msg-regenerate" title="${t("regenerateLast")}" aria-label="${t("regenerateLast")}">` +
        REGENERATE_ICON +
        `</button>`
      : "";
    return branchHtml + regenHtml;
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
  }

  function formatToolLine(text) {
    const raw = String(text || "").replace(/^⚙\s*/, "").trim();
    const match = raw.match(/^([a-zA-Z0-9_]+)\(([\s\S]*)\)$/);
    if (!match) {
      return raw;
    }

    const name = match[1];
    let args = {};
    try {
      args = match[2] ? JSON.parse(match[2]) : {};
    } catch {
      return `${name}`;
    }

    switch (name) {
      case "run_command":
        return args.command
          ? `${t("toolKindRun")} · ${args.command}`
          : t("toolKindRun");
      case "read_file":
        return args.relativePath
          ? `${t("toolKindRead")} · ${args.relativePath}`
          : t("toolKindRead");
      case "write_file":
        return args.relativePath
          ? `${t("toolKindWrite")} · ${args.relativePath}`
          : t("toolKindWrite");
      case "list_files": {
        const path = args.relativePath || ".";
        return `${t("toolKindList")} · ${path}`;
      }
      case "fetch_url":
        return args.url
          ? `${t("toolKindFetch")} · ${args.url}`
          : t("toolKindFetch");
      case "open_external":
        return args.url
          ? `${t("toolKindOpen")} · ${args.url}`
          : t("toolKindOpen");
      default: {
        if (String(name).startsWith("mcp__")) {
          const short = name.replace(/^mcp__[^_]+__/, "") || name;
          return `${t("toolKindMcp")} · ${short}`;
        }
        const values = Object.values(args)
          .filter((v) => typeof v === "string" || typeof v === "number")
          .slice(0, 2);
        return values.length
          ? `${t("toolKindTool")} · ${values.join(" · ")}`
          : t("toolKindTool");
      }
    }
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
      prefix === "list" ||
      prefix === t("toolKindList").toLowerCase()
    ) {
      return "list_files";
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
    const n = String(name || "");
    if (n === "read_file") {
      return "read";
    }
    if (n === "write_file") {
      return "write";
    }
    if (n === "list_files") {
      return "list";
    }
    if (n === "run_command") {
      return "run";
    }
    if (n === "fetch_url") {
      return "fetch";
    }
    if (n === "open_external") {
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
      case "run":
        return t("toolKindRun");
      case "fetch":
        return t("toolKindFetch");
      case "open":
        return t("toolKindOpen");
      case "mcp":
        return t("toolKindMcp");
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
        return t("toolWriting");
      case "run":
        return t("toolRunning");
      case "fetch":
        return t("toolFetching");
      case "open":
        return t("toolOpening");
      case "mcp":
        return t("toolMcp");
      default:
        return t("toolWorking");
    }
  }

  function toolTypesSummary(group) {
    const counts = new Map();
    for (const el of group.querySelectorAll(".msg.tool")) {
      const name = el.dataset.toolName || parseToolName(el.dataset.raw || "");
      const kind = toolKind(name) || "tool";
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    const order = ["read", "list", "write", "run", "fetch", "open", "mcp", "tool"];
    const parts = [];
    for (const kind of order) {
      const n = counts.get(kind);
      if (n) {
        parts.push(t("toolTypeCount", toolKindLabel(kind), n));
      }
    }
    for (const [kind, n] of counts) {
      if (!order.includes(kind) && n) {
        parts.push(t("toolTypeCount", toolKindLabel(kind), n));
      }
    }
    return parts.length ? parts.join(" · ") : t("stepsZero");
  }

  function sealToolGroups() {
    for (const group of messagesEl.querySelectorAll(
      ".tool-group:not([data-sealed])"
    )) {
      group.dataset.sealed = "1";
      updateToolGroupSummary(group);
    }
  }

  function updateToolGroupSummary(group) {
    if (!group) {
      return;
    }
    const tools = group.querySelectorAll(".msg.tool");
    const count = tools.length;
    const summary = group.querySelector(".tool-group-summary");
    if (summary) {
      if (!count) {
        summary.textContent = t("toolWorking");
      } else if (group.dataset.sealed === "1") {
        summary.textContent = toolTypesSummary(group);
      } else {
        const last = tools[tools.length - 1];
        const name =
          last.dataset.toolName || parseToolName(last.dataset.raw || "");
        summary.textContent = toolWorkingLabel(toolKind(name));
      }
    }
    group.title = group.classList.contains("is-collapsed")
      ? t("showSteps")
      : t("hideSteps");
  }

  function createToolGroup() {
    const group = document.createElement("div");
    group.className = "tool-group is-collapsed";
    group.innerHTML =
      `<button type="button" class="tool-group-toggle" aria-expanded="false">` +
      `<span class="material-symbols-outlined tool-group-chevron" aria-hidden="true">expand_more</span>` +
      `<span class="tool-group-summary">${escapeHtml(t("toolWorking"))}</span>` +
      `</button>` +
      `<div class="tool-group-body"></div>`;
    return group;
  }

  function getActiveToolGroup() {
    const turn =
      currentChatTurnEl && messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null;
    const scope = turn || messagesEl;
    let node = scope.lastElementChild;
    while (
      node &&
      (node.id === "agentStatus" ||
        node.classList.contains("agent-status") ||
        node.classList.contains("review-actions"))
    ) {
      node = node.previousElementSibling;
    }
    if (
      node &&
      node.classList.contains("tool-group") &&
      !node.dataset.sealed
    ) {
      return node;
    }
    return null;
  }

  function ensureActiveToolGroup() {
    const existing = getActiveToolGroup();
    if (existing) {
      return existing;
    }
    const group = createToolGroup();
    ensureChatTurn().appendChild(group);
    keepStatusAtEnd();
    return group;
  }

  function appendToolToGroup(text, index) {
    const group = ensureActiveToolGroup();
    const body = group.querySelector(".tool-group-body");
    const el = document.createElement("div");
    el.className = "msg tool";
    if (typeof index === "number") {
      el.dataset.index = String(index);
    }
    el.dataset.toolName = parseToolName(text);
    const msgBody = document.createElement("div");
    msgBody.className = "msg-body";
    el.appendChild(msgBody);
    setMessageContent(el, "tool", text);
    body.appendChild(el);
    updateToolGroupSummary(group);
    keepStatusAtEnd();
    scrollToBottom();
    return el;
  }

  function showSettingsCategory(category) {
    const allowed = [
      "models",
      "modes",
      "language",
      "commit",
      "mcp",
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
      vscode.postMessage({ type: "figmaRefreshStatus" });
      vscode.postMessage({ type: "mcpRefreshList" });
    } else {
      closeMcpEditModal();
      closeMcpCustomEditModal();
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
    vscode.setState(state);
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
    vscode.postMessage({
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
    vscode.postMessage(payload);
  }

  function openChatSearch(opts) {
    if (!chatSearchPanel) {
      return;
    }
    const fromAgents = Boolean(opts && opts.fromAgents);
    if (chatScreen && chatScreen.hidden) {
      pendingOpenSearch = opts || { fromAgents: true };
      if (activeAgentId) {
        vscode.postMessage({ type: "openAgent", agentId: activeAgentId });
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
      ? preset || { id: "", name: "", baseUrl: "", apiKey: "" }
      : settingsProviders[index] || {
          id: "",
          name: "",
          baseUrl: "",
          apiKey: "",
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
    const next = { id, name: name || id, baseUrl, apiKey };

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
    const title = provider.name || provider.id || t("providerTitle");
    row.innerHTML =
      `<div class="settings-model-info">` +
      `<div class="settings-model-name"></div>` +
      `<div class="settings-model-id"></div>` +
      `</div>` +
      `<button type="button" class="icon-btn settings-provider-edit" data-index="${index}" title="${t("settings")}" aria-label="${t("settings")}">` +
      SETTINGS_ICON +
      `</button>` +
      `<button type="button" class="icon-btn settings-provider-remove" data-index="${index}" title="${t("delete")}" aria-label="${t("delete")}">` +
      DELETE_ICON +
      `</button>`;
    row.querySelector(".settings-model-name").textContent = title;
    row.querySelector(".settings-model-id").textContent =
      provider.baseUrl || provider.id || "";
    listEl.appendChild(row);
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

    const appendModels = (entries, nested) => {
      for (const { model, index } of entries) {
        used.add(index);
        appendModelRow(settingsModelsList, model, index, nested);
      }
    };

    settingsProviders.forEach((provider, providerIndex) => {
      appendProviderHead(settingsModelsList, provider, providerIndex);
      const pid = String(provider.id || "").trim();
      const entries = settingsModels
        .map((model, index) => ({ model, index }))
        .filter(
          ({ model }) => String(model.providerId || "").trim() === pid
        );
      appendModels(entries, true);
    });

    const orphans = settingsModels
      .map((model, index) => ({ model, index }))
      .filter(({ index }) => !used.has(index));
    if (orphans.length) {
      if (settingsProviders.length) {
        const orphanHead = document.createElement("div");
        orphanHead.className = "settings-provider-head";
        orphanHead.innerHTML =
          `<div class="settings-model-info">` +
          `<div class="settings-model-name"></div>` +
          `<div class="settings-model-id"></div>` +
          `</div>`;
        orphanHead.querySelector(".settings-model-name").textContent =
          t("otherProvider");
        settingsModelsList.appendChild(orphanHead);
      }
      appendModels(orphans, Boolean(settingsProviders.length));
    }

    syncDefaultModelSelect();
  }

  function renderSettingsModels() {
    renderSettingsCatalog();
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

  function pickNestedField(raw, keys) {
    const direct = pickField(raw, keys);
    if (direct != null) {
      return direct;
    }
    const nestKeys = [
      "model_info",
      "modelInfo",
      "limits",
      "limit",
      "metadata",
      "meta",
      "config",
      "parameters",
      "params",
      "info",
      "capabilities",
    ];
    for (const nestKey of nestKeys) {
      const nested = pickField(raw, [nestKey]);
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const value = pickField(nested, keys);
        if (value != null) {
          return value;
        }
      }
    }
    return undefined;
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

    const contextRaw = pickNestedField(raw, [
      "contextWindow",
      "context_window",
      "contextLength",
      "context_length",
      "maxContext",
      "max_context",
      "maxContextTokens",
      "max_context_tokens",
      "max_input_tokens",
      "maxInputTokens",
      "max_input",
      "maxInput",
      "input_tokens",
      "inputTokens",
      "context",
      "tokens",
      "max_tokens",
      "maxTokens",
    ]);
    const outputRaw = pickNestedField(raw, [
      "maxOutputTokens",
      "max_output_tokens",
      "max_output",
      "maxOutput",
      "output_tokens",
      "outputTokens",
      "max_completion_tokens",
      "maxCompletionTokens",
      "completion_tokens",
      "completionTokens",
    ]);
    const contextWindow = Number(contextRaw);
    const maxOutputTokens = Number(outputRaw);
    const visionRaw = pickField(raw, [
      "supportsVision",
      "supports_vision",
      "vision",
      "multimodal",
    ]);
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
    if (Number.isFinite(contextWindow) && contextWindow >= 1024) {
      model.contextWindow = Math.floor(contextWindow);
    }
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      model.maxOutputTokens = Math.floor(maxOutputTokens);
    }
    if (visionRaw === true || visionRaw === "true" || visionRaw === 1) {
      model.supportsVision = true;
    } else if (
      visionRaw === false ||
      visionRaw === "false" ||
      visionRaw === 0
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
    modelEditMode = mode === "json" ? "json" : "manual";
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
    if (modelEditDoneBtn) {
      modelEditDoneBtn.textContent =
        modelEditMode === "json" ? t("apply") : t("done");
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
    if (settingsFigmaConnectBtn) {
      settingsFigmaConnectBtn.hidden = connected;
      settingsFigmaConnectBtn.disabled =
        connecting || figmaStatus.enabled === false;
    }
    if (settingsFigmaDisconnectBtn) {
      settingsFigmaDisconnectBtn.hidden = !connected && state !== "error";
      settingsFigmaDisconnectBtn.disabled = connecting;
    }
    if (settingsFigmaPatBlock) {
      settingsFigmaPatBlock.hidden = false;
    }
    if (settingsFigmaPatConnectBtn) {
      settingsFigmaPatConnectBtn.disabled =
        connecting || figmaStatus.enabled === false;
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
        )}" ${server.enabled ? "checked" : ""} />` +
        `<span class="mcp-switch-track"></span>` +
        `</label>` +
        `<button type="button" class="icon-btn mcp-edit-btn" data-id="${escapeHtml(
          server.id
        )}" title="${escapeHtml(t("edit"))}" aria-label="${escapeHtml(
          t("edit")
        )}">` +
        `<span class="material-symbols-outlined" aria-hidden="true">edit</span>` +
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

  function openMcpCustomEditModal(serverId) {
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
      mcpCustomName.value = existing ? existing.name || "" : "";
    }
    if (mcpCustomTransport) {
      mcpCustomTransport.value =
        existing && existing.transport === "http" ? "http" : "stdio";
    }
    if (mcpCustomCommand) {
      mcpCustomCommand.value = existing?.command || "";
    }
    if (mcpCustomArgs) {
      mcpCustomArgs.value = Array.isArray(existing?.args)
        ? existing.args.join(" ")
        : "";
    }
    if (mcpCustomEnv) {
      const env = existing?.env || {};
      mcpCustomEnv.value = Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    }
    if (mcpCustomCwd) {
      mcpCustomCwd.value = existing?.cwd || "";
    }
    if (mcpCustomUrl) {
      mcpCustomUrl.value = existing?.url || "";
    }
    if (mcpCustomToken) {
      mcpCustomToken.value = "";
    }
    if (existing) {
      if (mcpCustomTransport) {
        mcpCustomTransport.value =
          existing.transport === "http" ? "http" : "stdio";
      }
    } else if (mcpCustomTransport) {
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
    syncMcpCustomTransportFields();
    mcpCustomEditModal.hidden = false;
    if (mcpCustomName) {
      mcpCustomName.focus();
    }
  }

  function closeMcpCustomEditModal() {
    if (mcpCustomEditModal) {
      mcpCustomEditModal.hidden = true;
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
    vscode.postMessage({
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
    vscode.postMessage({
      type: "saveSettings",
      settings: collectSettings(),
    });
    showSettingsSaved();
  }

  function persistModesNow() {
    if (settingsHydrating) {
      return;
    }
    vscode.postMessage({
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
    settingsProviders = Array.isArray(settings.providers)
      ? settings.providers.map((p) => ({
          id: p.id || "",
          name: p.name || "",
          baseUrl: p.baseUrl || "",
          apiKey: p.apiKey || "",
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
    settingsLanguageValue =
      settings.language === "ru"
        ? "ru"
        : settings.language === "en"
          ? "en"
          : "auto";
    if (settingsLanguage) {
      settingsLanguage.value = settingsLanguageValue;
    }
    if (settingsCommitScope) {
      settingsCommitScope.value =
        settings.commitMessageScope === "workspace" ? "workspace" : "global";
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
    settingsDefaultContextWindow =
      Number(settings.defaultContextWindow) > 0
        ? Number(settings.defaultContextWindow)
        : 128000;
    if (settingsRejectUnauthorized) {
      settingsRejectUnauthorized.checked = Boolean(settings.rejectUnauthorized);
    }
    if (settingsCaBundle) {
      settingsCaBundle.value = settings.caBundlePath || "";
    }
    if (settingsSystemPrompt) {
      settingsSystemPrompt.value = settings.systemPrompt || "";
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
    }
    if (typeof settings.figmaEnabled === "boolean") {
      figmaStatus = {
        ...figmaStatus,
        enabled: settings.figmaEnabled !== false,
      };
    }
    if (settings.figma) {
      renderFigmaStatus({ ...figmaStatus, ...settings.figma });
    } else {
      vscode.postMessage({ type: "figmaRefreshStatus" });
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
        settings.maxResponseChars || 12000
      );
    }
    closeModelEditModal();
    closeProviderEditModal();
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
      defaultModel: firstEnabledSettingsModelId() || settingsDefaultModelId,
      defaultContextWindow: settingsDefaultContextWindow,
      baseUrl: primary ? String(primary.baseUrl || "").replace(/\/$/, "") : "",
      apiKey: primary ? primary.apiKey || "" : "",
      rejectUnauthorized: settingsRejectUnauthorized
        ? settingsRejectUnauthorized.checked
        : false,
      caBundlePath: settingsCaBundle ? settingsCaBundle.value.trim() : "",
      systemPrompt: settingsSystemPrompt ? settingsSystemPrompt.value : "",
      commitMessagePrompt: settingsCommitPrompt
        ? settingsCommitPrompt.value
        : "",
      commitMessageLanguage: settingsCommitLanguage
        ? settingsCommitLanguage.value
        : "auto",
      commitMessageScope: settingsCommitScope
        ? settingsCommitScope.value === "workspace"
          ? "workspace"
          : "global"
        : "global",
      figmaEnabled: figmaStatus.enabled !== false,
      maxToolRounds: Number(settingsMaxToolRounds?.value || 20),
      maxTokens: Number(settingsMaxTokens?.value || 4096),
      maxResponseChars: Number(settingsMaxResponseChars?.value || 12000),
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
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    const still =
      keepSelection && chatModes.some((m) => m.id === agentMode)
        ? agentMode
        : chatModes[0]?.id || "agent";
    if (typeof setAgentMode === "function") {
      setAgentMode(still, { close: false });
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

  function openModeEditModal(index, source) {
    if (!modeEditModal) {
      return;
    }
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
    renderSettingsModes();
    if (typeof renderModeMenu === "function") {
      renderModeMenu();
    }
    closeModeEditModal();
    persistModesNow();
    if (modeEditSource === "composer" && typeof setAgentMode === "function") {
      setAgentMode(id, { focus: true });
    }
  }

  function renderArchiveList() {
    if (!archiveListEl) {
      return;
    }
    const agents = archiveAgentsData || [];
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
          `<span class="agent-main">` +
          `<div class="agent-name"></div>` +
          `<div class="agent-meta"><span class="agent-preview"></span></div>` +
          `</span>` +
          `</div>` +
          `<div class="row-actions">` +
          `<button type="button" class="row-action row-restore" data-restore-agent="${a.id}" title="${t("restore")}" aria-label="${t("restore")}">` +
          RESTORE_ICON +
          `</button>` +
          `<button type="button" class="row-action row-delete" data-delete-agent="${a.id}" title="${t("delete")}" aria-label="${t("delete")}">` +
          DELETE_ICON +
          `</button>` +
          `</div>` +
          `<span class="agent-time"></span>` +
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
      block.querySelector(".agent-preview").textContent = a.preview || "";
      block.querySelector(".agent-time").textContent = a.time || "";
    });
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
        const statusHtml =
          a.runState === "running"
            ? '<span class="agent-run-status agent-run-status-running" aria-label="Running"><span class="cube-bit cube-bit-1"></span><span class="cube-bit cube-bit-2"></span><span class="cube-bit cube-bit-3"></span><span class="cube-bit cube-bit-4"></span></span>'
            : a.runState === "success"
              ? '<span class="agent-run-status agent-run-status-success" aria-label="Done"><span class="cube-bit cube-bit-1"></span><span class="cube-bit cube-bit-2"></span><span class="cube-bit cube-bit-3"></span><span class="cube-bit cube-bit-4"></span></span>'
              : a.runState === "error"
                ? '<span class="agent-run-status agent-run-status-error" aria-label="Error"><span class="cube-bit cube-bit-1"></span><span class="cube-bit cube-bit-2"></span><span class="cube-bit cube-bit-3"></span><span class="cube-bit cube-bit-4"></span></span>'
                : '<span class="agent-run-status agent-run-status-empty" aria-hidden="true"></span>';
        return (
          `<div class="agent-block${a.active ? " is-active" : ""}" data-agent="${a.id}">` +
          `<div class="agent-row-wrap">` +
          `<div class="agent-row flat" role="button" tabindex="0" data-agent="${a.id}">` +
          `<span class="agent-main">` +
          statusHtml +
          `<div class="agent-name-row"><div class="agent-name" title="${t("rename")}"></div></div>` +
          `<div class="agent-meta"><span class="agent-chip"></span><span class="agent-preview"></span></div>` +
          `</span>` +
          `</div>` +
          `<div class="row-actions">` +
          action +
          `</div>` +
          `<span class="agent-time"></span>` +
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
      block.querySelector(".agent-chip").textContent = a.model || "—";
      block.querySelector(".agent-preview").textContent = a.preview || "";
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
      vscode.postMessage({
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
      row.title = t("openFile");
      row.innerHTML =
        `<span class="review-file-path"></span>` +
        `<span class="review-file-stats">` +
        `<span class="add">+${file.added || 0}</span> ` +
        `<span class="del">−${file.removed || 0}</span>` +
        `</span>`;
      row.querySelector(".review-file-path").textContent = file.path;
      row.addEventListener("click", () => {
        vscode.postMessage({ type: "openFile", path: file.path });
      });
      fileList.appendChild(row);
    }
    card.appendChild(fileList);
    card.dataset.paths = list.map((f) => f.path).join("\n");
    const mount = ensureChatTurn();
    mount.appendChild(card);

    const actions = document.createElement("div");
    actions.className = "review-actions";
    actions.dataset.paths = list.map((f) => f.path).join("\n");
    actions.hidden = !parsed.showScm;
    const scmBtn = document.createElement("button");
    scmBtn.type = "button";
    scmBtn.className = "review-scm";
    scmBtn.title = t("openSourceControl");
    scmBtn.setAttribute("aria-label", t("openSourceControl"));
    scmBtn.innerHTML = SCM_ICON;
    scmBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "openScm" });
    });
    actions.appendChild(scmBtn);
    mount.appendChild(actions);
    keepStatusAtEnd();
    scrollToBottom();
  }

  function applyScmButtons(reviews) {
    const list = Array.isArray(reviews) ? reviews : [];
    const entries = list.map((r) => ({
      key: [...(r.paths || [])].map(String).sort().join("\n"),
      show: Boolean(r.showScm),
    }));
    for (const el of messagesEl.querySelectorAll(".review-actions")) {
      const key = (el.dataset.paths || "")
        .split("\n")
        .filter(Boolean)
        .sort()
        .join("\n");
      const hit = entries.find((e) => e.key === key);
      // если не нашли соответствие — прячем (безопаснее, чем оставлять кнопку)
      el.hidden = hit ? !hit.show : true;
    }
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
      const label = pathBasename(path);
      tokens.push(
        `<button type="button" class="msg-mention" data-path="${escapeHtml(
          path
        )}" title="${escapeHtml(path)}">@${escapeHtml(label)}</button>`
      );
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
  function replaceCitationFences(raw) {
    const blocks = [];
    // ```27:29:path/to/file.module.css ... ```
    const re =
      /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(\d+:\d+:[^\n]+|\d+:[^\n]+)\r?\n([\s\S]*?)\r?\n?[ \t]*\2[ \t]*(?=\r?\n|$)/g;
    const out = String(raw || "").replace(
      re,
      (full, lead, _fence, meta, body) => {
        const id = blocks.length;
        blocks.push(renderCodeBlockHtml(body.replace(/\r/g, ""), meta.trim()));
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
        Renderer: marked.Renderer || marked.marked.Renderer,
        use: marked.use || marked.marked.use,
      };
    }
    return null;
  }

  function renderCodeBlockHtml(text, langRaw) {
    const inner = String(text || "").replace(/\n$/, "");
    if (isFilePath(inner.trim()) && !inner.includes("\n")) {
      return fileLinkHtml(inner.trim());
    }
    const meta = parseCodeFenceMeta(langRaw);
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
              `<span class="md-line-text">${escapeHtml(line)}</span>` +
              `</span>`
            );
          })
          .join("\n")
      : escapeHtml(inner);

    let metaHtml = "";
    if (meta.path || showLines) {
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
        `<div class="md-pre-meta">` +
        pathPart +
        (pathPart && linesPart ? `<span class="md-pre-meta-sep">·</span>` : "") +
        linesPart +
        `</div>`;
    }

    return (
      `<div class="md-pre-wrap${showLines ? " has-lines" : ""}">` +
      metaHtml +
      `<pre class="md-pre"><code>${codeHtml}</code></pre>` +
      `</div>\n`
    );
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
  function renderInlineMarkdown(text) {
    const raw = String(text || "");
    if (!raw) {
      return "";
    }
    const extracted = replaceCitationFences(raw);
    const api = getMarkedApi();
    if (ensureMarkdownRenderer() && api) {
      try {
        const html = api.parse(extracted.text, { async: false });
        return restoreCitationFences(html, extracted.blocks);
      } catch {
        // fallback below
      }
    }
    if (extracted.blocks.length) {
      return restoreCitationFences(
        `<div class="md-p">${linkifyPlainText(extracted.text, false).replace(
          /\n/g,
          "<br />"
        )}</div>`,
        extracted.blocks
      );
    }
    return `<div class="md-p">${linkifyPlainText(raw, false).replace(
      /\n/g,
      "<br />"
    )}</div>`;
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
    if (role === "assistant" || role === "error" || role === "user") {
      body.innerHTML = renderInlineMarkdown(raw);
      return;
    }
    body.textContent = role === "tool" ? formatToolLine(raw) : raw;
  }

  function appendMessage(
    role,
    text,
    index,
    regenAssistantIndex,
    attachments,
    shouldScroll = true
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
      return appendToolToGroup(text, index);
    }

    sealToolGroups();

    const el = document.createElement("div");
    el.className = `msg ${role}`;
    if (typeof index === "number") {
      el.dataset.index = String(index);
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
        const editModelLabel = modelDisplayName(
          editingModelId || selectedModelId
        );
        body.innerHTML =
          `<div class="msg-edit-composer">` +
          (msgAttachments.length
            ? renderMessageAttachments(msgAttachments)
            : "") +
          `<textarea class="msg-edit-input" data-index="${index}" rows="3" aria-label="${t("editMessage")}"></textarea>` +
          `<div class="msg-edit-footer">` +
          `<div class="msg-edit-footer-left">` +
          `<div class="model-picker msg-edit-model-picker" id="msgEditModelPicker">` +
          `<button type="button" class="model-trigger msg-edit-model-trigger" aria-haspopup="listbox" aria-expanded="false" title="${t("model")}">` +
          `<span class="model-label msg-edit-model-label">${escapeHtml(
            editModelLabel
          )}</span>` +
          `<span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>` +
          `</button>` +
          `<div class="model-menu msg-edit-model-menu" role="listbox" hidden></div>` +
          `</div>` +
          `</div>` +
          `<div class="msg-edit-footer-right">` +
          `<button type="button" class="primary msg-edit-save" data-index="${index}" title="${t("saveAndResend")}" aria-label="${t("saveAndResend")}">` +
          `<span class="material-symbols-outlined icon-send" aria-hidden="true">arrow_upward</span>` +
          `</button>` +
          `</div>` +
          `</div>` +
          `</div>`;
        const input = body.querySelector(".msg-edit-input");
        if (input) {
          input.value = editingUserText;
        }
      } else if (msgAttachments.length) {
        const attachHtml = renderMessageAttachments(msgAttachments);
        if (attachHtml) {
          body.insertAdjacentHTML("afterbegin", attachHtml);
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
        false
      );
    }
    restoreAgentStatus();
    focusEditingInput();
    requestAnimationFrame(() => {
      if (scrollMode === "restore") {
        restoreChatScroll(restoredScrollTop);
      } else {
        scrollToBottom();
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
    const model = models.find((m) => m.id === selectedModelId);
    modelLabel.textContent = model
      ? model.label || model.id
      : selectedModelId || t("noModels");
  }

  function stripPendingImagesIfNeeded(notify) {
    const before = pendingAttachments.length;
    if (currentModelSupportsVision()) {
      return;
    }
    pendingAttachments = pendingAttachments.filter((a) => a.kind !== "image");
    if (pendingAttachments.length < before) {
      renderAttachPreview();
      if (notify) {
        showCopyToast(t("modelNoImages"));
      }
    }
  }

  function updateVisionUi() {
    stripPendingImagesIfNeeded(true);
    const visionOk = currentModelSupportsVision();
    if (!composerPlusMenu) {
      return;
    }
    const imageItem = composerPlusMenu.querySelector(
      '.composer-plus-item[data-action="image"]'
    );
    if (!imageItem) {
      return;
    }
    imageItem.disabled = !visionOk;
    imageItem.classList.toggle("is-disabled", !visionOk);
    imageItem.setAttribute("aria-disabled", visionOk ? "false" : "true");
    imageItem.title = visionOk
      ? t("attachImage")
      : t("currentModelNoImages");
  }

  function setSelectedModel(id, notify) {
    selectedModelId = id || "";
    state.selectedModel = selectedModelId;
    if (activeChatId) {
      state.modelByChat[activeChatId] = selectedModelId;
    }
    vscode.setState(state);
    updateTriggerLabel();
    updateVisionUi();
    if (menuOpen) {
      renderMenu();
    }
    if (notify && selectedModelId) {
      vscode.postMessage({ type: "modelChanged", model: selectedModelId });
    }
  }

  function resolvePreferredModelId(preferredId) {
    const fromHost = String(preferredId || "").trim();
    if (fromHost && models.some((m) => m.id === fromHost)) {
      return fromHost;
    }
    if (activeChatId && state.modelByChat[activeChatId]) {
      const fromChat = String(state.modelByChat[activeChatId] || "").trim();
      if (fromChat && models.some((m) => m.id === fromChat)) {
        return fromChat;
      }
    }
    if (fromHost) {
      return models[0]?.id || "";
    }
    return models[0]?.id || "";
  }

  function fillModels(nextModels, preferredId) {
    const incoming = Array.isArray(nextModels) ? nextModels : [];
    models = incoming.length ? incoming : DEFAULT_MODELS.slice();
    const preferred = resolvePreferredModelId(preferredId);
    setSelectedModel(preferred, false);
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
    if (busy) {
      return;
    }
    closePlusMenu();
    menuOpen = true;
    renderMenu();
    modelPicker.classList.add("is-open");
    modelTrigger.setAttribute("aria-expanded", "true");
    modelMenu.hidden = false;
  }

  function closeMenu() {
    menuOpen = false;
    modelPicker.classList.remove("is-open");
    modelTrigger.setAttribute("aria-expanded", "false");
    modelMenu.hidden = true;
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
  }

  function openPlusMenu() {
    closeMenu();
    closeModeMenu();
    closeEditModelMenu();
    plusMenuOpen = true;
    if (composerPlusEl) {
      composerPlusEl.classList.add("is-open");
    }
    if (composerPlusBtn) {
      composerPlusBtn.setAttribute("aria-expanded", "true");
    }
    if (composerPlusMenu) {
      composerPlusMenu.hidden = false;
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
  }

  function openModeMenu() {
    closeMenu();
    closePlusMenu();
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
    }
  }

  function toggleModeMenu() {
    if (modeMenuOpen) {
      closeModeMenu();
    } else {
      openModeMenu();
    }
  }

  function setAgentMode(next, { focus = false, close = true } = {}) {
    agentMode = normalizeAgentModeUi(next);
    const modes = chatModes.length ? chatModes : DEFAULT_CHAT_MODES;
    const meta = localizeModeMeta(
      modes.find((m) => m.id === agentMode) || modes[0] || {
      id: "agent",
      label: t("agent"),
      placeholder: t("taskPlaceholder"),
      }
    );
    if (modePicker) {
      modePicker.dataset.mode = agentMode;
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
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    promptEl.disabled = busy;
    modelTrigger.disabled = busy;
    if (composerPlusBtn) {
      composerPlusBtn.disabled = busy;
    }
    if (modeTrigger) {
      modeTrigger.disabled = busy;
    }
    if (busy) {
      closeMenu();
      closePlusMenu();
      closeModeMenu();
      closeSlashMenu();
      closeMentionMenu();
    }
    sendBtn.dataset.mode = busy ? "stop" : "send";
    sendBtn.title = busy ? t("stop") : t("send");
    sendBtn.setAttribute("aria-label", busy ? t("stop") : t("send"));
    sendBtn.classList.toggle("is-stop", busy);
    if (!busy) {
      focusPrompt();
    }
  }

  // сразу показать модель, не дожидаясь init
  fillModels(DEFAULT_MODELS, "");

  function selectModelById(id) {
    if (!id || busy) {
      return;
    }
    setSelectedModel(id, true);
    closeMenu();
  }

  modelTrigger.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  modelTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) {
      return;
    }
    toggleMenu();
  });

  modelMenu.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const option = event.target.closest(".model-option");
    if (!option || option.classList.contains("is-empty")) {
      return;
    }
    selectModelById(option.dataset.id);
  });

  modelMenu.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  document.addEventListener("mousedown", (event) => {
    if (menuOpen && !modelPicker.contains(event.target)) {
      closeMenu();
    }
    if (
      plusMenuOpen &&
      composerPlusEl &&
      !composerPlusEl.contains(event.target)
    ) {
      closePlusMenu();
    }
    if (
      modeMenuOpen &&
      modePicker &&
      !modePicker.contains(event.target)
    ) {
      closeModeMenu();
    }
    if (
      mentionOpen &&
      mentionMenuEl &&
      !mentionMenuEl.contains(event.target) &&
      event.target !== mentionTarget
    ) {
      closeMentionMenu();
    }
    if (editModelMenuOpen) {
      const picker = getEditModelPicker();
      if (!picker || !picker.contains(event.target)) {
        closeEditModelMenu();
      }
    }
    if (Number.isInteger(editingUserIndex) && !busy) {
      const composer = messagesEl.querySelector(".msg-edit-composer");
      if (composer && !composer.contains(event.target)) {
        cancelEditingUserMessage();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
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
    if (event.key === "Escape" && editModelMenuOpen) {
      closeEditModelMenu();
    }
  });


  function sendPrompt() {
    const rawInput = promptEl.value || "";
    const command = parseSlashCommand(rawInput);
    let typed = rawInput.trim();
    let modeForSend = agentMode;
    if (command) {
      setAgentMode(command.mode, { close: true });
      modeForSend = normalizeAgentModeUi(command.mode);
      if (command.kind === "mode" && !command.sendText) {
        promptEl.value = "";
        clearDraftPrompt();
        closeMentionMenu();
        showCopyToast(t("slashModeSwitched", modeLabel ? modeLabel.textContent : command.mode));
        focusPrompt();
        return;
      }
      typed = command.sendText;
    }
    const text = buildMessageWithSelections(typed);
    const attachments = pendingAttachments.slice();
    if ((!text && !attachments.length) || busy) {
      return;
    }
    editingUserIndex = null;
    editingUserText = "";
    editingModelId = "";
    editingAttachments = [];
    uiMessagesCache.push({ role: "user", text, attachments });
    appendMessage("user", text, uiMessagesCache.length - 1, -1, attachments);
    promptEl.value = "";
    clearDraftPrompt();
    clearPendingAttachments();
    clearPendingSelections();
    closeSlashMenu();
    closeMentionMenu();
    setBusy(true);
    vscode.postMessage({
      type: "send",
      text,
      model: getSelectedModel(),
      agentMode: modeForSend,
      attachments: attachments.map(attachmentPayload),
    });
  }

  sendBtn.addEventListener("click", () => {
    if (busy) {
      vscode.postMessage({ type: "stop" });
      return;
    }
    sendPrompt();
  });

  if (composerPlusBtn) {
    composerPlusBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) {
        return;
      }
      togglePlusMenu();
    });
  }

  if (modeTrigger) {
    modeTrigger.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    modeTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) {
        return;
      }
      toggleModeMenu();
    });
  }

  if (modeMenu) {
    modeMenu.addEventListener("mousedown", (event) => {
      event.preventDefault();
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
      if (!option || busy || option.dataset.action === "add-mode") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setAgentMode(option.dataset.mode, { focus: true });
    });
  }

  setAgentMode(agentMode, { close: false });
  renderModeMenu();

  if (composerPlusMenu) {
    composerPlusMenu.addEventListener("click", (event) => {
      const item = event.target.closest(".composer-plus-item");
      if (!item || busy || item.disabled || item.classList.contains("is-disabled")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = item.getAttribute("data-action");
      closePlusMenu();
      if (action === "image") {
        if (!currentModelSupportsVision()) {
          showCopyToast(t("modelNoImages"));
          return;
        }
        vscode.postMessage({ type: "pickAttachments", imagesOnly: true });
      }
    });
  }

  if (attachPreviewEl) {
    attachPreviewEl.addEventListener("click", (event) => {
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
      if (busy) {
        return;
      }
      const uris = extractDropUris(event.dataTransfer);
      if (uris.length) {
        vscode.postMessage({ type: "attachUris", uris });
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
    if (busy || !chatScreen || chatScreen.hidden) {
      return;
    }
    let imageFiles = extractClipboardImages(event.clipboardData);
    if (!imageFiles.length) {
      imageFiles = await readClipboardImagesFallback();
    }
    if (!imageFiles.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!currentModelSupportsVision()) {
      showCopyToast(t("modelNoImages"));
      return;
    }
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
    if (!isPaste || busy || !chatScreen || chatScreen.hidden) {
      return;
    }
    // Если фокус не в поле ввода — всё равно даём шанс прочитать буфер
    const active = document.activeElement;
    const inPrompt = active === promptEl;
    if (inPrompt) {
      return;
    }
    void (async () => {
      const imageFiles = await readClipboardImagesFallback();
      if (!imageFiles.length) {
        return;
      }
      if (!currentModelSupportsVision()) {
        showCopyToast(t("modelNoImages"));
        return;
      }
      event.preventDefault();
      await ingestDroppedFiles(imageFiles);
      if (promptEl && typeof promptEl.focus === "function") {
        promptEl.focus();
      }
    })();
  });

  if (newAgentBtn) {
    newAgentBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "newAgent" });
    });
  }

  if (chatNewAgentBtn) {
    chatNewAgentBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "newAgent" });
    });
  }

  if (openArchiveBtn) {
    openArchiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showArchive" });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showSettings" });
    });
  }

  if (backFromArchiveBtn) {
    backFromArchiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showAgents" });
    });
  }

  const settingsBody = document.getElementById("settingsBody");
  if (settingsBody) {
    settingsBody.addEventListener("scroll", hideSettingsModelTip, { passive: true });
    settingsBody.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest(
          "#settingsCaBundle, #settingsSystemPrompt, #settingsCommitPrompt, #settingsMaxToolRounds, #settingsMaxTokens, #settingsMaxResponseChars"
        )
      ) {
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
          "#settingsRejectUnauthorized, #settingsCommitScope, #settingsCommitLanguage"
        )
      ) {
        persistSettingsNow();
      }
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
        vscode.postMessage({ type: "mcpDeleteServer", id });
      }
    });
    mcpServersList.addEventListener("change", (event) => {
      const toggle = event.target.closest(".mcp-enable-toggle");
      if (!toggle) {
        return;
      }
      const id = toggle.dataset.id || "";
      const enabled = Boolean(toggle.checked);
      if (id === "figma") {
        figmaStatus = { ...figmaStatus, enabled };
      }
      vscode.postMessage({ type: "mcpSetEnabled", id, enabled });
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
      vscode.postMessage({ type: "figmaConnect" });
    });
  }
  if (settingsFigmaDisconnectBtn) {
    settingsFigmaDisconnectBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "figmaDisconnect" });
    });
  }
  if (settingsFigmaPatConnectBtn) {
    settingsFigmaPatConnectBtn.addEventListener("click", () => {
      const token = settingsFigmaPat ? settingsFigmaPat.value.trim() : "";
      vscode.postMessage({ type: "figmaConnectPat", token });
      if (settingsFigmaPat) {
        settingsFigmaPat.value = "";
      }
    });
  }
  if (settingsFigmaPatHelpBtn) {
    settingsFigmaPatHelpBtn.addEventListener("click", () => {
      vscode.postMessage({
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
    });
  }

  if (settingsProvidersList) {
    settingsProvidersList.addEventListener("click", (event) => {
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
      schedulePersistSettings(0);
      showCopyToast(
        UI_LANG === "ru" ? "Перезагрузка окна…" : "Reloading window…"
      );
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
    });
    shellRo.observe(workspaceShell);
  }
  updateWorkspaceNarrow();
  applyAgentsRailVisibility();

  if (chatBranchesEl) {
    chatBranchesEl.addEventListener("click", (event) => {
      const closeBtn = event.target.closest(".chat-branch-close");
      if (closeBtn && chatBranchesEl.contains(closeBtn)) {
        event.preventDefault();
        event.stopPropagation();
        if (busy) {
          return;
        }
        const chatId = closeBtn.getAttribute("data-chat-id") || "";
        if (!chatId) {
          return;
        }
        vscode.postMessage({ type: "deleteBranch", chatId });
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
      vscode.postMessage({ type: "switchBranch", chatId });
    });
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
    archiveListEl.addEventListener("click", (event) => {
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          vscode.postMessage({
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
        vscode.postMessage({
          type: "restoreAgent",
          agentId: restoreBtn.dataset.restoreAgent,
        });
      }
    });
  }

  if (agentsListEl) {
    agentsListEl.addEventListener("click", (event) => {
      const deleteBtn = event.target.closest(".row-delete");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (deleteBtn.dataset.deleteAgent) {
          vscode.postMessage({
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
          vscode.postMessage({
            type: "archiveAgent",
            agentId: archiveBtn.dataset.archiveAgent,
          });
        }
        return;
      }
      const nameEl = event.target.closest(".agent-name");
      if (nameEl && agentsListEl.contains(nameEl)) {
        event.preventDefault();
        event.stopPropagation();
        const block = nameEl.closest("[data-agent]");
        const agentId = block ? block.dataset.agent : "";
        if (agentId) {
          startAgentRename(agentId, nameEl);
        }
        return;
      }
      const agentRow = event.target.closest(".agent-row");
      if (agentRow) {
        event.preventDefault();
        if (workspaceNarrow) {
          setAgentsRailOpen(false);
        }
        vscode.postMessage({
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
      vscode.postMessage({
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

  messagesEl.addEventListener("click", (event) => {
    const toolToggle = event.target.closest(".tool-group-toggle");
    if (toolToggle && messagesEl.contains(toolToggle)) {
      event.preventDefault();
      event.stopPropagation();
      const group = toolToggle.closest(".tool-group");
      if (!group) {
        return;
      }
      const collapsed = group.classList.toggle("is-collapsed");
      toolToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      updateToolGroupSummary(group);
      return;
    }
    const editModelTrigger = event.target.closest(".msg-edit-model-trigger");
    if (editModelTrigger && messagesEl.contains(editModelTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      toggleEditModelMenu();
      return;
    }
    const editModelOption = event.target.closest(
      ".msg-edit-model-menu .model-option"
    );
    if (editModelOption && messagesEl.contains(editModelOption)) {
      event.preventDefault();
      event.stopPropagation();
      if (!editModelOption.classList.contains("is-empty")) {
        selectEditingModel(editModelOption.dataset.id);
      }
      return;
    }
    const saveEditBtn = event.target.closest(".msg-edit-save");
    if (saveEditBtn && messagesEl.contains(saveEditBtn)) {
      event.preventDefault();
      event.stopPropagation();
      submitEditedUserMessage();
      return;
    }
    const regenBtn = event.target.closest(".msg-regenerate");
    if (regenBtn && messagesEl.contains(regenBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (busy || !canRegenerate) {
        return;
      }
      setBusy(true);
      vscode.postMessage({ type: "regenerate", agentMode });
      return;
    }
    const branchBtn = event.target.closest(".msg-branch");
    if (branchBtn && messagesEl.contains(branchBtn)) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) {
        return;
      }
      const index = Number(branchBtn.dataset.index);
      if (!Number.isInteger(index) || index < 0) {
        return;
      }
      vscode.postMessage({ type: "branchFromMessage", messageIndex: index });
      return;
    }
    const mentionBtn = event.target.closest(".msg-mention");
    if (mentionBtn && messagesEl.contains(mentionBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const path = mentionBtn.getAttribute("data-path");
      if (path) {
        vscode.postMessage({ type: "openFile", path });
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
        vscode.postMessage({ type: "openFile", path });
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
      vscode.postMessage({ type: "openExternal", url: href });
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
    if (event.key === "Escape" && editModelMenuOpen) {
      event.preventDefault();
      closeEditModelMenu();
    }
  });

  promptEl.addEventListener("input", () => {
    persistDraftPrompt();
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });

  messagesEl.addEventListener(
    "scroll",
    () => {
      if (!restoringChatScroll && chatScreen && !chatScreen.hidden && activeChatId) {
        syncChatScroll(activeChatId);
      }
    },
    { passive: true }
  );

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
        fillModels(msg.models, msg.selectedModel);
        if (msg.modes) {
          applyModes(msg.modes);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingAttachments = [];
        clearPendingAttachments();
        setCanRegenerate(msg.canRegenerate);
        applyAgentStatusState(msg.status?.text || "", Boolean(msg.status?.hidden), msg.status?.phase);
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
        showScreen(msg.screen || "agents");
        setBusy(Boolean(msg.busy));
        break;
      case "attachmentsAdded":
        mergePendingAttachments(msg.attachments || []);
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
      case "settings":
        fillSettings(msg.settings);
        if (UI_SURFACE === "settings" && settingsScreen && settingsScreen.hidden) {
          showScreen("settings");
        }
        break;
      case "figmaStatus":
        renderFigmaStatus(msg.status || {});
        break;
      case "mcpServers":
        mcpServersCache = Array.isArray(msg.servers) ? msg.servers : [];
        renderMcpServersList();
        break;
      case "figmaNeedsConnect":
        showCopyToast(t("figmaNeedsConnectToast"));
        break;
      case "showChat":
        if (msg.chatId) {
          activeChatId = msg.chatId;
        }
        if (msg.models) {
          fillModels(msg.models, msg.selectedModel);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        setCanRegenerate(msg.canRegenerate);
        applyAgentStatusState(msg.status?.text || "", Boolean(msg.status?.hidden), msg.status?.phase);
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
      case "insertComposerSelection":
        addPendingSelection(msg.selection);
        setBusy(false);
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
        break;
      case "modesUpdated":
        applyModes(msg.modes);
        break;
      case "regenerateState":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel);
        }
        setCanRegenerate(msg.canRegenerate);
        ensureRegenerateButton();
        break;
      case "messagesReplaced":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingAttachments = [];
        setCanRegenerate(msg.canRegenerate);
        renderMessages(msg.uiMessages || []);
        break;
      case "copied":
        showCopyToast(t("copied"));
        break;
      case "append":
        uiMessagesCache.push({
          role: msg.role,
          text: msg.text,
          attachments: msg.attachments,
        });
        appendMessage(
          msg.role,
          msg.text,
          uiMessagesCache.length - 1,
          -1,
          msg.attachments
        );
        break;
      case "status":
        if (!msg.chatId || msg.chatId === activeChatId) {
          setAgentStatus(msg.text || "", Boolean(msg.hidden), msg.phase);
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
        if (!streamingEl) {
          streamingEl = appendMessage("assistant", "");
          streamingEl.dataset.raw = "";
        }
        streamingEl.dataset.raw = (streamingEl.dataset.raw || "") + msg.text;
        setMessageContent(streamingEl, "assistant", streamingEl.dataset.raw);
        scrollToBottom();
        break;
      case "assistantDone":
        if (!streamingEl && msg.text) {
          uiMessagesCache.push({ role: "assistant", text: msg.text });
          appendMessage(
            "assistant",
            msg.text,
            uiMessagesCache.length - 1,
            canRegenerate ? uiMessagesCache.length - 1 : -1
          );
        } else if (streamingEl) {
          const raw = msg.text || streamingEl.dataset.raw || "";
          setMessageContent(streamingEl, "assistant", raw);
          uiMessagesCache.push({ role: "assistant", text: raw });
          streamingEl.dataset.index = String(uiMessagesCache.length - 1);
        }
        streamingEl = null;
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        setBusy(false);
        ensureRegenerateButton();
        break;
      case "idle":
        if (msg.chatId && msg.chatId !== activeChatId) {
          break;
        }
        streamingEl = null;
        setAgentStatus("", true);
        setBusy(false);
        break;
      case "stopped":
        if (msg.chatId && msg.chatId !== activeChatId) {
          break;
        }
        streamingEl = null;
        setAgentStatus("", true);
        setBusy(false);
        break;
      case "cleared":
        messagesEl.innerHTML = "";
        uiMessagesCache = [];
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        streamingEl = null;
        setAgentStatus("", true);
        setContextUsage(0, contextMax);
        setBusy(false);
        break;
    }
  });

  vscode.postMessage({ type: "ready", surface: UI_SURFACE });
  setContextUsage(0, contextMax);
  restoreDraftPrompt();

  // если init потерялся — перезапросим модели
  setTimeout(() => {
    if (UI_SURFACE === "panel" && !models.length) {
      vscode.postMessage({ type: "ready", surface: UI_SURFACE });
    }
  }, 400);
})();

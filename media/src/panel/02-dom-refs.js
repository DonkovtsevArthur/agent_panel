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
  const settingsCommitModelList = document.getElementById("settingsCommitModelList");
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
  const settingsCommitModelsLabel = document.getElementById(
    "settingsCommitModelsLabel"
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

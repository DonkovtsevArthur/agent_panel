/**
 * Shared Settings webview payload built from Harbor `getConfig()`.
 * VS Code and JetBrains hosts add host-specific fields (modes serialization,
 * workspace name, Figma/provider status) on top.
 */
import {
  getConfig,
  resolveModelSupportsVision,
  type AgentPanelConfig,
  type AgentModel,
} from "./config";
import { resolveUiLanguage, type UiLanguage } from "./i18n";

export type HarborSettingsPayloadCore = {
  providers: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
  defaultModel: string;
  language: AgentPanelConfig["language"];
  fontSize: number;
  resolvedLanguage: UiLanguage;
  defaultContextWindow: number;
  baseUrl: string;
  apiKey: string;
  rejectUnauthorized: boolean;
  caBundlePath: string;
  systemPrompt: string;
  soundNotificationsEnabled: boolean;
  subagentsEnabled: boolean;
  parallelToolCallsEnabled: boolean;
  autoCompactEnabled: boolean;
  toolsAutoApprove: boolean;
  toolsApprovals: AgentPanelConfig["tools"]["approvals"];
  turnContextFollowUps: AgentPanelConfig["turnContext"]["followUps"];
  checkpointsEnabled: boolean;
  skillsEnabled: boolean;
  skillsWorkspaceEnabled: boolean;
  skillsGlobalEnabled: boolean;
  skillsExtraDirectories: string[];
  skillsDisabledExtraDirectories: string[];
  skillsDisabled: string[];
  selectionHintsEnabled: boolean;
  commitMessagePrompt: string;
  commitMessageLanguage: string;
  commitMessageModelIds: string[];
  commitMessageScope: AgentPanelConfig["commitMessage"]["scope"];
  figmaEnabled: boolean;
  autoglmEnabled: boolean;
  autoglmBinaryPath: string;
  autoglmBrowser: string;
  autoglmAutoApprove: boolean;
};

function modelRow(
  m: AgentModel,
  supportsVision: boolean | undefined
): Record<string, unknown> {
  return {
    id: m.id,
    label: m.label || "",
    providerId: m.providerId || "",
    contextWindow: m.contextWindow || undefined,
    maxOutputTokens: m.maxOutputTokens || undefined,
    enabled: m.enabled !== false,
    favorite: m.favorite === true,
    supportsVision,
    ...(m.reasoningEffort ? { reasoningEffort: m.reasoningEffort } : {}),
  };
}

/**
 * Core settings fields shared by VS Code `agentPanelProvider` and JetBrains
 * `headlessPanelHost`. Callers merge `modes`, `workspaceName`, `figma`, and
 * `providerConnStatuses`.
 */
export function buildHarborSettingsPayloadCore(
  config: AgentPanelConfig = getConfig(),
  options?: {
    /** When true (VS Code), resolve vision via capability helper; else use model flag. */
    resolveVision?: boolean;
  }
): HarborSettingsPayloadCore {
  const resolveVision = options?.resolveVision === true;
  return {
    providers: config.providers.map((p) => ({
      id: p.id,
      name: p.name || "",
      baseUrl: p.baseUrl,
      apiKey: p.apiKey || "",
      statusUrl: p.statusUrl || "",
      ...(p.protocol ? { protocol: p.protocol } : {}),
      ...(typeof p.promptCache === "boolean"
        ? { promptCache: p.promptCache }
        : {}),
    })),
    models: config.models.map((m) =>
      modelRow(
        m,
        resolveVision ? resolveModelSupportsVision(m) : m.supportsVision
      )
    ),
    defaultModel: config.defaultModel,
    language: config.language,
    fontSize: config.fontSize,
    resolvedLanguage: resolveUiLanguage(config.language),
    defaultContextWindow: config.defaultContextWindow,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    rejectUnauthorized: config.rejectUnauthorized,
    caBundlePath: config.caBundlePath,
    systemPrompt: config.systemPrompt,
    soundNotificationsEnabled: config.soundNotifications.enabled,
    subagentsEnabled: config.subagents.enabled,
    parallelToolCallsEnabled: config.parallelToolCalls.enabled,
    autoCompactEnabled: config.autoCompact.enabled,
    toolsAutoApprove: config.tools.autoApprove,
    toolsApprovals: config.tools.approvals,
    turnContextFollowUps: config.turnContext.followUps,
    checkpointsEnabled: config.checkpoints.enabled,
    skillsEnabled: config.skills.enabled,
    skillsWorkspaceEnabled: config.skills.workspaceEnabled,
    skillsGlobalEnabled: config.skills.globalEnabled,
    skillsExtraDirectories: config.skills.extraDirectories,
    skillsDisabledExtraDirectories: config.skills.disabledExtraDirectories,
    skillsDisabled: config.skills.disabled,
    selectionHintsEnabled: config.selectionHints.enabled,
    commitMessagePrompt: config.commitMessage.prompt,
    commitMessageLanguage: config.commitMessage.language,
    commitMessageModelIds: config.commitMessage.modelIds,
    commitMessageScope: config.commitMessage.scope,
    figmaEnabled: config.figma.enabled,
    autoglmEnabled: config.autoglm.enabled,
    autoglmBinaryPath: config.autoglm.binaryPath,
    autoglmBrowser: config.autoglm.browser,
    autoglmAutoApprove: config.autoglm.autoApprove,
  };
}

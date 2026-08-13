import type { AgentEvent, AgentTool } from "@cline/shared";
import {
	createBuiltinTools,
	resolveToolPresetName,
	type ToolExecutors,
	ToolPresets,
} from "../../../extensions/tools";
import type {
	SubAgentEndContext,
	SubAgentStartContext,
} from "../../../extensions/tools/team";
import { createSpawnAgentTool } from "../../../extensions/tools/team";
import { buildTelemetryAgentIdentity } from "../../../services/agent-events";
import { filterDisabledTools } from "../../../services/global-settings";
import {
	captureAgentCreated,
	captureSubagentExecution,
} from "../../../services/telemetry/core-events";
import type { CoreSessionConfig } from "../../../types/config";
import type { ActiveSession } from "../../../types/session";

export type SubAgentStartTracker = Map<
	string,
	{ startedAt: number; rootSessionId: string }
>;

export interface SpawnToolDeps {
	getSession(sessionId: string): ActiveSession | undefined;
	subAgentStarts: SubAgentStartTracker;
	onAgentEvent(
		rootSessionId: string,
		config: CoreSessionConfig,
		event: AgentEvent,
	): void;
	invokeBackendOptional(method: string, ...args: unknown[]): Promise<void>;
}

export type SessionSubAgentLifecycleCallbacks = {
	onSubAgentEvent: (event: AgentEvent) => void;
	onSubAgentStart: (context: SubAgentStartContext) => void;
	onSubAgentEnd: (context: SubAgentEndContext) => void;
};

/** Serialize spawn_agent runs per root session — LiteLLM often 400s parallel child streams. */
const spawnTailByRootSession = new Map<string, Promise<void>>();

function enqueueRootSpawn<T>(
	rootSessionId: string,
	task: () => Promise<T>,
): Promise<T> {
	const prev = spawnTailByRootSession.get(rootSessionId) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	spawnTailByRootSession.set(
		rootSessionId,
		prev.then(
			() => gate,
			() => gate,
		),
	);
	return prev.then(
		async () => {
			try {
				return await task();
			} finally {
				release();
			}
		},
		async () => {
			try {
				return await task();
			} finally {
				release();
			}
		},
	);
}

function sanitizeSubagentKnownModels(
	knownModels: CoreSessionConfig["knownModels"] | undefined,
): CoreSessionConfig["knownModels"] | undefined {
	if (!knownModels) {
		return knownModels;
	}
	const out: NonNullable<CoreSessionConfig["knownModels"]> = {};
	for (const [id, model] of Object.entries(knownModels)) {
		if (!model || typeof model !== "object") {
			continue;
		}
		const caps = Array.isArray(model.capabilities)
			? model.capabilities.filter(
					(cap) => cap !== "reasoning" && cap !== "reasoning-effort",
				)
			: ["tools"];
		out[id] = {
			...model,
			capabilities: caps.length > 0 ? caps : ["tools"],
		};
	}
	return out;
}

/**
 * Harbor openai-compatible + Claude: do NOT force `thinking: false` on children.
 * Parent Claude works with OpenAI-style `reasoning_effort` (capabilities omit
 * `reasoning` so Anthropic wire thinking is not emitted). Forcing thinking off
 * on children still yields LiteLLM/OpenRouter `streaming_error` 400 for
 * claude-sonnet/haiku, while gpt/kimi/deepseek children succeed either way.
 * Only strip catalog `reasoning` capabilities; inherit parent thinking/effort.
 */
function buildSubagentConnectionOverlay(config: CoreSessionConfig): {
	knownModels: CoreSessionConfig["knownModels"] | undefined;
	providerConfig: CoreSessionConfig["providerConfig"];
} {
	const knownModels = sanitizeSubagentKnownModels(
		config.knownModels ?? config.providerConfig?.knownModels,
	);
	return {
		knownModels,
		providerConfig: {
			...(config.providerConfig ?? {}),
			...(knownModels ? { knownModels } : {}),
		},
	};
}

export function createSessionSubAgentLifecycleCallbacks(
	deps: SpawnToolDeps,
	config: CoreSessionConfig,
	rootSessionId: string,
): SessionSubAgentLifecycleCallbacks {
	return {
		onSubAgentEvent: (event) => deps.onAgentEvent(rootSessionId, config, event),
		onSubAgentStart: (context) => {
			const teamRuntime = deps.getSession(rootSessionId)?.runtime.teamRuntime;
			deps.subAgentStarts.set(context.subAgentId, {
				startedAt: Date.now(),
				rootSessionId,
			});
			const agentIdentity = buildTelemetryAgentIdentity({
				agentId: context.subAgentId,
				conversationId: context.conversationId,
				parentAgentId: context.parentAgentId,
				teamId: teamRuntime?.getTeamId(),
				teamName: teamRuntime?.getTeamName(),
				createdByAgentId: context.parentAgentId,
			});
			if (agentIdentity) {
				captureAgentCreated(config.telemetry, {
					ulid: rootSessionId,
					modelId: config.modelId,
					provider: config.providerId,
					...agentIdentity,
				});
			}
			captureSubagentExecution(config.telemetry, {
				event: "started",
				ulid: rootSessionId,
				durationMs: 0,
				parentId: context.parentAgentId,
				agentId: context.subAgentId,
				...agentIdentity,
			});
			void deps.invokeBackendOptional(
				"handleSubAgentStart",
				rootSessionId,
				context,
			);
		},
		onSubAgentEnd: (context) => {
			const teamRuntime = deps.getSession(rootSessionId)?.runtime.teamRuntime;
			const started = deps.subAgentStarts.get(context.subAgentId);
			const durationMs = started ? Date.now() - started.startedAt : 0;
			const outputLines = context.result?.text
				? context.result.text.split("\n").length
				: 0;
			captureSubagentExecution(config.telemetry, {
				event: "ended",
				ulid: rootSessionId,
				durationMs,
				outputLines,
				errorMessage: context.error ? String(context.error) : undefined,
				agentId: context.subAgentId,
				parentId: context.parentAgentId,
				...buildTelemetryAgentIdentity({
					agentId: context.subAgentId,
					conversationId: context.conversationId,
					parentAgentId: context.parentAgentId,
					teamId: teamRuntime?.getTeamId(),
					teamName: teamRuntime?.getTeamName(),
					createdByAgentId: context.parentAgentId,
				}),
			});
			deps.subAgentStarts.delete(context.subAgentId);
			void deps.invokeBackendOptional(
				"handleSubAgentEnd",
				rootSessionId,
				context,
			);
		},
	};
}

export function createSessionSpawnTool(
	deps: SpawnToolDeps,
	config: CoreSessionConfig,
	rootSessionId: string,
	toolExecutors?: Partial<ToolExecutors>,
): AgentTool {
	const lifecycle = createSessionSubAgentLifecycleCallbacks(
		deps,
		config,
		rootSessionId,
	);
	const createSubAgentTools = () => {
		// Children get parent mode tools but never nested spawn_agent (avoids
		// recursive fan-out + keeps the tool list aligned with the sub-agent
		// system prompt which says spawn is unavailable).
		const tools: AgentTool[] = config.enableTools
			? createBuiltinTools({
					cwd: config.cwd,
					telemetry: config.telemetry,
					...ToolPresets[resolveToolPresetName({ mode: config.mode })],
					enableAskQuestion: false,
					enableSpawnAgent: false,
					enableAgentTeams: false,
					executors: toolExecutors,
				})
			: [];
		// Harbor MCP (and any other host extraTools) — parent-only until this
		// concat; children otherwise cannot call Figma / custom MCP servers.
		const extras = Array.isArray(config.extraTools) ? config.extraTools : [];
		return filterDisabledTools([...tools, ...extras]);
	};

	const overlay = buildSubagentConnectionOverlay(config);
	const tool = createSpawnAgentTool({
		configProvider: {
			getRuntimeConfig: () => {
				const live = deps
					.getSession(rootSessionId)
					?.runtime.delegatedAgentConfigProvider?.getRuntimeConfig();
				const base = live ?? {
					providerId: config.providerId,
					modelId: config.modelId,
					cwd: config.cwd,
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
					headers: config.headers,
					providerConfig: config.providerConfig,
					knownModels: config.knownModels,
					maxIterations: config.maxIterations,
					hooks: config.hooks,
					extensions: config.extensions,
					logger: config.logger,
					telemetry: config.telemetry,
					workspaceMetadata: config.workspaceMetadata,
				};
				return {
					...base,
					...overlay,
					providerConfig: {
						...(base.providerConfig ?? {}),
						...overlay.providerConfig,
					},
				};
			},
			getConnectionConfig: () => {
				const live = deps
					.getSession(rootSessionId)
					?.runtime.delegatedAgentConfigProvider?.getConnectionConfig();
				const base = live ?? {
					providerId: config.providerId,
					modelId: config.modelId,
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
					headers: config.headers,
					providerConfig: config.providerConfig,
					knownModels: config.knownModels,
				};
				return {
					...base,
					...overlay,
					providerConfig: {
						...(base.providerConfig ?? {}),
						...overlay.providerConfig,
					},
				};
			},
			updateConnectionDefaults: () => {},
		},
		createSubAgentTools,
		...lifecycle,
	}) as AgentTool;

	return {
		...tool,
		execute: (input, context) =>
			enqueueRootSpawn(rootSessionId, () => tool.execute(input, context)),
	} as AgentTool;
}

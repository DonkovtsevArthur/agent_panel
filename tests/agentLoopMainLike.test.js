const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("all models use main-like agent loop and tools", () => {
  const { modelUsesMainLikeApi, modelNeedsGatewayWorkarounds } = require(
    "../out/modelCapabilities.js"
  );
  assert.equal(modelUsesMainLikeApi("Qwen3-Coder-Next"), true);
  assert.equal(modelUsesMainLikeApi("DeepSeek-V4-Flash"), true);
  assert.equal(modelUsesMainLikeApi("gpt-4.1"), true);
  assert.equal(modelNeedsGatewayWorkarounds("gpt-4.1"), false);

  const toolsSrc = fs.readFileSync(
    path.join(__dirname, "../src/mainLikeTools.ts"),
    "utf8"
  );
  assert.match(toolsSrc, /name: "list_files"/);
  assert.match(toolsSrc, /name: "read_file"/);
  assert.match(toolsSrc, /name: "get_diagnostics"/);
  assert.match(toolsSrc, /name: "write_file"/);
  assert.match(toolsSrc, /name: "run_command"/);
  assert.match(toolsSrc, /name: "fetch_url"/);
  assert.match(toolsSrc, /name: "open_external"/);

  const loopSrc = fs.readFileSync(
    path.join(__dirname, "../src/agentLoop.ts"),
    "utf8"
  );
  assert.match(loopSrc, /return runMainLikeAgentTurn\(options\)/);

  const mainLikeSrc = fs.readFileSync(
    path.join(__dirname, "../src/agentLoopMainLike.ts"),
    "utf8"
  );
  assert.match(mainLikeSrc, /mainLikeToolsForPolicy/);
  assert.match(mainLikeSrc, /runMainLikeTool/);
  assert.match(mainLikeSrc, /max_tokens: effectiveMaxTokens/);
  assert.match(mainLikeSrc, /modeFinalNudge/);
  assert.match(mainLikeSrc, /buildExploreSoftNudge|EXPLORE_SOFT_NUDGE/);
  assert.match(mainLikeSrc, /hardCut|EXPLORE_HARD_CUT/);
  assert.match(mainLikeSrc, /shouldExtendToolRounds|Продлеваю раунды/);
  assert.match(mainLikeSrc, /decideHonestFinale/);
  assert.match(mainLikeSrc, /MISSING_WRITE_USER_NUDGE/);
  assert.match(mainLikeSrc, /applyHonestFinaleOrNudge/);
  assert.match(mainLikeSrc, /finalizeAssistantText|emptyFinalAttempts/);
  assert.match(mainLikeSrc, /EMPTY_WRITE_USER_NUDGE|forceNonEmptyTextReply/);
  assert.match(mainLikeSrc, /VERIFY_REPO_FACTS_HINT|prepareRoundMessages/);
  assert.match(mainLikeSrc, /ensureToolResultsIntentHint|completionIntent/);
  // Skip «Планирую…» flash between tool waves — only before first model call.
  assert.match(
    mainLikeSrc,
    /completionIntent !== "tool_results"[\s\S]*?modeThinkingLabel/
  );
  assert.match(mainLikeSrc, /onToolLifecycle|emitToolLifecycle|onStep/);
  assert.match(mainLikeSrc, /requestAssistant|onDelta/);
  assert.match(mainLikeSrc, /assistantTurnFromApi|reasoning_content/);
  assert.match(mainLikeSrc, /isKimiFamilyModel/);
  assert.match(mainLikeSrc, /enablePostEditVerification/);
  assert.match(mainLikeSrc, /decideVerificationStep|applyVerificationGate/);
  assert.match(mainLikeSrc, /selectProjectVerificationCommand/);
  assert.match(mainLikeSrc, /get_diagnostics/);

  assert.match(mainLikeSrc, /listOpenAiTools\(false\)/);
  assert.match(mainLikeSrc, /isAllowedToolInReadonlyMainLike/);
  assert.match(mainLikeSrc, /isMainLikeWriteTool/);
  assert.match(mainLikeSrc, /FOCUSED_EDIT_HINT/);

  const i18nSrc = fs.readFileSync(
    path.join(__dirname, "../src/i18n.ts"),
    "utf8"
  );
  assert.match(i18nSrc, /list_files, read_file, write_file, run_command/);
  assert.match(i18nSrc, /активный файл, курсор, выделение/);

  const modesSrc = fs.readFileSync(
    path.join(__dirname, "../src/modes.ts"),
    "utf8"
  );
  assert.match(modesSrc, /Connected MCP tools are available in Plan mode/);
  assert.match(modesSrc, /Connected MCP tools are available in Ask mode/);
  assert.match(modesSrc, /never say MCP is unavailable in this mode/);
});

test("main-like tools expose search_replace as a write tool (Zed-style focused edit)", () => {
  const toolsSrc = fs.readFileSync(
    path.join(__dirname, "../src/mainLikeTools.ts"),
    "utf8"
  );
  // search_replace is defined in the main-like tool set
  assert.match(toolsSrc, /name: "search_replace"/);
  // dispatched to runTool
  assert.match(toolsSrc, /case "search_replace":/);
  // treated as a write tool
  assert.match(toolsSrc, /MAIN_LIKE_WRITE_TOOL_NAMES/);
  assert.match(toolsSrc, /"write_file",\s*"search_replace"/);
  assert.match(toolsSrc, /isMainLikeWriteTool/);
  // NOT in the readonly set (Plan/Ask must not expose it)
  const readonlyBlock = toolsSrc.match(
    /MAIN_LIKE_READONLY_TOOL_NAMES = new Set\(\[([^]*?)\]\)/
  );
  assert.ok(readonlyBlock, "MAIN_LIKE_READONLY_TOOL_NAMES block found");
  assert.doesNotMatch(readonlyBlock[1], /"search_replace"/);
  // tool description nudges toward search_replace for focused edits
  assert.match(toolsSrc, /Точно заменить текст в существующем файле/);
  assert.match(toolsSrc, /ПРЕДПОЧИТАЙ этот инструмент для точечных правок/);
});

test("post-edit verification is enabled for all Agent turns", () => {
  const { isKimiFamilyModel } = require("../out/openaiClient.js");
  assert.equal(isKimiFamilyModel("kimi-k2.6"), true);
  assert.equal(isKimiFamilyModel("moonshot/kimi-k2.5"), true);
  assert.equal(isKimiFamilyModel("Qwen3-Coder-Next"), false);

  const mainLikeSrc = fs.readFileSync(
    path.join(__dirname, "../src/agentLoopMainLike.ts"),
    "utf8"
  );
  assert.match(mainLikeSrc, /const kimiModel = isKimiFamilyModel\(options\.model\)/);
  // Gate is Agent (!readonly), not Kimi-only.
  assert.match(
    mainLikeSrc,
    /enablePostEditVerification\s*=\s*!readonly/
  );
  assert.doesNotMatch(
    mainLikeSrc,
    /enablePostEditVerification\s*=\s*!readonly\s*&&\s*kimiModel/
  );
  assert.match(mainLikeSrc, /buildKimiWorkspaceFollowHint/);
  // Analogue-UI hint is injected for all Agent models (not kimiModel && …).
  assert.match(
    mainLikeSrc,
    /!agentsMdTurn &&\s*!readonly &&\s*!focusedPlanEdit &&\s*!agentMechanical &&\s*!discardScope/
  );
  assert.match(mainLikeSrc, /looksLikePlanImplementRequest/);
  assert.match(mainLikeSrc, /looksLikeEditCorrectionRequest/);
  assert.match(mainLikeSrc, /looksLikeDirectiveFixRequest/);
  assert.match(mainLikeSrc, /buildPlanImplementSystemHint/);
  assert.match(mainLikeSrc, /buildEditCorrectionSystemHint/);
  assert.match(mainLikeSrc, /lessonFromDirectiveFix/);
  assert.match(
    mainLikeSrc,
    /exploreRoundLimits\(\{\s*kimi: kimiModel,\s*implementPlan,\s*editCorrection,\s*planQuality[\s\S]*?planRevision[\s\S]*?planMechanical/
  );
  assert.match(mainLikeSrc, /PLAN_REVISION_HINT/);
  assert.match(mainLikeSrc, /PLAN_MECHANICAL_HINT/);
  assert.match(mainLikeSrc, /looksLikeMechanicalPlanRequest/);
  assert.match(mainLikeSrc, /historyHasProposedPlan/);
  assert.match(mainLikeSrc, /PLAN_QUALITY_NUDGE/);
  assert.match(mainLikeSrc, /nudge_plan_quality/);
  assert.match(mainLikeSrc, /DEFAULT_WORKSPACE_RULE_CHAR_CAP/);
  assert.match(mainLikeSrc, /loadLearnedErrors|appendLearnedErrors/);
  assert.match(mainLikeSrc, /formatLearnedErrorsForSystem/);
  assert.match(mainLikeSrc, /queueLearnedErrors|lessonsFromPlanQualityReasons/);
  assert.match(mainLikeSrc, /AGENT_MECHANICAL_HINT|looksLikeAgentMechanicalRequest/);
  assert.match(mainLikeSrc, /agentMechanical/);
  assert.match(mainLikeSrc, /buildPlanChecklistPartialFinale/);
  assert.match(mainLikeSrc, /maxPlanChecklistNudges = 3/);
  assert.match(mainLikeSrc, /lessonsFromFutureRuleProse|lessonsFromUserCorrection/);
  assert.match(mainLikeSrc, /tool\.function\.name !== "get_diagnostics"/);
});

test("readonly main-like allows Figma MCP and blocks write_file", () => {
  const { isAllowedMcpInReadonlyMode } = require("../out/mcp/types.js");
  assert.equal(
    isAllowedMcpInReadonlyMode("mcp__figma__get_figma_data"),
    true
  );
  assert.equal(isAllowedMcpInReadonlyMode("mcp__figma__use_figma"), true);
  assert.equal(isAllowedMcpInReadonlyMode("mcp__other__get_metadata"), true);
  assert.equal(isAllowedMcpInReadonlyMode("mcp__other__create_ticket"), false);
  assert.equal(isAllowedMcpInReadonlyMode("write_file"), false);

  const toolsSrc = fs.readFileSync(
    path.join(__dirname, "../src/mainLikeTools.ts"),
    "utf8"
  );
  assert.match(toolsSrc, /isAllowedToolInReadonlyMainLike/);
  assert.match(toolsSrc, /isAllowedMcpInReadonlyMode/);
  // Plan prompt advertises delegate_task — it must be in the readonly schema
  const readonlyBlock = toolsSrc.match(
    /MAIN_LIKE_READONLY_TOOL_NAMES = new Set\(\[([^]*?)\]\)/
  );
  assert.ok(readonlyBlock, "MAIN_LIKE_READONLY_TOOL_NAMES block found");
  assert.match(readonlyBlock[1], /"delegate_task"/);
  assert.match(readonlyBlock[1], /"request_user_input"/);
  assert.match(readonlyBlock[1], /"search_text"/);
});

test("MCP screenshots respect preferred-vision delivery policy", () => {
  const mainLikeSrc = fs.readFileSync(
    path.join(__dirname, "../src/agentLoopMainLike.ts"),
    "utf8"
  );
  assert.match(mainLikeSrc, /shouldDeliverRawScreenshotToPlanner/);
  assert.match(mainLikeSrc, /resolveModelSupportsVision/);
  assert.match(mainLikeSrc, /pendingVisionImageUrls/);
  assert.match(mainLikeSrc, /type: "image_url" as const/);
  assert.match(mainLikeSrc, /Harbor vision helper · raw screenshot/);
  assert.match(mainLikeSrc, /captureUrlScreenshot/);
  assert.match(mainLikeSrc, /deliverVisionMedia/);
  assert.match(mainLikeSrc, /vision_page_screenshot/);
});

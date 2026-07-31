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
  assert.match(mainLikeSrc, /max_tokens: config\.maxTokens/);
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

test("post-edit verification is gated to Kimi agent turns only", () => {
  const { isKimiFamilyModel } = require("../out/openaiClient.js");
  assert.equal(isKimiFamilyModel("kimi-k2.6"), true);
  assert.equal(isKimiFamilyModel("moonshot/kimi-k2.5"), true);
  assert.equal(isKimiFamilyModel("Qwen3-Coder-Next"), false);

  const mainLikeSrc = fs.readFileSync(
    path.join(__dirname, "../src/agentLoopMainLike.ts"),
    "utf8"
  );
  assert.match(mainLikeSrc, /const kimiModel = isKimiFamilyModel\(options\.model\)/);
  assert.match(
    mainLikeSrc,
    /enablePostEditVerification[\s\S]*?kimiModel/
  );
  assert.match(mainLikeSrc, /buildKimiWorkspaceFollowHint/);
  assert.match(mainLikeSrc, /exploreRoundLimits\(\{ kimi: kimiModel \}\)/);
  assert.match(mainLikeSrc, /DEFAULT_WORKSPACE_RULE_CHAR_CAP/);
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
});

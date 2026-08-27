#!/usr/bin/env node
/** Extract Harbor panel.css subset for Figma UI visual parity. */
const fs = require("fs");
const outPath = require("path").join(__dirname, "..", "figma", "ui.css");
const panel = fs.readFileSync(
  require("path").join(__dirname, "..", "media", "panel.css"),
  "utf8"
);

const keepPrefixes = [
  ":root",
  "*",
  "html",
  "body",
  ".material-symbols",
  ".screen",
  "#messages",
  ".msg",
  ".agents-top",
  ".agents-list",
  ".agents-title",
  ".agents-rail",
  ".agent-",
  ".row-action",
  ".agents-empty",
  ".chat-top",
  ".chat-agent",
  ".chat-top-text",
  ".chat-screen",
  ".composer",
  "#prompt",
  ".icon-btn",
  "button.primary",
  ".model-",
  ".mode-picker",
  ".settings-",
  ".text-btn",
  ".workspace-shell",
  ".provider-status",
  ".selection-preview",
  ".md-",
  ".msg-body",
  ".tool-group",
  ".chat-turn",
  "@keyframes cube-build",
  "@keyframes harbor-timeline-dot-pulse",
];

const lines = panel.split("\n");
const out = [];
let i = 0;

function takeBlock() {
  let depth = 0;
  let started = false;
  while (i < lines.length) {
    const l = lines[i];
    out.push(l);
    for (const ch of l) {
      if (ch === "{") {
        depth++;
        started = true;
      }
      if (ch === "}") depth--;
    }
    i++;
    if (started && depth === 0) break;
  }
  out.push("");
}

/** True if line is a selector fragment that continues on the next line. */
function isSelectorContinuation(line) {
  const t = line.trim();
  return t.length > 0 && t.endsWith(",");
}

while (i < lines.length) {
  const trimmed = lines[i].trimStart();
  if (
    trimmed.startsWith("@media") &&
    lines.slice(i, i + 40).join("\n").includes("settings-")
  ) {
    takeBlock();
    continue;
  }
  const isKeep = keepPrefixes.some(
    (p) =>
      trimmed.startsWith(p) ||
      trimmed.includes(p + ",") ||
      trimmed.includes(", " + p) ||
      trimmed.includes("," + p)
  );
  if (isKeep && trimmed.includes("{")) {
    // Multi-line selectors: the keep match is often only on the last line
    // (the one with `{`). Prepend earlier fragments so rules like
    // `button.primary.is-stop .icon-send,\nbutton.primary.is-queue .icon-send {`
    // are kept intact — otherwise stop-state still shows the send icon.
    let start = i;
    while (start > 0 && isSelectorContinuation(lines[start - 1])) {
      start--;
    }
    for (let k = start; k < i; k++) {
      out.push(lines[k]);
    }
    takeBlock();
    continue;
  }
  i++;
}

// Strip IDE-only blocks; keep mcp-switch (Harbor toggle look) by renaming later.
const skipRe =
  /^\.(mcp-servers|mcp-body|mcp-toolbar|mcp-search|mcp-presets|mcp-section|mcp-empty|mcp-settings|skills-|scm-|commit-)|composer-scm|figmaConnect/;
const cleaned = [];
let skip = false;
let depth = 0;
for (const line of out) {
  const t = line.trimStart();
  if (!skip && skipRe.test(t)) {
    skip = true;
    depth = 0;
  }
  if (skip) {
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    if (depth <= 0 && line.includes("}")) skip = false;
    continue;
  }
  cleaned.push(line);
}

const alias = `/* Harbor Figma UI — visual subset of media/panel.css + Figma theme aliases */
:root {
  --vscode-foreground: var(--figma-color-text, #1e1e1e);
  --vscode-descriptionForeground: var(--figma-color-text-secondary, #6b6b6b);
  --vscode-editor-background: var(--figma-color-bg, #ffffff);
  --vscode-sideBar-background: var(--figma-color-bg-secondary, #f5f5f5);
  --vscode-input-background: var(--figma-color-bg, #ffffff);
  --vscode-input-foreground: var(--figma-color-text, #1e1e1e);
  --vscode-input-placeholderForeground: var(--figma-color-text-tertiary, #999);
  --vscode-input-border: var(--figma-color-border, #e5e5e5);
  --vscode-focusBorder: var(--figma-color-border-selected-strong, #0d99ff);
  --vscode-button-background: var(--figma-color-bg-brand, #0d99ff);
  --vscode-button-foreground: var(--figma-color-text-onbrand, #ffffff);
  --vscode-textLink-foreground: var(--figma-color-text-brand, #0d99ff);
  --vscode-editorWidget-background: var(--figma-color-bg, #ffffff);
  --vscode-widget-border: var(--figma-color-border, #e5e5e5);
  --vscode-editorGroup-border: var(--figma-color-border, #e5e5e5);
  --vscode-widget-shadow: rgba(0, 0, 0, 0.35);
  --mode-plan: #a67c00;
  --mode-ask: #2d6a4f;
  --mode-agent: #0d99ff;
  --harbor-font-size: 13px;
}

html, body {
  height: 100%;
  margin: 0;
  overflow: hidden;
  font-size: var(--harbor-font-size, 13px);
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
}

#workspaceShell.workspace-shell {
  display: flex;
  flex-direction: row;
  height: 100%;
  min-height: 0;
  position: relative;
}
#workspaceShell.workspace-shell[hidden] {
  display: none !important;
}

.empty-hint {
  color: var(--vscode-descriptionForeground, #888);
  text-align: center;
  margin: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.empty-hint .text-btn {
  margin-top: 4px;
}

.settings-top {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
}
.settings-title {
  font-size: 12.5px;
  font-weight: 600;
  flex: 1;
}

/* Harbor toggle (same look as IDE mcp-switch) */
.settings-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 18px;
  cursor: pointer;
}
.settings-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.settings-switch-track {
  width: 34px;
  height: 18px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vscode-foreground) 22%, transparent);
  transition: background 0.15s ease;
  position: relative;
}
.settings-switch-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vscode-editor-background, #fff);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
  transition: transform 0.15s ease;
}
.settings-switch input:checked + .settings-switch-track {
  background: var(--vscode-focusBorder, #0d99ff);
}
.settings-switch input:checked + .settings-switch-track::after {
  transform: translateX(16px);
}

.status-line {
  min-height: 14px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 4px;
  padding: 0 10px 6px;
}

/* Figma Inspect panel is always narrow — settings nav on top like compact VS Code */
html[data-surface="figma"] .settings-layout {
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
html[data-surface="figma"] .settings-nav {
  flex: 0 0 auto;
  width: 100%;
  flex-direction: row;
  flex-wrap: wrap;
  border-right: none;
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  padding-bottom: 8px;
}
html[data-surface="figma"] .settings-nav-item {
  width: auto;
  flex: 1 1 auto;
}
html[data-surface="figma"] .settings-body {
  padding: 12px 12px 24px;
  max-width: none;
}
html[data-surface="figma"] .settings-modal-card {
  max-width: calc(100% - 24px);
  margin: 12px;
}
html[data-surface="figma"] #settingsScreen {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
html[data-surface="figma"] #settingsScreen[hidden] {
  display: none !important;
}

/* Always show delete on chat rows (narrow Inspect panel, limited hover) */
html[data-surface="figma"] .agent-row-wrap .row-action {
  opacity: 1;
  pointer-events: auto;
}
html[data-surface="figma"] .agents-empty {
  padding: 16px 10px;
  color: var(--vscode-descriptionForeground, #888);
  font-size: 12.5px;
  text-align: center;
}

/* Selection chip inside composer */
html[data-surface="figma"] .composer .selection-preview {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 8px);
  background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}
html[data-surface="figma"] .composer .selection-preview[hidden] {
  display: none !important;
}
html[data-surface="figma"] .composer .selection-preview img {
  width: 36px;
  height: 36px;
  object-fit: contain;
  border-radius: 4px;
  background: #fff;
  flex-shrink: 0;
}

html[data-surface="figma"] .mode-picker[data-mode="ask"] .model-label {
  color: var(--mode-ask, #2d6a4f);
  font-weight: 500;
}
html[data-surface="figma"] .mode-picker[data-mode="plan"] .model-label {
  color: var(--mode-plan, #a67c00);
  font-weight: 500;
}
html[data-surface="figma"] .mode-picker[data-mode="agent"] .model-label {
  color: var(--mode-agent, #0d99ff);
  font-weight: 500;
}
html[data-surface="figma"] .model-menu .model-option[data-mode="ask"] .model-option-label {
  color: var(--mode-ask, #2d6a4f);
  font-weight: 500;
}
html[data-surface="figma"] .model-menu .model-option[data-mode="plan"] .model-option-label {
  color: var(--mode-plan, #a67c00);
  font-weight: 500;
}
html[data-surface="figma"] .model-menu .model-option[data-mode="agent"] .model-option-label {
  color: var(--mode-agent, #0d99ff);
  font-weight: 500;
}
html[data-surface="figma"] .model-menu.is-fixed {
  position: fixed;
  z-index: 10000;
}

html[data-surface="figma"] .composer .selection-preview.is-clickable {
  cursor: pointer;
}
html[data-surface="figma"] .composer .selection-preview.is-clickable:hover {
  background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
}
html[data-surface="figma"] .figma-tool-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 8px;
}
html[data-surface="figma"] .figma-tool-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
  color: var(--vscode-descriptionForeground);
}
html[data-surface="figma"] .figma-tool-step.is-ok {
  color: var(--mode-ask, #2d6a4f);
}
html[data-surface="figma"] .figma-tool-step.is-error {
  color: #c0392b;
}
html[data-surface="figma"] .figma-tool-step-label {
  font-weight: 500;
}
html[data-surface="figma"] .msg.user[data-mode="agent"] {
  border-color: color-mix(
    in srgb,
    var(--mode-agent, #0d99ff) var(--mode-border-user, 40%),
    transparent
  );
}
html[data-surface="figma"] .composer[data-mode="agent"] {
  border-color: color-mix(
    in srgb,
    var(--mode-agent, #0d99ff) var(--mode-border-composer, 22%),
    transparent
  );
}

/* Safety: multi-line panel selectors must not drop .agents-top layout */
.agents-top {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 8px;
  flex-shrink: 0;
}

/* Live «выполняю» row while a Figma turn is in flight */
html[data-surface="figma"] .figma-run-working {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 4px;
  padding: 2px 2px;
  font-size: calc(var(--harbor-font-size, 13px) * 0.92);
  color: var(--vscode-descriptionForeground, #888);
  opacity: 0.95;
}
html[data-surface="figma"] .figma-run-working-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  flex: none;
  background: var(--harbor-user-tint, #8fa4b8);
  animation: harbor-timeline-dot-pulse 1.2s ease-in-out infinite;
}
html[data-surface="figma"] .figma-run-working[data-mode="plan"] .figma-run-working-dot {
  background: var(--mode-plan, #a67c00);
}
html[data-surface="figma"] .figma-run-working[data-mode="ask"] .figma-run-working-dot {
  background: var(--mode-ask, #2d6a4f);
}
html[data-surface="figma"] .figma-run-working[data-mode="agent"] .figma-run-working-dot {
  background: var(--mode-agent, #0d99ff);
}
html[data-surface="figma"] .figma-run-working-label {
  font-weight: 500;
}

`;

fs.writeFileSync(outPath, alias + "\n" + cleaned.join("\n"));
console.log("Wrote", outPath, "bytes", fs.statSync(outPath).size);

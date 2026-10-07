---
name: figma-to-code
description: Implement UI from a Figma link in the IDE using the Figma MCP — map the design to existing components and design tokens. Load when the user pastes a figma.com link and asks to build, update, or compare a screen/component in code.
---

# Figma → code

The Figma frame defines **what** to build; the repo defines **how** (components, tokens, patterns).

## 1. Read the design

- Parse `fileKey` and `node-id` from the URL (`node-id=12-34` → `12:34`).
- Official Figma MCP: call `get_design_context` on the node, then `get_screenshot` on the same node. PAT/Framelink MCP: `get_figma_data` (+ `download_figma_images` if present).
- If the chat model has no vision, Harbor injects a text description of screenshots; if labels are still unclear, call `inspect_images`.
- Never invent UI from the file/frame title. If MCP is not connected, tell the user to connect Figma in Settings → MCP Servers.

## 2. Map to the codebase

- List the blocks of the frame (header, filters, table, cards, empty state, …).
- For each block, find the existing component to reuse (search the component library / `components/` folders, `code_nav` `symbols`). Prefer reuse over new components.
- Map colors, spacing, radii, typography to the project's **tokens** (CSS variables, theme object, Tailwind config). No hard-coded hex / px when a token exists; if none matches, pick the nearest and say so.
- Similar existing page = pattern to copy, not the target to modify, unless the user says so.

## 3. Build

- Structure first (layout, auto-layout → flex/grid), then content, then states: loading, empty, error, disabled, hover/focus.
- Real text from the design (respect i18n — add keys instead of literals if the project localizes).
- Responsive: check the frame width; if other breakpoints exist in Figma, fetch them too.
- Accessibility basics: semantic elements, labels for inputs and icon buttons, focus order.

## 4. Check

- Compare implemented blocks against the design list from step 2: each is `done` / `reused X` / `gap`.
- If a dev server is running and a browser tool is available, look at the result; otherwise list what the user should eyeball.

---
name: figma-design-audit
description: Audit Figma file structure for naming, layout, spacing, and consistency issues. Load when user asks to check/clean up/audit a design file or screen.
---

# Figma design audit (Harbor canvas tools)

## Audit workflow

1. **Inventory** — `figma_list_frames` on current page (or `selectedOnly: true` for scoped audit).
2. **Find problems** — `figma_find_nodes` with filters for common issues.
3. **Report** — list issues grouped by type, with node ids for quick fix.
4. **Fix** (Agent mode) — `figma_apply_edits` batch to resolve issues.

## Issue categories

### 1. Naming

`figma_find_nodes` with `nameContains` for generic names:

| Pattern | Problem |
|---------|---------|
| `Group`, `Frame`, `Rectangle`, `Ellipse` | Default Figma name — not semantic |
| `Copy`, `Copy 2`, `Copy 3` | Duplicated without renaming |
| Empty name `""` | Missing name entirely |

Fix: `figma_apply_edits` with `set_name` ops (max 40 per batch).

### 2. Layout health

`figma_layout_report` on each major frame:
- `needsFollowUp: true` → read `layoutCheck.issues` for specifics
- Common issues: overflow, children outside parent bounds, mixed sizing

Fix: `figma_align_in_frame`, `figma_set_layout_child`, `figma_resize_frame`.

### 3. Spacing consistency

`figma_inspect_node` with `fields: ["layout"]` on sibling containers:
- Compare `paddingTop/Right/Bottom/Left` and `itemSpacing`
- Flag when values differ by >2px across similar components

Fix: `figma_copy_styles` with `include: ["autoLayout"]` from the most common pattern.

### 4. Auto-layout candidates

Frames with multiple children using absolute positioning where auto-layout would work better:
- `figma_inspect_node` — check if `layoutMode` is `NONE` but children are arranged in a row/column
- Suggest converting to `HORIZONTAL` or `VERTICAL` auto-layout

Fix: `figma_set_auto_layout` + `figma_set_layout_child` for sizing.

### 5. Component usage

`figma_list_components` — list all components and their instances:
- Components with 0 instances → unused, candidate for removal
- Detached instances → lost design system link

Report only — don't delete without user confirmation.

### 6. Text layers

`figma_find_nodes` with `type: "TEXT"`:
- Multiple font families/sizes where consistency is expected
- `figma_inspect_node` on text nodes to read `fontName`, `fontSize`

Fix: `figma_apply_edits` with `set_font` to normalize.

## Scoped audit

- **Selection only**: `figma_list_frames` with `selectedOnly: true` + `figma_find_nodes` with `scope: "selection"`
- **Single screen**: `figma_find_nodes` with `rootId` set to the screen frame
- **Whole page**: `figma_list_frames` without filter

## Report format

```
## Audit: Screen Name

### Naming (3 issues)
- Frame "Group 5" → suggest "CardContainer" (id: 1:23)
- Frame "Frame 12" → suggest "HeaderRow" (id: 1:45)
- Rectangle "" → suggest "Divider" (id: 1:67)

### Layout (1 issue)
- Frame "Content" (id: 1:89): children overflow by 24px

### Spacing (2 issues)
- "Card A" padding 16px vs "Card B" padding 12px → suggest 16px
- "Row 1" gap 8px vs "Row 2" gap 12px → suggest 8px
```

## Do not

- Delete unused components without user confirmation
- Rename locked or hidden layers
- Audit entire file when user scoped to selection
- Fix issues the user didn't ask about — report first, fix on request

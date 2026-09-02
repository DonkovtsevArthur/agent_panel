---
name: figma-layer-naming
description: Layer naming and structure conventions for Harbor Figma Agent. Load before bulk rename, audit, or design-system cleanup tasks.
---

# Layer naming (Harbor Figma)

## Conventions

- **Semantic names**: `CardContainer`, `PrimaryButton`, `FilterRow` — not `Group 5`, `Frame 12`.
- **Component instances**: keep component name; add suffix only when user asks (e.g. `Button/Primary/Disabled`).
- **Screens**: `Screen/FeatureName` or match team pattern from **figma_inspect_node** on siblings.
- **Text layers**: name reflects role (`Title`, `Caption`, `ErrorMessage`), not full copy (copy lives in `characters`).

## Tools

| Task | Tool |
|------|------|
| Single rename | `figma_set_name` |
| Many renames | `figma_apply_edits` with op `set_name` (batch, max 40) |
| Inventory before rename | Selection JSON or `figma_list_frames` with `selectedOnly=true` |
| Focus after rename | `figma_focus_node` |

## Audit (Ask / Plan)

- List unnamed or generic names (`Group`, `Frame`, `Rectangle`) from selection tree.
- Suggest renames in Plan; execute in Agent with **figma_apply_edits**.
- Do not rename locked nodes.

## Scope

Rename **only** layers the user scoped (selection or named frames). Do not rename entire file unless explicitly asked.

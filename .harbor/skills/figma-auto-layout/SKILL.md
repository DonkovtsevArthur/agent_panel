---
name: figma-auto-layout
description: Auto-layout rules for Harbor Figma canvas tools (figma_set_auto_layout, figma_create_node, figma_apply_edits). Load before batch layout changes or when children overlap.
---

# Figma auto-layout (Harbor canvas tools)

Use **figma_inspect_node** on siblings before changing layout. Prefer **figma_apply_edits** for 2+ property changes in one RPC.

## Rules

1. **Containers with related children** → enable auto-layout (`layoutMode: HORIZONTAL` or `VERTICAL`), not absolute x/y for internal spacing.
2. **Align / center / distribute** → prefer **figma_align_in_frame** (one RPC) over setting x/y on each child. Works on auto-layout (axis alignment) and absolute frames (group move / distribute).
3. **After frame resize** (e.g. 1980→1440): in the **same turn**, call `figma_align_in_frame` on content containers or `figma_set_auto_layout` with `primaryAxisAlignItems`/`counterAxisAlignItems`. Then inspect parent — if still wrong, continue until done; do not stop after width-only change.
4. **Order matters**: append/reparent into auto-layout parent **before** setting `HUG`/`FILL` sizing on children.
5. **Padding/gap**: read existing frame first; match `paddingTop/Right/Bottom/Left` and `itemSpacing` from a similar row/column via **figma_copy_styles** when possible.
6. **Batch edits**: combine `set_auto_layout`, `set_geometry`, `reparent_node` in one **figma_apply_edits** call (max 80).
7. **Scope**: change only what the user asked — do not re-layout sibling screens for “consistency” unless requested.

## Tool mapping

| Goal | Tool |
|------|------|
| Find a named layer | `figma_find_nodes` with `nameContains` |
| Resize + align breakpoint | `figma_resize_frame` then `figma_layout_report` |
| Enable stack / row | `figma_set_auto_layout` with `layoutMode` |
| Center / align / distribute children | `figma_align_in_frame` with `mode` or `primaryAxisAlignItems` / `counterAxisAlignItems` |
| Axis alignment on auto-layout frame | `figma_set_auto_layout` or `figma_align_in_frame` with `primaryAxisAlignItems` / `counterAxisAlignItems` |
| One child stretch / align in stack | `figma_set_layout_child` with `layoutAlign`, `layoutGrow`, `layoutSizingHorizontal`/`Vertical` |
| Move into layout parent | `figma_reparent_node` then auto-layout props |
| Match spacing from reference | `figma_copy_styles` with `include: ["autoLayout"]` |
| Many small tweaks | `figma_apply_edits` ops: `set_auto_layout`, `set_geometry`, `reparent_node` |

## Custom fonts (Grtsk Peta, team fonts, …)

1. **figma_list_fonts** with `nameContains: "grtsk"` — only use family/style from this list.
2. Never merge weight into family unless figma_list_fonts shows that — Figma picker uses **Grtsk Peta** + **Semibold**, not «Grtsk Peta Semibold» as family.
3. If the font is missing from the list: it must be **installed on the computer** (Figma Desktop) or **uploaded by org admin** (Resources → Fonts). Ask the user — do not claim it is a plugin limitation.
4. **figma_copy_styles** from a text layer that already uses the correct font is safer than **figma_set_font** alone.

- Setting large absolute `x`/`y` inside a frame that should use auto-layout.
- Editing locked or hidden nodes (skipped in selection JSON).
- Re-fetching whole page via `figma_list_frames` when selection JSON already has ids.

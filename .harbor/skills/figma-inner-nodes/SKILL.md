---
name: figma-inner-nodes
description: Edit layers INSIDE frames — list children, batch edits, nudge, auto-layout child props. Load when user asks to align/fix/move inner content, cards, rows, text blocks.
---

# Figma inner nodes

User cares about **content inside** the screen — not just root frame size.

## Workflow

1. **Find container** — selection JSON, or `figma_find_nodes` `{ rootId, nameContains: "Content" }`.
2. **Inventory children** — `figma_list_children` `{ parentId }` (fast; ids + x/y + layout).
3. **Edit** — pick one path:
   - Same change on many siblings → `figma_apply_to_children` `{ parentId, nameContains, op, … }`
   - Different per layer → `figma_apply_edits` (max 80)
   - Small move in absolute layout → `figma_nudge_nodes` `{ nodeIds, dx, dy }` or `{ parentId, nameContains, dx, dy }`
   - Auto-layout stretch/align one child → `figma_set_layout_child`
4. **Verify** — `figma_layout_report` on the **content parent** until `needsFollowUp: false`.

## Tool map

| Task | Tool |
|------|------|
| List direct children | `figma_list_children` |
| Find deep inner layer | `figma_find_nodes` + `rootId` |
| Same fill/font/layout on all "Card*" | `figma_apply_to_children` |
| Move group of layers 8px down | `figma_nudge_nodes` |
| One row in stack fill width | `figma_set_layout_child` layoutGrow:1 |
| Text in subtree | `figma_batch_text_replace` or `figma_set_text` |

## Do not

- Only change root frame width when user asked to fix **inner** alignment
- `figma_list_frames` whole page when `figma_list_children` on known parent is enough
- Manual x/y on every child when parent can use auto-layout + `figma_align_in_frame`

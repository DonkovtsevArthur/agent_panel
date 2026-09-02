---
name: figma-resize-playbook
description: Breakpoint resize + internal layout fix in minimal tool calls. Load for width/height changes (1440, 375, etc.) or «под новый брейкпоинт».
---

# Figma resize playbook

## One-call path (preferred)

**figma_apply_recipe** `{ recipe: "resize_center", nodeId, width: 1440 }`  
or **figma_batch_tools** for find → resize → verify in one RPC:

```json
{
  "calls": [
    { "name": "figma_find_nodes", "args": { "nameContains": "Content", "scope": "selection" } },
    { "name": "figma_apply_recipe", "args": { "recipe": "resize_center", "nodeId": "<id>", "width": 1440 } }
  ]
}
```

**figma_resize_frame** (same as recipe resize_center):

```json
{
  "nodeId": "<frame-id>",
  "width": 1440,
  "alignMode": "center",
  "recursiveAlign": true
}
```

Or explicit axes:

```json
{
  "nodeId": "<frame-id>",
  "width": 1440,
  "primaryAxisAlignItems": "CENTER",
  "counterAxisAlignItems": "CENTER"
}
```

## Verify (required before finishing)

**figma_layout_report** on the same frame:

- `needsFollowUp: false` → done, reply to user
- `needsFollowUp: true` → read `layoutCheck.issues`, fix with **figma_align_in_frame** / **figma_set_layout_child** / **figma_apply_edits**, report again

## Match another screen

**figma_match_layout** `{ fromFrameId, toFrameId, include: ["autoLayout", "geometry", "childrenSizing"] }`

## Absolute layers that must stick on resize

**figma_set_constraints** — e.g. sidebar `horizontal: MAX`, header `vertical: MIN`

## Do not

- Stop after only changing root width
- Re-inspect whole tree if **figma_apply_edits** returned `applied === total` and layout_report is ok
- Use **figma_list_frames** when selection JSON already has the frame id

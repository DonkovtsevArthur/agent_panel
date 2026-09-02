---
name: figma-batch-operations
description: Batch tool calls and multi-step edits in Harbor Figma plugin. Load before large edits, multi-node operations, or when optimizing tool call count.
---

# Figma batch operations (Harbor canvas tools)

## Why batch

- Each tool call = one Figma plugin RPC. 20 separate calls = 20 roundtrips.
- Figma groups `figma.commitUndo()` per batch — one Undo step undoes the whole batch.
- Canvas tools support **up to 8 parallel** Cline tool calls per turn.

## Three batching mechanisms

### 1. `figma_apply_edits` (max 80 ops)

Best for: many property changes across different nodes.

```json
{
  "ops": [
    { "op": "set_fills", "nodeId": "1:2", "fills": [{ "type": "SOLID", "r": 1, "g": 0, "b": 0, "a": 1 }] },
    { "op": "set_name", "nodeId": "1:3", "name": "PrimaryCard" },
    { "op": "set_geometry", "nodeId": "1:4", "x": 0, "y": 0, "width": 200, "height": 100 },
    { "op": "reparent_node", "nodeId": "1:5", "parentId": "1:2", "index": 0 }
  ]
}
```

Supported ops: `set_fills`, `set_stroke`, `set_effects`, `set_opacity`, `set_corner_radius`, `set_name`, `set_text`, `set_font`, `set_geometry`, `set_auto_layout`, `set_layout_child`, `set_constraints`, `reparent_node`, `swap_component`, `bind_variable`, `delete_node`.

### 2. `figma_batch_tools` (max 12 calls)

Best for: chaining different tools (find → resize → verify) in one RPC.

```json
{
  "calls": [
    { "name": "figma_find_nodes", "args": { "nameContains": "Card", "scope": "selection" } },
    { "name": "figma_resize_frame", "args": { "nodeId": "<from-call-0>", "width": 1440 } },
    { "name": "figma_layout_report", "args": { "nodeId": "<from-call-1>" } }
  ]
}
```

- Results chain: `<from-call-N>` placeholder resolves to the result of call N.
- Max 12 calls per batch.

### 3. `figma_apply_recipe` (predefined patterns)

Best for: common layout operations.

| Recipe | Args | What it does |
|--------|------|-------------|
| `resize_center` | `nodeId`, `width` | Resize + center children |
| `center_content` | `nodeId` | Center children in frame |
| `tablet` | `nodeId` | Resize to tablet breakpoint |
| `autolayout` | `nodeId` | Convert to auto-layout |
| `match_reference` | `nodeId`, `fromFrameId` | Copy layout from reference |

## Parallel tool calls

Cline sends up to **8 tool calls simultaneously**. Structure work so independent edits run in parallel:

```
Turn: "Make all cards 320px wide and change title color to blue"
→ figma_find_nodes (find cards) + figma_inspect_node (read title) — parallel
→ figma_apply_edits (resize all cards + set title fills) — single batch
```

## Verification after batch

- `figma_apply_edits` returns `{ applied: N, total: N, errors: [...] }` — check `applied === total`.
- Write tools return `layoutCheck` / `needsFollowUp` — if `true`, run `figma_layout_report` and fix.
- Don't re-inspect the whole tree if batch succeeded and layout is clean.

## Do not

- Send 20 individual `figma_set_fills` calls when `figma_apply_edits` handles them in one.
- Use `figma_batch_tools` for simple property changes (use `figma_apply_edits` instead).
- Exceed 80 ops in `figma_apply_edits` — split into multiple calls.
- Exceed 12 calls in `figma_batch_tools` — split into multiple batches.
- Re-fetch selection JSON after writes — reuse ids from tool results.

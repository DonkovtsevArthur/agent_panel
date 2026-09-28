---
name: figma-components
description: Component instances, swaps, and design system patterns via Harbor Figma tools. Load before swapping instances, listing components, or working with design systems.
---

# Figma components (Harbor canvas tools)

## Listing

- **`figma_list_components`** — all COMPONENT / COMPONENT_SET in the file. Optional `includeInstances: true` to see where they're used.
- **`figma_list_frames`** — FRAME/COMPONENT on current page (useful to find component masters by name).

## Swapping instances

**`figma_swap_component`** `{ instanceId, targetComponentId }`:

1. `figma_list_components` to find the target COMPONENT id.
2. `figma_inspect_node` on the instance to confirm it's an INSTANCE (not a detached frame).
3. `figma_swap_component` with the target id.
4. After swap, inspect — overrides may reset; re-apply fills/text if needed.

## Instance overrides

- Swapping preserves **overrides** (fills, text, visibility) when the target component has matching layer names.
- If overrides reset: `figma_copy_styles` from a reference instance, or re-apply with `figma_apply_edits`.
- Detached instances (no component link) cannot be swapped — `figma_inspect_node` shows `componentId: null`.

## Creating component variants

Not directly supported by canvas tools. Workaround:
1. Ask user to create the component/variant in Figma UI.
2. Agent can then `figma_duplicate_node`, `figma_set_name`, `figma_set_fills` etc. to populate variants.
3. `figma_swap_component` to switch between them in instances.

## Design system patterns

- **Button variants**: create base button → duplicate → change fills/text for Primary/Secondary/Disabled → user converts to component set in Figma.
- **Icon swap**: `figma_list_components` with name filter → `figma_swap_component` on icon instances.
- **Card patterns**: `figma_match_layout` to copy structure from a reference card, then swap content.

## Batch operations on instances

`figma_apply_edits` with `swap_component` op for multiple instances:

```json
{
  "ops": [
    { "op": "swap_component", "instanceId": "1:2", "targetComponentId": "5:10" },
    { "op": "swap_component", "instanceId": "1:3", "targetComponentId": "5:10" }
  ]
}
```

## Do not

- Detach instances unless the user explicitly asks (breaks design system sync).
- Swap to a component from a different file (cross-file not supported by local tools).
- Assume component ids — always `figma_list_components` first.

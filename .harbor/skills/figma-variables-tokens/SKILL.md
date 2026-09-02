---
name: figma-variables-tokens
description: Figma local variables and design tokens via Harbor canvas tools. Load before binding variables, listing token collections, or working with design system values.
---

# Figma variables & tokens (Harbor canvas tools)

## Listing variables

**`figma_list_variables`** — returns all local variables and collections:

```json
{
  "collections": [
    { "id": "...", "name": "Colors", "modes": ["Light", "Dark"], "variableIds": [...] }
  ],
  "variables": [
    { "id": "...", "name": "primary/500", "resolvedType": "COLOR", "valuesByMode": { "Light": { "r": 0.2, "g": 0.4, "b": 1 } } }
  ]
}
```

- Filter by `collectionName` or `resolvedType` (`COLOR`, `FLOAT`, `STRING`, `BOOLEAN`).
- Use to discover available tokens before binding.

## Binding variables

**`figma_bind_variable`** `{ nodeId, property, variableId }`:

| Property | What it binds |
|----------|---------------|
| `fills` | Fill color |
| `strokes` | Stroke color |
| `itemSpacing` | Auto-layout gap |
| `paddingLeft/Right/Top/Bottom` | Auto-layout padding |
| `width`, `height` | Size |
| `cornerRadius` | Corner radius |
| `opacity` | Opacity |

### Workflow

1. `figma_list_variables` to find the variable id.
2. `figma_inspect_node` to confirm the target property exists on the node.
3. `figma_bind_variable` with the variable id and property.
4. Verify: `figma_inspect_node` should show the variable reference, not a raw value.

## Batch binding

`figma_apply_edits` with `bind_variable` op:

```json
{
  "ops": [
    { "op": "bind_variable", "nodeId": "1:2", "property": "fills", "variableId": "abc123" },
    { "op": "bind_variable", "nodeId": "1:2", "property": "itemSpacing", "variableId": "def456" }
  ]
}
```

## Modes (Light/Dark, etc.)

- Variables with multiple modes return `valuesByMode` per mode.
- Canvas tools bind to the **current mode** of the node's page/frame.
- To switch mode: user must do it in Figma UI (canvas tools don't set page mode).

## Do not

- Invent variable names — always `figma_list_variables` first.
- Bind to a variable of wrong type (COLOR variable to a FLOAT property).
- Assume variable ids persist across files — they're local to the current file.
- Try to create variables via canvas tools — read-only listing + binding only.

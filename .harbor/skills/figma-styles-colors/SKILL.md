---
name: figma-styles-colors
description: Figma color, stroke, effects, opacity styling via Harbor canvas tools. Load before changing fills, borders, shadows, or visual appearance.
---

# Figma styles & colors (Harbor canvas tools)

## Color workflow

1. **Inspect first** — `figma_inspect_node` with `fields: ["fills","strokes","effects"]` to read current values before changing.
2. **Set fill** — `figma_set_fills` `{ nodeId, fills: [{ type: "SOLID", r, g, b, a }] }`. RGBA 0–1, not 0–255.
3. **Set stroke** — `figma_set_stroke` `{ nodeId, fills: [{ type: "SOLID", r, g, b, a }], weight: 1 }`.
4. **Copy from reference** — `figma_copy_styles` `{ fromId, toId, include: ["fills","strokes","effects"] }` when a similar layer already has the right look.

## Effects (shadows, blur)

`figma_set_effects` `{ nodeId, effects: [...] }` — each effect:

```json
{
  "type": "DROP_SHADOW",
  "color": { "r": 0, "g": 0, "b": 0, "a": 0.25 },
  "offset": { "x": 0, "y": 4 },
  "radius": 8,
  "visible": true,
  "blendMode": "NORMAL"
}
```

- `INNER_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR` also supported.
- `figma_set_effects` with `effects: []` clears all effects.
- `figma_copy_styles` with `include: ["effects"]` copies from reference.

## Opacity

`figma_set_opacity` `{ nodeId, opacity: 0.5 }` — 0–1 range.

## Corner radius

`figma_set_corner_radius` `{ nodeId, radius: 8 }` or per-corner:

```json
{ "nodeId": "...", "topLeft": 8, "topRight": 8, "bottomLeft": 0, "bottomRight": 0 }
```

## Batch styling

Combine multiple style changes in one `figma_apply_edits` call (max 80 ops):

```json
{
  "ops": [
    { "op": "set_fills", "nodeId": "1:2", "fills": [{ "type": "SOLID", "r": 0.2, "g": 0.4, "b": 1, "a": 1 }] },
    { "op": "set_stroke", "nodeId": "1:2", "fills": [{ "type": "SOLID", "r": 0, "g": 0, "b": 0, "a": 0.1 }], "weight": 1 },
    { "op": "set_corner_radius", "nodeId": "1:2", "radius": 12 }
  ]
}
```

## Do not

- Invent colors — ask the user or copy from a reference layer.
- Set fills on auto-layout parent when children should keep their own fills.
- Use `figma_set_effects` to clear when you only need to change one shadow — pass the full effects array.
- Forget `a` (alpha) in RGBA — default 1.0 is opaque.

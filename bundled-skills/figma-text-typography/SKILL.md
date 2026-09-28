---
name: figma-text-typography
description: Text editing, font management, and typography workflows via Harbor Figma tools. Load before changing text content, fonts, or text styling.
---

# Figma text & typography (Harbor canvas tools)

## Reading text

- **Selection JSON** includes `characters` for each TEXT node — no extra tool call needed.
- **`figma_inspect_node`** on a TEXT node returns `characters`, `fontSize`, `fontName`, `lineHeight`, `letterSpacing`, `textAlignHorizontal`, `textAlignVertical`.

## Setting text content

- **Single text** — `figma_set_text` `{ nodeId, characters: "New text" }`.
- **Batch replace** — `figma_batch_text_replace` `{ rootId, find: "Old", replace: "New" }` — searches all TEXT in subtree.
- **Batch edits** — `figma_apply_edits` with `set_text` op for different text per node.

## Font management

**`figma_set_font`** `{ nodeId, fontFamily, fontStyle, fontSize }`:

```json
{ "nodeId": "1:2", "fontFamily": "Inter", "fontStyle": "Semi Bold", "fontSize": 16 }
```

### Custom fonts (team fonts, Grtsk, etc.)

1. **`figma_list_fonts`** with `nameContains` — only use family/style from this list.
2. Figma uses **family + style** separately: `Grtsk Peta` + `Semibold`, NOT `Grtsk Peta Semibold` as family.
3. If font is missing: it must be **installed on the computer** (Figma Desktop) or **uploaded by org admin** (Resources → Fonts). Ask the user.
4. `figma_copy_styles` from a text layer that already uses the correct font is safer than `figma_set_font` alone.

## Text styling via apply_edits

```json
{
  "ops": [
    { "op": "set_font", "nodeId": "1:2", "fontFamily": "Inter", "fontStyle": "Regular", "fontSize": 14 },
    { "op": "set_fills", "nodeId": "1:2", "fills": [{ "type": "SOLID", "r": 0.2, "g": 0.2, "b": 0.2, "a": 1 }] }
  ]
}
```

## Text in auto-layout

- TEXT nodes in auto-layout default to `layoutSizingHorizontal: "HUG"` (width hugs content).
- For multi-line: set `layoutSizingHorizontal: "FILL"` so text wraps within parent width.
- `figma_set_layout_child` to change sizing after text edit if layout breaks.

## Do not

- Set font family to a combined string like "Inter Bold" — use `fontFamily: "Inter"`, `fontStyle: "Bold"`.
- Edit text on locked or hidden layers (skipped in selection JSON).
- Use `figma_set_text` for find/replace across many nodes — use `figma_batch_text_replace` instead.
- Forget to check `figma_list_fonts` before setting custom/team fonts.

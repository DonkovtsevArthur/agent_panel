---
name: figma-responsive
description: Multi-breakpoint responsive adaptation for Harbor Figma plugin. Load when user asks to adapt a screen to mobile/tablet/desktop or «под новый брейкпоинт».
---

# Figma responsive adaptation (Harbor canvas tools)

## Workflow

1. **Inspect source** — `figma_inspect_node` on the root frame to read current width, auto-layout, children sizing.
2. **Resize root** — `figma_resize_frame` with target width (`375`, `768`, `1024`, `1440`).
3. **Fix children** — auto-layout children with `FILL` sizing adapt automatically; absolute children need `figma_set_constraints` or manual `figma_set_geometry`.
4. **Verify** — `figma_layout_report` until `needsFollowUp: false`.
5. **Match reference** (optional) — `figma_match_layout` from an existing screen at the target breakpoint.

## Breakpoint conventions

| Name | Width | Typical use |
|------|-------|-------------|
| Mobile | 375 | Phone portrait |
| Tablet | 768 | iPad portrait / small laptop |
| Desktop | 1024 | Laptop / small desktop |
| Wide | 1440 | Full desktop |

## Resize strategies

### Auto-layout frames (preferred)
Children with `layoutSizingHorizontal: "FILL"` adapt automatically. After resize:
- Check `itemSpacing` and `padding` — may need adjustment for smaller screens
- `figma_set_auto_layout` to switch `HORIZONTAL` → `VERTICAL` for stacked mobile layout
- `figma_set_layout_child` to change individual child sizing (`FILL` → `HUG` or vice versa)

### Absolute-positioned children
- `figma_set_constraints` — set horizontal: `STRETCH` for full-width, `CENTER` for centered, `MIN`/`MAX` for pinned edges
- `figma_set_geometry` — reposition manually when constraints aren't enough

### Mixed layouts
- Sidebar + content: sidebar collapses or becomes overlay on mobile
- `figma_reparent_node` to move elements between containers
- `figma_create_node` for new mobile-only containers (hamburger menu, bottom sheet)

## Multi-breakpoint in one session

When user asks for multiple breakpoints:
1. Start with the **widest** breakpoint (1440) — easiest to adapt from
2. Work down: 1440 → 1024 → 768 → 375
3. Each step: resize → fix → verify → move on
4. Use `figma_match_layout` to copy structure between breakpoints when screens should mirror each other

## Common patterns

### Sidebar collapse
```
Desktop: [Sidebar 240px] [Content FILL]
Mobile:  [Content FILL]  (sidebar hidden or hamburger)
```
- `figma_set_geometry` sidebar width → 0 or `figma_delete_node` if removing
- `figma_create_node` for hamburger icon
- `figma_set_auto_layout` content to `VERTICAL` if needed

### Grid → Stack
```
Desktop: [Card] [Card] [Card]  (HORIZONTAL, 3 columns)
Mobile:  [Card]
         [Card]
         [Card]               (VERTICAL, 1 column)
```
- `figma_set_auto_layout` parent `layoutMode: "VERTICAL"`
- `figma_set_layout_child` each card `layoutSizingHorizontal: "FILL"`

### Typography scaling
- `figma_set_font` with smaller `fontSize` for mobile headings
- `figma_batch_text_replace` not needed — font size is per-node

## Do not

- Resize root without fixing children — layout will break
- Use absolute positioning when auto-layout works
- Create a new frame from scratch when `figma_resize_frame` + constraint changes suffice
- Skip `figma_layout_report` verification

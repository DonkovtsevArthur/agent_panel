---
name: figma-prototype-flow
description: Prototype linking workflow for Harbor Figma tools (figma_list_frames, figma_set_prototype_flow, figma_get_reactions). Load before building or fixing click-through flows.
---

# Figma prototype flows (Harbor canvas tools)

## Workflow

1. **figma_list_frames** (or `selectedOnly=true`) — resolve real frame **ids** and screen names. Never invent ids.
2. **figma_get_reactions** on source nodes — see existing links before replacing.
3. **figma_set_prototype_flow** with **all** links in **one** call (batch). Prefer over many `figma_set_prototype_link` calls.
4. Use `replaceAll: true` on links when replacing an existing click target on the same source.

## Link object shape

Each entry in `links`:

- `sourceId` — clickable layer or frame id
- `destinationId` — target FRAME/COMPONENT id
- `trigger` — usually `ON_CLICK`
- `transition` — `INSTANT`, `DISSOLVE`, `SMART_ANIMATE`, or directional (`MOVE_IN`, `SLIDE_IN`, …)
- `duration` — seconds (e.g. `0.3`)
- `direction` — for directional transitions: `LEFT`, `RIGHT`, `TOP`, `BOTTOM`

## After success

- Do not re-list the whole file to “verify” unless a link failed.
- Selection JSON is stale after writes — reuse ids from tool results.

## Undo

Batch prototype writes are grouped for **one Undo** step in Figma when applied via **figma_set_prototype_flow**.

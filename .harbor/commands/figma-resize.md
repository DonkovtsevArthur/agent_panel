---
description: Resize frame width/height and fix internal layout in one agent turn
---
Resize the selected frame (or the frame named in arguments) to the target size and fix internal layout in the **same turn**.

Steps for the agent:
1. Use selection JSON ids — do not list the whole page.
2. Call **figma_apply_recipe** `{ recipe: "resize_center", nodeId, width }` **or** **figma_resize_frame** — then **figma_layout_report** only if `needsFollowUp`.

Arguments (examples): `1440` · `1440x900` · `Frame Name 1440` · `1440 center`

$ARGUMENTS

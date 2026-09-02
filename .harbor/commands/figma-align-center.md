---
description: Center content inside the selected frame (auto-layout or absolute)
---
Center the content inside the selected frame (or the container named in arguments). Finish completely before replying.

1. Identify the content container id from selection JSON (or **figma_find_nodes** with `nameContains` from arguments).
2. If the parent uses auto-layout: **figma_align_in_frame** with `primaryAxisAlignItems: "CENTER"` and `counterAxisAlignItems: "CENTER"` (or `mode: "center"`).
3. If absolute layout: **figma_align_in_frame** with `mode: "center"` and optional `padding`.
4. **figma_layout_report** — if `needsFollowUp`, fix overflow then report again.

$ARGUMENTS

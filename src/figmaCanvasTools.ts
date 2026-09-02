/**
 * Figma canvas tools as Cline `extraTools`.
 * `execute` RPCs to the connected Figma plugin (main thread via UI bridge).
 */

export type FigmaToolRpc = (
  name: string,
  args: Record<string, unknown>
) => Promise<unknown>;

type CreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  timeoutMs?: number;
  write?: boolean;
};

const READ_TOOLS: ToolDef[] = [
  {
    name: "figma_get_selection",
    description:
      "Get the current Figma selection tree (structure, text, fills, auto-layout).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "figma_inspect_node",
    description:
      "Serialize one node by id. Optional fields filter (geometry|layout|text|style|children) for smaller/faster reads. " +
      "Includes x/y (relative to parent) and absX/absY (page-absolute). " +
      "Use absX/absY or sibling x to decide left vs right — never infer side from widths alone.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Figma node id" },
        fields: {
          type: "array",
          items: {
            type: "string",
            enum: ["geometry", "layout", "text", "style", "children", "meta"],
          },
          description: "Optional subset — omit for full node (slower).",
        },
        maxDepth: { type: "number", description: "With fields/children (default 2)." },
        maxChildren: { type: "number" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_focus_node",
    description: "Select a node on the canvas and zoom the viewport to it.",
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_list_frames",
    description:
      "List FRAME/COMPONENT nodes on the current page (id, name, depth), or the current selection when selectedOnly=true. " +
      "Prefer selectedOnly when the user asks about their multi-select. " +
      "For page-wide lists, prefer topLevel screens; check truncated/totalMatched if the page is large. " +
      "Use before building prototype flows to resolve real node ids by screen name.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: {
          type: "number",
          description: "Search depth from page children (1–4, default 2). Ignored when selectedOnly.",
        },
        selectedOnly: {
          type: "boolean",
          description:
            "If true, list only the current canvas selection roots (all types), not the whole page.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "figma_get_reactions",
    description:
      "Read prototype reactions on a node (triggers, navigate targets, transitions).",
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_list_components",
    description:
      "List COMPONENT / COMPONENT_SET nodes on the current page (or selection when selectedOnly=true). " +
      "Use before figma_swap_component to resolve component ids by name. " +
      "Set includeInstances=true to also list INSTANCE nodes with their componentId.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: {
          type: "number",
          description: "Search depth from page children (1–5, default 3).",
        },
        selectedOnly: {
          type: "boolean",
          description: "If true, list only the current canvas selection.",
        },
        includeInstances: {
          type: "boolean",
          description: "If true, include INSTANCE nodes (with componentId).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "figma_list_variables",
    description:
      "List local Figma variables and collections in the current file (id, name, type, values by mode). " +
      "Use before figma_bind_variable. Optional nameContains filter.",
    inputSchema: {
      type: "object",
      properties: {
        nameContains: {
          type: "string",
          description: "Case-insensitive substring filter on variable name.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "figma_list_fonts",
    description:
      "List fonts installed in this Figma environment (family + style). " +
      "Call BEFORE figma_set_font for custom/team fonts (e.g. Grtsk Peta) — use exact names from the result.",
    inputSchema: {
      type: "object",
      properties: {
        nameContains: {
          type: "string",
          description: "Filter by family substring (case-insensitive).",
        },
        maxResults: {
          type: "number",
          description: "Max rows (default 80, cap 200).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "figma_find_nodes",
    description:
      "Find layers by name/type without listing the whole page. scope: selection | page; optional rootId subtree. " +
      "Prefer over figma_list_frames + many inspects when hunting a named layer.",
    inputSchema: {
      type: "object",
      properties: {
        nameContains: {
          type: "string",
          description: "Case-insensitive substring on layer name.",
        },
        type: {
          type: "string",
          description: "FRAME, TEXT, COMPONENT, INSTANCE, GROUP, …",
        },
        scope: {
          type: "string",
          enum: ["selection", "page"],
          description: "Search current selection or page roots (default page).",
        },
        rootId: {
          type: "string",
          description: "Search only under this node (overrides scope roots).",
        },
        maxDepth: { type: "number", description: "Default 6, max 10." },
        maxResults: { type: "number", description: "Default 20, max 50." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "figma_layout_report",
    description:
      "Compact layout health check: child overflow vs parent bounds, axis alignment summary. " +
      "Use after resize/align to verify completion (needsFollowUp=false means OK).",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Frame/container to check" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_list_children",
    description:
      "List DIRECT children of a frame/group (id, name, type, x/y, size, layout, text preview). " +
      "Use FIRST when editing inner layers — faster than full inspect. Optional nameContains/type filter.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "Container frame/group id" },
        nameContains: { type: "string", description: "Filter child names" },
        type: { type: "string", description: "FRAME, TEXT, INSTANCE, …" },
      },
      required: ["parentId"],
      additionalProperties: false,
    },
  },
];

const WRITE_TOOLS: ToolDef[] = [
  {
    name: "figma_set_name",
    description: "Rename an existing node.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        name: { type: "string" },
      },
      required: ["nodeId", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_text",
    description:
      "Set characters on a TEXT node (or the first TEXT child of a frame). " +
      "Prefer search+replace for small edits.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        characters: { type: "string" },
        search: { type: "string" },
        replace: { type: "string" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_fills",
    description: "Set a single solid fill on a node (r/g/b/a in 0–1).",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        color: {
          type: "object",
          properties: {
            r: { type: "number" },
            g: { type: "number" },
            b: { type: "number" },
            a: { type: "number" },
          },
          required: ["r", "g", "b"],
        },
      },
      required: ["nodeId", "color"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_auto_layout",
    description:
      "Update auto-layout on a frame/component: layoutMode, padding, itemSpacing, " +
      "primaryAxisAlignItems / counterAxisAlignItems (MIN|MAX|CENTER|SPACE_BETWEEN), sizing modes.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        layoutMode: {
          type: "string",
          enum: ["NONE", "HORIZONTAL", "VERTICAL"],
        },
        padding: { type: "number" },
        paddingTop: { type: "number" },
        paddingRight: { type: "number" },
        paddingBottom: { type: "number" },
        paddingLeft: { type: "number" },
        itemSpacing: { type: "number" },
        primaryAxisAlignItems: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "SPACE_BETWEEN"],
          description: "Main-axis alignment (row: horizontal, column: vertical).",
        },
        counterAxisAlignItems: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "BASELINE"],
          description: "Cross-axis alignment.",
        },
        primaryAxisSizingMode: {
          type: "string",
          enum: ["FIXED", "AUTO"],
          description: "FIXED = fixed size, AUTO = hug contents.",
        },
        counterAxisSizingMode: {
          type: "string",
          enum: ["FIXED", "AUTO"],
        },
        layoutWrap: {
          type: "string",
          enum: ["NO_WRAP", "WRAP"],
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_align_in_frame",
    description:
      "Align inside a parent frame in ONE call. Auto-layout parent: set primaryAxisAlignItems / counterAxisAlignItems " +
      "(MIN|MAX|CENTER|SPACE_BETWEEN / MIN|MAX|CENTER|BASELINE) directly, or use mode shorthand (center, left, distribute-h, …). " +
      "Absolute parent: mode moves/distributes children (left, center, distribute-h, …). Use after resize to fix internal layout.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "Frame/group containing children" },
        mode: {
          type: "string",
          description:
            "Shorthand: left | right | top | bottom | center | center-h | center-v | middle | " +
            "distribute-h | distribute-v | space-between-h | space-between-v. " +
            "Optional if primaryAxisAlignItems/counterAxisAlignItems set (auto-layout only).",
        },
        primaryAxisAlignItems: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "SPACE_BETWEEN"],
          description: "Figma auto-layout main-axis alignment (row=horizontal, column=vertical).",
        },
        counterAxisAlignItems: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "BASELINE"],
          description: "Figma auto-layout cross-axis alignment.",
        },
        nodeIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of direct children (absolute layout only).",
        },
        padding: {
          type: "number",
          description: "Inset from parent edges for absolute layout (default 0).",
        },
        recursive: {
          type: "boolean",
          description: "Also apply axis alignment to nested auto-layout frames (default false).",
        },
      },
      required: ["parentId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_layout_child",
    description:
      "Set auto-layout child constraints: layoutAlign (MIN|MAX|CENTER|STRETCH|INHERIT), layoutGrow (0|1), " +
      "layoutSizingHorizontal/Vertical (FIXED|HUG|FILL). Use when one child must stretch or align differently in a stack.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Child inside an auto-layout parent" },
        layoutAlign: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "STRETCH", "INHERIT"],
        },
        layoutGrow: {
          type: "number",
          description: "0 = fixed, 1 = fill along parent main axis",
        },
        layoutSizingHorizontal: {
          type: "string",
          enum: ["FIXED", "HUG", "FILL"],
        },
        layoutSizingVertical: {
          type: "string",
          enum: ["FIXED", "HUG", "FILL"],
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_resize_frame",
    description:
      "Resize a frame (width/height/x/y) and optionally align content in ONE call. " +
      "Prefer over set_geometry + separate align for breakpoint changes (e.g. 1980→1440 + center). " +
      "Returns layoutCheck + needsFollowUp.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        alignMode: {
          type: "string",
          description: "Shorthand align after resize (center, left, …) — same as figma_align_in_frame mode.",
        },
        alignContent: { type: "string", description: "Alias for alignMode." },
        primaryAxisAlignItems: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "SPACE_BETWEEN"],
        },
        counterAxisAlignItems: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "BASELINE"],
        },
        recursiveAlign: { type: "boolean" },
        padding: { type: "number" },
        select: { type: "boolean" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_batch_text_replace",
    description:
      "Search/replace text across all TEXT nodes in a subtree (one RPC). " +
      "Use for mass copy updates instead of many figma_set_text calls.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        rootId: { type: "string", description: "Subtree root (or nodeId alias)" },
        nodeId: { type: "string" },
        search: { type: "string" },
        replace: { type: "string" },
      },
      required: ["search"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_match_layout",
    description:
      "Copy layout from a reference frame to a target: auto-layout, size, direct-children sizing. " +
      "Use when user says «как на Frame B» / «match the other screen».",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        fromFrameId: { type: "string" },
        toFrameId: { type: "string" },
        include: {
          type: "array",
          items: {
            type: "string",
            enum: ["autoLayout", "geometry", "childrenSizing"],
          },
        },
      },
      required: ["fromFrameId", "toFrameId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_constraints",
    description:
      "Set resize constraints on a layer (MIN/CENTER/MAX/STRETCH/SCALE per axis). " +
      "Helps absolute layouts survive parent resize.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        horizontal: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "STRETCH", "SCALE"],
        },
        vertical: {
          type: "string",
          enum: ["MIN", "MAX", "CENTER", "STRETCH", "SCALE"],
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_effects",
    description:
      "Set visual effects: dropShadow object, copyFromId, or clear:true. Gradients/image fills — use copy_styles from reference.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        clear: { type: "boolean" },
        copyFromId: { type: "string" },
        dropShadow: {
          type: "object",
          properties: {
            color: {
              type: "object",
              properties: {
                r: { type: "number" },
                g: { type: "number" },
                b: { type: "number" },
                a: { type: "number" },
              },
            },
            offsetX: { type: "number" },
            offsetY: { type: "number" },
            radius: { type: "number" },
            spread: { type: "number" },
          },
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_group_nodes",
    description: "Group nodes by id (figma.group). Optional name.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeIds: { type: "array", items: { type: "string" } },
        name: { type: "string" },
        select: { type: "boolean" },
      },
      required: ["nodeIds"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_ungroup_node",
    description: "Ungroup a GROUP node.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_layout_grid",
    description:
      "Show layout grid on a frame (COLUMNS/ROWS/GRID). clear:true removes grids. " +
      "Guides are visual only — pair with auto-layout for structure.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        pattern: { type: "string", enum: ["COLUMNS", "ROWS", "GRID"] },
        size: { type: "number", description: "Section size in px (default 8)." },
        sectionSize: { type: "number" },
        gutterSize: { type: "number" },
        count: { type: "number" },
        visible: { type: "boolean" },
        clear: { type: "boolean" },
        showGrid: { type: "boolean" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_apply_recipe",
    description:
      "Run a layout recipe in ONE call: center_content | resize_center | tablet | absolute_to_autolayout | match_reference. " +
      "Example resize: { recipe: \"resize_center\", nodeId, width: 1440 }. Returns layoutCheck.",
    write: true,
    timeoutMs: 120_000,
    inputSchema: {
      type: "object",
      properties: {
        recipe: {
          type: "string",
          enum: [
            "center_content",
            "resize_center",
            "tablet",
            "absolute_to_autolayout",
            "match_reference",
          ],
        },
        nodeId: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        layoutMode: { type: "string", enum: ["HORIZONTAL", "VERTICAL"] },
        alignMode: { type: "string" },
        primaryAxisAlignItems: { type: "string" },
        counterAxisAlignItems: { type: "string" },
        padding: { type: "number" },
        recursive: { type: "boolean" },
        styleFromId: { type: "string" },
        fromFrameId: { type: "string" },
        referenceId: { type: "string" },
        include: { type: "array", items: { type: "string" } },
      },
      required: ["recipe", "nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_batch_tools",
    description:
      "Run up to 12 canvas tool calls in ONE plugin RPC (one Cline tool). " +
      "Use for find + resize + layout_report sequences. Each call: { name, args }.",
    write: true,
    timeoutMs: 120_000,
    inputSchema: {
      type: "object",
      properties: {
        calls: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              args: { type: "object" },
            },
            required: ["name"],
          },
        },
      },
      required: ["calls"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_apply_to_children",
    description:
      "Apply the SAME edit to matched direct children under a parent (one batch RPC). " +
      "Use for inner layers: e.g. all rows nameContains \"Card\" → set_layout_child STRETCH, or set_fills color. " +
      "Ops: set_geometry, set_layout_child, set_fills, set_text (search+replace), set_name, set_opacity, set_corner_radius, set_font, set_stroke.",
    write: true,
    timeoutMs: 120_000,
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string" },
        nameContains: { type: "string" },
        type: { type: "string" },
        op: {
          type: "string",
          enum: [
            "set_geometry",
            "set_layout_child",
            "set_fills",
            "set_text",
            "set_name",
            "set_opacity",
            "set_corner_radius",
            "set_font",
            "set_stroke",
          ],
        },
        maxTargets: { type: "number", description: "Default 40, max 80" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        layoutAlign: { type: "string" },
        layoutGrow: { type: "number" },
        layoutSizingHorizontal: { type: "string" },
        layoutSizingVertical: { type: "string" },
        color: { type: "object" },
        characters: { type: "string" },
        search: { type: "string" },
        replace: { type: "string" },
        name: { type: "string" },
        opacity: { type: "number" },
        cornerRadius: { type: "number" },
        family: { type: "string" },
        style: { type: "string" },
        fontSize: { type: "number" },
        weight: { type: "number" },
      },
      required: ["parentId", "op"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_nudge_nodes",
    description:
      "Move inner layers by delta px (dx/dy) — absolute frames or groups. " +
      "Pass nodeIds OR parentId + optional nameContains/type to nudge matching direct children.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeIds: { type: "array", items: { type: "string" } },
        parentId: { type: "string" },
        nameContains: { type: "string" },
        type: { type: "string" },
        dx: { type: "number" },
        dy: { type: "number" },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_prototype_link",
    description:
      "Add or replace a prototype link: trigger navigates to destinationId frame.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        destinationId: { type: "string" },
        trigger: { type: "string" },
        transition: { type: "string" },
        duration: { type: "number" },
        direction: { type: "string" },
        replace: { type: "boolean" },
        replaceAll: { type: "boolean" },
      },
      required: ["nodeId", "destinationId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_prototype_flow",
    description:
      "Batch-create prototype links for a click-through flow. Prefer for multi-screen flows.",
    write: true,
    timeoutMs: 120_000,
    inputSchema: {
      type: "object",
      properties: {
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sourceId: { type: "string" },
              nodeId: { type: "string" },
              destinationId: { type: "string" },
              trigger: { type: "string" },
              transition: { type: "string" },
              duration: { type: "number" },
            },
            required: ["destinationId"],
            additionalProperties: false,
          },
        },
      },
      required: ["links"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_clear_reactions",
    description: "Remove all prototype reactions from a node.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_create_node",
    description:
      "Create a new canvas node: FRAME, RECTANGLE, ELLIPSE, or TEXT. " +
      "Prefer styleFromId (an existing similar layer) so fills/font/radius/layout match the mockup. " +
      "Optional parentId, name, size, position, color, TEXT characters, FRAME layoutMode. " +
      "For UI that already exists nearby, prefer figma_duplicate_node instead of creating from scratch.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["FRAME", "RECTANGLE", "ELLIPSE", "TEXT"],
        },
        name: { type: "string" },
        parentId: {
          type: "string",
          description: "Parent frame/page id (default: current page)",
        },
        styleFromId: {
          type: "string",
          description:
            "Copy visual/text styles from this existing node after create (match mockup style)",
        },
        width: { type: "number" },
        height: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        characters: {
          type: "string",
          description: "Initial text for TEXT nodes (default \"Text\")",
        },
        color: {
          type: "object",
          properties: {
            r: { type: "number" },
            g: { type: "number" },
            b: { type: "number" },
            a: { type: "number" },
          },
          required: ["r", "g", "b"],
        },
        layoutMode: {
          type: "string",
          enum: ["NONE", "HORIZONTAL", "VERTICAL"],
          description: "Auto-layout for FRAME only",
        },
        select: {
          type: "boolean",
          description: "Select and zoom to the new node (default true)",
        },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_duplicate_node",
    description:
      "Clone an existing node (and its subtree). Default offset +40,+40 so the copy is visible. " +
      "Optional rename via name; optional parentId to reparent the clone.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Source node to clone" },
        name: { type: "string", description: "Optional new name for the clone" },
        offsetX: {
          type: "number",
          description: "X offset from source (default 40)",
        },
        offsetY: {
          type: "number",
          description: "Y offset from source (default 40)",
        },
        parentId: {
          type: "string",
          description: "Optional new parent for the clone",
        },
        select: {
          type: "boolean",
          description: "Select and zoom to the clone (default true)",
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_delete_node",
    description:
      "Delete one or more nodes from the canvas (and their subtrees). " +
      "Pass nodeId and/or nodeIds (max 50). Cannot delete PAGE/DOCUMENT. " +
      "On success the nodes are gone — do not re-inspect deleted ids; finish the user task if delete was the goal.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        nodeIds: {
          type: "array",
          items: { type: "string" },
          description: "Batch delete (max 50)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_geometry",
    description:
      "Set position (x/y) and/or size (width/height) on an existing node.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        select: {
          type: "boolean",
          description: "Also select/zoom (default false)",
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_reparent_node",
    description:
      "Move a node under a new parent frame/page. Optional index among siblings; optional x/y after move.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        parentId: { type: "string" },
        index: {
          type: "number",
          description: "Child index under the new parent (0 = first)",
        },
        x: { type: "number" },
        y: { type: "number" },
        select: { type: "boolean" },
      },
      required: ["nodeId", "parentId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_opacity",
    description: "Set node opacity (0–1).",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        opacity: { type: "number", description: "0–1" },
      },
      required: ["nodeId", "opacity"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_corner_radius",
    description:
      "Set corner radius (uniform via radius, or per-corner topLeft/topRight/bottomRight/bottomLeft).",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        radius: { type: "number" },
        topLeft: { type: "number" },
        topRight: { type: "number" },
        bottomRight: { type: "number" },
        bottomLeft: { type: "number" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_copy_styles",
    description:
      "Copy visual styles from one node to another (fills, strokes, opacity, corner radius, effects, auto-layout, text font/size/color). " +
      "PREFERRED way to keep new layers on-brand with the mockup — pick a similar sibling as fromNodeId.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        fromNodeId: { type: "string", description: "Style source node" },
        toNodeId: { type: "string", description: "Target node to restyle" },
        include: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "fills",
              "strokes",
              "strokeWeight",
              "opacity",
              "cornerRadius",
              "effects",
              "autoLayout",
            ],
          },
          description: "Optional subset; default = all applicable",
        },
      },
      required: ["fromNodeId", "toNodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_stroke",
    description: "Set a solid stroke color (r/g/b/a 0–1) and optional weight.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        color: {
          type: "object",
          properties: {
            r: { type: "number" },
            g: { type: "number" },
            b: { type: "number" },
            a: { type: "number" },
          },
          required: ["r", "g", "b"],
        },
        weight: { type: "number", description: "Stroke weight in px" },
      },
      required: ["nodeId", "color"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_set_font",
    description:
      "Set TEXT font family/style and optional fontSize. " +
      "Pass family and weight separately as in the Figma picker (e.g. family \"Grtsk Peta\", style \"Semibold\"). " +
      "For custom fonts call figma_list_fonts first. " +
      "Prefer figma_copy_styles from a matching text layer when possible.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        family: { type: "string" },
        style: {
          type: "string",
          description: 'e.g. "Regular", "Medium", "Bold"',
        },
        fontSize: { type: "number" },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_apply_edits",
    description:
      "Apply many canvas property edits in ONE call (faster than one tool per change). " +
      "Use for 2+ renames/text/fills/geometry/opacity/radius/stroke/font/auto-layout/layout-child/copy_styles/reparent. " +
      "Each edit needs op + the same fields as the matching single tool. Max 80 edits. " +
      "Do not use for prototypes (use figma_set_prototype_flow) or create/duplicate/delete.",
    write: true,
    timeoutMs: 120_000,
    inputSchema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "Ordered list of property edits",
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: [
                  "set_name",
                  "set_text",
                  "set_fills",
                  "set_auto_layout",
                  "set_geometry",
                  "set_opacity",
                  "set_corner_radius",
                  "set_stroke",
                  "set_font",
                  "copy_styles",
                  "reparent_node",
                  "set_layout_child",
                ],
              },
              nodeId: { type: "string" },
              name: { type: "string" },
              characters: { type: "string" },
              search: { type: "string" },
              replace: { type: "string" },
              color: {
                type: "object",
                properties: {
                  r: { type: "number" },
                  g: { type: "number" },
                  b: { type: "number" },
                  a: { type: "number" },
                },
              },
              layoutMode: {
                type: "string",
                enum: ["NONE", "HORIZONTAL", "VERTICAL"],
              },
              padding: { type: "number" },
              paddingTop: { type: "number" },
              paddingRight: { type: "number" },
              paddingBottom: { type: "number" },
              paddingLeft: { type: "number" },
              itemSpacing: { type: "number" },
              primaryAxisAlignItems: {
                type: "string",
                enum: ["MIN", "MAX", "CENTER", "SPACE_BETWEEN"],
              },
              counterAxisAlignItems: {
                type: "string",
                enum: ["MIN", "MAX", "CENTER", "BASELINE"],
              },
              primaryAxisSizingMode: {
                type: "string",
                enum: ["FIXED", "AUTO"],
              },
              counterAxisSizingMode: {
                type: "string",
                enum: ["FIXED", "AUTO"],
              },
              layoutWrap: {
                type: "string",
                enum: ["NO_WRAP", "WRAP"],
              },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              opacity: { type: "number" },
              cornerRadius: { type: "number" },
              topLeft: { type: "number" },
              topRight: { type: "number" },
              bottomRight: { type: "number" },
              bottomLeft: { type: "number" },
              weight: { type: "number" },
              strokeWeight: { type: "number" },
              family: { type: "string" },
              style: { type: "string" },
              fontSize: { type: "number" },
              fromNodeId: { type: "string" },
              toNodeId: { type: "string" },
              sourceId: { type: "string" },
              parentId: { type: "string" },
              index: { type: "number" },
              include: {
                type: "array",
                items: { type: "string" },
              },
              layoutAlign: {
                type: "string",
                enum: ["MIN", "MAX", "CENTER", "STRETCH", "INHERIT"],
              },
              layoutGrow: { type: "number" },
              layoutSizingHorizontal: {
                type: "string",
                enum: ["FIXED", "HUG", "FILL"],
              },
              layoutSizingVertical: {
                type: "string",
                enum: ["FIXED", "HUG", "FILL"],
              },
            },
            required: ["op"],
            additionalProperties: false,
          },
        },
      },
      required: ["edits"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_swap_component",
    description:
      "Swap an INSTANCE to a different COMPONENT (design-system component swap). " +
      "Use figma_list_components to find component ids.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "INSTANCE node id" },
        componentId: { type: "string", description: "Target COMPONENT id" },
      },
      required: ["nodeId", "componentId"],
      additionalProperties: false,
    },
  },
  {
    name: "figma_bind_variable",
    description:
      "Bind a local variable to a node property. field: fill | stroke | width | height | " +
      "itemSpacing | paddingTop | paddingRight | paddingBottom | paddingLeft | cornerRadius | opacity. " +
      "Use figma_list_variables first.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        variableId: { type: "string" },
        field: {
          type: "string",
          description: "Property to bind (default fill).",
        },
      },
      required: ["nodeId", "variableId"],
      additionalProperties: false,
    },
  },
];

function stringifyResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

/**
 * Build Cline extraTools for the Figma host.
 * Ask/Plan → read only; Agent → read + write.
 */
export function createFigmaCanvasExtraTools(
  createTool: CreateTool,
  rpc: FigmaToolRpc,
  mode: string
): unknown[] {
  const allowWrite = String(mode || "").toLowerCase() === "agent";
  const defs = allowWrite ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS];
  return defs.map((def) =>
    createTool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      timeoutMs: def.timeoutMs ?? 60_000,
      execute: async (input: unknown) => {
        const args =
          input && typeof input === "object" && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {};
        try {
          const result = await rpc(def.name, args);
          return stringifyResult(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return `Error: ${message}`;
        }
      },
    })
  );
}

/** Disable IDE builtins; keep Figma canvas tools + wildcard allow. */
export function figmaClineToolPolicies(mode: string): Record<string, unknown> {
  const off = { enabled: false, autoApprove: true };
  const on = { enabled: true, autoApprove: true };
  const policies: Record<string, unknown> = {
    "*": on,
    read_files: off,
    search_codebase: off,
    skills: on,
    fetch_web_content: off,
    editor: off,
    apply_patch: off,
    run_commands: off,
    spawn_agent: off,
    update_todo: off,
    inspect_images: off,
  };
  for (const def of READ_TOOLS) {
    policies[def.name] = on;
  }
  if (String(mode || "").toLowerCase() === "agent") {
    for (const def of WRITE_TOOLS) {
      policies[def.name] = on;
    }
  }
  return policies;
}

export function designSystemPrompt(mode: string, language?: string): string {
  const lang = language === "ru" ? "ru" : "en";
  const langRule =
    lang === "ru"
      ? "Always respond in Russian. Think and write in Russian. "
      : "";
  const base =
    langRule +
    "You are Harbor Agents for Figma — a design assistant inside Figma. " +
    "You help designers critique, name, structure, and hand off UI. " +
    "Ground answers in the current selection JSON and screenshot when provided. " +
    "The selection JSON lists every selected root (id, name, type, size) — up to ~100. " +
    "When the user asks to list or name their selection, answer from that JSON; " +
    "do not call figma_list_frames on the whole page to rediscover it. " +
    "Do NOT call figma_get_selection or figma_inspect_node when the turn already has " +
    "enough ids/names in the selection JSON — go straight to the answer or write. " +
    "If you need a selection inventory via tools, use figma_list_frames with selectedOnly=true. " +
    "Never invent node ids. " +
    "Geometry: inspect/selection include x/y (parent-relative) and absX/absY (page-absolute). " +
    "Decide left/right from absX or sibling x — never from width math " +
    "(e.g. do not assume a 320px sidebar is on the right because 1600+320=1920). " +
    "Hidden layers (Layers panel eye-off) are omitted from trees/lists; " +
    "parents may report hiddenChildCount only — do not invent or edit those ids. " +
    "Do not edit locked nodes (locked:true). " +
    "Be concise. Do not invent layers that are not in the selection. " +
    "Do not use IDE file/shell/git tools — only Figma canvas tools. " +
    "Harbor Skills (skills tool): load figma-inner-nodes, figma-auto-layout, figma-resize-playbook when editing inside frames.";
  const id = String(mode || "ask").toLowerCase();
  if (id === "agent") {
    return (
      base +
      " Mode: Agent. You fully edit the Figma canvas via write tools. " +
      "SCOPE (critical): change only what the user asked this turn. " +
      "Do not also fix siblings, other screens, or look-alike layers for consistency " +
      "unless the user explicitly asked. If they say only one place / leave the rest alone — " +
      "stop after that change; do not broaden. Prefer the named or selected node ids. " +
      "INTERNAL NODES (critical): when the user asks to fix/align/move/edit content INSIDE a screen — " +
      "work on inner layers, not only the root frame width. " +
      "1) figma_list_children on the content container (or figma_find_nodes with rootId + nameContains). " +
      "2) Edit matched children via figma_apply_to_children (same op to many) or figma_apply_edits (mixed ops). " +
      "3) Absolute inner layout: figma_nudge_nodes(dx/dy) or set_geometry on specific child ids from list_children. " +
      "4) Auto-layout children: figma_set_layout_child (STRETCH/FILL) not manual x/y. " +
      "5) figma_layout_report on the CONTENT parent, not only the page root. " +
      "Select the inner node in Figma when possible — selection JSON then has its id. " +
      "SPEED: find layers with figma_find_nodes (not whole-page list_frames). " +
      "Layout recipes: figma_apply_recipe (resize_center, center_content, …) — one call. " +
      "Multi-step read/write: figma_batch_tools (≤12 calls, one RPC). " +
      "Inspect: pass fields:[\"geometry\",\"layout\"] to figma_inspect_node for fast reads. " +
      "Resize+breakpoint: figma_resize_frame or recipe resize_center (not set_geometry alone). " +
      "Mass text: figma_batch_text_replace. Match another screen: figma_match_layout. " +
      "Verify layout: figma_layout_report (needsFollowUp=false → done; skip extra inspect). " +
      "After figma_apply_edits when applied===total and no errors, do NOT re-inspect unless layout_report says needsFollowUp. " +
      "For 2+ property edits prefer figma_apply_edits in one call " +
      "(set_name/set_text/set_fills/set_geometry/set_opacity/set_corner_radius/set_stroke/" +
      "set_font/set_auto_layout/set_layout_child/copy_styles/reparent_node). " +
      "For auto-layout axis alignment use figma_align_in_frame or figma_set_auto_layout with primaryAxisAlignItems/counterAxisAlignItems; " +
      "for one child use figma_set_layout_child (layoutAlign STRETCH/FILL). " +
      "Absolute layers that must stick on resize: figma_set_constraints. " +
      "Independent inspects may run in parallel. " +
      "PARALLEL TOOL CALLS: when editing 2+ independent nodes, issue ALL tool calls in one response — " +
      "do not wait for each to finish before starting the next. " +
      "COMPLETION (layout): finish the whole layout task before ending the turn. " +
      "After resize/align: figma_layout_report — if needsFollowUp, continue with figma_align_in_frame / figma_apply_edits until ok. " +
      "Do not stop after only changing root width or only the first layer. " +
      "When user asks resize + align, use figma_resize_frame or resize then align in the same turn. " +
      "STYLE RULES: match the existing mockup — never invent a new visual system. " +
      "1) Prefer figma_duplicate_node on a similar layer, then edit text/size. " +
      "2) If you must create, pass styleFromId from a sibling/similar layer, or call figma_copy_styles right after. " +
      "3) Before creating UI, figma_inspect_node on nearby components to read fills, radius, font, padding/gap. " +
      "4) Use set_font / set_stroke / set_fills / set_corner_radius / set_auto_layout " +
      "only to fine-tune after copying styles — do not pick random Inter/gray defaults. " +
      "Custom fonts: use family + weight **as in the Figma font picker** (e.g. family Grtsk Peta, style Semibold — not one merged name). figma_list_fonts to verify. " +
      "Also: rename, geometry, reparent, delete, prototype links, component swap, variable bind. " +
      "Design system: figma_list_variables + figma_bind_variable for tokens; figma_list_components + figma_swap_component for instances. " +
      "Never invent node ids. This chat keeps memory across turns — reuse known ids. " +
      "Selection JSON is a turn-start SNAPSHOT (stale after writes). " +
      "When delete succeeds, do not re-search deleted nodes. " +
      "For prototypes: figma_list_frames then figma_set_prototype_flow with ALL links. " +
      "If a write fails (e.g. Dev Mode), explain and continue with advice only."
    );
  }
  if (id === "plan") {
    return (
      base +
      " Mode: Plan. Produce a clear implementation / design plan with Goal and numbered Steps. " +
      "You may inspect/focus nodes with read tools. Do not edit the canvas. " +
      "End with a short handoff brief a developer can paste into an IDE agent."
    );
  }
  return (
    base +
    " Mode: Ask. Answer the design question; do not invent a full build plan unless asked. " +
    "You may inspect/focus nodes with read tools. Do not edit the canvas."
  );
}

/**
 * Condensed system prompt for follow-up turns on a reused session.
 * The model already knows the tools and rules — only remind it of
 * scope constraints and the current mode.
 */
export function designSystemPromptFollowUp(mode: string, language?: string): string {
  const id = String(mode || "ask").toLowerCase();
  const lang = language === "ru" ? "ru" : "en";
  const langRule =
    lang === "ru"
      ? "Always respond in Russian. Think and write in Russian. "
      : "";
  const base =
    langRule +
    "You are Harbor Agents for Figma (follow-up turn). " +
    "Reuse known node ids from prior turns. Selection ref is a brief pointer — " +
    "do NOT re-fetch the full selection unless the user changed it. " +
    "Be concise. ";
  if (id === "agent") {
    return (
      base +
      "Mode: Agent. Edit only what was asked this turn — do not broaden scope. " +
      "Prefer figma_apply_edits for 2+ changes, figma_batch_tools for multi-step. " +
      "After writes, do NOT re-inspect unless layout_report says needsFollowUp."
    );
  }
  if (id === "plan") {
    return base + "Mode: Plan. Inspect only, no canvas edits.";
  }
  return base + "Mode: Ask. Answer only, no canvas edits.";
}

export function buildSelectionContextText(selection: unknown): string {
  const sel = selection as {
    fileName?: string;
    pageName?: string;
    nodeUrl?: string;
    canWrite?: boolean;
    selectedCount?: number;
    layoutHealth?: unknown;
    nodes?: unknown[];
  } | null;
  if (!sel || !Array.isArray(sel.nodes) || sel.nodes.length === 0) {
    return "Current Figma selection: (none — ask the user to select a frame or node).";
  }
  const count =
    typeof sel.selectedCount === "number"
      ? sel.selectedCount
      : sel.nodes.filter(
          (n) =>
            n &&
            typeof n === "object" &&
            (n as { id?: string }).id !== "__more_roots"
        ).length;
  const header = [
    sel.fileName ? `File: ${sel.fileName}` : null,
    sel.pageName ? `Page: ${sel.pageName}` : null,
    sel.nodeUrl ? `Link: ${sel.nodeUrl}` : null,
    `Selected roots: ${count}`,
    sel.canWrite === false
      ? "Canvas writes: unavailable (Dev Mode)"
      : "Canvas writes: available in Agent mode",
  ]
    .filter(Boolean)
    .join("\n");
  const layoutBlock =
    sel.layoutHealth && typeof sel.layoutHealth === "object"
      ? `\nLayout health (pre-turn):\n${JSON.stringify(sel.layoutHealth, null, 2)}`
      : "";
  // Strip verbose fields to reduce tokens — model can fetch details via figma_inspect_node.
  const slimNodes = slimSelectionNodes(sel.nodes);
  return `${header}${layoutBlock}\nSelection JSON:\n${JSON.stringify(slimNodes, null, 2)}`;
}

/** Strip fills/strokes/fontName/componentId from selection nodes to save tokens. */
function slimSelectionNodes(nodes: unknown[]): unknown[] {
  return nodes.map((n) => {
    if (!n || typeof n !== "object") return n;
    const node = n as Record<string, unknown>;
    const slim: Record<string, unknown> = {
      id: node.id,
      name: node.name,
      type: node.type,
    };
    if (node.width != null) slim.width = node.width;
    if (node.height != null) slim.height = node.height;
    if (node.characters != null) slim.characters = node.characters;
    if (node.layoutMode != null) slim.layoutMode = node.layoutMode;
    if (node.itemSpacing != null) slim.itemSpacing = node.itemSpacing;
    if (node.primaryAxisAlignItems != null) slim.primaryAxisAlignItems = node.primaryAxisAlignItems;
    if (node.counterAxisAlignItems != null) slim.counterAxisAlignItems = node.counterAxisAlignItems;
    if (node.visible === false) slim.visible = false;
    if (node.locked === true) slim.locked = true;
    if (node.hiddenChildCount != null) slim.hiddenChildCount = node.hiddenChildCount;
    if (Array.isArray(node.children)) {
      slim.children = slimSelectionNodes(node.children);
    }
    return slim;
  });
}

/**
 * Алиасы из tsconfig/jsconfig и проверка локальных import/require.
 * Без зависимости от vscode — удобно тестировать.
 */

export interface PathAliasConfig {
  /** Относительно корня проекта, обычно "." или "src" */
  baseUrl: string;
  /** pattern как в tsconfig: "@shared/*" → targets ["src/shared/*"] */
  aliases: Array<{ pattern: string; targets: string[] }>;
  source: string;
}

const CONFIG_CANDIDATES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.base.json",
  "jsconfig.json",
];

export function tsconfigCandidateNames(): string[] {
  return CONFIG_CANDIDATES.slice();
}

/** Вытащить baseUrl + paths из JSON tsconfig (без extends). */
export function parseTsconfigPathsJson(
  jsonText: string,
  source = "tsconfig.json"
): PathAliasConfig | undefined {
  let data: unknown;
  try {
    data = JSON.parse(stripJsonComments(jsonText));
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const compilerOptions = (data as { compilerOptions?: unknown })
    .compilerOptions;
  if (!compilerOptions || typeof compilerOptions !== "object") {
    return undefined;
  }
  const opts = compilerOptions as {
    baseUrl?: unknown;
    paths?: unknown;
  };
  const rawBase =
    typeof opts.baseUrl === "string" && opts.baseUrl.trim()
      ? opts.baseUrl.trim()
      : ".";
  const baseUrl = normalizeRel(rawBase) || ".";
  const paths = opts.paths;
  if (!paths || typeof paths !== "object") {
    return { baseUrl, aliases: [], source };
  }

  const aliases: PathAliasConfig["aliases"] = [];
  for (const [pattern, value] of Object.entries(
    paths as Record<string, unknown>
  )) {
    if (!pattern.trim()) {
      continue;
    }
    const targets = Array.isArray(value)
      ? value.filter(
          (v): v is string => typeof v === "string" && Boolean(v.trim())
        )
      : typeof value === "string"
        ? [value]
        : [];
    if (!targets.length) {
      continue;
    }
    aliases.push({
      pattern: pattern.trim(),
      targets: targets.map(normalizeRel),
    });
  }

  aliases.sort((a, b) => b.pattern.length - a.pattern.length);
  return { baseUrl, aliases, source };
}

export function formatPathAliasContext(config: PathAliasConfig): string {
  const lines = [
    "Import path conventions (from " + config.source + "):",
    `- baseUrl: ${config.baseUrl || "."}`,
  ];
  if (config.aliases.length) {
    lines.push("- Path aliases (use these; do not invent new ones):");
    for (const alias of config.aliases.slice(0, 24)) {
      lines.push(`  - ${alias.pattern} → ${alias.targets.join(" | ")}`);
    }
  } else {
    lines.push(
      "- No path aliases configured; prefer relative imports like nearby files."
    );
  }
  lines.push(
    "- Before writing imports: read_file the target file and a sibling, then copy their import style.",
    "- Never invent module paths or aliases. Prefer existing aliases from this list.",
    "- After write_file, fix any importWarnings from the tool result immediately."
  );
  return lines.join("\n");
}

/** Спецификаторы из import/export/require. */
export function extractImportSpecifiers(source: string): string[] {
  const text = String(source || "");
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const spec = m[1]?.trim();
      if (spec) {
        found.add(spec);
      }
    }
  }
  return [...found];
}

/**
 * Преобразует import specifier в кандидаты относительных путей workspace.
 * Пустой массив = внешний пакет / не проверяем.
 */
export function resolveImportCandidates(
  importerRelPath: string,
  specifier: string,
  config?: PathAliasConfig | null
): string[] {
  const spec = specifier.trim();
  if (!spec || spec.startsWith("node:") || spec.startsWith("vscode:")) {
    return [];
  }

  if (spec.startsWith(".")) {
    const importerDir = dirnameRel(importerRelPath);
    return [normalizeRel(joinRel(importerDir, spec))];
  }

  if (config?.aliases.length) {
    for (const alias of config.aliases) {
      const mapped = applyAlias(alias.pattern, alias.targets, spec);
      if (mapped) {
        return mapped.map((t) =>
          normalizeRel(joinRel(config.baseUrl === "." ? "" : config.baseUrl, t))
        );
      }
    }
  }

  // @/foo без явного алиаса — частый Next/Vite дефолт к src/
  if (spec.startsWith("@/")) {
    return [normalizeRel(`src/${spec.slice(2)}`)];
  }

  // Scoped / bare package — не локальный путь
  if (spec.startsWith("@") || !spec.includes("/")) {
    return [];
  }

  // Абсолют от baseUrl (редко): "components/Button"
  if (config) {
    return [
      normalizeRel(
        joinRel(config.baseUrl === "." ? "" : config.baseUrl, spec)
      ),
    ];
  }

  return [];
}

export function expandFileCandidates(relPath: string): string[] {
  const base = normalizeRel(relPath).replace(/\/+$/, "");
  if (!base) {
    return [];
  }
  const exts = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".css",
    ".scss",
  ];
  const out = new Set<string>();
  out.add(base);
  if (/\.[a-z0-9]+$/i.test(base)) {
    out.add(base);
  } else {
    for (const ext of exts) {
      out.add(base + ext);
      out.add(`${base}/index${ext}`);
    }
  }
  return [...out];
}

function applyAlias(
  pattern: string,
  targets: string[],
  specifier: string
): string[] | null {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    if (!specifier.startsWith(prefix)) {
      return null;
    }
    const star = specifier.slice(prefix.length);
    return targets.map((t) => (t.endsWith("*") ? t.slice(0, -1) + star : t));
  }
  if (specifier === pattern) {
    return targets.slice();
  }
  return null;
}

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function normalizeRel(p: string): string {
  const parts: string[] = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length) {
        parts.pop();
      }
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function dirnameRel(relPath: string): string {
  const n = normalizeRel(relPath);
  const idx = n.lastIndexOf("/");
  return idx <= 0 ? "" : n.slice(0, idx);
}

function joinRel(a: string, b: string): string {
  const left = normalizeRel(a);
  const right = b.replace(/\\/g, "/");
  if (!left) {
    return normalizeRel(right);
  }
  return normalizeRel(`${left}/${right}`);
}

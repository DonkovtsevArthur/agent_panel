/**
 * Workspace / git-root relative path helpers (vscode-free — unit-tested).
 */

function lightNorm(filePath: string): string {
  return String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .normalize("NFC");
}

function lightKey(filePath: string): string {
  const n = lightNorm(filePath);
  return process.platform === "darwin" || process.platform === "win32"
    ? n.toLowerCase()
    : n;
}

function pathBasename(rel: string): string {
  const n = lightNorm(rel);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

export function toRepoRelativePath(
  filePath: string,
  root?: string | null
): string {
  let p = lightNorm(filePath);
  if (!p) {
    return "";
  }

  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\//i, ""));
      if (/^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1);
      }
      p = lightNorm(p);
    } catch {
      return "";
    }
  }

  const rootNorm = lightNorm(String(root || "")).replace(/\/+$/, "");

  if (rootNorm) {
    const pFold = lightKey(p);
    const rootFold = lightKey(rootNorm);
    if (pFold === rootFold) {
      return "";
    }
    if (pFold.startsWith(`${rootFold}/`)) {
      p = p.slice(rootNorm.length + 1);
    } else {
      // Legacy mangled absolute: "Users/me/proj/src/a.ts"
      const rootNoSlash = rootNorm.replace(/^\//, "");
      if (lightKey(p).startsWith(`${lightKey(rootNoSlash)}/`)) {
        p = p.slice(rootNoSlash.length + 1);
      }
    }
  }

  p = p.replace(/^\.\//, "");
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) {
    return "";
  }
  return p;
}

export function toRepoRelativePaths(
  paths: Iterable<string>,
  root?: string | null
): string[] {
  return [
    ...new Set(
      [...paths].map((p) => toRepoRelativePath(p, root)).filter(Boolean)
    ),
  ];
}

/**
 * Match review/UI seeds to live dirty paths.
 * Always returns paths from the dirty list (never invent basenames).
 */
export function matchSeedsToDirtyPaths(
  seeds: Iterable<string>,
  dirty: Iterable<string>,
  root?: string | null
): string[] {
  const rawSeeds = [...new Set([...seeds].map(lightNorm).filter(Boolean))];
  const rawDirty = [...new Set([...dirty].map(lightNorm).filter(Boolean))];
  if (!rawSeeds.length || !rawDirty.length) {
    return [];
  }

  const out = new Set<string>();
  const dirtyByKey = new Map<string, string>();
  for (const d of rawDirty) {
    dirtyByKey.set(lightKey(d), d);
  }

  // 1) Raw exact / case-insensitive (bypass root normalize — fixes identical
  //    "suspense.tsx" seed+dirty that previously failed after re-normalize).
  for (const seed of rawSeeds) {
    const hit = dirtyByKey.get(lightKey(seed));
    if (hit) {
      out.add(hit);
    }
  }
  if (out.size) {
    return [...out];
  }

  // 2) Repo-relative exact / nested under directory seed.
  const seedList = toRepoRelativePaths(rawSeeds, root);
  const dirtyList = toRepoRelativePaths(rawDirty, root);
  const dirtySet = new Set(dirtyList.map(lightKey));
  const dirtyByRelKey = new Map<string, string>();
  for (const d of dirtyList) {
    dirtyByRelKey.set(lightKey(d), d);
  }
  // Map relative → original dirty string when possible.
  const relToRaw = new Map<string, string>();
  for (const d of rawDirty) {
    const rel = toRepoRelativePath(d, root) || d;
    relToRaw.set(lightKey(rel), d);
  }

  for (const seed of seedList) {
    const key = lightKey(seed);
    if (dirtySet.has(key)) {
      out.add(relToRaw.get(key) || dirtyByRelKey.get(key) || seed);
      continue;
    }
    for (const d of dirtyList) {
      if (lightKey(d).startsWith(`${key}/`)) {
        out.add(relToRaw.get(lightKey(d)) || d);
      }
    }
  }
  if (out.size) {
    return [...out];
  }

  // 3) Suffix match when seed has a directory ("app/foo.ts" ↔ "src/app/foo.ts").
  for (const seed of [...seedList, ...rawSeeds]) {
    if (!seed.includes("/")) {
      continue;
    }
    const seedKey = lightKey(seed);
    for (const d of rawDirty) {
      const dKey = lightKey(d);
      if (
        dKey === seedKey ||
        dKey.endsWith(`/${seedKey}`) ||
        seedKey.endsWith(`/${dKey}`)
      ) {
        out.add(d);
      }
    }
  }
  if (out.size) {
    return [...out];
  }

  // 4) Unique basename match (seed "suspense.tsx" ↔ dirty "src/app/suspense.tsx"
  //    or both "suspense.tsx"). Only when exactly one dirty file shares the name.
  for (const seed of rawSeeds) {
    const baseKey = lightKey(pathBasename(seed));
    if (!baseKey) {
      continue;
    }
    const hits = rawDirty.filter((d) => lightKey(pathBasename(d)) === baseKey);
    if (hits.length === 1) {
      out.add(hits[0]);
    }
  }

  return [...out];
}

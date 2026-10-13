/**
 * Ripgrep for Cline `search_files` / file index.
 *
 * Cline spawns bare `rg`; IDE hosts start with a GUI PATH that usually has
 * none, so search fell back to a directory walk that ignores `.gitignore`.
 * Harbor resolves a real binary (VS Code's bundled ripgrep, PATH, common
 * package-manager locations) and exports it as `CLINE_RIPGREP_PATH` (read by
 * the vendor patch in `services/workspace/ripgrep.ts`). No `vscode` import —
 * shared by the extension host and the JetBrains sidecar.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const RIPGREP_PATH_ENV = "CLINE_RIPGREP_PATH";

const RG_EXE = process.platform === "win32" ? "rg.exe" : "rg";

function isExecutableFile(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/** Ripgrep shipped inside a VS Code install (`vscode.env.appRoot`). */
function ripgrepInVsCodeAppRoot(appRoot: string): string | undefined {
  const platformDir = `${process.platform}-${process.arch}`;
  for (const modules of ["node_modules.asar.unpacked", "node_modules"]) {
    for (const pkg of ["@vscode/ripgrep", "@vscode/ripgrep-universal"]) {
      const bin = path.join(appRoot, modules, pkg, "bin");
      for (const candidate of [
        path.join(bin, RG_EXE),
        path.join(bin, platformDir, RG_EXE),
      ]) {
        if (isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

function ripgrepOnPath(): string | undefined {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, RG_EXE);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Package-manager locations missing from a GUI-launched IDE's PATH. */
function wellKnownRipgrepPaths(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const programData = process.env.ProgramData || "C:\\ProgramData";
    return [
      path.join(home, "scoop", "shims", RG_EXE),
      path.join(localAppData, "Microsoft", "WinGet", "Links", RG_EXE),
      path.join(programData, "chocolatey", "bin", RG_EXE),
      path.join(home, ".cargo", "bin", RG_EXE),
    ];
  }
  return [
    "/opt/homebrew/bin/rg",
    "/usr/local/bin/rg",
    "/usr/bin/rg",
    "/snap/bin/rg",
    path.join(home, ".cargo", "bin", "rg"),
    path.join(home, ".local", "bin", "rg"),
  ];
}

/** Standard VS Code install roots — reused by hosts without their own rg. */
function installedVsCodeAppRoots(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Visual Studio Code.app/Contents/Resources/app",
      path.join(
        os.homedir(),
        "Applications",
        "Visual Studio Code.app",
        "Contents",
        "Resources",
        "app"
      ),
    ];
  }
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    return [
      path.join(localAppData, "Programs", "Microsoft VS Code", "resources", "app"),
      path.join(programFiles, "Microsoft VS Code", "resources", "app"),
    ];
  }
  return ["/usr/share/code/resources/app", "/snap/code/current/usr/share/code/resources/app"];
}

export interface ResolveRipgrepOptions {
  /** VS Code `vscode.env.appRoot` — its bundled ripgrep wins. */
  appRoot?: string;
  /** Also look inside standard VS Code installs (JetBrains sidecar). */
  probeInstalledVsCode?: boolean;
}

export function resolveRipgrepBinary(
  options: ResolveRipgrepOptions = {}
): string | undefined {
  if (options.appRoot) {
    const bundled = ripgrepInVsCodeAppRoot(options.appRoot);
    if (bundled) {
      return bundled;
    }
  }
  const onPath = ripgrepOnPath();
  if (onPath) {
    return onPath;
  }
  for (const candidate of wellKnownRipgrepPaths()) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  if (options.probeInstalledVsCode) {
    for (const appRoot of installedVsCodeAppRoots()) {
      const bundled = ripgrepInVsCodeAppRoot(appRoot);
      if (bundled) {
        return bundled;
      }
    }
  }
  return undefined;
}

/**
 * Sets `CLINE_RIPGREP_PATH` once per process (call before the first turn —
 * Cline's file-index worker copies the env when it is created). An existing
 * value that points at a real binary is kept. Returns the path in use.
 */
export function applyRipgrepPathForCline(
  options: ResolveRipgrepOptions = {}
): string | undefined {
  const existing = process.env[RIPGREP_PATH_ENV]?.trim();
  if (existing && isExecutableFile(existing)) {
    return existing;
  }
  const resolved = resolveRipgrepBinary(options);
  if (resolved) {
    process.env[RIPGREP_PATH_ENV] = resolved;
  }
  return resolved;
}

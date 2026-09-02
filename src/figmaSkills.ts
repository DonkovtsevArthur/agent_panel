/**
 * Harbor Skills discovery for the Figma Cline sidecar.
 * Scans ~/.harbor/skills, bundled out/figma-skills, and repo .harbor/skills.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function resolveFigmaSkillDirectories(): string[] {
  const dirs: string[] = [];
  const global = path.join(os.homedir(), ".harbor", "skills");
  if (fs.existsSync(global)) {
    dirs.push(global);
  }
  const figmaHome = path.join(os.homedir(), ".harbor", "figma", "skills");
  if (fs.existsSync(figmaHome)) {
    dirs.push(figmaHome);
  }
  const bundled = path.join(__dirname, "figma-skills");
  if (fs.existsSync(bundled)) {
    dirs.push(bundled);
  }
  const repo = path.join(__dirname, "..", ".harbor", "skills");
  if (fs.existsSync(repo)) {
    dirs.push(repo);
  }
  return [...new Set(dirs)];
}

export function buildFigmaUserInstructionService(
  bundle: {
    createUserInstructionConfigService?: (options: {
      skills?: { directories: string[]; includePluginSkills?: boolean };
      rules?: { workspacePath: string };
      workflows?: { workspacePath: string };
    }) => unknown;
  },
  cwd: string
): unknown | undefined {
  if (typeof bundle.createUserInstructionConfigService !== "function") {
    return undefined;
  }
  const directories = resolveFigmaSkillDirectories();
  if (!directories.length) {
    return undefined;
  }
  return bundle.createUserInstructionConfigService({
    skills: {
      directories,
      includePluginSkills: false,
    },
    rules: { workspacePath: cwd },
    workflows: { workspacePath: cwd },
  });
}

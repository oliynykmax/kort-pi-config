import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";

const GLOBAL_SKILLS_DIR = path.join(process.env.HOME || "~", ".pi/agent/skills");
const PROJECT_SKILLS_DIR = ".pi/skills";

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: string;
}

async function parseSkillHeader(skillDir: string): Promise<{ name: string; description: string } | null> {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  try {
    const content = await fs.readFile(skillMdPath, "utf8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);
    return {
      name: nameMatch?.[1]?.trim() || path.basename(skillDir),
      description: descMatch?.[1]?.trim() || "No description available",
    };
  } catch {
    return null;
  }
}

async function discoverSkills(dir: string, source: string): Promise<SkillInfo[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const skills: SkillInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dir, entry.name);
      const hasSkillMd = await fs
        .access(path.join(skillPath, "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      if (!hasSkillMd) continue;
      const header = await parseSkillHeader(skillPath);
      if (header) {
        skills.push({ ...header, path: skillPath, source });
      }
    }
    return skills;
  } catch {
    return [];
  }
}

async function listAllSkills(): Promise<SkillInfo[]> {
  const [globalSkills, projectSkills] = await Promise.all([
    discoverSkills(GLOBAL_SKILLS_DIR, "global"),
    discoverSkills(path.join(process.cwd(), PROJECT_SKILLS_DIR), "project"),
  ]);
  return [...globalSkills, ...projectSkills];
}

export default function skillsRegister(pi: ExtensionAPI) {
  pi.on("resources_discover", async (_event, _ctx) => {
    const result: { skillPaths: string[] } = { skillPaths: [] };

    if (await fs.access(GLOBAL_SKILLS_DIR).then(() => true).catch(() => false)) {
      result.skillPaths.push(GLOBAL_SKILLS_DIR);
    }

    const projectSkillsDir = path.join(process.cwd(), PROJECT_SKILLS_DIR);
    if (await fs.access(projectSkillsDir).then(() => true).catch(() => false)) {
      result.skillPaths.push(projectSkillsDir);
    }

    return result;
  });

  pi.registerCommand("skills", {
    description: "List all installed skills",
    handler: async (_args, ctx: ExtensionContext) => {
      const skills = await listAllSkills();
      if (skills.length === 0) {
        ctx.ui.notify("No skills installed.\n\nInstall skills to:\n- Global: ~/.pi/agent/skills/\n- Project: .pi/skills/\n\nExample: git clone https://github.com/badlogic/pi-skills ~/.pi/agent/skills/pi-skills", "info");
        return;
      }

      const lines = ["Installed Skills:", ""];
      for (const skill of skills) {
        lines.push(`${skill.source === "global" ? "🌐" : "📁"} ${skill.name}`);
        lines.push(`   ${skill.description}`);
        lines.push(`   Source: ${skill.source} (${skill.path})`);
        lines.push("");
      }
      lines.push(`Total: ${skills.length} skill(s)`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("install-skill", {
    description: "Install a skill from a git repository",
    handler: async (args: string, ctx: ExtensionContext) => {
      const repoUrl = args.trim();
      if (!repoUrl) {
        ctx.ui.notify("Usage: /install-skill <git-url>\n\nExample: /install-skill https://github.com/badlogic/pi-skills", "error");
        return;
      }

      const skillsDir = GLOBAL_SKILLS_DIR;
      const repoName = repoUrl.split("/").pop()?.replace(/\.git$/, "");
      if (!repoName) {
        ctx.ui.notify("Could not determine repository name from URL", "error");
        return;
      }

      const targetDir = path.join(skillsDir, repoName);

      try {
        await fs.access(targetDir);
        ctx.ui.notify(`Skill '${repoName}' already installed at ${targetDir}`, "info");
        return;
      } catch {
        // Directory doesn't exist, proceed with clone
      }

      await fs.mkdir(skillsDir, { recursive: true });

      ctx.ui.notify(`Installing skill '${repoName}' from ${repoUrl}...`, "info");

      const result = await pi.exec("git", ["clone", "--depth", "1", repoUrl, targetDir], {
        timeout: 60000,
      });

      if (result.code === 0) {
        ctx.ui.notify(`✓ Skill '${repoName}' installed successfully!\n\nRestart pi or run /reload to activate.`, "success");
      } else {
        ctx.ui.notify(`✗ Failed to install skill: ${result.stderr || result.stdout}`, "error");
      }
    },
  });
}

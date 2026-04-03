import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.env.HOME || "~", ".pi/agent/skills-cache");
const SKILLS_DIR = path.join(process.env.HOME || "~", ".pi/agent/skills");

interface SkillRepo {
  name: string;
  url: string;
  description: string;
}

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  repo: string;
  repoUrl: string;
  cachePath: string;
  installed: boolean;
  installPath?: string;
  tags?: string[];
}

const KNOWN_REPOS: SkillRepo[] = [
  {
    name: "pi-skills",
    url: "https://github.com/badlogic/pi-skills",
    description: "Official pi skills by Mario Zechner",
  },
  {
    name: "agent-skills-hub",
    url: "https://github.com/agent-skills-hub/agent-skills-hub",
    description: "Cross-platform agent skills hub",
  },
  {
    name: "agent-stuff",
    url: "https://github.com/mitsuhiko/agent-stuff",
    description: "Skills and extensions by mitsuhiko",
  },
  {
    name: "pi-amplike",
    url: "https://github.com/pasky/pi-amplike",
    description: "Pi skills for web search and extraction",
  },
];

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function cloneOrUpdateRepo(pi: ExtensionAPI, repo: SkillRepo): Promise<boolean> {
  const repoDir = path.join(CACHE_DIR, repo.name);
  const exists = await fs
    .access(path.join(repoDir, ".git"))
    .then(() => true)
    .catch(() => false);

  if (exists) {
    const result = await pi.exec("git", ["-C", repoDir, "pull", "--ff-only"], { timeout: 30000 });
    return result.code === 0;
  } else {
    const result = await pi.exec("git", ["clone", "--depth", "1", repo.url, repoDir], { timeout: 60000 });
    return result.code === 0;
  }
}

async function parseSkillMetadata(skillDir: string): Promise<{ name: string; description: string; tags?: string[] } | null> {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  try {
    const content = await fs.readFile(skillMdPath, "utf8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);
    const tagsMatch = content.match(/^tags:\s*(.+)$/m);
    return {
      name: nameMatch?.[1]?.trim() || path.basename(skillDir),
      description: descMatch?.[1]?.trim() || "No description available",
      tags: tagsMatch?.[1]?.split(",").map((t: string) => t.trim()),
    };
  } catch {
    return null;
  }
}

async function discoverSkillsInRepo(repoDir: string, repoName: string, repoUrl: string): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  try {
    const entries = await fs.readdir(repoDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillPath = path.join(repoDir, entry.name);
      const hasSkillMd = await fs
        .access(path.join(skillPath, "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      if (!hasSkillMd) continue;

      const meta = await parseSkillMetadata(skillPath);
      if (!meta) continue;

      const installPath = path.join(SKILLS_DIR, entry.name);
      const installed = await fs
        .access(installPath)
        .then(() => true)
        .catch(() => false);

      skills.push({
        id: `${repoName}/${entry.name}`,
        name: meta.name,
        description: meta.description,
        repo: repoName,
        repoUrl,
        cachePath: skillPath,
        installed,
        installPath: installed ? installPath : undefined,
        tags: meta.tags,
      });
    }
  } catch {
    // Ignore errors reading repo directory
  }
  return skills;
}

async function updateCache(pi: ExtensionAPI): Promise<{ success: number; failed: number }> {
  await ensureDir(CACHE_DIR);
  let success = 0;
  let failed = 0;

  for (const repo of KNOWN_REPOS) {
    const ok = await cloneOrUpdateRepo(pi, repo);
    if (ok) success++;
    else failed++;
  }

  return { success, failed };
}

async function loadAllSkills(): Promise<SkillEntry[]> {
  const allSkills: SkillEntry[] = [];
  for (const repo of KNOWN_REPOS) {
    const repoDir = path.join(CACHE_DIR, repo.name);
    const exists = await fs
      .access(repoDir)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;

    const skills = await discoverSkillsInRepo(repoDir, repo.name, repo.url);
    allSkills.push(...skills);
  }
  return allSkills;
}

async function installSkill(pi: ExtensionAPI, skill: SkillEntry): Promise<boolean> {
  const targetPath = path.join(SKILLS_DIR, path.basename(skill.cachePath));
  await ensureDir(SKILLS_DIR);

  const result = await pi.exec("cp", ["-r", skill.cachePath, targetPath], { timeout: 10000 });
  return result.code === 0;
}

async function uninstallSkill(pi: ExtensionAPI, skill: SkillEntry): Promise<boolean> {
  if (!skill.installPath) return false;
  const result = await pi.exec("rm", ["-rf", skill.installPath], { timeout: 10000 });
  return result.code === 0;
}

function filterSkills(skills: SkillEntry[], query: string): SkillEntry[] {
  if (!query.trim()) return skills;
  const q = query.toLowerCase();
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.repo.toLowerCase().includes(q) ||
      s.tags?.some((t) => t.toLowerCase().includes(q))
  );
}

export default function skillsMarketplace(pi: ExtensionAPI) {
  let cachedSkills: SkillEntry[] | null = null;

  async function getSkills(): Promise<SkillEntry[]> {
    if (cachedSkills) return cachedSkills;
    cachedSkills = await loadAllSkills();
    return cachedSkills;
  }

  function invalidateCache(): void {
    cachedSkills = null;
  }

  pi.registerCommand("marketplace", {
    description: "Browse, search, and install skills from multiple repositories",
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmedArgs = args.trim();

      if (trimmedArgs === "update") {
        ctx.ui.notify("Updating skills cache...", "info");
        const result = await updateCache(pi);
        invalidateCache();
        ctx.ui.notify(
          `Cache updated: ${result.success} repos succeeded, ${result.failed} failed.\nRestart pi or run /reload to see new skills.`,
          result.failed === 0 ? "success" : "info"
        );
        return;
      }

      if (trimmedArgs.startsWith("install ")) {
        const skillName = trimmedArgs.slice(8).trim();
        const skills = await getSkills();
        const skill = skills.find(
          (s) => s.id === skillName || s.name.toLowerCase() === skillName.toLowerCase()
        );
        if (!skill) {
          ctx.ui.notify(`Skill '${skillName}' not found. Run /marketplace update first.`, "error");
          return;
        }
        if (skill.installed) {
          ctx.ui.notify(`Skill '${skill.name}' is already installed.`, "info");
          return;
        }
        ctx.ui.notify(`Installing '${skill.name}'...`, "info");
        const ok = await installSkill(pi, skill);
        if (ok) {
          ctx.ui.notify(`✓ Installed '${skill.name}'\nRestart pi or run /reload to activate.`, "success");
          invalidateCache();
        } else {
          ctx.ui.notify(`✗ Failed to install '${skill.name}'`, "error");
        }
        return;
      }

      if (trimmedArgs.startsWith("uninstall ")) {
        const skillName = trimmedArgs.slice(10).trim();
        const skills = await getSkills();
        const skill = skills.find(
          (s) => s.id === skillName || s.name.toLowerCase() === skillName.toLowerCase()
        );
        if (!skill || !skill.installed) {
          ctx.ui.notify(`Skill '${skillName}' is not installed.`, "error");
          return;
        }
        ctx.ui.notify(`Uninstalling '${skill.name}'...`, "info");
        const ok = await uninstallSkill(pi, skill);
        if (ok) {
          ctx.ui.notify(`✓ Uninstalled '${skill.name}'`, "success");
          invalidateCache();
        } else {
          ctx.ui.notify(`✗ Failed to uninstall '${skill.name}'`, "error");
        }
        return;
      }

      if (trimmedArgs.startsWith("search ")) {
        const query = trimmedArgs.slice(7).trim();
        const skills = await getSkills();
        const filtered = filterSkills(skills, query);
        if (filtered.length === 0) {
          ctx.ui.notify(`No skills found for '${query}'.\nRun /marketplace update to refresh cache.`, "info");
          return;
        }
        const lines = [`Search results for '${query}':`, ""];
        for (const skill of filtered) {
          const status = skill.installed ? "✓" : " ";
          lines.push(`${status} ${skill.name} (${skill.repo})`);
          lines.push(`   ${skill.description}`);
          lines.push(`   Install: /marketplace install ${skill.id}`);
          lines.push("");
        }
        lines.push(`Found ${filtered.length} skill(s)`);
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (trimmedArgs === "list") {
        const skills = await getSkills();
        const installed = skills.filter((s) => s.installed);
        const available = skills.filter((s) => !s.installed);

        const lines = ["Skills Marketplace", ""];

        if (installed.length > 0) {
          lines.push("Installed:");
          for (const skill of installed) {
            lines.push(`  ✓ ${skill.name} (${skill.repo})`);
          }
          lines.push("");
        }

        if (available.length > 0) {
          lines.push(`Available (${available.length}):`);
          for (const skill of available.slice(0, 20)) {
            lines.push(`    ${skill.name} (${skill.repo})`);
            lines.push(`    ${skill.description}`);
          }
          if (available.length > 20) {
            lines.push(`  ... and ${available.length - 20} more`);
          }
          lines.push("");
        }

        lines.push("Commands:");
        lines.push("  /marketplace search <query> - Search skills");
        lines.push("  /marketplace install <id>   - Install a skill");
        lines.push("  /marketplace uninstall <id> - Uninstall a skill");
        lines.push("  /marketplace update           - Refresh cache");
        lines.push("  /marketplace list             - List all skills");

        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      // Interactive mode
      const skills = await getSkills();
      if (skills.length === 0) {
        ctx.ui.notify("Skills cache is empty.\n\nRun: /marketplace update\n\nThis will clone skill repositories and index all available skills.", "info");
        return;
      }

      const installed = skills.filter((s) => s.installed);
      const available = skills.filter((s) => !s.installed);

      const choice = await ctx.ui.select(
        `Skills Marketplace (${installed.length} installed, ${available.length} available)`,
        [
          "Browse available skills",
          "View installed skills",
          "Search skills",
          "Update cache",
          "Cancel",
        ]
      );

      if (!choice || choice === "Cancel") return;

      if (choice === "Update cache") {
        ctx.ui.notify("Updating skills cache...", "info");
        const result = await updateCache(pi);
        invalidateCache();
        ctx.ui.notify(
          `Cache updated: ${result.success} repos succeeded, ${result.failed} failed.`,
          result.failed === 0 ? "success" : "info"
        );
        return;
      }

      if (choice === "View installed skills") {
        if (installed.length === 0) {
          ctx.ui.notify("No skills installed yet.", "info");
          return;
        }
        const skillNames = installed.map((s) => `${s.name} (${s.repo})`);
        const selected = await ctx.ui.select("Installed skills (select to uninstall):", [...skillNames, "Back"]);
        if (!selected || selected === "Back") return;
        const idx = skillNames.indexOf(selected);
        if (idx >= 0) {
          const skill = installed[idx];
          const confirm = await ctx.ui.confirm(`Uninstall '${skill.name}'?`, "This will remove the skill from your installation.");
          if (confirm) {
            const ok = await uninstallSkill(pi, skill);
            if (ok) {
              ctx.ui.notify(`✓ Uninstalled '${skill.name}'`, "success");
              invalidateCache();
            } else {
              ctx.ui.notify(`✗ Failed to uninstall '${skill.name}'`, "error");
            }
          }
        }
        return;
      }

      if (choice === "Search skills") {
        const query = await ctx.ui.input("Search skills:", "");
        if (!query?.trim()) return;
        const filtered = filterSkills(skills, query);
        if (filtered.length === 0) {
          ctx.ui.notify(`No skills found for '${query}'.`, "info");
          return;
        }
        const skillNames = filtered.map((s) => {
          const status = s.installed ? "✓" : " ";
          return `${status} ${s.name} (${skill.repo})`;
        });
        const selected = await ctx.ui.select(`Search results (${filtered.length}):`, [...skillNames, "Back"]);
        if (!selected || selected === "Back") return;
        const idx = skillNames.indexOf(selected);
        if (idx >= 0) {
          const skill = filtered[idx];
          await showSkillDetail(skill, ctx);
        }
        return;
      }

      if (choice === "Browse available skills") {
        if (available.length === 0) {
          ctx.ui.notify("All available skills are already installed!", "info");
          return;
        }
        await browseSkills(available, ctx);
      }
    },
  });
}

async function showSkillDetail(skill: SkillEntry, ctx: ExtensionContext): Promise<void> {
  const skillMdPath = path.join(skill.cachePath, "SKILL.md");
  let preview = "";
  try {
    const content = await fs.readFile(skillMdPath, "utf8");
    const lines = content.split("\n").slice(0, 15);
    preview = lines.join("\n");
  } catch {
    preview = "Could not read skill details.";
  }

  const tags = skill.tags?.length ? `\nTags: ${skill.tags.join(", ")}` : "";
  const info = `Skill: ${skill.name}
Repository: ${skill.repo}
URL: ${skill.repoUrl}
Status: ${skill.installed ? "Installed" : "Not installed"}${tags}

Preview:
${preview}`;

  const actions = skill.installed
    ? ["Uninstall", "Back"]
    : ["Install", "Back"];

  const action = await ctx.ui.select(info, actions);

  if (action === "Install") {
    const ok = await installSkill(pi, skill);
    if (ok) {
      ctx.ui.notify(`✓ Installed '${skill.name}'\nRestart pi or run /reload to activate.`, "success");
    } else {
      ctx.ui.notify(`✗ Failed to install '${skill.name}'`, "error");
    }
  } else if (action === "Uninstall") {
    const confirm = await ctx.ui.confirm(`Uninstall '${skill.name}'?`, "This will remove the skill.");
    if (confirm) {
      const ok = await uninstallSkill(pi, skill);
      if (ok) {
        ctx.ui.notify(`✓ Uninstalled '${skill.name}'`, "success");
      } else {
        ctx.ui.notify(`✗ Failed to uninstall '${skill.name}'`, "error");
      }
    }
  }
}

async function browseSkills(skills: SkillEntry[], ctx: ExtensionContext): Promise<void> {
  const pageSize = 15;
  let page = 0;

  while (true) {
    const start = page * pageSize;
    const end = Math.min(start + pageSize, skills.length);
    const pageSkills = skills.slice(start, end);

    const skillNames = pageSkills.map((s) => `${s.name} (${s.repo})`);
    const navItems: string[] = [];

    if (page > 0) navItems.push("← Previous page");
    navItems.push(...skillNames);
    if (end < skills.length) navItems.push("Next page →");
    navItems.push("Back");

    const title = `Browse Skills (page ${page + 1}/${Math.ceil(skills.length / pageSize)})`;
    const selected = await ctx.ui.select(title, navItems);

    if (!selected || selected === "Back") break;

    if (selected === "← Previous page") {
      page--;
      continue;
    }

    if (selected === "Next page →") {
      page++;
      continue;
    }

    const idx = navItems.indexOf(selected) - (page > 0 ? 1 : 0);
    if (idx >= 0 && idx < pageSkills.length) {
      const skill = pageSkills[idx];
      await showSkillDetail(skill, ctx);
    }
  }
}

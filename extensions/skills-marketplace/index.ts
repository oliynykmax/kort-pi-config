import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.env.HOME || "~", ".pi/agent/skills-cache");
const SKILLS_DIR = path.join(process.env.HOME || "~", ".pi/agent/skills");

interface SkillRepo {
  name: string;
  url: string;
  description: string;
  adapter: "flat" | "domain-nested" | "plugin-nested" | "openai-curated";
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
  category?: string;
}

const KNOWN_REPOS: SkillRepo[] = [
  {
    name: "pi-skills",
    url: "https://github.com/badlogic/pi-skills",
    description: "Official pi skills by Mario Zechner",
    adapter: "flat",
  },
  {
    name: "agent-skills-hub",
    url: "https://github.com/agent-skills-hub/agent-skills-hub",
    description: "Cross-platform agent skills hub",
    adapter: "flat",
  },
  {
    name: "agent-stuff",
    url: "https://github.com/mitsuhiko/agent-stuff",
    description: "Skills and extensions by mitsuhiko",
    adapter: "flat",
  },
  {
    name: "pi-amplike",
    url: "https://github.com/pasky/pi-amplike",
    description: "Pi skills for web search and extraction",
    adapter: "flat",
  },
  {
    name: "claude-skills",
    url: "https://github.com/alirezarezvani/claude-skills",
    description: "220+ engineering, marketing, product, and advisory skills",
    adapter: "domain-nested",
  },
  {
    name: "openai-skills",
    url: "https://github.com/openai/skills",
    description: "Official OpenAI curated skills for Codex",
    adapter: "openai-curated",
  },
  {
    name: "jezweb-skills",
    url: "https://github.com/jezweb/claude-skills",
    description: "60+ Cloudflare, frontend, integrations, and dev-tools skills",
    adapter: "plugin-nested",
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

async function rewriteSkillContent(skillDir: string): Promise<void> {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  try {
    let content = await fs.readFile(skillMdPath, "utf8");
    const replacements: [RegExp, string][] = [
      [/Claude Code/g, "pi agent"],
      [/Claude/g, "pi agent"],
      [/Codex CLI/g, "pi agent"],
      [/Codex/g, "pi agent"],
      [/codex/g, "pi agent"],
      [/claude code/g, "pi agent"],
      [/claude/g, "pi agent"],
      [/~\/\.claude\/skills/g, "~/.pi/agent/skills"],
      [/~\/\.codex\/skills/g, "~/.pi/agent/skills"],
      [/\.claude\/skills/g, ".pi/agent/skills"],
      [/\.codex\/skills/g, ".pi/agent/skills"],
    ];
    let changed = false;
    for (const [pattern, replacement] of replacements) {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        changed = true;
      }
    }
    if (changed) {
      await fs.writeFile(skillMdPath, content, "utf8");
    }
  } catch {
    // Ignore errors rewriting content
  }
}

async function makeSkillEntry(repoName: string, repoUrl: string, skillDir: string, entryName: string, category?: string): Promise<SkillEntry | null> {
  const meta = await parseSkillMetadata(skillDir);
  if (!meta) return null;
  const installPath = path.join(SKILLS_DIR, entryName);
  const installed = await fs.access(installPath).then(() => true).catch(() => false);
  return {
    id: `${repoName}/${category ? category + "/" : ""}${entryName}`,
    name: meta.name,
    description: meta.description,
    repo: repoName,
    repoUrl,
    cachePath: skillDir,
    installed,
    installPath: installed ? installPath : undefined,
    tags: meta.tags,
    category,
  };
}

async function discoverFlatSkills(repoDir: string, repoName: string, repoUrl: string): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  try {
    const entries = await fs.readdir(repoDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillPath = path.join(repoDir, entry.name);
      const hasSkillMd = await fs.access(path.join(skillPath, "SKILL.md")).then(() => true).catch(() => false);
      if (!hasSkillMd) continue;
      await rewriteSkillContent(skillPath);
      const skill = await makeSkillEntry(repoName, repoUrl, skillPath, entry.name);
      if (skill) skills.push(skill);
    }
  } catch { /* ignore */ }
  return skills;
}

async function discoverDomainNestedSkills(repoDir: string, repoName: string, repoUrl: string): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  const domainDirs = ["engineering", "engineering-team", "product-team", "marketing-skill", "project-management", "ra-qm-team", "c-level-advisor", "business-growth", "finance"];
  for (const domain of domainDirs) {
    const domainPath = path.join(repoDir, domain);
    const exists = await fs.access(domainPath).then(() => true).catch(() => false);
    if (!exists) continue;
    try {
      const entries = await fs.readdir(domainPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const skillPath = path.join(domainPath, entry.name);
        const hasSkillMd = await fs.access(path.join(skillPath, "SKILL.md")).then(() => true).catch(() => false);
        if (!hasSkillMd) continue;
        await rewriteSkillContent(skillPath);
        const skill = await makeSkillEntry(repoName, repoUrl, skillPath, entry.name, domain);
        if (skill) skills.push(skill);
      }
    } catch { /* ignore */ }
  }
  return skills;
}

async function discoverOpenAICuratedSkills(repoDir: string, repoName: string, repoUrl: string): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  const categories = ["skills/.curated", "skills/.system"];
  for (const cat of categories) {
    const catPath = path.join(repoDir, cat);
    const exists = await fs.access(catPath).then(() => true).catch(() => false);
    if (!exists) continue;
    try {
      const entries = await fs.readdir(catPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const skillPath = path.join(catPath, entry.name);
        const hasSkillMd = await fs.access(path.join(skillPath, "SKILL.md")).then(() => true).catch(() => false);
        if (!hasSkillMd) continue;
        await rewriteSkillContent(skillPath);
        const catLabel = cat.replace("skills/", "");
        const skill = await makeSkillEntry(repoName, repoUrl, skillPath, entry.name, catLabel);
        if (skill) skills.push(skill);
      }
    } catch { /* ignore */ }
  }
  return skills;
}

async function discoverPluginNestedSkills(repoDir: string, repoName: string, repoUrl: string): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];
  const pluginsDir = path.join(repoDir, "plugins");
  const exists = await fs.access(pluginsDir).then(() => true).catch(() => false);
  if (!exists) return skills;
  try {
    const plugins = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const plugin of plugins) {
      if (!plugin.isDirectory() || plugin.name.startsWith(".")) continue;
      const skillsDir = path.join(pluginsDir, plugin.name, "skills");
      const skillsExists = await fs.access(skillsDir).then(() => true).catch(() => false);
      if (!skillsExists) continue;
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const skillPath = path.join(skillsDir, entry.name);
        const hasSkillMd = await fs.access(path.join(skillPath, "SKILL.md")).then(() => true).catch(() => false);
        if (!hasSkillMd) continue;
        await rewriteSkillContent(skillPath);
        const skill = await makeSkillEntry(repoName, repoUrl, skillPath, entry.name, plugin.name);
        if (skill) skills.push(skill);
      }
    }
  } catch { /* ignore */ }
  return skills;
}

async function discoverSkillsInRepo(repo: SkillRepo): Promise<SkillEntry[]> {
  const repoDir = path.join(CACHE_DIR, repo.name);
  const exists = await fs.access(repoDir).then(() => true).catch(() => false);
  if (!exists) return [];
  switch (repo.adapter) {
    case "domain-nested":
      return discoverDomainNestedSkills(repoDir, repo.name, repo.url);
    case "openai-curated":
      return discoverOpenAICuratedSkills(repoDir, repo.name, repo.url);
    case "plugin-nested":
      return discoverPluginNestedSkills(repoDir, repo.name, repo.url);
    default:
      return discoverFlatSkills(repoDir, repo.name, repo.url);
  }
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
    const skills = await discoverSkillsInRepo(repo);
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

function fuzzyScore(text: string, query: string): number {
  let score = 0;
  let textIdx = 0;
  for (let i = 0; i < query.length; i++) {
    const found = text.indexOf(query[i], textIdx);
    if (found === -1) return 0;
    score += found === textIdx ? 2 : 1;
    textIdx = found + 1;
  }
  return score;
}

function filterSkills(skills: SkillEntry[], query: string): SkillEntry[] {
  if (!query.trim()) return skills;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = skills
    .map((skill) => {
      const searchable = [
        { text: skill.name.toLowerCase(), weight: 10 },
        { text: skill.repo.toLowerCase(), weight: 5 },
        { text: skill.description.toLowerCase(), weight: 2 },
        ...(skill.tags?.map((t) => ({ text: t.toLowerCase(), weight: 3 })) || []),
        ...(skill.category ? [{ text: skill.category.toLowerCase(), weight: 4 }] : []),
      ];
      let totalScore = 0;
      for (const word of words) {
        let wordMatched = false;
        for (const field of searchable) {
          const s = fuzzyScore(field.text, word);
          if (s > 0) {
            totalScore += s * field.weight;
            wordMatched = true;
          }
        }
        if (!wordMatched) return { skill, score: 0 };
      }
      return { skill, score: totalScore };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.skill);
  return scored;
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
        const skill = skills.find((s) => s.id === skillName || s.name.toLowerCase() === skillName.toLowerCase());
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
        const skill = skills.find((s) => s.id === skillName || s.name.toLowerCase() === skillName.toLowerCase());
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
          const cat = skill.category ? `/${skill.category}` : "";
          lines.push(`${status} ${skill.name} (${skill.repo}${cat})`);
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
        ["Browse available skills", "View installed skills", "Search skills", "Update cache", "Cancel"]
      );
      if (!choice || choice === "Cancel") return;
      if (choice === "Update cache") {
        ctx.ui.notify("Updating skills cache...", "info");
        const result = await updateCache(pi);
        invalidateCache();
        ctx.ui.notify(`Cache updated: ${result.success} repos succeeded, ${result.failed} failed.`, result.failed === 0 ? "success" : "info");
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
          return `${status} ${s.name} (${s.repo})`;
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
  const cat = skill.category ? `\nCategory: ${skill.category}` : "";
  const info = `Skill: ${skill.name}\nRepository: ${skill.repo}\nURL: ${skill.repoUrl}\nStatus: ${skill.installed ? "Installed" : "Not installed"}${cat}${tags}\n\nPreview:\n${preview}`;
  const actions = skill.installed ? ["Uninstall", "Back"] : ["Install", "Back"];
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
    if (selected === "← Previous page") { page--; continue; }
    if (selected === "Next page →") { page++; continue; }
    const idx = navItems.indexOf(selected) - (page > 0 ? 1 : 0);
    if (idx >= 0 && idx < pageSkills.length) {
      const skill = pageSkills[idx];
      await showSkillDetail(skill, ctx);
    }
  }
}

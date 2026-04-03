import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";

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
  { name: "pi-skills", url: "https://github.com/badlogic/pi-skills", description: "Official pi skills by Mario Zechner", adapter: "flat" },
  { name: "agent-skills-hub", url: "https://github.com/agent-skills-hub/agent-skills-hub", description: "Cross-platform agent skills hub", adapter: "flat" },
  { name: "agent-stuff", url: "https://github.com/mitsuhiko/agent-stuff", description: "Skills and extensions by mitsuhiko", adapter: "flat" },
  { name: "pi-amplike", url: "https://github.com/pasky/pi-amplike", description: "Pi skills for web search and extraction", adapter: "flat" },
  { name: "claude-skills", url: "https://github.com/alirezarezvani/claude-skills", description: "220+ engineering, marketing, product, and advisory skills", adapter: "domain-nested" },
  { name: "openai-skills", url: "https://github.com/openai/skills", description: "Official OpenAI curated skills for Codex", adapter: "openai-curated" },
  { name: "jezweb-skills", url: "https://github.com/jezweb/claude-skills", description: "60+ Cloudflare, frontend, integrations, and dev-tools skills", adapter: "plugin-nested" },
];

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function cloneOrUpdateRepo(pi: ExtensionAPI, repo: SkillRepo): Promise<boolean> {
  const repoDir = path.join(CACHE_DIR, repo.name);
  const exists = await fs.access(path.join(repoDir, ".git")).then(() => true).catch(() => false);
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
  } catch { /* ignore */ }
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
    case "domain-nested": return discoverDomainNestedSkills(repoDir, repo.name, repo.url);
    case "openai-curated": return discoverOpenAICuratedSkills(repoDir, repo.name, repo.url);
    case "plugin-nested": return discoverPluginNestedSkills(repoDir, repo.name, repo.url);
    default: return discoverFlatSkills(repoDir, repo.name, repo.url);
  }
}

async function loadAllSkills(): Promise<SkillEntry[]> {
  const allSkills: SkillEntry[] = [];
  for (const repo of KNOWN_REPOS) {
    const skills = await discoverSkillsInRepo(repo);
    allSkills.push(...skills);
  }
  return allSkills;
}

// Fuzzy matching — fzf-style algorithm
function fuzzyMatch(text: string, pattern: string): { score: number; positions: number[] } | null {
  if (!pattern) return { score: 0, positions: [] };
  const textLen = text.length;
  const patternLen = pattern.length;
  if (patternLen === 0) return { score: 0, positions: [] };
  if (patternLen > textLen) return null;

  const textLower = text.toLowerCase();
  const patternLower = pattern.toLowerCase();

  // Check if all characters exist in order
  let ti = 0;
  const positions: number[] = [];
  for (let pi = 0; pi < patternLen; pi++) {
    const found = textLower.indexOf(patternLower[pi], ti);
    if (found === -1) return null;
    positions.push(found);
    ti = found + 1;
  }

  // Score: consecutive matches, start of word, start of text
  let score = 0;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    // Consecutive bonus
    if (i > 0 && pos === positions[i - 1] + 1) {
      score += 3;
    }
    // Start of word bonus (after space, hyphen, underscore, slash, or uppercase)
    if (pos === 0) {
      score += 5;
    } else {
      const prev = text[pos - 1];
      if (prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ".") {
        score += 4;
      } else if (text[pos] >= "A" && text[pos] <= "Z" && text[pos - 1] >= "a" && text[pos - 1] <= "z") {
        score += 3;
      }
    }
    // Exact case match bonus
    if (text[pos] === patternLower[i]) {
      score += 1;
    }
  }

  // Penalize gaps
  const firstGap = positions[0];
  score -= firstGap;
  if (positions.length > 1) {
    const lastGap = positions[positions.length - 1] - positions[0] - positions.length + 1;
    score -= lastGap * 0.5;
  }

  return { score, positions };
}

function fuzzySearchSkills(skills: SkillEntry[], query: string): SkillEntry[] {
  if (!query.trim()) return skills;
  const words = query.trim().split(/\s+/).filter(Boolean);

  const scored = skills
    .map((skill) => {
      const searchFields = [
        { text: skill.name, weight: 20 },
        { text: skill.category || "", weight: 10 },
        { text: skill.repo, weight: 8 },
        { text: skill.description, weight: 3 },
        ...(skill.tags?.map((t) => ({ text: t, weight: 5 })) || []),
      ];

      let totalScore = 0;
      let allWordsMatched = true;

      for (const word of words) {
        let bestWordScore = -Infinity;
        for (const field of searchFields) {
          if (!field.text) continue;
          const result = fuzzyMatch(field.text, word);
          if (result && result.score * field.weight > bestWordScore) {
            bestWordScore = result.score * field.weight;
          }
        }
        if (bestWordScore === -Infinity) {
          allWordsMatched = false;
          break;
        }
        totalScore += bestWordScore;
      }

      return allWordsMatched ? { skill, score: totalScore } : null;
    })
    .filter((x): x is { skill: SkillEntry; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.skill);

  return scored;
}

// TUI Component for fuzzy search
class MarketplaceSearchComponent {
  private skills: SkillEntry[];
  private theme: Theme;
  private onDone: (action: "install" | "uninstall" | "cancel", skill?: SkillEntry) => void;
  private pi: ExtensionAPI;
  private query = "";
  private cursorPos = 0;
  private selectedIndex = 0;
  private scrollOffset = 0;
  private filteredSkills: SkillEntry[] = [];
  private mode: "search" | "detail" | "confirm" = "search";
  private detailSkill: SkillEntry | null = null;
  private detailPreview: string = "";
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(skills: SkillEntry[], theme: Theme, pi: ExtensionAPI, onDone: (action: "install" | "uninstall" | "cancel", skill?: SkillEntry) => void) {
    this.skills = skills;
    this.theme = theme;
    this.pi = pi;
    this.onDone = onDone;
    this.filteredSkills = skills;
  }

  handleInput(data: string): void {
    if (this.mode === "confirm") {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
        this.mode = "search";
        this.invalidate();
        return;
      }
      if (matchesKey(data, "enter")) {
        if (this.detailSkill) {
          const action = this.detailSkill.installed ? "uninstall" : "install";
          this.onDone(action, this.detailSkill);
        }
        return;
      }
      return;
    }

    if (this.mode === "detail") {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
        this.mode = "search";
        this.detailSkill = null;
        this.invalidate();
        return;
      }
      if (matchesKey(data, "enter")) {
        if (this.detailSkill) {
          const action = this.detailSkill.installed ? "uninstall" : "install";
          this.onDone(action, this.detailSkill);
        }
        return;
      }
      return;
    }

    // Search mode
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onDone("cancel");
      return;
    }

    if (matchesKey(data, "enter")) {
      if (this.filteredSkills.length > 0 && this.selectedIndex < this.filteredSkills.length) {
        const skill = this.filteredSkills[this.selectedIndex];
        this.mode = "detail";
        this.detailSkill = skill;
        this.loadPreview(skill);
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        if (this.selectedIndex < this.scrollOffset) {
          this.scrollOffset = this.selectedIndex;
        }
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
      if (this.selectedIndex < this.filteredSkills.length - 1) {
        this.selectedIndex++;
        if (this.selectedIndex >= this.scrollOffset + 10) {
          this.scrollOffset = this.selectedIndex - 9;
        }
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, "tab")) {
      // Auto-complete from top result
      if (this.filteredSkills.length > 0) {
        const top = this.filteredSkills[0];
        const remaining = top.name.slice(this.cursorPos);
        if (remaining) {
          this.query = this.query.slice(0, this.cursorPos) + remaining + this.query.slice(this.cursorPos);
          this.cursorPos += remaining.length;
          this.doFilter();
          this.invalidate();
        }
      }
      return;
    }

    if (matchesKey(data, "backspace") || data === "\x7f") {
      if (this.cursorPos > 0) {
        this.query = this.query.slice(0, this.cursorPos - 1) + this.query.slice(this.cursorPos);
        this.cursorPos--;
        this.doFilter();
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, "left")) {
      if (this.cursorPos > 0) {
        this.cursorPos--;
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, "right")) {
      if (this.cursorPos < this.query.length) {
        this.cursorPos++;
        this.invalidate();
      }
      return;
    }

    if (matchesKey(data, "ctrl+u")) {
      this.query = "";
      this.cursorPos = 0;
      this.doFilter();
      this.invalidate();
      return;
    }

    if (matchesKey(data, "ctrl+w")) {
      const before = this.query.slice(0, this.cursorPos);
      const trimmed = before.trimEnd();
      const wordStart = trimmed.lastIndexOf(" ");
      const newCursorPos = wordStart === -1 ? 0 : wordStart + 1;
      this.query = this.query.slice(0, newCursorPos) + this.query.slice(this.cursorPos);
      this.cursorPos = newCursorPos;
      this.doFilter();
      this.invalidate();
      return;
    }

    // Regular character input
    if (data.length === 1 && data >= " ") {
      this.query = this.query.slice(0, this.cursorPos) + data + this.query.slice(this.cursorPos);
      this.cursorPos++;
      this.doFilter();
      this.invalidate();
    }
  }

  private doFilter(): void {
    this.filteredSkills = fuzzySearchSkills(this.skills, this.query);
    this.selectedIndex = Math.min(this.selectedIndex, this.filteredSkills.length - 1);
    if (this.selectedIndex < 0) this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  private async loadPreview(skill: SkillEntry): Promise<void> {
    try {
      const content = await fs.readFile(path.join(skill.cachePath, "SKILL.md"), "utf8");
      this.detailPreview = content.split("\n").slice(0, 20).join("\n");
    } catch {
      this.detailPreview = "Could not read skill details.";
    }
    this.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;

    if (this.mode === "detail" && this.detailSkill) {
      return this.renderDetail(width, th);
    }

    if (this.mode === "confirm" && this.detailSkill) {
      return this.renderConfirm(width, th);
    }

    // Header
    lines.push("");
    lines.push(truncateToWidth(th.fg("accent", " Skills Marketplace ") + th.fg("dim", ` — ${this.skills.length} skills total`), width));
    lines.push("");

    // Search bar
    const prompt = th.fg("accent", "❯ ");
    const beforeCursor = th.fg("text", this.query.slice(0, this.cursorPos));
    const afterCursor = th.fg("dim", this.query.slice(this.cursorPos));
    const cursor = th.fg("accent", th.bold(this.query[this.cursorPos] || " "));
    const searchBar = prompt + beforeCursor + cursor + afterCursor;
    lines.push(truncateToWidth(searchBar, width));

    // Results count
    if (this.query) {
      lines.push(th.fg("dim", `${this.filteredSkills.length} match${this.filteredSkills.length !== 1 ? "es" : ""} — ↑↓ navigate, Enter select, Tab complete, Esc quit`));
    } else {
      lines.push(th.fg("dim", `${this.filteredSkills.length} skills — Type to search, ↑↓ navigate, Enter select, Tab complete, Esc quit`));
    }
    lines.push("");

    // Results list
    const visibleCount = Math.min(12, this.filteredSkills.length);
    const startIdx = this.scrollOffset;
    const endIdx = Math.min(startIdx + visibleCount, this.filteredSkills.length);

    for (let i = startIdx; i < endIdx; i++) {
      const skill = this.filteredSkills[i];
      const isSelected = i === this.selectedIndex;
      const status = skill.installed ? th.fg("success", "✓") : th.fg("dim", "○");
      const arrow = isSelected ? th.fg("accent", "▸ ") : "  ";
      const name = isSelected ? th.fg("accent", th.bold(skill.name)) : th.fg("text", skill.name);
      const repo = th.fg("muted", `(${skill.repo}${skill.category ? "/" + skill.category : ""})`);
      const desc = th.fg("dim", skill.description);

      lines.push(truncateToWidth(arrow + status + " " + name + " " + repo, width));
      lines.push(truncateToWidth("    " + desc, width));
      lines.push("");
    }

    if (this.filteredSkills.length === 0 && this.query) {
      lines.push(th.fg("dim", "  No matches found. Try different keywords."));
      lines.push("");
    }

    lines.push(th.fg("dim", "  Press Escape to exit"));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private renderDetail(width: number, th: Theme): string[] {
    const lines: string[] = [];
    const skill = this.detailSkill!;

    lines.push("");
    lines.push(truncateToWidth(th.fg("accent", th.bold(` ${skill.name} `)), width));
    lines.push(th.fg("muted", `  ${skill.repo}${skill.category ? "/" + skill.category : ""}  •  ${skill.installed ? th.fg("success", "Installed") : "Not installed"}`));
    lines.push("");

    if (skill.tags?.length) {
      lines.push(th.fg("dim", `  Tags: ${skill.tags.join(", ")}`));
      lines.push("");
    }

    // Preview
    const previewLines = this.detailPreview.split("\n").slice(0, 15);
    for (const line of previewLines) {
      lines.push(truncateToWidth(th.fg("muted", "  " + line), width));
    }

    lines.push("");
    const action = skill.installed ? th.fg("warning", "Uninstall") : th.fg("success", "Install");
    lines.push(th.fg("dim", `  Press Enter to ${action.toLowerCase()} • Esc to go back`));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private renderConfirm(width: number, th: Theme): string[] {
    const lines: string[] = [];
    const skill = this.detailSkill!;
    const action = skill.installed ? "uninstall" : "install";

    lines.push("");
    lines.push(truncateToWidth(th.fg("warning", th.bold(` Confirm ${action} `)), width));
    lines.push("");
    lines.push(truncateToWidth(th.fg("text", `  ${skill.name} (${skill.repo})`), width));
    lines.push("");
    lines.push(th.fg("dim", `  Press Enter to confirm • Esc to cancel`));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
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

  async function updateCache(): Promise<{ success: number; failed: number }> {
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

  pi.registerCommand("marketplace", {
    description: "Browse, search, and install skills from multiple repositories",
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmedArgs = args.trim();

      if (trimmedArgs === "update") {
        ctx.ui.notify("Updating skills cache...", "info");
        const result = await updateCache();
        invalidateCache();
        ctx.ui.notify(`Cache updated: ${result.success} repos succeeded, ${result.failed} failed.\nRestart pi or run /reload to see new skills.`, result.failed === 0 ? "success" : "info");
        return;
      }

      if (trimmedArgs.startsWith("install ")) {
        const skillName = trimmedArgs.slice(8).trim();
        const skills = await getSkills();
        const skill = skills.find((s) => s.id === skillName || s.name.toLowerCase() === skillName.toLowerCase());
        if (!skill) { ctx.ui.notify(`Skill '${skillName}' not found. Run /marketplace update first.`, "error"); return; }
        if (skill.installed) { ctx.ui.notify(`Skill '${skill.name}' is already installed.`, "info"); return; }
        ctx.ui.notify(`Installing '${skill.name}'...`, "info");
        const targetPath = path.join(SKILLS_DIR, path.basename(skill.cachePath));
        await ensureDir(SKILLS_DIR);
        const result = await pi.exec("cp", ["-r", skill.cachePath, targetPath], { timeout: 10000 });
        if (result.code === 0) { ctx.ui.notify(`✓ Installed '${skill.name}'\nRestart pi or run /reload to activate.`, "success"); invalidateCache(); }
        else { ctx.ui.notify(`✗ Failed to install '${skill.name}'`, "error"); }
        return;
      }

      if (trimmedArgs.startsWith("uninstall ")) {
        const skillName = trimmedArgs.slice(10).trim();
        const skills = await getSkills();
        const skill = skills.find((s) => s.id === skillName || s.name.toLowerCase() === skillName.toLowerCase());
        if (!skill || !skill.installPath) { ctx.ui.notify(`Skill '${skillName}' is not installed.`, "error"); return; }
        ctx.ui.notify(`Uninstalling '${skill.name}'...`, "info");
        const result = await pi.exec("rm", ["-rf", skill.installPath], { timeout: 10000 });
        if (result.code === 0) { ctx.ui.notify(`✓ Uninstalled '${skill.name}'`, "success"); invalidateCache(); }
        else { ctx.ui.notify(`✗ Failed to uninstall '${skill.name}'`, "error"); }
        return;
      }

      if (trimmedArgs === "list") {
        const skills = await getSkills();
        const installed = skills.filter((s) => s.installed);
        const available = skills.filter((s) => !s.installed);
        const lines = ["Skills Marketplace", ""];
        if (installed.length > 0) { lines.push("Installed:"); for (const s of installed) lines.push(`  ✓ ${s.name} (${s.repo})`); lines.push(""); }
        if (available.length > 0) { lines.push(`Available (${available.length}):`); for (const s of available.slice(0, 20)) { lines.push(`    ${s.name} (${s.repo})`); lines.push(`    ${s.description}`); } if (available.length > 20) lines.push(`  ... and ${available.length - 20} more`); lines.push(""); }
        lines.push("Commands:");
        lines.push("  /marketplace              - Interactive fuzzy search");
        lines.push("  /marketplace search <q>   - Search skills");
        lines.push("  /marketplace install <id> - Install a skill");
        lines.push("  /marketplace uninstall <id> - Uninstall a skill");
        lines.push("  /marketplace update       - Refresh cache");
        lines.push("  /marketplace list         - List all skills");
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      // Interactive fuzzy search
      const skills = await getSkills();
      if (skills.length === 0) {
        ctx.ui.notify("Skills cache is empty.\n\nRun: /marketplace update\n\nThis will clone skill repositories and index all available skills.", "info");
        return;
      }

      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        return new MarketplaceSearchComponent(skills, theme, pi, async (action, skill) => {
          if (action === "cancel") {
            done();
            return;
          }

          if (skill) {
            const targetPath = path.join(SKILLS_DIR, path.basename(skill.cachePath));
            await ensureDir(SKILLS_DIR);

            if (action === "install") {
              ctx.ui.notify(`Installing '${skill.name}'...`, "info");
              const result = await pi.exec("cp", ["-r", skill.cachePath, targetPath], { timeout: 10000 });
              if (result.code === 0) {
                ctx.ui.notify(`✓ Installed '${skill.name}'\nRestart pi or run /reload to activate.`, "success");
                invalidateCache();
              } else {
                ctx.ui.notify(`✗ Failed to install '${skill.name}'`, "error");
              }
            } else if (action === "uninstall" && skill.installPath) {
              ctx.ui.notify(`Uninstalling '${skill.name}'...`, "info");
              const result = await pi.exec("rm", ["-rf", skill.installPath], { timeout: 10000 });
              if (result.code === 0) {
                ctx.ui.notify(`✓ Uninstalled '${skill.name}'`, "success");
                invalidateCache();
              } else {
                ctx.ui.notify(`✗ Failed to uninstall '${skill.name}'`, "error");
              }
            }
          }
          done();
        });
      });
    },
  });
}

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";

interface RepoFacts {
  root: string;
  repoName: string;
  packageManager?: string;
  languageStack: string[];
  testCommand?: string;
  buildCommand?: string;
  devCommand?: string;
  ciDetected: boolean;
  monorepo: boolean;
  notes: string[];
}

export default function initAgentsExtension(pi: ExtensionAPI) {
  const run = async (ctx: ExtensionContext) => {
    const facts = await inspectRepo(pi, ctx);
    const answers = await askMissingBits(ctx, facts);

    const agentsPath = path.join(facts.root, "AGENTS.md");
    const exists = await fileExists(agentsPath);

    if (exists) {
      const action = await ctx.ui.select("AGENTS.md already exists", [
        "Overwrite",
        "Cancel",
      ]);
      if (action !== "Overwrite") {
        ctx.ui.notify("Init cancelled", "info");
        return;
      }
    }

    const doc = renderAgentsMd(facts, answers);
    await fs.writeFile(agentsPath, doc, "utf8");
    ctx.ui.notify(`Created ${agentsPath}`, "info");
  };

  // Primary command: intended to replace /init workflow.
  pi.registerCommand("init", {
    description: "Guided AGENTS.md setup from repository context",
    handler: async (_args, ctx) => run(ctx),
  });

  // Fallback alias in case /init is reserved by host behavior.
  pi.registerCommand("init-agents", {
    description: "Guided AGENTS.md setup from repository context",
    handler: async (_args, ctx) => run(ctx),
  });
}

async function inspectRepo(pi: ExtensionAPI, ctx: ExtensionContext): Promise<RepoFacts> {
  const root = await getRepoRoot(pi, ctx.cwd);
  const repoName = path.basename(root);

  const facts: RepoFacts = {
    root,
    repoName,
    languageStack: [],
    ciDetected: false,
    monorepo: false,
    notes: [],
  };

  const [packageJson, pyproject, cargoToml, goMod, gradle, pom, makefile] = await Promise.all([
    readIfExists(path.join(root, "package.json")),
    readIfExists(path.join(root, "pyproject.toml")),
    readIfExists(path.join(root, "Cargo.toml")),
    readIfExists(path.join(root, "go.mod")),
    readIfExists(path.join(root, "build.gradle")),
    readIfExists(path.join(root, "pom.xml")),
    readIfExists(path.join(root, "Makefile")),
  ]);

  if (packageJson) {
    facts.languageStack.push("JavaScript/TypeScript");
    parsePackageJson(packageJson, facts);
  }
  if (pyproject) facts.languageStack.push("Python");
  if (cargoToml) facts.languageStack.push("Rust");
  if (goMod) facts.languageStack.push("Go");
  if (gradle || pom) facts.languageStack.push("Java/JVM");

  if (makefile && !facts.testCommand) {
    facts.testCommand = "make test";
  }

  facts.ciDetected =
    (await fileExists(path.join(root, ".github", "workflows"))) ||
    (await fileExists(path.join(root, ".gitlab-ci.yml"))) ||
    (await fileExists(path.join(root, "azure-pipelines.yml")));

  facts.monorepo =
    (await fileExists(path.join(root, "pnpm-workspace.yaml"))) ||
    (await fileExists(path.join(root, "turbo.json"))) ||
    (await fileExists(path.join(root, "nx.json")));

  if (await fileExists(path.join(root, "prisma", "schema.prisma"))) {
    facts.notes.push("Uses Prisma schema at prisma/schema.prisma");
  }
  if (await fileExists(path.join(root, "docker-compose.yml"))) {
    facts.notes.push("Has docker-compose.yml");
  }

  return facts;
}

function parsePackageJson(content: string, facts: RepoFacts): void {
  try {
    const pkg = JSON.parse(content) as {
      scripts?: Record<string, string>;
      packageManager?: string;
      name?: string;
      private?: boolean;
    };

    const scripts = pkg.scripts ?? {};
    facts.testCommand = scripts.test ? "npm test" : facts.testCommand;
    facts.buildCommand = scripts.build ? "npm run build" : facts.buildCommand;
    facts.devCommand = scripts.dev ? "npm run dev" : scripts.start ? "npm start" : facts.devCommand;

    if (pkg.packageManager) {
      facts.packageManager = pkg.packageManager.split("@")[0];
    }

    if (scripts.test?.includes("vitest")) facts.notes.push("Tests use Vitest");
    if (scripts.test?.includes("jest")) facts.notes.push("Tests use Jest");
    if (scripts.dev?.includes("next")) facts.notes.push("App likely uses Next.js");
  } catch {
    // Ignore malformed package.json.
  }
}

async function askMissingBits(ctx: ExtensionContext, facts: RepoFacts): Promise<{
  projectPurpose: string;
  packageManager: string;
  testCommand: string;
  extraConstraints: string;
}> {
  let projectPurpose = inferPurpose(facts.repoName);
  let packageManager = facts.packageManager ?? "";
  let testCommand = facts.testCommand ?? "";

  if (!projectPurpose) {
    const value = await ctx.ui.editor("Project purpose (1-2 lines):", "");
    projectPurpose = value?.trim() || "Describe the repository purpose here.";
  }

  if (!packageManager && facts.languageStack.includes("JavaScript/TypeScript")) {
    const selected = await ctx.ui.select("Select package manager", ["npm", "pnpm", "yarn", "bun"]);
    packageManager = selected ?? "npm";
  }

  if (!testCommand) {
    const value = await ctx.ui.editor("Validation command (tests/lint/build):", "");
    testCommand = value?.trim() || "Add project validation command";
  }

  const extra = await ctx.ui.editor(
    "Any hard constraints for agents? (optional, one per line)",
    "",
  );

  return {
    projectPurpose,
    packageManager: packageManager || "not specified",
    testCommand,
    extraConstraints: extra?.trim() || "",
  };
}

function renderAgentsMd(
  facts: RepoFacts,
  answers: { projectPurpose: string; packageManager: string; testCommand: string; extraConstraints: string },
): string {
  const stack = facts.languageStack.length ? facts.languageStack.join(", ") : "Unknown";
  const notes = facts.notes.length ? facts.notes.map((n) => `- ${n}`).join("\n") : "- None";

  const commands: string[] = [];
  if (facts.devCommand) commands.push(`- Start: \`${facts.devCommand}\``);
  if (facts.buildCommand) commands.push(`- Build: \`${facts.buildCommand}\``);
  if (answers.testCommand) commands.push(`- Validate: \`${answers.testCommand}\``);

  const constraints = answers.extraConstraints
    ? answers.extraConstraints
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `- ${s}`)
        .join("\n")
    : "- Keep changes focused and minimal.\n- Do not commit secrets.";

  return `# AGENTS.md

## Repository
- Name: ${facts.repoName}
- Stack: ${stack}
- Monorepo: ${facts.monorepo ? "yes" : "no"}
- CI configured: ${facts.ciDetected ? "yes" : "no"}
- Package manager: ${answers.packageManager}

## Purpose
${answers.projectPurpose}

## Working rules for agents
${constraints}

## Validation
${commands.length ? commands.join("\n") : "- Add project commands here."}

## Context notes
${notes}

## Definition of done
- Code compiles or passes local checks.
- Validation commands pass.
- No secrets are added.
- Update docs when behavior changes.
`;
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  try {
    const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 });
    if (result.code === 0) {
      const root = result.stdout.trim();
      if (root) return root;
    }
  } catch {
    // ignore
  }
  return cwd;
}

function inferPurpose(repoName: string): string {
  if (!repoName) return "";
  const cleaned = repoName.replace(/[-_]/g, " ").trim();
  if (!cleaned) return "";
  return `This repository contains ${cleaned}.`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

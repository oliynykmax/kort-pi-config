import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";

type RepoFacts = {
  root: string;
  stack: string[];
  monorepo: boolean;
  ci: boolean;
  packageManager?: string;
  purpose?: string;
  commands: string[];
  unknowns: string[];
  evidence: string[];
};

export default function initAgentsExtension(pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description: "Guided AGENTS.md setup (agent-driven)",
    handler: async (args, ctx) => {
      const userFocus = args.trim();
      const facts = await scanRepo(pi, ctx.cwd);
      const answers = await askTargetedQuestions(ctx, facts);

      const prompt = buildInitPrompt({ userFocus, facts, answers });
      pi.sendUserMessage(prompt);

      ctx.ui.notify("Started guided /init. Agent will analyze repo and create/update AGENTS.md.", "info");
    },
  });
}

async function scanRepo(pi: ExtensionAPI, cwd: string): Promise<RepoFacts> {
  const root = await getRepoRoot(pi, cwd);
  const facts: RepoFacts = {
    root,
    stack: [],
    monorepo: false,
    ci: false,
    commands: [],
    unknowns: [],
    evidence: [],
  };

  const [packageJsonRaw, pyproject, cargoToml, goMod, readme] = await Promise.all([
    readIfExists(path.join(root, "package.json")),
    readIfExists(path.join(root, "pyproject.toml")),
    readIfExists(path.join(root, "Cargo.toml")),
    readIfExists(path.join(root, "go.mod")),
    readReadme(root),
  ]);

  if (packageJsonRaw) {
    facts.stack.push("JavaScript/TypeScript");
    facts.evidence.push("package.json");
    parsePackageJson(packageJsonRaw, facts);
  }
  if (pyproject) {
    facts.stack.push("Python");
    facts.evidence.push("pyproject.toml");
    parsePyproject(pyproject, facts);
  }
  if (cargoToml) {
    facts.stack.push("Rust");
    facts.evidence.push("Cargo.toml");
    pushUnique(facts.commands, "cargo test");
    pushUnique(facts.commands, "cargo build");
  }
  if (goMod) {
    facts.stack.push("Go");
    facts.evidence.push("go.mod");
    pushUnique(facts.commands, "go test ./...");
    pushUnique(facts.commands, "go build ./...");
  }
  if (facts.stack.length === 0) facts.stack.push("unknown");

  facts.monorepo =
    (await fileExists(path.join(root, "pnpm-workspace.yaml"))) ||
    (await fileExists(path.join(root, "turbo.json"))) ||
    (await fileExists(path.join(root, "nx.json")));
  if (facts.monorepo) facts.evidence.push("monorepo config detected");

  facts.ci =
    (await fileExists(path.join(root, ".github", "workflows"))) ||
    (await fileExists(path.join(root, ".gitlab-ci.yml"))) ||
    (await fileExists(path.join(root, "azure-pipelines.yml")));
  if (facts.ci) facts.evidence.push("CI config detected");

  facts.packageManager = await detectPackageManager(root, packageJsonRaw);

  facts.purpose = inferPurpose(readme, packageJsonRaw, path.basename(root));

  const hasValidate = facts.commands.some((c) => /test|lint|typecheck|check/.test(c));
  if (!hasValidate) facts.unknowns.push("validation-command");
  const hasRun = facts.commands.some((c) => /dev|start|run/.test(c));
  if (!hasRun) facts.unknowns.push("startup-command");
  if (!facts.purpose || facts.purpose.length < 12) facts.unknowns.push("project-purpose");

  return facts;
}

async function askTargetedQuestions(
  ctx: ExtensionCommandContext,
  facts: RepoFacts,
): Promise<Array<{ question: string; answer: string }>> {
  const qa: Array<{ question: string; answer: string }> = [];

  const ask = async (question: string): Promise<void> => {
    const answer = (await ctx.ui.input(question, ""))?.trim();
    if (answer) qa.push({ question, answer });
  };

  // Only ask when critical information is not derivable from repo.
  if (facts.unknowns.includes("project-purpose")) {
    await ask("What is the project purpose in 1-2 lines?");
  }
  if (facts.unknowns.includes("validation-command")) {
    await ask("What is the main validation command agents should run?");
  }
  if (facts.unknowns.includes("startup-command")) {
    await ask("What is the main local run/dev command?");
  }

  return qa.slice(0, 3);
}

function buildInitPrompt(input: {
  userFocus: string;
  facts: RepoFacts;
  answers: Array<{ question: string; answer: string }>;
}): string {
  const { userFocus, facts, answers } = input;

  const observed = [
    `- Repo root: ${facts.root}`,
    `- Stack: ${facts.stack.join(", ")}`,
    `- Package manager: ${facts.packageManager ?? "unknown"}`,
    `- Monorepo: ${facts.monorepo ? "yes" : "no"}`,
    `- CI detected: ${facts.ci ? "yes" : "no"}`,
    `- Purpose guess: ${facts.purpose ?? "unknown"}`,
  ].join("\n");

  const commandList = facts.commands.length
    ? facts.commands.map((c) => `- ${c}`).join("\n")
    : "- none discovered";

  const answered = answers.length
    ? answers.map((x) => `- ${x.question} ${x.answer}`).join("\n")
    : "- none";

  return `Create or update AGENTS.md for this repository.

User focus:
${userFocus || "(none)"}

Pre-scan facts (already derived from repository):
${observed}

Discovered commands:
${commandList}

User clarifications for missing critical bits:
${answered}

Execution requirements:
1) Re-read the highest-value repo sources first (README, manifests, scripts, CI, existing instruction files).
2) Extract only high-signal, repo-specific guidance agents would otherwise miss.
3) Keep AGENTS.md compact and operational.
4) If important gaps remain after reading files and the clarifications above, ask one short batch of targeted questions (max 3) using questionnaire.
5) Then write AGENTS.md at repo root (improve existing file in place if present).

Content requirements:
- Exact commands (build/test/lint/typecheck/dev), including focused variants when possible.
- Real package/module boundaries and entrypoints.
- Order-dependent workflows when relevant.
- Toolchain quirks (codegen/migrations/env bootstrapping/artifacts).
- Project-specific conventions that differ from defaults.

Do not include:
- Generic advice
- Speculative claims
- Secrets/tokens
- Long explanations
`;
}

function parsePackageJson(raw: string, facts: RepoFacts): void {
  try {
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      description?: string;
      packageManager?: string;
    };

    const scripts = pkg.scripts ?? {};
    const candidates = ["dev", "start", "build", "test", "lint", "typecheck", "check"];
    for (const key of candidates) {
      if (scripts[key]) pushUnique(facts.commands, `run ${key}`);
    }

    if (!facts.purpose && typeof pkg.description === "string") {
      facts.purpose = pkg.description.trim();
    }
  } catch {
    // ignore malformed package.json
  }
}

function parsePyproject(raw: string, facts: RepoFacts): void {
  if (/pytest|tool\.pytest/m.test(raw)) pushUnique(facts.commands, "pytest");
  if (/\bruff\b/m.test(raw)) pushUnique(facts.commands, "ruff check .");
  if (/mypy/m.test(raw)) pushUnique(facts.commands, "mypy .");
}

function inferPurpose(readme: string | null, packageJsonRaw: string | null, repoName: string): string | undefined {
  if (packageJsonRaw) {
    try {
      const pkg = JSON.parse(packageJsonRaw) as { description?: string };
      if (pkg.description?.trim()) return pkg.description.trim();
    } catch {
      // ignore
    }
  }

  if (readme) {
    const lines = readme
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("#"));
    const first = lines.find((l) => l.length > 20);
    if (first) return first;
  }

  return `Codebase for ${repoName.replace(/[-_]+/g, " ")}.`;
}

async function detectPackageManager(root: string, packageJsonRaw: string | null): Promise<string | undefined> {
  if (packageJsonRaw) {
    try {
      const pkg = JSON.parse(packageJsonRaw) as { packageManager?: string };
      if (pkg.packageManager) return pkg.packageManager.split("@")[0];
    } catch {
      // ignore
    }
  }

  const checks: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ];

  for (const [file, pm] of checks) {
    if (await fileExists(path.join(root, file))) return pm;
  }
  return undefined;
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  try {
    const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 });
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
  } catch {
    // ignore
  }
  return cwd;
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

async function readReadme(root: string): Promise<string | null> {
  for (const name of ["README.md", "readme.md", "README.MD"]) {
    const content = await readIfExists(path.join(root, name));
    if (content) return content;
  }
  return null;
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

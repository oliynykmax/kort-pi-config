import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";

type Confidence = "high" | "medium" | "low";

interface RepoFacts {
  root: string;
  repoName: string;
  purpose: string;
  purposeConfidence: Confidence;
  stack: string[];
  packageManager: string;
  packageManagerConfidence: Confidence;
  devCommand?: string;
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  monorepo: boolean;
  ci: boolean;
  keyDirs: string[];
  keyFiles: string[];
  notes: string[];
}

interface Answers {
  purpose: string;
  validateCommand: string;
  extraConstraints: string[];
}

export default function initAgentsExtension(pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description: "Guided AGENTS.md setup from repository context",
    handler: async (_args, ctx) => {
      await runInit(pi, ctx);
    },
  });
}

async function runInit(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const facts = await inspectRepo(pi, ctx.cwd);
  const answers = await askTargetedQuestions(ctx, facts);

  const agentsPath = path.join(facts.root, "AGENTS.md");
  if (await fileExists(agentsPath)) {
    const overwrite = await ctx.ui.confirm("AGENTS.md exists", `Overwrite ${agentsPath}?`);
    if (!overwrite) {
      ctx.ui.notify("Init cancelled", "info");
      return;
    }
  }

  const content = renderAgentsMd(facts, answers);
  await fs.writeFile(agentsPath, content, "utf8");
  ctx.ui.notify(`Created ${agentsPath}`, "success");
}

async function inspectRepo(pi: ExtensionAPI, cwd: string): Promise<RepoFacts> {
  const root = await getRepoRoot(pi, cwd);
  const repoName = path.basename(root);

  const [
    packageJson,
    pyproject,
    cargoToml,
    goMod,
    pom,
    gradle,
    makefile,
    readme,
  ] = await Promise.all([
    readIfExists(path.join(root, "package.json")),
    readIfExists(path.join(root, "pyproject.toml")),
    readIfExists(path.join(root, "Cargo.toml")),
    readIfExists(path.join(root, "go.mod")),
    readIfExists(path.join(root, "pom.xml")),
    readIfExists(path.join(root, "build.gradle")),
    readIfExists(path.join(root, "Makefile")),
    readFirstReadme(root),
  ]);

  const stack: string[] = [];
  const notes: string[] = [];

  if (packageJson) stack.push("JavaScript/TypeScript");
  if (pyproject) stack.push("Python");
  if (cargoToml) stack.push("Rust");
  if (goMod) stack.push("Go");
  if (pom || gradle) stack.push("Java/JVM");
  if (stack.length === 0) stack.push("Unknown");

  const pkgFacts = parsePackageJson(packageJson);
  const packageManagerFact = await detectPackageManager(root, packageJson);

  const pyFacts = parsePyproject(pyproject);
  const cargoFacts = parseCargoToml(cargoToml);
  const goFacts = parseGoMod(goMod);

  const monorepo = await isMonorepo(root);
  const ci = await hasCi(root);

  const keyDirs = await findExistingDirs(root, [
    "src",
    "app",
    "packages",
    "libs",
    "services",
    "api",
    "web",
    "tests",
    "test",
    "docs",
    ".github/workflows",
  ]);

  const keyFiles = await findExistingFiles(root, [
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "nx.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "docker-compose.yml",
    "Makefile",
  ]);

  if (await fileExists(path.join(root, ".env"))) notes.push("Has .env file (do not commit secrets)");
  if (await fileExists(path.join(root, ".env.example"))) notes.push("Has .env.example template");
  if (await fileExists(path.join(root, "prisma", "schema.prisma"))) notes.push("Uses Prisma");
  if (await fileExists(path.join(root, "docker-compose.yml"))) notes.push("Uses docker-compose");

  const purposeGuess = inferPurpose(repoName, pkgFacts.description, pyFacts.description, cargoFacts.description, readme);

  const devCommand =
    pkgFacts.devCommand || pyFacts.devCommand || cargoFacts.devCommand || goFacts.devCommand || undefined;
  const buildCommand =
    pkgFacts.buildCommand || pyFacts.buildCommand || cargoFacts.buildCommand || goFacts.buildCommand || undefined;
  const testCommand =
    pkgFacts.testCommand || pyFacts.testCommand || cargoFacts.testCommand || goFacts.testCommand || inferFromMake(makefile, "test");
  const lintCommand = pkgFacts.lintCommand || pyFacts.lintCommand || inferFromMake(makefile, "lint") || undefined;

  return {
    root,
    repoName,
    purpose: purposeGuess.text,
    purposeConfidence: purposeGuess.confidence,
    stack,
    packageManager: packageManagerFact.value,
    packageManagerConfidence: packageManagerFact.confidence,
    devCommand,
    buildCommand,
    testCommand,
    lintCommand,
    monorepo,
    ci,
    keyDirs,
    keyFiles,
    notes,
  };
}

async function askTargetedQuestions(ctx: ExtensionCommandContext, facts: RepoFacts): Promise<Answers> {
  let purpose = facts.purpose;
  let validateCommand = facts.testCommand || facts.lintCommand || facts.buildCommand || "";

  // Ask only when confidence is low.
  if (facts.purposeConfidence === "low") {
    const p = await ctx.ui.editor("Project purpose (1-2 lines)", "");
    purpose = p?.trim() || `Repository ${facts.repoName}.`;
  }

  if (!validateCommand) {
    const c = await ctx.ui.input("Main validation command (tests/lint/build)", "");
    validateCommand = c?.trim() || "<set validation command>";
  }

  const extra = await ctx.ui.editor(
    "Extra hard constraints for agents (optional, one per line)",
    "",
  );

  const extraConstraints = (extra || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  return { purpose, validateCommand, extraConstraints };
}

function renderAgentsMd(facts: RepoFacts, answers: Answers): string {
  const validateLines: string[] = [];
  if (facts.devCommand) validateLines.push(`- Start: \`${normalizeCommand(facts.devCommand, facts.packageManager)}\``);
  if (facts.buildCommand) validateLines.push(`- Build: \`${normalizeCommand(facts.buildCommand, facts.packageManager)}\``);
  if (facts.lintCommand) validateLines.push(`- Lint: \`${normalizeCommand(facts.lintCommand, facts.packageManager)}\``);
  validateLines.push(`- Validate: \`${normalizeCommand(answers.validateCommand, facts.packageManager)}\``);

  const constraints = [
    "Keep changes small and scoped to the request.",
    "Ask before changing architecture, dependencies, CI, or database schema.",
    "Do not commit or print secrets.",
    "Update docs when behavior or commands change.",
    ...answers.extraConstraints,
  ];

  const keyDirs = facts.keyDirs.length ? facts.keyDirs.map((d) => `- ${d}`).join("\n") : "- (none detected)";
  const keyFiles = facts.keyFiles.length ? facts.keyFiles.map((f) => `- ${f}`).join("\n") : "- (none detected)";
  const notes = facts.notes.length ? facts.notes.map((n) => `- ${n}`).join("\n") : "- None";

  return `# AGENTS.md

## Project
- Name: ${facts.repoName}
- Purpose: ${answers.purpose}
- Stack: ${facts.stack.join(", ")}
- Package manager: ${facts.packageManager}
- Monorepo: ${facts.monorepo ? "yes" : "no"}
- CI detected: ${facts.ci ? "yes" : "no"}

## Important paths
### Key directories
${keyDirs}

### Key files
${keyFiles}

## Agent operating rules
${constraints.map((c) => `- ${c}`).join("\n")}

## Commands
${validateLines.join("\n")}

## Definition of done
- Requested behavior is implemented.
- Validation command passes.
- No secrets were added or exposed.
- Relevant docs are updated.

## Context notes
${notes}
`;
}

function parsePackageJson(content: string | null): {
  description?: string;
  devCommand?: string;
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
} {
  if (!content) return {};
  try {
    const pkg = JSON.parse(content) as {
      description?: string;
      scripts?: Record<string, string>;
      packageManager?: string;
    };
    const scripts = pkg.scripts || {};
    return {
      description: cleanOneLine(pkg.description),
      devCommand: scripts.dev ? "run dev" : scripts.start ? "run start" : undefined,
      buildCommand: scripts.build ? "run build" : undefined,
      testCommand: scripts.test ? "run test" : undefined,
      lintCommand: scripts.lint ? "run lint" : undefined,
    };
  } catch {
    return {};
  }
}

function parsePyproject(content: string | null): {
  description?: string;
  devCommand?: string;
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
} {
  if (!content) return {};

  const desc = firstRegex(content, /^description\s*=\s*"([^"]+)"/m);
  const hasPytest = /pytest|tool\.pytest/m.test(content);
  const hasRuff = /\bruff\b/m.test(content);

  return {
    description: cleanOneLine(desc),
    devCommand: "python -m <entrypoint>",
    buildCommand: /\[build-system\]/m.test(content) ? "python -m build" : undefined,
    testCommand: hasPytest ? "pytest" : undefined,
    lintCommand: hasRuff ? "ruff check ." : undefined,
  };
}

function parseCargoToml(content: string | null): {
  description?: string;
  devCommand?: string;
  buildCommand?: string;
  testCommand?: string;
} {
  if (!content) return {};
  return {
    description: cleanOneLine(firstRegex(content, /^description\s*=\s*"([^"]+)"/m)),
    devCommand: "cargo run",
    buildCommand: "cargo build",
    testCommand: "cargo test",
  };
}

function parseGoMod(content: string | null): {
  devCommand?: string;
  buildCommand?: string;
  testCommand?: string;
} {
  if (!content) return {};
  return {
    devCommand: "go run .",
    buildCommand: "go build ./...",
    testCommand: "go test ./...",
  };
}

function inferPurpose(
  repoName: string,
  pkgDescription?: string,
  pyDescription?: string,
  cargoDescription?: string,
  readme?: string,
): { text: string; confidence: Confidence } {
  if (pkgDescription) return { text: pkgDescription, confidence: "high" };
  if (pyDescription) return { text: pyDescription, confidence: "high" };
  if (cargoDescription) return { text: cargoDescription, confidence: "high" };

  const readmePurpose = inferFromReadme(readme || "");
  if (readmePurpose) return { text: readmePurpose, confidence: "medium" };

  const namePurpose = cleanOneLine(repoName.replace(/[-_]+/g, " ")) || "project";
  return { text: `Main codebase for ${namePurpose}.`, confidence: "low" };
}

function inferFromReadme(readme: string): string | undefined {
  if (!readme) return undefined;
  const lines = readme
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.length < 20) continue;
    return cleanOneLine(line);
  }
  return undefined;
}

function inferFromMake(content: string | null, target: "test" | "lint"): string | undefined {
  if (!content) return undefined;
  const re = new RegExp(`^${target}:`, "m");
  return re.test(content) ? `make ${target}` : undefined;
}

function normalizeCommand(command: string, packageManager: string): string {
  const trimmed = command.trim();
  if (!trimmed.startsWith("run ")) return trimmed;
  const pm = packageManager || "npm";
  if (pm === "npm") return `npm ${trimmed}`;
  return `${pm} ${trimmed.replace(/^run\s+/, "")}`;
}

async function detectPackageManager(root: string, packageJson: string | null): Promise<{ value: string; confidence: Confidence }> {
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as { packageManager?: string };
      if (pkg.packageManager) {
        return { value: pkg.packageManager.split("@")[0], confidence: "high" };
      }
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
    if (await fileExists(path.join(root, file))) {
      return { value: pm, confidence: "medium" };
    }
  }

  return { value: "not specified", confidence: "low" };
}

async function readFirstReadme(root: string): Promise<string | null> {
  const candidates = ["README.md", "readme.md", "README.MD"];
  for (const c of candidates) {
    const full = path.join(root, c);
    const content = await readIfExists(full);
    if (content) return content;
  }
  return null;
}

async function hasCi(root: string): Promise<boolean> {
  return (
    (await fileExists(path.join(root, ".github", "workflows"))) ||
    (await fileExists(path.join(root, ".gitlab-ci.yml"))) ||
    (await fileExists(path.join(root, "azure-pipelines.yml")))
  );
}

async function isMonorepo(root: string): Promise<boolean> {
  return (
    (await fileExists(path.join(root, "pnpm-workspace.yaml"))) ||
    (await fileExists(path.join(root, "turbo.json"))) ||
    (await fileExists(path.join(root, "nx.json")))
  );
}

async function findExistingDirs(root: string, dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const dir of dirs) {
    const full = path.join(root, dir);
    try {
      const stat = await fs.stat(full);
      if (stat.isDirectory()) out.push(dir);
    } catch {
      // ignore
    }
  }
  return out;
}

async function findExistingFiles(root: string, files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    if (await fileExists(path.join(root, file))) out.push(file);
  }
  return out;
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

function firstRegex(text: string, regex: RegExp): string | undefined {
  const m = text.match(regex);
  return m?.[1]?.trim();
}

function cleanOneLine(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/\s+/g, " ").trim();
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

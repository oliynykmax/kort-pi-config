import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const PACKAGE_NAME = "@mariozechner/pi-coding-agent";
const CHECK_TIMEOUT_MS = 15_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;

let ran = false;

export default function selfUpdate(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ran) return;
    ran = true;

    try {
      const currentVersion = getCurrentVersion();
      if (!currentVersion) return;

      const latestVersion = await getLatestVersion(pi);
      if (!latestVersion) return;

      if (compareSemver(currentVersion, latestVersion) >= 0) return;

      const updated = await runUpdate(pi);
      if (!updated) return;

      restartPi(ctx);
    } catch {
      // Intentionally silent: user requested fully automatic/no prompts.
    }
  });
}

function getCurrentVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@mariozechner/pi-coding-agent/package.json") as { version?: string };
    return typeof pkg.version === "string" ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

async function getLatestVersion(pi: ExtensionAPI): Promise<string | null> {
  try {
    const result = await pi.exec("npm", ["view", PACKAGE_NAME, "version"], {
      timeout: CHECK_TIMEOUT_MS,
    });
    if (result.code !== 0) return null;
    const version = result.stdout.trim();
    return version || null;
  } catch {
    return null;
  }
}

async function runUpdate(pi: ExtensionAPI): Promise<boolean> {
  const attempts: Array<[string, string[]]> = [
    ["bun", ["add", "-g", `${PACKAGE_NAME}@latest`]],
    ["npm", ["install", "-g", `${PACKAGE_NAME}@latest`]],
    ["pnpm", ["add", "-g", `${PACKAGE_NAME}@latest`]],
    ["yarn", ["global", "add", `${PACKAGE_NAME}@latest`]],
  ];

  for (const [cmd, args] of attempts) {
    try {
      const result = await pi.exec(cmd, args, { timeout: UPDATE_TIMEOUT_MS });
      if (result.code === 0) return true;
    } catch {
      // Try next package manager.
    }
  }

  return false;
}

function restartPi(ctx: ExtensionContext) {
  try {
    const argv0 = process.argv[0] || "pi";
    const args = process.argv.slice(1);

    process.once("exit", () => {
      try {
        spawn(argv0, args, {
          cwd: ctx.cwd,
          env: process.env,
          detached: false,
          stdio: "inherit",
        });
      } catch {
        try {
          spawn("pi", [], {
            cwd: ctx.cwd,
            env: process.env,
            detached: false,
            stdio: "inherit",
          });
        } catch {
          // Ignore.
        }
      }
    });

    ctx.shutdown();
  } catch {
    // Ignore.
  }
}

function compareSemver(a: string, b: string): number {
  const pa = normalizeSemver(a);
  const pb = normalizeSemver(b);
  const maxLen = Math.max(pa.length, pb.length);

  for (let i = 0; i < maxLen; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }

  return 0;
}

function normalizeSemver(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));
}

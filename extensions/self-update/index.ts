import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { spawn } from "node:child_process";

const PACKAGE_NAME = "@mariozechner/pi-coding-agent";
const CHECK_TIMEOUT_MS = 15_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;

let hasCheckedThisSession = false;

export default function selfUpdate(pi: ExtensionAPI) {
	// Reset flag on session switch
	pi.on("session_switch", () => {
		hasCheckedThisSession = false;
	});

	pi.on("session_start", async (_event, ctx) => {
		if (hasCheckedThisSession) return;
		hasCheckedThisSession = true;

		if (!isInteractive()) {
			console.log("[self-update] Skipping auto-update in non-interactive mode");
			return;
		}

		try {
			console.log("[self-update] Checking for updates...");

			const currentVersion = getCurrentVersion();
			if (!currentVersion) {
				console.log("[self-update] Could not determine current version");
				return;
			}
			console.log(`[self-update] Current version: ${currentVersion}`);

			const latestVersion = await getLatestVersion(pi);
			if (!latestVersion) {
				console.log("[self-update] Could not fetch latest version");
				return;
			}
			console.log(`[self-update] Latest version: ${latestVersion}`);

			if (compareSemver(currentVersion, latestVersion) >= 0) {
				console.log("[self-update] Already up to date");
				return;
			}

			console.log(`[self-update] Update available: ${currentVersion} -> ${latestVersion}`);
			const updated = await runUpdate(pi);
			if (!updated) {
				console.log("[self-update] Update failed");
				return;
			}

			restartPi(ctx);
		} catch (e) {
			console.log(`[self-update] Error: ${e}`);
		}
	});

	pi.registerCommand("update", {
		description: "Update pi to latest version",
		handler: async (_args, ctx) => {
			try {
				const currentVersion = getCurrentVersion();
				if (!currentVersion) {
					ctx.ui.notify("Could not determine current version", "error");
					return;
				}

				const latestVersion = await getLatestVersion(pi);
				if (!latestVersion) {
					ctx.ui.notify("Could not fetch latest version", "error");
					return;
				}

				if (compareSemver(currentVersion, latestVersion) >= 0) {
					ctx.ui.notify(`Already up to date (${currentVersion})`, "info");
					return;
				}

				ctx.ui.notify(`Updating: ${currentVersion} -> ${latestVersion}`, "info");
				const updated = await runUpdate(pi);
				if (!updated) {
					ctx.ui.notify("Update failed", "error");
					return;
				}

				restartPi(ctx);
			} catch (e) {
				const error = e instanceof Error ? e.message : String(e);
				ctx.ui.notify(`Error: ${error}`, "error");
			}
		},
	});
}

function getCurrentVersion(): string | null {
	const commands = [
		{ cmd: "bun", args: ["pm", "ls", "-g", PACKAGE_NAME] },
		{ cmd: "npm", args: ["list", "-g", PACKAGE_NAME, "--depth=0"] },
	];

	for (const { cmd, args } of commands) {
		try {
			const result = execSync(`${cmd} ${args.join(" ")} 2>&1`, {
				encoding: "utf8",
				timeout: 5000,
			});
			const match = result.match(/@mariozechner\/pi-coding-agent@(\S+)/);
			if (match) return match[1];
		} catch {
			continue;
		}
	}
	return null;
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

function isInteractive(): boolean {
	return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function restartPi(ctx: ExtensionContext) {
	if (!isInteractive()) {
		console.log("[self-update] Skipping restart in non-interactive mode");
		return;
	}

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
					// Final fallback - log error
					console.error("[self-update] Failed to restart pi");
				}
			}
		});

		ctx.shutdown();
	} catch (e) {
		console.error(`[self-update] Restart error: ${e}`);
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

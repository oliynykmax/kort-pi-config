import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFile, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PACKAGE_NAME = "@mariozechner/pi-coding-agent";
const CHECK_TIMEOUT_MS = 5_000; // Reduced from 15s
const UPDATE_TIMEOUT_MS = 5 * 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Check once per day

const STATE_DIR = join(process.env.HOME || "~", ".pi/agent");
const LAST_CHECK_FILE = join(STATE_DIR, ".last-update-check");
const FAILED_VERSION_FILE = join(STATE_DIR, ".update-failed");

export default function selfUpdate(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!isInteractive()) {
			console.log("[self-update] Skipping auto-update in non-interactive mode");
			return;
		}

		try {
			// Check if we should run update check
			if (!(await shouldCheckForUpdates())) {
				return;
			}

			console.log("[self-update] Checking for updates...");

			const currentVersion = await getCurrentVersion(pi);
			if (!currentVersion) {
				console.error("[self-update] Could not determine current version");
				return;
			}
			console.log(`[self-update] Current version: ${currentVersion}`);

			const latestVersion = await getLatestVersion(pi);
			if (!latestVersion) {
				console.error("[self-update] Could not fetch latest version");
				return;
			}
			console.log(`[self-update] Latest version: ${latestVersion}`);

			// Save check timestamp
			await saveLastCheckTime();

			if (compareSemver(currentVersion, latestVersion) >= 0) {
				ctx.ui.notify(`Latest version: ${currentVersion}`, "success");
				return;
			}

			// Check if this version previously failed
			if (await hasUpdateFailed(latestVersion)) {
				console.log(`[self-update] Skipping ${latestVersion} (previously failed). Use /update --force to retry.`);
				return;
			}

			console.log(`[self-update] Update available: ${currentVersion} → ${latestVersion}`);
			ctx.ui.notify(`Updating pi: ${currentVersion} → ${latestVersion}...`, "info");

			const updated = await runUpdate(pi, latestVersion);
			if (!updated) {
				console.error("[self-update] Update failed");
				await saveFailedVersion(latestVersion);
				ctx.ui.notify(`Update to ${latestVersion} failed. Check logs for details.`, "error");
				return;
			}

			ctx.ui.notify(`Updated to ${latestVersion}! Restarting...`, "success");
			setTimeout(() => restartPi(ctx), 500); // Give UI time to show notification
		} catch (e) {
			console.error("[self-update] Error during auto-update:", e);
		}
	});

	pi.registerCommand("update", {
		description: "Update pi to latest version. Flags: --force, --check",
		handler: async (args, ctx) => {
			try {
				const flags = parseFlags(args);

				const currentVersion = await getCurrentVersion(pi);
				if (!currentVersion) {
					ctx.ui.notify("Could not determine current version", "error");
					return;
				}

				const latestVersion = await getLatestVersion(pi);
				if (!latestVersion) {
					ctx.ui.notify("Could not fetch latest version", "error");
					return;
				}

				// --check flag: just show versions
				if (flags.check) {
					if (compareSemver(currentVersion, latestVersion) >= 0) {
						ctx.ui.notify(`Already up to date: ${currentVersion}`, "success");
					} else {
						ctx.ui.notify(`Update available: ${currentVersion} → ${latestVersion}`, "info");
					}
					return;
				}

				if (compareSemver(currentVersion, latestVersion) >= 0) {
					ctx.ui.notify(`Already up to date (${currentVersion})`, "info");
					return;
				}

				// Check if this version previously failed (unless --force)
				if (!flags.force && (await hasUpdateFailed(latestVersion))) {
					ctx.ui.notify(`Update to ${latestVersion} previously failed. Use --force to retry.`, "error");
					return;
				}

				ctx.ui.notify(`Updating: ${currentVersion} → ${latestVersion}...`, "info");
				const updated = await runUpdate(pi, latestVersion);
				
				if (!updated) {
					await saveFailedVersion(latestVersion);
					ctx.ui.notify("Update failed. Check console for details.", "error");
					return;
				}

				// Clear failed version on success
				await clearFailedVersion();
				
				ctx.ui.notify(`Updated to ${latestVersion}! Restarting...`, "success");
				setTimeout(() => restartPi(ctx), 500);
			} catch (e) {
				const error = e instanceof Error ? e.message : String(e);
				console.error("[self-update] Error during manual update:", e);
				ctx.ui.notify(`Error: ${error}`, "error");
			}
		},
	});
}

// Parse command flags
function parseFlags(args: string): { force: boolean; check: boolean } {
	return {
		force: args.includes("--force"),
		check: args.includes("--check"),
	};
}

// Check if we should run update check (once per day)
async function shouldCheckForUpdates(): Promise<boolean> {
	try {
		await access(LAST_CHECK_FILE);
		const content = await readFile(LAST_CHECK_FILE, "utf-8");
		const lastCheck = Number.parseInt(content, 10);
		const now = Date.now();
		
		if (now - lastCheck < CHECK_INTERVAL_MS) {
			console.log(`[self-update] Last check was ${Math.round((now - lastCheck) / 1000 / 60)} minutes ago, skipping`);
			return false;
		}
	} catch {
		// File doesn't exist or is invalid, proceed with check
	}
	return true;
}

// Save last check timestamp
async function saveLastCheckTime(): Promise<void> {
	try {
		await writeFile(LAST_CHECK_FILE, String(Date.now()));
	} catch (e) {
		console.error("[self-update] Failed to save last check time:", e);
	}
}

// Check if update to specific version failed before
async function hasUpdateFailed(version: string): Promise<boolean> {
	try {
		await access(FAILED_VERSION_FILE);
		const content = await readFile(FAILED_VERSION_FILE, "utf-8");
		return content.trim() === version;
	} catch {
		return false;
	}
}

// Save failed update version
async function saveFailedVersion(version: string): Promise<void> {
	try {
		await writeFile(FAILED_VERSION_FILE, version);
	} catch (e) {
		console.error("[self-update] Failed to save failed version:", e);
	}
}

// Clear failed version marker
async function clearFailedVersion(): Promise<void> {
	try {
		const { unlink } = await import("node:fs/promises");
		await unlink(FAILED_VERSION_FILE);
	} catch {
		// File might not exist, ignore
	}
}

// Detect which package manager was used to install pi
function detectPackageManager(): string {
	// Check if running via bun
	if (process.execPath.includes("bun")) {
		console.log("[self-update] Detected package manager: bun (from execPath)");
		return "bun";
	}

	// Check which command installed pi
	const piPath = process.argv[1] || "";
	if (piPath.includes(".bun")) {
		console.log("[self-update] Detected package manager: bun (from install path)");
		return "bun";
	}
	if (piPath.includes(".pnpm")) {
		console.log("[self-update] Detected package manager: pnpm");
		return "pnpm";
	}
	if (piPath.includes(".yarn")) {
		console.log("[self-update] Detected package manager: yarn");
		return "yarn";
	}

	// Default to npm
	console.log("[self-update] Defaulting to package manager: npm");
	return "npm";
}

// Get current version (async)
async function getCurrentVersion(pi: ExtensionAPI): Promise<string | null> {
	const packageManager = detectPackageManager();
	
	const commands: Array<[string, string[]]> = [];
	
	// Try detected package manager first
	if (packageManager === "bun") {
		commands.push(["bun", ["pm", "ls", "-g", PACKAGE_NAME]]);
	} else if (packageManager === "pnpm") {
		commands.push(["pnpm", ["list", "-g", PACKAGE_NAME, "--depth=0"]]);
	} else if (packageManager === "yarn") {
		commands.push(["yarn", ["global", "list", "--pattern", PACKAGE_NAME]]);
	} else {
		commands.push(["npm", ["list", "-g", PACKAGE_NAME, "--depth=0"]]);
	}
	
	// Fallbacks
	commands.push(
		["bun", ["pm", "ls", "-g", PACKAGE_NAME]],
		["npm", ["list", "-g", PACKAGE_NAME, "--depth=0"]],
		["pnpm", ["list", "-g", PACKAGE_NAME, "--depth=0"]],
		["yarn", ["global", "list", "--pattern", PACKAGE_NAME]]
	);

	for (const [cmd, args] of commands) {
		try {
			console.log(`[self-update] Trying: ${cmd} ${args.join(" ")}`);
			const result = await pi.exec(cmd, args, { timeout: CHECK_TIMEOUT_MS });
			
			if (result.code !== 0) {
				console.error(`[self-update] ${cmd} failed with code ${result.code}:`, result.stderr);
				continue;
			}
			
			const output = result.stdout + result.stderr;
			const match = output.match(/@mariozechner\/pi-coding-agent@(\S+)/);
			if (match) {
				console.log(`[self-update] Found version via ${cmd}: ${match[1]}`);
				return match[1];
			}
		} catch (e) {
			console.error(`[self-update] ${cmd} threw error:`, e);
			continue;
		}
	}
	
	console.error("[self-update] All package managers failed to get current version");
	return null;
}

// Get latest version from npm
async function getLatestVersion(pi: ExtensionAPI): Promise<string | null> {
	try {
		console.log("[self-update] Fetching latest version from npm...");
		const result = await pi.exec("npm", ["view", PACKAGE_NAME, "version"], {
			timeout: CHECK_TIMEOUT_MS,
		});
		
		if (result.code !== 0) {
			console.error("[self-update] npm view failed:", result.stderr);
			return null;
		}
		
		const version = result.stdout.trim();
		if (!version) {
			console.error("[self-update] npm view returned empty version");
			return null;
		}
		
		return version;
	} catch (e) {
		console.error("[self-update] Error fetching latest version:", e);
		return null;
	}
}

// Run update with detected package manager
async function runUpdate(pi: ExtensionAPI, version: string): Promise<boolean> {
	const packageManager = detectPackageManager();
	
	const attempts: Array<[string, string[]]> = [];
	
	// Try detected package manager first
	if (packageManager === "bun") {
		attempts.push(["bun", ["add", "-g", `${PACKAGE_NAME}@${version}`]]);
	} else if (packageManager === "pnpm") {
		attempts.push(["pnpm", ["add", "-g", `${PACKAGE_NAME}@${version}`]]);
	} else if (packageManager === "yarn") {
		attempts.push(["yarn", ["global", "add", `${PACKAGE_NAME}@${version}`]]);
	} else {
		attempts.push(["npm", ["install", "-g", `${PACKAGE_NAME}@${version}`]]);
	}
	
	// Fallbacks with latest tag
	attempts.push(
		["bun", ["add", "-g", `${PACKAGE_NAME}@latest`]],
		["npm", ["install", "-g", `${PACKAGE_NAME}@latest`]],
		["pnpm", ["add", "-g", `${PACKAGE_NAME}@latest`]],
		["yarn", ["global", "add", `${PACKAGE_NAME}@latest`]]
	);

	for (const [cmd, args] of attempts) {
		try {
			console.log(`[self-update] Attempting update: ${cmd} ${args.join(" ")}`);
			const result = await pi.exec(cmd, args, { timeout: UPDATE_TIMEOUT_MS });
			
			if (result.code === 0) {
				console.log(`[self-update] Update successful via ${cmd}`);
				return true;
			}
			
			console.error(`[self-update] ${cmd} failed with code ${result.code}:`, result.stderr);
		} catch (e) {
			console.error(`[self-update] ${cmd} threw error:`, e);
		}
	}

	console.error("[self-update] All package manager update attempts failed");
	return false;
}

// Check if running in interactive mode
function isInteractive(): boolean {
	return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

// Restart pi
function restartPi(ctx: ExtensionContext) {
	if (!isInteractive()) {
		console.log("[self-update] Skipping restart in non-interactive mode");
		return;
	}

	try {
		// Try to detect the correct command to restart
		let command = process.execPath; // Usually the node/bun binary
		let args = process.argv.slice(1); // All args after the binary

		console.log(`[self-update] Restarting with: ${command} ${args.join(" ")}`);

		// Schedule spawn before shutdown
		setTimeout(() => {
			try {
				const child = spawn(command, args, {
					cwd: ctx.cwd,
					env: process.env,
					detached: true,
					stdio: "inherit",
				});

				// Unref so parent can exit
				child.unref();
				
				console.log(`[self-update] Spawned new process with PID: ${child.pid}`);
			} catch (e) {
				console.error("[self-update] Failed to spawn with execPath, trying 'pi' command:", e);
				
				try {
					const child = spawn("pi", [], {
						cwd: ctx.cwd,
						env: process.env,
						detached: true,
						stdio: "inherit",
					});
					child.unref();
					console.log(`[self-update] Spawned 'pi' with PID: ${child.pid}`);
				} catch (e2) {
					console.error("[self-update] Failed to restart pi:", e2);
					console.error("[self-update] Please restart pi manually");
					return;
				}
			}
		}, 100); // Small delay to ensure spawn completes

		// Shutdown current process
		setTimeout(() => {
			console.log("[self-update] Shutting down...");
			ctx.shutdown();
		}, 200);
	} catch (e) {
		console.error("[self-update] Restart error:", e);
	}
}

// Compare semver versions
function compareSemver(a: string, b: string): number {
	const aParts = normalizeSemver(a);
	const bParts = normalizeSemver(b);
	
	// Compare major.minor.patch
	for (let i = 0; i < 3; i++) {
		if (aParts.version[i] > bParts.version[i]) return 1;
		if (aParts.version[i] < bParts.version[i]) return -1;
	}
	
	// If versions equal, compare pre-release tags
	// No pre-release > has pre-release (1.0.0 > 1.0.0-beta)
	if (!aParts.prerelease && bParts.prerelease) return 1;
	if (aParts.prerelease && !bParts.prerelease) return -1;
	
	// Both have pre-release, compare alphabetically
	if (aParts.prerelease && bParts.prerelease) {
		if (aParts.prerelease > bParts.prerelease) return 1;
		if (aParts.prerelease < bParts.prerelease) return -1;
	}
	
	return 0;
}

// Normalize semver version
function normalizeSemver(v: string): { version: number[]; prerelease: string | null } {
	const cleaned = v.trim().replace(/^v/i, "");
	const [versionPart, ...prereleaseParts] = cleaned.split("-");
	
	const version = versionPart
		.split(".")
		.slice(0, 3) // Only take major.minor.patch
		.map((part) => Number.parseInt(part, 10))
		.map((num) => (Number.isFinite(num) ? num : 0));
	
	// Pad to 3 parts
	while (version.length < 3) {
		version.push(0);
	}
	
	const prerelease = prereleaseParts.length > 0 ? prereleaseParts.join("-") : null;
	
	return { version, prerelease };
}

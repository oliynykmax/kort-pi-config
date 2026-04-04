/**
 * Model Favourites Extension
 *
 * Provides a custom model selector with favourites shown in a dedicated section at the top.
 *
 * Usage:
 * - Ctrl+M - opens model selector with favourites at top
 * - /fav or /models - same as Ctrl+M
 * - Ctrl+F (in selector) - toggle selected model as favourite
 * - Built-in Ctrl+L still works for standard model selector
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

const FAVOURITES_FILE = join(process.env.HOME || "~", ".pi/agent/model-favourites.json");

interface FavouritesData {
	models: string[];
}

interface SelectItem {
	label: string;
	value: string;
	isHeader?: boolean;
}

async function loadFavourites(): Promise<FavouritesData> {
	try {
		await access(FAVOURITES_FILE);
		const data = await readFile(FAVOURITES_FILE, "utf-8");
		return JSON.parse(data);
	} catch {
		// File doesn't exist or invalid JSON
		return { models: [] };
	}
}

async function saveFavourites(data: FavouritesData): Promise<void> {
	try {
		await writeFile(FAVOURITES_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error("[model-favourites] Failed to save favourites:", e);
	}
}

function formatModelKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

function isFavourite(provider: string, modelId: string, favourites: FavouritesData): boolean {
	return favourites.models.includes(formatModelKey(provider, modelId));
}

function toggleFavourite(provider: string, modelId: string, favourites: FavouritesData): boolean {
	const key = formatModelKey(provider, modelId);
	const idx = favourites.models.indexOf(key);
	if (idx >= 0) {
		favourites.models.splice(idx, 1);
		return false;
	} else {
		favourites.models.push(key);
		return true;
	}
}

function getModelDisplayName(model: { id: string; name?: string }): string {
	return model.name || model.id;
}

/**
 * Custom Model Selector with Favourites Support
 */
class ModelSelector implements Component {
	private items: SelectItem[] = [];
	private selectedIndex = 0;
	private cursorY = 0;
	private favCount = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private onSelectFn?: (value: string) => void;
	private onCancelFn?: () => void;
	private onToggleFavFn?: (value: string) => void;

	constructor(items: SelectItem[], initialSelection?: string) {
		this.items = items;
		if (initialSelection) {
			const idx = items.findIndex((i) => i.value === initialSelection);
			if (idx >= 0) this.selectedIndex = idx;
		}
		this.favCount = items.filter((i) => i.label.includes("⭐")).length;
		this.invalidate();
	}

	onSelect(fn: (value: string) => void): void {
		this.onSelectFn = fn;
	}

	onCancel(fn: () => void): void {
		this.onCancelFn = fn;
	}

	onToggleFavourite(fn: (value: string) => void): void {
		this.onToggleFavFn = fn;
	}

	updateItems(items: SelectItem[]): void {
		this.items = items;
		this.favCount = items.filter((i) => i.label.includes("⭐")).length;
		this.invalidate();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private ensureVisible(): void {
		if (this.selectedIndex < this.cursorY) {
			this.cursorY = this.selectedIndex;
		} else if (this.selectedIndex > this.cursorY + 18) {
			this.cursorY = this.selectedIndex - 18;
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up)) {
			do {
				this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
			} while (this.items[this.selectedIndex].isHeader && this.items.length > 1);
			this.ensureVisible();
			this.invalidate();
		} else if (matchesKey(data, Key.down)) {
			do {
				this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
			} while (this.items[this.selectedIndex].isHeader && this.items.length > 1);
			this.ensureVisible();
			this.invalidate();
		} else if (matchesKey(data, Key.pageUp)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 10);
			this.ensureVisible();
			this.invalidate();
		} else if (matchesKey(data, Key.pageDown)) {
			this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 10);
			this.ensureVisible();
			this.invalidate();
		} else if (matchesKey(data, Key.home)) {
			this.selectedIndex = this.favCount > 0 ? 1 : 0; // Skip header
			this.ensureVisible();
			this.invalidate();
		} else if (matchesKey(data, Key.end)) {
			this.selectedIndex = this.items.length - 1;
			this.ensureVisible();
			this.invalidate();
		} else if (matchesKey(data, Key.enter)) {
			const item = this.items[this.selectedIndex];
			if (item && !item.isHeader) {
				this.onSelectFn?.(item.value);
			}
		} else if (matchesKey(data, Key.escape)) {
			this.onCancelFn?.();
		} else if (matchesKey(data, Key.ctrl("f"))) {
			const item = this.items[this.selectedIndex];
			if (item && !item.isHeader) {
				this.onToggleFavFn?.(item.value);
			}
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const maxWidth = Math.min(width - 4, 50);

		// Title
		lines.push("╭" + "─".repeat(maxWidth + 2) + "╮");
		lines.push("│" + " ".repeat(Math.floor((maxWidth - 14) / 2)) + " Model Selector " + " ".repeat(Math.ceil((maxWidth - 14) / 2)) + "│");
		lines.push("│" + " ".repeat(maxWidth) + "│");
		lines.push("│" + " ↑/↓ navigate · Enter select · Ctrl+F toggle fav " + " ".repeat(Math.max(0, maxWidth - 46)) + "│");
		lines.push("├" + "─".repeat(maxWidth + 2) + "┤");

		// Items
		const endIdx = Math.min(this.items.length, this.cursorY + 20);
		for (let i = this.cursorY; i < endIdx; i++) {
			const item = this.items[i];
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? "│ ▶ " : "│   ";
			const label = truncateToWidth(item.label, maxWidth);
			const padding = " ".repeat(Math.max(0, maxWidth - visibleWidth(item.label)));
			lines.push(prefix + label + padding + " │");
		}

		// Fill remaining space
		while (lines.length < 27) {
			lines.push("│" + " ".repeat(maxWidth + 2) + "│");
		}

		lines.push("╰" + "─".repeat(maxWidth + 2) + "╯");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

export default function modelFavouritesExtension(pi: ExtensionAPI) {
	let favourites: FavouritesData = { models: [] };

	// Load favourites asynchronously on startup
	loadFavourites().then((data) => {
		favourites = data;
	});

	function buildModelItems(ctx: ExtensionContext): SelectItem[] {
		const allModels = ctx.modelRegistry.getAll();
		const items: SelectItem[] = [];

		const favItems: SelectItem[] = [];
		const regularByProvider = new Map<string, SelectItem[]>();

		for (const model of allModels) {
			const key = formatModelKey(model.provider, model.id);
			const isFav = isFavourite(model.provider, model.id, favourites);
			const favMarker = isFav ? " ⭐" : "";
			const item: SelectItem = {
				label: `${getModelDisplayName(model)}${favMarker}`,
				value: key,
			};

			if (isFav) {
				favItems.push(item);
			} else {
				const providerItems = regularByProvider.get(model.provider) || [];
				providerItems.push(item);
				regularByProvider.set(model.provider, providerItems);
			}
		}

		if (favItems.length > 0) {
			favItems.sort((a, b) => a.label.localeCompare(b.label));
			items.push({ label: "━━━ Favourites ━━━", value: "", isHeader: true });
			items.push(...favItems);
		}

		const sortedProviders = [...regularByProvider.keys()].sort();
		for (const provider of sortedProviders) {
			const providerItems = regularByProvider.get(provider)!;
			providerItems.sort((a, b) => a.label.localeCompare(b.label));
			items.push({ label: `── ${provider} ──`, value: "", isHeader: true });
			items.push(...providerItems);
		}

		return items;
	}

	async function showModelSelector(ctx: ExtensionContext): Promise<void> {
		const items = buildModelItems(ctx);
		const currentModel = ctx.model;
		const currentKey = currentModel ? formatModelKey(currentModel.provider, currentModel.id) : "";

		const selector = new ModelSelector(items, currentKey || undefined);

		await new Promise<void>((resolve) => {
			selector.onSelect(async (value: string) => {
				const [provider, modelId] = value.split("/");
				const model = ctx.modelRegistry.find(provider, modelId);
				if (model) {
					const success = await pi.setModel(model);
					if (success) {
						ctx.ui.notify(`Switched to ${value}`, "success");
					} else {
						ctx.ui.notify(`No API key for ${provider}`, "error");
					}
				}
				resolve();
			});

			selector.onCancel(() => resolve());

			selector.onToggleFavourite(async (value: string) => {
				const [provider, modelId] = value.split("/");
				const isNowFav = toggleFavourite(provider, modelId, favourites);
				await saveFavourites(favourites);

				if (isNowFav) {
					ctx.ui.notify(`⭐ Added to favourites`, "success");
				} else {
					ctx.ui.notify(`Removed from favourites`, "info");
				}

				// Rebuild and update
				const newItems = buildModelItems(ctx);
				selector.updateItems(newItems);
			});

			ctx.ui.custom(selector);
		});
	}

	// Use Ctrl+M for model selector with favourites (Ctrl+L is built-in)
	pi.registerShortcut("ctrl+m", {
		description: "Open model selector with favourites",
		handler: async (ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("This requires interactive mode", "error");
				return;
			}
			await showModelSelector(ctx);
		},
	});

	// Use /fav or /models command (built-in is /model)
	pi.registerCommand("fav", {
		description: "Select a model with favourites (Ctrl+M or Ctrl+F to toggle)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("This command requires interactive mode", "error");
				return;
			}

			const trimmed = args.trim();
			if (trimmed) {
				let provider: string | undefined;
				let modelId: string;

				if (trimmed.includes("/")) {
					const parts = trimmed.split("/");
					provider = parts[0];
					modelId = parts.slice(1).join("/");
				} else {
					modelId = trimmed;
				}

				const allModels = ctx.modelRegistry.getAll();
				const matches = allModels.filter((m) => {
					if (provider && m.provider !== provider) return false;
					return m.id === modelId || m.id.endsWith(`/${modelId}`);
				});

				if (matches.length === 0) {
					ctx.ui.notify(`Model not found: ${trimmed}`, "error");
					return;
				}

				const model = matches[0];
				const success = await pi.setModel(model);
				if (success) {
					ctx.ui.notify(`Switched to ${model.provider}/${model.id}`, "success");
				} else {
					ctx.ui.notify(`No API key for ${model.provider}`, "error");
				}
				return;
			}

			await showModelSelector(ctx);
		},
	});

	// Alias for convenience
	pi.registerCommand("models", {
		description: "Alias for /fav - select model with favourites",
		handler: async (args, ctx) => {
			// Just call the fav handler
			const favCmd = pi.getCommand("fav");
			if (favCmd) {
				await favCmd.handler(args, ctx);
			}
		},
	});

	pi.on("model_select", (event, ctx) => {
		if (isFavourite(event.model.provider, event.model.id, favourites)) {
			ctx.ui.setStatus("fav", "⭐");
		} else {
			ctx.ui.setStatus("fav", "");
		}
	});

	pi.on("session_start", (_event, ctx) => {
		if (favourites.models.length > 0 && ctx.model && isFavourite(ctx.model.provider, ctx.model.id, favourites)) {
			ctx.ui.setStatus("fav", "⭐");
		}
	});
}
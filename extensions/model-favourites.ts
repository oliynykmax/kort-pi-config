/**
 * Model Favourites Extension
 *
 * Live fuzzy search model selector like marketplace.
 *
 * Usage:
 * - Ctrl+M - Open live search selector (shows ~7 at a time)
 * - Type to filter models in real-time
 * - ↑↓ navigate, Enter select, Esc cancel
 * - Ctrl+F toggle favourite in selector
 * - /fav-toggle - Toggle current model as favourite
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

const FAVOURITES_FILE = join(process.env.HOME || "~", ".pi/agent/model-favourites.json");

interface FavouritesData {
	models: string[];
}

interface ModelInfo {
	provider: string;
	id: string;
	name?: string;
}

async function loadFavourites(): Promise<FavouritesData> {
	try {
		await access(FAVOURITES_FILE);
		const data = await readFile(FAVOURITES_FILE, "utf-8");
		return JSON.parse(data);
	} catch {
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
	}
	favourites.models.push(key);
	return true;
}

// Fuzzy match
function fuzzyMatch(text: string, pattern: string): boolean {
	if (!pattern) return true;
	const textLower = text.toLowerCase();
	const patternLower = pattern.toLowerCase();
	let ti = 0;
	for (const char of patternLower) {
		ti = textLower.indexOf(char, ti);
		if (ti === -1) return false;
		ti++;
	}
	return true;
}

class ModelSearchComponent implements Component {
	private models: ModelInfo[];
	private favourites: FavouritesData;
	private theme: Theme;
	private query = "";
	private cursorPos = 0;
	private selectedIndex = 0;
	private filteredModels: ModelInfo[] = [];
	private onSelect: (model: ModelInfo) => void;
	private onToggleFav: (model: ModelInfo) => void;
	private onCancel: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		models: ModelInfo[],
		favourites: FavouritesData,
		theme: Theme,
		onSelect: (model: ModelInfo) => void,
		onToggleFav: (model: ModelInfo) => void,
		onCancel: () => void
	) {
		this.models = models;
		this.favourites = favourites;
		this.theme = theme;
		this.onSelect = onSelect;
		this.onToggleFav = onToggleFav;
		this.onCancel = onCancel;
		this.updateFilter();
	}

	private updateFilter() {
		const query = this.query.trim();
		
		// Filter models
		let filtered = this.models.filter(m => {
			const searchText = `${m.name || m.id} ${m.provider} ${m.id}`;
			return fuzzyMatch(searchText, query);
		});

		// Sort: favourites first, then alphabetically
		filtered.sort((a, b) => {
			const aFav = isFavourite(a.provider, a.id, this.favourites);
			const bFav = isFavourite(b.provider, b.id, this.favourites);
			if (aFav !== bFav) return aFav ? -1 : 1;
			return (a.name || a.id).localeCompare(b.name || b.id);
		});

		this.filteredModels = filtered;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, filtered.length - 1));
		this.invalidate();
	}

	// Calculate which models to show in visible window (like marketplace)
	private computeVisibleWindow(): { startIdx: number; endIdx: number } {
		const maxVisible = 7; // Show 7 models at a time
		const total = this.filteredModels.length;
		const sel = this.selectedIndex;

		if (total === 0) return { startIdx: 0, endIdx: 0 };
		if (total <= maxVisible) return { startIdx: 0, endIdx: total };

		// Try to center selected item in the window
		let startIdx = Math.max(0, sel - Math.floor(maxVisible / 2));
		let endIdx = startIdx + maxVisible;

		// Adjust if we're at the end
		if (endIdx > total) {
			endIdx = total;
			startIdx = Math.max(0, endIdx - maxVisible);
		}

		return { startIdx, endIdx };
	}

	handleInput(data: string): void {
		// Cancel
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onCancel();
			return;
		}

		// Select
		if (matchesKey(data, "enter")) {
			if (this.filteredModels.length > 0) {
				this.onSelect(this.filteredModels[this.selectedIndex]);
			}
			return;
		}

		// Navigate
		if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.invalidate();
			}
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
			if (this.selectedIndex < this.filteredModels.length - 1) {
				this.selectedIndex++;
				this.invalidate();
			}
			return;
		}

		// Toggle favourite
		if (matchesKey(data, "ctrl+f")) {
			if (this.filteredModels.length > 0) {
				this.onToggleFav(this.filteredModels[this.selectedIndex]);
				this.updateFilter(); // Re-sort after toggle
			}
			return;
		}

		// Backspace
		if (matchesKey(data, "backspace") || data === "\x7f") {
			if (this.cursorPos > 0) {
				this.query = this.query.slice(0, this.cursorPos - 1) + this.query.slice(this.cursorPos);
				this.cursorPos--;
				this.updateFilter();
			}
			return;
		}

		// Clear all
		if (matchesKey(data, "ctrl+u")) {
			this.query = "";
			this.cursorPos = 0;
			this.updateFilter();
			return;
		}

		// Type character
		if (data.length === 1 && data >= " ") {
			this.query = this.query.slice(0, this.cursorPos) + data + this.query.slice(this.cursorPos);
			this.cursorPos++;
			this.updateFilter();
		}
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedLines) {
			return this.cachedLines;
		}

		const th = this.theme;
		const lines: string[] = [];

		// Header
		lines.push("");
		lines.push(truncateToWidth(th.fg("accent", " Model Selector ") + th.fg("dim", `— ${this.models.length} models`), width));
		lines.push("");

		// Search bar
		const prompt = th.fg("accent", "❯ ");
		const beforeCursor = th.fg("text", this.query.slice(0, this.cursorPos));
		const cursor = th.fg("accent", th.bold(this.query[this.cursorPos] || " "));
		const afterCursor = th.fg("dim", this.query.slice(this.cursorPos));
		const searchBar = prompt + beforeCursor + cursor + afterCursor;
		lines.push(truncateToWidth(searchBar, width));

		// Hint
		const hint = this.query
			? `${this.filteredModels.length} matches — ↑↓ navigate, Enter select, Ctrl+F fav, Esc quit`
			: `Type to search — ↑↓ navigate, Enter select, Ctrl+F fav, Esc quit`;
		lines.push(th.fg("dim", hint));
		lines.push("");

		// Results list (scrolling window of 7)
		const { startIdx, endIdx } = this.computeVisibleWindow();

		for (let i = startIdx; i < endIdx; i++) {
			const model = this.filteredModels[i];
			const isSelected = i === this.selectedIndex;
			const isFav = isFavourite(model.provider, model.id, this.favourites);
			
			const arrow = isSelected ? th.fg("accent", "▸ ") : "  ";
			const star = isFav ? "⭐ " : "";
			const name = isSelected 
				? th.fg("accent", th.bold(model.name || model.id)) 
				: th.fg("text", model.name || model.id);
			const provider = th.fg("muted", `(${model.provider})`);
			
			lines.push(truncateToWidth(arrow + star + name + " " + provider, width));
		}

		if (this.filteredModels.length === 0 && this.query) {
			lines.push(th.fg("dim", "  No matches found."));
		}

		if (endIdx < this.filteredModels.length) {
			lines.push(th.fg("dim", `  ... and ${this.filteredModels.length - endIdx} more`));
		}

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

export default function modelFavouritesExtension(pi: ExtensionAPI) {
	let favourites: FavouritesData = { models: [] };

	// Load favourites asynchronously on startup
	loadFavourites().then((data) => {
		favourites = data;
	});

	async function showModelSelector(ctx: ExtensionContext): Promise<void> {
		const allModels: ModelInfo[] = ctx.modelRegistry.getAll().map(m => ({
			provider: m.provider,
			id: m.id,
			name: m.name,
		}));

		await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
			const component = new ModelSearchComponent(
				allModels,
				favourites,
				theme,
				async (model) => {
					const fullModel = ctx.modelRegistry.find(model.provider, model.id);
					if (fullModel) {
						const success = await pi.setModel(fullModel);
						if (success) {
							ctx.ui.notify(`Switched to ${model.provider}/${model.id}`, "success");
						} else {
							ctx.ui.notify(`No API key for ${model.provider}`, "error");
						}
					}
					done();
				},
				async (model) => {
					const isNowFav = toggleFavourite(model.provider, model.id, favourites);
					await saveFavourites(favourites);
					ctx.ui.notify(isNowFav ? `⭐ Added to favourites` : `Removed from favourites`, isNowFav ? "success" : "info");
				},
				() => done()
			);
			return component;
		});
	}

	// Ctrl+M shortcut
	pi.registerShortcut("ctrl+m", {
		description: "Live search model selector (like marketplace)",
		handler: async (ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("This requires interactive mode", "error");
				return;
			}
			await showModelSelector(ctx);
		},
	});

	// /fav command
	pi.registerCommand("fav", {
		description: "Select model with live search. Usage: /fav [provider/model]",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("This command requires interactive mode", "error");
				return;
			}

			const trimmed = args.trim();
			if (trimmed) {
				// Direct model selection
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

			// Interactive selector
			await showModelSelector(ctx);
		},
	});

	// /fav-toggle command
	pi.registerCommand("fav-toggle", {
		description: "Toggle current model as favourite",
		handler: async (_args, ctx) => {
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const isNowFav = toggleFavourite(model.provider, model.id, favourites);
			await saveFavourites(favourites);

			if (isNowFav) {
				ctx.ui.notify(`⭐ ${model.name || model.id} added to favourites`, "success");
			} else {
				ctx.ui.notify(`Removed ${model.name || model.id} from favourites`, "info");
			}

			// Update status bar
			updateStatusBar(ctx);
		},
	});

	// Update status bar
	function updateStatusBar(ctx: ExtensionContext) {
		if (ctx.model && isFavourite(ctx.model.provider, ctx.model.id, favourites)) {
			ctx.ui.setStatus("fav", "⭐");
		} else {
			ctx.ui.setStatus("fav", "");
		}
	}

	// React to model changes
	pi.on("model_select", (event, ctx) => {
		updateStatusBar(ctx);
	});

	// Set status on session start
	pi.on("session_start", (_event, ctx) => {
		updateStatusBar(ctx);
	});
}

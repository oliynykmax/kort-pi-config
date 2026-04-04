/**
 * Model Favourites Extension
 *
 * Adds favourites support and search to model selection.
 * Favourites are shown at the top with a ⭐ marker.
 *
 * Usage:
 * - Ctrl+M - Search models, then select (favourites at top)
 * - /fav [model] - Select model or open selector with search
 * - /fav-toggle - Toggle current model as favourite
 * 
 * Tips:
 * - Search is case-insensitive and matches name/provider/id
 * - Press Enter on empty search to see all models
 * - Use arrow keys to scroll through results
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const FAVOURITES_FILE = join(process.env.HOME || "~", ".pi/agent/model-favourites.json");

interface FavouritesData {
	models: string[];
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

export default function modelFavouritesExtension(pi: ExtensionAPI) {
	let favourites: FavouritesData = { models: [] };

	// Load favourites asynchronously on startup
	loadFavourites().then((data) => {
		favourites = data;
	});

	async function showModelSelector(ctx: ExtensionContext): Promise<void> {
		const allModels = ctx.modelRegistry.getAll();
		
		// Ask for search filter (optional)
		const searchQuery = await ctx.ui.input("Search models (or press Enter for all):", "");
		if (searchQuery === null) return; // User cancelled
		
		// Filter models if search query provided
		const query = searchQuery?.trim().toLowerCase() || "";
		const filteredModels = query
			? allModels.filter(m => {
					const searchText = `${m.name || m.id} ${m.provider} ${m.id}`.toLowerCase();
					return searchText.includes(query);
			  })
			: allModels;
		
		if (filteredModels.length === 0) {
			ctx.ui.notify(`No models match "${searchQuery}"`, "error");
			return;
		}
		
		// Group models: favourites first, then by provider
		const favModels: typeof filteredModels = [];
		const regularByProvider = new Map<string, typeof filteredModels>();

		for (const model of filteredModels) {
			if (isFavourite(model.provider, model.id, favourites)) {
				favModels.push(model);
			} else {
				const providerModels = regularByProvider.get(model.provider) || [];
				providerModels.push(model);
				regularByProvider.set(model.provider, providerModels);
			}
		}

		// Build options list
		const options: string[] = [];
		const modelMap = new Map<string, typeof filteredModels[0]>();

		if (favModels.length > 0) {
			favModels.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
			for (const model of favModels) {
				const label = `⭐ ${model.name || model.id}`;
				options.push(label);
				modelMap.set(label, model);
			}
			if (regularByProvider.size > 0) {
				options.push("---"); // Separator only if there are regular models too
			}
		}

		const sortedProviders = [...regularByProvider.keys()].sort();
		for (const provider of sortedProviders) {
			const providerModels = regularByProvider.get(provider)!;
			providerModels.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
			
			for (const model of providerModels) {
				const label = `${model.name || model.id} (${provider})`;
				options.push(label);
				modelMap.set(label, model);
			}
		}
		
		const title = query 
			? `Select model (${filteredModels.length} matches for "${searchQuery}")`
			: `Select model (${filteredModels.length} total)`;

		const choice = await ctx.ui.select(title, options);
		if (!choice || choice === "---") return;

		const model = modelMap.get(choice);
		if (model) {
			const success = await pi.setModel(model);
			if (success) {
				ctx.ui.notify(`Switched to ${model.provider}/${model.id}`, "success");
			} else {
				ctx.ui.notify(`No API key for ${model.provider}`, "error");
			}
		}
	}

	// Ctrl+M shortcut
	pi.registerShortcut("ctrl+m", {
		description: "Search and select model (favourites at top)",
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
		description: "Select model with favourites. Usage: /fav [provider/model]",
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

/**
 * Model Favourites Extension
 *
 * Simple favourites management for models.
 * Adds ⭐ to status bar when using a favourite model.
 *
 * Usage:
 * - /fav-add - Add current model to favourites
 * - /fav-remove - Remove current model from favourites
 * - /fav-list - List all favourite models
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

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

export default function modelFavouritesExtension(pi: ExtensionAPI) {
	let favourites: FavouritesData = { models: [] };

	// Load favourites asynchronously on startup
	loadFavourites().then((data) => {
		favourites = data;
	});

	// Update status bar helper
	function updateStatusBar(ctx: ExtensionContext) {
		if (ctx.model && isFavourite(ctx.model.provider, ctx.model.id, favourites)) {
			ctx.ui.setStatus("fav", "⭐");
		} else {
			ctx.ui.setStatus("fav", "");
		}
	}

	// Add current model to favourites
	pi.registerCommand("fav-add", {
		description: "Add current model to favourites",
		handler: async (_args, ctx) => {
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const key = formatModelKey(model.provider, model.id);
			if (favourites.models.includes(key)) {
				ctx.ui.notify(`${model.name || model.id} is already a favourite`, "info");
				return;
			}

			favourites.models.push(key);
			await saveFavourites(favourites);
			ctx.ui.notify(`⭐ Added ${model.name || model.id} to favourites`, "success");
			updateStatusBar(ctx);
		},
	});

	// Remove current model from favourites
	pi.registerCommand("fav-remove", {
		description: "Remove current model from favourites",
		handler: async (_args, ctx) => {
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const key = formatModelKey(model.provider, model.id);
			const idx = favourites.models.indexOf(key);
			if (idx === -1) {
				ctx.ui.notify(`${model.name || model.id} is not a favourite`, "info");
				return;
			}

			favourites.models.splice(idx, 1);
			await saveFavourites(favourites);
			ctx.ui.notify(`Removed ${model.name || model.id} from favourites`, "info");
			updateStatusBar(ctx);
		},
	});

	// List all favourites
	pi.registerCommand("fav-list", {
		description: "List all favourite models",
		handler: async (_args, ctx) => {
			if (favourites.models.length === 0) {
				ctx.ui.notify("No favourite models", "info");
				return;
			}

			const allModels = ctx.modelRegistry.getAll();
			const favModels = favourites.models
				.map(key => {
					const [provider, ...idParts] = key.split("/");
					const id = idParts.join("/");
					const model = allModels.find(m => m.provider === provider && m.id === id);
					return model ? `⭐ ${model.name || model.id} (${provider})` : `⭐ ${key} (not available)`;
				})
				.join("\n");

			ctx.ui.notify(`Favourite models:\n${favModels}`, "info");
		},
	});

	// React to model changes
	pi.on("model_select", (event, ctx) => {
		updateStatusBar(ctx);
	});

	// Set status on session start
	pi.on("session_start", (_event, ctx) => {
		updateStatusBar(ctx);
	});
}

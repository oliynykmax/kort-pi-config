/**
 * Grill Me skill extension.
 *
 * Implementation of Matt Pocock's grill-me skill for pi.
 * Relentlessly interviews the user about plans/designs until reaching shared understanding.
 *
 * Usage: /grill-me [topic] - start grilling session
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export default function grillMeExtension(pi: ExtensionAPI) {
	pi.registerCommand("grill-me", {
		description: "Interview relentlessly about plans/designs until shared understanding",
		handler: async (args, ctx) => {
			const topic = args.trim();
			if (!topic) {
				ctx.ui.notify("Usage: /grill-me [topic/plan/design]", "error");
				return;
			}

			await startGrillSession(topic, ctx);
		},
	});
}

async function startGrillSession(topic: string, ctx: ExtensionCommandContext): Promise<void> {
	ctx.ui.notify(`Starting grill session: ${topic}`, "info");
	
	// Set up grill-me prompt
	const grillPrompt = createGrillPrompt(topic);
	
	// Ask the first question
	await ctx.ui.input(grillPrompt, "");
}

function createGrillPrompt(topic: string): string {
	return `Interview me relentlessly about every aspect of this plan until
we reach a shared understanding. Walk down each branch of the design
tree resolving dependencies between decisions one by one.

If a question can be answered by exploring the codebase, explore
the codebase instead.

For each question, provide your recommended answer.

Topic: ${topic}`;
}

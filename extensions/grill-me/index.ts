/**
 * Grill Me Extension
 *
 * Implementation of Matt Pocock's grill-me skill for pi.
 * Relentlessly interviews the user about plans/designs until reaching shared understanding.
 *
 * Usage: /grill-me [topic] - start grilling session
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function grillMeExtension(pi: ExtensionAPI) {
	pi.registerCommand("grill-me", {
		description: "Interview relentlessly about plans/designs until shared understanding",
		handler: async (args, ctx) => {
			const topic = args.trim();
			if (!topic) {
				ctx.ui.notify("Usage: /grill-me <topic/plan/design>", "error");
				return;
			}

			const grillPrompt = createGrillPrompt(topic);
			ctx.ui.notify(`Starting grill session: ${topic}`, "info");
			
			// Send the grilling instruction to the agent
			pi.sendUserMessage(grillPrompt);
		},
	});
}

function createGrillPrompt(topic: string): string {
	return `I need you to interview me relentlessly about every aspect of this plan until we reach a shared understanding.

Your role:
- Walk down each branch of the design tree resolving dependencies between decisions one by one
- If a question can be answered by exploring the codebase, explore the codebase instead of asking me
- For each question you ask, provide your recommended answer based on the codebase
- Keep drilling down until all ambiguities are resolved
- Challenge assumptions and identify potential issues
- Don't accept vague answers - demand specifics

Topic: ${topic}

Begin by analyzing the codebase context, then start asking focused questions about the implementation details, dependencies, edge cases, and design decisions.`;
}

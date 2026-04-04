import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const COMPACT_THRESHOLD_TOKENS = 100_000;

export default function (pi: ExtensionAPI) {
	let previousTokens = 0;

	const triggerCompaction = (ctx: ExtensionContext, customInstructions?: string) => {
		if (ctx.hasUI) {
			ctx.ui.notify("Compaction started", "info");
		}
		ctx.compact({
			customInstructions,
			onComplete: () => {
				if (ctx.hasUI) {
					ctx.ui.notify("Compaction completed", "success");
				}
			},
			onError: (error) => {
				if (ctx.hasUI) {
					ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
				}
			},
		});
	};

	pi.on("turn_end", (_event, ctx) => {
		const usage = ctx.getContextUsage();
		const currentTokens = usage?.tokens ?? 0;
		
		// Only trigger if we just crossed the threshold
		const crossedThreshold = previousTokens < COMPACT_THRESHOLD_TOKENS && currentTokens >= COMPACT_THRESHOLD_TOKENS;
		previousTokens = currentTokens;

		if (crossedThreshold) {
			triggerCompaction(ctx);
		}
	});

	// Reset token tracking on session changes
	pi.on("session_start", () => {
		previousTokens = 0;
	});
	
	pi.on("session_switch", () => {
		previousTokens = 0;
	});

	pi.registerCommand("trigger-compact", {
		description: "Trigger compaction immediately with optional custom instructions",
		handler: async (args, ctx) => {
			const instructions = args.trim() || undefined;
			triggerCompaction(ctx, instructions);
		},
	});
}

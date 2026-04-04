import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";

const PROVIDER = "opencode-zen";
const BASE_URL = "https://opencode.ai/zen/v1";
const API_KEY = "OPENCODE_ZEN_API_KEY";

const FREE_MODELS = [
	{
		id: "opencode/minimax-m2.5-free",
		name: "MiniMax M2.5 Free",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "opencode/mimo-v2-pro-free",
		name: "MiMo V2 Pro Free",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	{
		id: "opencode/mimo-v2-omni-free",
		name: "MiMo V2 Omni Free",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	{
		id: "opencode/qwen3.6-plus-free",
		name: "Qwen3.6 Plus Free",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 8192,
	},
	{
		id: "opencode/nemotron-3-super-free",
		name: "Nemotron 3 Super Free",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 4096,
	},
	{
		id: "opencode/big-pickle",
		name: "Big Pickle (Free)",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
];

async function loginOpenCodeZen(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const key = (await callbacks.onPrompt({ message: "Paste your OpenCode Zen API key:" })).trim();
	if (!key) throw new Error("No OpenCode Zen API key provided");

	return {
		access: key,
		refresh: key,
		expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
	};
}

async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	return credentials;
}

export default function openCodeZenProvider(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		pi.registerProvider(PROVIDER, {
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			api: "openai-completions",
			models: FREE_MODELS.map((model) => ({ ...model })),
			oauth: {
				name: "OpenCode Zen",
				login: loginOpenCodeZen,
				refreshToken: refreshToken,
				getApiKey: (cred) => cred.access,
			},
		});
	});

	pi.registerCommand("zen-models", {
		description: "List available OpenCode Zen free models",
		handler: async (_args, ctx) => {
			const modelsList = FREE_MODELS.map((m) => `- ${m.name} (${m.id})`).join("\n");
			ctx.ui.notify(`OpenCode Zen Free Models:\n${modelsList}\n\nSign up at https://opencode.ai/auth`, "info");
		},
	});
}

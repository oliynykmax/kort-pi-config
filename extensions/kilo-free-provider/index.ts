import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";

const PROVIDER = "kilo-free";
const BASE_URL = "https://api.kilo.ai/api/gateway";

const FREE_MODELS = [
	{
		id: "kilo-auto/free",
		name: "Kilo Auto Free",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	{
		id: "kilo-auto/balanced",
		name: "Kilo Auto Balanced",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0.3, output: 0.3, cacheRead: 0.03, cacheWrite: 0.03 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	{
		id: "openrouter/auto",
		name: "OpenRouter Auto",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
	},
	{
		id: "deepseek/deepseek-coder-v2-free",
		name: "DeepSeek Coder V2 Free",
		reasoning: false,
		input: ["text"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
	},
	{
		id: "qwen/qwen-coder-plus",
		name: "Qwen Coder Plus",
		reasoning: false,
		input: ["text", "image"] as const,
		cost: { input: 0.2, output: 0.2, cacheRead: 0.02, cacheWrite: 0.02 },
		contextWindow: 100000,
		maxTokens: 8192,
	},
];

async function loginKilo(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const key = (await callbacks.onPrompt({ message: "Paste your Kilo API key (or press enter for anonymous):" })).trim();
	
	if (!key) {
		return {
			access: "anonymous",
			refresh: "anonymous",
			expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
		};
	}

	return {
		access: key,
		refresh: key,
		expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
	};
}

async function refreshKiloToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	return credentials;
}

export default function kiloFreeProvider(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		pi.registerProvider(PROVIDER, {
			baseUrl: BASE_URL,
			apiKey: "KILO_API_KEY",
			api: "openai-completions",
			models: FREE_MODELS.map((model) => ({ ...model })),
			oauth: {
				name: "Kilo Free",
				login: loginKilo,
				refreshToken: refreshKiloToken,
				getApiKey: (cred) => cred.access,
			},
		});
	});

	pi.registerCommand("free-models", {
		description: "List available free models",
		handler: async (_args, ctx) => {
			const modelsList = FREE_MODELS.map((m) => `- ${m.name} (${m.id})`).join("\n");
			ctx.ui.notify(`Available free models:\n${modelsList}`, "info");
		},
	});
}

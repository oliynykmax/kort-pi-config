import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROVIDER = "openrouter";
const BASE_URL = "https://openrouter.ai/api/v1";
const API_KEY = "OPENROUTER_API_KEY";

async function loginOpenRouter(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const key = (await callbacks.onPrompt({ message: "Paste your OpenRouter API key:" })).trim();
	if (!key) throw new Error("No OpenRouter API key provided");

	return {
		access: key,
		refresh: key,
		expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
	};
}

async function refreshOpenRouterToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	return credentials;
}

const FALLBACK_MODELS = [
	{
		id: "openrouter/auto",
		name: "OpenRouter Auto",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
		compat: { thinkingFormat: "openrouter" as const },
	},
	{
		id: "openrouter/free",
		name: "OpenRouter Free Router",
		reasoning: true,
		input: ["text", "image"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
		compat: { thinkingFormat: "openrouter" as const },
	},
];

export default function openRouterProvider(pi: ExtensionAPI) {
	let registered = false;

	pi.on("session_start", async (_event, ctx) => {
		if (registered) return;
		registered = true;

		const hasBuiltInOpenRouterModels = ctx.modelRegistry.getAll().some((model) => model.provider === PROVIDER);

		if (hasBuiltInOpenRouterModels) {
			// Keep the full built-in model catalog and only enforce provider auth/base URL.
			pi.registerProvider(PROVIDER, {
				baseUrl: BASE_URL,
				apiKey: API_KEY,
				oauth: {
					name: "OpenRouter",
					login: loginOpenRouter,
					refreshToken: refreshOpenRouterToken,
					getApiKey: (cred) => cred.access,
				},
			});
			return;
		}

		// Fallback for pi versions without built-in OpenRouter models.
		pi.registerProvider(PROVIDER, {
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			api: "openai-completions",
			models: FALLBACK_MODELS.map((model) => ({ ...model })),
			oauth: {
				name: "OpenRouter",
				login: loginOpenRouter,
				refreshToken: refreshOpenRouterToken,
				getApiKey: (cred) => cred.access,
			},
		});
	});
}

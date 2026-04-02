import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function initAgentsExtension(pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description: "Guided AGENTS.md setup (agent-driven)",
    handler: async (args, ctx) => {
      const extraFocus = args.trim();

      const prompt = [
        "Run a guided AGENTS.md setup for this repository.",
        "",
        "Required workflow:",
        "1) Inspect the repository first (use read/find/ls/grep and package files).",
        "2) Infer what an agent actually needs: stack, commands, validation, folder map, constraints, and definition of done.",
        "3) If critical info is unclear, ask a short list of targeted questions (max 5).",
        "4) After answers are available, create or update AGENTS.md at repo root.",
        "",
        "Rules:",
        "- Keep AGENTS.md plain, direct, and operational.",
        "- Do not include secrets or tokens.",
        "- Prefer repo-specific commands over generic placeholders.",
        "- If AGENTS.md already exists, merge carefully and preserve useful project-specific rules.",
      ].join("\n");

      const withFocus = extraFocus
        ? `${prompt}\n\nAdditional focus from user: ${extraFocus}`
        : prompt;

      pi.sendUserMessage(withFocus);
      ctx.ui.notify("Started guided /init. Agent will inspect repo and create AGENTS.md.", "info");
    },
  });
}

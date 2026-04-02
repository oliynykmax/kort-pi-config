import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function initAgentsExtension(pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description: "Guided AGENTS.md setup (agent-driven)",
    handler: async (args, ctx) => {
      const extraFocus = args.trim();
      const repoPath = ctx.cwd;

      const prompt = `Create or update AGENTS.md for this repository.

Repository path: ${repoPath}

Goal:
Create a compact instruction file that helps future agent sessions avoid mistakes and ramp up fast.
Every line should answer: "Would an agent likely miss this without help?"

User-provided focus or constraints:
${extraFocus || "(none)"}

How to investigate:
- Read highest-value sources first: README*, root manifests, workspace config, lockfiles.
- Read build/test/lint/formatter/typecheck/codegen config.
- Read CI workflows and task runner/pre-commit config.
- Read existing instruction files: AGENTS.md, CLAUDE.md, .cursor/rules/, .cursorrules, .github/copilot-instructions.md.
- If architecture is still unclear, read a small number of representative entrypoint files.
- Prefer executable source-of-truth over prose when they conflict.

What to extract:
- Exact developer commands, especially non-obvious ones.
- How to run focused checks (single test/package/module).
- Required command order when it matters.
- Monorepo/package boundaries and real entrypoints.
- Toolchain quirks (codegen, migrations, env loading, artifacts).
- Repo-specific style/workflow conventions that differ from defaults.
- Test quirks and prerequisites.

Questions policy:
- Ask questions only if critical information cannot be derived from the repo.
- Ask one short batch only (max 5), using questionnaire tool.
- Do not ask about anything already clear from files.

Writing rules:
- Keep it short, direct, and repo-specific.
- Include only high-signal operational guidance.
- Exclude generic advice, tutorials, and speculative claims.
- Do not include secrets/tokens.
- If AGENTS.md exists, improve in place: preserve verified useful guidance, remove stale/fluffy text.

Then write AGENTS.md at repo root.`;

      pi.sendUserMessage(prompt);
      ctx.ui.notify("Started guided /init. Agent will inspect repo and create/update AGENTS.md.", "info");
    },
  });
}

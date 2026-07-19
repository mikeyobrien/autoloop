import { buildChainPlan, renderChainPlan } from "../chains/dry-run.js";
import * as chains from "../chains.js";
import { fail } from "../cli/fail.js";

export async function dispatchChain(
  args: string[],
  selfCmd: string,
): Promise<boolean> {
  const sub = args[0] ?? "";

  switch (sub) {
    case "list": {
      const projectDir = args[1] ?? resolveRuntimeProjectDir();
      const chainsData = chains.load(projectDir);
      const chainList = chains.listChains(chainsData);
      if (chainList.length === 0) {
        console.log(
          "No chains defined. Add [[chain]] sections to chains.toml.",
        );
        return true;
      }
      for (const chain of chainList) {
        const stepNames =
          chain.steps.map((s) => s.name).join(" -> ") || "(empty)";
        console.log(`${chain.name}: ${stepNames}`);
      }
      return true;
    }
    case "run": {
      const dryRun = args.includes("--dry-run");
      const asJson = args.includes("--json");
      const positional = args
        .slice(1)
        .filter((a) => a !== "--dry-run" && a !== "--json");
      const name = positional[0];
      if (!name) {
        console.log(
          "Usage: autoloop chain run <name> [project-dir] [prompt...] [--dry-run] [--json]",
        );
        return true;
      }
      const projectDir = positional[1] ?? resolveRuntimeProjectDir();
      const prompt = positional.slice(2).join(" ") || null;
      const chainsData = chains.load(projectDir);
      const chainSpec = chains.resolveChain(chainsData, name);
      if (!chainSpec) {
        console.log(`chain \`${name}\` not found in chains.toml`);
        process.exitCode = 1;
        return true;
      }
      if (dryRun) {
        const plan = buildChainPlan(chainSpec, chainsData.budget);
        if (asJson) console.log(JSON.stringify(plan, null, 2));
        else console.log(renderChainPlan(plan));
        if (!plan.validation.ok) process.exitCode = 1;
        return true;
      }
      await chains.runChain(chainSpec, projectDir, selfCmd, {
        prompt: normalizePrompt(prompt),
      });
      return true;
    }
    default:
      if (sub === "" || sub === "--help" || sub === "-h") {
        console.log("Usage:");
        console.log("  autoloop chain list [project-dir]");
        console.log(
          "  autoloop chain run <name> [project-dir] [prompt...] [--dry-run] [--json]",
        );
        return true;
      }
      fail([
        `error: unknown chain subcommand \`${sub}\``,
        "Usage:",
        "  autoloop chain list [project-dir]",
        "  autoloop chain run <name> [project-dir] [prompt...] [--dry-run] [--json]",
      ]);
      return true;
  }
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}

function normalizePrompt(prompt: string | null): string | null {
  if (prompt === null || prompt === "") return null;
  return prompt;
}

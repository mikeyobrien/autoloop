import * as chains from "../chains.js";

export function dispatchChain(args: string[], selfCmd: string): boolean {
  const sub = args[0] ?? "";

  switch (sub) {
    case "list": {
      const projectDir = args[1] ?? resolveRuntimeProjectDir();
      const chainsData = chains.load(projectDir);
      const chainList = chains.listChains(chainsData);
      if (chainList.length === 0) {
        console.log("No chains defined. Add [[chain]] sections to chains.toml.");
        return true;
      }
      for (const chain of chainList) {
        const stepNames = chain.steps.map((s) => s.name).join(" -> ") || "(empty)";
        console.log(chain.name + ": " + stepNames);
      }
      return true;
    }
    case "run": {
      const name = args[1];
      if (!name) { console.log("Usage: autoloop chain run <name> [project-dir] [prompt...]"); return true; }
      const projectDir = args[2] ?? resolveRuntimeProjectDir();
      const prompt = args.slice(3).join(" ") || null;
      const chainsData = chains.load(projectDir);
      const chainSpec = chains.resolveChain(chainsData, name);
      if (!chainSpec) {
        console.log("chain `" + name + "` not found in chains.toml");
        return true;
      }
      chains.runChain(chainSpec, projectDir, selfCmd, { prompt: normalizePrompt(prompt) });
      return true;
    }
    case "--help":
    case "-h":
    default:
      console.log("Usage:");
      console.log("  autoloop chain list [project-dir]");
      console.log("  autoloop chain run <name> [project-dir] [prompt...]");
      return true;
  }
}

function resolveRuntimeProjectDir(): string {
  return process.env["MINILOOPS_PROJECT_DIR"] || ".";
}

function normalizePrompt(prompt: string | null): string | null {
  if (prompt === null || prompt === "") return null;
  return prompt;
}

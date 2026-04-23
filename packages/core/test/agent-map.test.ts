import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentMap, resolveRoleAgent } from "../src/agent-map.js";

function tmpDir(): string {
  const dir = join(
    tmpdir(),
    "agent-map-test-" + Math.random().toString(36).slice(2),
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadAgentMap", () => {
  it("returns null when agents.toml does not exist", () => {
    expect(loadAgentMap(tmpDir())).toBeNull();
  });

  it("parses agents.toml with defaults and presets", () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, "agents.toml"),
      `
[defaults]
agent = "gpu-dev"

[preset.autocode]
default = "gpu-dev"
planner = "gpu-multiagent-planner"
builder = "gpu-coder"
critic = "gpu-reviewer"
`,
    );
    const map = loadAgentMap(dir);
    expect(map).not.toBeNull();
    expect(map!.globalDefault).toBe("gpu-dev");
    expect(map!.presets["autocode"].defaultAgent).toBe("gpu-dev");
    expect(map!.presets["autocode"].roles["planner"]).toBe(
      "gpu-multiagent-planner",
    );
    expect(map!.presets["autocode"].roles["builder"]).toBe("gpu-coder");
    expect(map!.presets["autocode"].roles["critic"]).toBe("gpu-reviewer");
  });
});

describe("resolveRoleAgent", () => {
  const map = {
    globalDefault: "gpu-dev",
    presets: {
      autocode: {
        defaultAgent: "gpu-minimal",
        roles: { planner: "gpu-multiagent-planner", builder: "gpu-coder" },
      },
    },
  };

  it("resolves role-specific agent", () => {
    expect(resolveRoleAgent(map, "autocode", "planner")).toBe(
      "gpu-multiagent-planner",
    );
    expect(resolveRoleAgent(map, "autocode", "builder")).toBe("gpu-coder");
  });

  it("falls back to preset default for unmapped role", () => {
    expect(resolveRoleAgent(map, "autocode", "critic")).toBe("gpu-minimal");
  });

  it("falls back to global default for unknown preset", () => {
    expect(resolveRoleAgent(map, "autofix", "diagnoser")).toBe("gpu-dev");
  });

  it("returns undefined when no agent map", () => {
    expect(resolveRoleAgent(null, "autocode", "planner")).toBeUndefined();
  });

  it("returns undefined when global default is empty and preset not found", () => {
    const emptyMap = { globalDefault: "", presets: {} };
    expect(resolveRoleAgent(emptyMap, "autocode", "planner")).toBeUndefined();
  });
});

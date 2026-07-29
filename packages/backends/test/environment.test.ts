import { delimiter, join } from "node:path";
import {
  resolveBackendEnvironment,
  sanitizeBackendEnvironment,
} from "@mobrienv/autoloop-backends/environment";
import { describe, expect, it } from "vitest";

describe("sanitizeBackendEnvironment", () => {
  it("removes process injection and Git override variables", () => {
    const env = sanitizeBackendEnvironment(
      {
        PATH: "/usr/bin:/bin",
        HOME: "/home/agent",
        NORMAL_PROJECT_FLAG: "enabled",
        NODE_OPTIONS: "--require ./owned.js",
        node_path: "./case-insensitive-owned-node-path",
        PYTHONPATH: "./owned-python",
        LD_PRELOAD: "/tmp/owned.so",
        LD_AUDIT: "/tmp/owned-audit.so",
        LD_DEBUG: "all",
        DYLD_INSERT_LIBRARIES: "/tmp/owned.dylib",
        "BASH_FUNC_owned%%": "() { echo injected; }",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_PARAMETERS: "'alias.pwn=!echo injected'",
        GIT_CONFIG_KEY_0: "core.sshCommand",
        GIT_CONFIG_VALUE_0: "./owned-ssh",
        GIT_EXTERNAL_DIFF: "./owned-diff",
        GIT_SSH: "./owned-ssh-legacy",
        GIT_PAGER: "./owned-pager",
        GIT_EDITOR: "./owned-editor",
        GIT_SEQUENCE_EDITOR: "./owned-sequence-editor",
        GIT_SSH_COMMAND: "./owned-ssh",
      },
      { projectDir: "/workspace/project" },
    );

    expect(env.NORMAL_PROJECT_FLAG).toBe("enabled");
    expect(env.HOME).toBe("/home/agent");
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.node_path).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.LD_AUDIT).toBeUndefined();
    expect(env.LD_DEBUG).toBeUndefined();
    expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(env["BASH_FUNC_owned%%"]).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_0).toBeUndefined();
    expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
    expect(env.GIT_SSH).toBeUndefined();
    expect(env.GIT_PAGER).toBeUndefined();
    expect(env.GIT_EDITOR).toBeUndefined();
    expect(env.GIT_SEQUENCE_EDITOR).toBeUndefined();
    expect(env.GIT_SSH_COMMAND).toBeUndefined();
  });

  it("removes relative and repository-owned PATH entries", () => {
    const projectDir = "/workspace/project";
    const env = sanitizeBackendEnvironment(
      {
        PATH: [
          ".",
          "bin",
          join(projectDir, "node_modules", ".bin"),
          "/usr/local/bin",
          "/usr/bin",
        ].join(delimiter),
      },
      { projectDir },
    );

    expect(env.PATH?.split(delimiter)).toEqual(["/usr/local/bin", "/usr/bin"]);
  });

  it("rejects credential-bearing proxy URLs instead of forwarding them", () => {
    expect(() =>
      sanitizeBackendEnvironment(
        {
          PATH: "/usr/bin",
          HTTPS_PROXY: "https://user:secret@proxy.example:8443",
        },
        { projectDir: "/workspace/project" },
      ),
    ).toThrow(/credential-bearing proxy/i);
  });

  it("preserves credential-free proxy URLs", () => {
    const env = sanitizeBackendEnvironment(
      {
        PATH: "/usr/bin",
        HTTPS_PROXY: "https://proxy.example:8443",
        NO_PROXY: "localhost,127.0.0.1",
      },
      { projectDir: "/workspace/project" },
    );

    expect(env.HTTPS_PROXY).toBe("https://proxy.example:8443");
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1");
  });
});

describe("resolveBackendEnvironment", () => {
  it("inherits the exact source environment by default", () => {
    const source = {
      PATH: "/workspace/project/node_modules/.bin:/usr/bin",
      NODE_OPTIONS: "--require ./project-hook.js",
      GIT_SSH_COMMAND: "ssh -i ./project-key",
      HTTPS_PROXY: "https://user:secret@proxy.example:8443",
    };

    expect(
      resolveBackendEnvironment(source, {
        projectDir: "/workspace/project",
      }),
    ).toBe(source);
  });

  it("sanitizes only when hardened is explicit", () => {
    const env = resolveBackendEnvironment(
      {
        PATH: "/workspace/project/node_modules/.bin:/usr/bin",
        NODE_OPTIONS: "--require ./project-hook.js",
      },
      { projectDir: "/workspace/project", policy: "hardened" },
    );
    expect(env.PATH).toBe("/usr/bin");
    expect(env.NODE_OPTIONS).toBeUndefined();
  });
});

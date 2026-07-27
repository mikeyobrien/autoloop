import { delimiter, join } from "node:path";
import { sanitizeBackendEnvironment } from "@mobrienv/autoloop-backends/environment";
import { describe, expect, it } from "vitest";

describe("sanitizeBackendEnvironment", () => {
  it("removes process injection and Git override variables", () => {
    const env = sanitizeBackendEnvironment(
      {
        PATH: "/usr/bin:/bin",
        HOME: "/home/agent",
        NORMAL_PROJECT_FLAG: "enabled",
        NODE_OPTIONS: "--require ./owned.js",
        PYTHONPATH: "./owned-python",
        LD_PRELOAD: "/tmp/owned.so",
        DYLD_INSERT_LIBRARIES: "/tmp/owned.dylib",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.sshCommand",
        GIT_CONFIG_VALUE_0: "./owned-ssh",
        GIT_SSH_COMMAND: "./owned-ssh",
      },
      { projectDir: "/workspace/project" },
    );

    expect(env.NORMAL_PROJECT_FLAG).toBe("enabled");
    expect(env.HOME).toBe("/home/agent");
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_0).toBeUndefined();
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

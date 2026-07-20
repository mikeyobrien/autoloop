import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createJsonlTasksApi: vi.fn(() => ({ kind: "tasks-api" })),
  pull: vi.fn(),
  push: vi.fn(),
  release: vi.fn(),
  resolveIssueSyncPaths: vi.fn(),
}));

vi.mock("@mobrienv/autoloop-issue-sync-core", () => mocks);

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("gh-sync CLI resolved paths", () => {
  it("uses resolver-provided config, tasks, and state paths for every command", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "gh-sync-cli-paths-"));
    const configFile = join(projectDir, "issue-sync.toml");
    const tasksFile = join(projectDir, "runtime", "queue.jsonl");
    const stateFile = join(projectDir, "runtime", "sync-state.json");
    const originalArgv = process.argv;
    const originalProjectDir = process.env.AUTOLOOP_PROJECT_DIR;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    writeFileSync(configFile, 'repo = "owner/repo"\nqueued_label = "ready"\n');
    mocks.resolveIssueSyncPaths.mockReturnValue({
      stateDir: join(projectDir, "runtime"),
      configFile,
      tasksFile,
      stateFile,
    });
    mocks.pull.mockResolvedValue({ added: 0, addedIssues: [] });
    mocks.push.mockResolvedValue({
      transitioned: 0,
      created: 0,
      promoted: 0,
      transitionedIssues: [],
      createdIssues: [],
      promotedIssues: [],
    });
    mocks.release.mockResolvedValue({ promoted: 0, promotedIssues: [] });
    process.env.AUTOLOOP_PROJECT_DIR = projectDir;

    try {
      process.argv = ["node", "autoloop-gh-sync", "pull"];
      await import("../src/cli.js");
      await vi.waitFor(() => expect(mocks.pull).toHaveBeenCalledOnce());

      vi.resetModules();
      process.argv = [
        "node",
        "autoloop-gh-sync",
        "push",
        "--release",
        "--no-archive",
      ];
      await import("../src/cli.js");
      await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());

      vi.resetModules();
      process.argv = [
        "node",
        "autoloop-gh-sync",
        "release",
        "v1.2.3",
        "--no-archive",
      ];
      await import("../src/cli.js");
      await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce());

      expect(mocks.resolveIssueSyncPaths).toHaveBeenCalledTimes(3);
      expect(mocks.resolveIssueSyncPaths).toHaveBeenCalledWith(projectDir);
      expect(mocks.createJsonlTasksApi).toHaveBeenCalledWith(tasksFile);
      expect(mocks.pull.mock.calls[0][3]).toBe(stateFile);
      expect(mocks.push.mock.calls[0][3]).toBe(stateFile);
      expect(mocks.push.mock.calls[0][5]).toEqual({
        release: true,
        archive: false,
      });
      expect(mocks.release.mock.calls[0][2]).toBe(stateFile);
      expect(mocks.release.mock.calls[0][3]).toBe("v1.2.3");
      expect(mocks.release.mock.calls[0][6]).toEqual({ archive: false });
      expect(log).toHaveBeenCalledWith(
        "autoloop-gh-sync release: promoted 0 issue(s) to Done",
      );
    } finally {
      process.argv = originalArgv;
      if (originalProjectDir === undefined) {
        delete process.env.AUTOLOOP_PROJECT_DIR;
      } else {
        process.env.AUTOLOOP_PROJECT_DIR = originalProjectDir;
      }
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

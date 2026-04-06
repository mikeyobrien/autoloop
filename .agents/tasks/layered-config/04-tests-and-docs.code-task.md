# Task 4: Integration Tests and Documentation

**RFC:** `docs/rfcs/layered-config.md`
**Files to create:** `test/config/layered.test.ts`
**Files to modify:** existing test fixtures if needed
**Depends on:** Tasks 1, 3

## Objective

Comprehensive test coverage for the layered config feature and inline documentation for the user config file format.

## Steps

### 1. Unit tests: `test/config/layered.test.ts`

Use the existing test framework (vitest based on `test/` conventions). All tests should use `AUTOLOOP_CONFIG` env var pointed at temp files to isolate from the real filesystem.

**Test cases:**

```
describe("layered config")
  it("returns defaults when no config files exist")
  it("merges user config with defaults")
  it("merges project config over user config")
  it("project scalar overrides user scalar")
  it("user value inherited when project doesn't set it")
  it("deep merge works across sections")
  it("AUTOLOOP_CONFIG env var overrides user config path")
  it("missing AUTOLOOP_CONFIG path treated as empty")
  it("empty user config file produces no overrides")

describe("resolveUserConfigPath")
  it("returns AUTOLOOP_CONFIG when set")
  it("returns XDG path on non-Windows")
  it("respects XDG_CONFIG_HOME override")

describe("loadProjectWithProvenance")
  it("attributes default keys to 'default'")
  it("attributes user keys to user path")
  it("attributes project keys to project path")
  it("project provenance overrides user provenance for same key")
```

### 2. Integration test

Add a test to `test/integration/` that:
- Creates a temp dir with a project `autoloops.toml`
- Creates a temp user config file
- Sets `AUTOLOOP_CONFIG` to the temp user config
- Runs `autoloop config show` and verifies output contains provenance annotations
- Runs `autoloop config path` and verifies it prints the temp path

### 3. Regression test for backward compatibility

- Existing `test/registry/read-update.test.ts` and other config-touching tests must pass without modification
- If any test creates a `~/.config/autoloop/config.toml` fixture, it should be cleaned up

### 4. Documentation

In the RFC itself (already written), add a "User Guide" section or ensure the existing examples are sufficient. No separate docs file needed unless the project has a `docs/` convention beyond RFCs.

Add a brief comment at the top of the user config example in the RFC noting that `autoloop config path` shows where to create the file.

## Acceptance criteria

- All new tests pass
- All existing tests pass unchanged
- No test leaks state to `~/.config/autoloop/`
- Provenance tests verify correct attribution at each layer

# Regression tests — pass 1

All applied recommendations (R-001..R-010 + config-unset + run-help-guard) are
pinned by the project's own test suite in:

    test/integration/agent-surfaces-cli.test.ts   (23 tests)

plus updated assertions in:

    packages/cli/test/commands/inspect.test.ts
    packages/cli/test/commands/config-show.test.ts
    test/integration/loops-watch.test.ts

Run them with: npx vitest run test/integration/agent-surfaces-cli.test.ts
These tests fail against the pre-pass binary (errors were stdout + exit 0;
--version/capabilities/robot-docs/triage did not exist) and pass post-apply.

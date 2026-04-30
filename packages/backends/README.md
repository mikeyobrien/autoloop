# @mobrienv/autoloop-backends

Backend drivers for autoloop: the shell-command runner and the Kiro ACP bridge.

A "backend" is the thing that actually executes a loop iteration's prompt.
Two flavors ship in this package:

- **shell / pi / mock** — one-shot `execSync` through `runShellCommand`. The
  prompt is either piped on stdin or appended as an argv. Exit code + stdout
  are mapped onto a `BackendRunResult`.
- **kiro** — a persistent ACP session held by a worker thread, driven via
  SharedArrayBuffer + Atomics from the sync main loop. See `kiro-bridge.ts`
  (main-thread API) and `kiro-worker.ts` (worker-thread loop).

The harness doesn't know about these internals — it calls:

```ts
import {
  buildBackendShellCommand,
  runBackendCommand,
  runKiroIterationSync,
  initKiroSession,
  terminateKiroSession,
} from "@mobrienv/autoloop-backends";
```

See `packages/harness/src/parallel.ts` / `iteration.ts` for wiring examples.

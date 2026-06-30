// Run-wide concurrency bound for fan-out branches.
//
// A dynamic-workflow preset can compose/nest fan-out stages whose branches are
// each a heavy external CLI process. Without an aggregate ceiling, a wide ultra
// run could spawn dozens of processes and exhaust RAM / provider rate limits.
// `Semaphore` caps concurrent branches run-wide; `mapLimit` runs a batch through
// it preserving result order. Pure (no I/O) so it is deterministically testable.

import { cpus } from "node:os";

/**
 * Default concurrency ceiling: conservative because each branch is a real CLI
 * process (not an in-process call). `min(8, cores - 2)`, floored at 1.
 */
export function defaultConcurrency(): number {
  const cores = cpus().length;
  return Math.max(1, Math.min(8, cores - 2));
}

/** A counting semaphore bounding how many tasks run at once. */
export class Semaphore {
  private readonly max: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  /** Acquire a slot; resolves to a release function (idempotent). */
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.releaser();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    return this.releaser();
  }

  /** Run `fn` while holding a slot, releasing even if it throws. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Slots currently held (for tests/telemetry). */
  inUse(): number {
    return this.active;
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

/**
 * Map `fn` over `items` with at most `limit` running concurrently, preserving
 * input order in the result. A rejecting `fn` rejects the whole call (callers
 * that want per-item isolation should catch inside `fn`).
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const sem = new Semaphore(limit);
  return Promise.all(
    items.map((item, index) => sem.run(() => fn(item, index))),
  );
}

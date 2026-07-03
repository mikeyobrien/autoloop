import { describe, expect, it } from "vitest";
import { defaultConcurrency, mapLimit, Semaphore } from "../src/concurrency.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("defaultConcurrency", () => {
  it("is at least 1 and at most 8", () => {
    const c = defaultConcurrency();
    expect(c).toBeGreaterThanOrEqual(1);
    expect(c).toBeLessThanOrEqual(8);
  });
});

describe("Semaphore", () => {
  it("never exceeds its max concurrency", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(sem.inUse()).toBe(0);
  });

  it("releases the slot even when the task throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Slot was released, so a subsequent task runs.
    await expect(sem.run(async () => 42)).resolves.toBe(42);
    expect(sem.inUse()).toBe(0);
  });

  it("treats max < 1 as 1", async () => {
    const sem = new Semaphore(0);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
        }),
      ),
    );
    expect(peak).toBe(1);
  });
});

describe("mapLimit", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapLimit([30, 10, 20, 5], 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    expect(out).toEqual([60, 20, 40, 10]);
  });

  it("bounds concurrency to the limit", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 10 }), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return null;
    });
    expect(peak).toBe(3);
  });

  it("passes the index to fn", async () => {
    const out = await mapLimit(
      ["a", "b", "c"],
      2,
      async (item, i) => `${i}:${item}`,
    );
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });
});

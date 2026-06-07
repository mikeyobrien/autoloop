import { describe, expect, it } from "vitest";
import { captureOutput } from "../../src/acp/capture.js";

describe("captureOutput", () => {
  it("captures console.log and console.error separately", async () => {
    const result = await captureOutput(() => {
      console.log("hello");
      console.info("info line");
      console.warn("warn line");
      console.error("oops");
    });
    expect(result.stdout).toContain("hello");
    expect(result.stdout).toContain("info line");
    expect(result.stderr).toContain("warn line");
    expect(result.stderr).toContain("oops");
  });

  it("captures process.stdout/stderr writes", async () => {
    const result = await captureOutput(() => {
      process.stdout.write("direct-out");
      process.stderr.write("direct-err");
    });
    expect(result.stdout).toBe("direct-out");
    expect(result.stderr).toBe("direct-err");
  });

  it("captures Uint8Array writes", async () => {
    const result = await captureOutput(() => {
      process.stdout.write(new TextEncoder().encode("bytes"));
    });
    expect(result.stdout).toBe("bytes");
  });

  it("invokes the write callback when passed as the third argument", async () => {
    let called = false;
    await captureOutput(() => {
      process.stdout.write("x", "utf8", () => {
        called = true;
      });
    });
    expect(called).toBe(true);
  });

  it("invokes the write callback so awaiting callers do not hang", async () => {
    let called = false;
    await captureOutput(() => {
      process.stdout.write("x", () => {
        called = true;
      });
    });
    expect(called).toBe(true);
  });

  it("reports the exit code set during the call and restores the prior one", async () => {
    const prior = process.exitCode;
    process.exitCode = 7;
    const result = await captureOutput(() => {
      process.exitCode = 3;
    });
    expect(result.exitCode).toBe(3);
    expect(process.exitCode).toBe(7);
    process.exitCode = prior;
  });

  it("restores console/stdout even when fn throws", async () => {
    const origLog = console.log;
    await expect(
      captureOutput(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(console.log).toBe(origLog);
  });

  it("serializes non-string console args as JSON", async () => {
    const result = await captureOutput(() => {
      console.log("obj", { a: 1 });
    });
    expect(result.stdout).toContain('{"a":1}');
  });

  it("handles circular objects without throwing", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = await captureOutput(() => {
      console.log(circular);
    });
    expect(result.stdout).toContain("[object Object]");
  });

  it("awaits async functions", async () => {
    const result = await captureOutput(async () => {
      await Promise.resolve();
      console.log("async done");
    });
    expect(result.stdout).toContain("async done");
  });
});

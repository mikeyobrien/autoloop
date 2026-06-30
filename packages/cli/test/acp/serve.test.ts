import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { nodeReadableToWeb, nodeWritableToWeb } from "../../src/acp/serve.js";

describe("serve stream adapters", () => {
  it("nodeReadableToWeb forwards string and buffer chunks then closes", async () => {
    const node = new PassThrough();
    const web = nodeReadableToWeb(node);
    const reader = web.getReader();

    node.write("abc");
    node.write(Buffer.from("def"));
    node.end();

    const chunks: string[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks.join("")).toBe("abcdef");
  });

  it("nodeReadableToWeb propagates errors", async () => {
    const node = new PassThrough();
    const web = nodeReadableToWeb(node);
    const reader = web.getReader();
    node.emit("error", new Error("stream boom"));
    await expect(reader.read()).rejects.toThrow("stream boom");
  });

  it("nodeReadableToWeb cancel destroys the source", async () => {
    const node = new PassThrough();
    const web = nodeReadableToWeb(node);
    await web.cancel();
    expect(node.destroyed).toBe(true);
  });

  it("nodeWritableToWeb writes chunks to the node stream", async () => {
    const node = new PassThrough();
    const seen: Buffer[] = [];
    node.on("data", (c: Buffer) => seen.push(c));
    const web = nodeWritableToWeb(node);
    const writer = web.getWriter();
    await writer.write(new TextEncoder().encode("payload"));
    expect(Buffer.concat(seen).toString()).toBe("payload");
  });
});

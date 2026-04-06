import { describe, expect, it } from "vitest";
import { encodeEvent } from "../../src/events/encode.js";
import { coordinationFromLines } from "../../src/harness/coordination.js";

describe("coordinationFromLines", () => {
  it("renders coordination state from payload events", () => {
    const lines = [
      encodeEvent({
        shape: "payload",
        run: "r1",
        topic: "issue.discovered",
        payload: "id=I1;summary=Bad thing;disposition=open;owner=rook",
        source: "agent",
      }),
      encodeEvent({
        shape: "payload",
        run: "r1",
        topic: "slice.started",
        payload: "id=S1;description=Do work",
        source: "agent",
      }),
      encodeEvent({
        shape: "payload",
        run: "r1",
        topic: "slice.committed",
        payload: "id=S1;commit_hash=abc123",
        source: "agent",
      }),
    ];
    const rendered = coordinationFromLines(lines);
    expect(rendered).toContain("Coordination State");
    expect(rendered).toContain("I1: Bad thing");
    expect(rendered).toContain("S1: Do work");
    expect(rendered).toContain("S1 → abc123");
  });
});

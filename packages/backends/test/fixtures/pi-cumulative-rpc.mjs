#!/usr/bin/env node

import { pathToFileURL } from "node:url";

function payload(cycle, bytes) {
  const prefix = `cycle-${cycle}:`;
  return prefix + "x".repeat(Math.max(0, bytes - prefix.length));
}

/**
 * Generate an exact event budget with realistic cumulative lifecycle snapshots.
 * Callers must serialize each yielded event before advancing the generator.
 */
export function* cumulativePiEvents(eventCount, payloadBytes = 384) {
  if (eventCount < 2) throw new Error("eventCount must be at least 2");

  const messages = [{ role: "user", content: "synthetic cumulative stream" }];
  const regularEventCount = eventCount - 2;

  for (let sequence = 0; sequence < regularEventCount; sequence += 1) {
    const cycle = Math.floor(sequence / 8);
    const text = payload(cycle, payloadBytes);
    const phase = sequence % 8;

    if (phase === 0) {
      yield {
        type: "message_update",
        sequence,
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: `thinking-${cycle}`,
        },
      };
    } else if (phase === 1) {
      yield {
        type: "message_update",
        sequence,
        assistantMessageEvent: { type: "text_delta", delta: `text-${cycle}` },
      };
    } else if (phase === 2) {
      const message = {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "thinking", thinking: `thinking-${cycle}` },
          { type: "text", text },
          {
            type: "toolCall",
            id: `tool-${cycle}`,
            name: "bash",
            arguments: { command: `echo ${cycle}` },
          },
        ],
      };
      messages.push(message);
      yield { type: "message_end", sequence, message, messages };
    } else if (phase === 3) {
      yield {
        type: "tool_execution_start",
        sequence,
        toolCallId: `tool-${cycle}`,
        toolName: "bash",
        args: { command: `echo ${cycle}` },
      };
    } else if (phase === 4) {
      yield {
        type: "tool_execution_update",
        sequence,
        toolCallId: `tool-${cycle}`,
        toolName: "bash",
        partialResult: {
          content: [{ type: "text", text: `partial-${cycle}` }],
        },
      };
    } else if (phase === 5) {
      yield {
        type: "tool_execution_end",
        sequence,
        toolCallId: `tool-${cycle}`,
        toolName: "bash",
        result: { content: [{ type: "text", text: `result-${cycle}` }] },
        isError: false,
      };
    } else if (phase === 6) {
      const message = {
        role: "toolResult",
        toolCallId: `tool-${cycle}`,
        content: [{ type: "text", text: `result-${cycle}` }],
      };
      messages.push(message);
      yield { type: "message_end", sequence, message, messages };
    } else {
      yield { type: "turn_end", sequence, messages };
    }
  }

  const errorSequence = eventCount - 2;
  yield {
    type: "message_update",
    sequence: errorSequence,
    assistantMessageEvent: {
      type: "error",
      reason: "synthetic final failure",
    },
  };

  const finalMessage = {
    role: "assistant",
    stopReason: "error",
    errorMessage: "synthetic final failure",
    content: [{ type: "text", text: "partial final answer" }],
  };
  messages.push(finalMessage);
  yield {
    type: "agent_end",
    sequence: eventCount - 1,
    messages,
  };
}

async function writeLine(record) {
  if (!process.stdout.write(`${JSON.stringify(record)}\n`)) {
    await new Promise((resolve) => process.stdout.once("drain", resolve));
  }
}

async function runRpcFixture() {
  const eventArg = process.argv.find((arg) =>
    arg.startsWith("--fixture-events="),
  );
  const payloadArg = process.argv.find((arg) =>
    arg.startsWith("--fixture-payload="),
  );
  const eventCount = Number(eventArg?.split("=")[1] ?? 4400);
  const payloadBytes = Number(payloadArg?.split("=")[1] ?? 384);
  let input = "";
  let commandQueue = Promise.resolve();

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    let newline = input.indexOf("\n");
    while (newline !== -1) {
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (line.trim()) {
        commandQueue = commandQueue.then(async () => {
          const command = JSON.parse(line);
          await writeLine({
            type: "response",
            id: command.id,
            command: command.type,
            success: true,
          });
          if (command.type === "prompt") {
            for (const event of cumulativePiEvents(eventCount, payloadBytes)) {
              await writeLine(event);
            }
          }
        });
      }
      newline = input.indexOf("\n");
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runRpcFixture();
}

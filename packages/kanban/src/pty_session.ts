import type { WebSocket } from "ws";

const KNOWN_OSC_CODES = new Set([
  0, 1, 2, 4, 8, 10, 11, 12, 52, 104, 110, 111, 112,
]);
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC sequence parsing requires ESC/BEL control chars
const OSC_RE = /\x1b\](\d+);[^\x07\x1b]*(?:\x07|\x1b\\)/g;
export function stripUnsupportedOsc(raw: string): string {
  return raw.replace(OSC_RE, (match, code) =>
    KNOWN_OSC_CODES.has(Number(code)) ? match : "",
  );
}

export class RingBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  constructor(private readonly maxBytes = 512 * 1024) {}
  push(s: string): void {
    if (!s) return;
    this.chunks.push(s);
    this.bytes += s.length;
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      if (dropped !== undefined) this.bytes -= dropped.length;
    }
  }
  getAll(): string[] {
    return this.chunks.slice();
  }
}

export interface PtyExitInfo {
  exitCode?: number;
  signal?: number;
}

export interface IPtyLike {
  onData(cb: (data: string) => void): void;
  /** node-pty emits `{exitCode, signal?}` on exit. Optional so synthetic
   *  adapters (e.g. a tmux-gone detector) can call without info. */
  onExit(cb: (e?: PtyExitInfo) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export class PtySession {
  private pty: IPtyLike;
  private buffer = new RingBuffer();
  private clients = new Set<WebSocket>();
  private alive = true;
  private idleKillTimer: NodeJS.Timeout | null = null;
  private readonly idleKillMs: number;
  private lastDataMsField: number = Date.now();

  get lastDataMs(): number {
    return this.lastDataMsField;
  }

  constructor(
    pty: IPtyLike,
    onExit: (e?: PtyExitInfo) => void,
    idleKillMs = 30_000,
  ) {
    this.pty = pty;
    this.idleKillMs = idleKillMs;
    this.pty.onData((raw) => {
      const data = stripUnsupportedOsc(raw);
      if (!data) return;
      this.lastDataMsField = Date.now();
      this.buffer.push(data);
      for (const c of this.clients) {
        if (c.readyState === 1) {
          try {
            c.send(data);
          } catch {
            /* will be detached on close event */
          }
        }
      }
    });
    this.pty.onExit((e) => {
      this.alive = false;
      if (this.idleKillTimer) clearTimeout(this.idleKillTimer);
      this.idleKillTimer = null;
      for (const c of this.clients) {
        try {
          c.close();
        } catch {
          /* already closed */
        }
      }
      onExit(e);
    });
  }

  attach(ws: WebSocket): void {
    if (this.idleKillTimer) {
      clearTimeout(this.idleKillTimer);
      this.idleKillTimer = null;
    }
    this.clients.add(ws);
    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.clients.size === 0 && this.alive && !this.idleKillTimer) {
        this.idleKillTimer = setTimeout(() => {
          this.idleKillTimer = null;
          if (this.clients.size === 0 && this.alive) {
            process.stderr.write(`[autoloop-term] PTY idle kill\n`);
            this.kill();
          }
        }, this.idleKillMs);
      }
    });
    for (const chunk of this.buffer.getAll()) {
      if (ws.readyState === 1) ws.send(chunk);
    }
  }

  write(data: string): void {
    if (this.alive) this.pty.write(data);
  }
  resize(cols: number, rows: number): void {
    if (this.alive) this.pty.resize(cols, rows);
  }
  kill(): void {
    if (this.alive) {
      this.alive = false;
      try {
        this.pty.kill();
      } catch {
        /* pty may already be dead */
      }
    }
  }
  isAlive(): boolean {
    return this.alive;
  }
}

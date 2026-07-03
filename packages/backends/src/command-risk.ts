// Harness-owned hard-deny floor: a deterministic classifier for catastrophic
// shell commands, plus the helpers backends use to wire it into their permission
// paths. This floor is intentionally NOT gated by `trustAllTools` /
// `bypassPermissions` — a preset cannot remove it. An operator (not a preset)
// may widen it via the AUTOLOOP_SAFETY_ALLOW allowlist; presets write config
// files, not the harness process environment, so they cannot reach it.

export interface CommandRisk {
  /** True when the command matches a catastrophic, irreversible-harm rule. */
  catastrophic: boolean;
  /** Stable machine id of the matched rule (for journaling/tests). */
  rule?: string;
  /** Human-readable explanation surfaced to the agent on denial. */
  reason?: string;
}

const SAFE: CommandRisk = { catastrophic: false };

function deny(rule: string, reason: string): CommandRisk {
  return { catastrophic: true, rule, reason };
}

/**
 * Classify a raw shell command string against the deterministic catastrophe
 * rules. Pure and side-effect free; the allowlist is applied separately by
 * {@link commandFloorDecision}. Errs toward denial when a known-catastrophic
 * pattern is present anywhere in the command (so `safe && rm -rf /` is denied).
 */
export function classifyCommandRisk(command: string): CommandRisk {
  if (typeof command !== "string") return SAFE;
  const s = command.replace(/\s+/g, " ").trim();
  if (!s) return SAFE;
  const lower = s.toLowerCase();
  const nospace = s.replace(/\s+/g, "");

  // Fork bomb: the classic `:(){ :|:& };:` (whitespace-insensitive).
  if (nospace.includes(":(){:|:&};:")) {
    return deny("fork-bomb", "fork bomb would exhaust system resources");
  }

  // rm -rf targeting root/home, or any rm that disables root protection.
  if (/\brm\b/.test(lower)) {
    const recursive =
      /\brm\b[^|;&]*\s-\w*r/.test(lower) || /--recursive/.test(lower);
    const force = /\brm\b[^|;&]*\s-\w*f/.test(lower) || /--force/.test(lower);
    const noPreserve = /--no-preserve-root/.test(lower);
    // Targets that wipe the whole machine or the home tree.
    const rootTarget =
      /\s\/(\s|$)/.test(s) || // a bare "/"
      /\s\/\*/.test(s) || // "/*"
      /\s~(\s|\/|$)/.test(s) || // "~" or "~/"
      /\$home\b/.test(lower) || // "$HOME"
      /\s\/(bin|etc|usr|var|lib|boot|sys|dev|home|root)(\s|\/|$)/.test(lower);
    if (noPreserve && (recursive || force)) {
      return deny(
        "rm-no-preserve-root",
        "rm with --no-preserve-root removes root protection",
      );
    }
    if (recursive && force && rootTarget) {
      return deny(
        "rm-rf-root",
        "recursive force-remove of a root/system/home path",
      );
    }
  }

  // Disk-destroying writes.
  if (/\bdd\b[^|;&]*\bof=\/dev\/(sd|nvme|disk|hd|mmcblk|vd)/.test(lower)) {
    return deny(
      "dd-to-device",
      "dd writing directly to a block device destroys data",
    );
  }
  if (/\bmkfs(\.\w+)?\b[^|;&]*\/dev\//.test(lower)) {
    return deny("mkfs-device", "mkfs reformats a block device");
  }
  if (/>\s*\/dev\/(sd|nvme|disk|hd|mmcblk|vd)/.test(lower)) {
    return deny(
      "redirect-to-device",
      "redirecting into a block device destroys data",
    );
  }
  if (/\bwipefs\b/.test(lower) && /\/dev\//.test(lower)) {
    return deny(
      "wipefs-device",
      "wipefs erases filesystem signatures from a device",
    );
  }

  // Pipe a network fetch straight into an interpreter.
  if (
    /\b(curl|wget|fetch)\b/.test(lower) &&
    /\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish|python3?|perl|ruby|node)\b/.test(
      lower,
    )
  ) {
    return deny(
      "pipe-to-shell",
      "piping a remote download into an interpreter executes untrusted code",
    );
  }

  // Secret / credential exfiltration over the network.
  const secretSource =
    /\b(printenv|env)\s*\|/.test(lower) ||
    /\.(env|netrc|pem)\b/.test(lower) ||
    /(\.aws\/|\.ssh\/|id_rsa|id_ed25519|id_ecdsa|credentials|secrets?\b|api[_-]?keys?\b|access[_-]?tokens?\b)/.test(
      lower,
    );
  const netSender = /\b(curl|wget|nc|ncat|netcat|telnet|scp|sftp)\b/.test(
    lower,
  );
  if (secretSource && netSender) {
    // A secret source piped into a network sender, or a secret file attached to
    // an upload flag — both indicate exfiltration rather than ordinary auth.
    const pipedToNet =
      /\|\s*(curl|wget|nc|ncat|netcat|telnet)\b/.test(lower) ||
      /\b(curl|wget)\b[^|]*(-d|--data|--data-binary|-f|--form|-t|--upload-file)\s*@?\S*(id_rsa|id_ed25519|\.aws|\.ssh|credentials|\.env|\.netrc|secret|token)/.test(
        lower,
      );
    if (pipedToNet) {
      return deny(
        "secret-exfil",
        "command appears to send secrets/credentials over the network",
      );
    }
  }

  // Force-push to a protected branch (force-with-lease is allowed).
  if (/\bgit\b/.test(lower) && /\bpush\b/.test(lower)) {
    const force =
      (/--force\b/.test(lower) && !/--force-with-lease/.test(lower)) ||
      /\s-\w*f\b/.test(lower);
    const protectedBranch =
      /\b(main|master|prod|production|release|stable)\b/.test(lower);
    if (force && protectedBranch) {
      return deny(
        "force-push-protected",
        "force-push to a protected branch can destroy shared history",
      );
    }
  }

  // Recursive chmod 777 of the filesystem root.
  if (
    /\bchmod\b/.test(lower) &&
    (/\s-\w*r/.test(lower) || /--recursive/.test(lower)) &&
    /\b0?777\b/.test(lower) &&
    /\s\/(\s|$)/.test(s)
  ) {
    return deny(
      "chmod-777-root",
      "recursive chmod 777 of / destroys filesystem permissions",
    );
  }

  return SAFE;
}

/**
 * The harness floor decision for a command: classify, then honor the
 * operator allowlist. An allowlist entry is a case-insensitive substring; if
 * the command contains one, the command is permitted even if a rule matched.
 */
export function commandFloorDecision(
  command: string,
  allowlist: string[] = readSafetyAllowlist(),
): CommandRisk {
  const risk = classifyCommandRisk(command);
  if (!risk.catastrophic) return risk;
  if (isAllowlisted(command, allowlist)) return SAFE;
  return risk;
}

function isAllowlisted(command: string, allowlist: string[]): boolean {
  if (!allowlist.length) return false;
  const lower = command.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.trim().toLowerCase();
    return e.length > 0 && lower.includes(e);
  });
}

/**
 * Operator-controlled allowlist from AUTOLOOP_SAFETY_ALLOW (newline- or
 * comma-separated substrings). Read from the process environment, which a
 * preset cannot set — keeping the floor preset-uninfluenceable.
 */
export function readSafetyAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.AUTOLOOP_SAFETY_ALLOW;
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Best-effort extraction of a shell command from an arbitrary tool input.
 * Returns null when the tool clearly carries no command (so the floor only
 * inspects command-bearing tools like Bash/execute). Handles the common SDK
 * Bash shape (`{ command }`) and ACP `rawInput`, plus raw-string inputs.
 */
export function extractCommandFromToolInput(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    for (const key of ["command", "cmd", "script", "code"]) {
      const v = rec[key];
      if (typeof v === "string" && v.trim()) return v;
    }
    // ACP wraps the agent's tool input under rawInput.
    if (rec.rawInput !== undefined && rec.rawInput !== input) {
      return extractCommandFromToolInput(rec.rawInput);
    }
  }
  return null;
}

/** Tool names whose inputs carry a shell command the floor must inspect. */
export function isCommandBearingTool(toolName: string): boolean {
  const t = toolName.toLowerCase();
  return (
    t === "bash" ||
    t === "shell" ||
    t === "execute" ||
    t === "executecommand" ||
    t === "run_command" ||
    t === "run_terminal_cmd" ||
    t.endsWith("__bash") ||
    t.includes("terminal")
  );
}

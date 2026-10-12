#!/usr/bin/env node
// Verification harness for autoloop. Launch, doctor, drive, and cleanup a
// disposable project. Does not read or write the operator's real .autoloop
// directory or ~/.autoloop.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const bin = join(repoRoot, "bin", "autoloop");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function sessionRoot() {
  const root = process.env.AUTOLOOP_VERIFY_ROOT;
  if (!root) {
    die("AUTOLOOP_VERIFY_ROOT is unset. Export a disposable directory before init.");
  }
  if (!root.startsWith("/tmp/") && !root.startsWith("/private/tmp/")) {
    die(`AUTOLOOP_VERIFY_ROOT must be under /tmp, got ${root}`);
  }
  return root;
}

function sessionPath(root = sessionRoot()) {
  return join(root, "session.json");
}

function loadSession() {
  const path = sessionPath();
  if (!existsSync(path)) die(`No session at ${path}. Run init first.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveSession(session) {
  writeFileSync(sessionPath(session.root), `${JSON.stringify(session, null, 2)}\n`);
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AUTOLOOP_")) delete env[key];
  }
  return { ...env, ...extra };
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function runAutoloop(args, { cwd, env, timeoutMs = 90_000 }) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\ntimed out after ${timeoutMs}ms\n`;
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ stdout, stderr, status: code ?? 1 });
    });
  });
}

async function init() {
  const root = sessionRoot();
  if (existsSync(sessionPath(root))) {
    die(`Session already exists at ${sessionPath(root)}. Choose a new AUTOLOOP_VERIFY_ROOT.`);
  }
  if (!existsSync(bin)) {
    die(`Missing ${bin}. From the repo root run: npm ci && npm run build`);
  }
  const projectDir = join(root, "project");
  const evidenceDir = join(root, "evidence");
  const home = join(root, "home");
  const backend = join(root, "verify-backend.sh");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    backend,
    "#!/bin/sh\n# Verification scaffolding. Removed by control-autoloop cleanup.\n# Ignores the prompt argument and prints the starter completion promise.\nprintf '%s\\n' 'LOOP_COMPLETE'\n",
  );
  await new Promise((resolveChmod, reject) => {
    spawn("chmod", ["+x", backend]).on("close", (code) => {
      if (code === 0) resolveChmod();
      else reject(new Error(`chmod failed: ${code}`));
    });
  });

  const git = spawn("git", ["init", "-q"], { cwd: projectDir, stdio: "inherit" });
  const gitCode = await new Promise((resolveCode) => git.on("close", resolveCode));
  if (gitCode !== 0) die("git init failed");

  const created = await runAutoloop(["init", "."], {
    cwd: projectDir,
    env: cleanEnv(),
  });
  process.stdout.write(created.stdout);
  process.stderr.write(created.stderr);
  if (created.status !== 0) process.exit(created.status);
  if (!existsSync(join(projectDir, "autoloops.toml"))) {
    die("init did not write autoloops.toml");
  }

  const session = {
    root,
    repoRoot,
    projectDir,
    evidenceDir,
    home,
    backend,
    version: pkg.version,
    dashboard: { state: "stopped" },
    kanban: { state: "stopped" },
  };
  saveSession(session);
  process.stdout.write(
    `ready\nproject=${projectDir}\nbackend=${backend}\nevidence=${evidenceDir}\nversion=${pkg.version}\n`,
  );
}

async function cli(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 0) die("Usage: control-autoloop.mjs cli -- <autoloop args>");
  const session = loadSession();
  const result = await runAutoloop(args, {
    cwd: session.projectDir,
    env: cleanEnv({ AUTOLOOP_PROJECT_DIR: session.projectDir }),
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status);
}

function listeningInodes(port) {
  const inodes = new Set();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(table)) continue;
    const lines = readFileSync(table, "utf8").trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const local = parts[1] ?? "";
      const state = parts[3] ?? "";
      const inode = parts[9] ?? "";
      const hexPort = local.split(":").at(-1) ?? "";
      if (state === "0A" && Number.parseInt(hexPort, 16) === port) inodes.add(inode);
    }
  }
  return inodes;
}

function portOwnedByPid(port, pid) {
  const inodes = listeningInodes(port);
  if (inodes.size === 0) return false;
  const fdDir = `/proc/${pid}/fd`;
  if (!existsSync(fdDir)) return false;
  for (const fd of readdirSync(fdDir)) {
    let target = "";
    try {
      target = readlinkSync(join(fdDir, fd));
    } catch {
      continue;
    }
    const match = /^socket:\[(\d+)\]$/.exec(target);
    if (match && inodes.has(match[1])) return true;
  }
  return false;
}

async function serverHealth(url) {
  try {
    const response = await fetch(`${url}/healthz`);
    const body = await response.text();
    return { httpStatus: response.status, body };
  } catch (err) {
    return { httpStatus: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

async function describeServer(record) {
  if (!record || record.state !== "up" || !record.pid) {
    return { state: "stopped" };
  }
  const processUp = alive(record.pid);
  const health = await serverHealth(record.url);
  const portOwnedByPidFlag = processUp ? await portOwnedByPid(record.port, record.pid) : false;
  return {
    state: processUp ? "up" : "dead",
    url: record.url,
    pid: record.pid,
    port: record.port,
    portOwnedByPid: portOwnedByPidFlag,
    health,
  };
}

async function doctor() {
  const session = loadSession();
  const version = await runAutoloop(["--version"], {
    cwd: session.projectDir,
    env: cleanEnv({ AUTOLOOP_PROJECT_DIR: session.projectDir }),
  });
  const reported = version.stdout.trim();
  const product = await runAutoloop(["doctor", "--json"], {
    cwd: session.projectDir,
    env: cleanEnv({ AUTOLOOP_PROJECT_DIR: session.projectDir }),
  });
  let productJson = null;
  try {
    productJson = JSON.parse(product.stdout);
  } catch {
    productJson = { parseError: true, stdout: product.stdout, stderr: product.stderr };
  }
  const failures = Array.isArray(productJson?.checks)
    ? productJson.checks.filter((check) => check.status === "fail")
    : [];
  const dashboard = await describeServer(session.dashboard);
  const kanban = await describeServer(session.kanban);
  const serversOk = [dashboard, kanban].every((server) => {
    if (server.state === "stopped") return true;
    if (server.state !== "up") return false;
    if (!server.portOwnedByPid) return false;
    return server.health.httpStatus === 200 && server.health.body.includes('"status":"ok"');
  });
  const ok =
    version.status === 0 &&
    reported === session.version &&
    existsSync(join(session.projectDir, "autoloops.toml")) &&
    failures.length === 0 &&
    serversOk;
  const report = {
    ok,
    root: session.root,
    projectDir: session.projectDir,
    evidenceDir: session.evidenceDir,
    backend: session.backend,
    version: reported,
    expectedVersion: session.version,
    dashboard,
    kanban,
    productDoctor: {
      exitCode: product.status,
      projectDir: productJson?.projectDir ?? null,
      failures: failures.length,
      warnings: Array.isArray(productJson?.checks)
        ? productJson.checks.filter((check) => check.status === "warn").length
        : null,
      checks: productJson?.checks ?? productJson,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
}

async function startServer(kind) {
  const session = loadSession();
  const current = session[kind];
  if (current?.state === "up" && alive(current.pid)) {
    die(`${kind} is already running at ${current.url} (pid ${current.pid}). Refusing to start a second server in this session.`);
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logPath = join(session.root, `${kind}.log`);
  const logFd = openSync(logPath, "a");
  const args =
    kind === "dashboard"
      ? ["dashboard", "--host", "127.0.0.1", "--port", String(port), "--project-dir", session.projectDir]
      : ["kanban", "--host", "127.0.0.1", "--port", String(port), "--project-dir", session.projectDir];
  const env =
    kind === "kanban"
      ? cleanEnv({
          AUTOLOOP_PROJECT_DIR: session.projectDir,
          AUTOLOOP_HOME: session.home,
        })
      : cleanEnv({ AUTOLOOP_PROJECT_DIR: session.projectDir });
  const child = spawn(process.execPath, [bin, ...args], {
    cwd: session.projectDir,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  const needle = kind === "dashboard" ? `Dashboard listening on ${url}` : `Kanban listening on ${url}`;
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (!alive(child.pid)) break;
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    if (log.includes(needle)) {
      const health = await serverHealth(url);
      if (health.httpStatus === 200) {
        ready = true;
        break;
      }
    }
    await delay(200);
  }
  if (!ready) {
    if (alive(child.pid)) process.kill(child.pid, "SIGTERM");
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    die(`${kind} did not become ready on ${url}\n${log}`);
  }
  session[kind] = { state: "up", pid: child.pid, port, url, logPath };
  saveSession(session);
  process.stdout.write(`${needle}\npid=${child.pid}\n`);
}

function stopRecord(record) {
  if (!record?.pid || !alive(record.pid)) return false;
  process.kill(record.pid, "SIGTERM");
  return true;
}

async function stopServer(kind) {
  const session = loadSession();
  const record = session[kind];
  const stopped = stopRecord(record);
  if (stopped) {
    const deadline = Date.now() + 5_000;
    while (alive(record.pid) && Date.now() < deadline) await delay(100);
    if (alive(record.pid)) process.kill(record.pid, "SIGKILL");
  }
  session[kind] = { state: "stopped" };
  saveSession(session);
  process.stdout.write(stopped ? `stopped ${kind} pid=${record.pid}\n` : `${kind} was not running\n`);
}

async function httpGet(argv) {
  const [kind, path] = argv;
  if (!kind || !path?.startsWith("/")) die("Usage: control-autoloop.mjs get <dashboard|kanban> </path>");
  const session = loadSession();
  const record = session[kind];
  if (record?.state !== "up" || !record.url) die(`${kind} is not running in this session`);
  const response = await fetch(`${record.url}${path}`);
  const body = await response.text();
  process.stdout.write(body);
  if (!body.endsWith("\n")) process.stdout.write("\n");
  process.exit(response.ok ? 0 : 1);
}

function splitStep(line) {
  const halves = line.split(" :: ");
  const head = halves[0].trim().split(/\s+/);
  const arg = halves.slice(1).join(" :: ");
  return { verb: head[0], selector: head.slice(1).join(" "), arg };
}

async function browser(argv) {
  const recipe = argv.length > 0 ? readFileSync(argv[0], "utf8") : await readStdin();
  const session = loadSession();
  const { chromium } = await import("playwright");
  let browserHandle;
  let channel = "chromium";
  try {
    browserHandle = await chromium.launch({ channel: "chrome", headless: true });
    channel = "chrome";
  } catch {
    browserHandle = await chromium.launch({ headless: true });
  }
  process.stderr.write(`browser=${channel}\n`);
  const page = await browserHandle.newPage({ viewport: { width: 1440, height: 1200 } });
  let base = session.dashboard?.url;
  try {
    for (const raw of recipe.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const step = splitStep(line);
      if (step.verb === "server") {
        const record = session[step.arg];
        if (record?.state !== "up" || !record.url) die(`browser server ${step.arg} is not running`);
        base = record.url;
        continue;
      }
      if (!base) die("No base URL. Start the server or add a server step.");
      if (step.verb === "goto") {
        await page.goto(`${base}${step.arg}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
        continue;
      }
      if (step.verb === "reload") {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
        continue;
      }
      if (step.verb === "wait" && step.selector === "heading") {
        await page.getByRole("heading", { name: step.arg }).waitFor({ timeout: 20_000 });
        continue;
      }
      if (step.verb === "wait" && step.selector === "text") {
        await page.getByText(step.arg).first().waitFor({ timeout: 20_000 });
        continue;
      }
      if (step.verb === "click" && step.selector === "button") {
        await page.getByRole("button", { name: step.arg }).click({ timeout: 20_000 });
        continue;
      }
      if (step.verb === "click") {
        await page.locator(step.selector, { hasText: step.arg }).first().click({ timeout: 20_000 });
        continue;
      }
      if (step.verb === "fill") {
        await page.locator(step.selector).fill(step.arg, { timeout: 20_000 });
        continue;
      }
      if (step.verb === "screenshot" || step.verb === "aria" || step.verb === "text") {
        const dest = resolve(session.evidenceDir, step.arg);
        mkdirSync(dirname(dest), { recursive: true });
        if (step.verb === "screenshot") await page.screenshot({ path: dest, fullPage: true });
        if (step.verb === "aria") writeFileSync(dest, `${await page.locator("body").ariaSnapshot()}\n`);
        if (step.verb === "text") writeFileSync(dest, `${await page.locator("body").innerText()}\n`);
        process.stdout.write(`${step.verb}=${dest}\n`);
        continue;
      }
      die(`Unknown browser step: ${line}`);
    }
  } catch (err) {
    const dest = join(session.evidenceDir, "browser-failure.png");
    mkdirSync(session.evidenceDir, { recursive: true });
    await page.screenshot({ path: dest, fullPage: true }).catch(() => {});
    process.stderr.write(`browser failure screenshot=${dest}\n`);
    throw err;
  } finally {
    await browserHandle.close();
  }
}

function readStdin() {
  return new Promise((resolveStdin, reject) => {
    if (process.stdin.isTTY) die("Pass a recipe file or a heredoc on stdin.");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolveStdin(data));
    process.stdin.on("error", reject);
  });
}

async function cleanup() {
  const root = sessionRoot();
  const path = sessionPath(root);
  if (!existsSync(path)) {
    process.stdout.write("no session to clean\n");
    return;
  }
  const session = JSON.parse(readFileSync(path, "utf8"));
  for (const kind of ["dashboard", "kanban"]) {
    const record = session[kind];
    if (record?.pid && alive(record.pid)) {
      process.kill(record.pid, "SIGTERM");
      const deadline = Date.now() + 5_000;
      while (alive(record.pid) && Date.now() < deadline) await delay(100);
      if (alive(record.pid)) process.kill(record.pid, "SIGKILL");
      process.stdout.write(`killed ${kind} pid=${record.pid}\n`);
    }
  }
  rmSync(session.projectDir, { recursive: true, force: true });
  rmSync(session.home, { recursive: true, force: true });
  rmSync(session.backend, { force: true });
  rmSync(join(root, "dashboard.log"), { force: true });
  rmSync(join(root, "kanban.log"), { force: true });
  rmSync(path, { force: true });
  process.stdout.write(`evidence kept at ${session.evidenceDir}\n`);
}

const usage = `Usage: control-autoloop.mjs <init|doctor|cli|dashboard|kanban|get|browser|cleanup>

  init
  doctor
  cli -- <autoloop args>
  dashboard <start|stop>
  kanban <start|stop>
  get <dashboard|kanban> </path>
  browser [recipe-file]     # or a recipe heredoc on stdin
  cleanup
`;

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "init") await init();
  else if (cmd === "doctor") await doctor();
  else if (cmd === "cli") await cli(rest);
  else if (cmd === "dashboard" && rest[0] === "start") await startServer("dashboard");
  else if (cmd === "dashboard" && rest[0] === "stop") await stopServer("dashboard");
  else if (cmd === "kanban" && rest[0] === "start") await startServer("kanban");
  else if (cmd === "kanban" && rest[0] === "stop") await stopServer("kanban");
  else if (cmd === "get") await httpGet(rest);
  else if (cmd === "browser") await browser(rest);
  else if (cmd === "cleanup") await cleanup();
  else {
    process.stderr.write(usage);
    process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  die(err instanceof Error ? err.stack || err.message : String(err));
}

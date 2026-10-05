import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const requiredTools = ["postgres", "initdb", "pg_ctl", "createdb"];
const emit = (event) => console.info(JSON.stringify(event));

export function isolatedEnvironment() {
  // Deliberately do not inherit .env, NODE_OPTIONS, database/PG service settings,
  // OAuth keys, proxy settings, loader hooks or the caller's test target.
  return { PATH: `${dirname(process.execPath)}${delimiter}/usr/bin${delimiter}/bin`,
    LANG: "C", LC_ALL: "C", TZ: "UTC", CI: "1", NO_COLOR: "1" };
}

export async function postgresToolchain(value) {
  if (process.platform === "win32" || typeof value !== "string" || !isAbsolute(value)) {
    throw new Error("An absolute POSTGRES_BIN_DIR for PostgreSQL 17 is required on macOS/Linux.");
  }
  const directory = await realpath(value);
  const tools = {};
  for (const name of requiredTools) {
    const path = await realpath(join(directory, name));
    if (!(await lstat(path)).isFile()) throw new Error("Invalid PostgreSQL toolchain.");
    await access(path, constants.X_OK);
    tools[name] = path;
  }
  return tools;
}

async function freeLoopbackPort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error || address === null || typeof address === "string") reject(error ?? new Error("Port allocation failed."));
        else resolve(address.port);
      });
    });
  });
}

export function executeCommand(command, args, { env, signal, timeoutMs = 180_000 }) {
  if (signal?.aborted) return Promise.reject(new Error("Verification interrupted."));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let limited = false;
    const cancel = () => child.kill("SIGTERM");
    const timer = setTimeout(() => { limited = true; cancel(); }, timeoutMs);
    const append = (target, bytes) => {
      if (stdout.length + stderr.length + bytes.length > 8 * 1024 * 1024) { limited = true; cancel(); return; }
      if (target === "stdout") stdout += bytes.toString(); else stderr += bytes.toString();
    };
    child.stdout.on("data", (bytes) => append("stdout", bytes));
    child.stderr.on("data", (bytes) => append("stderr", bytes));
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const detach = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    child.once("error", () => { detach(); reject(new Error("Verification command could not start.")); });
    child.once("close", (code) => {
      detach();
      resolve({ code: limited || signal?.aborted ? 1 : code ?? 1, stdout, stderr });
    });
  });
}

/** Always creates its own target; never accepts a database URL or existing cluster. */
export async function runPostgresVerification({
  binDirectory, signal, execute = executeCommand, allocatePort = freeLoopbackPort, report = emit,
}) {
  const tools = await postgresToolchain(binDirectory);
  const env = isolatedEnvironment();
  const version = await execute(tools.postgres, ["--version"], { env, signal, timeoutMs: 10_000 });
  if (version.code !== 0 || !/^postgres \(PostgreSQL\) 17\.\d+(?:\s|$)/.test(version.stdout)) {
    throw new Error("PostgreSQL 17 binaries are required to match the SQL CI boundary.");
  }
  const port = await allocatePort();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid isolated port.");
  const root = await realpath(await mkdtemp(join(tmpdir(), "pp-sql-test-")));
  const cluster = join(root, "cluster");
  const passwordFile = join(root, "password");
  const password = randomBytes(24).toString("hex");
  const databaseName = `pp_${randomBytes(12).toString("hex")}_test`;
  const url = new URL("postgresql://127.0.0.1");
  url.username = "pp_test";
  url.password = password;
  url.port = String(port);
  url.pathname = `/${databaseName}`;
  const testEnvironment = { ...env, TEST_DATABASE_URL: url.toString(), PGPASSWORD: password };
  let startAttempted = false;
  let stage = "initialize";
  let success = false;
  const command = async (binary, args, output = false, timeoutMs = 180_000) => {
    if (signal?.aborted) throw new Error("Verification interrupted.");
    const result = await execute(binary, args, { env: testEnvironment, signal, timeoutMs });
    if (output) {
      // Redact the synthetic one-run password even if a dependency echoes a URL.
      const diagnostic = `${result.stdout}${result.stderr}`.replaceAll(password, "[redacted]");
      if (diagnostic) report({ event: "postgres_verification_output", stage, output: diagnostic });
    }
    if (result.code !== 0) throw new Error("Isolated verification command failed.");
    return result;
  };
  try {
    await writeFile(passwordFile, `${password}\n`, { flag: "wx", mode: 0o600 });
    report({ event: "postgres_verification_started", postgresVersion: version.stdout.trim(),
      scope: "new-temporary-loopback-database-only" });
    await command(tools.initdb, ["-D", cluster, "--username=pp_test", "--encoding=UTF8", "--locale=C",
      "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", `--pwfile=${passwordFile}`]);
    stage = "start";
    startAttempted = true;
    await command(tools.pg_ctl, ["-D", cluster, "-l", join(root, "postgres.log"), "-w", "-t", "30",
      "-o", `-c listen_addresses=127.0.0.1 -c unix_socket_directories= -p ${port} -c max_connections=60 -c shared_buffers=32MB`,
      "start"], false, 45_000);
    stage = "create-test-database";
    await command(tools.createdb, ["-h", "127.0.0.1", "-p", String(port), "-U", "pp_test", "-w",
      "--maintenance-db=postgres", databaseName]);
    stage = "migrations";
    await command(process.execPath, [join(repository, "packages/database/node_modules/prisma/build/index.js"),
      "migrate", "deploy", "--config", join(repository, "packages/database/prisma-test.config.ts")], true);
    stage = "tests";
    await command(process.execPath, [join(repository, "node_modules/vitest/vitest.mjs"), "run"], true, 600_000);
    success = true;
    report({ event: "postgres_verification_passed" });
  } catch {
    report({ event: "postgres_verification_failed", stage });
    throw new Error("Isolated PostgreSQL verification failed; see the redacted stage output.");
  } finally {
    let stopped = !startAttempted;
    if (startAttempted) {
      try {
        // Cleanup ignores cancellation; it controls only the newly owned cluster.
        for (const mode of ["fast", "immediate"]) {
          await execute(tools.pg_ctl, ["-D", cluster, "-m", mode, "-w", "-t", "15", "stop"],
            { env: testEnvironment, timeoutMs: 20_000 });
          const state = await execute(tools.pg_ctl, ["-D", cluster, "status"], { env, timeoutMs: 5_000 });
          if (state.code === 3) { stopped = true; break; }
        }
      } catch { stopped = false; }
    }
    if (!stopped) {
      report({ event: "postgres_verification_cleanup_required", temporaryDirectory: root });
      throw new Error("Temporary cluster state is uncertain; it was preserved for safe recovery.");
    }
    // root is the exact private mkdtemp result, never a caller path or broad root.
    await rm(root, { recursive: true, force: false });
    report({ event: "postgres_verification_cleaned", success });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    if (process.argv.length !== 2) throw new Error("Unexpected verification arguments.");
    await runPostgresVerification({ binDirectory: process.env.POSTGRES_BIN_DIR, signal: controller.signal });
  } catch {
    emit({ event: "postgres_verification_unavailable_or_failed" });
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

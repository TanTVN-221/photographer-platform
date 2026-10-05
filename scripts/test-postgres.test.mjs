import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isolatedEnvironment, postgresToolchain, runPostgresVerification } from "./test-postgres.mjs";

const directories = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture({ failStage, stopFails = false, abortAtStart = false, version = "17.11" } = {}) {
  const tools = await mkdtemp(join(tmpdir(), "pp-test-tools-"));
  directories.push(tools);
  for (const name of ["postgres", "initdb", "pg_ctl", "createdb"]) await writeFile(join(tools, name), "", { mode: 0o700 });
  const requests = [];
  const events = [];
  const controller = new AbortController();
  let active = false;
  let clusterRoot;
  const execute = vi.fn(async (command, args, options) => {
    const name = basename(command);
    requests.push({ name, args, options });
    if (name === "postgres") return { code: 0, stdout: `postgres (PostgreSQL) ${version}\n`, stderr: "" };
    if (name === "initdb") {
      clusterRoot = dirname(args[1]);
      directories.push(clusterRoot);
      expect((await stat(clusterRoot)).mode & 0o777).toBe(0o700);
      expect((await stat(join(clusterRoot, "password"))).mode & 0o777).toBe(0o600);
      expect((await readFile(join(clusterRoot, "password"), "utf8")).trim()).toBe(options.env.PGPASSWORD);
    }
    if (name === "pg_ctl") {
      if (args.at(-1) === "start") { active = true; if (abortAtStart) controller.abort(); }
      if (args.at(-1) === "stop" && !stopFails) active = false;
      if (args.at(-1) === "status") return { code: active ? 0 : 3, stdout: "", stderr: "" };
    }
    const stage = name === "initdb" ? "initialize" : name === "createdb" ? "createdb" :
      name === "pg_ctl" && args.at(-1) === "start" ? "start" :
      args[0]?.includes("prisma/build") ? "migrations" : args[0]?.includes("vitest.mjs") ? "tests" : "other";
    if (stage === failStage) return { code: 1, stdout: `Synthetic failure at ${options.env.TEST_DATABASE_URL}`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
  const options = { binDirectory: tools, signal: controller.signal, execute,
    allocatePort: vi.fn(async () => 43713), report: (event) => events.push(event) };
  return { tools, requests, events, options, getRoot: () => clusterRoot };
}

describe("isolated SQL verification launcher (DB-005, SEC-002/004)", () => {
  it("does not inherit application secrets, remote targets or provider/loader/proxy settings", () => {
    for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL", "TEST_DATABASE_URL", "DRIVE_TOKEN_KEY",
      "GOOGLE_CLIENT_SECRET", "NODE_OPTIONS", "PGSERVICE", "PGHOST", "HTTPS_PROXY"]) vi.stubEnv(name, "private-synthetic-value");
    const env = isolatedEnvironment();
    expect(Object.keys(env).sort()).toEqual(["CI", "LANG", "LC_ALL", "NO_COLOR", "PATH", "TZ"]);
    expect(JSON.stringify(env)).not.toContain("private-synthetic-value");
  });
  it.each([undefined, "relative/path", "/definitely/absent/pp-postgres"]) (
    "requires an explicitly supplied installed toolchain: %s", async (path) => {
      await expect(postgresToolchain(path)).rejects.toBeInstanceOf(Error);
    });
  it("refuses a non-executable tool", async () => {
    const { tools } = await fixture();
    await chmod(join(tools, "initdb"), 0o600);
    await expect(postgresToolchain(tools)).rejects.toBeInstanceOf(Error);
  });
  it.each(["16.11", "18.2", "not-postgresql"]) (
    "refuses an unapproved major/runtime before allocating a cluster: %s", async (version) => {
      const { options, events } = await fixture({ version });
      await expect(runPostgresVerification(options)).rejects.toThrow("PostgreSQL 17");
      expect(options.allocatePort).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });
  it("uses only a generated loopback _test target, SCRAM credentials and test-only migration config", async () => {
    const { options, requests, events, getRoot } = await fixture();
    await runPostgresVerification(options);
    const bootstrap = requests.find((request) => request.name === "initdb");
    expect(bootstrap.args).toContain("--auth-host=scram-sha-256");
    const target = new URL(bootstrap.options.env.TEST_DATABASE_URL);
    expect(target.hostname).toBe("127.0.0.1");
    expect(target.port).toBe("43713");
    expect(target.pathname).toMatch(/^\/pp_[a-f0-9]{24}_test$/);
    expect(target.search).toBe("");
    expect(target.username).toBe("pp_test");
    expect(target.password).toMatch(/^[a-f0-9]{48}$/);
    const start = requests.find((request) => request.name === "pg_ctl" && request.args.at(-1) === "start");
    expect(start.args.join(" ")).toContain("listen_addresses=127.0.0.1");
    expect(start.args.join(" ")).toContain("unix_socket_directories=");
    const migration = requests.find((request) => request.args.includes("migrate"));
    expect(migration.args.at(-1)).toMatch(/packages\/database\/prisma-test.config.ts$/);
    expect(migration.args).toContain("deploy");
    expect(migration.options.env.DATABASE_URL).toBeUndefined();
    expect(migration.options.env.DIRECT_DATABASE_URL).toBeUndefined();
    const test = requests.find((request) => request.args[0]?.includes("vitest.mjs"));
    expect(test.options.env.TEST_DATABASE_URL).toBe(target.toString());
    expect(events.at(-1)).toEqual({ event: "postgres_verification_cleaned", success: true });
    await expect(stat(getRoot())).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["initialize", "start", "createdb", "migrations", "tests"]) (
    "cleans the exact owned cluster and redacts credentials after %s failure", async (failStage) => {
      const { options, events, requests, getRoot } = await fixture({ failStage });
      await expect(runPostgresVerification(options)).rejects.toThrow("verification failed");
      const password = requests.find((request) => request.name === "initdb").options.env.PGPASSWORD;
      expect(JSON.stringify(events)).not.toContain(password);
      if (["migrations", "tests"].includes(failStage)) expect(JSON.stringify(events)).toContain("[redacted]");
      expect(events.at(-1)).toEqual({ event: "postgres_verification_cleaned", success: false });
      await expect(stat(getRoot())).rejects.toMatchObject({ code: "ENOENT" });
    });
  it("stops its newly started cluster on cancellation without forwarding the aborted signal to cleanup", async () => {
    const { options, requests, events } = await fixture({ abortAtStart: true });
    await expect(runPostgresVerification(options)).rejects.toThrow("verification failed");
    const stops = requests.filter((request) => request.name === "pg_ctl" && request.args.at(-1) === "stop");
    expect(stops).toHaveLength(1);
    expect(stops[0].options.signal).toBeUndefined();
    expect(requests.some((request) => request.name === "createdb")).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: "postgres_verification_cleaned", success: false });
  });
  it("does not delete an uncertain running cluster after failed shutdown", async () => {
    const { options, events, requests, getRoot } = await fixture({ stopFails: true });
    await expect(runPostgresVerification(options)).rejects.toThrow("preserved");
    expect((await stat(getRoot())).isDirectory()).toBe(true);
    expect(requests.filter((request) => request.args.at(-1) === "stop").map((request) => request.args[3])).toEqual(["fast", "immediate"]);
    expect(events.at(-1)).toEqual({ event: "postgres_verification_cleanup_required", temporaryDirectory: getRoot() });
  });
});

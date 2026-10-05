import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readScripts(app: "api" | "web"): Record<string, string> {
  const manifest: unknown = JSON.parse(readFileSync(join(repositoryRoot, "apps", app, "package.json"), "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)
    || typeof manifest.scripts !== "object" || manifest.scripts === null
    || !Object.values(manifest.scripts).every((value) => typeof value === "string")) {
    throw new Error("Invalid application scripts");
  }
  return manifest.scripts as Record<string, string>;
}

function probeDevelopmentEnvironment(app: "api" | "web", fileValue: string | null, exportedValue?: string,
  exitCode = 0, callerAtRoot = false) {
  // Actual launcher, synthetic .env and CLI only: never read live secrets or run database fixtures.
  const fixture = mkdtempSync(join(tmpdir(), "photographer-startup-"));
  try {
    const appDirectory = join(fixture, "apps", app);
    const launcherDirectory = join(fixture, "scripts");
    const cli = app === "api" ? "node_modules/tsx/dist/cli.mjs" : "node_modules/next/dist/bin/next";
    mkdirSync(launcherDirectory, { recursive: true });
    mkdirSync(join(appDirectory, app === "api" ? "node_modules/tsx/dist" : "node_modules/next/dist/bin"), { recursive: true });
    copyFileSync(join(repositoryRoot, "scripts/dev.mjs"), join(launcherDirectory, "dev.mjs"));
    writeFileSync(join(appDirectory, cli), "process.stdout.write(JSON.stringify({value:process.env.PHOTOGRAPHER_STARTUP_PROBE ?? null,"
      + `args:process.argv.slice(2),execArgv:process.execArgv}));process.exitCode=${exitCode};`);
    if (fileValue !== null) {
      writeFileSync(join(fixture, ".env"), `PHOTOGRAPHER_STARTUP_PROBE="${fileValue}"\n`, { mode: 0o600 });
    }
    const environment = { ...process.env };
    delete environment.PHOTOGRAPHER_STARTUP_PROBE;
    if (exportedValue !== undefined) environment.PHOTOGRAPHER_STARTUP_PROBE = exportedValue;
    const result = spawnSync(process.execPath, [join(launcherDirectory, "dev.mjs"), app], {
      cwd: callerAtRoot ? fixture : appDirectory,
      env: environment,
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(exitCode);
    expect(result.stderr).toBe("");
    return JSON.parse(result.stdout) as { value: string | null; args: string[]; execArgv: string[] };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe.each(["api", "web"] as const)("%s development startup (OPS-004, SEC-002/004, AUTH-004)", (app) => {
  it("loads the repository-root environment from either root or package cwd", () => {
    const value = "synthetic value with spaces # and $literal";
    expect(probeDevelopmentEnvironment(app, value).value).toBe(value);
    expect(probeDevelopmentEnvironment(app, value, undefined, 0, true).value).toBe(value);
  });

  it("preserves individually exported settings, including intentionally empty values", () => {
    expect(probeDevelopmentEnvironment(app, "file-default", "exported-override").value).toBe("exported-override");
    expect(probeDevelopmentEnvironment(app, "file-default", "").value).toBe("");
  });

  it("allows a missing optional environment file for public foundation development", () => {
    expect(probeDevelopmentEnvironment(app, null).value).toBeNull();
  });

  it("launches the installed CLI without environment-file flags that break Next workers", () => {
    expect(readScripts(app).dev).toBe(`node ../../scripts/dev.mjs ${app}`);
    const result = probeDevelopmentEnvironment(app, null);
    expect(result.execArgv).toEqual([]);
    expect(result.args).toEqual(app === "api" ? ["watch", "src/server.ts"]
      : ["dev", "--hostname", "127.0.0.1", "--port", "3000"]);
  });

  it("propagates application failure rather than reporting successful startup", () => {
    probeDevelopmentEnvironment(app, null, undefined, 7);
  });

  it("does not implicitly load development secrets in production or operator commands", () => {
    for (const [name, command] of Object.entries(readScripts(app))) {
      if (name !== "dev") {
        expect(command).not.toContain("--env-file");
        expect(command).not.toContain("scripts/dev.mjs");
      }
    }
  });
});

describe("development launcher failure safety (OPS-004, SEC-004)", () => {
  it.each([[], ["../../unexpected"], ["constructor"], ["api", "unexpected"]].map((args) => ({ args })))(
    "rejects invalid arguments before loading secrets or starting a process: $args", ({ args }) => {
      const result = spawnSync(process.execPath, [join(repositoryRoot, "scripts/dev.mjs"), ...args], {
        encoding: "utf8", timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe('{"event":"development_configuration_failed"}\n');
    },
  );

  it("fails safely when an existing environment file cannot be read as a file", () => {
    const fixture = mkdtempSync(join(tmpdir(), "photographer-startup-failure-"));
    try {
      mkdirSync(join(fixture, "scripts"));
      mkdirSync(join(fixture, ".env"));
      copyFileSync(join(repositoryRoot, "scripts/dev.mjs"), join(fixture, "scripts/dev.mjs"));
      const result = spawnSync(process.execPath, [join(fixture, "scripts/dev.mjs"), "api"], {
        encoding: "utf8", timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe('{"event":"development_configuration_failed"}\n');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

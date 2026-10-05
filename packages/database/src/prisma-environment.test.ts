import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { prismaDatasourceUrl } from "./prisma-environment.js";

const directories: string[] = [];
function fixture(contents?: string): URL {
  const root = mkdtempSync(join(tmpdir(), "prisma-environment-"));
  directories.push(root);
  mkdirSync(join(root, "packages/database"), { recursive: true });
  if (contents !== undefined) writeFileSync(join(root, ".env"), contents);
  const configUrl = pathToFileURL(join(root, "packages/database/prisma7.config.ts"));
  return new URL("../../.env", configUrl);
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Prisma deployment environment (DB-005, SEC-002/004)", () => {
  const databaseUrl = "postgresql://test:test@127.0.0.1:5432/application_test";
  const directUrl = "postgresql://test:test@127.0.0.1:5433/application_test";

  it("reads the repository-root .env independently of the working directory", () => {
    const environment = {};
    expect(prismaDatasourceUrl(fixture(`DATABASE_URL="${databaseUrl}"\n`), environment)).toBe(databaseUrl);
    expect(environment).toEqual({});
  });

  it("prefers the direct connection when both URLs are in .env", () => {
    expect(prismaDatasourceUrl(fixture(`DATABASE_URL=${databaseUrl}\nDIRECT_DATABASE_URL=${directUrl}\n`), {})).toBe(directUrl);
  });

  it("keeps exported values authoritative for each variable", () => {
    expect(prismaDatasourceUrl(fixture(`DATABASE_URL=${directUrl}`), { DATABASE_URL: databaseUrl })).toBe(databaseUrl);
    expect(prismaDatasourceUrl(fixture(`DIRECT_DATABASE_URL=${databaseUrl}`), { DIRECT_DATABASE_URL: directUrl })).toBe(directUrl);
  });

  it("works without .env when a direct URL is exported, including CI", () => {
    expect(prismaDatasourceUrl(fixture(), { DIRECT_DATABASE_URL: directUrl, DATABASE_URL: databaseUrl })).toBe(directUrl);
    expect(prismaDatasourceUrl(fixture(), { DATABASE_URL: databaseUrl })).toBe(databaseUrl);
  });

  it("falls back from blank direct settings without inventing a connection", () => {
    expect(prismaDatasourceUrl(fixture(`DIRECT_DATABASE_URL=\nDATABASE_URL=${databaseUrl}`), {})).toBe(databaseUrl);
    expect(prismaDatasourceUrl(fixture(), {})).toBeUndefined();
    expect(prismaDatasourceUrl(fixture("DATABASE_URL=\n"), {})).toBeUndefined();
    expect(prismaDatasourceUrl(fixture(`DIRECT_DATABASE_URL=${directUrl}`), { DIRECT_DATABASE_URL: "", DATABASE_URL: databaseUrl })).toBe(databaseUrl);
  });

  it("fails with a redacted error when .env cannot be read", () => {
    const file = fixture();
    mkdirSync(file);
    expect(() => prismaDatasourceUrl(file, {})).toThrow("Unable to read the repository-root .env for Prisma.");
  });
});

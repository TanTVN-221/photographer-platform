import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test-database.js";

describe("test-only Prisma migration configuration (DB-005, SEC-002)", () => {
  it("uses the same fail-closed explicit target guard and never reads root application configuration", () => {
    const config = readFileSync(new URL("../prisma-test.config.ts", import.meta.url), "utf8");
    expect(config).toContain("testDatabaseUrl(process.env)");
    expect(config).toContain("if (url === null) throw");
    expect(config).not.toMatch(/prismaDatasourceUrl|readFileSync|loadEnvFile|DIRECT_DATABASE_URL|DATABASE_URL:/);
    expect(testDatabaseUrl({ DATABASE_URL: "postgresql://production.example/live" })).toBeNull();
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: "postgresql://remote.example/example_test" })).toThrow();
  });
});

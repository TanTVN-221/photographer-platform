import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test-database.js";
describe("database integration safety boundary (DB-005, SEC-002)", () => {
  it("never uses the application database as an implicit test target", () => {
    expect(testDatabaseUrl({ DATABASE_URL: "postgresql://production.example/live" })).toBeNull();
  });
  it.each(["127.0.0.1", "localhost", "[::1]"])("allows an explicit isolated database on %s", (host) => {
    const value = `postgresql://tester:disposable@${host}:5432/photographer_platform_test`;
    expect(testDatabaseUrl({ TEST_DATABASE_URL: value })).toBe(value);
  });
  it.each(["", "not-a-url", "postgresql://remote.example/photographer_test", "postgresql://localhost/live",
    "postgresql://localhost/test", "https://localhost/example_test", "postgresql://localhost/a_test?host=remote.example",
    "postgresql://localhost/a_test?schema=public", "postgresql://localhost/a_test#fragment",
    "postgresql://localhost/a_test%2Fother"])("rejects unsafe explicit configuration (%s)", (value) => {
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: value })).toThrow("TEST_DATABASE_URL must explicitly");
  });
});

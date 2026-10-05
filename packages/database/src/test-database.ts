/** Explicit opt-in: test writes must never fall back to a live DATABASE_URL. */
export function testDatabaseUrl(environment: Record<string, string | undefined>): string | null {
  const value = environment.TEST_DATABASE_URL;
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/[A-Za-z0-9_]+_test$/.test(url.pathname) || url.search !== "" || url.hash !== "") throw new Error();
    return value;
  } catch {
    throw new Error("TEST_DATABASE_URL must explicitly target a loopback PostgreSQL database ending in _test, without query parameters.");
  }
}

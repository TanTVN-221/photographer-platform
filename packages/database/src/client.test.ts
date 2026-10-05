import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "./client.js";

describe("createDatabaseClient", () => {
  it("rejects malformed and non-PostgreSQL connection strings", () => {
    expect(() => createDatabaseClient("not a URL")).toThrow(
      "A valid PostgreSQL connection URL is required.",
    );
    expect(() => createDatabaseClient("https://example.com/database")).toThrow(
      "A PostgreSQL connection URL is required.",
    );
    expect(() => createDatabaseClient("postgresql:///database")).toThrow(
      "A PostgreSQL connection URL is required.",
    );
  });

  it("constructs a client without opening a database connection", async () => {
    const client = createDatabaseClient(
      "postgresql://test:test@127.0.0.1:5432/photographer_platform",
    );
    await expect(client.$disconnect()).resolves.toBeUndefined();
  });
});

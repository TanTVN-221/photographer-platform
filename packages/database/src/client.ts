import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export function createDatabaseClient(connectionString: string): PrismaClient {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("A valid PostgreSQL connection URL is required.");
  }
  if (
    (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") ||
    !parsed.hostname ||
    parsed.pathname.length <= 1
  ) {
    throw new Error("A PostgreSQL connection URL is required.");
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type DatabaseClient = PrismaClient;

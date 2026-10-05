import { defineConfig } from "prisma/config";
import { testDatabaseUrl } from "./src/test-database.js";

// Unlike application CLI configuration, this never reads the private root .env.
const url = testDatabaseUrl(process.env);
if (url === null) throw new Error("Explicit TEST_DATABASE_URL is required for test migrations.");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});

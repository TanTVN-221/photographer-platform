import { defineConfig } from "prisma/config";

import { prismaDatasourceUrl } from "./src/prisma-environment.js";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: prismaDatasourceUrl(new URL("../../.env", import.meta.url)),
  },
});

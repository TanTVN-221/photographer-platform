import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** CLI-only local fallback; exported variables remain authoritative (SEC-002). */
export function prismaDatasourceUrl(
  envFile: URL,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  let localEnvironment: NodeJS.Dict<string> = {};
  try {
    localEnvironment = parseEnv(readFileSync(envFile, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      // Do not surface file contents or connection credentials (SEC-004).
      throw new Error("Unable to read the repository-root .env for Prisma.");
    }
  }

  const directUrl = environment.DIRECT_DATABASE_URL ?? localEnvironment.DIRECT_DATABASE_URL;
  const databaseUrl = environment.DATABASE_URL ?? localEnvironment.DATABASE_URL;
  return directUrl?.trim() || databaseUrl?.trim() || undefined;
}

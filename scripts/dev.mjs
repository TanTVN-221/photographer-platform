import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const application = process.argv[2];
const commands = {
  api: ["node_modules/tsx/dist/cli.mjs", "watch", "src/server.ts"],
  web: ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3000"],
};

function startDevelopment() {
  if (!Object.hasOwn(commands, application) || process.argv.length !== 3) {
    throw new Error("Invalid development application");
  }
  try {
    loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }

  // No --env-file in execArgv: Next forwards execArgv into NODE_OPTIONS for its workers.
  // Resolve from this script rather than caller cwd; use the existing installed CLI.
  const child = spawn(process.execPath, commands[application], {
    cwd: fileURLToPath(new URL(`../apps/${application}/`, import.meta.url)),
    env: process.env,
    stdio: "inherit",
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  const detach = () => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  };
  child.once("error", () => {
    detach();
    console.error(JSON.stringify({ event: "development_launcher_failed" }));
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    detach();
    process.exitCode = code ?? 1;
  });
}

try {
  startDevelopment();
} catch {
  console.error(JSON.stringify({ event: "development_configuration_failed" }));
  process.exitCode = 1;
}

import { defineConfig } from "vitest/config";

// Next.js preserves JSX for its own compiler; Vitest must lower TSX itself.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
});

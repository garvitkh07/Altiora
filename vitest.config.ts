import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(projectRoot),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});

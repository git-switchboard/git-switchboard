import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["e2e/global-setup.ts"],
    // Vitest runs e2e tests under Node, not bun, so avoid bun-specific transforms
    server: {
      deps: {
        // node-pty has native bindings — don't try to transform it
        external: ["node-pty"],
      },
    },
  },
});

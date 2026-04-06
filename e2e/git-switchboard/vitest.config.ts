import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["global-setup.ts"],
    server: {
      deps: {
        // node-pty has native bindings — don't try to transform it
        external: ["node-pty"],
      },
    },
  },
});

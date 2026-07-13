import { defineConfig } from "vitest/config";

// Standalone test config — intentionally does NOT load the Cloudflare vite plugin
// (which is for the Worker bundle). The scoring/sim tests are pure functions run in node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["worker/**/*.test.ts", "shared/**/*.test.ts"],
  },
});

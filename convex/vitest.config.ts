import { defineConfig } from "vitest/config";

// convex-test runs Convex functions in the edge-runtime environment (docs.convex.dev/testing/convex-test).
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});

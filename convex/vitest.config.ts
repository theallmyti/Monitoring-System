import { defineConfig } from "vitest/config";

// convex-test runs Convex functions in the edge-runtime environment (docs.convex.dev/testing/convex-test).
export default defineConfig({
  test: {
    environment: "edge-runtime",
    // scrypt (32 MiB, deliberately slow) runs for every sign-up and sign-in in the tests.
    testTimeout: 30_000,
    server: { deps: { inline: ["convex-test"] } },
  },
});

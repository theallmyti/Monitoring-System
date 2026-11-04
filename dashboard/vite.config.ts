import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Content security policy, added to index.html at build time (not in `npm run dev`, whose
// hot reload needs inline scripts). Only this site's own files may run, and the page may only
// talk to our Convex deployment, so even injected HTML could not load a script or send the
// session token elsewhere. Framing is blocked by public/_headers (meta tags cannot do that).
function contentSecurityPolicy(convexUrl: string | undefined): Plugin {
  return {
    name: "pcm-content-security-policy",
    apply: "build",
    transformIndexHtml() {
      if (!convexUrl) {
        throw new Error("VITE_CONVEX_URL is not set (dashboard/.env.local); the security policy needs it");
      }
      const host = new URL(convexUrl).host;
      const policy = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        `connect-src https://${host} wss://${host}`,
        "font-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; ");
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  // Includes VITE_* variables from the environment (CI) as well as .env files.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_CONVEX_URL)],
    build: { outDir: "dist" },
  };
});

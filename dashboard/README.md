# PC Monitor site

Sign in, pair computers by scanning their QR code, and watch them live. Every Convex call
carries the session token; the backend only returns the signed-in user's own devices.

## Run locally
    cd dashboard
    npm install
    npm run dev

The Convex URL comes from `dashboard/.env.local` (git-ignored, one line:
`VITE_CONVEX_URL=https://<deployment>.convex.cloud`; ask the project owner).

## Hosting (Cloudflare Pages)
Static files on Cloudflare's CDN, free plan. `public/_headers` adds the security headers
(content security policy, no framing, no referrer).

One-time setup:

    npx --yes wrangler@4.151.3 login
    npx --yes wrangler@4.151.3 pages project create pc-monitor --production-branch main

Each release:

    npm run deploy

`deploy` builds with the URL from `.env.local` and uploads `dist/`. The site is then at
`https://pc-monitor.pages.dev` (Cloudflare adds a suffix if that name is taken). The Convex URL
ends up inside the built JavaScript; that is expected. Access is protected by sign-in.

## Notes
- Thresholds match docs/PRD.md: CPU 90 °C, GPU 85 °C, RAM 90 %.
- "Online" means a summary arrived in the last 3 minutes.
- The session token is kept in this browser's localStorage, so the site must never render
  raw HTML (CI fails on `dangerouslySetInnerHTML` and similar).

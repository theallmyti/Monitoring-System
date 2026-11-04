# PC Monitor dashboard (personal)

Live view of every device the agents report to Convex. Reads `dashboard:overview`,
which needs the read token (`read-token.secret`, git-ignored, never committed).

## Run locally
    cd dashboard
    npm install
    VITE_CONVEX_URL=https://<dev-deployment>.convex.cloud npm run dev

## Build for the Pi
    VITE_CONVEX_URL=https://<prod-deployment>.convex.cloud npm run build
The output is `dist/`, served as static files.

## Notes
- Thresholds match docs/PRD.md: CPU 90 °C, GPU 85 °C, RAM 90 %.
- "Online" means the newest push is under 3 minutes old.
- The token is kept in this browser's localStorage. Replace with sign-in in week 2.

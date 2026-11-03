# Monitoring-System

Lightweight hardware monitor: a Rust agent on each PC, Pi and server reports live stats to a Convex cloud backend. A personal web dashboard shows every device, and an Android app with alerts is planned.

**Status:** Week 1 (spikes). MVP due 3 Dec 2026.

## Components

| Part | Folder | Stack | State |
|---|---|---|---|
| Agent | [`agent/`](agent/) | Rust | In progress |
| Backend | [`convex/`](convex/) | Convex (TypeScript) | In progress |
| Dashboard | [`dashboard/`](dashboard/) | Vite + TypeScript | In progress |
| Android app | `android/` | Android | Planned |

## Agent

Requires a recent Rust toolchain (edition 2024, Rust 1.85 or newer).

```sh
cd agent
cp config.example.toml config.toml
# add registration_secret to config.toml (ask the other team member)
cargo run
```

`config.toml` is git-ignored. The device secret is generated on first run. The NVIDIA GPU stats need an NVIDIA driver; without one the agent runs without them.

## Dashboard

```sh
cd dashboard
npm install
npm run dev
```

The dashboard reads the team's Convex deployment with a read token kept in `read-token.secret`. That file is git-ignored and never committed.

## Backend

```sh
cd convex
npm install
npm run dev      # local dev against the Convex deployment
npm run test
```

## Licence

MIT. See [LICENSE](LICENSE).

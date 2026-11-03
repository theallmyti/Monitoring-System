# Spikes — PC Monitor

Findings from Week 1 spikes (`Roadmap.md`). Owner: **[A]** Aditya · **[T]** Tirth.

---

## S1 — Rust prints CPU, RAM, temperature [A] · done 3 Nov 2026

- Machine: ASUS TUF A15, Windows 11.
- Crate: `sysinfo` 0.40.1. Its constructors return `Result` (`System::new_with_specifics`, `Components::new_with_refreshed_list`).
- CPU util needs two samples ~500 ms apart; the first reading is 0.
- **CPU temperature: n/a** on Windows without a driver. Matches no-driver mode (F7, `Architecture.md` §2.3). Full mode (PawnIO, F8) is the stretch goal.

## S4 — Agent pushes to Convex every 1 s; measure RAM [A] · done 3 Nov 2026

Convex deployment: prod `tidy-newt-65` (cloud `https://tidy-newt-65.convex.cloud`).

**Client API** (verified against the official docs before coding):
- Crate `convex` 0.10.4. Source: https://docs.convex.dev/client/rust and https://docs.rs/convex/0.10.4.
- `ConvexClient::new(&str).await` → `Result`.
- `client.mutation(name, BTreeMap<String, Value>).await` → `Result<FunctionResult>`. `FunctionResult` is `Value`, `ErrorMessage` or `ConvexError`.
- Values: `Value::String`, `Value::Float64`, … (`Value` enum in `convex/src/value/mod.rs`).

**Result (release build, 25 s live):**

| Check | Target | Result |
|---|---|---|
| Pushes in 25 s | ~25 | 24 (zero errors) |
| Row stored in Convex | yes | yes (`spikeLatest`, `isFake: true`) |
| Binary size | < 15 MB (NFR-03) | 2.6 MB |
| RAM while live | < 25 MB (NFR-01) | 20.9 MB (working set) |
| RAM idle | < 20 MB (NFR-01) | not yet measured — the tokio + Convex client run even without viewers |

**Notes**
- The Convex client needs a `tokio` runtime. The agent uses `current_thread` to save RAM.
- **Auth (added after first run):** the agent generates a 256-bit device secret on first run (saved in `config.toml`, gitignored) and sends only its SHA-256 hash (`Flow.md` §3). Backend `agent:register` / `agent:pushLatest` look the device up by hash; unknown hashes are rejected (`unknown device`, verified). Tables are the subset from `Database.md`: `devices`, `latest`.
- **Registration now needs a team secret** (`AGENT_REGISTRATION_SECRET`, Convex env var; each PC keeps it in `config.toml`). Wrong secret → `not authorized` (verified). `getLatest` was removed: there is no public read endpoint until pairing (week 2). Pairing will link devices to users (`Flow.md` §3).
- **Test data:** spike rows and the earlier test device were deleted from dev. `config.toml` permissions are not restricted yet (`Security.md` §6).
- **Deployment:** the backend is live on **prod** (`tidy-newt-65`, `https://tidy-newt-65.convex.cloud`), deployed 3 Nov 2026. The agent config points at prod. Dev (`different-alpaca-219`) stays for local `convex dev` work.
- Measured RAM is for a release build. Re-measure after the real collectors land.

---

## S3 — NVIDIA GPU stats via NVML [A] · done 3 Nov 2026

- Machine: ASUS TUF A15, RTX 3050 Laptop GPU (4 GB), driver 596.36.
- Crate: `nvml-wrapper` 0.13.0. Signatures read from the published crate source (the docs.rs page for Device returned 404): `Nvml::init`, `device_by_index(0)`, `temperature(TemperatureSensor::Gpu)`, `utilization_rates().gpu`, `memory_info()` (total/used in bytes), `power_usage()` (mW), `clock_info(Clock::Graphics)`, `fan_speed(0)`.
- Fan speed is N/A on this laptop: `fan_speed` errors, so `fanPct` is left out (optional in the schema).
- No NVIDIA driver: `Nvml::init` fails and the agent runs without GPU data (NFR-07).
- Live test against dev: 12 pushes in 14 s, zero errors. Each row carries `gpu` (62 °C, 7 %, 1200 MHz, 14.8 W, 4096 MB VRAM).
- Backend: `latest.gpu` is an optional object (additive schema change, `Database.md` field names). Range checks: temp 0–125 °C, util 0–100 %.
- **Prod still needs the redeploy** (`npx convex deploy`) before the GPU fields are stored there.

## Open for later spikes

- S2: Pi / i3 hwmon per-core temps.
- S5: seed mutation with fake stats.
- S9: Convex Auth Password provider from native Android.

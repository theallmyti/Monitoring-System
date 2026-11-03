# Spikes — PC Monitor

Findings from Week 1 spikes (`Roadmap.md`). Owner: **[A]** Aditya · **[T]** Tirth.

---

## S1 — Rust prints CPU, RAM, temperature [A] · done 3 Nov 2026

- Machine: ASUS TUF A15, Windows 11.
- Crate: `sysinfo` 0.40.1. Its constructors return `Result` (`System::new_with_specifics`, `Components::new_with_refreshed_list`).
- CPU util needs two samples ~500 ms apart; the first reading is 0.
- **CPU temperature: n/a** on Windows without a driver. Matches no-driver mode (F7, `Architecture.md` §2.3). Full mode (PawnIO, F8) is the stretch goal.

## S4 — Agent pushes to Convex every 1 s; measure RAM [A] · done 3 Nov 2026

Convex deployment: `different-alpaca-219` (cloud `https://different-alpaca-219.convex.cloud`).

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
- `spike:pushLatest` has **no auth yet**. Device-secret checks come in week 2 (`Security.md`). Spike rows are deleted before week 3.
- Measured RAM is for a debug-free release build. Re-measure after the real collectors land.

---

## Open for later spikes

- S2: Pi / i3 hwmon per-core temps.
- S3: NVML GPU stats (RTX 3050 / 4050).
- S5: seed mutation with fake stats.
- S9: Convex Auth Password provider from native Android.

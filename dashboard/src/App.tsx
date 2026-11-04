import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { ConvexError } from "convex/values";
import { Device, Overview, RANGES, Range } from "./types";
import { DeviceSection, CPU_TEMP_LIMIT, GPU_TEMP_LIMIT, RAM_LIMIT } from "./DeviceSection";
import { Kpi } from "./Kpi";
import { PairScreen } from "./PairScreen";

// Session token from sign-in, kept in this browser's localStorage. The backend stores only its hash.
const SESSION_KEY = "pcm-session";

function loadSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveSession(token: string | null) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private window: the session lasts until the tab closes */
  }
}

export default function App() {
  const [token, setToken] = useState<string | null>(loadSession);
  const signedIn = (t: string) => {
    saveSession(t);
    setToken(t);
  };
  const signedOut = () => {
    saveSession(null);
    setToken(null);
  };
  if (!token) return <AuthScreen onSignedIn={signedIn} />;
  return <SignedIn token={token} onSignedOut={signedOut} />;
}

// Checks the session first: an expired or ended session goes back to the sign-in screen.
function SignedIn({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const me = useQuery(anyApi.auth.me, { token }) as { email: string } | null | undefined;
  const signOut = useMutation(anyApi.auth.signOut);
  useEffect(() => {
    if (me === null) onSignedOut();
  }, [me, onSignedOut]);
  if (!me) {
    return (
      <main className="center">
        <p className="empty">Loading…</p>
      </main>
    );
  }
  return (
    <Dashboard
      token={token}
      email={me.email}
      onSignOut={() => {
        void signOut({ token }).finally(onSignedOut);
      }}
    />
  );
}

function errorText(e: unknown) {
  return e instanceof ConvexError && typeof e.data === "string"
    ? e.data
    : "Something went wrong. Check the connection and try again.";
}

function AuthScreen({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signIn = useAction(anyApi.auth.signIn);
  const signUp = useAction(anyApi.auth.signUp);

  return (
    <main className="center">
      <form
        className="login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = (await (creating ? signUp : signIn)({ email, password })) as { token: string };
            onSignedIn(r.token);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>PC Monitor</h1>
        <p className="muted">{creating ? "Create an account to see your computers." : "Sign in to see your computers."}</p>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            required
            minLength={creating ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {creating && <p className="muted small">Use at least 8 characters.</p>}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="action" disabled={busy}>
          {busy ? "Please wait…" : creating ? "Create account" : "Sign in"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setCreating(!creating);
            setError(null);
          }}
        >
          {creating ? "I already have an account" : "Create an account"}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ token, email, onSignOut }: { token: string; email: string; onSignOut: () => void }) {
  const [range, setRange] = useState<Range>(RANGES[0]);
  // null: dashboard. "": pairing scanner. "ABC123": pairing with that code (from ?pair=).
  const [pairing, setPairing] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("pair"),
  );
  const data = useQuery(anyApi.dashboard.overview, { token }) as Overview | undefined;
  const setViewerAll = useMutation(anyApi.dashboard.setViewerAll);
  const hasDevices = (data?.devices.length ?? 0) > 0;

  // FR-33: while this page is visible, keep live data flowing (now + 30 s, renewed every 15 s).
  // One call covers all devices.
  useEffect(() => {
    if (!hasDevices) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      setViewerAll({ token }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, 15_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [hasDevices, token, setViewerAll]);

  if (pairing !== null) {
    return <PairScreen token={token} initialCode={pairing || undefined} onDone={() => setPairing(null)} />;
  }

  if (data === undefined) {
    return (
      <main className="center">
        <p className="empty">Loading readings…</p>
      </main>
    );
  }

  const devices = data.devices;
  const online = devices.filter((d) => d.online).length;
  // Fleet tiles use live devices only; an offline device's last readings are stale.
  const withLatest = devices.filter((d) => d.latest && d.online);
  const hottestCpu = pickMax(withLatest, (d) => d.latest?.cpu.packageTemp);
  const highestRam = pickMax(withLatest, (d) => d.latest?.ram.usedPct);
  const hottestGpu = pickMax(withLatest, (d) => d.latest?.gpu?.temp);
  const errored = withLatest.reduce((n, d) => n + (d.latest?.pi?.docker?.errored ?? 0), 0);
  const running = withLatest.reduce((n, d) => n + (d.latest?.pi?.docker?.running ?? 0), 0);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
        <div>
          <h1>PC Monitor</h1>
          <p className="italic">Every machine you own, at a glance.</p>
        </div>
        <div className="topbar-actions">
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                aria-pressed={r.hours === range.hours}
                className={r.hours === range.hours ? "on" : ""}
                onClick={() => setRange(r)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className="action" onClick={() => setPairing("")}>Pair device</button>
          <span className="muted small">{email}</span>
          <button type="button" className="link" onClick={onSignOut}>Sign out</button>
        </div>
        </div>
      </header>

      <main className="page">

      {devices.length === 0 ? (
        <p className="empty">No devices have reported yet.</p>
      ) : (
        <>
          <section className="fleet" aria-label="Fleet summary">
            <Kpi label="Devices online" value={`${online} of ${devices.length}`} hot={online < devices.length} />
            <Kpi
              label="Hottest CPU"
              value={hottestCpu ? hottestCpu.value.toFixed(1) : "n/a"}
              unit={hottestCpu ? "°C" : ""}
              note={hottestCpu ? `${hottestCpu.name} · limit ${CPU_TEMP_LIMIT} °C` : "no CPU sensors"}
              meter={hottestCpu ? (hottestCpu.value / CPU_TEMP_LIMIT) * 100 : undefined}
              hot={hottestCpu ? hottestCpu.value >= CPU_TEMP_LIMIT : false}
            />
            <Kpi
              label="Highest RAM"
              value={highestRam ? Math.round(highestRam.value) : "n/a"}
              unit={highestRam ? "%" : ""}
              note={highestRam ? `${highestRam.name} · limit ${RAM_LIMIT} %` : undefined}
              meter={highestRam?.value}
              hot={highestRam ? highestRam.value >= RAM_LIMIT : false}
            />
            <Kpi
              label="Hottest GPU"
              value={hottestGpu ? Math.round(hottestGpu.value) : "n/a"}
              unit={hottestGpu ? "°C" : ""}
              note={hottestGpu ? `${hottestGpu.name} · limit ${GPU_TEMP_LIMIT} °C` : "no NVIDIA GPU"}
              meter={hottestGpu ? (hottestGpu.value / GPU_TEMP_LIMIT) * 100 : undefined}
              hot={hottestGpu ? hottestGpu.value >= GPU_TEMP_LIMIT : false}
            />
            <Kpi
              label="Containers"
              value={running + errored > 0 ? running : "n/a"}
              unit={running + errored > 0 ? "running" : ""}
              note={running + errored > 0 ? `${errored} errored` : "no Docker host"}
              hot={errored > 0}
            />
          </section>

          {devices.map((d) => (
            <DeviceSection key={d.id} device={d} token={token} range={range} />
          ))}
        </>
      )}
    </main>
    </>
  );
}

function pickMax(devices: Device[], pick: (d: Device) => number | undefined) {
  let best: { name: string; value: number } | null = null;
  for (const d of devices) {
    const v = pick(d);
    if (v !== undefined && (best === null || v > best.value)) best = { name: d.name, value: v };
  }
  return best;
}

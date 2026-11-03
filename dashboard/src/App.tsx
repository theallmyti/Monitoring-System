import { useState } from "react";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { Device, Overview } from "./types";
import { DeviceCard } from "./DeviceCard";

// Owner-only read token. Kept in this browser's localStorage (per-viewer convenience).
const TOKEN_KEY = "pcm-read-token";

export default function App() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  if (!token) {
    return (
      <TokenScreen
        onSave={(t) => {
          try {
            localStorage.setItem(TOKEN_KEY, t);
          } catch {
            /* private window: keep the token in memory only */
          }
          setToken(t);
        }}
      />
    );
  }
  return (
    <Dashboard
      token={token}
      onSignOut={() => {
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        setToken(null);
      }}
    />
  );
}

function TokenScreen({ onSave }: { onSave: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <main className="center">
      <form
        className="login"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
      >
        <h1>PC Monitor</h1>
        <label>
          Dashboard read token
          <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="submit" className="action">Open dashboard</button>
      </form>
    </main>
  );
}

function Dashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const data = useQuery(anyApi.dashboard.overview, { token }) as Overview | undefined;

  if (data === undefined) {
    return (
      <main className="center">
        <p className="empty">Loading readings…</p>
      </main>
    );
  }

  const online = data.devices.filter((d: Device) => d.online).length;

  return (
    <main className="page">
      <header>
        <button type="button" className="link" onClick={onSignOut}>Sign out</button>
      </header>

      <div className="masthead">
        <h1>PC Monitor</h1>
        <p className="italic">Every machine you own, at a glance.</p>
      </div>
      <hr className="rule" />
      <p className="lede">
        {data.devices.length === 0
          ? "No devices have reported yet."
          : `${online} of ${data.devices.length} ${data.devices.length === 1 ? "device" : "devices"} online. Readings update as each agent reports.`}
      </p>

      {data.devices.length > 0 && (
        <div className="entries">
          {data.devices.map((d: Device) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
      )}
    </main>
  );
}

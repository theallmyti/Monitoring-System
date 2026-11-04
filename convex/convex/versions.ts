// Agent versions the backend supports (docs/Development.md §3).
//
// Agents on people's computers cannot all be updated at once, so agent-facing functions
// (agent:*, pairing:*) follow these rules:
//   1. Only add. New arguments are optional; new return fields are ignored by older agents.
//   2. Never rename or remove an argument, return field or function that a supported agent
//      version (>= MIN_AGENT_VERSION) still uses. Add the new one next to it instead.
//   3. To drop something old: release an agent that no longer uses it, raise MIN_AGENT_VERSION
//      to that release, wait until no device in the dashboard reports an older version,
//      then remove it.
//   4. Each agent release raises LATEST_AGENT_VERSION (same as agent/Cargo.toml); devices on
//      an older version show "update available" on the site, and the agent logs it.
export const LATEST_AGENT_VERSION = "0.1.0";
export const MIN_AGENT_VERSION = "0.1.0";

// Compares "x.y.z" versions numerically; missing or non-numeric parts count as 0.
export function compareVersions(a: string, b: string) {
  const parse = (s: string) => s.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export function isOutdated(version: string | undefined) {
  return version !== undefined && compareVersions(version, LATEST_AGENT_VERSION) < 0;
}

export function isUnsupported(version: string | undefined) {
  return version !== undefined && compareVersions(version, MIN_AGENT_VERSION) < 0;
}

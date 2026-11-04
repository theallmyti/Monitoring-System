#!/bin/sh
# PC Monitor agent installer for Linux (x86-64 and ARM64, systemd).
#
#   sudo sh install.sh [path/to/pc-monitor-agent]
#
# Binary: the argument, else ./pc-monitor-agent next to this script, else agent/target/release.
# Convex URL: $CONVEX_URL, else convex-url.txt next to this script (kept out of the repo).
# Steps: copy the binary to /opt/pc-monitor, write /etc/pc-monitor/config.toml (root only),
# show the pairing QR code in this terminal, then enable and start the service.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo sh $0" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }

bin=${1:-}
[ -n "$bin" ] || for c in "$here/pc-monitor-agent" "$here/../../agent/target/release/pc-monitor-agent"; do
  [ -x "$c" ] && { bin=$c; break; }
done
[ -n "$bin" ] && [ -x "$bin" ] || { echo "Agent binary not found. Pass its path: sudo sh $0 /path/to/pc-monitor-agent" >&2; exit 1; }

url=${CONVEX_URL:-}
[ -n "$url" ] || { [ -f "$here/convex-url.txt" ] && url=$(tr -d ' \r\n' < "$here/convex-url.txt"); }
case "$url" in https://*.convex.cloud) ;; *) echo "Set CONVEX_URL or put the Convex URL in $here/convex-url.txt" >&2; exit 1 ;; esac

systemctl stop pc-monitor-agent 2>/dev/null || true
install -d -m 755 /opt/pc-monitor
install -m 755 "$bin" /opt/pc-monitor/pc-monitor-agent

install -d -m 700 /etc/pc-monitor
cfg=/etc/pc-monitor/config.toml
if [ -f "$cfg" ]; then
  # Upgrade: keep the device secret, point at this build's backend.
  sed -i "s|^convex_url *=.*|convex_url = \"$url\"|" "$cfg"
else
  umask 077
  printf '# PC Monitor agent config, written by install.sh.\nconvex_url = "%s"\nlive_interval_secs = 1\n' "$url" > "$cfg"
fi
chmod 600 "$cfg"

echo
echo "Pair this computer: scan the QR code below with the PC Monitor site (Pair device),"
echo "or type the code. Press Ctrl+C to skip; the agent then waits until it is paired."
echo
/opt/pc-monitor/pc-monitor-agent pair "$cfg" || echo "Not paired yet. Pair later with: sudo /opt/pc-monitor/pc-monitor-agent pair $cfg"

install -m 644 "$here/pc-monitor-agent.service" /etc/systemd/system/pc-monitor-agent.service
systemctl daemon-reload
systemctl enable --now pc-monitor-agent
echo
echo "Installed. Status: systemctl status pc-monitor-agent    Log: journalctl -u pc-monitor-agent -f"

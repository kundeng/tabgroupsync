#!/usr/bin/env bash
# Self-serve Edge-sync test bed on ONE Linux box (bayes-pop, Edge 148).
#
# Spins up a SECOND signed-in Edge instance (a copy of the default profile with
# its sync device-id wiped, so Edge treats it as a distinct device that syncs
# with the real one). Both are CDP-drivable → drive source + destination of an
# Edge-sync round-trip without a second machine and without touching the user.
#
#   9222 = real default profile (already running, the "source")
#   9223 = this copy          (the "destination")
#
# Why the ceremony:
#  - Edge 150 (bayes-f0) BLOCKS --remote-debugging-port on the default profile;
#    Edge 148 (bayes-pop) still allows it → run the test bed on bayes-pop.
#  - A copied profile keeps the sign-in ONLY if launched with the desktop
#    session's D-Bus (keyring/portal decrypt) — hence DBUS_SESSION_BUS_ADDRESS.
#  - Copy carries the original's Singleton* locks → Edge would hand off to the
#    running instance; must delete them.
#  - Edge tamper-protection (Secure Preferences MAC) disables the profile's
#    extensions in a copy → load ours fresh with --load-extension.
#  - Wipe "Sync Data" so the copy registers as a NEW device (else same cache_guid
#    = Edge won't sync a device to itself).
set -euo pipefail
PORT="${1:-9223}"
DST=/tmp/edge-sync-B
BUILD="${BUILD:-/home/kundeng/Dropbox/Projects/tabgroup_build/1.5.0}"
U=$(id -u)

pkill -9 -f "user-data-dir=$DST" 2>/dev/null || true
sleep 2
if [ ! -d "$DST" ]; then
  echo "copying profile -> $DST (excluding caches)…"
  rsync -a \
    --exclude="*/Cache/**" --exclude="*/Code Cache/**" --exclude="*/GPUCache/**" \
    --exclude="*/*Cache/**" --exclude="*/Service Worker/CacheStorage/**" \
    --exclude="*/Service Worker/ScriptCache/**" --exclude="Crash Reports/**" \
    --exclude="*/blob_storage/**" \
    "$HOME/.config/microsoft-edge/" "$DST/"
  rm -rf "$DST/Default/Sync Data" "$DST/Default/Sync Extension Settings"
fi
rm -f "$DST"/Singleton* "$DST/DevToolsActivePort" 2>/dev/null || true

setsid env DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$U/bus" XDG_RUNTIME_DIR="/run/user/$U" \
  xvfb-run -a --server-args="-screen 0 1280x1024x24" \
  microsoft-edge --user-data-dir="$DST" \
  --load-extension="$BUILD" --disable-extensions-except="$BUILD" \
  --remote-debugging-port="$PORT" --no-first-run --no-default-browser-check \
  --disable-features=Translate about:blank >/tmp/edge-sync-B.log 2>&1 < /dev/null &
disown || true

for i in $(seq 1 25); do
  curl -s "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && { echo "CDP up on $PORT after ${i}s"; exit 0; }
  sleep 1
done
echo "FAILED to bind CDP on $PORT; see /tmp/edge-sync-B.log" >&2; exit 1

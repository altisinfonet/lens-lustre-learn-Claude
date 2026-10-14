#!/bin/bash
# 50mm Retina World · install or update the converter's pinned FFmpeg (owner
# ruling R-VM-1). Run as root, from this directory:
#
#   sudo bash update-ffmpeg.sh [ffmpeg.pin]           install, verify, swap, self-test, roll back on failure
#   sudo bash update-ffmpeg.sh --no-selftest [pin]    install, verify, swap (setup.sh and CI, before the worker exists)
#
# 1. downloads the pin's file for this machine (x86_64 / aarch64) — or uses
#    FFMPEG_TARBALL — and refuses it unless its sha256 is exactly the pin's;
# 2. installs ffmpeg + ffprobe root-owned under /opt/converter/ffmpeg/<version>-<arch>/
#    and checks they have zscale, tonemap, limiter, libx264, libx265;
# 3. stops converter.service if it runs, points /opt/converter/ffmpeg/current at
#    the new build ATOMICALLY (the old one becomes `previous`);
# 4. runs the worker's self-test through the real sandbox (user converter →
#    converter-ff@<uuid>.service → ffjob-run → the new FFmpeg). If it fails, the
#    previous build is put back (current AND previous links as they were), the
#    failed build is removed, the worker restarted, and the script exits 1;
# 5. records the pin in /opt/converter/ffmpeg.pin, removes builds other than
#    current/previous, and starts converter.service again if it was running.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
selftest=1
if [[ "${1:-}" == "--no-selftest" ]]; then selftest=0; shift; fi
pin="${1:-$here/ffmpeg.pin}"
[[ $EUID -eq 0 ]] || { echo "run as root (sudo bash update-ffmpeg.sh)" >&2; exit 1; }
# shellcheck source=ffmpeg-lib.sh
. "$here/ffmpeg-lib.sh"

# The worker that runs the self-test (step 4) — checked BEFORE anything is changed.
node_bin=""
if [[ $selftest -eq 1 ]]; then
  node_bin="$(sed -n 's#^ExecStart=\([^ ]*\) /opt/converter/worker.mjs$#\1#p' /etc/systemd/system/converter.service 2>/dev/null || true)"
  [[ -x "${node_bin:-}" && -f /opt/converter/worker.mjs ]] || { echo "no installed worker to self-test with (run setup.sh first, or pass --no-selftest)" >&2; exit 1; }
fi

dest="$(ffmpeg_install "$pin" | tail -1)"
[[ -n "$dest" && -x "$dest/bin/ffmpeg" ]] || { echo "install failed" >&2; exit 1; }
old="$(readlink "$FFMPEG_ROOT/current" 2>/dev/null || true)"
old_prev="$(readlink "$FFMPEG_ROOT/previous" 2>/dev/null || true)"
# The pin of the build that is active, kept next to it for the record.
record_pin() {
  [[ "$(realpath -- "$pin")" == "$(realpath -m -- /opt/converter/ffmpeg.pin)" ]] && return 0
  install -D -o root -g root -m 0644 "$pin" /opt/converter/ffmpeg.pin
}

if [[ $selftest -eq 0 ]]; then
  ffmpeg_activate "$dest"
  record_pin
  exit 0
fi

# Stop the worker for the swap — also when systemd is about to restart it.
was_active=0
case "$(systemctl show -p ActiveState --value converter.service 2>/dev/null)" in
  active|activating|reloading)
    was_active=1
    echo "stopping converter.service for the swap (its current job is requeued)"
    systemctl stop converter.service ;;
esac
restore_service() { if [[ $was_active -eq 1 ]]; then systemctl start converter.service || true; fi; }

ffmpeg_activate "$dest"

echo "self-test through the sandbox with the new FFmpeg …"
if runuser -u converter -- env CONVERTER_LAUNCHER=systemd "$node_bin" /opt/converter/worker.mjs --selftest; then
  record_pin
  # Keep only current and previous.
  keep_prev="$(readlink "$FFMPEG_ROOT/previous" 2>/dev/null || true)"
  for d in "$FFMPEG_ROOT"/*/; do
    d="${d%/}"
    [[ "$d" == "$dest" || "$d" == "$keep_prev" ]] && continue
    [[ -L "$d" ]] && continue
    echo "removing old build $d"
    rm -rf --one-file-system -- "$d"
  done
  restore_service
  echo "FFmpeg updated: $dest"
else
  echo "SELF-TEST FAILED with the new FFmpeg — rolling back" >&2
  if [[ -n "$old" && -x "$old/bin/ffmpeg" ]]; then
    ffmpeg_activate "$old"
    # `previous` back to what it was (not the build that just failed).
    if [[ -n "$old_prev" ]]; then
      ln -sfn "$old_prev" "$FFMPEG_ROOT/.previous.tmp" && mv -Tf "$FFMPEG_ROOT/.previous.tmp" "$FFMPEG_ROOT/previous"
    else
      rm -f "$FFMPEG_ROOT/previous"
    fi
    if [[ "$dest" != "$old" && "$dest" != "$old_prev" ]]; then
      echo "removing the failed build $dest" >&2
      rm -rf --one-file-system -- "$dest"
    fi
    echo "rolled back: $FFMPEG_ROOT/current -> $(readlink "$FFMPEG_ROOT/current")" >&2
  else
    echo "no previous build to roll back to — the converter claims nothing until its self-test passes" >&2
  fi
  restore_service
  exit 1
fi

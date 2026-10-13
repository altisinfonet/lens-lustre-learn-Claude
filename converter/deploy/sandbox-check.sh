#!/bin/bash
# 50mm Retina World · prove the converter sandbox on THIS machine, after
# setup.sh and before any member's video (CONVERTER-DESIGN.md v2 §6 [R1]).
# Needs no credentials and no network access to the lane. Run as root:
#
#   sudo bash sandbox-check.sh [--selftest]
#
# Every check runs the way the worker does: as user `converter`, through
# `systemctl start converter-ff@<uuid>.service` (polkit), with the run handed
# over in <job>/.run/. Exits non-zero on the first broken promise:
#   1. converter may start a converter-ff@<uuid> run, and FFmpeg works in it
#   2. converter may NOT start anything else (another unit, a bad name)
#   3. the run cannot read the secrets or the worker's state — even where file
#      modes would allow it (InaccessiblePaths)
#   4. the run has no network
#   5. the run cannot write outside its own job directory
#   6. the per-run time cap ends a run that would never stop
#   --selftest: the worker's own self-test, run under the REAL converter.service,
#               then its network check (DNS + HTTPS out work, 169.254.169.254 does
#               not — NETCHECK_URL, default https://example.com), each through
#               a temporary drop-in, removed afterwards
set -uo pipefail

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
JOBS=/var/lib/converter/jobs
fails=0
ok() { printf 'PASS  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
as_converter() { runuser -u converter -- "$@"; }

newjob() {
  local id; id="$(cat /proc/sys/kernel/random/uuid)"
  as_converter mkdir -m 0770 "$JOBS/$id"   # set-group-ID is inherited from the jobs root, as for the worker
  echo "$id"
}

# run <job> <tool> <timeout> <args...>: hand a run over and start it as the worker would.
run() {
  local id="$1" tool="$2" limit="$3"; shift 3
  local r="$JOBS/$id/.run"
  as_converter rm -rf "$r"
  as_converter mkdir -m 0770 "$r"
  printf '%s' "$tool" | as_converter tee "$r/tool" >/dev/null
  printf '%s' "$limit" | as_converter tee "$r/timeout" >/dev/null
  printf '%s\0' "$@" | as_converter tee "$r/args" >/dev/null
  as_converter systemctl --no-ask-password start "converter-ff@$id.service"
}
exit_of() { cat "$JOBS/$1/.run/exit" 2>/dev/null | tr -d '\n'; }
stderr_of() { cat "$JOBS/$1/.run/stderr" 2>/dev/null; }

echo "systemd: $(systemctl --version | head -1)"
echo "ffmpeg:  $(/usr/bin/ffmpeg -hide_banner -version | head -1)"
mountpoint -q "$JOBS" && ok "the job space is a separate mount ($(findmnt -no SIZE,OPTIONS "$JOBS"))" || bad "the job space is not mounted"

# 1. a run starts, FFmpeg works inside
J="$(newjob)"
jd="$(stat -c '%U:%G %A' "$JOBS/$J")"
if [[ "$jd" == "converter:convjob drwxrws---" ]]; then ok "a job directory is converter:convjob drwxrws--- (set-group-ID inherited)"; else bad "a job directory is $jd"; fi
if run "$J" ffmpeg 60 -hide_banner -nostdin -loglevel error -f lavfi -i testsrc2=size=320x240:rate=10:duration=1 -c:v libx264 -preset ultrafast -f mp4 out.mp4 \
   && [[ "$(exit_of "$J")" == "0" && -s "$JOBS/$J/out.mp4" ]]; then
  ok "converter starts converter-ff@<uuid>; FFmpeg encodes inside it (as $(stat -c %U "$JOBS/$J/out.mp4"))"
  [[ "$(stat -c %U "$JOBS/$J/out.mp4")" == "ffjob" ]] && ok "the run's files belong to ffjob" || bad "the run's files do not belong to ffjob"
else
  bad "a converter-ff run did not work: exit=$(exit_of "$J") $(stderr_of "$J" | tail -2)"
fi

# 2. nothing else may be started
# (journald is always there and already running: even a wrongly allowed start would be a harmless no-op)
if as_converter systemctl --no-ask-password start systemd-journald.service 2>/dev/null; then bad "converter could start systemd-journald.service"; else ok "converter cannot start another unit"; fi
if as_converter systemctl --no-ask-password start "converter-ff@not-a-uuid.service" 2>/dev/null; then bad "converter could start converter-ff@not-a-uuid"; else ok "converter cannot start a converter-ff unit with a non-uuid name"; fi
if as_converter systemctl --no-ask-password restart "converter-ff@$J.service" 2>/dev/null; then bad "converter could RESTART a run"; else ok "converter cannot use other verbs (restart)"; fi

# 3. secrets and state are out of reach — by InaccessiblePaths, not merely by file modes.
#    For a moment the directory is made traversable (0711) and a probe file in it
#    world-readable, so FILE PERMISSIONS alone would let ffjob read it (checked outside
#    the sandbox first); inside a run it must still be refused. The real credentials
#    stay 0600 converter throughout; the modes are restored at once (and on exit).
restore_dirs() {
  rm -f /var/lib/converter/secrets/.sandbox-check /var/lib/converter/state/.sandbox-check
  chmod 0700 /var/lib/converter/secrets /var/lib/converter/state 2>/dev/null || true
}
trap restore_dirs EXIT
for d in secrets state; do
  probe="/var/lib/converter/$d/.sandbox-check"
  chmod 0711 "/var/lib/converter/$d"
  printf 'not-a-real-secret' > "$probe"; chmod 0644 "$probe"
  if runuser -u ffjob -- cat "$probe" >/dev/null 2>&1; then
    run "$J" ffprobe 30 -hide_banner -v error -i "$probe" || true
    if stderr_of "$J" | grep -qiE "permission denied|no such file"; then
      ok "the run cannot read $d/ although its modes would allow it — InaccessiblePaths ($(stderr_of "$J" | tail -1 | cut -c1-70))"
    else
      bad "a run could open a file in $d/: $(stderr_of "$J" | tail -1)"
    fi
  else
    bad "check setup: ffjob could not read the world-readable probe in $d/ outside the sandbox, so this check would prove nothing"
  fi
  rm -f "$probe"; chmod 0700 "/var/lib/converter/$d"
done

# 4. no network
run "$J" ffprobe 20 -hide_banner -v error -rw_timeout 5000000 -i http://1.1.1.1/x.mp4 || true
if [[ "$(exit_of "$J")" != "0" ]] && stderr_of "$J" | grep -qiE "unreachable|network|refused|not permitted|failed to resolve|timed out|address family"; then
  ok "the run has no network ($(stderr_of "$J" | tail -1 | cut -c1-80))"
else
  bad "the run may have network: exit=$(exit_of "$J") $(stderr_of "$J" | tail -1)"
fi

# 5. no writing outside its own job directory
J2="$(newjob)"
run "$J" ffmpeg 30 -hide_banner -nostdin -loglevel error -f lavfi -i testsrc2=duration=1 -frames:v 1 -y "$JOBS/$J2/stolen.jpg" || true
if [[ ! -e "$JOBS/$J2/stolen.jpg" ]]; then ok "the run cannot write into another job's directory"; else bad "the run wrote into another job's directory"; fi
run "$J" ffmpeg 30 -hide_banner -nostdin -loglevel error -f lavfi -i testsrc2=duration=1 -frames:v 1 -y /var/lib/converter/escaped.jpg || true
if [[ ! -e /var/lib/converter/escaped.jpg ]]; then ok "the run cannot write outside the job space"; else bad "the run wrote /var/lib/converter/escaped.jpg"; rm -f /var/lib/converter/escaped.jpg; fi

# 6. the time cap
start=$(date +%s)
run "$J" ffmpeg 10 -hide_banner -nostdin -loglevel error -re -f lavfi -i testsrc2=rate=10 -f null - || true
took=$(( $(date +%s) - start ))
if [[ "$(exit_of "$J")" == "124" || "$(exit_of "$J")" == "137" ]] && (( took < 40 )); then ok "the time cap ended an endless run after ${took} s (exit $(exit_of "$J"))"; else bad "the time cap did not work: exit=$(exit_of "$J") after ${took} s"; fi

rm -rf "${JOBS:?}/$J" "${JOBS:?}/$J2"

echo
systemd-analyze security --no-pager "converter-ff@$J.service" 2>/dev/null | tail -1 || true
systemd-analyze security --no-pager converter.service 2>/dev/null | tail -1 || true

if [[ "${1:-}" == "--selftest" ]]; then
  echo
  echo "== the worker's self-test under the real converter.service sandbox"
  dropin=/etc/systemd/system/converter.service.d
  mkdir -p "$dropin"
  node_bin="$(sed -n 's#^ExecStart=\([^ ]*\) /opt/converter/worker.mjs$#\1#p' /etc/systemd/system/converter.service)"
  cat > "$dropin/zz-sandbox-check.conf" <<EOF
[Service]
Type=oneshot
Restart=no
ExecStart=
ExecStart=$node_bin /opt/converter/worker.mjs --selftest
EOF
  systemctl daemon-reload
  if systemctl start converter.service; then ok "self-test passed under converter.service"; else bad "self-test failed under converter.service"; fi
  journalctl -u converter.service -o cat --no-pager -n 20 | grep -E '"event":"(worker\.selftest|job\.)' || true

  echo
  echo "== the worker unit's network: DNS + HTTPS out work, the link-local metadata address does not (IPAddressDeny=link-local)"
  cat > "$dropin/zz-sandbox-check.conf" <<EOF
[Service]
Type=oneshot
Restart=no
ExecStart=
ExecStart=$node_bin /opt/converter/worker.mjs --netcheck ${NETCHECK_URL:-https://example.com}
EOF
  systemctl daemon-reload
  if systemctl start converter.service; then ok "under converter.service: names resolve, HTTPS goes out, 169.254.169.254 is unreachable"; else bad "the network check failed under converter.service"; fi
  journalctl -u converter.service -o cat --no-pager -n 5 | grep -E '"event":"worker\.netcheck"' || true
  rm -f "$dropin/zz-sandbox-check.conf"
  rmdir "$dropin" 2>/dev/null || true
  systemctl daemon-reload
fi

echo
if (( fails > 0 )); then echo "$fails check(s) FAILED"; exit 1; fi
echo "all checks passed"

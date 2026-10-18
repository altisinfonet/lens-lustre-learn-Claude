#!/bin/bash
# 50mm Retina World · prove the converter sandbox on THIS machine, after
# setup.sh and before any member's video (CONVERTER-DESIGN.md v2 §6 [R1]; S7 lanes).
# Needs no credentials and no network access to the lane. Run as root, once per lane:
#
#   sudo bash sandbox-check.sh [--lane staging|live] [--selftest]
#
# Every check runs the way the worker does: as the lane's worker user (converter |
# converter-live), through `systemctl start <lane prefix>@<uuid>.service` (polkit),
# with the run handed over in <job>/.run/. Exits non-zero on the first broken promise:
#   1. the worker may start its lane's sandbox run, and FFmpeg works in it
#   2. the worker may NOT start anything else (another unit, a bad name, another verb)
#   3. the run cannot read the lane's secrets or the worker's state — even where file
#      modes would allow it (InaccessiblePaths)
#   4. the run has no network
#   5. the run cannot write outside its own job directory
#   6. the per-run time cap ends a run that would never stop
#   7. LANE SEPARATION (when the other lane is installed on this machine too):
#      the worker cannot start or stop the other lane's sandbox units (polkit); it
#      cannot read the other lane's secrets, state, env file or job space (file modes);
#      and this lane's run cannot read the other lane's secrets, state or job files —
#      even where file modes would allow it (InaccessiblePaths)
#   --selftest: the worker's own self-test, run under the REAL worker unit, then its
#               network check (DNS + HTTPS out work, 169.254.169.254 does
#               not — NETCHECK_URL, default https://example.com), each through
#               a temporary drop-in, removed afterwards; plus the positive control
#               (outside the unit the metadata address DOES answer, where it exists);
#               and (7) under the real worker unit, the other lane's files are out of
#               reach although their modes allow it, with its positive control.
#               Refused while the worker unit is running: stop it first.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lane-lib.sh
. "$here/lane-lib.sh"
lane=staging
selftest=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lane) lane="${2:-}"; shift 2 ;;
    --selftest) selftest=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
lane_vars "$lane" || exit 2
other_lane_vars "$LANE"

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
fails=0
ok() { printf 'PASS  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
as_worker() { runuser -u "$WORKER_USER" -- "$@"; }
as_other() { runuser -u "$OTHER_WORKER_USER" -- "$@"; }
# the other lane is installed here: its worker user, directories and sandbox template exist
other_installed=0
if id -u "$OTHER_WORKER_USER" >/dev/null 2>&1 && [[ -d "$OTHER_BASE/secrets" && -d "$OTHER_BASE/state" && -f "/etc/systemd/system/$OTHER_FF_PREFIX@.service" ]] && mountpoint -q "$OTHER_JOBS"; then
  other_installed=1
fi

newjob() {
  local id; id="$(cat /proc/sys/kernel/random/uuid)"
  as_worker mkdir -m 0770 "$JOBS/$id"   # set-group-ID is inherited from the jobs root, as for the worker
  echo "$id"
}

# run <job> <tool> <timeout> <args...>: hand a run over and start it as the worker would.
run() {
  local id="$1" tool="$2" limit="$3"; shift 3
  local r="$JOBS/$id/.run"
  as_worker rm -rf "$r"
  as_worker mkdir -m 0770 "$r"
  printf '%s' "$tool" | as_worker tee "$r/tool" >/dev/null
  printf '%s' "$limit" | as_worker tee "$r/timeout" >/dev/null
  printf '%s\0' "$@" | as_worker tee "$r/args" >/dev/null
  as_worker systemctl --no-ask-password start "$FF_PREFIX@$id.service"
}
exit_of() { cat "$JOBS/$1/.run/exit" 2>/dev/null | tr -d '\n'; }
stderr_of() { cat "$JOBS/$1/.run/stderr" 2>/dev/null; }

echo "lane:    $LANE (worker $WORKER_USER, runs $FF_PREFIX@<uuid> as $FF_USER, $BASE)"
echo "systemd: $(systemctl --version | head -1)"
echo "ffmpeg:  $(/opt/converter/ffmpeg/current/bin/ffmpeg -hide_banner -version | head -1)  ($(readlink /opt/converter/ffmpeg/current))"
mountpoint -q "$JOBS" && ok "the job space is a separate mount ($(findmnt -no SIZE,OPTIONS "$JOBS"))" || bad "the job space is not mounted"

# 1. a run starts, FFmpeg works inside
J="$(newjob)"
jd="$(stat -c '%U:%G %A' "$JOBS/$J")"
if [[ "$jd" == "$WORKER_USER:$JOB_GROUP drwxrws---" ]]; then ok "a job directory is $WORKER_USER:$JOB_GROUP drwxrws--- (set-group-ID inherited)"; else bad "a job directory is $jd"; fi
if run "$J" ffmpeg 60 -hide_banner -nostdin -loglevel error -f lavfi -i testsrc2=size=320x240:rate=10:duration=1 -c:v libx264 -preset ultrafast -f mp4 out.mp4 \
   && [[ "$(exit_of "$J")" == "0" && -s "$JOBS/$J/out.mp4" ]]; then
  ok "$WORKER_USER starts $FF_PREFIX@<uuid>; FFmpeg encodes inside it (as $(stat -c %U "$JOBS/$J/out.mp4"))"
  [[ "$(stat -c %U "$JOBS/$J/out.mp4")" == "$FF_USER" ]] && ok "the run's files belong to $FF_USER" || bad "the run's files do not belong to $FF_USER"
else
  bad "a $FF_PREFIX run did not work: exit=$(exit_of "$J") $(stderr_of "$J" | tail -2)"
fi

# 2. nothing else may be started
# (journald is always there and already running: even a wrongly allowed start would be a harmless no-op)
if as_worker systemctl --no-ask-password start systemd-journald.service 2>/dev/null; then bad "$WORKER_USER could start systemd-journald.service"; else ok "$WORKER_USER cannot start another unit"; fi
if as_worker systemctl --no-ask-password start "$FF_PREFIX@not-a-uuid.service" 2>/dev/null; then bad "$WORKER_USER could start $FF_PREFIX@not-a-uuid"; else ok "$WORKER_USER cannot start a $FF_PREFIX unit with a non-uuid name"; fi
if as_worker systemctl --no-ask-password restart "$FF_PREFIX@$J.service" 2>/dev/null; then bad "$WORKER_USER could RESTART a run"; else ok "$WORKER_USER cannot use other verbs (restart)"; fi

# 3. secrets and state are out of reach — by InaccessiblePaths, not merely by file modes.
#    For a moment the directory is made traversable (0711) and a probe file in it
#    world-readable, so FILE PERMISSIONS alone would let the FFmpeg user read it (checked
#    outside the sandbox first); inside a run it must still be refused. The real credentials
#    stay 0600 throughout; the modes are restored at once (and on exit).
#    Every write here is done AS the directory's worker (re-review N1): these directories
#    are the worker's, so root never creates, chmods or writes through a name in them —
#    a planted symlink gets no more than that worker's own rights.
restore_dirs() {
  for d in secrets state; do
    as_worker rm -f "$BASE/$d/.sandbox-check" 2>/dev/null || true
    as_worker chmod 0700 "$BASE/$d" 2>/dev/null || true
  done
}
# The other lane's files, loosened the same way for check 7 (as THAT lane's worker, N1).
OJ=""
loosen_other() {
  for d in secrets state; do
    as_other chmod 0711 "$OTHER_BASE/$d"
    as_other rm -f "$OTHER_BASE/$d/.sandbox-check"
    # shellcheck disable=SC2016
    as_other sh -c 'umask 022; printf not-a-real-secret > "$1"' sh "$OTHER_BASE/$d/.sandbox-check"
  done
  OJ="$(cat /proc/sys/kernel/random/uuid)"
  as_other chmod 2751 "$OTHER_JOBS"
  as_other mkdir -m 0771 "$OTHER_JOBS/$OJ"
  # shellcheck disable=SC2016
  as_other sh -c 'umask 022; printf not-a-real-video > "$1"' sh "$OTHER_JOBS/$OJ/probe"
}
restore_other() {
  [[ $other_installed -eq 1 ]] || return 0
  for d in secrets state; do
    as_other rm -f "$OTHER_BASE/$d/.sandbox-check" 2>/dev/null || true
    as_other chmod 0700 "$OTHER_BASE/$d" 2>/dev/null || true
  done
  [[ -n "$OJ" ]] && { as_other rm -rf "$OTHER_JOBS/$OJ" 2>/dev/null || true; }
  as_other chmod 2750 "$OTHER_JOBS" 2>/dev/null || true
  OJ=""
}
other_probes() { printf '%s\n' "$OTHER_BASE/secrets/.sandbox-check" "$OTHER_BASE/state/.sandbox-check" "$OTHER_JOBS/$OJ/probe"; }
trap 'restore_dirs; restore_other' EXIT
for d in secrets state; do
  probe="$BASE/$d/.sandbox-check"
  as_worker chmod 0711 "$BASE/$d"
  as_worker rm -f "$probe"
  # shellcheck disable=SC2016  # $1 is expanded by the inner sh, as the worker
  as_worker sh -c 'umask 022; printf not-a-real-secret > "$1"' sh "$probe"
  if runuser -u "$FF_USER" -- cat "$probe" >/dev/null 2>&1; then
    run "$J" ffprobe 30 -hide_banner -v error -i "$probe" || true
    if stderr_of "$J" | grep -qiE "permission denied|no such file"; then
      ok "the run cannot read $d/ although its modes would allow it — InaccessiblePaths ($(stderr_of "$J" | tail -1 | cut -c1-70))"
    else
      bad "a run could open a file in $d/: $(stderr_of "$J" | tail -1)"
    fi
  else
    bad "check setup: $FF_USER could not read the world-readable probe in $d/ outside the sandbox, so this check would prove nothing"
  fi
  as_worker rm -f "$probe"; as_worker chmod 0700 "$BASE/$d"
done
# 3b. the persisted session (CONVERTER_SESSION_FILE = state/session.json, the refresh token): in state/,
#     so the checks above (and 7) already prove no run of either lane and no other lane's worker can read
#     it; here, that the file itself is the worker's alone. Its content is never read.
sess="$BASE/state/session.json"
if [[ -L "$sess" ]]; then
  bad "$sess is a symbolic link"
elif [[ -e "$sess" ]]; then
  if [[ -f "$sess" && "$(stat -c '%U:%G %a' -- "$sess")" == "$WORKER_USER:$WORKER_USER 600" ]]; then ok "the session file is $WORKER_USER:$WORKER_USER 0600 (in state/: hidden from every run and from the other lane)"; else bad "the session file is $(stat -c '%F %U:%G %a' -- "$sess")"; fi
else
  echo "NOTE  no $sess yet (written at the worker's first sign-in, or by install-session.sh)"
fi

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
run "$J" ffmpeg 30 -hide_banner -nostdin -loglevel error -f lavfi -i testsrc2=duration=1 -frames:v 1 -y "$BASE/escaped.jpg" || true
if [[ ! -e "$BASE/escaped.jpg" ]]; then ok "the run cannot write outside the job space"; else bad "the run wrote $BASE/escaped.jpg"; rm -f "$BASE/escaped.jpg"; fi

# 6. the time cap
start=$(date +%s)
run "$J" ffmpeg 10 -hide_banner -nostdin -loglevel error -re -f lavfi -i testsrc2=rate=10 -f null - || true
took=$(( $(date +%s) - start ))
if [[ "$(exit_of "$J")" == "124" || "$(exit_of "$J")" == "137" ]] && (( took < 40 )); then ok "the time cap ended an endless run after ${took} s (exit $(exit_of "$J"))"; else bad "the time cap did not work: exit=$(exit_of "$J") after ${took} s"; fi

# 7. lane separation
echo
if [[ $other_installed -eq 0 ]]; then
  echo "NOTE  the $OTHER_LANE lane is not installed on this machine: the cross-lane checks (7) were not run"
else
  echo "== lane separation: $LANE ($WORKER_USER, $FF_USER) against $OTHER_LANE ($OTHER_WORKER_USER, $OTHER_FF_USER)"
  X="$(cat /proc/sys/kernel/random/uuid)"
  # polkit: `stop` of an inactive unit is a harmless no-op that SUCCEEDS if allowed; `start` must be refused BY POLKIT.
  if as_worker systemctl --no-ask-password stop "$OTHER_FF_PREFIX@$X.service" 2>/dev/null; then bad "$WORKER_USER could stop the $OTHER_LANE lane's $OTHER_FF_PREFIX@<uuid>"; else ok "$WORKER_USER cannot stop the $OTHER_LANE lane's sandbox runs"; fi
  out="$(as_worker systemctl --no-ask-password start "$OTHER_FF_PREFIX@$X.service" 2>&1)"; rc=$?
  if (( rc != 0 )) && grep -qiE "access denied|authentication required|not allowed|permission" <<<"$out"; then ok "$WORKER_USER cannot start the $OTHER_LANE lane's sandbox runs (polkit: $(head -1 <<<"$out" | cut -c1-60))"; else bad "$WORKER_USER starting $OTHER_FF_PREFIX@<uuid>: rc=$rc $(head -1 <<<"$out")"; fi
  # the real modes: nothing of the other lane is readable to this lane's users
  for u in "$WORKER_USER" "$FF_USER"; do
    for p in "$OTHER_BASE/secrets" "$OTHER_BASE/state" "$OTHER_JOBS"; do
      if runuser -u "$u" -- ls "$p" >/dev/null 2>&1; then bad "$u can list $p"; else ok "$u cannot list $p (file modes)"; fi
    done
  done
  if [[ -f "$OTHER_ENV_FILE" ]]; then
    if as_worker cat "$OTHER_ENV_FILE" >/dev/null 2>&1; then bad "$WORKER_USER can read $OTHER_ENV_FILE"; else ok "$WORKER_USER cannot read $OTHER_ENV_FILE"; fi
  fi
  # InaccessiblePaths: loosen the other lane's modes so they would ALLOW reading, prove it, then a run must still fail.
  loosen_other
  while IFS= read -r p; do
    if runuser -u "$FF_USER" -- cat "$p" >/dev/null 2>&1; then
      run "$J" ffprobe 30 -hide_banner -v error -i "$p" || true
      if stderr_of "$J" | grep -qiE "permission denied|no such file"; then
        ok "the run cannot read the $OTHER_LANE lane's ${p#"$OTHER_BASE"/} although its modes would allow it — InaccessiblePaths"
      else
        bad "a $LANE run could open the $OTHER_LANE lane's $p: $(stderr_of "$J" | tail -1)"
      fi
    else
      bad "check setup: $FF_USER could not read the loosened $p outside the sandbox, so this check would prove nothing"
    fi
  done < <(other_probes)
  restore_other
  [[ "$(stat -c '%U:%G %a' "$OTHER_JOBS")" == "$OTHER_WORKER_USER:$( (lane_vars "$OTHER_LANE" && echo "$JOB_GROUP") ) 2750" ]] && ok "the $OTHER_LANE lane's modes are restored" || bad "the $OTHER_LANE lane's job root is $(stat -c '%U:%G %a' "$OTHER_JOBS")"
fi

rm -rf "${JOBS:?}/$J" "${JOBS:?}/$J2"

echo
systemd-analyze security --no-pager "$FF_PREFIX@$J.service" 2>/dev/null | tail -1 || true
systemd-analyze security --no-pager "$UNIT" 2>/dev/null | tail -1 || true

# start_oneshot <event>: start the worker unit (with the drop-in) and prove that THIS
# start ran and passed — not merely that `systemctl start` returned 0 (re-review N3).
# The proof is the unit's own result line, {"event":"<event>","ok":true,…}, in the
# journal AFTER the cursor taken just before the start. (The unit's properties cannot be
# used for this: a finished oneshot is unloaded and `systemctl show` then reads zeros for
# its start time and status — measured in CI.)
start_oneshot() {
  local event="$1" cursor lines line hit="" rc=0
  cursor="$(journalctl -n 1 -o cat --show-cursor --no-pager 2>/dev/null | sed -n 's/^-- cursor: //p' | tail -1)"
  [[ -n "$cursor" ]] || { echo "  (no journal cursor: cannot prove that the unit ran)"; return 1; }
  systemctl start "$UNIT" || rc=$?
  journalctl --sync 2>/dev/null || true
  lines="$(journalctl -u "$UNIT" --after-cursor="$cursor" -o cat --no-pager 2>/dev/null || true)"
  grep -E '"event":"(worker\.(selftest|netcheck)|lane\.isolation|job\.)' <<<"$lines" || true
  (( rc == 0 )) || { echo "  (systemctl start $UNIT returned $rc)"; return 1; }
  while IFS= read -r line; do
    [[ "$line" == *"\"event\":\"$event\""* && "$line" == *'"ok":true'* ]] && hit=1
  done <<<"$lines"
  [[ -n "$hit" ]] || { echo "  (no \"$event\" line with ok:true in the journal since this start: the unit did not run it)"; return 1; }
}

if [[ $selftest -eq 1 ]]; then
  echo
  # Re-review N3: while the real worker runs, `systemctl start` is a no-op that returns 0 —
  # the checks below would PASS without running. Refuse instead.
  state="$(systemctl show -p ActiveState --value "$UNIT")"
  if [[ "$state" != "inactive" && "$state" != "failed" ]]; then
    bad "$UNIT is $state — stop it first (sudo systemctl stop $UNIT), then run --selftest again; the self-test and network check were NOT run"
  else
    echo "== the worker's self-test under the real $UNIT sandbox"
    dropin="/etc/systemd/system/$UNIT.d"
    probe_sh=/run/converter-lane-probe.sh
    mkdir -p "$dropin"
    trap 'restore_dirs; restore_other; rm -f "$dropin/zz-sandbox-check.conf" "$probe_sh"; rmdir "$dropin" 2>/dev/null; systemctl daemon-reload' EXIT
    node_bin="$(sed -n "s#^ExecStart=\([^ ]*\) $OPT/worker.mjs\$#\1#p" "/etc/systemd/system/$UNIT")"
    cat > "$dropin/zz-sandbox-check.conf" <<EOF
[Service]
Type=oneshot
Restart=no
ExecStart=
ExecStart=$node_bin $OPT/worker.mjs --selftest
EOF
    systemctl daemon-reload
    if start_oneshot worker.selftest; then ok "self-test passed under $UNIT"; else bad "self-test failed under $UNIT"; fi

    echo
    echo "== the worker unit's network: DNS + HTTPS out work, the link-local metadata address does not (IPAddressDeny=link-local)"
    cat > "$dropin/zz-sandbox-check.conf" <<EOF
[Service]
Type=oneshot
Restart=no
ExecStart=
ExecStart=$node_bin $OPT/worker.mjs --netcheck ${NETCHECK_URL:-https://example.com}
EOF
    systemctl daemon-reload
    if start_oneshot worker.netcheck; then ok "under $UNIT: names resolve, HTTPS goes out, 169.254.169.254 is unreachable"; else bad "the network check failed under $UNIT"; fi
    # The positive control (re-review N6d): the same user, OUTSIDE the unit. Only if the
    # metadata address answers here does "unreachable" above prove IPAddressDeny.
    if as_worker "$node_bin" "$OPT/worker.mjs" --netcheck-control >/dev/null 2>&1; then
      ok "positive control: outside $UNIT the same user DOES reach 169.254.169.254 — the unit's IPAddressDeny is what blocks it"
    else
      echo "NOTE  169.254.169.254 does not answer on this machine even outside the unit, so the unit's refusal above is not proof of IPAddressDeny by itself (systemd-analyze security and the unit file still show it)"
    fi

    if [[ $other_installed -eq 1 ]]; then
      echo
      echo "== lane separation under the real $UNIT: the $OTHER_LANE lane's files are out of reach (InaccessiblePaths)"
      # one JSON line, like the worker's: ok:true when NONE of the given files can be read
      cat > "$probe_sh" <<'EOF'
#!/bin/sh
for f in "$@"; do
  if head -c 1 "$f" >/dev/null 2>&1; then echo '{"event":"lane.isolation","ok":false}'; exit 1; fi
done
echo '{"event":"lane.isolation","ok":true}'
EOF
      chmod 0644 "$probe_sh"
      loosen_other
      mapfile -t probes < <(other_probes)
      cat > "$dropin/zz-sandbox-check.conf" <<EOF
[Service]
Type=oneshot
Restart=no
ExecStart=
ExecStart=/bin/sh $probe_sh ${probes[*]}
EOF
      systemctl daemon-reload
      if start_oneshot lane.isolation; then ok "under $UNIT: the $OTHER_LANE lane's secrets, state and job files cannot be read"; else bad "under $UNIT: a file of the $OTHER_LANE lane could be read"; fi
      # positive control: the same user, the same files, OUTSIDE the unit — the modes allow it
      if as_worker sh "$probe_sh" "${probes[@]}" >/dev/null 2>&1; then
        bad "check setup: outside $UNIT, $WORKER_USER could not read the loosened files either, so the check above proves only file modes"
      else
        ok "positive control: outside $UNIT the same user CAN read those loosened files — the unit's InaccessiblePaths is what blocks it"
      fi
      restore_other
      rm -f "$probe_sh"
    fi
    rm -f "$dropin/zz-sandbox-check.conf"
    rmdir "$dropin" 2>/dev/null || true
    systemctl daemon-reload
    systemctl reset-failed "$UNIT" 2>/dev/null || true
    trap 'restore_dirs; restore_other' EXIT
  fi
fi

echo
if (( fails > 0 )); then echo "$fails check(s) FAILED"; exit 1; fi
echo "all checks passed"

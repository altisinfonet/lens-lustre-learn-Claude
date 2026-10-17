#!/bin/bash
# 50mm Retina World · converter VM setup (CONVERTER-DESIGN.md v2 §6, [R1]; S7 two lanes).
# Ubuntu 24.04 (systemd 255, polkit 124). Run as root from this directory:
#
#   sudo bash setup.sh [--lane staging|live] [--worker /path/to/worker.mjs] [--enable]
#
# One VM, two LANES, kept apart (lane-lib.sh has the full table):
#   --lane staging (the default — exactly the original install)
#      users converter + ffjob, group convjob, /var/lib/converter, converter.service,
#      converter-ff@.service, /etc/converter/converter.env, /opt/converter/worker.mjs
#   --lane live
#      users converter-live + ffjob-live, group convjob-live, /var/lib/converter-live,
#      converter-live.service, converter-live-ff@.service,
#      /etc/converter/converter-live.env, /opt/converter-live/worker.mjs
# Each lane has its own job space (a size-capped ext4 image at <base>/jobs). Shared by
# both and root-owned: the pinned FFmpeg, ffjob-run, the polkit rule (each worker may
# start/stop ONLY its own lane's sandbox units), Node.
#
# Idempotent: running it again changes nothing (files are only rewritten when their
# content, owner or mode differ; it never deletes a job filesystem, state or secrets).
# Per lane it creates:
#   users      the worker, the FFmpeg user, the job group (both: the FFmpeg user writes
#              a job's files, the worker reads them)
#   dirs       <base>/{secrets 0700, state 0700} (the worker's), <opt>, /usr/local/lib/converter,
#              /etc/converter (root)
#   job space  <base>/jobs.img (JOBS_FS_SIZE, default 4G, ext4) mounted loop,nodev,nosuid,noexec
#              at <base>/jobs
#   units      the worker unit, the sandbox template, the mount unit
#   polkit     50-converter-ff.rules
#   FFmpeg     the PINNED static build (ffmpeg.pin, sha256-verified; owner ruling
#              R-VM-1 — nothing paid or chargeable) at /opt/converter/ffmpeg/current
# It does NOT write the credentials (a separate, Owner-run step does), never reads or
# prints them, and does NOT start the worker unless --enable is given AND they exist.
#
# Environment: JOBS_FS_SIZE (4G) · NODE_BIN (the `node` on PATH) · SKIP_APT=1 ·
#              FFMPEG_TARBALL (a pre-downloaded copy of the pinned file; still verified)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lane-lib.sh
. "$here/lane-lib.sh"
worker=""
enable=0
lane=staging
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lane) lane="${2:-}"; shift 2 ;;
    --worker) worker="$2"; shift 2 ;;
    --enable) enable=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
lane_vars "$lane" || exit 2

say() { printf '\n== %s\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo bash setup.sh)" >&2; exit 1; }

JOBS_FS_SIZE="${JOBS_FS_SIZE:-4G}"
changed_units=0
changed_rules=0

# put <src> <dest> <owner> <group> <mode>: install only when content, owner or mode differ.
put() {
  local src="$1" dest="$2" own="$3" grp="$4" mode="$5"
  if [[ -f "$dest" && ! -L "$dest" ]] && cmp -s -- "$src" "$dest" \
     && [[ "$(stat -c '%U:%G %a' -- "$dest")" == "$own:$grp ${mode#0}" ]]; then
    echo "unchanged: $dest"; return 1
  fi
  install -o "$own" -g "$grp" -m "$mode" -- "$src" "$dest"
  echo "installed: $dest"
}
# dir <path> <owner> <group> <mode>
dir() {
  local p="$1" own="$2" grp="$3" mode="$4"
  if [[ -d "$p" && ! -L "$p" && "$(stat -c '%U:%G %a' -- "$p")" == "$own:$grp ${mode#0}" ]]; then return 0; fi
  install -d -o "$own" -g "$grp" -m "$mode" -- "$p"
  echo "directory: $p ($own:$grp $mode)"
}
in_group() { id -nG "$1" 2>/dev/null | tr ' ' '\n' | grep -qx "$2"; }

say "checking the system (lane: $LANE)"
. /etc/os-release 2>/dev/null || true
echo "os: ${PRETTY_NAME:-unknown}  arch: $(uname -m)  systemd: $(systemctl --version | head -1)"
[[ "${VERSION_ID:-}" == "24.04" ]] || echo "WARNING: written for Ubuntu 24.04; this is ${VERSION_ID:-unknown}"
if command -v systemd-escape >/dev/null; then
  [[ "$(systemd-escape -p --suffix=mount "$JOBS")" == "$MOUNT_UNIT" ]] || { echo "lane-lib.sh: MOUNT_UNIT is not systemd's name for $JOBS" >&2; exit 1; }
fi

need_apt=()
[[ -x /usr/lib/polkit-1/polkitd ]] || need_apt+=(polkitd)
command -v timeout >/dev/null || need_apt+=(coreutils)
command -v curl >/dev/null || need_apt+=(curl)
command -v xz >/dev/null || need_apt+=(xz-utils)
if [[ ${#need_apt[@]} -gt 0 ]]; then
  if [[ "${SKIP_APT:-0}" == "1" ]]; then
    echo "missing: ${need_apt[*]} (SKIP_APT=1, not installing)" >&2; exit 1
  fi
  echo "installing: ${need_apt[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${need_apt[@]}"
fi

say "FFmpeg: the pinned static build (ffmpeg.pin — owner ruling R-VM-1), shared by both lanes"
# Ubuntu's own `ffmpeg` package (universe) is NOT used or installed: its security fixes come only
# through a subscription that owner ruling R-VM-1 excludes.
bash "$here/update-ffmpeg.sh" --no-selftest "$here/ffmpeg.pin"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo "Node 22 is required (NODE_BIN or node on PATH)" >&2; exit 1; }
node_major="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
(( node_major >= 22 )) || { echo "Node 22+ is required; $NODE_BIN is $("$NODE_BIN" --version)" >&2; exit 1; }
echo "node: $NODE_BIN $("$NODE_BIN" --version)"

say "users and groups ($WORKER_USER, $FF_USER, $JOB_GROUP)"
getent group "$JOB_GROUP" >/dev/null || groupadd --system "$JOB_GROUP"
id -u "$WORKER_USER" >/dev/null 2>&1 || useradd --system --user-group --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$WORKER_USER"
id -u "$FF_USER" >/dev/null 2>&1 || useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$FF_USER"
in_group "$WORKER_USER" "$JOB_GROUP" || usermod -a -G "$JOB_GROUP" "$WORKER_USER"
in_group "$FF_USER" "$JOB_GROUP" || usermod -a -G "$JOB_GROUP" "$FF_USER"
# Lane separation: neither of this lane's users may be in the other lane's groups.
other_lane_vars "$LANE"
for u in "$WORKER_USER" "$FF_USER"; do
  for g in "$OTHER_WORKER_USER" "$OTHER_FF_USER" "$( (lane_vars "$OTHER_LANE" && echo "$JOB_GROUP") )"; do
    if in_group "$u" "$g"; then echo "REFUSED: $u is in the other lane's group $g — remove it (gpasswd -d $u $g)" >&2; exit 1; fi
  done
done
id "$WORKER_USER"; id "$FF_USER"

say "directories"
dir "$BASE" root root 0755
for d in /opt/converter "$OPT" /usr/local/lib/converter /etc/converter; do dir "$d" root root 0755; done
dir "$BASE/secrets" "$WORKER_USER" "$WORKER_USER" 0700
dir "$BASE/state" "$WORKER_USER" "$WORKER_USER" 0700
[[ -d "$JOBS" ]] || install -d -o root -g root -m 0755 "$JOBS"

say "the job space (${JOBS_FS_SIZE}, ext4, loop,nodev,nosuid,noexec) at $JOBS"
if [[ ! -f "$BASE/jobs.img" ]]; then
  fallocate -l "$JOBS_FS_SIZE" "$BASE/jobs.img"
  chmod 0600 "$BASE/jobs.img"
  label=convjobs; [[ "$LANE" == live ]] && label=convjobs-live
  mkfs.ext4 -q -F -m 0 -L "$label" "$BASE/jobs.img"
else
  echo "keeping the existing $BASE/jobs.img ($(du -h --apparent-size "$BASE/jobs.img" | cut -f1))"
fi
tmpu="$(mktemp -d)"
trap 'rm -rf "$tmpu"' EXIT
render "$LANE" "$here/var-lib-converter-jobs.mount" > "$tmpu/mount"
if put "$tmpu/mount" "/etc/systemd/system/$MOUNT_UNIT" root root 0644; then changed_units=1; fi
(( changed_units )) && systemctl daemon-reload
systemctl is-enabled --quiet "$MOUNT_UNIT" 2>/dev/null || systemctl enable "$MOUNT_UNIT"
systemctl is-active --quiet "$MOUNT_UNIT" || systemctl start "$MOUNT_UNIT"
mountpoint -q "$JOBS" || { echo "the job space is not mounted" >&2; exit 1; }
# the worker creates one directory per job; the FFmpeg user (group) may only pass through.
[[ "$(stat -c '%U:%G %a' "$JOBS")" == "$WORKER_USER:$JOB_GROUP 2750" ]] || { chown "$WORKER_USER:$JOB_GROUP" "$JOBS"; chmod 2750 "$JOBS"; echo "job space root: $WORKER_USER:$JOB_GROUP 2750"; }
findmnt -no SOURCE,FSTYPE,SIZE,OPTIONS "$JOBS"

say "the sandbox runner, units and the polkit rule"
put "$here/ffjob-run" /usr/local/lib/converter/ffjob-run root root 0755 || true
render "$LANE" "$here/converter-ff@.service" > "$tmpu/ff"
if put "$tmpu/ff" "/etc/systemd/system/$FF_PREFIX@.service" root root 0644; then changed_units=1; fi
render "$LANE" "$here/converter.service" | sed "s#@NODE_BIN@#${NODE_BIN}#g" > "$tmpu/worker"
if put "$tmpu/worker" "/etc/systemd/system/$UNIT" root root 0644; then changed_units=1; fi
dir /etc/polkit-1/rules.d root root 0755
if put "$here/50-converter-ff.rules" /etc/polkit-1/rules.d/50-converter-ff.rules root root 0644; then changed_rules=1; fi
[[ -f "$here/README.md" ]] && { put "$here/README.md" /opt/converter/README.md root root 0644 || true; }
if [[ ! -f "$ENV_FILE" ]]; then
  install -o root -g "$WORKER_USER" -m 0640 "$here/$ENV_EXAMPLE" "$ENV_FILE"
  echo "wrote $ENV_FILE from $ENV_EXAMPLE — fill in the REPLACE values (site origin, Supabase URL, anon key, R2 host)"
elif [[ "$(stat -c '%U:%G %a' "$ENV_FILE")" != "root:$WORKER_USER 640" ]]; then
  chown "root:$WORKER_USER" "$ENV_FILE"; chmod 0640 "$ENV_FILE"; echo "fixed owner/mode of $ENV_FILE (root:$WORKER_USER 0640)"
else
  echo "unchanged: $ENV_FILE (not read here)"
fi
(( changed_units )) && systemctl daemon-reload
# polkitd re-reads rules.d by itself; a restart makes it certain.
(( changed_rules )) && { systemctl try-restart polkit.service 2>/dev/null || true; }

if [[ -n "$worker" ]]; then
  say "the worker bundle → $OPT/worker.mjs"
  if [[ -f "$worker.sha256" ]]; then
    (cd "$(dirname "$worker")" && sha256sum -c "$(basename "$worker").sha256")
  fi
  put "$worker" "$OPT/worker.mjs" root root 0644 || true
  sha256sum "$OPT/worker.mjs"
fi

say "operating-system security updates"
# FFmpeg is the pinned build (update-ffmpeg.sh). Everything else comes from Ubuntu's
# main archive, whose security fixes are free — as long as they are applied.
uu="$(apt-config dump APT::Periodic::Unattended-Upgrade 2>/dev/null | head -1 || true)"
if [[ "$uu" == *'"1"'* ]]; then
  echo "unattended-upgrades: on"
else
  echo "WARNING: unattended security upgrades are not on ($uu) — enable them: sudo dpkg-reconfigure -plow unattended-upgrades" >&2
fi

say "unit files check (systemd-analyze verify)"
tmpd="$(mktemp -d)"
cp "/etc/systemd/system/$UNIT" "$tmpd/"
cp "/etc/systemd/system/$FF_PREFIX@.service" "$tmpd/$FF_PREFIX@00000000-0000-4000-8000-000000000000.service"
systemd-analyze verify "$tmpd/$UNIT" "$tmpd/$FF_PREFIX@00000000-0000-4000-8000-000000000000.service" || echo "WARNING: systemd-analyze verify reported the above"
rm -rf "$tmpd"

if [[ $enable -eq 1 ]]; then
  if [[ -f "$BASE/secrets/credentials.json" && -f "$OPT/worker.mjs" ]]; then
    say "enabling and starting $UNIT"
    systemctl enable --now "$UNIT"
    systemctl --no-pager status "$UNIT" | head -15 || true
  else
    echo "--enable: NOT started — $BASE/secrets/credentials.json or $OPT/worker.mjs is missing" >&2
  fi
fi

say "done (lane: $LANE)"
lane_flag=""; [[ "$LANE" == live ]] && lane_flag=" --lane live"
cat <<EOF
Next:
  1. fill in $ENV_FILE (the lane's site origin, Supabase URL, anon key, R2 host, R2 bucket)
  2. the credentials step writes $BASE/secrets/credentials.json ($WORKER_USER:$WORKER_USER 0600)
  3. check the sandbox:   sudo bash $here/sandbox-check.sh$lane_flag --selftest   (with $UNIT stopped)
  4. start the worker:    sudo systemctl enable --now $UNIT
     logs:                journalctl -u $UNIT -f
  FFmpeg updates:         sudo bash $here/update-ffmpeg.sh   (after a PR changes ffmpeg.pin — README.md)
EOF

#!/bin/bash
# 50mm Retina World · converter VM setup (CONVERTER-DESIGN.md v2 §6, [R1]).
# Ubuntu 24.04 (systemd 255, polkit 124). Run as root from this directory:
#
#   sudo bash setup.sh [--worker /path/to/worker.mjs] [--enable]
#
# Idempotent: safe to run again (it never deletes the job filesystem, the
# state or the secrets). It creates:
#   users      converter (the worker), ffjob (every ffprobe/ffmpeg run),
#              group convjob (both: ffjob writes a job's files, the worker reads them)
#   dirs       /var/lib/converter/{secrets 0700, state 0700} (converter),
#              /opt/converter, /usr/local/lib/converter, /etc/converter (root)
#   job space  /var/lib/converter/jobs.img (JOBS_FS_SIZE, default 4G, ext4)
#              mounted loop,nodev,nosuid,noexec at /var/lib/converter/jobs
#   units      converter.service, converter-ff@.service, var-lib-converter-jobs.mount
#   polkit     50-converter-ff.rules (converter may start/stop converter-ff@<uuid> only)
# It does NOT write the credentials (a separate, Owner-run step does) and does
# NOT start the worker unless --enable is given AND the credentials exist.
#
# Environment: JOBS_FS_SIZE (4G) · NODE_BIN (the `node` on PATH) · SKIP_APT=1
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
worker=""
enable=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker) worker="$2"; shift 2 ;;
    --enable) enable=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo bash setup.sh)" >&2; exit 1; }

JOBS_FS_SIZE="${JOBS_FS_SIZE:-4G}"
BASE=/var/lib/converter

say "checking the system"
. /etc/os-release 2>/dev/null || true
echo "os: ${PRETTY_NAME:-unknown}  arch: $(uname -m)  systemd: $(systemctl --version | head -1)"
[[ "${VERSION_ID:-}" == "24.04" ]] || echo "WARNING: written for Ubuntu 24.04; this is ${VERSION_ID:-unknown}"

need_apt=()
[[ -x /usr/bin/ffmpeg && -x /usr/bin/ffprobe ]] || need_apt+=(ffmpeg)
[[ -x /usr/lib/polkit-1/polkitd ]] || need_apt+=(polkitd)
command -v timeout >/dev/null || need_apt+=(coreutils)
if [[ ${#need_apt[@]} -gt 0 ]]; then
  if [[ "${SKIP_APT:-0}" == "1" ]]; then
    echo "missing: ${need_apt[*]} (SKIP_APT=1, not installing)" >&2; exit 1
  fi
  echo "installing: ${need_apt[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${need_apt[@]}"
fi
echo "ffmpeg: $(/usr/bin/ffmpeg -hide_banner -version | head -1)"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo "Node 22 is required (NODE_BIN or node on PATH)" >&2; exit 1; }
node_major="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
(( node_major >= 22 )) || { echo "Node 22+ is required; $NODE_BIN is $("$NODE_BIN" --version)" >&2; exit 1; }
echo "node: $NODE_BIN $("$NODE_BIN" --version)"

say "users and groups"
getent group convjob >/dev/null || groupadd --system convjob
id -u converter >/dev/null 2>&1 || useradd --system --user-group --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin converter
id -u ffjob >/dev/null 2>&1 || useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin ffjob
usermod -a -G convjob converter
usermod -a -G convjob ffjob
id converter; id ffjob

say "directories"
install -d -o root -g root -m 0755 "$BASE" /opt/converter /usr/local/lib/converter /etc/converter
install -d -o converter -g converter -m 0700 "$BASE/secrets" "$BASE/state"
install -d -o root -g root -m 0755 "$BASE/jobs"

say "the job space (${JOBS_FS_SIZE}, ext4, loop,nodev,nosuid,noexec)"
if [[ ! -f "$BASE/jobs.img" ]]; then
  fallocate -l "$JOBS_FS_SIZE" "$BASE/jobs.img"
  chmod 0600 "$BASE/jobs.img"
  mkfs.ext4 -q -F -m 0 -L convjobs "$BASE/jobs.img"
else
  echo "keeping the existing $BASE/jobs.img ($(du -h --apparent-size "$BASE/jobs.img" | cut -f1))"
fi
install -o root -g root -m 0644 "$here/var-lib-converter-jobs.mount" /etc/systemd/system/var-lib-converter-jobs.mount
systemctl daemon-reload
systemctl enable --now var-lib-converter-jobs.mount
mountpoint -q "$BASE/jobs" || { echo "the job space is not mounted" >&2; exit 1; }
# converter creates one directory per job; ffjob (group) may only pass through.
chown converter:convjob "$BASE/jobs"
chmod 2750 "$BASE/jobs"
findmnt -no SOURCE,FSTYPE,SIZE,OPTIONS "$BASE/jobs"

say "the sandbox runner, units and the polkit rule"
install -o root -g root -m 0755 "$here/ffjob-run" /usr/local/lib/converter/ffjob-run
install -o root -g root -m 0644 "$here/converter-ff@.service" /etc/systemd/system/converter-ff@.service
sed "s#@NODE_BIN@#${NODE_BIN}#g" "$here/converter.service" > /etc/systemd/system/converter.service
chmod 0644 /etc/systemd/system/converter.service
install -d -o root -g root -m 0755 /etc/polkit-1/rules.d
install -o root -g root -m 0644 "$here/50-converter-ff.rules" /etc/polkit-1/rules.d/50-converter-ff.rules
[[ -f "$here/README.md" ]] && install -o root -g root -m 0644 "$here/README.md" /opt/converter/README.md
if [[ ! -f /etc/converter/converter.env ]]; then
  install -o root -g converter -m 0640 "$here/converter.env.example" /etc/converter/converter.env
  echo "wrote /etc/converter/converter.env from the example — fill in the three REPLACE values"
fi
systemctl daemon-reload
# polkitd re-reads rules.d by itself; a restart makes it certain.
systemctl try-restart polkit.service 2>/dev/null || true

if [[ -n "$worker" ]]; then
  say "the worker bundle"
  if [[ -f "$worker.sha256" ]]; then
    (cd "$(dirname "$worker")" && sha256sum -c "$(basename "$worker").sha256")
  fi
  install -o root -g root -m 0644 "$worker" /opt/converter/worker.mjs
  sha256sum /opt/converter/worker.mjs
fi

say "unit files check (systemd-analyze verify)"
tmpd="$(mktemp -d)"
cp /etc/systemd/system/converter.service "$tmpd/"
cp /etc/systemd/system/converter-ff@.service "$tmpd/converter-ff@00000000-0000-4000-8000-000000000000.service"
systemd-analyze verify "$tmpd/converter.service" "$tmpd/converter-ff@00000000-0000-4000-8000-000000000000.service" || echo "WARNING: systemd-analyze verify reported the above"
rm -rf "$tmpd"

if [[ $enable -eq 1 ]]; then
  if [[ -f "$BASE/secrets/credentials.json" && -f /opt/converter/worker.mjs ]]; then
    say "enabling and starting converter.service"
    systemctl enable --now converter.service
    systemctl --no-pager status converter.service | head -15 || true
  else
    echo "--enable: NOT started — $BASE/secrets/credentials.json or /opt/converter/worker.mjs is missing" >&2
  fi
fi

say "done"
cat <<EOF
Next:
  1. fill in /etc/converter/converter.env (the lane's site origin, Supabase URL, anon key)
  2. the credentials step writes $BASE/secrets/credentials.json (converter:converter 0600)
  3. check the sandbox:   sudo bash $here/sandbox-check.sh --selftest
  4. start the worker:    sudo systemctl enable --now converter.service
     logs:                journalctl -u converter.service -f
EOF

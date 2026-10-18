# 50mm Retina World · the converter's two LANES on one VM (S7 live server converter).
# Sourced by setup.sh, sandbox-check.sh and update-ffmpeg.sh; also run directly by the
# converter tests:   bash lane-lib.sh render <staging|live> <file>
#
# Lane separation is a security control. Each lane has its OWN:
#   worker user     converter            | converter-live
#   FFmpeg user     ffjob                | ffjob-live
#   job group       convjob              | convjob-live   (worker + its FFmpeg user only)
#   base dir        /var/lib/converter   | /var/lib/converter-live   ({secrets,state} 0700, jobs)
#   job space       its own size-capped ext4 image, mounted at <base>/jobs
#   worker unit     converter.service    | converter-live.service
#   sandbox unit    converter-ff@<uuid>  | converter-live-ff@<uuid>
#   env file        /etc/converter/converter.env | /etc/converter/converter-live.env
#   worker bundle   /opt/converter/worker.mjs    | /opt/converter-live/worker.mjs
# Shared, root-owned and read-only to both: the pinned FFmpeg (/opt/converter/ffmpeg),
# ffjob-run, the polkit rule, Node.
#
# The repository's unit files are the STAGING lane, literally (so the staging install is
# exactly what it was). The live lane's files are rendered from them by `render` below:
# a fixed list of substitutions, checked by converter/test/lane.test.ts (no staging path
# may survive except where it names the OTHER lane to hide it).

lane_vars() {
  case "${1:-}" in
    staging)
      LANE=staging
      WORKER_USER=converter; FF_USER=ffjob; JOB_GROUP=convjob
      BASE=/var/lib/converter; OPT=/opt/converter
      UNIT=converter.service; FF_PREFIX=converter-ff
      MOUNT_UNIT=var-lib-converter-jobs.mount
      ENV_FILE=/etc/converter/converter.env; ENV_EXAMPLE=converter.env.example
      OTHER_LANE=live ;;
    live)
      LANE=live
      WORKER_USER=converter-live; FF_USER=ffjob-live; JOB_GROUP=convjob-live
      BASE=/var/lib/converter-live; OPT=/opt/converter-live
      UNIT=converter-live.service; FF_PREFIX=converter-live-ff
      # systemd's name for the mount at /var/lib/converter-live/jobs (`systemd-escape -p --suffix=mount`)
      MOUNT_UNIT='var-lib-converter\x2dlive-jobs.mount'
      ENV_FILE=/etc/converter/converter-live.env; ENV_EXAMPLE=converter-live.env.example
      OTHER_LANE=staging ;;
    *) echo "lane must be staging or live (got '${1:-}')" >&2; return 2 ;;
  esac
  JOBS="$BASE/jobs"
}

# other_lane_vars <lane>: the OTHER lane's names, as OTHER_* (for the cross-lane checks).
other_lane_vars() {
  local o; o="$( (lane_vars "$1" && echo "$OTHER_LANE") )" || return 2
  OTHER_WORKER_USER="$( (lane_vars "$o" && echo "$WORKER_USER") )"
  OTHER_FF_USER="$( (lane_vars "$o" && echo "$FF_USER") )"
  OTHER_BASE="$( (lane_vars "$o" && echo "$BASE") )"
  OTHER_JOBS="$OTHER_BASE/jobs"
  OTHER_FF_PREFIX="$( (lane_vars "$o" && echo "$FF_PREFIX") )"
  OTHER_ENV_FILE="$( (lane_vars "$o" && echo "$ENV_FILE") )"
}

# render <lane> <file>: the file for that lane on stdout. Staging: the file as it is.
render() {
  local lane="$1" file="$2"
  case "$lane" in
    staging) cat -- "$file" ;;
    live)
      # 1. the line that hides the OTHER lane (staging hides live) is set aside first,
      # 2. every staging name becomes the live one,
      # 3. the set-aside line now hides staging.
      printf '# GENERATED for the LIVE lane by converter/deploy/lane-lib.sh from %s (the staging file). Do not edit here.\n' "$(basename -- "$file")"
      sed -e 's#^InaccessiblePaths=-/var/lib/converter-live$#@HIDE_OTHER_LANE@#' \
          -e 's#/var/lib/converter/#/var/lib/converter-live/#g' \
          -e 's#^WorkingDirectory=/var/lib/converter$#WorkingDirectory=/var/lib/converter-live#' \
          -e 's#^User=converter$#User=converter-live#' \
          -e 's#^Group=converter$#Group=converter-live#' \
          -e 's#^User=ffjob$#User=ffjob-live#' \
          -e 's#^Group=ffjob$#Group=ffjob-live#' \
          -e 's#^SupplementaryGroups=convjob$#SupplementaryGroups=convjob-live#' \
          -e 's#^EnvironmentFile=/etc/converter/converter\.env$#EnvironmentFile=/etc/converter/converter-live.env#' \
          -e 's#var-lib-converter-jobs\.mount#var-lib-converter\\x2dlive-jobs.mount#g' \
          -e 's#^Environment=CONVERTER_UNIT_PREFIX=converter-ff$#Environment=CONVERTER_UNIT_PREFIX=converter-live-ff#' \
          -e 's# /opt/converter/worker\.mjs$# /opt/converter-live/worker.mjs#' \
          -e 's#^Description=\(.*\)$#Description=\1 (LIVE lane)#' \
          -e 's#^OOMScoreAdjust=500$#OOMScoreAdjust=300#' \
          -e 's#^@HIDE_OTHER_LANE@$#InaccessiblePaths=-/var/lib/converter#' \
          -- "$file" ;;
    *) echo "lane must be staging or live" >&2; return 2 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  case "${1:-}" in
    render) render "$2" "$3" ;;
    vars) lane_vars "$2"; printf '%s\n' "WORKER_USER=$WORKER_USER" "FF_USER=$FF_USER" "JOB_GROUP=$JOB_GROUP" "BASE=$BASE" "JOBS=$JOBS" "OPT=$OPT" "UNIT=$UNIT" "FF_PREFIX=$FF_PREFIX" "MOUNT_UNIT=$MOUNT_UNIT" "ENV_FILE=$ENV_FILE" ;;
    *) echo "usage: bash lane-lib.sh render <staging|live> <file> | vars <staging|live>" >&2; exit 2 ;;
  esac
fi

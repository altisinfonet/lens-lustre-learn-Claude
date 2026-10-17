#!/bin/bash
# 50mm Retina World · install the PINNED FFmpeg (owner ruling R-VM-1). Sourced by
# setup.sh and update-ffmpeg.sh; run as root.
#
#   /opt/converter/ffmpeg/<version>-<arch>/bin/{ffmpeg,ffprobe}   root:root 0755
#   /opt/converter/ffmpeg/<version>-<arch>/LICENSE.txt            the build's own licence (GPL v3)
#   /opt/converter/ffmpeg/<version>-<arch>/SOURCE                 where the file and its source came from
#   /opt/converter/ffmpeg/current  -> the one ffjob-run runs (swapped atomically)
#   /opt/converter/ffmpeg/previous -> the one before (for a rollback)
#
# Nothing is installed unless its sha256 is exactly the pin's, and nothing is
# activated unless it has what the converter needs: the zscale, tonemap and
# limiter filters (HDR → SDR, amendment A1) and the libx264 and libx265 encoders.
#
# Licence (GPL v3): the binaries are only RUN here, never handed on — so the
# licence text and the exact source pointer are kept beside them (LICENSE.txt,
# SOURCE) and nothing else is owed. They must not be copied into the repository,
# a CI artifact, the app or anywhere a third party gets them (README, "Licence").

FFMPEG_ROOT="${FFMPEG_ROOT:-/opt/converter/ffmpeg}"
FFMPEG_BASE_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download"

ffmpeg_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo x86_64 ;;
    aarch64|arm64) echo aarch64 ;;
    *) echo "unsupported architecture $(uname -m)" >&2; return 1 ;;
  esac
}

# ffmpeg_read_pin <pin file> — sets PIN_RELEASE, PIN_VERSION, PIN_ASSET, PIN_URL, PIN_SHA256
# (for this machine) and PIN_SOURCE_COMMIT, PIN_BUILD_COMMIT.
ffmpeg_read_pin() {
  local pin="$1" arch line key value
  arch="$(ffmpeg_arch)" || return 1
  PIN_RELEASE="" PIN_VERSION="" PIN_ASSET="" PIN_URL="" PIN_SHA256="" PIN_SOURCE_COMMIT="" PIN_BUILD_COMMIT=""
  [[ -f "$pin" ]] || { echo "no pin file $pin" >&2; return 1; }
  # Read KEY=VALUE lines only — the pin is data, never executed.
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^([A-Za-z0-9_]+)=([A-Za-z0-9._:/-]+)$ ]] || continue
    key="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
    case "$key" in
      FFMPEG_RELEASE) PIN_RELEASE="$value" ;;
      FFMPEG_VERSION) PIN_VERSION="$value" ;;
      FFMPEG_SOURCE_COMMIT) PIN_SOURCE_COMMIT="$value" ;;
      FFMPEG_BUILD_SCRIPTS_COMMIT) PIN_BUILD_COMMIT="$value" ;;
      "FFMPEG_ASSET_$arch") PIN_ASSET="$value" ;;
      "FFMPEG_URL_$arch") PIN_URL="$value" ;;
      "FFMPEG_SHA256_$arch") PIN_SHA256="$value" ;;
    esac
  done < "$pin"
  # A dated autobuild only: never the moving "latest" tag.
  [[ "$PIN_RELEASE" =~ ^autobuild-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || { echo "pin: FFMPEG_RELEASE must be a dated autobuild-YYYY-MM-DD-HH-MM tag" >&2; return 1; }
  [[ "$PIN_VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "pin: FFMPEG_VERSION is missing" >&2; return 1; }
  [[ "$PIN_ASSET" =~ ^ffmpeg-[A-Za-z0-9._-]+\.tar\.xz$ ]] || { echo "pin: no FFMPEG_ASSET_$arch" >&2; return 1; }
  # The exact URL, and only BtbN's release download of that tag and file over HTTPS.
  [[ "$PIN_URL" == "$FFMPEG_BASE_URL/$PIN_RELEASE/$PIN_ASSET" ]] || { echo "pin: FFMPEG_URL_$arch must be exactly $FFMPEG_BASE_URL/<FFMPEG_RELEASE>/<FFMPEG_ASSET_$arch>" >&2; return 1; }
  [[ "$PIN_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "pin: no FFMPEG_SHA256_$arch" >&2; return 1; }
  # The exact source (GPL): FFmpeg's commit and the build scripts' commit.
  [[ "$PIN_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "pin: FFMPEG_SOURCE_COMMIT must be FFmpeg's full 40-hex commit" >&2; return 1; }
  [[ "$PIN_BUILD_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "pin: FFMPEG_BUILD_SCRIPTS_COMMIT must be the build scripts' full 40-hex commit" >&2; return 1; }
}

# ffmpeg_check <dir> — the build has what the converter needs.
ffmpeg_check() {
  local dir="$1" filters encoders
  "$dir/bin/ffprobe" -hide_banner -version >/dev/null || { echo "$dir/bin/ffprobe does not run" >&2; return 1; }
  filters="$("$dir/bin/ffmpeg" -hide_banner -filters 2>/dev/null)" || { echo "$dir/bin/ffmpeg does not run" >&2; return 1; }
  encoders="$("$dir/bin/ffmpeg" -hide_banner -encoders 2>/dev/null)"
  local missing=""
  for f in zscale tonemap limiter; do grep -Eq "^ *[.A-Z|]+ +$f " <<<"$filters" || missing+=" filter:$f"; done
  for e in libx264 libx265; do grep -Eq "^ *[.A-Z]+ +$e " <<<"$encoders" || missing+=" encoder:$e"; done
  if [[ -n "$missing" ]]; then echo "this FFmpeg lacks:$missing" >&2; return 1; fi
  [[ -s "$dir/LICENSE.txt" && -s "$dir/SOURCE" ]] || { echo "$dir has no LICENSE.txt / SOURCE (the build's licence and source pointer must stay with it)" >&2; return 1; }
  echo "ffmpeg ok: $("$dir/bin/ffmpeg" -hide_banner -version | head -1) — zscale tonemap limiter libx264 libx265"
}

# ffmpeg_install <pin file> — download (or FFMPEG_TARBALL), verify, install; prints the install dir on the last line.
ffmpeg_install() {
  local pin="$1" arch dest tmp file top
  ffmpeg_read_pin "$pin" || return 1
  arch="$(ffmpeg_arch)"
  dest="$FFMPEG_ROOT/$PIN_VERSION-$arch"
  if [[ -x "$dest/bin/ffmpeg" && -x "$dest/bin/ffprobe" && "$(cat "$dest/SHA256" 2>/dev/null)" == "$PIN_SHA256" ]]; then
    echo "already installed: $dest" >&2
    ffmpeg_check "$dest" >&2 || return 1
    echo "$dest"
    return 0
  fi
  tmp="$(mktemp -d)" || return 1
  file="$tmp/$PIN_ASSET"
  if [[ -n "${FFMPEG_TARBALL:-}" ]]; then
    cp -- "$FFMPEG_TARBALL" "$file" || { rm -rf "$tmp"; return 1; }
  else
    echo "downloading $PIN_URL" >&2
    curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 -o "$file" "$PIN_URL" || { rm -rf "$tmp"; echo "download failed" >&2; return 1; }
  fi
  # THE check: the file is exactly the pinned one, whatever it was downloaded from or handed in as.
  if ! printf '%s  %s\n' "$PIN_SHA256" "$file" | sha256sum -c --quiet - >&2; then
    rm -rf "$tmp"; echo "REFUSED: $PIN_ASSET does not have the pinned sha256" >&2; return 1
  fi
  top="${PIN_ASSET%.tar.xz}"
  tar -xJf "$file" -C "$tmp" --no-same-owner --no-same-permissions "$top/bin/ffmpeg" "$top/bin/ffprobe" "$top/LICENSE.txt" \
    || { rm -rf "$tmp"; echo "extract failed (the build must hold bin/ffmpeg, bin/ffprobe and LICENSE.txt)" >&2; return 1; }
  install -d -o root -g root -m 0755 "$FFMPEG_ROOT" "$dest" "$dest/bin" \
    && install -o root -g root -m 0755 "$tmp/$top/bin/ffmpeg" "$dest/bin/ffmpeg" \
    && install -o root -g root -m 0755 "$tmp/$top/bin/ffprobe" "$dest/bin/ffprobe" \
    && install -o root -g root -m 0644 "$tmp/$top/LICENSE.txt" "$dest/LICENSE.txt" \
    || { rm -rf "$tmp"; echo "install failed" >&2; return 1; }
  printf '%s\n' "$PIN_SHA256" > "$dest/SHA256"
  {
    printf 'release=%s\nasset=%s\nurl=%s\nsha256=%s\n' "$PIN_RELEASE" "$PIN_ASSET" "$PIN_URL" "$PIN_SHA256"
    printf 'licence=GPL version 3 (LICENSE.txt beside this file; run here only, never redistributed)\n'
    printf 'ffmpeg_source=https://github.com/FFmpeg/FFmpeg/tree/%s\n' "$PIN_SOURCE_COMMIT"
    printf 'build_scripts=https://github.com/BtbN/FFmpeg-Builds/tree/%s\n' "$PIN_BUILD_COMMIT"
  } > "$dest/SOURCE"
  chmod 0644 "$dest/SHA256" "$dest/SOURCE"
  rm -rf "$tmp"
  ffmpeg_check "$dest" >&2 || return 1
  echo "$dest"
}

# ffmpeg_activate <dir> — point `current` at <dir> atomically; the old target becomes `previous`.
ffmpeg_activate() {
  local dir="$1" old
  [[ -x "$dir/bin/ffmpeg" ]] || { echo "nothing to activate at $dir" >&2; return 1; }
  old="$(readlink "$FFMPEG_ROOT/current" 2>/dev/null || true)"
  if [[ -n "$old" && "$old" != "$dir" ]]; then
    ln -sfn "$old" "$FFMPEG_ROOT/.previous.tmp" && mv -Tf "$FFMPEG_ROOT/.previous.tmp" "$FFMPEG_ROOT/previous"
  fi
  ln -sfn "$dir" "$FFMPEG_ROOT/.current.tmp" && mv -Tf "$FFMPEG_ROOT/.current.tmp" "$FFMPEG_ROOT/current"
  echo "active: $FFMPEG_ROOT/current -> $dir"
}

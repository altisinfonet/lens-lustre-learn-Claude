#!/usr/bin/env python3
"""Burn the step captions recorded by record.mjs into each review video.

For every <name>.raw.mp4 with a <name>.captions.json beside it, writes
<name>.mp4 with each caption shown in a dark bar near the top of the screen
from its timestamp until the next caption (or the end). The raw file is kept
when ffmpeg is missing or fails, so a video is never lost to a caption error.

Usage: burn-captions.py <dir> <fontfile>
"""
import json
import os
import shutil
import subprocess
import sys
import textwrap


def burn(directory: str, font: str) -> int:
    done = 0
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".raw.mp4"):
            continue
        base = name[: -len(".raw.mp4")]
        raw = os.path.join(directory, name)
        out = os.path.join(directory, base + ".mp4")
        meta_path = os.path.join(directory, base + ".captions.json")
        if not os.path.exists(meta_path) or not shutil.which("ffmpeg"):
            shutil.copyfile(raw, out)
            print(f"[captions] {base}: no captions or no ffmpeg, kept raw")
            continue
        meta = json.load(open(meta_path))
        caps, end = meta["caps"], float(meta["end"])
        filters = []
        for i, cap in enumerate(caps):
            start = float(cap["t"])
            stop = float(caps[i + 1]["t"]) if i + 1 < len(caps) else end
            txt = os.path.join(directory, f"{base}.cap{i:02d}.txt")
            with open(txt, "w") as f:
                f.write("\n".join(textwrap.wrap(cap["text"], 26)))
            filters.append(
                f"drawtext=fontfile={font}:textfile={txt}:fontcolor=white:fontsize=w/22:"
                f"line_spacing=10:box=1:boxcolor=black@0.78:boxborderw=24:"
                f"x=(w-text_w)/2:y=h*0.075:enable='between(t,{start:.2f},{stop:.2f})'"
            )
        vf = ",".join(filters) if filters else "null"
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-vf", vf,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", out]
        r = subprocess.run(cmd)
        if r.returncode != 0:
            shutil.copyfile(raw, out)
            print(f"[captions] {base}: ffmpeg failed ({r.returncode}), kept raw")
        else:
            print(f"[captions] {base}: {len(caps)} captions burned → {out}")
            done += 1
    return done


if __name__ == "__main__":
    burn(sys.argv[1], sys.argv[2])

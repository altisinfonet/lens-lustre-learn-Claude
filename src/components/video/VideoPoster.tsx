/**
 * VID-1 · A VIDEO'S STILL FRAME, for a screen that shows a small picture of a
 * post instead of playing it — the wall's grid (src/components/profile/
 * ProfilePostGrid.tsx). Before this, a video post there was an empty tile
 * with a photo icon: the one surface that had no idea the post was a video.
 *
 * It costs what a feed card costs before it plays: nothing until the tile
 * nears the screen, then ONE play grant (src/lib/video/playGrant.ts — the same
 * request the feed card makes) for the signed poster. No hls.js, no segment.
 * A marker and the length say it is a video; opening the post plays it.
 *
 * `fit`: "cover" fills a small square tile (cropped, like every other tile);
 * "contain" shows the frame whole over a blurred copy of itself, for the
 * showcase band, which never crops (see SHOWCASE_ASPECT there).
 */
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { requestGrant } from "@/lib/video/playGrant";
import { formatClock } from "@/components/video/FeedVideoCard";
import type { FeedVideo } from "@/lib/video/postVideoRead";

export default function VideoPoster({ video, fit = "cover" }: { video: FeedVideo; fit?: "cover" | "contain" }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "600px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let live = true;
    void requestGrant(video.id).then((g) => { if (live && g) setPoster(g.poster_url); });
    return () => { live = false; };
  }, [near, video.id]);

  return (
    <div ref={box} data-testid="video-poster" className="absolute inset-0 overflow-hidden bg-black">
      {poster && fit === "contain" && (
        <div aria-hidden="true" className="absolute inset-0 scale-110 bg-cover bg-center opacity-60 blur-xl"
          style={{ backgroundImage: `url("${poster}")` }} />
      )}
      {poster && (
        <img src={poster} alt="" loading="lazy" decoding="async"
          className={`relative h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`} />
      )}
      <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden="true">
        <Play className="h-3.5 w-3.5 fill-white" />
      </span>
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
        <span className="sr-only">Video, </span>{formatClock(video.durationS)}
      </span>
    </div>
  );
}

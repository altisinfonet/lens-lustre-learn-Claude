/**
 * CAMERA DETAILS — ONE COMPONENT, ONE CSS, WEB AND APP (photo plan U2, switch
 * `photo_set_v2`).
 *
 * THE DESIGN: the Owner-approved fix of 2026-11-03,
 * _control/out/OWNER/50mm-camera-line-FIX.html (v2) + 50mm-camera-line-ANIMATION.html
 * (option A), photographed from this code in tools/uishot/camline-baseline/.
 * It replaces what U2 (#825) first built: U2 reused the web PHOTO-PAGE
 * sample's "Camera details" box (50mm-camera-details-WEB.png, a side-panel box
 * under the caption, with a "Location removed" line) as a bordered strip under
 * the caption in the web FEED, and gave the app a different line, a bottom
 * sheet and a full-screen ⓘ (audit H1).
 *
 *   CameraLine   every PostCard (feed, My Wall, post page) and the hashtag
 *                page: ONE small line directly under the photo, above Like /
 *                Comment / Share — camera icon, "Camera · focal · f/ · shutter ·
 *                ISO". No border, no box, no panel, no full-screen ⓘ.
 *                EVERYONE (members and the post's owner): that line only — no
 *                arrow, not clickable, nothing expands. SITE ADMINS only: a
 *                small arrow; tap / click → "Lens X · Taken Y" slides open BELOW
 *                the line (max-height + opacity, 0.25 s), still above the
 *                actions; tap again closes. Never sticky. No camera information
 *                → nothing. While a new photo's details are being read the
 *                line's height is held (`reserve`), so the card never jumps
 *                when they land (audit M5).
 *                Entry: "lens focus" — each item comes from blur into focus,
 *                one after another, once per photo when it first scrolls into
 *                view; nothing moves; none with reduced motion. All of it is
 *                the swappable `.camLineEnter` CSS in src/index.css.
 *
 * NOTHING HERE BRANCHES ON THE PLATFORM (Owner: "exact same to same in app and
 * web"); CI pixel-compares the app shell's line with the web's.
 *
 * No "Location removed" text anywhere (Owner, 2026-11-03). Location is still
 * never stored (the table cannot hold one); the author's hide control stays in
 * the post menu.
 *
 * Every word comes from src/lib/photoCameraDisplay.ts (camera names cleaned by
 * src/lib/cameraName.ts). A `null` state means "unknown / nothing to say" and
 * renders nothing. `hidden` (only ever delivered to the author) adds a small
 * "Hidden from others" hint.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Camera, ChevronDown, EyeOff } from "lucide-react";
import { cameraLine, cameraLineParts, cameraRows, cameraStateFor, cameraText, type CameraState } from "@/lib/photoCameraDisplay";
import { photoSetMarker } from "@/lib/imageLadder";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { usePostPhotoCameraRead } from "@/hooks/feed/usePostPhotoCamera";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";

const HiddenHint = () => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
    <EyeOff className="h-3 w-3" aria-hidden="true" />
    Hidden from others
  </span>
);

/**
 * The line itself: camera icon, camera bold, the rest quiet, separated by soft
 * dots. Each item (icon, camera, focal, f/, shutter, ISO) is its own `.camW`
 * inline-block with its index in `--cam-i`, so the "lens focus" entry
 * (src/index.css `.camLineEnter`) can bring them into focus one after another.
 */
function SummaryText({ state }: { state: Extract<CameraState, { kind: "info" }> }) {
  const parts = cameraLineParts(state.info);
  const named = Boolean(cameraText(state.info));
  const item = (i: number) => ({ className: "camW", style: { "--cam-i": i } as CSSProperties });
  return (
    <span className="min-w-0 truncate">
      <span {...item(0)}>
        <Camera className="mr-1.5 inline-block h-3.5 w-3.5 align-[-3px] opacity-80" aria-hidden="true" />
      </span>
      {parts.map((p, i) => (
        <span key={i} {...item(i + 1)}>
          {i > 0 && <span className="whitespace-pre text-muted-foreground/50" aria-hidden="true">{" · "}</span>}
          {i === 0 && named ? <b className="font-semibold text-foreground/85">{p}</b> : p}
        </span>
      ))}
    </span>
  );
}

/** Photos whose line has already come into focus this session: it never replays (scroll-back, re-render, remount). */
const focused = new Set<string>();

/**
 * "Lens focus" entry, once per photo: `wait` (items soft + transparent) until
 * the line is ≥ 30 % on screen, then `play` (src/index.css). Reduced motion,
 * no IntersectionObserver, or already played → `none` (shown at once). The CSS
 * hides nothing under prefers-reduced-motion either, so a line can never be
 * left invisible by a missed observer callback on such a device.
 */
function useLensFocus(key: string | undefined, present: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"none" | "wait" | "play">(() => {
    if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") return "none";
    if (key && focused.has(key)) return "none";
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "none";
    return "wait";
  });
  useEffect(() => {
    const el = ref.current;
    if (phase !== "wait" || !present || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.3)) return;
        if (key) focused.add(key);
        io.disconnect();
        setPhase("play");
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [phase, present, key]);
  return { ref, phase };
}

/** For tests: forget which photos have played. */
export function __resetCameraLineFocus() {
  focused.clear();
}

/* ── THE camera line (web and app) ── */

/**
 * EVERYONE (members and the post's owner): ONE line, no arrow, not clickable,
 * nothing expands. `admin` (site admins only): the same line with a small arrow;
 * tap / click → Lens and Taken slide open below (max-height + opacity, 0.25 s),
 * tap again closes. The 2nd line is "Lens X · Taken Y" as one line of text that
 * wraps only when it does not fit.
 *
 * ONE markup and ONE CSS for the website and the app (Owner, 2026-11-03: "exact
 * same to same in app and web") — nothing here branches on the platform.
 * `focusKey`: the photo's identity, so its "lens focus" entry plays only once
 * (Owner-approved option A, 2026-11-03; the entry is the swappable CSS class
 * `.camLineEnter` in src/index.css).
 * `reserve`: the details are still being read for a photo that may have them —
 * hold the members' line height (the same classes, empty) so nothing jumps.
 */
export function CameraLine({ state, admin = false, focusKey, reserve = false }: { state: CameraState | null; admin?: boolean; focusKey?: string; reserve?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const present = Boolean(state && state.kind === "info");
  const { ref, phase } = useLensFocus(focusKey, present);
  if (!state || state.kind !== "info") {
    return reserve ? (
      <div data-camera-line-reserve="" aria-hidden="true" className="px-4 text-xs leading-4">
        <p className="pb-1 pt-2"><span className="block h-4" /></p>
      </div>
    ) : null;
  }
  const more = admin ? cameraRows(state.info).filter((r) => r.label !== "Camera") : [];
  const summary = (
    <>
      <SummaryText state={state} />
      {state.hidden && <HiddenHint />}
    </>
  );
  const enter = phase === "wait" ? "camLineEnter camLineWait" : phase === "play" ? "camLineEnter camLinePlay" : "camLineEnter";
  return (
    <div ref={ref} data-camera-line="" className={`px-4 text-xs leading-4 text-muted-foreground ${enter}`}>
      {more.length === 0 ? (
        <p className="flex items-center gap-1.5 pb-1 pt-2">{summary}</p>
      ) : (
        <>
          {/* The type is small (the design); the button is still a 44 px finger
              target (tools/uishot/tap-targets.mjs) — its height is the gap to the
              photo above and the actions below, so it overlaps neither. */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`Camera details: ${cameraLine(state.info)}`}
            className="flex min-h-11 w-full items-center gap-1.5 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {summary}
            <ChevronDown
              className={`ml-auto h-3 w-3 shrink-0 opacity-70 transition-transform duration-[250ms] ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          <div
            id={panelId}
            aria-hidden={!open}
            className={`overflow-hidden pl-5 transition-[max-height,opacity] duration-[250ms] ease-out motion-reduce:transition-none ${open ? "-mt-2.5 max-h-20 pb-1 opacity-100" : "max-h-0 opacity-0"}`}
          >
            <p>
              {more.map((r, i) => (
                <span key={r.label}>
                  {i > 0 && <span className="text-muted-foreground/50" aria-hidden="true">{" · "}</span>}
                  {r.label} <b className="font-semibold text-foreground/85">{r.value}</b>
                </span>
              ))}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** The line for a post card: the arrow and 2nd line only for site admins (user_roles role = admin). */
export function PostCameraLine({ state, focusKey, reserve }: { state: CameraState | null; focusKey?: string; reserve?: boolean }) {
  const { isAdmin } = useIsAdmin();
  // Keyed by the photo: another photo of the post (carousel) is a new line with its own once-only entry.
  return <CameraLine key={focusKey} state={state} admin={isAdmin} focusKey={focusKey} reserve={reserve} />;
}

/* ── For a post card that is not PostCard (the hashtag page) ── */

/**
 * The camera line of a post's FIRST photo for a card that renders its own
 * markup. Put it directly under the photo, above the actions — web and app
 * alike. Switch off ⇒ null, nothing read.
 */
export function PostCameraDetails({ postId, imageUrls }: { postId: string; imageUrls: readonly string[] }) {
  const on = usePhotoSetV2();
  if (!on || imageUrls.length === 0) return null;
  return <PostCameraDetailsOn postId={postId} url={imageUrls[0]} />;
}

function PostCameraDetailsOn({ postId, url }: { postId: string; url: string }) {
  const { rows, pending } = usePostPhotoCameraRead(postId, true);
  return <PostCameraLine state={cameraStateFor(rows, 0, url)} focusKey={`${postId}:${url}`} reserve={pending && !!photoSetMarker(url)} />;
}

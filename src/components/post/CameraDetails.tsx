/**
 * CAMERA DETAILS — ONE COMPONENT FAMILY FOR WEB AND APP (photo plan U2,
 * switch `photo_set_v2`).
 *
 * THE DESIGN: the Owner-approved fix of 2026-11-03,
 * _control/out/OWNER/50mm-camera-line-FIX.html / .png. It replaces what U2
 * (#825) first built: U2 reused the web PHOTO-PAGE sample's "Camera details"
 * box (50mm-camera-details-WEB.png, a side-panel box under the caption, with a
 * "Location removed" line) as a bordered strip under the caption in the web
 * FEED. The approved feed design is the app sample's single line, everywhere.
 *
 *   CameraLine        WEB and APP, every PostCard (feed, My Wall, post page)
 *                     and the hashtag page: ONE small line directly under the
 *                     photo, above Like / Comment / Share — camera icon,
 *                     "Camera · focal · f/ · shutter · ISO". No border, no box,
 *                     no panel. Entry: "lens focus" (Owner-approved option A,
 *                     2026-11-03) — each item comes from blur into focus, one
 *                     after another, once per photo when it first scrolls into
 *                     view; nothing moves; none with reduced motion. All of it
 *                     is the swappable `.camLineEnter` CSS in src/index.css.
 *                     EVERYONE (members and the post's owner): that line only —
 *                     no arrow, not clickable, nothing expands (Owner v2,
 *                     2026-11-03). SITE ADMINS only: a small arrow; tap / click
 *                     → Lens and Taken slide open BELOW the line (max-height +
 *                     opacity, 0.25 s), still above the actions; tap again
 *                     closes. Never sticky. No camera information → nothing.
 *   CameraInfoButton  APP full screen — ⓘ → CameraSheet (chips + rows).
 *   CameraSheet       the bottom sheet the ⓘ opens (Radix dialog: focus moves
 *                     in and is trapped, Escape closes, focus returns).
 *
 * No "Location removed" text anywhere (Owner, 2026-11-03). Location is still
 * never stored (the table cannot hold one); the author's hide control stays in
 * the post menu.
 *
 * Every word comes from src/lib/photoCameraDisplay.ts (camera names cleaned by
 * src/lib/cameraName.ts). A `null` state means "unknown / nothing to say" and
 * renders nothing. `hidden` (only ever delivered to the author) adds a small
 * "Hidden from others" hint.
 *
 * Motion respects prefers-reduced-motion (`motion-reduce:` variants). The
 * sheet sits above the full-screen viewer (z-[120] > z-[100]) and swallows its
 * own clicks and Escape so the viewer behind it does not close with it.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Camera, ChevronDown, EyeOff, Info } from "lucide-react";
import { cameraChips, cameraLine, cameraLineParts, cameraRows, cameraStateFor, cameraText, type CameraState } from "@/lib/photoCameraDisplay";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { usePostPhotoCamera } from "@/hooks/feed/usePostPhotoCamera";
import { isNativeApp } from "@/lib/video/playback";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";

/**
 * Also keeps ← / → typed in the sheet from the full-screen viewer behind it:
 * React's stopPropagation stops the native event at the portal's container, so
 * the viewer's `window` listener never sees it (U4 checked the U2 review's
 * worry; locked by photoSetV2U4.test.tsx "the ⓘ sheet owns the arrow keys").
 */
const stop = (e: ReactMouseEvent | ReactKeyboardEvent) => e.stopPropagation();

export const NO_CAMERA_SHEET = "This photo has no camera information.";
export const NO_CAMERA_REASON = "Edited photos, screenshots and photos sent by chat apps often lose it.";

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

/* ── The bottom sheet (app full screen) ── */

export function CameraSheet({ open, onOpenChange, state }: { open: boolean; onOpenChange: (o: boolean) => void; state: CameraState }) {
  return (
    // The wrapper catches React's portal bubbling: a click in the sheet must not
    // reach the full-screen viewer's "click the backdrop to close".
    <span onClick={stop} onKeyDown={stop} className="contents">
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
          <Dialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => e.stopPropagation()}
            className="fixed inset-x-0 bottom-0 z-[120] max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 text-card-foreground shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-300 motion-reduce:animate-none"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
              <Camera className="h-5 w-5 text-primary" aria-hidden="true" />
              Camera details
            </Dialog.Title>
            {state.kind === "info" ? (
              <>
                {state.hidden && <p className="mt-2"><HiddenHint /></p>}
                <CameraFullDetails state={state} />
              </>
            ) : (
              <>
                <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {NO_CAMERA_SHEET}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground/80">{NO_CAMERA_REASON}</p>
              </>
            )}
            <Dialog.Close className="mt-4 h-11 w-full rounded-lg border border-border text-sm font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Close
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </span>
  );
}

/** Chips (aperture, shutter, ISO, focal) + rows (camera, lens, taken) — the sheet's body. */
function CameraFullDetails({ state }: { state: Extract<CameraState, { kind: "info" }> }) {
  const chips = cameraChips(state.info);
  const rows = cameraRows(state.info);
  return (
    <>
      {chips.length > 0 && (
        <ul className="mt-4 grid grid-cols-4 gap-2" aria-label="Exposure">
          {chips.map((c) => (
            <li key={c.label} className="flex flex-col items-center rounded-xl border border-border px-1 py-2.5 text-center">
              <span className="text-[15px] font-semibold tabular-nums">{c.value}</span>
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <dl className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
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
 */
export function CameraLine({ state, admin = false, focusKey }: { state: CameraState | null; admin?: boolean; focusKey?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const present = Boolean(state && state.kind === "info");
  const { ref, phase } = useLensFocus(focusKey, present);
  if (!state || state.kind !== "info") return null;
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
export function PostCameraLine({ state, focusKey }: { state: CameraState | null; focusKey?: string }) {
  const { isAdmin } = useIsAdmin();
  // Keyed by the photo: another photo of the post (carousel) is a new line with its own once-only entry.
  return <CameraLine key={focusKey} state={state} admin={isAdmin} focusKey={focusKey} />;
}

/* ── APP full-screen ⓘ ── */

export function CameraInfoButton({ state, className }: { state: CameraState | null; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!state) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label="Camera details"
        aria-haspopup="dialog"
        className={className ?? "grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"}
      >
        <Info className="h-5 w-5" aria-hidden="true" />
      </button>
      <CameraSheet open={open} onOpenChange={setOpen} state={state} />
    </>
  );
}

/**
 * U4 (the U2 review follow-up) · the ⓘ for a full-screen viewer that is not
 * PostCard's own (FacebookPhotoGrid on the hashtag page): the camera details of
 * the photo on screen. App only, like PostCard's; switch off / web ⇒ null and
 * nothing is read.
 */
export function PostCameraInfoButton({ postId, imageUrls, index }: { postId: string; imageUrls: readonly string[]; index: number }) {
  const on = usePhotoSetV2();
  if (!on || !isNativeApp() || !imageUrls[index]) return null;
  return <PostCameraInfoButtonOn postId={postId} imageUrls={imageUrls} index={index} />;
}

function PostCameraInfoButtonOn({ postId, imageUrls, index }: { postId: string; imageUrls: readonly string[]; index: number }) {
  const rows = usePostPhotoCamera(postId, true);
  return <CameraInfoButton state={cameraStateFor(rows, index, imageUrls[index])} />;
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
  const rows = usePostPhotoCamera(postId, true);
  return <PostCameraLine state={cameraStateFor(rows, 0, url)} focusKey={`${postId}:${url}`} />;
}

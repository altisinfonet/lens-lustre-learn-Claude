/**
 * CAMERA DETAILS — ONE COMPONENT FAMILY FOR WEB AND APP (photo plan U2,
 * switch `photo_set_v2`; Owner-approved samples 2026-11-02 in
 * _control/out/OWNER: 50mm-camera-details-APP.png / -WEB.png and
 * 50mm-photo-samples-2.html).
 *
 *   CameraLine        APP feed — one small line under the photo; tap → CameraSheet.
 *                     No camera information → nothing at all.
 *   CameraInfoButton  APP full screen — ⓘ → CameraSheet (chips + rows). No camera
 *                     information → the sheet says so, with the reason line.
 *   CameraStrip       WEB — compact one-line strip under the caption; click → a
 *                     soft slide open (max-height + opacity, 0.25 s), scrolls with
 *                     the page (never sticky). No camera information → one quiet
 *                     grey line.
 *   CameraSheet       the bottom sheet both app entries open (Radix dialog: focus
 *                     moves in and is trapped, Escape closes, focus returns).
 *
 * Every word comes from src/lib/photoCameraDisplay.ts. A `null` state means
 * "unknown / nothing to say" and renders nothing. `hidden` (only ever delivered
 * to the author) adds a small "Hidden from others" hint.
 *
 * Motion respects prefers-reduced-motion (`motion-reduce:` variants). The
 * sheet sits above the full-screen viewer (z-[120] > z-[100]) and swallows its
 * own clicks and Escape so the viewer behind it does not close with it.
 */
import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Camera, ChevronDown, EyeOff, Info, Lock } from "lucide-react";
import { cameraChips, cameraLine, cameraLineParts, cameraRows, cameraStateFor, type CameraState } from "@/lib/photoCameraDisplay";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { usePostPhotoCamera } from "@/hooks/feed/usePostPhotoCamera";
import { isNativeApp } from "@/lib/video/playback";

const stop = (e: ReactMouseEvent | ReactKeyboardEvent) => e.stopPropagation();

export const NO_CAMERA_SHEET = "This photo has no camera information.";
export const NO_CAMERA_REASON = "Edited photos, screenshots and photos sent by chat apps often lose it.";
export const NO_CAMERA_WEB = "No camera details for this photo";

const HiddenHint = () => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
    <EyeOff className="h-3 w-3" aria-hidden="true" />
    Hidden from others
  </span>
);

/** The line itself: camera bold, the rest quiet, separated by soft dots. */
function SummaryText({ state }: { state: Extract<CameraState, { kind: "info" }> }) {
  const parts = cameraLineParts(state.info);
  const [first, ...rest] = state.info.camera ? parts : ["", ...parts];
  return (
    <span className="min-w-0 truncate">
      {first && <b className="font-semibold text-foreground">{first}</b>}
      {rest.map((p, i) => (
        <span key={i}>
          {(first || i > 0) && <span className="whitespace-pre text-muted-foreground/60" aria-hidden="true">{" · "}</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

/* ── The bottom sheet (app) ── */

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
                <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Location is always removed. The owner can hide these details.
                </p>
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

/** Chips (aperture, shutter, ISO, focal) + rows (camera, lens, taken) — the APP sheet's body. */
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

/* ── APP feed line ── */

export function CameraLine({ state }: { state: CameraState | null }) {
  const [open, setOpen] = useState(false);
  if (!state || state.kind !== "info") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Camera details: ${cameraLine(state.info)}`}
        aria-haspopup="dialog"
        data-camera-line=""
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <Camera className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <SummaryText state={state} />
        {state.hidden && <HiddenHint />}
      </button>
      <CameraSheet open={open} onOpenChange={setOpen} state={state} />
    </>
  );
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

/* ── For a post card that is not PostCard (the hashtag page) ── */

/**
 * The camera details of a post's FIRST photo for a card that renders its own
 * markup. `place="caption"` = the web strip (put it under the caption);
 * `place="photo"` = the app line (put it under the photo). Each renders only on
 * its own platform, so a card mounts both. Switch off ⇒ null, nothing read.
 */
export function PostCameraDetails({ postId, imageUrls, place }: { postId: string; imageUrls: readonly string[]; place: "caption" | "photo" }) {
  const on = usePhotoSetV2();
  const app = isNativeApp();
  if (!on || imageUrls.length === 0 || (place === "photo") !== app) return null;
  return <PostCameraDetailsOn postId={postId} url={imageUrls[0]} app={app} />;
}

function PostCameraDetailsOn({ postId, url, app }: { postId: string; url: string; app: boolean }) {
  const rows = usePostPhotoCamera(postId, true);
  const state = cameraStateFor(rows, 0, url);
  return app ? <CameraLine state={state} /> : <CameraStrip state={state} />;
}

/* ── WEB strip ── */

export function CameraStrip({ state }: { state: CameraState | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!state) return null;
  if (state.kind === "none") {
    return (
      <p data-camera-strip="" className="mx-3 mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Camera className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        {NO_CAMERA_WEB}
      </p>
    );
  }
  const rows = cameraRows(state.info).filter((r) => r.label !== "Camera");
  return (
    <div data-camera-strip="" className="mx-3 mb-2 overflow-hidden rounded-lg border border-border bg-muted/20 text-[12.5px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Camera details: ${cameraLine(state.info)}`}
        className="flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <Camera className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <SummaryText state={state} />
        {state.hidden && <HiddenHint />}
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-primary transition-transform duration-[250ms] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div
        id={panelId}
        aria-hidden={!open}
        className={`overflow-hidden px-2.5 transition-[max-height,opacity] duration-[250ms] ease-out motion-reduce:transition-none ${open ? "max-h-24 pb-2 opacity-100" : "max-h-0 opacity-0"}`}
      >
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-t border-border pt-1.5">
            {rows.map((r) => (
              <span key={r.label}>
                {r.label} <b className="font-semibold text-foreground">{r.value}</b>
              </span>
            ))}
          </div>
        )}
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/80">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          Location removed · owner can hide this
        </p>
      </div>
    </div>
  );
}

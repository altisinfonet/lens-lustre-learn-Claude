/**
 * The scene list. Each entry mounts ONE piece of UI with fixed, invented data.
 *
 * RULES FOR A SCENE, learned the moment the first one was written:
 *  • No network, no auth, no Supabase. A scene that needs data gets it from a
 *    literal in this file.
 *  • No `Math.random()`, no `new Date()` without a fixed argument. Two runs of
 *    the same scene must produce the same pixels, or the screenshots cannot be
 *    compared to each other.
 *  • Cover the states that actually break, not just the happy one: empty, one
 *    item, many items, a very long caption, a missing image. Those are the
 *    screenshots worth looking at.
 */

import { useState, type JSX } from "react";
import ProfilePostGrid from "@/components/profile/ProfilePostGrid";
import ImageCropModal from "@/components/admin/ImageCropModal";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import PostComposerPreview from "@/components/post/PostComposerPreview";
import HashtagSuggestions from "@/components/post/HashtagSuggestions";
import MentionInput from "@/components/MentionInput";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import WallViewToggle, { type WallView } from "@/components/profile/WallViewToggle";
import { Calendar } from "@/components/ui/calendar";
import { PrivacyGapNotice } from "@/components/post/PrivacyGapNotice";
import { PostAudienceChooser, type Privacy } from "@/components/post/PostAudienceChooser";
import type { UnifiedPost } from "@/types/post";
import { REAL_SCREENS } from "./realScreens";

/** A deterministic stand-in image, so a scene never depends on the network. */
export function swatch(seed: number, label = ""): string {
  const hue = (seed * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 30% 32%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 26% 18%)"/>
    </linearGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>
    ${label ? `<text x="300" y="320" font-family="sans-serif" font-size="72" font-weight="700"
        fill="rgba(255,255,255,.55)" text-anchor="middle">${label}</text>` : ""}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * A wall post shaped exactly like the real one, with only the fields the grid
 * reads filled in honestly. `overrides` is where each scene states the ONE
 * thing it is testing, so a reader can see the difference rather than diff two
 * literals.
 */
function post(i: number, overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  const url = swatch(i, String(i + 1));
  return {
    id: `post-${i}`,
    user_id: "u1",
    content: "",
    image_url: url,
    image_urls: [url],
    thumbnail_urls: [url],
    privacy: "public",
    created_at: "2026-08-01T09:00:00.000Z",
    author_name: "Avijit Sheel",
    author_avatar: null,
    like_count: 0,
    comment_count: 3,
    share_count: 0,
    is_liked: false,
    user_reaction: null,
    top_reactions: [],
    reaction_counts: { like: 12 },
    ...overrides,
  };
}

/**
 * Fixtures with REAL, different aspect ratios, because the whole question the
 * showcase raises is what happens to a photograph that is not 3:2. `swatch()`
 * above is always square, so a scene built only from swatches would never ask
 * that question at all.
 *
 * The dimensions in the filenames are a leftover convention from the feed
 * card's frame rule and are harmless here — the band is a fixed 3:2 and reads
 * nothing from the name. They are kept only because they say, at a glance,
 * what shape each fixture is.
 *
 * Referenced as literal dev-server paths rather than imported: an import would
 * put them in the module graph, and these must stay as un-shippable as the rest
 * of src/uiharness. If a path is ever wrong the image simply fails to render,
 * which the capture sweep reports — so this cannot rot silently.
 */
const FIX = "/src/uiharness/fixtures";
/** 3:2 — the ONE shape that fills the band edge to edge, with no bars at all. */
const LAND = `${FIX}/land-w1500h1000.svg`;
/** 4:5 portrait — taller than the band, so bars at the left and right. */
const PORT = `${FIX}/port-w1000h1250.svg`;
/** 6:1 panorama — wider than the band, so bars at the top and bottom. */
const PANO = `${FIX}/pano-w6000h1000.svg`;
/** 9:16 — the tallest a phone shoots. Wide bars at the sides; the hard case. */
const TALL = `${FIX}/tall-w900h1600.svg`;

/**
 * Twenty-one posts: two complete blocks (nine squares + a band, twice) plus the
 * start of a third, so the rhythm can be SEEN repeating rather than inferred.
 * The awkward states measured on production are seeded among the squares.
 */
const GRID_POSTS: UnifiedPost[] = [
  post(0),
  post(1),
  post(2),
  post(3),
  // 24 of 210 production posts hold more than one photograph — the tile must
  // say so, or a quarter of the work is invisible.
  post(4, { image_urls: [swatch(4, "5"), swatch(30), swatch(31), swatch(32), swatch(33), swatch(34)] }),
  // 9 production posts predate the thumbnail writer: no thumbnail at all.
  post(5, { thumbnail_urls: null }),
  // A thumbnail address that 404s. The tile must fall back to the original,
  // ALONE — one bad tile must never blank the other eight.
  post(6, { thumbnail_urls: ["/harness-this-thumbnail-does-not-exist.jpg"] }),
  // No photograph at all. Rare, but a hole in the grid is a visible bug.
  post(7, { image_urls: [], image_url: null, thumbnail_urls: null }),
  // The longest caption on production is far shorter than this; the caption is
  // the tile's accessible label, and a runaway label must not affect layout.
  post(8, { content: "Morning mist over the Teesta, shot on a 50mm at f/1.8 — ".repeat(6) }),
  // ── index 9: SHOWCASE. A 3:2 photograph — the one shape that fills the band
  //    edge to edge with no bars at all.
  post(9, { image_urls: [LAND], thumbnail_urls: [LAND] }),

  post(10), post(11), post(12), post(13), post(14), post(15), post(16), post(17),
  post(18),
  // ── index 19: SHOWCASE. A 6:1 panorama — wider than the band, so it sits
  //    letterboxed inside it. Whole, never cropped.
  post(19, { image_urls: [PANO], thumbnail_urls: [PANO] }),

  post(20),
];

/**
 * The two HARD shapes in showcase position — a 4:5 portrait and a 9:16 phone
 * shot. These are the ones that leave the most blurred bar in a 3:2 band, and
 * so the ones worth looking at before anybody ships this. The two easy shapes
 * (3:2 and the panorama) are in `profile-grid`.
 */
const SHAPE_POSTS: UnifiedPost[] = [
  ...Array.from({ length: 9 }, (_, i) => post(40 + i)),
  post(49, { image_urls: [PORT], thumbnail_urls: [PORT], content: "4:5 portrait — whole, bars at the sides" }),
  ...Array.from({ length: 9 }, (_, i) => post(50 + i)),
  post(59, { image_urls: [TALL], thumbnail_urls: [TALL], content: "9:16 — whole, bars at the sides" }),
];

/**
 * The composer takes object/data URLs for photos the member has just chosen —
 * so, unlike the wall, its previews carry no dimensions in a filename and their
 * shape can only be measured on load. The fixtures below are the four shapes
 * that matter, and the point of these scenes is to see what the preview does
 * with each BEFORE a member does.
 */
function ComposerHarness({ srcs }: { srcs: string[] }) {
  const [order, setOrder] = useState(srcs);
  const [active, setActive] = useState(0);
  return (
    <div className="min-h-screen bg-background p-3">
      <PostComposerPreview
        previews={order}
        activeIndex={Math.min(active, Math.max(0, order.length - 1))}
        onActiveChange={setActive}
        onMove={(from, to) => {
          setOrder((prev) => {
            const next = [...prev];
            const [m] = next.splice(from, 1);
            next.splice(to, 0, m);
            return next;
          });
          setActive(to);
        }}
        onRemove={(i) => setOrder((prev) => prev.filter((_, n) => n !== i))}
        onCrop={() => {}}
        onAddMore={order.length < 10 ? () => {} : undefined}
      />
    </div>
  );
}

/**
 * The comment composer as it is actually assembled: an avatar, the field, and
 * the send button that lives INSIDE the field. Hoisted to module scope rather
 * than declared inside the scene — a component declared in render is a new type
 * every render, React remounts its subtree, and a text input inside it loses
 * the caret. src/__tests__/noComponentDefinedInRender.test.ts enforces that,
 * and a scene whose whole subject is a text input is the last place to break
 * the rule.
 */
function CommentComposerHarness() {
  const [value, setValue] = useState("");
  return (
    <div className="min-h-screen bg-background">
      {/* Pushed down so an upward-opening list has room, and so a list that
          escapes the row shows against plain background. */}
      <div className="h-64" />
      <p className="px-4 pb-2 text-xs uppercase tracking-widest text-primary">Comment composer</p>
      <div className="flex items-start gap-2 border-t border-border/60 px-3 py-2">
        <div className="mt-1 h-8 w-8 shrink-0 rounded-full bg-muted" />
        <MentionInput value={value} onChange={setValue} onSubmit={() => {}} placeholder="Write a comment..." />
      </div>
    </div>
  );
}

export const SCENES: Record<string, () => JSX.Element> = {
  /**
   * THE REAL SCREENS come first, because they are the ones that answer the
   * owner's question. The component scenes below them isolate faults once a
   * screen scene has found one.
   */
  ...REAL_SCREENS,

  /**
   * THE TWO CALENDAR SHAPES, added 2026-08-16 for the react-day-picker v8 → v9
   * upgrade (PATCHWORK_AUDIT item 3).
   *
   * v9 renames every `classNames` key and every caption prop. A rename that is
   * missed does not throw and does not fail typecheck — the class is simply
   * never applied, and the calendar renders as unstyled browser default. That
   * is invisible to a unit test and obvious in a photograph, which is why these
   * two scenes exist: one before the upgrade, one after, compared by eye.
   *
   * `month` is pinned so two runs produce identical pixels (scene rule above).
   */
  "calendar-plain": () => (
    <div className="min-h-screen bg-background p-4">
      <Calendar
        mode="single"
        month={new Date(2026, 7, 1)}
        selected={new Date(2026, 7, 20)}
        onSelect={() => {}}
        disabled={(d) => d < new Date(2026, 7, 14)}
      />
    </div>
  ),

  /**
   * THE PRIVACY GAP NOTICE, IN ALL THREE AUDIENCES AT ONCE.
   *
   * Added 2026-08-19 with D-002. The notice is the CONDITION under which the
   * owner restored the audience chooser, so the state that matters is the one
   * where it is SHOWING — and a composer scene defaults to Public, where it is
   * correctly absent. Photographing only that would prove nothing about the
   * text a member actually reads before choosing "Only me".
   *
   * All three are rendered together so the absence under Public is visible as
   * an absence rather than as a scene somebody forgot to add, and so the two
   * restricted wordings can be read side by side at 360px, where the longer
   * one wraps.
   */
  /**
   * THE AUDIENCE CHOOSER, BOTH VARIANTS, ALL THREE AUDIENCES.
   *
   * ⚠ ADDED 2026-08-19 BECAUSE THIS CONTROL HAD NEVER BEEN PHOTOGRAPHED — not
   * once, in the whole life of this harness. The `composer-*` scenes mount
   * `PostComposerPreview`, which is the photo strip only; the audience row
   * lives in `WallPosts` and no scene reached it. So the control that decides
   * who can see a member's photograph was invisible to the sweep, on every
   * width, in both modes — including on the day it was withheld and the day it
   * came back.
   *
   * Rendered in both variants because they are genuinely different shapes: the
   * bordered pill on the web's first screen, and the full-width settings row on
   * screen 2, which is the ONLY one an Android member reaches. Each is shown at
   * every audience, so the notice's presence under Friends and Only Me — and
   * its absence under Public — is visible rather than asserted.
   */
  "post-audience-chooser": () => {
    const Demo = () => {
      const [row, setRow] = useState<Privacy>("public");
      const [inline, setInline] = useState<Privacy>("friends");
      return (
        <div className="min-h-screen space-y-6 bg-background p-4">
          <div>
            <div className="mb-2 text-xs font-semibold text-foreground">
              Web, screen 1 — the pill under the member's name
            </div>
            {(["public", "friends", "private"] as Privacy[]).map((p) => (
              <div key={p} className="mb-3 border-b border-border pb-3">
                <PostAudienceChooser value={p} onChange={setInline} variant="inline" />
              </div>
            ))}
            <div className="text-[10px] text-muted-foreground">live: {inline}</div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-foreground">
              App, screen 2 — the settings row every Android member reaches
            </div>
            {(["public", "friends", "private"] as Privacy[]).map((p) => (
              <div key={p} className="mb-3 border-b border-border pb-3">
                <PostAudienceChooser
                  value={p}
                  onChange={setRow}
                  variant="row"
                  rowLabel="Post audience"
                />
              </div>
            ))}
            <div className="text-[10px] text-muted-foreground">live: {row}</div>
          </div>
        </div>
      );
    };
    return <Demo />;
  },

  "privacy-gap-notice": () => (
    <div className="min-h-screen space-y-4 bg-background p-4">
      <div>
        <div className="mb-1 text-xs font-semibold text-foreground">Only me</div>
        <PrivacyGapNotice privacy="private" />
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold text-foreground">Friends</div>
        <PrivacyGapNotice privacy="friends" />
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold text-foreground">
          Public — nothing should appear below this line
        </div>
        <PrivacyGapNotice privacy="public" />
      </div>
    </div>
  ),

  /**
   * The date-of-birth shape: month/year dropdowns in the caption. This is the
   * one the upgrade is most likely to break — `captionLayout`, `fromYear` and
   * `toYear` are all renamed in v10.
   */
  "calendar-dob": () => (
    <div className="min-h-screen bg-background p-4">
      <Calendar
        mode="single"
        captionLayout="dropdown"
        startMonth={new Date(1940, 0)}
        endMonth={new Date(2008, 11)}
        month={new Date(1994, 4, 1)}
        selected={new Date(1994, 4, 17)}
        onSelect={() => {}}
      />
    </div>
  ),

  /**
   * THE CROP DIALOG — added 2026-08-16, and its absence is why every fault the
   * owner found in it shipped.
   *
   * `ImageCropModal` is mounted from NINE places, including the member post
   * flow and the avatar picker on Edit Profile. It had no scene, so the sweep
   * had never rendered it at 360px, and the 44px tap-target rule — which this
   * harness already enforces on every other screen — had never once been
   * applied to its toolbars.
   *
   * TALL is deliberate. It is 9:16, the shape a phone actually shoots, and the
   * one shape where the image's own `max-height` clamps the element box away
   * from the painted picture. A landscape fixture would photograph clean and
   * certify nothing.
   */
  "crop-modal-tall": () => (
    <div className="min-h-screen bg-background">
      <ImageCropModal imageSrc={TALL} onCropComplete={() => {}} onCancel={() => {}} />
    </div>
  ),

  /** The same dialog with a LANDSCAPE source — the case that has always worked,
   *  kept beside the tall one so the difference is visible rather than argued. */
  "crop-modal-wide": () => (
    <div className="min-h-screen bg-background">
      <ImageCropModal imageSrc={LAND} onCropComplete={() => {}} onCancel={() => {}} />
    </div>
  ),

  /** The AVATAR shape: aspect locked, circular overlay, fixed output size. A
   *  different code path through the same dialog — `isLocked` hides the aspect
   *  row entirely, so its layout is not covered by the two scenes above. */
  "crop-modal-avatar": () => (
    <div className="min-h-screen bg-background">
      <ImageCropModal
        imageSrc={PORT}
        forcedAspect={1}
        circularCrop
        targetWidth={512}
        targetHeight={512}
        onCropComplete={() => {}}
        onCancel={() => {}}
      />
    </div>
  ),

  /**
   * THE CROP DIALOG WHILE THE COMPOSER DIALOG IS OPEN — the real arrangement.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * Owner, 2026-08-16, on 1.2.9: "after uploadling any image clicked crop after
   * that any of option any fuction not wokring even not in web too, no cross,
   * no mirror, no moving the selection nothing - its like Screen is freezed -
   * web and app."
   *
   * The three scenes above mount `ImageCropModal` ALONE, and it works
   * perfectly in all of them — which is why every measurement I reported was
   * true and useless. In `WallPosts` it is not alone: it renders as a SIBLING
   * of the composer's Radix `<Dialog>`, and that dialog is open at the moment
   * Crop is pressed.
   *
   * A Radix modal dialog makes the rest of the page inert while it is open.
   * Anything outside its content stops receiving pointer events entirely — so
   * a `fixed` overlay drawn beside it is painted, perfectly laid out, and
   * completely deaf. Every symptom he lists is that, including "no cross": the
   * close button is dead for the same reason the drag is.
   *
   * This scene reproduces the arrangement rather than the component, so the
   * difference between "the crop dialog works" and "the crop dialog works
   * where a member actually meets it" is finally measurable.
   * ─────────────────────────────────────────────────────────────────────────
   */
  "crop-modal-behind-dialog": () => {
    const Demo = () => {
      const [taps, setTaps] = useState(0);
      return (
        <div className="min-h-screen bg-background">
          {/* The crop dialog, exactly where WallPosts puts it: BEFORE the
              composer Dialog and outside it. */}
          <div data-testid="crop-host">
            <ImageCropModal imageSrc={LAND} onCropComplete={() => {}} onCancel={() => setTaps((n) => n + 1)} />
          </div>
          <Dialog open onOpenChange={() => {}}>
            <DialogContent className="max-w-lg">
              <DialogTitle>New post</DialogTitle>
              <p className="text-sm text-muted-foreground">
                The composer, open behind the crop dialog — as it is when Crop is pressed.
              </p>
            </DialogContent>
          </Dialog>
          {/* Proof surface: if the crop dialog's Cancel can be reached at all,
              this number moves. It is the whole question. */}
          <span data-testid="cancel-taps" className="sr-only">{taps}</span>
        </div>
      );
    };
    return <Demo />;
  },

  /*
   * ── HASHTAG SUGGESTIONS ───────────────────────────────────────────────────
   * The numbers below are the REAL production figures measured on 2026-08-16,
   * not invented ones, so a screenshot shows what a member will actually see:
   * #50mmretinaworld genuinely has 11 posts from exactly ONE person.
   *
   * These scenes exist because of the crop-dialog lesson (1.2.9/1.2.10): every
   * fault that reached a member lived in an ARRANGEMENT the harness had never
   * rendered, while the component alone worked perfectly. So the list is drawn
   * here inside the two arrangements that can go wrong — hanging below a
   * composer box, and opening upward inside a dialog above its footer buttons.
   */
  "hashtag-list-below-box": () => (
    <div className="min-h-screen bg-background p-4">
      <p className="mb-2 text-xs uppercase tracking-widest text-primary">Composer caption</p>
      <div className="relative">
        <Textarea
          value="morning light on the bridge #50mm"
          readOnly
          rows={3}
          className="min-h-[120px] resize-none rounded-2xl border-0 bg-muted/30 px-3 py-2.5 text-base"
        />
        <HashtagSuggestions
          open
          focusIdx={0}
          onFocusIdx={() => {}}
          onPick={() => {}}
          suggestions={[
            { tag: "50mmretinaworld", display_tag: "50mmRetinaWorld", unique_user_count: 1, post_count: 11 },
            { tag: "50mmretina", display_tag: "50mmRetina", unique_user_count: 1, post_count: 6 },
          ]}
        />
      </div>
    </div>
  ),

  /**
   * The ranking argument, made visible: the tag 13 PEOPLE use sits above the
   * tag with more posts from fewer people. If this scene ever shows them the
   * other way round, the ORDER BY changed and one member's private tag is
   * being recommended to the whole platform.
   */
  "hashtag-list-ranked-by-people": () => (
    <div className="min-h-screen bg-background p-4">
      <div className="relative">
        <Textarea value="entry for the contest #a" readOnly rows={2} className="resize-none bg-muted/30" />
        <HashtagSuggestions
          open
          focusIdx={1}
          onFocusIdx={() => {}}
          onPick={() => {}}
          suggestions={[
            { tag: "aug_gallerycontest2026", display_tag: "Aug_GalleryContest2026", unique_user_count: 13, post_count: 24 },
            { tag: "artofphotography", display_tag: "ArtOfPhotography", unique_user_count: 1, post_count: 2 },
            { tag: "a_very_long_hashtag_that_should_truncate_rather_than_push_the_counts_off", display_tag: "A_Very_Long_Hashtag_That_Should_Truncate_Rather_Than_Push_The_Counts_Off", unique_user_count: 1, post_count: 1 },
          ]}
        />
      </div>
    </div>
  ),

  /**
   * THE ARRANGEMENT THAT CAN GO WRONG. The scheduled-post dialog puts a
   * six-row caption box directly above Cancel/Save. A list dropping DOWNWARD
   * here would land on those buttons — on a 360px phone, partly outside the
   * dialog. This scene is the proof that it opens upward and both buttons stay
   * whole and tappable.
   */
  "hashtag-list-in-dialog": () => (
    <div className="min-h-screen bg-background">
      <Dialog open onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogTitle>Edit caption</DialogTitle>
          <div>
            <Textarea value="rescheduled for sunrise #stre" readOnly rows={6} className="resize-none" />
            <HashtagSuggestions
              open
              placement="inline"
              focusIdx={0}
              onFocusIdx={() => {}}
              onPick={() => {}}
              suggestions={[
                { tag: "streetphotography", display_tag: "StreetPhotography", unique_user_count: 2, post_count: 3 },
                { tag: "streetlife", display_tag: "StreetLife", unique_user_count: 1, post_count: 1 },
              ]}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost">Cancel</Button>
            <Button>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  ),

  /**
   * Inline caption edit — Cancel and Save live directly under the box. This is
   * the scene that decides the placement question: both buttons must be whole
   * and reachable WHILE the list is open, not just after it closes.
   *
   * ⚠ THE BUTTONS BELOW CARRY POSTCARD'S REAL CLASSES, NOT SUBSTITUTED ONES.
   * That is the whole value of this scene: on its first run it reported them
   * at 63x31 and 59x29, under the 44px thumb floor — a real defect in the
   * shipped inline editor that nothing else had ever measured. The owner
   * authorised the fix on 2026-08-17 and both are now min-h-11. Keep copying
   * the real classes here; substituting a passing one would make this scene
   * agree with itself instead of with the product.
   */
  "hashtag-list-inline-edit": () => (
    <div className="min-h-screen bg-background p-3">
      <div className="space-y-2">
        <div>
          <Textarea value="reworking this caption #stre" readOnly className="min-h-[80px] resize-none text-[13px]" />
          <HashtagSuggestions
            open
            placement="inline"
            focusIdx={0}
            onFocusIdx={() => {}}
            onPick={() => {}}
            suggestions={[
              { tag: "streetphotography", display_tag: "StreetPhotography", unique_user_count: 2, post_count: 3 },
              { tag: "streetlife", display_tag: "StreetLife", unique_user_count: 1, post_count: 1 },
            ]}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button className="min-h-11 rounded-md border border-border px-4 text-[11px] uppercase tracking-wider text-muted-foreground">
            Cancel
          </button>
          <button className="min-h-11 rounded-md bg-primary px-5 text-[11px] font-medium uppercase tracking-wider text-primary-foreground">
            Save
          </button>
        </div>
      </div>
    </div>
  ),

  /** One photo: no reorder arrows can do anything, and there is no cover choice. */
  "composer-single": () => <ComposerHarness srcs={[LAND]} />,

  /** The everyday case — several photos, arrows live, cover badge on the first. */
  "composer-album": () => <ComposerHarness srcs={[LAND, PORT, PANO, TALL, swatch(3, "5")]} />,

  /** A PORTRAIT cover. The tallest frame the feed allows, so the tallest this
   *  preview can be — the case most likely to push the strip off-screen. */
  "composer-portrait-cover": () => <ComposerHarness srcs={[TALL, LAND, PANO]} />,

  /** A PANORAMA cover: the shortest frame, and the widest photo. */
  "composer-pano-cover": () => <ComposerHarness srcs={[PANO, LAND, PORT]} />,

  /** The limit: ten photos, so the "add more" tile must be gone and the strip
   *  must scroll rather than wrap or overflow the page. */
  "composer-full": () => (
    <ComposerHarness srcs={[LAND, PORT, PANO, TALL, swatch(1), swatch(2), swatch(3), swatch(4), swatch(5), swatch(6)]} />
  ),

  /** A preview whose URL does not load. A composer that renders a hole here
   *  tells the member their photo is broken when it is not. */
  "composer-broken-src": () => (
    <ComposerHarness srcs={["/harness-this-preview-does-not-exist.jpg", LAND]} />
  ),

  /**
   * Twenty-one posts = two full blocks and a bit, so the nine-then-one rhythm
   * can be seen repeating rather than reasoned about.
   */
  "profile-grid": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={GRID_POSTS} />
    </div>
  ),

  /**
   * The two hardest shapes in showcase position: a 4:5 portrait and a 9:16
   * phone shot, both shown WHOLE inside a 3:2 band.
   */
  "profile-grid-shapes": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={SHAPE_POSTS} />
    </div>
  ),

  /**
   * Ten posts exactly — the shortest wall that reaches a showcase. Checks that
   * the block completes cleanly: three whole rows, then the band, with no gap
   * where a row ended.
   */
  "profile-grid-one-block": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={GRID_POSTS.slice(0, 10)} />
    </div>
  ),

  /** One photograph. A three-column grid with one item is where naive grid CSS
   *  stretches the single tile across the full width. */
  "profile-grid-single": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={[post(3)]} />
    </div>
  ),

  /** Two tiles — an incomplete final row, the other common stretch bug. */
  "profile-grid-partial-row": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={[post(1), post(2)]} />
    </div>
  ),

  /**
   * Nine posts — one post SHORT of a band. The wall must end on a clean row
   * rather than reserving an empty band slot.
   */
  "profile-grid-no-band-yet": () => (
    <div className="min-h-screen bg-background">
      <ProfilePostGrid posts={GRID_POSTS.slice(0, 9)} />
    </div>
  ),

  /** The switch itself, in both positions, driven for real. */
  "wall-view-toggle": () => {
    const Demo = () => {
      const [view, setView] = useState<WallView>("grid");
      return (
        <div className="min-h-screen bg-background">
          <WallViewToggle value={view} onChange={setView} />
          <p className="p-4 text-sm text-muted-foreground">Selected: {view}</p>
          <WallViewToggle value="feed" onChange={() => {}} />
        </div>
      );
    };
    return <Demo />;
  },

  /*
   * ── @MENTION SUGGESTIONS ──────────────────────────────────────────────────
   * Reported by the owner on 2026-08-31, with a screenshot: typing "@" in a
   * comment shows the name list "hiding, not coming in front".
   *
   * The hashtag list got scenes on 2026-08-16 for exactly this class of fault;
   * the @mention list — a SECOND dropdown, from a different library, over a
   * different box — never got one, so nobody had ever looked at it. That gap is
   * why this shipped.
   *
   * ⚠ THE ARRANGEMENT IS THE TEST, not the component. MentionInput is drawn
   * here inside the real comment row: an avatar to its left and a send button
   * absolutely positioned INSIDE the field at z-10. react-mentions gives its
   * suggestions overlay `z-index: 1`, so the list renders UNDER that button.
   * A scene that mounted MentionInput alone would look perfect and prove
   * nothing.
   *
   * The list is opened by the capture script, which types "@a" and waits for
   * the fake backend's profiles_public_data rows — the real query path, not an
   * invented prop.
   */
  "mention-list-over-comment-box": () => <CommentComposerHarness />,

  /**
   * Proves the harness itself renders the app's real styling — Tailwind
   * tokens, the dark theme, the font — rather than a bare white page that
   * would make every later screenshot meaningless.
   */
  "harness-selftest": () => (
    <div className="min-h-screen bg-background p-5 text-foreground">
      <p className="mb-3 text-xs uppercase tracking-widest text-primary">Self test</p>
      <h2 className="mb-2 text-xl font-bold">Theme tokens are loading</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        If this block is dark with a blue label, index.css and the design tokens
        reached the harness and a screenshot of any other scene is trustworthy.
      </p>
      <div className="grid grid-cols-3 gap-[2px]">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <img key={i} src={swatch(i, String(i + 1))} alt="" className="aspect-square w-full object-cover" />
        ))}
      </div>
      {/* min-h-11 = 44px. The first capture run flagged this button at 36px
          tall — below the tap-target floor — which is exactly the class of
          defect the sweep exists to catch, and it caught it on itself. */}
      <button className="mt-4 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        Primary button
      </button>
    </div>
  ),
};

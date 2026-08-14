import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AutoBadge from "@/components/AutoBadge";
import UserBadgeInline from "@/components/UserBadgeInline";
import type { TaggedPerson } from "@/types/post";

/**
 * "50mm Retina World **with Avijit Sheel**" on the post header.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Owner, 2026-08-10, with an Instagram screenshot showing
 * "vineet_vohra ✓ and ifp.festival" in the header:
 *
 *   "In this picture I tagged Avijit Sheel but not showing 50mm Retina World
 *    with Avijit Sheel like Instagram"
 *   "If Tagged 20 person then it will show 50mm Retina World with Avijit Sheel
 *    and 19 Others. If someone click 19 others then the 20 name list will open
 *    nicely"
 *
 * Tagging has worked since build 1059 — the tag is saved, the tagged member is
 * notified, and the pin shows on the photo. It was simply never said out loud
 * on the post itself, so from the outside a tag looked like it had not happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COUNT IS THE REAL COUNT, AND THE LIST IS THE WHOLE LIST
 *
 * "and 19 others" is `tagged.length - 1`, never an estimate — the standing rule
 * on this project is that nothing on screen may show an invented number. The
 * dialog then lists **everyone**, the first name included, because "19 others"
 * promises 19 more people and a list of 19 would be a different set from the 20
 * who are actually tagged.
 *
 * WHO SEES WHAT — owner ruling, 2026-08-10. He was asked, answered, and then
 * REPLACED his answer within the hour with:
 *
 *   "Show immediately to public, but tagged person only can remove my Tag
 *    anytime. This is my updated answer"
 *
 *   * PENDING and ACCEPTED -> everybody sees the name, in the same type. There
 *     is deliberately NO visual difference: under this rule a pending tag is
 *     just as public as an accepted one, so marking it "not accepted yet" would
 *     be a lie in the opposite direction.
 *   * DECLINED / REMOVED   -> nobody ever sees it. A refusal is a refusal.
 *
 * What makes publishing a pending tag safe is the other half of his sentence:
 * a tagged member can remove their own tag at ANY time from the post menu
 * ("Remove tag of me" in PostCard). Publishing without that control would have
 * put a member's name on a stranger's photo with no way to take it off.
 */

/**
 * The tick for one tagged name.
 *
 * ⚠ PREFER THE BADGES THAT CAME WITH THE POST. Owner, 2026-08-14, with a
 * screenshot of "Sophia Agarcia with 50mm Retina World" and no tick, on an
 * account that IS verified in the database. The tick used to come only from
 * `AutoBadge`, a second lookup fired per name at render time — while the query
 * that produced this very list had already fetched the same profiles, badges
 * included, and discarded them. One line of text, two requests, and the second
 * one is the one that could come back empty.
 *
 * `person.badges` is optional on purpose: a caller that has not been migrated
 * yet keeps the old lookup instead of silently losing the tick. Delete the
 * fallback only once every producer of TaggedPerson sets `badges`.
 *
 * ⚠ This component is declared at MODULE level, not inside TaggedPeople's
 * render body. A component defined during render is a new element type every
 * pass and React remounts its subtree — trap #2, the bug that made typing in a
 * comment come out backwards. `noComponentDefinedInRender` guards it.
 */
const TagBadge = ({ person }: { person: TaggedPerson }) =>
  person.badges
    ? <UserBadgeInline badges={person.badges} size="compact" only="verified" />
    : <AutoBadge userId={person.id} size="compact" only="verified" />;

interface Props {
  people: TaggedPerson[];
}

const TaggedPeople = ({ people }: Props) => {
  const [open, setOpen] = useState(false);

  if (!people || people.length === 0) return null;

  const [first, ...rest] = people;
  const others = rest.length;

  return (
    <>
      {/* `with` is deliberately not bold: the NAMES are the information, and the
          author's own name above already carries the heading weight. */}
      <span className="text-muted-foreground">
        {/* No leading {" "} here any more. It was collapsed by the flex parent
            and read as if it had been forgotten; the space before "with" is now
            that container's gap-x-1. The one before the NAME stays, because it
            is inside this same inline run. */}
        with{" "}
        {/* ⚠ THE BLUE TICK BELONGS TO THE NAME, NOT TO THE AUTHOR SLOT.
            Owner's standing rule: *"on each and every place Name with Badge
            will show."* This line was the exception nobody had noticed — the
            post's own author got the tick from UserIdentityBlock, but the
            person tagged BESIDE him, rendered by this file, got a bare name.
            So "50mm Retina World ✓ with Sophia Agarcia" showed a verified
            author standing next to an apparently unverified member who is in
            fact verified. A badge that appears in some places and not others
            does not read as an oversight; it reads as a claim about the person
            who is missing it.

            `inline-flex` on the wrapper, not on the Link, so the tick tracks
            the name as one unit while the run around it stays ordinary text —
            the `{" and "}` below is a real text node and keeps its spaces.
            AutoBadge costs no extra request: enrichPosts already pulled every
            tagged profile into the same entity cache it reads from. */}
        <span className="inline-flex items-center gap-1 align-middle">
          <Link
            to={`/profile/${first.id}`}
            className="font-medium text-foreground hover:text-primary transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {first.name}
          </Link>
          <TagBadge person={first} />
        </span>
        {others > 0 && (
          <>
            {" and "}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setOpen(true);
              }}
              className="font-medium text-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              {others} {others === 1 ? "other" : "others"}
            </button>
          </>
        )}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        {/*
          `max-h` + `overflow-y-auto` are load-bearing, not decoration. The
          tagging picker was unreachable for weeks because a dialog opened
          1020px tall inside a 710px viewport with scrolling switched off, and
          nobody could see the part that mattered (fixed in 1059, see
          ROOT_FIX_TAGGING_MODAL_OFFSCREEN.md). Twenty names is exactly the size
          that would do it again. The list scrolls; the dialog never outgrows
          the screen.
        */}
        <DialogContent className="max-w-xs sm:max-w-sm max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">
              {people.length === 1 ? "Tagged" : `Tagged (${people.length})`}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto -mx-2 px-2">
            {people.map((p) => (
              <Link
                key={p.id}
                to={`/profile/${p.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50 transition-colors"
              >
                {/* The same rule inside the list. Someone opening "and 19
                    others" is reading a roster of people; a tick present on the
                    header name and absent here would contradict itself two taps
                    apart. */}
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-sm">{p.name}</span>
                  <TagBadge person={p} />
                </span>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TaggedPeople;

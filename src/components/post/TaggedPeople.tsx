import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
        {" "}with{" "}
        <Link
          to={`/profile/${first.id}`}
          className="font-medium text-foreground hover:text-primary transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {first.name}
        </Link>
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
                <span className="text-sm">{p.name}</span>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TaggedPeople;

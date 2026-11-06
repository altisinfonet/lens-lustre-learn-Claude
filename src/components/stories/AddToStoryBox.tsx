/**
 * STORIES v2 — "Also add to my story", ticked by default (Owner, 6 Nov 2026:
 * "all post updates will go to 24 hours story by default checked — if
 * unchecked then only won't go"). The ONE box for every post screen (photo
 * and video). Approved: _control/out/OWNER/stories-sample/approved-2026-11-06/new-5-post-box-phone.png
 *
 * A native checkbox drawn exactly like ui/checkbox (same classes), because the
 * post screen is in the first download and the Radix checkbox would add 3.7 KB
 * to it (P13 entry-bundle ceiling).
 */
import { Check } from "lucide-react";

export default function AddToStoryBox({ checked, onChange, className = "m-4" }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** the outer spacing of the screen it sits on (the approved card: m-4) */
  className?: string;
}) {
  return (
    <label data-testid="add-to-story" className={`${className} flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-primary ring-offset-background peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
      >
        {checked && <Check className="h-4 w-4" />}
      </span>
      <span>
        <span className="block text-sm font-semibold">Also add to my story</span>
        <span className="block text-xs text-muted-foreground">Shows for 24 hours, to the same people as this post. Untick to skip.</span>
      </span>
    </label>
  );
}

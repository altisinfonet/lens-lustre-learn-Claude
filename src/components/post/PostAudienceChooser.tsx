/**
 * THE POST AUDIENCE CHOOSER — ONE COMPONENT, USED BY BOTH COMPOSERS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A COMPONENT AND NOT TWO BLOCKS OF JSX.
 *
 * The composer has TWO audience controls: one on the web's first screen and one
 * on screen 2, which is the ONLY one an Android member ever reaches. They were
 * duplicated inline in `WallPosts.tsx`, and that duplication has already cost
 * something real: when the chooser was withheld on 2026-08-16, the web one was
 * removed first and believed done. The privacy control was withheld ON THE
 * WEBSITE ONLY while shipping live to every phone, and only a test written the
 * same afternoon caught it.
 *
 * Restoring them re-created the same hazard pointing the other way — restore
 * one, forget the other, and the app and the website now disagree about what a
 * member may choose. So they are one component. Half-removing it is no longer a
 * thing a diff can quietly do.
 *
 * ⚠ THE NOTICE IS PART OF THE CONTROL, NOT A SIBLING OF IT. It renders here,
 * inside the same component, because docs/DECISIONS.md D-002 restored the
 * chooser ON CONDITION that its limit is stated: the database honours a post's
 * privacy and the direct image URL does not, so a "Friends" or "Only me" photo
 * stays fetchable by anyone holding its link. Keeping the two together means
 * there is no arrangement of this code that offers the choice silently.
 *
 * `variant` is presentation only — the same options, the same handler, the same
 * disclosure either way:
 *   • "inline" — the small bordered pill under the member's name (web screen 1)
 *   • "row"    — the full-width settings row with an icon (app screen 2)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Globe, Users, Lock, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PrivacyGapNotice } from "@/components/post/PrivacyGapNotice";

export type Privacy = "public" | "friends" | "private";

/**
 * All three, always. A narrowed set is exactly what withholding looked like,
 * and `PrivacyGapDisclosed.test.ts` asserts every one of them is still offered.
 */
export const PRIVACY_OPTIONS: { value: Privacy; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: "public", label: "Public", hint: "Anyone can see", icon: <Globe className="h-3.5 w-3.5" /> },
  { value: "friends", label: "Friends", hint: "Your friends", icon: <Users className="h-3.5 w-3.5" /> },
  { value: "private", label: "Only Me", hint: "Only you can see this", icon: <Lock className="h-3.5 w-3.5" /> },
];

export const privacyIcon = (p: Privacy) => {
  const found = PRIVACY_OPTIONS.find((o) => o.value === p);
  return found ? found.icon : <Globe className="h-3.5 w-3.5" />;
};

const labelFor = (p: Privacy) => PRIVACY_OPTIONS.find((o) => o.value === p)?.label || "Public";

export function PostAudienceChooser({
  value,
  onChange,
  variant,
  rowLabel,
}: {
  value: Privacy;
  onChange: (p: Privacy) => void;
  variant: "inline" | "row";
  /** Translated "Post audience" for the row variant. */
  rowLabel?: string;
}) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "inline" ? (
            /**
             * ⚠ `min-h-8` IS A FIX, NOT STYLING. Restored verbatim from git
             * history this control measured 89x22 on every phone width — the
             * long axis fine, the short one 10px under the 32px floor this
             * repo enforces everywhere else. It had been that way since before
             * the chooser was withheld, and nothing had ever reported it,
             * because THIS CONTROL HAD NEVER BEEN PHOTOGRAPHED: the composer
             * scenes mount the photo strip only, and the audience row lives in
             * WallPosts where no scene reached it. The sweep found it within
             * seconds of the scene existing.
             *
             * 32px is the floor, not a target — the row it sits in is tight
             * under the member's name, so it takes the minimum rather than the
             * full 44.
             */
            <button
              type="button"
              className="mt-0.5 flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
            >
              {privacyIcon(value)}
              <span>{labelFor(value)}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
          ) : (
            <button type="button" className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted/40">
              {/*
                ⚠ THE ICON FOLLOWS THE SELECTION. It used to be a hardcoded
                `Globe`, which was harmless while every post was public and
                actively misleading the moment the chooser came back: a GLOBE —
                the symbol for "anyone can see this" — sat beside the words
                "Only Me". Caught by looking at the scene added with D-002, not
                by any assertion.
              */}
              <span className="shrink-0 text-muted-foreground [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">
                {privacyIcon(value)}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{rowLabel ?? "Post audience"}</span>
                <span className="block text-xs text-muted-foreground">{labelFor(value)}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {PRIVACY_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className="flex items-center gap-2.5 py-2"
            >
              {opt.icon}
              <div>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.hint}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <PrivacyGapNotice privacy={value} />
    </>
  );
}

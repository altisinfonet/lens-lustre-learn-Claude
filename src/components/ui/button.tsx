import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  /*
   * ⚠ `tap-44` IS LAST, AND THE POSITION IS LOAD-BEARING. DO NOT MOVE IT.
   *
   * It was FIRST, on the reasoning that a caller's className could not then
   * drop it. That renamed EVERY Button in the app: capture.mjs builds a
   * control's identity as tag + id + THE FIRST TWO CLASS NAMES, so
   * `button.inline-flex.items-center` became `button.tap-44.inline-flex`, and
   * the gate reported 340 lines of "is gone (was present in the baseline)"
   * across every scene at every width. Nothing was gone. The Auditor's proof
   * that it was a rename and not a removal: a real removal cannot hit every
   * scene at every width identically.
   *
   * I then moved it to position THREE, which fixes the common case and not the
   * measured one. The Auditor ran cn() against five caller shapes: when a
   * caller passes "inline-flex items-center", twMerge removes the BASE copies
   * and the first two names become whatever follows. At position three that
   * yields `tap-44.justify-center` — still not the baseline. LAST, it can never
   * reach the first two positions however much twMerge removes.
   *
   * The worry that put it first was measured to be unfounded: across ten runs,
   * five caller shapes × first and last, tap-44 SURVIVED EVERY TIME, because
   * twMerge only drops classes it recognises as conflicting Tailwind utilities
   * and tap-44 is not one. The protection does not depend on the position.
   *
   * ⚠ AND THE BASELINE WAS NOT RE-RECORDED. Re-recording would also have
   * cleared the red, and this is the one run in which every shared Button's
   * signature changes at once — so a control that genuinely vanished tonight
   * would have been indistinguishable from the 340 renames and would have been
   * written into the new baseline as normal.
   */
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 tap-44",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { tailwindFontSize, tailwindSpacing } from "@/ui/tokens";

/**
 * tailwind-merge must know the token names (src/ui/tokens.ts). Unknown, it reads
 * `text-caption` as a colour, and a later `text-foreground` would delete it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { spacing: Object.keys(tailwindSpacing) },
    classGroups: { "font-size": [{ text: Object.keys(tailwindFontSize) }] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

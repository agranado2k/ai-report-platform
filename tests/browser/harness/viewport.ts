// The PRD's viewport matrix (#403) and the one geometric check every app spec
// shares. Widths below 768px get the phone presentation; 768px and up keep the
// persistent sidebar (the `md` breakpoint the shell switches on).
import type { Page } from "@playwright/test";

export const PHONE_WIDTHS = [320, 375, 390] as const;
export const WIDE_WIDTHS = [768, 1024, 1280] as const;

/** How many CSS px of sideways scrolling the page chrome allows: the document
 *  itself, plus every element that scrolls (the shell's content column is its
 *  own scroller, so a wide row would overflow THERE, not on the document).
 *  0 means nothing scrolls sideways. */
export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scrollers = [document.documentElement, ...document.querySelectorAll("body *")].filter(
      (el) => {
        if (el === document.documentElement) return true;
        const x = getComputedStyle(el).overflowX;
        return x === "auto" || x === "scroll";
      },
    );
    return Math.max(0, ...scrollers.map((el) => el.scrollWidth - el.clientWidth));
  });
}

import type { ReactNode } from "react";
import { Logo } from "./Logo";

/**
 * Host chrome for the Clerk auth screens (App Shell Mockups Z0W60dI8hu,
 * SECTION 05). Clerk renders the sign-in / sign-up CARD itself (themed through
 * the pure `clerkAppearance` value); this component owns everything around it —
 * the page ground, the centred column, and the Centaur mark ABOVE the card.
 *
 * The column is capped at ~400px: Clerk publishes no card width, so 400px is
 * our choice, not a copied default. The mark is the same violet Logo + serif
 * wordmark lockup the sidebar uses (AppShell), so the auth screen and the
 * signed-in product read as visibly the same brand.
 */
export function AuthShell({ children }: { children?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-12">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-6">
        <div className="flex items-center gap-2.5">
          <Logo className="size-8 shrink-0" />
          <span className="font-serif text-2xl font-semibold tracking-tight text-fg">Centaur</span>
        </div>
        {children}
      </div>
    </main>
  );
}

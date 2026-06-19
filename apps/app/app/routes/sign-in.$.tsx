import { SignIn } from "@clerk/remix";

// Catch-all (splat) route so Clerk's path-based <SignIn> owns /sign-in/* (ADR-0005).
// Clerk's own card is themed via the appearance API on ClerkApp (root.tsx); here we
// just center it on the page.
export default function SignInPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-12">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </main>
  );
}

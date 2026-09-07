import { SignIn } from "@clerk/remix";
import { AuthShell } from "../components/AuthShell";

// Catch-all (splat) route so Clerk's path-based <SignIn> owns /sign-in/* (ADR-0005).
// Clerk's own card is themed via the appearance API on ClerkApp (root.tsx); AuthShell
// owns the page around it — the ground, the ~400px width, and the Centaur mark above
// the card (App Shell Mockups Z0W60dI8hu, SECTION 05).
export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </AuthShell>
  );
}

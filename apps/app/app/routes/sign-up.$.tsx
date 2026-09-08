import { SignUp } from "@clerk/remix";
import { AuthShell } from "../components/AuthShell";

// Catch-all (splat) route for Clerk's path-based <SignUp>. With the instance in
// Restricted mode (ADR-0048), self-serve sign-up is invitation-only. AuthShell owns
// the page around Clerk's card — the ground, the ~400px width, and the Centaur mark
// above the card (App Shell Mockups Z0W60dI8hu, SECTION 05).
export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </AuthShell>
  );
}

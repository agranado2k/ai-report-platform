import { SignUp } from "@clerk/remix";

// Catch-all (splat) route for Clerk's path-based <SignUp>. With the instance in
// Restricted mode (ADR-0048), self-serve sign-up is invitation-only.
export default function SignUpPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-12">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </main>
  );
}

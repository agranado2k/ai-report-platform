import { SignUp } from "@clerk/remix";

// Catch-all (splat) route for Clerk's path-based <SignUp>. With the instance in
// Restricted mode (ADR-0048), self-serve sign-up is invitation-only.
export default function SignUpPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </main>
  );
}

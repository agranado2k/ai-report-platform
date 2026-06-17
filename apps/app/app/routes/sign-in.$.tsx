import { SignIn } from "@clerk/remix";

// Catch-all (splat) route so Clerk's path-based <SignIn> owns /sign-in/* (ADR-0005).
export default function SignInPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </main>
  );
}

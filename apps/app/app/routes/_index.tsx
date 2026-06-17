import { SignedIn, SignedOut, UserButton } from "@clerk/remix";
import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { getAuth } from "../server/auth.server";

export const meta: MetaFunction = () => [
  { title: "ai-report-platform — dashboard" },
  { name: "description", content: "Phase 1 dashboard." },
];

// Server-confirmed auth state (ADR-0048): proves rootAuthLoader + the session
// resolve on the server, not just in the client ClerkProvider.
export async function loader(args: LoaderFunctionArgs) {
  const { userId, orgId } = await getAuth(args);
  return json({ userId, orgId });
}

export default function Index() {
  const { userId, orgId } = useLoaderData<typeof loader>();
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>ai-report-platform</h1>
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
        <SignedOut>
          <Link to="/sign-in">Sign in</Link>
        </SignedOut>
      </header>

      <SignedIn>
        <p>✓ Signed in.</p>
        <ul>
          <li>
            Clerk user: <code>{userId}</code>
          </li>
          <li>
            Active Clerk org: <code>{orgId ?? "— (none yet)"}</code>
          </li>
        </ul>
        {/* Attribution note (ADR-0048): /upload still records the seeded
            DEMO_ACTOR, not this signed-in user. resolveUploadActor is wired to
            getAuth + provisionIdentity in the next slice (1b-ii). */}
        <p>
          <Link to="/upload">Upload a report →</Link>
        </p>
      </SignedIn>
      <SignedOut>
        <p>
          You're signed out. <Link to="/sign-in">Sign in</Link> to continue.
        </p>
      </SignedOut>
    </main>
  );
}

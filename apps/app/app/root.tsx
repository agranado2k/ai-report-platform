import { ClerkApp } from "@clerk/remix";
import { rootAuthLoader } from "@clerk/remix/ssr.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react";
import { defineEnv } from "arp-env";

// Clerk wiring (ADR-0005 / ADR-0048): rootAuthLoader provides the auth state to
// the whole app and injects the publishable key for the client ClerkProvider.
// Our env contract names the key PUBLIC_CLERK_PUBLISHABLE_KEY (PUBLIC_ prefix,
// ADR-0043) while Clerk's default lookup is CLERK_PUBLISHABLE_KEY — so we pass it
// explicitly. The secret key (CLERK_SECRET_KEY) matches Clerk's default env name.
export const loader = (args: LoaderFunctionArgs) =>
  rootAuthLoader(args, { publishableKey: defineEnv().PUBLIC_CLERK_PUBLISHABLE_KEY });

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function App() {
  return <Outlet />;
}

// ClerkApp wraps the app in <ClerkProvider>, reading the publishable key from the
// rootAuthLoader state injected above.
export default ClerkApp(App);

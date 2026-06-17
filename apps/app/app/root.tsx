import { ClerkApp } from "@clerk/remix";
import { rootAuthLoader } from "@clerk/remix/ssr.server";
import { type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react";
import { defineEnv } from "arp-env";

// Document routes that do NOT require a session — everything else on the app
// origin is gated (default-protect, ADR-0048). The resource routes (/health,
// /api/v1/reports, /internal/scan-drain) don't render the root, so they sit
// outside this gate and keep their own auth (401 / bearer secret). The viewer
// app (view.<domain>) is a separate, intentionally-public origin (ADR-0038).
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/health"];

function isPublicPath(pathname: string): boolean {
  // Prefix match so Clerk's path-routed sub-pages (/sign-in/sso-callback, …) pass.
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Clerk wiring (ADR-0005 / ADR-0048): rootAuthLoader provides the auth state to
// the whole app and injects the publishable key for the client ClerkProvider.
// Our env contract names the key PUBLIC_CLERK_PUBLISHABLE_KEY (PUBLIC_ prefix,
// ADR-0043) while Clerk's default lookup is CLERK_PUBLISHABLE_KEY — so we pass it
// explicitly. The secret key (CLERK_SECRET_KEY) matches Clerk's default env name.
//
// The callback is the app-wide auth gate: any non-public document route requires
// a signed-in session, else we redirect to /sign-in.
export const loader = (args: LoaderFunctionArgs) =>
  rootAuthLoader(
    args,
    ({ request }) => {
      const { pathname } = new URL(request.url);
      if (!request.auth.userId && !isPublicPath(pathname)) {
        return redirect("/sign-in");
      }
      return {};
    },
    { publishableKey: defineEnv().PUBLIC_CLERK_PUBLISHABLE_KEY },
  );

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

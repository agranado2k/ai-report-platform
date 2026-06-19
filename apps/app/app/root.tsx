import { ClerkApp } from "@clerk/remix";
import { rootAuthLoader } from "@clerk/remix/ssr.server";
import { type LinksFunction, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "@remix-run/react";
import { defineEnv } from "arp-env";
import { buttonClass } from "./components/Button";
import { EmptyState } from "./components/EmptyState";
import { PageShell } from "./components/PageShell";
import stylesheet from "./tailwind.css?url";

// The compiled Tailwind stylesheet (static, served from 'self' — CSP-safe) +
// preloaded self-hosted fonts (font-src 'self'; no remote CDN).
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  {
    rel: "preload",
    href: "/fonts/inter-variable.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
];

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
// a signed-in session, else we redirect to /sign-in (preserving the intended
// destination via `redirect_url`, which Clerk's <SignIn> honours post-auth).
//
// SCOPE: this is a NAVIGATION gate, not a per-route authorization check. Remix
// runs sibling/child loaders in parallel; the root redirect replaces the rendered
// response but does not stop those loaders executing. So any data-fetching
// loader/route must still authorize itself (ADR-0048) — e.g. POST /api/v1/reports
// returns 401 via resolveUploadActor; resource routes are outside this gate.
export const loader = (args: LoaderFunctionArgs) =>
  rootAuthLoader(
    args,
    ({ request }) => {
      const { pathname, search } = new URL(request.url);
      if (!request.auth.userId && !isPublicPath(pathname)) {
        return redirect(`/sign-in?redirect_url=${encodeURIComponent(pathname + search)}`);
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

// Root error boundary — also Remix's app-wide 404 (unmatched routes render here).
// Renders inside Layout, so the document chrome + stylesheet apply. Never leaks an
// error message (mirrors the upload route's 500 hygiene).
export function ErrorBoundary() {
  const error = useRouteError();
  const routeError = isRouteErrorResponse(error) ? error : null;
  const is404 = routeError?.status === 404;
  const title = is404
    ? "Page not found"
    : routeError
      ? `${routeError.status} ${routeError.statusText}`
      : "Something went wrong";
  const description = is404
    ? "The page you're looking for doesn't exist or has moved."
    : "An unexpected error occurred. Please try again.";
  return (
    <PageShell>
      <div className="grid min-h-[60vh] place-items-center">
        <EmptyState
          icon="🧭"
          title={title}
          description={description}
          action={
            <Link to="/" className={buttonClass("primary")}>
              Back to your reports
            </Link>
          }
        />
      </div>
    </PageShell>
  );
}

// Clerk renders its own DOM (SignIn / SignUp / UserButton); we theme it via the
// appearance API. Values mirror the design tokens (theme.css) — Clerk computes
// shades from the literal hex, and CSS-var resolution inside its injected styles
// is unreliable, so we duplicate the hexes here intentionally.
// TODO(dark): these literals don't follow `.dark` — swap appearance (or use a
// Clerk dark baseTheme) when the dark theme toggle lands.
const clerkAppearance = {
  variables: {
    colorPrimary: "#5e6ad2",
    colorText: "#171717",
    colorTextSecondary: "#62666d",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#171717",
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
    borderRadius: "8px",
  },
};

// ClerkApp wraps the app in <ClerkProvider>, reading the publishable key from the
// rootAuthLoader state injected above.
export default ClerkApp(App, { appearance: clerkAppearance });

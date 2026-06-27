import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPublicRoute } from "@/lib/routes";

/**
 * Edge gate: every page route requires a `session` cookie, else redirect to
 * /login. This is the UX gate — presence only, not signature. The Rust API is
 * the authoritative gate: it verifies the JWT on every /api call and 401s an
 * invalid/expired token regardless of this middleware.
 *
 * `/api/*` is intentionally NOT matched here — those calls are validated by the
 * API itself (and the ALB routes them straight to it, bypassing Next anyway).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public, no-session routes:
  //  - /login is the auth page.
  //  - /healthz must pass through so the ALB health check (accepts 200,404 —
  //    Next has no /healthz route → 404) sees a non-redirect.
  //  - /setup is the first-run wizard; it must be reachable before any account
  //    or session exists. The wizard itself checks setup status and redirects
  //    to /login when setup is already done.
  //  - /api/setup/* are the public setup endpoints (status, namespaces,
  //    complete). Edge middleware can't reach the DB, so the needsSetup funnel
  //    is done client-side from the login page; here we only avoid bouncing
  //    these paths to /login.
  if (
    isPublicRoute(pathname) ||
    pathname === "/healthz" ||
    pathname.startsWith("/api/setup")
  ) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has("session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Match everything except Next internals, static assets, the API, and favicon.
  matcher: ["/((?!_next/static|_next/image|api|favicon.ico).*)"],
};

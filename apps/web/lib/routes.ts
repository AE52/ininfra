/**
 * Routes reachable WITHOUT a session — the login screen and the first-run
 * setup wizard. Keep this list in ONE place: the edge middleware, the app
 * shell, and background pollers all consult it. A mismatch (one knowing about
 * `/setup`, another not) caused a `/setup` ↔ `/login` redirect loop, because
 * pollers on `/setup` hit auth-gated APIs, 401'd, and the client bounced to
 * `/login` — which funnels straight back to `/setup`.
 */
export function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname.startsWith("/setup/")
  );
}

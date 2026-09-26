import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic auth check only.
 *
 * Next.js 16 renamed Middleware to Proxy. Per the docs, this is not a session
 * management or authorization solution — it just keeps signed-out visitors off
 * app routes cheaply. Real verification happens in `getSession()` on the server
 * and in `requireRole()` inside every Server Function.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("hrms_session");
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)",
  ],
};

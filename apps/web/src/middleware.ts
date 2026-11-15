import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, passwordConfigured, verifySession } from "@/server/auth";

/**
 * Node middleware reads the current installation password on every request.
 * API handlers also authenticate independently; stale cookies cannot bypass either guard.
 */
export const middleware = (request: NextRequest) => {
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/auth") return NextResponse.next();
  if (!passwordConfigured()) return NextResponse.next();
  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (!verifySession(cookie)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
};

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse, type NextRequest } from "next/server";

/**
 * Early redirect to the sign-in page for the two pages that are never
 * public: the home page and account settings. It only looks for the presence
 * of a session cookie, which keeps the signed-out flash off the screen; it
 * is not the security boundary. Every API route checks the caller itself
 * (`src/server/auth`), and the pages are static shells with no data in them.
 *
 * `/d/<id>` and `/s/<token>` are left alone on purpose: a share link can be
 * enough to open a diagram without an account.
 */
const ON = ["1", "true", "on", "yes"];

export function proxy(request: NextRequest) {
  // Same rule as `authEnabled()`: accounts are opt-in and need the database.
  const accounts = Boolean(process.env.DATABASE_URL?.trim()) && ON.includes((process.env.DIAGRAM_AI_AUTH ?? "").trim().toLowerCase());
  if (!accounts) return NextResponse.next();

  if (request.cookies.has("dai_session") || request.cookies.has("__Host-dai_session")) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/", "/account"],
};

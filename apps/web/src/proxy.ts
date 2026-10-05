import { NextResponse, type NextRequest } from "next/server";

import { createRequestCsp, webSecurityHeaders } from "./lib/browser-security";

/** Security headers only; authentication remains in pages/actions and the API. */
export function proxy(request: NextRequest) {
  const { nonce, csp } = createRequestCsp(process.env);
  const requestHeaders = new Headers(request.headers);
  // Overwrite caller values; Next extracts this trusted nonce for SSR scripts.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.delete("Content-Security-Policy-Report-Only");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  for (const header of webSecurityHeaders) response.headers.set(header.key, header.value);
  return response;
}

export const config = {
  // Include RSC/prefetch/Server Action requests. Exclude only non-document
  // assets; do not let untrusted prefetch headers bypass nonce generation.
  matcher: ["/((?!_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$).*)"],
};

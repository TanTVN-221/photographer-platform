import type { RequestHandler } from "express";

/** JSON/images/downloads are not executable documents. No CORS read grant. */
export const apiSecurityHeaders: RequestHandler = (_request, response, next) => {
  response.set({
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    // Same-host web/API on different loopback ports must still load private
    // WebP images. Resource policy is defense-in-depth, never authorization.
    "Cross-Origin-Resource-Policy": "same-site",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  });
  next();
};

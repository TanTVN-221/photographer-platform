import { NextRequest } from "next/server";
// Installed 16.3.6 still exports the former name despite its bundled guide
// referring to doesProxyMatch. Verify actual matcher behavior with this export.
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "./proxy";
import { webSecurityHeaders } from "./lib/browser-security";

afterEach(() => vi.unstubAllEnvs());
describe("request-specific Next security (SEC-005, UX-001)", () => {
  it("overwrites untrusted policy/nonce headers before SSR and attaches the same response policy", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("http://127.0.0.1:3000/signin", { headers: {
      "x-nonce": "chosen-by-caller", "Content-Security-Policy": "script-src * 'unsafe-inline'",
      "Content-Security-Policy-Report-Only": "report-uri https://evil.example.test", "Cookie": "pp-locale=vi",
      "x-forwarded-host": "evil.example.test",
    } });
    const response = proxy(request);
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(nonce).not.toBe("chosen-by-caller");
    expect(response.headers.get("Content-Security-Policy")).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(response.headers.get("Content-Security-Policy"));
    expect(response.headers.get("x-middleware-request-content-security-policy-report-only")).toBeNull();
    expect(response.headers.get("x-middleware-request-cookie")).toBe("pp-locale=vi");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("evil.example.test");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("x-nonce")).toBeNull();
    for (const header of webSecurityHeaders) expect(response.headers.get(header.key)).toBe(header.value);
  });

  it("does not skip nonce generation for spoofed prefetch/RSC headers or Server Action POSTs", () => {
    const prefetch = proxy(new NextRequest("http://127.0.0.1:3000/", { headers: { "next-router-prefetch": "1", RSC: "1" } }));
    const action = proxy(new NextRequest("http://127.0.0.1:3000/", { method: "POST", headers: { "next-action": "opaque" } }));
    expect(prefetch.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(action.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(prefetch.headers.get("x-middleware-request-x-nonce")).not.toBe(action.headers.get("x-middleware-request-x-nonce"));
  });

  it.each(["/", "/signin", "/workspace", "/g/example", "/favicon.ico-extra", "/robotsXtxt", "/_next/static-other"])("matches actual document/navigation path %s", (url) => {
    expect(unstable_doesProxyMatch({ config, nextConfig: {}, url, headers: { "next-router-prefetch": "1", RSC: "1" } })).toBe(true);
  });

  it.each(["/_next/static/chunks/runtime.js", "/_next/image?url=test", "/favicon.ico", "/robots.txt", "/sitemap.xml"])("leaves asset caching untouched for %s", (url) => {
    expect(unstable_doesProxyMatch({ config, nextConfig: {}, url })).toBe(false);
  });
});

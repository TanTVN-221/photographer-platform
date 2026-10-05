import { describe, expect, it } from "vitest";

import { browserSecurityOrigins, createBrowserCsp, createRequestCsp, webSecurityHeaders } from "./browser-security";

const nonce = Buffer.alloc(32, 5).toString("base64");
const hosted = { NODE_ENV: "production", PUBLIC_WEB_BASE_URL: "https://photos.example.test", PUBLIC_API_BASE_URL: "https://photos.example.test" };
function directive(csp: string, name: string) {
  return csp.split("; ").find((part) => part.startsWith(`${name} `));
}

describe("browser policy (SEC-005, AUTH-004, IMG-002/004)", () => {
  it("retains native cross-port form origins without disclosing private paths or query strings", () => {
    expect(webSecurityHeaders.find((header) => header.key === "Referrer-Policy")?.value).toBe("strict-origin");
    // Both configured destinations are same-host/same-scheme, but not same-origin.
    const origins = browserSecurityOrigins({ NODE_ENV: "development" });
    expect(origins?.web.origin).toBe("http://127.0.0.1:3000");
    expect(origins?.api.origin).toBe("http://127.0.0.1:4000");
    expect(origins?.web.origin).not.toBe(origins?.api.origin);
  });

  it("uses a fresh unpredictable nonce and production scripts have no inline/eval escape", () => {
    const first = createRequestCsp(hosted), second = createRequestCsp(hosted);
    expect(first.nonce).not.toBe(second.nonce);
    expect(Buffer.from(first.nonce, "base64")).toHaveLength(32);
    expect(directive(first.csp, "script-src")).toBe(`script-src 'self' 'nonce-${first.nonce}' 'strict-dynamic'`);
    expect(first.csp).toContain("script-src-attr 'none'");
    expect(first.csp).not.toContain("unsafe-eval");
    expect(first.csp).toContain("upgrade-insecure-requests");
  });

  it("allows only the application image origin, same-origin browser fetches and explicit OAuth form navigation", () => {
    const csp = createBrowserCsp(nonce, hosted);
    expect(directive(csp, "img-src")).toBe("img-src 'self' https://photos.example.test");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self' https://photos.example.test https://accounts.google.com");
    expect(directive(csp, "script-src")).not.toContain("google");
    expect(csp).not.toContain("googleusercontent");
    expect(csp).not.toContain("data:");
    expect(csp).not.toContain("blob:");
    for (const restriction of ["default-src 'none'", "frame-ancestors 'none'", "frame-src 'none'", "base-uri 'none'", "object-src 'none'", "worker-src 'none'"]) expect(csp).toContain(restriction);
  });

  it("limits inline production styles to attributes for existing photo aspect ratios", () => {
    const csp = createBrowserCsp(nonce, hosted);
    expect(directive(csp, "style-src")).toBe(`style-src 'self' 'nonce-${nonce}'`);
    expect(directive(csp, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
  });

  it("allows development eval/HMR only for the configured exact loopback web origin", () => {
    const csp = createBrowserCsp(nonce, { NODE_ENV: "development" });
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' ws://127.0.0.1:3000");
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(csp, "img-src")).toContain("http://127.0.0.1:4000");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(createBrowserCsp(nonce, { NODE_ENV: "production" })).not.toContain("ws:");
    expect(createBrowserCsp(nonce, {})).not.toContain("unsafe-eval");
  });

  it.each([
    { PUBLIC_API_BASE_URL: "https://evil.example.test" },
    { PUBLIC_API_BASE_URL: "https://photos.example.test/path" },
    { PUBLIC_API_BASE_URL: "https://user:secret@photos.example.test" },
    { PUBLIC_API_BASE_URL: "https://photos.example.test/?token=secret" },
    { PUBLIC_API_BASE_URL: "https://photos.example.test/#fragment" },
    { PUBLIC_API_BASE_URL: "javascript:alert(1)" },
    { PUBLIC_API_BASE_URL: "https://photos.example.test; script-src *" },
    { PUBLIC_WEB_BASE_URL: "http://photos.example.test", PUBLIC_API_BASE_URL: "http://photos.example.test" },
    { PUBLIC_WEB_BASE_URL: "https://photos.example.test", PUBLIC_API_BASE_URL: "http://photos.example.test" },
  ])("fails closed on unsafe or incompatible public origins %j", (override) => {
    const environment = { ...hosted, ...override };
    expect(browserSecurityOrigins(environment)).toBeNull();
    const csp = createBrowserCsp(nonce, environment);
    expect(directive(csp, "img-src")).toBe("img-src 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(csp).not.toContain("secret");
    expect(csp).not.toContain("script-src *");
  });

  it("accepts IPv6 loopback port separation and HTTPS canonical origins", () => {
    expect(browserSecurityOrigins({ PUBLIC_WEB_BASE_URL: "http://[::1]:3000", PUBLIC_API_BASE_URL: "http://[::1]:4000" })?.api.origin).toBe("http://[::1]:4000");
    expect(browserSecurityOrigins({ ...hosted, PUBLIC_API_BASE_URL: "https://PHOTOS.example.test:443/" })?.api.origin).toBe("https://photos.example.test");
  });

  it("does not include development loopback destinations when production public settings are missing", () => {
    for (const environment of [{ NODE_ENV: "production" }, { NODE_ENV: "production", PUBLIC_WEB_BASE_URL: hosted.PUBLIC_WEB_BASE_URL }]) {
      expect(browserSecurityOrigins(environment)).toBeNull();
      const csp = createBrowserCsp(nonce, environment);
      expect(directive(csp, "img-src")).toBe("img-src 'self'");
      expect(directive(csp, "form-action")).toBe("form-action 'self'");
      expect(csp).not.toContain("127.0.0.1");
    }
  });

  it.each(["caller-nonce", `${nonce}; script-src *`, "a".repeat(43) + "=", ""])("rejects noncanonical/injected nonce %s", (value) => {
    expect(() => createBrowserCsp(value, hosted)).toThrow("A valid request nonce is required.");
  });
});

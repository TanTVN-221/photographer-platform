import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOwnerSession, getSignInUrl } from "./owner-auth";

describe("server-side photographer session bridge (AUTH-001/004)", () => {
  const fetcher = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetcher.mockReset();
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:4000");
    vi.stubEnv("PUBLIC_API_BASE_URL", "http://127.0.0.1:4000");
    vi.stubEnv("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:3000");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("does not fetch with missing or malformed sessions", async () => {
    expect(await getOwnerSession(undefined, fetcher)).toEqual({ status: "anonymous" });
    expect(await getOwnerSession("foo; other=bar", fetcher)).toEqual({ status: "anonymous" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards only the owner cookie, disables caching, and validates the profile DTO", async () => {
    const profile = { email: "owner@example.test", displayName: "Owner" };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(profile)));
    expect(await getOwnerSession("a".repeat(43), fetcher)).toEqual({ status: "authenticated", owner: profile });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", redirect: "manual", headers: { Cookie: `pp-owner=${"a".repeat(43)}` } });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...profile, secret: "not-for-client" })));
    expect(await getOwnerSession("a".repeat(43), fetcher)).toEqual({ status: "unavailable" });
  });
  it("distinguishes revoked sessions from unavailable infrastructure", async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await getOwnerSession("a".repeat(43), fetcher)).toEqual({ status: "anonymous" });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await getOwnerSession("a".repeat(43), fetcher)).toEqual({ status: "unavailable" });
  });
  it("enables the sign-in button only when the API confirms configuration", async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ configured: false })));
    expect(await getSignInUrl(fetcher)).toBeNull();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ configured: true })));
    expect(await getSignInUrl(fetcher)).toBe("http://127.0.0.1:4000/api/v1/auth/google");
  });
});

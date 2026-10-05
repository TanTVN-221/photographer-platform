import { generateKeyPairSync, sign } from "node:crypto";

import { DRIVE_FILE_SCOPE } from "@photographer-platform/shared";
import { OAuth2Client } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDriveAuthorizationService } from "./google-drive-oauth.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const clientId = "test-client.apps.googleusercontent.com";
const provider = () => new GoogleDriveAuthorizationService(
  clientId,
  "test-secret",
  "http://127.0.0.1:4000/api/v1/drive/google/callback",
);

function idToken(claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "drive-key" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: clientId, sub: "drive-account", email: "drive@example.test",
    email_verified: true, nonce: "nonce", iat: now, exp: now + 3600, ...claims,
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  return `${header}.${body}.${signature}`;
}

function prepare(claims: Record<string, unknown> = {}, tokenOverrides: Record<string, unknown> = {}) {
  vi.spyOn(OAuth2Client.prototype, "getToken").mockResolvedValue({
    tokens: {
      refresh_token: "private-refresh-token",
      access_token: "discarded-access-token",
      id_token: idToken(claims),
      scope: `openid https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE_SCOPE}`,
      ...tokenOverrides,
    },
    res: null,
  } as never);
  vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({
    certs: { "drive-key": publicKey.export({ type: "spki", format: "pem" }).toString() },
    format: "PEM" as Awaited<ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>>["format"],
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Google Drive OAuth (DRIVE-004, SEC-002/004)", () => {
  it("requests only file-specific Drive access with offline consent and PKCE", () => {
    const url = new URL(provider().authorizationUrl({ state: "state", nonce: "nonce", challenge: "challenge", loginHint: "owner@example.test" }));
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email", DRIVE_FILE_SCOPE]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe("nonce");
    expect(url.searchParams.get("login_hint")).toBe("owner@example.test");
  });

  it("verifies the Drive account and returns only the durable grant material", async () => {
    prepare();
    await expect(provider().exchange({ code: "code", verifier: "verifier", nonce: "nonce" })).resolves.toEqual({
      googleAccountId: "drive-account",
      accountEmail: "drive@example.test",
      refreshToken: "private-refresh-token",
      grantedScopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/userinfo.email", "openid"],
    });
    expect(OAuth2Client.prototype.getToken).toHaveBeenCalledWith({ code: "code", codeVerifier: "verifier" });
  });

  it.each([
    [{ nonce: "other-browser" }, {}],
    [{ email_verified: false }, {}],
    [{ azp: "other-client" }, {}],
    [{}, { refresh_token: null }],
    [{}, { scope: "openid https://www.googleapis.com/auth/userinfo.email" }],
    [{}, { scope: `openid ${DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/drive.readonly` }],
  ])("rejects incomplete or mismatched grants with a stable error", async (claims, tokenOverrides) => {
    prepare(claims, tokenOverrides);
    await expect(provider().exchange({ code: "sensitive-code", verifier: "verifier", nonce: "nonce" }))
      .rejects.toThrow("Google Drive authorization could not be completed.");
  });

  it("refreshes and revokes through the official client without returning provider failures", async () => {
    const setCredentials = vi.spyOn(OAuth2Client.prototype, "setCredentials");
    vi.spyOn(OAuth2Client.prototype, "getAccessToken").mockResolvedValue({ token: "short-lived-access", res: null } as never);
    const revoke = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue({ data: {}, config: {}, status: 200, statusText: "OK", headers: {} } as never);
    await expect(provider().refreshAccessToken("private-refresh-token")).resolves.toBe("short-lived-access");
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: "private-refresh-token" });
    await expect(provider().revoke("private-refresh-token")).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("private-refresh-token");
  });

  it("distinguishes revoked credentials from transient refresh failures without leaking a token", async () => {
    vi.spyOn(OAuth2Client.prototype, "getAccessToken").mockRejectedValue(new Error("private-refresh-token"));
    await expect(provider().refreshAccessToken("private-refresh-token")).rejects.toThrow("temporarily unavailable");
    vi.mocked(OAuth2Client.prototype.getAccessToken).mockRejectedValueOnce({ response: { data: { error: "invalid_grant" } } });
    await expect(provider().refreshAccessToken("private-refresh-token")).rejects.toThrow("Reconnect Google Drive");
    vi.spyOn(OAuth2Client.prototype, "revokeToken").mockRejectedValue(new Error("private-refresh-token"));
    await expect(provider().revoke("private-refresh-token")).rejects.toThrow("revocation could not be confirmed");
  });
});

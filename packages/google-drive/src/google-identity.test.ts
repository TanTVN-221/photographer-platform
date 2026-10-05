import { generateKeyPairSync, sign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleIdentityService } from "./google-identity.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const clientId = "test-client.apps.googleusercontent.com";
const provider = () => new GoogleIdentityService(clientId, "test-secret", "http://127.0.0.1:4000/api/v1/auth/google/callback");

function prepare(claims: Record<string, unknown> = {}, corruptSignature = false) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: clientId, sub: "google-subject", email: "owner@example.test",
    email_verified: true, name: "Owner", nonce: "nonce", iat: now, exp: now + 3600, ...claims,
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey);
  if (corruptSignature) signature[0] = signature[0]! ^ 1;
  vi.spyOn(OAuth2Client.prototype, "getToken").mockImplementation(async () => ({
    tokens: { id_token: `${header}.${body}.${signature.toString("base64url")}` }, res: null,
  }));
  vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({
    certs: { "test-key": publicKey.export({ type: "spki", format: "pem" }).toString() },
    format: "PEM" as Awaited<ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>>["format"],
  });
}

afterEach(() => vi.restoreAllMocks());
describe("Google identity verification (AUTH-002, SEC-001/004)", () => {
  it("requests identity scopes with state, nonce and S256 PKCE only", () => {
    const url = new URL(provider().authorizationUrl({ state: "state", nonce: "nonce", challenge: "challenge" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("nonce")).toBe("nonce");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("online");
  });
  it("verifies a signed Google token and binds the nonce before returning identity", async () => {
    prepare();
    await expect(provider().exchange({ code: "code", verifier: "verifier", nonce: "nonce" })).resolves.toEqual({
      subject: "google-subject", email: "owner@example.test", displayName: "Owner",
    });
    expect(OAuth2Client.prototype.getToken).toHaveBeenCalledWith({ code: "code", codeVerifier: "verifier" });
  });
  it.each([
    { aud: "other-app" }, { iss: "https://attacker.example" }, { nonce: "other-browser" },
    { email_verified: false }, { azp: "other-app" }, { exp: Math.floor(Date.now() / 1000) - 600 },
  ])("rejects invalid identity claims without leaking the provider response", async (claims) => {
    prepare(claims);
    await expect(provider().exchange({ code: "sensitive-code", verifier: "verifier", nonce: "nonce" }))
      .rejects.toThrow("Google sign-in could not be verified.");
  });
  it("rejects an invalid RSA signature", async () => {
    prepare({}, true);
    await expect(provider().exchange({ code: "code", verifier: "verifier", nonce: "nonce" })).rejects.toThrow();
  });
});

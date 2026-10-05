import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LoginFlowCodec, readAuthCookie } from "./login-flow.js";

describe("login flow proof (AUTH-004)", () => {
  it("binds state, PKCE, client and callback and rejects tampering and expiry", () => {
    let now = 1_800_000_000_000;
    const key = randomBytes(32);
    const codec = new LoginFlowCodec(key, "client", "callback", () => now);
    const flow = codec.issue();
    const proof = codec.read(flow.cookie, flow.state)!;
    expect(proof.nonce).toBe(flow.nonce);
    expect(createHash("sha256").update(proof.verifier).digest("base64url")).toBe(flow.challenge);
    expect(flow.cookie).not.toContain(proof.verifier);
    expect(codec.read(flow.cookie, randomBytes(32).toString("base64url"))).toBeNull();
    expect(codec.read(`A${flow.cookie.slice(1)}A`, flow.state)).toBeNull();
    expect(new LoginFlowCodec(key, "other-client", "callback", () => now).read(flow.cookie, flow.state)).toBeNull();
    expect(new LoginFlowCodec(key, "client", "other-callback", () => now).read(flow.cookie, flow.state)).toBeNull();
    now += 600_000;
    expect(codec.read(flow.cookie, flow.state)).toBeNull();
  });
  it("rejects duplicate, oversized and malformed auth cookies", () => {
    expect(readAuthCookie("other=foo; pp-owner=valid", "pp-owner")).toBe("valid");
    expect(readAuthCookie("pp-owner=a; pp-owner=b", "pp-owner")).toBeNull();
    expect(readAuthCookie("pp-owner=%20a", "pp-owner")).toBeNull();
    expect(readAuthCookie(`pp-owner=${"a".repeat(9000)}`, "pp-owner")).toBeNull();
  });
});

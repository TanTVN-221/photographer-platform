import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DRIVE_FLOW_MAX_AGE_SECONDS, DriveFlowCodec } from "./drive-flow.js";

const key = randomBytes(32);
const codec = (now = 1_000_000) => new DriveFlowCodec(key, "client", "https://photos.test/callback", () => now);

describe("owner-bound Drive callback flow (DRIVE-004, AUTH-004)", () => {
  it("round-trips state proof only for the owner that started it", () => {
    const issued = codec().issue("owner-1");
    expect(codec().read(issued.cookie, issued.state, "owner-1")).toMatchObject({ nonce: issued.nonce });
    expect(codec().read(issued.cookie, issued.state, "owner-2")).toBeNull();
    // Always change a character: a random state can already end in A.
    const alteredState = `${issued.state[0] === "A" ? "B" : "A"}${issued.state.slice(1)}`;
    expect(alteredState).not.toBe(issued.state);
    expect(codec().read(issued.cookie, alteredState, "owner-1")).toBeNull();
    expect(issued.cookie).not.toContain("owner-1");
  });

  it("rejects tampering, expiry, and a different callback binding", () => {
    const issued = codec().issue("owner-1");
    const altered = `${issued.cookie.slice(0, -1)}${issued.cookie.at(-1) === "A" ? "B" : "A"}`;
    expect(codec().read(altered, issued.state, "owner-1")).toBeNull();
    expect(codec(1_000_000 + DRIVE_FLOW_MAX_AGE_SECONDS * 1000).read(issued.cookie, issued.state, "owner-1")).toBeNull();
    expect(new DriveFlowCodec(key, "client", "https://other.test/callback", () => 1_000_000)
      .read(issued.cookie, issued.state, "owner-1")).toBeNull();
  });
});

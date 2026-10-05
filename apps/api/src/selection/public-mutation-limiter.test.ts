import { describe, expect, it } from "vitest";

import { PublicMutationLimiter } from "./public-mutation-limiter.js";

describe("public selection mutation limiter (SEC-003)", () => {
  it("caps one client/gallery at 60 mutations per minute and resets", () => {
    let now = 1_000;
    const limiter = new PublicMutationLimiter(() => now);
    for (let index = 0; index < 60; index += 1) expect(limiter.check("ip", "gallery-a")).toBeNull();
    expect(limiter.check("ip", "gallery-a")).toBe(60);
    expect(limiter.check("ip", "gallery-b")).toBeNull();
    now += 60_000;
    expect(limiter.check("ip", "gallery-a")).toBeNull();
  });
});

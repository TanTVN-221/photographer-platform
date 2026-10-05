import { describe, expect, it } from "vitest";

import { PasswordAttemptLimiter } from "./password-attempt-limiter.js";

describe("pilot password attempt limiter (SEC-003)", () => {
  it("allows at most five attempts per client/gallery window", () => {
    let now = 1_000;
    const limiter = new PasswordAttemptLimiter(() => now);
    for (let index = 0; index < 5; index += 1) {
      const permit = limiter.acquire("127.0.0.1", "gallery-a");
      expect(permit.allowed).toBe(true);
      if (permit.allowed) permit.release();
    }
    expect(limiter.acquire("127.0.0.1", "gallery-a")).toMatchObject({ allowed: false, retryAfterSeconds: 900 });
    const other = limiter.acquire("127.0.0.1", "gallery-b");
    expect(other.allowed).toBe(true);
    if (other.allowed) other.release();
    now += 15 * 60 * 1000;
    const renewed = limiter.acquire("127.0.0.1", "gallery-a");
    expect(renewed.allowed).toBe(true);
    if (renewed.allowed) renewed.release();
  });

  it("caps concurrent expensive verifications and releases only once", () => {
    const limiter = new PasswordAttemptLimiter();
    const permits = Array.from({ length: 4 }, (_, index) => limiter.acquire(`ip-${index}`, "gallery"));
    expect(permits.every((permit) => permit.allowed)).toBe(true);
    expect(limiter.acquire("ip-5", "gallery")).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    const first = permits[0]!;
    if (first.allowed) { first.release(); first.release(); }
    const next = limiter.acquire("ip-5", "gallery");
    expect(next.allowed).toBe(true);
    if (next.allowed) next.release();
    for (const permit of permits.slice(1)) if (permit.allowed) permit.release();
  });
});

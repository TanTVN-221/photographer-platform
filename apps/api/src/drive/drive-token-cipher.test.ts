import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DriveTokenCipher } from "./drive-token-cipher.js";

describe("Drive refresh-token encryption (DRIVE-004, SEC-002)", () => {
  it("encrypts nondeterministically and binds ciphertext to owner/account/version", () => {
    const cipher = new DriveTokenCipher(randomBytes(32), "v1");
    const first = cipher.encrypt("private-refresh-token", "owner-1", "account-1");
    const second = cipher.encrypt("private-refresh-token", "owner-1", "account-1");
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    expect(Buffer.from(first).toString("utf8")).not.toContain("private-refresh-token");
    expect(cipher.decrypt(first, "v1", "owner-1", "account-1")).toBe("private-refresh-token");
    expect(() => cipher.decrypt(first, "v1", "owner-2", "account-1")).toThrow();
    expect(() => cipher.decrypt(first, "v2", "owner-1", "account-1")).toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { hashGalleryPassword, verifyGalleryPassword } from "./gallery-password.js";

describe("gallery password storage boundary (GAL-002/003, SEC-001/003)", () => {
  it("uses unique salted hashes and verifies only the exact password", async () => {
    const password = "Ảnh cưới 2026 🔒";
    const first = await hashGalleryPassword(password);
    const second = await hashGalleryPassword(password);
    expect(first).toMatch(/^scrypt\$v1\$32768\$8\$3\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
    expect(first).not.toContain(password);
    expect(await verifyGalleryPassword(password, first)).toBe(true);
    expect(await verifyGalleryPassword("Ảnh cưới 2026", first)).toBe(false);
    expect(await verifyGalleryPassword(password, second)).toBe(true);
  }, 15_000);

  it("rejects empty and oversized inputs without creating a hash", async () => {
    await expect(hashGalleryPassword("")).rejects.toThrow();
    await expect(hashGalleryPassword("a".repeat(1025))).rejects.toThrow();
    await expect(hashGalleryPassword(null)).rejects.toThrow();
    expect(await verifyGalleryPassword("", "anything")).toBe(false);
    expect(await verifyGalleryPassword("a".repeat(1025), "anything")).toBe(false);
  });

  it("fails closed for malformed, noncanonical, or parameter-amplifying stored values", async () => {
    const valid = await hashGalleryPassword("private");
    const parts = valid.split("$");
    const malformed = [
      null,
      "private",
      valid.replace("$32768$", "$1073741824$"),
      valid.replace("scrypt$v1", "scrypt$v2"),
      `${valid}$extra`,
      [...parts.slice(0, 5), "%%%", parts[6]].join("$"),
      [...parts.slice(0, 6), `${parts[6]}=`].join("$"),
    ];
    for (const value of malformed) {
      expect(await verifyGalleryPassword("private", value)).toBe(false);
    }
  }, 15_000);
});

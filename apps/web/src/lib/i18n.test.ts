import { describe, expect, it } from "vitest";

import { galleryCopy, isLocale, pageCopy, resolveLocale } from "./i18n";
import { authCopy } from "./auth-copy";

describe("web localization", () => {
  it("defaults to English when the cookie is absent or invalid", () => {
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale("vi")).toBe("vi");
  });

  it("accepts only supported locale values", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("vi")).toBe(true);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale("en-US")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("has complete, distinct copy for both languages", () => {
    expect(Object.keys(pageCopy.en).sort()).toEqual(Object.keys(pageCopy.vi).sort());
    expect(pageCopy.en.workflow).toHaveLength(3);
    expect(pageCopy.vi.workflow).toHaveLength(3);
    expect(pageCopy.en.hero).not.toBe(pageCopy.vi.hero);
    expect(pageCopy.vi.formatsUnavailable).toContain("API");
    expect(Object.keys(galleryCopy.en).sort()).toEqual(Object.keys(galleryCopy.vi).sort());
    expect(Object.keys(galleryCopy.en.states).sort()).toEqual(Object.keys(galleryCopy.vi.states).sort());
    expect(Object.keys(galleryCopy.en.previewStatus).sort()).toEqual(Object.keys(galleryCopy.vi.previewStatus).sort());
    expect(galleryCopy.en.galleryDescription).not.toBe(galleryCopy.vi.galleryDescription);
    expect(galleryCopy.en.openPreview("IMG_1.CR3")).not.toBe(galleryCopy.vi.openPreview("IMG_1.CR3"));
    expect(Object.keys(galleryCopy.en.unlockErrors).sort()).toEqual(Object.keys(galleryCopy.vi.unlockErrors).sort());
    expect(galleryCopy.en.passwordLabel).not.toBe(galleryCopy.vi.passwordLabel);
    expect(Object.keys(authCopy.en).sort()).toEqual(Object.keys(authCopy.vi).sort());
    expect(authCopy.en.signin).not.toBe(authCopy.vi.signin);
  });
});

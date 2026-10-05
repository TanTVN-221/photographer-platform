import { beforeEach, describe, expect, it, vi } from "vitest";

const { setCookie } = vi.hoisted(() => ({ setCookie: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie }),
}));

import { LOCALE_COOKIE } from "../lib/i18n";
import { setLanguage } from "./actions";

describe("setLanguage", () => {
  beforeEach(() => {
    setCookie.mockClear();
  });

  it.each(["en", "vi"])("persists the supported %s language", async (locale) => {
    const formData = new FormData();
    formData.set("locale", locale);

    await setLanguage(formData);

    expect(setCookie).toHaveBeenCalledOnce();
    expect(setCookie).toHaveBeenCalledWith(
      LOCALE_COOKIE,
      locale,
      expect.objectContaining({
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
        sameSite: "lax",
      }),
    );
  });

  it("does not set a cookie for an invalid language", async () => {
    const formData = new FormData();
    formData.set("locale", "fr");

    await setLanguage(formData);

    expect(setCookie).not.toHaveBeenCalled();
  });
});

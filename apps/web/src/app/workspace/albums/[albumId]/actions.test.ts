import { beforeEach, describe, expect, it, vi } from "vitest";
const { change, readCookie } = vi.hoisted(() => ({ change: vi.fn(), readCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: readCookie }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("../../../../lib/workspace-api", () => ({ changeOwnerAlbum: change }));
import { updateAlbum } from "./actions";

function form(action: string, confirmation?: string) {
  const data = new FormData(); data.set("albumId", "album"); data.set("action", action);
  if (confirmation !== undefined) data.set("confirmation", confirmation);
  return data;
}
describe("owner album server actions (ALB-006, AUTH-004, SEL-003)", () => {
  beforeEach(() => { change.mockReset().mockResolvedValue("success"); readCookie.mockReset().mockReturnValue({ value: "a".repeat(43) }); });
  it.each(["archive", "reopen"])("requires explicit %s confirmation before calling API", async (action) => {
    await expect(updateAlbum(form(action))).rejects.toThrow("redirect:/workspace/albums/album?notice=failed");
    expect(change).not.toHaveBeenCalled();
    await expect(updateAlbum(form(action, action))).rejects.toThrow("redirect:/workspace/albums/album?notice=changed");
    expect(change).toHaveBeenCalledWith("album", action, "a".repeat(43));
    expect(readCookie).toHaveBeenCalledWith("pp-owner");
  });
  it("supports lock and handles expiry/backend failure with fixed local redirects", async () => {
    await expect(updateAlbum(form("lock"))).rejects.toThrow("redirect:/workspace/albums/album?notice=changed");
    change.mockResolvedValueOnce("anonymous");
    await expect(updateAlbum(form("lock"))).rejects.toThrow("redirect:/signin");
    change.mockResolvedValueOnce("failed");
    await expect(updateAlbum(form("lock"))).rejects.toThrow("redirect:/workspace/albums/album?notice=failed");
  });
  it("rejects unknown actions and unsafe album IDs without network work", async () => {
    await expect(updateAlbum(form("delete"))).rejects.toThrow("redirect:/workspace");
    const unsafe = form("archive", "archive"); unsafe.set("albumId", "../other");
    await expect(updateAlbum(unsafe)).rejects.toThrow("redirect:/workspace");
    expect(change).not.toHaveBeenCalled();
  });
});

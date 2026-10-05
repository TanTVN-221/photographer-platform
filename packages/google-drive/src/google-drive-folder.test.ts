import { describe, expect, it, vi } from "vitest";
import { GoogleDriveService } from "./google-drive-service.js";

const folder = { id: "folder_123", name: "Client album", mimeType: "application/vnd.google-apps.folder",
  trashed: false, capabilities: { canListChildren: true } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture(responses = [json(folder)]) {
  const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => {
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected extra request");
    return response;
  });
  const getAccessToken = vi.fn(async () => "private-token");
  const sleep = vi.fn(async (_ms: number) => undefined);
  const onEvent = vi.fn();
  const service = new GoogleDriveService({ fetchImpl, getAccessToken, sleep, random: () => 0, onEvent });
  return { service, fetchImpl, getAccessToken, sleep, onEvent };
}

describe("accessible folder metadata (ALB-001, DRIVE-003/014/015)", () => {
  it("reads only folder metadata with a narrow projection and no redirects/content/listing", async () => {
    const { service, fetchImpl, onEvent } = fixture([json({ ...folder, privateUnknown: "not-returned" })]);
    await expect(service.readAccessibleFolder("folder_123")).resolves.toEqual({ folderId: "folder_123", name: folder.name });
    const [url, init] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe("https://www.googleapis.com");
    expect(parsed.pathname).toBe("/drive/v3/files/folder_123");
    expect([...parsed.searchParams.keys()].sort()).toEqual(["fields", "supportsAllDrives"]);
    expect(parsed.searchParams.get("fields")).toBe("id,name,mimeType,trashed,capabilities(canListChildren)");
    expect(parsed.searchParams.get("supportsAllDrives")).toBe("true");
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "Bearer private-token" } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ operation: "files.get", outcome: "success" }));
    expect(JSON.stringify(onEvent.mock.calls)).not.toMatch(/private-token|folder_123|Client album/);
  });
  it.each(["", "x' or trashed = true", "folder/id", "https://drive.google.com/folders/id", "a".repeat(257)])(
    "rejects invalid identifiers before tokens or requests: %s", async (id) => {
      const { service, getAccessToken, fetchImpl } = fixture();
      await expect(service.readAccessibleFolder(id)).rejects.toMatchObject({ code: "invalid-request" });
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  it.each([
    [{ ...folder, id: "another" }, "invalid-response"],
    [{ ...folder, trashed: true }, "not-found"],
    [{ ...folder, mimeType: "image/jpeg" }, "invalid-request"],
    [{ ...folder, mimeType: "application/vnd.google-apps.shortcut" }, "invalid-request"],
    [{ ...folder, capabilities: { canListChildren: false } }, "permission"],
    [{ ...folder, capabilities: {} }, "permission"],
    [{ ...folder, capabilities: undefined }, "permission"],
    [{ ...folder, trashed: undefined }, "invalid-response"],
    [{ ...folder, capabilities: { canListChildren: "true" } }, "invalid-response"],
  ])("fails closed for unavailable or invalid folder metadata %#", async (response, code) => {
    const { service } = fixture([json(response)]);
    await expect(service.readAccessibleFolder("folder_123")).rejects.toMatchObject({ code });
  });
  it.each([[401, "authentication"], [403, "permission"], [404, "not-found"], [400, "invalid-request"]])(
    "does not retry non-transient status %s", async (status, code) => {
      const { service, fetchImpl, sleep } = fixture([json({ error: { message: "private detail" } }, status as number)]);
      await expect(service.readAccessibleFolder("folder_123")).rejects.toMatchObject({ code });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  it("preserves quota categorization without retry or provider details", async () => {
    const { service, sleep } = fixture([json({ error: { message: "private detail", errors: [{ reason: "dailyLimitExceeded" }] } }, 403)]);
    await expect(service.readAccessibleFolder("folder_123")).rejects.toMatchObject({ code: "quota" });
    expect(sleep).not.toHaveBeenCalled();
  });
  it("bounds rate-limit retries and never emits credentials", async () => {
    const { service, fetchImpl, sleep, onEvent } = fixture(Array.from({ length: 4 }, () => json({}, 429)));
    await expect(service.readAccessibleFolder("folder_123")).rejects.toMatchObject({ code: "rate-limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500, 1000]);
    expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual(["retry", "retry", "retry", "error"]);
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("private-token");
  });
  it("recovers from a safe transient error", async () => {
    const { service, fetchImpl } = fixture([json({}, 503), json(folder)]);
    await expect(service.readAccessibleFolder("folder_123")).resolves.toEqual({ folderId: folder.id, name: folder.name });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("cancels before token access, after refresh, and after the metadata read", async () => {
    const before = fixture();
    await expect(before.service.readAccessibleFolder("folder_123", AbortSignal.abort())).rejects.toMatchObject({ code: "cancelled" });
    expect(before.getAccessToken).not.toHaveBeenCalled();
    const during = fixture();
    const controller = new AbortController();
    during.getAccessToken.mockImplementation(async () => { controller.abort(); return "private-token"; });
    await expect(during.service.readAccessibleFolder("folder_123", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(during.fetchImpl).not.toHaveBeenCalled();
    const after = fixture();
    const afterController = new AbortController();
    after.fetchImpl.mockImplementation(async () => { afterController.abort(); return json(folder); });
    await expect(after.service.readAccessibleFolder("folder_123", afterController.signal)).rejects.toMatchObject({ code: "cancelled" });
  });
  it("redacts refresh failures without retry", async () => {
    const { service, getAccessToken, fetchImpl } = fixture();
    getAccessToken.mockRejectedValue(new Error("private refresh detail"));
    await expect(service.readAccessibleFolder("folder_123")).rejects.toMatchObject({ code: "authentication" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import { GoogleDriveService } from "./google-drive-service.js";
import { DriveProviderError } from "./types.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function serviceWithResponses(responses: Response[]) {
  const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected extra page request");
    }
    return response;
  });
  const sleep = vi.fn(async (_milliseconds: number) => undefined);
  const onEvent = vi.fn();
  const service = new GoogleDriveService({
    getAccessToken: async () => "secret-access-token",
    fetchImpl,
    sleep,
    random: () => 0,
    onEvent,
  });
  return { service, fetchImpl, sleep, onEvent };
}

describe("GoogleDriveService.listDirectChildImages", () => {
  it("fetches every direct-child page with narrow fields and classifies images", async () => {
    const { service, fetchImpl, onEvent } = serviceWithResponses([
      jsonResponse({
        nextPageToken: "page-2",
        files: [
          {
            id: "image-2",
            name: "IMG_2.CR3",
            mimeType: "application/octet-stream",
            size: "9007199254740993",
            version: "7",
            imageMediaMetadata: { width: 6000, height: 4000, rotation: 1 },
          },
          { id: "notes", name: "notes.txt", mimeType: "text/plain" },
          {
            id: "document",
            name: "fake.jpg",
            mimeType: "application/vnd.google-apps.document",
          },
        ],
      }),
      jsonResponse({
        files: [
          {
            id: "image-10",
            name: "IMG_10.JPG",
            mimeType: "image/jpeg",
            createdTime: "2026-01-02T03:04:05Z",
          },
          { id: "image-2", name: "IMG_2.CR3", mimeType: "application/octet-stream" },
        ],
      }),
    ]);

    const result = await service.listDirectChildImages("folder_123");

    expect(result.pageCount).toBe(2);
    expect(result.skippedCount).toBe(2);
    expect(result.images.map((image) => image.driveFileId)).toEqual(["image-2", "image-10"]);
    expect(result.images[0]?.formatId).toBe("cr3");
    expect(result.images[0]?.classificationWarnings).toContain("generic-mime-type");
    expect(result.images[1]?.createdTime).toBe("2026-01-02T03:04:05Z");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    const secondUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(firstUrl.searchParams.get("q")).toBe("'folder_123' in parents and trashed = false");
    expect(firstUrl.searchParams.get("pageSize")).toBe("1000");
    expect(firstUrl.searchParams.get("orderBy")).toBe("name_natural");
    expect(firstUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(firstUrl.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(firstUrl.searchParams.get("fields")).toContain("nextPageToken");
    expect(firstUrl.searchParams.get("fields")).not.toContain("location");
    expect(secondUrl.searchParams.get("pageToken")).toBe("page-2");
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("secret-access-token");
  });

  it("completes a 10,000-image folder without stopping after an early page", async () => {
    const pages = Array.from({ length: 10 }, (_, pageIndex) =>
      jsonResponse({
        ...(pageIndex < 9 ? { nextPageToken: `page-${pageIndex + 2}` } : {}),
        files: Array.from({ length: 1000 }, (_, itemIndex) => ({
          id: `photo-${pageIndex * 1000 + itemIndex}`,
          name: `IMG_${pageIndex * 1000 + itemIndex}.jpg`,
          mimeType: "image/jpeg",
        })),
      }),
    );
    const { service, fetchImpl } = serviceWithResponses(pages);

    const catalog = await service.listDirectChildImages("folder123");

    expect(catalog.pageCount).toBe(10);
    expect(catalog.images).toHaveLength(10_000);
    expect(catalog.skippedCount).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("rejects an invalid folder ID before calling Drive", async () => {
    const { service, fetchImpl } = serviceWithResponses([]);
    await expect(service.listDirectChildImages("x' or trashed = true")).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a rate-limited read with bounded backoff", async () => {
    const { service, fetchImpl, sleep, onEvent } = serviceWithResponses([
      jsonResponse({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403),
      jsonResponse({ files: [] }),
    ]);

    await expect(service.listDirectChildImages("folder123")).resolves.toMatchObject({
      pageCount: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      outcome: "retry",
      category: "rate-limit",
      attempt: 1,
    });
  });

  it("stops after four transient attempts", async () => {
    const { service, fetchImpl, sleep } = serviceWithResponses(
      Array.from({ length: 4 }, () => jsonResponse({ error: {} }, 503)),
    );

    await expect(service.listDirectChildImages("folder123")).rejects.toMatchObject({
      code: "transient",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500, 1000]);
  });

  it("does not retry authentication or quota failures and never exposes provider text", async () => {
    const { service, fetchImpl, sleep } = serviceWithResponses([
      jsonResponse({ error: { errors: [{ reason: "invalidCredentials" }], message: "secret-value" } }, 401),
    ]);

    let error: unknown;
    try {
      await service.listDirectChildImages("folder123");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DriveProviderError);
    expect(error).toMatchObject({ code: "authentication", retryable: false, httpStatus: 401 });
    expect(String(error)).not.toContain("secret-value");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();

    const quota = serviceWithResponses([
      jsonResponse({ error: { errors: [{ reason: "dailyLimitExceeded" }] } }, 403),
    ]);
    await expect(quota.service.listDirectChildImages("folder123")).rejects.toMatchObject({
      code: "quota",
      retryable: false,
    });
    expect(quota.fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects malformed or incomplete listings rather than returning partial results", async () => {
    const malformed = serviceWithResponses([
      jsonResponse({ files: [{ name: "IMG_1.jpg", mimeType: "image/jpeg" }] }),
    ]);
    await expect(malformed.service.listDirectChildImages("folder123")).rejects.toMatchObject({
      code: "invalid-response",
    });

    const incomplete = serviceWithResponses([
      jsonResponse({ files: [{ id: "photo", name: "IMG_1.jpg", mimeType: "image/jpeg" }], incompleteSearch: true }),
    ]);
    await expect(incomplete.service.listDirectChildImages("folder123")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("detects repeated page tokens before an infinite loop", async () => {
    const { service, fetchImpl } = serviceWithResponses([
      jsonResponse({ nextPageToken: "repeat", files: [] }),
      jsonResponse({ nextPageToken: "repeat", files: [] }),
    ]);
    await expect(service.listDirectChildImages("folder123")).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("restarts once from the first page when Drive rejects a continuation token", async () => {
    const { service, fetchImpl } = serviceWithResponses([
      jsonResponse({ nextPageToken: "stale", files: [{ id: "old", name: "old.jpg", mimeType: "image/jpeg" }] }),
      jsonResponse({ error: { errors: [{ reason: "invalidPageToken" }] } }, 400),
      jsonResponse({ files: [{ id: "new", name: "new.jpg", mimeType: "image/jpeg" }] }),
    ]);

    const catalog = await service.listDirectChildImages("folder123");

    expect(catalog.images.map((image) => image.driveFileId)).toEqual(["new"]);
    expect(catalog.pageCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetchImpl.mock.calls[2]?.[0])).searchParams.has("pageToken")).toBe(false);
  });

  it("cancels before requesting a page when the caller has aborted", async () => {
    const { service, fetchImpl } = serviceWithResponses([]);
    const controller = new AbortController();
    controller.abort();
    await expect(service.listDirectChildImages("folder123", controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

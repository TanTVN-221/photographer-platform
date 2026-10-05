import { DriveProviderError, type OriginalImageReader } from "@photographer-platform/google-drive";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { PreviewPreparationError, preparePreview, type PreviewCandidate } from "./prepare-preview.js";

const candidate: PreviewCandidate = {
  photoId: "photo_123",
  driveFileId: "drive_123",
  folderId: "folder_123",
  fileName: "IMG_001.jpg",
  mimeType: "image/jpeg",
  sourceRevision: "version:5",
};

function readerWithResult(result: Awaited<ReturnType<OriginalImageReader["readOriginalImage"]>>): OriginalImageReader {
  return { readOriginalImage: vi.fn().mockResolvedValue(result) };
}

describe("trusted preview preparation (DRIVE-016/017/018, IMG-001/004/006/007)", () => {
  it("returns two revision-bound WebP derivatives without returning original bytes", async () => {
    const originalBytes = await sharp({
      create: { width: 900, height: 450, channels: 3, background: "#75452c" },
    }).jpeg().toBuffer();
    const reader = readerWithResult({ bytes: originalBytes, mimeType: candidate.mimeType, sourceRevision: candidate.sourceRevision });

    const result = await preparePreview(candidate, reader);

    expect(reader.readOriginalImage).toHaveBeenCalledWith({
      driveFileId: candidate.driveFileId,
      folderId: candidate.folderId,
      expectedRevision: candidate.sourceRevision,
    }, undefined);
    expect(result).toMatchObject({ status: "ready", photoId: candidate.photoId, sourceRevision: candidate.sourceRevision });
    if (result.status !== "ready") return;
    expect(Object.keys(result).sort()).toEqual(["photoId", "preview", "sourceRevision", "status", "thumbnail"]);
    expect(result.thumbnail.bytes).not.toEqual(originalBytes);
    expect(result.preview.bytes).not.toEqual(originalBytes);
    expect(await sharp(result.thumbnail.bytes).metadata()).toMatchObject({ format: "webp", width: 512, height: 256 });
    expect(await sharp(result.preview.bytes).metadata()).toMatchObject({ format: "webp", width: 900, height: 450 });
  });

  it.each([
    ["RAW", "camera.cr3", "application/octet-stream"],
    ["HEIC", "phone.heic", "image/heic"],
  ])("does not download a known unsupported %s original", async (_label, fileName, mimeType) => {
    const reader = readerWithResult({ bytes: Buffer.from("unread"), mimeType, sourceRevision: candidate.sourceRevision });
    await expect(preparePreview({ ...candidate, fileName, mimeType }, reader)).resolves.toEqual({
      status: "unsupported-variant", photoId: candidate.photoId, code: "decoder-not-enabled",
    });
    expect(reader.readOriginalImage).not.toHaveBeenCalled();
  });

  it("rejects unrecognized metadata before downloading", async () => {
    const reader = readerWithResult({ bytes: Buffer.from("unread"), mimeType: "text/plain", sourceRevision: candidate.sourceRevision });
    await expect(preparePreview({ ...candidate, fileName: "notes.txt", mimeType: "text/plain" }, reader)).resolves.toEqual({
      status: "failed", photoId: candidate.photoId, code: "unrecognized-source",
    });
    expect(reader.readOriginalImage).not.toHaveBeenCalled();
  });

  it.each([
    ["revision", { sourceRevision: "version:6" }],
    ["MIME", { mimeType: "image/png" }],
  ])("does not render when reader %s differs from the indexed candidate", async (_label, change) => {
    const reader = readerWithResult({ bytes: Buffer.from("unread"), mimeType: candidate.mimeType, sourceRevision: candidate.sourceRevision, ...change });
    await expect(preparePreview(candidate, reader)).resolves.toEqual({
      status: "stale-source", photoId: candidate.photoId, code: "metadata-changed",
    });
  });

  it.each([
    ["source-too-large", "unsupported-variant", "source-too-large"],
    ["stale-source", "stale-source", "source-changed"],
    ["not-found", "stale-source", "source-missing"],
    ["authentication", "deferred", "authentication"],
    ["permission", "deferred", "permission"],
    ["quota", "deferred", "quota"],
    ["rate-limit", "deferred", "rate-limit"],
    ["transient", "deferred", "transient"],
    ["cancelled", "deferred", "cancelled"],
    ["invalid-response", "failed", "provider-response"],
  ] as const)("maps %s to safe per-photo %s outcome", async (providerCode, status, code) => {
    const reader: OriginalImageReader = {
      readOriginalImage: vi.fn().mockRejectedValue(new DriveProviderError(providerCode, "private provider detail")),
    };
    const result = await preparePreview(candidate, reader);
    expect(result).toEqual({ status, photoId: candidate.photoId, code });
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });

  it("keeps a corrupt photo failure local to that photo", async () => {
    const goodBytes = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "red" },
    }).jpeg().toBuffer();
    const reader: OriginalImageReader = {
      readOriginalImage: vi.fn()
        .mockResolvedValueOnce({ bytes: Buffer.from("not a jpeg"), mimeType: candidate.mimeType, sourceRevision: candidate.sourceRevision })
        .mockResolvedValueOnce({ bytes: goodBytes, mimeType: candidate.mimeType, sourceRevision: candidate.sourceRevision }),
    };
    expect(await preparePreview(candidate, reader)).toEqual({ status: "failed", photoId: candidate.photoId, code: "invalid-source" });
    expect(await preparePreview({ ...candidate, photoId: "photo_456" }, reader)).toMatchObject({ status: "ready", photoId: "photo_456" });
  });

  it("validates an internal candidate before any Drive read", async () => {
    const reader = readerWithResult({ bytes: Buffer.from("unread"), mimeType: candidate.mimeType, sourceRevision: candidate.sourceRevision });
    await expect(preparePreview({ ...candidate, driveFileId: "bad/id" }, reader)).rejects.toBeInstanceOf(PreviewPreparationError);
    expect(reader.readOriginalImage).not.toHaveBeenCalled();
  });

  it("avoids opening the reader when already cancelled", async () => {
    const reader: OriginalImageReader = {
      readOriginalImage: vi.fn().mockRejectedValue(new DriveProviderError("cancelled", "cancelled")),
    };
    const controller = new AbortController();
    controller.abort();
    await expect(preparePreview(candidate, reader, controller.signal)).resolves.toEqual({
      status: "deferred", photoId: candidate.photoId, code: "cancelled",
    });
    expect(reader.readOriginalImage).not.toHaveBeenCalled();
  });

  it("forwards an active signal and stops if cancelled during the original read", async () => {
    const controller = new AbortController();
    const reader: OriginalImageReader = {
      readOriginalImage: vi.fn(async () => {
        controller.abort();
        return { bytes: Buffer.from("not decoded"), mimeType: candidate.mimeType, sourceRevision: candidate.sourceRevision };
      }),
    };
    expect(await preparePreview(candidate, reader, controller.signal)).toEqual({ status: "deferred", photoId: candidate.photoId, code: "cancelled" });
    expect(reader.readOriginalImage).toHaveBeenCalledWith(expect.any(Object), controller.signal);
  });
});

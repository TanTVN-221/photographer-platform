import { PreviewStatus } from "@photographer-platform/database";
import type { DirectChildImageCatalog, DriveImageMetadata } from "@photographer-platform/google-drive";
import { describe, expect, it } from "vitest";

import { planAlbumReconciliation, type ExistingCatalogPhoto } from "./reconciliation.js";

function image(driveFileId: string, fileName: string): DriveImageMetadata {
  return {
    driveFileId,
    fileName,
    mimeType: "image/jpeg",
    formatId: "jpeg",
    supportLevel: "guaranteed",
    classificationWarnings: [],
    width: 3000,
    height: 2000,
    rotation: null,
    sizeBytes: "1000",
    createdTime: "2026-01-01T00:00:00Z",
    modifiedTime: "2026-01-02T00:00:00Z",
    md5Checksum: "first-hash",
    driveVersion: "1",
  };
}

function catalog(images: readonly DriveImageMetadata[], skippedCount = 0): DirectChildImageCatalog {
  return { images, skippedCount, pageCount: 2 };
}

function existing(
  driveFileId: string,
  fileName: string,
  overrides: Partial<ExistingCatalogPhoto> = {},
): ExistingCatalogPhoto {
  return {
    id: `photo-${driveFileId}`,
    driveFileId,
    fileName,
    mimeType: "image/jpeg",
    formatId: "jpeg",
    width: 3000,
    height: 2000,
    sizeBytes: 1000n,
    driveCreatedTime: new Date("2026-01-01T00:00:00Z"),
    driveModifiedTime: new Date("2026-01-02T00:00:00Z"),
    driveVersion: "1",
    md5Checksum: "first-hash",
    sourceRevision: "md5:first-hash",
    sortOrder: 0,
    active: true,
    previewStatus: PreviewStatus.READY,
    previewRevision: "md5:first-hash",
    ...overrides,
  };
}

describe("album catalog reconciliation (DRIVE-007–009, DRIVE-013, DRIVE-018)", () => {
  it("creates new photos in natural filename order with source revision", () => {
    const plan = planAlbumReconciliation(
      catalog([image("ten", "IMG_10.jpg"), image("two", "IMG_2.jpg")], 3),
      [],
    );

    expect(plan.created.map(({ driveFileId, fields }) => [driveFileId, fields.sortOrder])).toEqual([
      ["two", 0],
      ["ten", 1],
    ]);
    expect(plan.created[0]?.fields.sourceRevision).toBe("md5:first-hash");
    expect(plan.skippedCount).toBe(3);
    expect(plan.unchangedCount).toBe(0);
    expect(plan.catalogChanged).toBe(true);
  });

  it("is a no-op for a repeated complete catalog", () => {
    const plan = planAlbumReconciliation(catalog([image("a", "IMG_1.jpg")]), [
      existing("a", "IMG_1.jpg"),
    ]);

    expect(plan.created).toEqual([]);
    expect(plan.updated).toEqual([]);
    expect(plan.removedIds).toEqual([]);
    expect(plan.unchangedCount).toBe(1);
    expect(plan.catalogChanged).toBe(false);
  });

  it("reactivates returned photos and soft-removes only missing active photos", () => {
    const plan = planAlbumReconciliation(catalog([image("return", "IMG_1.jpg")]), [
      existing("return", "IMG_1.jpg", { active: false }),
      existing("missing", "IMG_2.jpg", { sortOrder: 1 }),
      existing("already-removed", "IMG_3.jpg", { active: false, sortOrder: 2 }),
    ]);

    expect(plan.updated.map(({ id }) => id)).toEqual(["photo-return"]);
    expect(plan.removedIds).toEqual(["photo-missing"]);
    expect(plan.created).toEqual([]);
  });

  it("invalidates previews when source content changes but retains them for a filename rename", () => {
    const changed = { ...image("a", "IMG_1.jpg"), md5Checksum: "new-hash" };
    const changedPlan = planAlbumReconciliation(catalog([changed]), [
      existing("a", "IMG_1.jpg"),
    ]);
    expect(changedPlan.updated[0]?.invalidatePreview).toBe(true);
    expect(changedPlan.updated[0]?.fields.sourceRevision).toBe("md5:new-hash");

    const renamedPlan = planAlbumReconciliation(catalog([image("a", "RENAMED.jpg")]), [
      existing("a", "IMG_1.jpg"),
    ]);
    expect(renamedPlan.updated[0]?.invalidatePreview).toBe(false);
  });

  it("conservatively invalidates ready previews when no source revision is available", () => {
    const unknown = {
      ...image("a", "IMG_1.jpg"),
      md5Checksum: null,
      driveVersion: null,
      modifiedTime: null,
      sizeBytes: null,
    };
    const old = existing("a", "IMG_1.jpg", {
      sizeBytes: null,
      driveModifiedTime: null,
      md5Checksum: null,
      driveVersion: null,
      sourceRevision: null,
      previewRevision: null,
    });
    expect(planAlbumReconciliation(catalog([unknown]), [old]).updated[0]?.invalidatePreview).toBe(
      true,
    );
  });

  it("rejects incomplete catalogs, duplicate identities, and out-of-range sizes", () => {
    expect(() =>
      planAlbumReconciliation({ images: [], skippedCount: 0, pageCount: 0 }, []),
    ).toThrow("incomplete");
    expect(() => planAlbumReconciliation(catalog([image("a", "1"), image("a", "2")]), [])).toThrow(
      "Duplicate Drive file ID",
    );
    expect(() =>
      planAlbumReconciliation(catalog([{ ...image("a", "1"), sizeBytes: "9223372036854775808" }]), []),
    ).toThrow("bigint range");
  });
});

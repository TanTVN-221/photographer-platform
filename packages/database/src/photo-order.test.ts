import { describe, expect, it } from "vitest";

import { assignPhotoSortOrders, comparePhotosByNaturalName } from "./photo-order.js";

describe("materialized natural photo order", () => {
  it("sorts numeric filename runs naturally", () => {
    const ordered = assignPhotoSortOrders([
      { driveFileId: "ten", fileName: "IMG_10.jpg" },
      { driveFileId: "two", fileName: "IMG_2.jpg" },
      { driveFileId: "one", fileName: "IMG_1.jpg" },
    ]);

    expect(ordered.map(({ driveFileId, sortOrder }) => [driveFileId, sortOrder])).toEqual([
      ["one", 0],
      ["two", 1],
      ["ten", 2],
    ]);
  });

  it("uses exact names and Drive IDs as deterministic tie-breakers", () => {
    const photos = [
      { driveFileId: "b", fileName: "img_02.jpg" },
      { driveFileId: "c", fileName: "IMG_2.jpg" },
      { driveFileId: "a", fileName: "IMG_2.jpg" },
    ];

    const forward = assignPhotoSortOrders(photos);
    const reverse = assignPhotoSortOrders([...photos].reverse());
    expect(forward.map(({ driveFileId }) => driveFileId)).toEqual(
      reverse.map(({ driveFileId }) => driveFileId),
    );
    expect(comparePhotosByNaturalName(photos[1]!, photos[2]!)).toBeGreaterThan(0);
    expect(photos.map(({ driveFileId }) => driveFileId)).toEqual(["b", "c", "a"]);
  });

  it("rejects duplicate Drive identities before assigning ordinals", () => {
    expect(() =>
      assignPhotoSortOrders([
        { driveFileId: "same", fileName: "IMG_1.jpg" },
        { driveFileId: "same", fileName: "IMG_2.jpg" },
      ]),
    ).toThrow("Duplicate Drive file ID");
  });

  it("assigns a unique ordinal for every entry in a 10,000-photo catalog", () => {
    const ordered = assignPhotoSortOrders(
      Array.from({ length: 10_000 }, (_, index) => ({
        driveFileId: `file-${index}`,
        fileName: `IMG_${10_000 - index}.jpg`,
      })),
    );

    expect(ordered).toHaveLength(10_000);
    expect(ordered[0]?.fileName).toBe("IMG_1.jpg");
    expect(ordered.at(-1)?.sortOrder).toBe(9_999);
  });
});

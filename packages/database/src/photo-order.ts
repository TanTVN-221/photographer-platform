export interface SortablePhoto {
  readonly driveFileId: string;
  readonly fileName: string;
}

const naturalCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function comparePhotosByNaturalName(
  left: SortablePhoto,
  right: SortablePhoto,
): number {
  return (
    naturalCollator.compare(left.fileName, right.fileName) ||
    compareCodeUnits(left.fileName, right.fileName) ||
    compareCodeUnits(left.driveFileId, right.driveFileId)
  );
}

export function assignPhotoSortOrders<T extends SortablePhoto>(
  photos: readonly T[],
): readonly (T & { readonly sortOrder: number })[] {
  const sorted = [...photos].sort(comparePhotosByNaturalName);
  const seenFileIds = new Set<string>();

  return sorted.map((photo, sortOrder) => {
    if (seenFileIds.has(photo.driveFileId)) {
      throw new Error("Duplicate Drive file ID in one album catalog.");
    }
    seenFileIds.add(photo.driveFileId);
    return { ...photo, sortOrder };
  });
}

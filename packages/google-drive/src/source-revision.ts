/** Keep sync indexing and original reads on the same source identity rule. */
export function driveSourceRevision(input: {
  readonly md5Checksum: string | null;
  readonly driveVersion: string | null;
  readonly modifiedTime: string | null;
  readonly sizeBytes: string | null;
}): string | null {
  if (input.md5Checksum !== null) return `md5:${input.md5Checksum}`;
  if (input.driveVersion !== null) return `version:${input.driveVersion}`;
  if (input.modifiedTime !== null || input.sizeBytes !== null) {
    return `fallback:${input.modifiedTime ?? ""}:${input.sizeBytes ?? ""}`;
  }
  return null;
}

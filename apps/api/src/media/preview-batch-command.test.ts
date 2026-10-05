import { lstat, mkdir, mkdtemp, rm, rmdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parsePreviewBatchArguments } from "./preview-batch-command.js";
import { withPreviewBatchLock } from "./preview-batch-lock.js";

describe("explicit preview operator boundary (SEC-001/004, IMG-004)", () => {
  it("requires exact IDs and explicit processing confirmation", () => {
    expect(parsePreviewBatchArguments(["--owner=owner_123", "--album=album_123", "--confirm=processing"])).toEqual({
      owner: "owner_123", album: "album_123", limit: 10, confirm: "processing",
    });
    expect(parsePreviewBatchArguments(["--owner=owner_123", "--album=album_123", "--limit=25", "--confirm=processing", "--cursor=abc"])).toMatchObject({ limit: 25, cursor: "abc" });
  });
  it.each([
    ["--owner=owner_123", "--album=album_123"],
    ["--owner=owner_123", "--owner=other", "--album=album_123", "--confirm=processing"],
    ["--owner=owner_123", "--album=../bad", "--confirm=processing"],
    ["--owner=owner_123", "--album=album_123", "--confirm=processing", "--limit=26"],
    ["--owner=owner_123", "--album=album_123", "--confirm=processing", "--token=private"],
  ].map((args) => ({ args })))("rejects malformed, duplicate or unconfirmed arguments $args", ({ args }) => {
    expect(() => parsePreviewBatchArguments(args)).toThrow(expect.objectContaining({ code: "invalid-request" }));
  });
  it("exclusively locks the existing private volume and releases normally or on error", async () => {
    const root = await mkdtemp(join(tmpdir(), "photographer-preview-lock-"));
    try {
      const result = await withPreviewBatchLock(root, async () => {
        expect((await lstat(join(root, ".preview-batch-lock"))).mode & 0o077).toBe(0);
        await expect(withPreviewBatchLock(root, async () => true)).rejects.toMatchObject({ code: "busy" });
        return 42;
      });
      expect(result).toBe(42);
      await expect(lstat(join(root, ".preview-batch-lock"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(withPreviewBatchLock(root, async () => { throw new Error("work failed"); })).rejects.toThrow("work failed");
      expect(await withPreviewBatchLock(root, async () => true)).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("never steals an existing crash/symlink lock or creates a missing volume", async () => {
    const root = await mkdtemp(join(tmpdir(), "photographer-preview-lock-"));
    const work = vi.fn(async () => true);
    try {
      await mkdir(join(root, ".preview-batch-lock"));
      await expect(withPreviewBatchLock(root, work)).rejects.toMatchObject({ code: "busy" });
      await rmdir(join(root, ".preview-batch-lock"));
      await symlink(root, join(root, ".preview-batch-lock"));
      await expect(withPreviewBatchLock(root, work)).rejects.toMatchObject({ code: "busy" });
      await expect(withPreviewBatchLock(join(root, "missing"), work)).rejects.toMatchObject({ code: "storage-unavailable" });
      await expect(lstat(join(root, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(work).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";

import { FileSystemDerivativeStore } from "./derivative-store.js";
import { PreviewBatchError } from "./preview-batch-cursor.js";

/** Single-volume pilot lock. Never steals an existing lock, even after a crash. */
export async function withPreviewBatchLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const store = new FileSystemDerivativeStore(root);
  if (!await store.checkReady()) throw new PreviewBatchError("storage-unavailable");
  const lock = join(root, ".preview-batch-lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    const exists = typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
    throw new PreviewBatchError(exists ? "busy" : "storage-unavailable");
  }
  try { return await work(); }
  finally {
    // Empty directory only; never recursive deletion or stale-lock takeover.
    try { await rmdir(lock); }
    catch { throw new PreviewBatchError("storage-unavailable"); }
  }
}

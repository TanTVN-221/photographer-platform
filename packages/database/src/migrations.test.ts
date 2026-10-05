import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("reviewed migration ordering (DB-005)", () => {
  it("creates metadata before adding active-sync and owner-workspace constraints", async () => {
    const directory = new URL("../prisma/migrations/", import.meta.url);
    const names = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(names[0]).toBe("20260929_initial_metadata");
    expect(names.indexOf("20260930_active_sync_run")).toBeGreaterThan(names.indexOf("20260929_initial_metadata"));
    const first = await readFile(new URL(`${names[0]}/migration.sql`, directory), "utf8");
    expect(first).toContain('CREATE TABLE "SyncRun"');
    const last = await readFile(new URL("202610040001_owner_album_pagination/migration.sql", directory), "utf8");
    expect(last).toContain('"Selection_revision_nonnegative"');
  });
});

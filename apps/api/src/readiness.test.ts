import type { DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";
import { ApiReadinessService } from "./readiness.js";

function fixture() {
  let now = 1000;
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: vi.fn().mockResolvedValue([]) };
  const transaction = vi.fn(async <T>(fn: (value: typeof tx) => Promise<T>) => fn(tx));
  const database = { $transaction: transaction } as unknown as DatabaseClient;
  const volume = { checkReady: vi.fn().mockResolvedValue(true) };
  return { tx, transaction, database, volume, service: new ApiReadinessService(database, volume, true, () => now),
    advance: () => { now += 5001; } };
}
describe("bounded infrastructure readiness (OPS-002, SEC-004, DB-005)", () => {
  it("checks schema without reading rows and uses explicit statement/transaction deadlines", async () => {
    const { service, tx, transaction, volume } = fixture();
    expect(await service.check()).toBe(true);
    expect(tx.$executeRaw.mock.calls[0]?.[0].join("")).toContain("statement_timeout = '2000ms'");
    const sql = tx.$queryRaw.mock.calls[0]?.[0].join("") as string;
    expect(sql).toContain("WHERE FALSE"); expect(sql).toContain('s."revision"');
    expect(sql).not.toContain("refreshTokenCiphertext"); expect(sql).not.toContain('"comment"');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 1000, timeout: 3000 });
    expect(volume.checkReady).toHaveBeenCalledOnce();
  });
  it("coalesces concurrent calls, caches briefly and notices dependency failures after expiry", async () => {
    const { service, transaction, volume, advance } = fixture();
    expect(await Promise.all(Array.from({ length: 100 }, () => service.check()))).toEqual(Array(100).fill(true));
    expect(transaction).toHaveBeenCalledOnce();
    expect(await service.check()).toBe(true); expect(transaction).toHaveBeenCalledOnce();
    advance(); volume.checkReady.mockResolvedValueOnce(false);
    expect(await service.check()).toBe(false); expect(transaction).toHaveBeenCalledTimes(2);
    advance(); expect(await service.check()).toBe(true);
  });
  it("returns false for database/schema/storage failures without surfacing error details", async () => {
    const { service, transaction, volume, advance } = fixture();
    transaction.mockRejectedValueOnce(new Error("database-url-and-private-path"));
    expect(await service.check()).toBe(false);
    advance(); volume.checkReady.mockRejectedValueOnce(new Error("storage-path"));
    expect(await service.check()).toBe(false);
  });
  it("fails closed for missing configuration/database/volume without probing dependencies", async () => {
    const { database, volume, transaction } = fixture();
    expect(await new ApiReadinessService(database, volume, false).check()).toBe(false);
    expect(await new ApiReadinessService(null, volume, true).check()).toBe(false);
    expect(await new ApiReadinessService(database, undefined, true).check()).toBe(false);
    expect(transaction).not.toHaveBeenCalled(); expect(volume.checkReady).not.toHaveBeenCalled();
  });
});

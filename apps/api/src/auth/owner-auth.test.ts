import { randomBytes } from "node:crypto";
import type { DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";
import { LoginFlowCodec } from "./login-flow.js";
import { OwnerAuthService } from "./owner-auth.js";

function fixture() {
  let now = 1_800_000_000_000;
  const rows = new Map<string, { tokenHash: string; ownerId: string; createdAt: Date; expiresAt: Date }>();
  const owner = { id: "owner-1", email: "owner@example.test", displayName: "Owner" };
  const tx = {
    photographer: { upsert: vi.fn(async () => ({ id: owner.id })) },
    photographerSession: {
      create: vi.fn(async ({ data }: { data: typeof rows extends Map<string, infer V> ? V : never }) => { rows.set(data.tokenHash, data); return data; }),
      deleteMany: vi.fn(async ({ where }: { where: { tokenHash?: string; ownerId?: string; expiresAt?: { lte: Date } } }) => {
        for (const [key, row] of rows) {
          if (where.tokenHash === key || (where.ownerId === row.ownerId && where.expiresAt !== undefined && row.expiresAt <= where.expiresAt.lte)) rows.delete(key);
        }
        return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }: { where: { tokenHash: string; expiresAt: { gt: Date } } }) => {
        const row = rows.get(where.tokenHash);
        return row !== undefined && row.expiresAt > where.expiresAt.gt ? { owner } : null;
      }),
    },
  };
  const db = { ...tx, $transaction: async <T>(fn: (transaction: typeof tx) => Promise<T>) => fn(tx) } as unknown as DatabaseClient;
  const identity = {
    authorizationUrl: vi.fn(({ state }: { state: string; nonce: string; challenge: string }) => `https://accounts.google.com/?state=${state}`),
    exchange: vi.fn(async () => ({ subject: "google-subject", email: owner.email, displayName: owner.displayName })),
  };
  const service = new OwnerAuthService(db, identity, new LoginFlowCodec(randomBytes(32), "client", "callback", () => now), () => now);
  const begin = () => { const flow = service.begin(); return { flow, query: { code: "code", state: new URL(flow.url).searchParams.get("state") } }; };
  return { service, identity, tx, rows, owner, begin, advance: () => { now += 12 * 3600 * 1000; } };
}

describe("photographer sessions (AUTH-001/004, PROD-002)", () => {
  it("requires browser callback proof before code exchange or database writes", async () => {
    const { service, begin, identity, tx } = fixture();
    const { query } = begin();
    await expect(service.complete(query, null, null)).rejects.toThrow();
    await expect(service.complete({ ...query, state: "forged" }, "cookie", null)).rejects.toThrow();
    expect(identity.exchange).not.toHaveBeenCalled();
    expect(tx.photographer.upsert).not.toHaveBeenCalled();
  });
  it("uses Google subject as identity, hashes sessions, rotates old sessions and supports logout", async () => {
    const { service, begin, rows, owner, tx } = fixture();
    const first = begin();
    const token = await service.complete(first.query, first.flow.cookie, null);
    expect([...rows.keys()][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify([...rows.values()])).not.toContain(token);
    expect(tx.photographer.upsert.mock.calls[0]).toEqual([{ where: { googleSubject: "google-subject" },
      create: { googleSubject: "google-subject", email: owner.email, displayName: owner.displayName },
      update: { email: owner.email, displayName: owner.displayName }, select: { id: true } }]);
    expect(await service.authenticate(token)).toEqual(owner);
    const next = begin();
    const replacement = await service.complete(next.query, next.flow.cookie, token);
    expect(await service.authenticate(token)).toBeNull();
    expect(await service.authenticate(replacement)).toEqual(owner);
    await service.logout(replacement);
    expect(await service.authenticate(replacement)).toBeNull();
  });
  it("rejects expired, missing and malformed sessions", async () => {
    const { service, begin, advance } = fixture();
    const { flow, query } = begin();
    const token = await service.complete(query, flow.cookie, null);
    advance();
    expect(await service.authenticate(token)).toBeNull();
    expect(await service.authenticate(null)).toBeNull();
    expect(await service.authenticate("owner-1")).toBeNull();
  });
  it("does not issue a session when an email uniqueness conflict rejects the Google subject", async () => {
    const { service, begin, tx } = fixture();
    const { flow, query } = begin();
    tx.photographer.upsert.mockRejectedValueOnce(new Error("email uniqueness conflict"));
    await expect(service.complete(query, flow.cookie, null)).rejects.toThrow();
    expect(tx.photographerSession.create).not.toHaveBeenCalled();
  });
});

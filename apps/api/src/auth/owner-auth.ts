import { createHash, randomBytes } from "node:crypto";

import type { DatabaseClient } from "@photographer-platform/database";
import type { GoogleIdentityProvider } from "@photographer-platform/google-drive";
import { OWNER_SESSION_MAX_AGE_SECONDS, ownerSessionTokenSchema } from "@photographer-platform/shared";
import { z } from "zod";

import type { LoginFlowCodec } from "./login-flow.js";

const callbackSchema = z.object({ code: z.string().min(1).max(4096), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class OwnerAuthService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly identity: GoogleIdentityProvider,
    private readonly flows: LoginFlowCodec,
    private readonly now: () => number = Date.now,
  ) {}

  begin() {
    const flow = this.flows.issue();
    return { url: this.identity.authorizationUrl(flow), cookie: flow.cookie };
  }

  async complete(query: unknown, flowCookie: string | null, previousSession: string | null): Promise<string> {
    const input = callbackSchema.safeParse(query);
    if (!input.success) throw new Error("Sign-in could not be completed.");
    const flow = this.flows.read(flowCookie, input.data.state);
    if (flow === null) throw new Error("Sign-in could not be completed.");
    const identity = await this.identity.exchange({ code: input.data.code, ...flow });
    const token = randomBytes(32).toString("base64url");
    const now = new Date(this.now());
    await this.database.$transaction(async (tx) => {
      // Subject is the identity key. A conflicting email fails the transaction;
      // it must never link an existing account by email alone.
      const owner = await tx.photographer.upsert({
        where: { googleSubject: identity.subject },
        create: { googleSubject: identity.subject, email: identity.email, displayName: identity.displayName },
        update: { email: identity.email, displayName: identity.displayName },
        select: { id: true },
      });
      if (previousSession !== null && ownerSessionTokenSchema.safeParse(previousSession).success) {
        await tx.photographerSession.deleteMany({ where: { tokenHash: hashToken(previousSession) } });
      }
      await tx.photographerSession.deleteMany({ where: { ownerId: owner.id, expiresAt: { lte: now } } });
      await tx.photographerSession.create({ data: {
        tokenHash: hashToken(token), ownerId: owner.id, createdAt: now,
        expiresAt: new Date(now.getTime() + OWNER_SESSION_MAX_AGE_SECONDS * 1000),
      } });
    });
    return token;
  }

  async authenticate(token: string | null) {
    if (token === null || !ownerSessionTokenSchema.safeParse(token).success) return null;
    const session = await this.database.photographerSession.findFirst({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date(this.now()) } },
      select: { owner: { select: { id: true, email: true, displayName: true } } },
    });
    return session?.owner ?? null;
  }

  async logout(token: string | null): Promise<void> {
    if (token !== null && ownerSessionTokenSchema.safeParse(token).success) {
      await this.database.photographerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
  }
}

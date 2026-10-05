import { Router, type Request, type Response } from "express";
import {
  driveConnectionIdSchema,
  driveConnectionListSchema,
  driveFlowCookieName,
  errorEnvelopeSchema,
  ownerSessionCookieName,
} from "@photographer-platform/shared";
import { z } from "zod";

import type { OwnerAuthService } from "../auth/owner-auth.js";
import { readAuthCookie } from "../auth/login-flow.js";
import { PublicMutationLimiter } from "../selection/public-mutation-limiter.js";
import type { DriveAuthorizationConfig } from "./drive-config.js";
import type { DriveConnectionService } from "./drive-connection.js";
import { DRIVE_FLOW_MAX_AGE_SECONDS } from "./drive-flow.js";

const ownerSchema = z.strictObject({ id: z.string().min(1).max(128), email: z.email(), displayName: z.string().nullable() });
const connectionParamsSchema = z.strictObject({ connectionId: driveConnectionIdSchema });

export interface DriveAuthorizationDependencies {
  readonly driveConnections?: Pick<DriveConnectionService, "begin" | "complete" | "list" | "disconnect">;
  readonly driveOwnerAuth?: Pick<OwnerAuthService, "authenticate">;
  readonly driveAuthorizationConfig?: Pick<DriveAuthorizationConfig, "webOrigin" | "secure">;
}

function fail(response: Response, status: number, code: string, message: string): void {
  response.locals.errorCode = code;
  response.status(status).json(errorEnvelopeSchema.parse({ error: { code, message, requestId: response.locals.requestId } }));
}

function originMatches(request: Request, origin: string): boolean {
  if (request.header("origin") !== undefined) return request.header("origin") === origin;
  try { return new URL(request.header("referer") ?? "").origin === origin; } catch { return false; }
}

export function createDriveRouter(dependencies: DriveAuthorizationDependencies): Router {
  const router = Router();
  const service = dependencies.driveConnections;
  const auth = dependencies.driveOwnerAuth;
  const config = dependencies.driveAuthorizationConfig;
  const limiter = new PublicMutationLimiter();
  const cookieOptions = { httpOnly: true, secure: config?.secure ?? true, sameSite: "lax" as const, path: "/" };
  const ownerCookie = ownerSessionCookieName(cookieOptions.secure);
  const flowCookie = driveFlowCookieName(cookieOptions.secure);

  router.use((request, response, next) => {
    response.locals.routeKey = `/api/v1/drive${request.path === "/google/callback" ? "/google/callback" : "/request"}`;
    response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    next();
  });
  router.use(async (request, response, next) => {
    if (service === undefined || auth === undefined || config === undefined) {
      fail(response, 503, "DRIVE_UNAVAILABLE", "Google Drive connection is not available.");
      return;
    }
    const owner = await auth.authenticate(readAuthCookie(request.header("cookie"), ownerCookie));
    const parsed = ownerSchema.safeParse(owner);
    if (!parsed.success) {
      if (request.path === "/google/callback") {
        response.clearCookie(flowCookie, cookieOptions);
        response.redirect(303, new URL("/signin?error=failed", config.webOrigin).toString());
        return;
      }
      fail(response, 401, "AUTH_REQUIRED", "Sign in to continue.");
      return;
    }
    response.locals.driveOwner = parsed.data;
    if (request.method !== "GET" && !originMatches(request, config.webOrigin)) {
      fail(response, 403, "ORIGIN_REJECTED", "The request origin is not allowed.");
      return;
    }
    if (request.path === "/google" || request.path === "/google/callback") {
      const retryAfter = limiter.check(request.socket.remoteAddress ?? "unknown", "drive-authorization");
      if (retryAfter !== null) {
        response.setHeader("Retry-After", String(retryAfter));
        fail(response, 429, "DRIVE_RATE_LIMITED", "Too many Drive authorization attempts. Try again later.");
        return;
      }
    }
    next();
  });

  router.get("/connections", async (_request, response) => {
    try {
      const owner = ownerSchema.parse(response.locals.driveOwner);
      response.json(driveConnectionListSchema.parse(await service!.list(owner.id)));
    } catch {
      fail(response, 503, "DRIVE_UNAVAILABLE", "Google Drive connections could not be loaded.");
    }
  });
  router.post("/google", (_request, response) => {
    try {
      const owner = ownerSchema.parse(response.locals.driveOwner);
      const flow = service!.begin(owner);
      response.cookie(flowCookie, flow.cookie, { ...cookieOptions, maxAge: DRIVE_FLOW_MAX_AGE_SECONDS * 1000 });
      response.redirect(303, flow.url);
    } catch {
      fail(response, 503, "DRIVE_UNAVAILABLE", "Google Drive authorization could not be started.");
    }
  });
  router.get("/google/callback", async (request, response) => {
    response.clearCookie(flowCookie, cookieOptions);
    try {
      if (request.query.error !== undefined) throw new Error();
      const owner = ownerSchema.parse(response.locals.driveOwner);
      await service!.complete(owner.id, request.query, readAuthCookie(request.header("cookie"), flowCookie));
      response.redirect(303, new URL("/workspace?drive=connected", config!.webOrigin).toString());
    } catch {
      response.locals.errorCode = "DRIVE_AUTHORIZATION_FAILED";
      response.redirect(303, new URL("/workspace?drive=failed", config!.webOrigin).toString());
    }
  });
  router.post("/connections/:connectionId/disconnect", async (request, response) => {
    try {
      const owner = ownerSchema.parse(response.locals.driveOwner);
      const params = connectionParamsSchema.parse(request.params);
      const result = await service!.disconnect(owner.id, params.connectionId);
      response.redirect(303, new URL(
        result.revocationConfirmed ? "/workspace?drive=disconnected" : "/workspace?drive=revocation-warning",
        config!.webOrigin,
      ).toString());
    } catch {
      response.locals.errorCode = "DRIVE_DISCONNECT_FAILED";
      response.redirect(303, new URL("/workspace?drive=failed", config!.webOrigin).toString());
    }
  });
  return router;
}

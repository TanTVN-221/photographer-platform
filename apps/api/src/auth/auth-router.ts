import { Router, type Request, type Response } from "express";
import { authenticationStatusSchema, errorEnvelopeSchema, loginFlowCookieName,
  ownerProfileSchema, ownerSessionCookieName, OWNER_SESSION_MAX_AGE_SECONDS } from "@photographer-platform/shared";

import { PublicMutationLimiter } from "../selection/public-mutation-limiter.js";
import { LOGIN_FLOW_MAX_AGE_SECONDS, readAuthCookie } from "./login-flow.js";
import type { OwnerAuthService } from "./owner-auth.js";
import type { PhotographerAuthConfig } from "./auth-config.js";

export interface OwnerAuthDependencies {
  readonly ownerAuth?: Pick<OwnerAuthService, "begin" | "complete" | "authenticate" | "logout">;
  readonly ownerAuthConfig?: Pick<PhotographerAuthConfig, "webOrigin" | "secure">;
}

function fail(response: Response, status: number, code: string, message: string): void {
  response.locals.errorCode = code;
  response.status(status).json(errorEnvelopeSchema.parse({ error: { code, message, requestId: response.locals.requestId } }));
}

function originMatches(request: Request, origin: string): boolean {
  if (request.header("origin") !== undefined) return request.header("origin") === origin;
  try { return new URL(request.header("referer") ?? "").origin === origin; } catch { return false; }
}

export function createAuthRouter(dependencies: OwnerAuthDependencies): Router {
  const router = Router();
  const { ownerAuth: auth, ownerAuthConfig: config } = dependencies;
  const limiter = new PublicMutationLimiter();
  const cookieOptions = { httpOnly: true, secure: config?.secure ?? true, sameSite: "lax" as const, path: "/" };
  const sessionName = ownerSessionCookieName(cookieOptions.secure);
  const flowName = loginFlowCookieName(cookieOptions.secure);
  router.use((request, response, next) => {
    response.locals.routeKey = `/api/v1/auth${request.path === "/google/callback" ? "/google/callback" : "/request"}`;
    response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    next();
  });
  router.get("/status", (_request, response) => {
    response.json(authenticationStatusSchema.parse({ configured: auth !== undefined && config !== undefined }));
  });
  router.use((request, response, next) => {
    if (auth === undefined || config === undefined) {
      fail(response, 503, "AUTH_UNAVAILABLE", "Photographer sign-in is not available.");
      return;
    }
    if (request.method !== "GET" && !originMatches(request, config.webOrigin)) {
      fail(response, 403, "ORIGIN_REJECTED", "The request origin is not allowed.");
      return;
    }
    if (request.path === "/google" || request.path === "/google/callback") {
      const retryAfter = limiter.check(request.socket.remoteAddress ?? "unknown", "photographer-auth");
      if (retryAfter !== null) {
        response.setHeader("Retry-After", String(retryAfter));
        fail(response, 429, "AUTH_RATE_LIMITED", "Too many sign-in attempts. Try again later.");
        return;
      }
    }
    next();
  });
  router.post("/google", (_request, response) => {
    const flow = auth!.begin();
    response.cookie(flowName, flow.cookie, { ...cookieOptions, maxAge: LOGIN_FLOW_MAX_AGE_SECONDS * 1000 });
    response.redirect(303, flow.url);
  });
  router.get("/google/callback", async (request, response) => {
    response.clearCookie(flowName, cookieOptions);
    try {
      if (request.query.error !== undefined) throw new Error("Sign-in declined.");
      const token = await auth!.complete(request.query, readAuthCookie(request.header("cookie"), flowName),
        readAuthCookie(request.header("cookie"), sessionName));
      response.cookie(sessionName, token, { ...cookieOptions, maxAge: OWNER_SESSION_MAX_AGE_SECONDS * 1000 });
      response.redirect(303, new URL("/workspace", config!.webOrigin).toString());
    } catch {
      response.locals.errorCode = "SIGN_IN_FAILED";
      response.redirect(303, new URL("/signin?error=failed", config!.webOrigin).toString());
    }
  });
  router.get("/session", async (request, response) => {
    const owner = await auth!.authenticate(readAuthCookie(request.header("cookie"), sessionName));
    if (owner === null) {
      fail(response, 401, "AUTH_REQUIRED", "Sign in to continue.");
      return;
    }
    response.json(ownerProfileSchema.parse({ email: owner.email, displayName: owner.displayName }));
  });
  router.post("/logout", async (request, response) => {
    await auth!.logout(readAuthCookie(request.header("cookie"), sessionName));
    response.clearCookie(sessionName, cookieOptions);
    response.clearCookie(flowName, cookieOptions);
    response.redirect(303, new URL("/signin", config!.webOrigin).toString());
  });
  return router;
}

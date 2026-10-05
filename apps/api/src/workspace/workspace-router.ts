import { Router, type Response } from "express";
import { errorEnvelopeSchema, ownerAlbumIdSchema, ownerCursorSchema, ownerSelectionLifecycleSchema, ownerSessionCookieName } from "@photographer-platform/shared";
import { z } from "zod";
import type { OwnerAuthDependencies } from "../auth/auth-router.js";
import { readAuthCookie } from "../auth/login-flow.js";
import { SelectionError, type SelectionService } from "../selection/selection-service.js";
import { PublicMutationLimiter } from "../selection/public-mutation-limiter.js";
import { WorkspaceError } from "./owner-cursor.js";
import type { WorkspaceService } from "./workspace-service.js";
import type { OwnerReviewImageService } from "./owner-review-image.js";

export interface WorkspaceDependencies extends OwnerAuthDependencies {
  readonly workspace?: Pick<WorkspaceService, "albums" | "review" | "archive">;
  readonly ownerSelections?: Pick<SelectionService, "lockForOwner" | "reopenForOwner" | "exportSubmittedForOwner">;
  readonly ownerReviewImages?: Pick<OwnerReviewImageService, "read">;
}
const paramsSchema = z.strictObject({ albumId: ownerAlbumIdSchema });
const querySchema = z.strictObject({ cursor: ownerCursorSchema.optional() });
const mutationSchema = z.strictObject({});
const archiveSchema = z.strictObject({ confirmation: z.literal("archive") });
function fail(response: Response, status: number, code: string, message: string) {
  response.locals.errorCode = code;
  response.status(status).json(errorEnvelopeSchema.parse({ error: { code, message, requestId: response.locals.requestId } }));
}
function errorResponse(response: Response, error: unknown) {
  if (error instanceof z.ZodError) return fail(response, 400, "INVALID_REQUEST", "The request is invalid.");
  if (error instanceof WorkspaceError) {
    return fail(response, error.code === "not-found" ? 404 : error.code === "invalid-cursor" ? 400 : 409,
      error.code === "not-found" ? "ALBUM_NOT_FOUND" : error.code === "invalid-cursor" ? "INVALID_CURSOR" :
        error.code === "stale-cursor" ? "STALE_CURSOR" : "ALBUM_CONFLICT", error.message);
  }
  if (error instanceof SelectionError) {
    return fail(response, error.code === "owner-not-found" ? 404 : 409,
      error.code === "owner-not-found" ? "ALBUM_NOT_FOUND" : "SELECTION_CONFLICT", error.message);
  }
  fail(response, 503, "WORKSPACE_UNAVAILABLE", "The workspace is temporarily unavailable.");
}

export function createWorkspaceRouter(dependencies: WorkspaceDependencies): Router {
  const router = Router();
  const { ownerAuth: auth, ownerAuthConfig: config, workspace, ownerSelections: selections } = dependencies;
  const limiter = new PublicMutationLimiter();
  router.use(async (request, response, next) => {
    response.locals.routeKey = "/api/v1/workspace/request";
    response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    if (auth === undefined || config === undefined || workspace === undefined || selections === undefined) {
      fail(response, 503, "WORKSPACE_UNAVAILABLE", "The workspace is temporarily unavailable.");
      return;
    }
    try {
      const owner = await auth.authenticate(readAuthCookie(request.header("cookie"), ownerSessionCookieName(config.secure)));
      if (owner === null) { fail(response, 401, "AUTH_REQUIRED", "Sign in to continue."); return; }
      response.locals.workspaceOwnerId = ownerAlbumIdSchema.parse(owner.id);
      if (request.method !== "GET") {
        let origin = request.header("origin");
        if (origin === undefined) {
          try { origin = new URL(request.header("referer") ?? "").origin; } catch { origin = undefined; }
        }
        if (origin !== config.webOrigin) { fail(response, 403, "ORIGIN_REJECTED", "The request origin is not allowed."); return; }
        const retryAfter = limiter.check(request.socket.remoteAddress ?? "unknown", owner.id);
        if (retryAfter !== null) {
          response.setHeader("Retry-After", String(retryAfter));
          fail(response, 429, "MUTATION_RATE_LIMITED", "Too many changes. Try again later."); return;
        }
      }
      next();
    } catch (error) { errorResponse(response, error); }
  });
  router.get("/albums", async (request, response) => {
    response.locals.routeKey = "/api/v1/workspace/albums";
    try {
      const query = querySchema.parse(request.query);
      response.json(await workspace!.albums(ownerAlbumIdSchema.parse(response.locals.workspaceOwnerId), query.cursor));
    } catch (error) { errorResponse(response, error); }
  });
  router.get("/albums/:albumId/selection", async (request, response) => {
    response.locals.routeKey = "/api/v1/workspace/albums/:albumId/selection";
    try {
      const { albumId } = paramsSchema.parse(request.params);
      const { cursor } = querySchema.parse(request.query);
      response.json(await workspace!.review(ownerAlbumIdSchema.parse(response.locals.workspaceOwnerId), albumId, cursor));
    } catch (error) { errorResponse(response, error); }
  });
  router.get("/albums/:albumId/selection/export", async (request, response) => {
    response.locals.routeKey = "/api/v1/workspace/albums/:albumId/selection/export";
    try {
      const { albumId } = paramsSchema.parse(request.params);
      mutationSchema.parse(request.query);
      const text = await selections!.exportSubmittedForOwner(ownerAlbumIdSchema.parse(response.locals.workspaceOwnerId), albumId);
      response.set({ "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="selected-filenames.txt"' });
      response.send(text);
    } catch (error) { errorResponse(response, error); }
  });
  router.get("/albums/:albumId/images/:photoId", async (request, response) => {
    response.locals.routeKey = "/api/v1/workspace/albums/:albumId/images/:photoId";
    try {
      const { albumId, photoId } = z.strictObject({ albumId: ownerAlbumIdSchema, photoId: ownerAlbumIdSchema }).parse(request.params);
      mutationSchema.parse(request.query);
      if (dependencies.ownerReviewImages === undefined) {
        fail(response, 503, "IMAGE_UNAVAILABLE", "The thumbnail is temporarily unavailable."); return;
      }
      const bytes = await dependencies.ownerReviewImages.read(ownerAlbumIdSchema.parse(response.locals.workspaceOwnerId), albumId, photoId);
      response.setHeader("Content-Type", "image/webp");
      response.send(bytes);
    } catch (error) { errorResponse(response, error); }
  });
  for (const action of ["lock", "reopen", "archive"] as const) {
    router.post(`/albums/:albumId/${action}`, async (request, response) => {
      response.locals.routeKey = `/api/v1/workspace/albums/:albumId/${action}`;
      try {
        const { albumId } = paramsSchema.parse(request.params);
        mutationSchema.parse(request.query);
        (action === "archive" ? archiveSchema : mutationSchema).parse(request.body);
        const ownerId = ownerAlbumIdSchema.parse(response.locals.workspaceOwnerId);
        if (action === "archive") { await workspace!.archive(ownerId, albumId); response.status(204).end(); }
        else {
          const state = await (action === "lock" ? selections!.lockForOwner(ownerId, albumId) : selections!.reopenForOwner(ownerId, albumId));
          response.json(ownerSelectionLifecycleSchema.parse({ status: state.status, submittedAt: state.submittedAt?.toISOString() ?? null, lockedAt: state.lockedAt?.toISOString() ?? null }));
        }
      } catch (error) { errorResponse(response, error); }
    });
  }
  return router;
}

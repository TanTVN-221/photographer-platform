import { randomUUID } from "node:crypto";

import {
  SOURCE_IMAGE_FORMATS,
  errorEnvelopeSchema,
  galleryCursorTokenSchema,
  galleryPasswordSchema,
  galleryPhotoPageSchema,
  guestSelectionStateSchema,
  liveHealthSchema,
  readinessHealthSchema,
  publicPhotoIdSchema,
  publicGallerySlugSchema,
  selectionCommentResponseSchema,
  selectionMutationStateSchema,
  systemInfoSchema,
} from "@photographer-platform/shared";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import { z } from "zod";

import { InvalidGalleryCursorError } from "./gallery/gallery-cursor.js";
import { GalleryAccessError, type GalleryAccessService } from "./gallery/gallery-access.js";
import { GalleryListingError, type GalleryListingService } from "./gallery/gallery-listing.js";
import { GalleryImageError, type GalleryImageService } from "./gallery/gallery-image.js";
import { GALLERY_SESSION_MAX_AGE_SECONDS, gallerySessionCookieName, readGallerySessionCookie } from "./gallery/gallery-session.js";
import { PasswordAttemptLimiter } from "./gallery/password-attempt-limiter.js";
import { GuestSelectionError, type GuestSelectionService } from "./selection/guest-selection.js";
import { PublicMutationLimiter } from "./selection/public-mutation-limiter.js";
import { SelectionError } from "./selection/selection-service.js";
import { createAuthRouter, type OwnerAuthDependencies } from "./auth/auth-router.js";
import { createDriveRouter, type DriveAuthorizationDependencies } from "./drive/drive-router.js";
import { createWorkspaceRouter, type WorkspaceDependencies } from "./workspace/workspace-router.js";
import { apiSecurityHeaders } from "./security-headers.js";

const requestIdSchema = z.uuid();
const galleryParamsSchema = z.strictObject({
  slug: publicGallerySlugSchema,
});
const galleryQuerySchema = z.strictObject({
  limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$/).transform(Number).optional(),
  cursor: galleryCursorTokenSchema.optional(),
});
const imageParamsSchema = z.strictObject({
  slug: publicGallerySlugSchema,
  photoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  variant: z.enum(["thumbnail", "preview"]),
  token: z.string().regex(/^[A-Za-z0-9_-]{24}\.webp$/),
});
const passwordBodySchema = z.strictObject({ password: galleryPasswordSchema });
const selectionQuerySchema = z.strictObject({
  photoId: z.union([publicPhotoIdSchema, z.array(publicPhotoIdSchema).max(50)]).optional(),
});
const selectionItemParamsSchema = z.strictObject({ slug: publicGallerySlugSchema, photoId: publicPhotoIdSchema });
const selectionCommentBodySchema = z.strictObject({ comment: z.string().max(2_000) });

export interface AppDependencies extends OwnerAuthDependencies, DriveAuthorizationDependencies, WorkspaceDependencies {
  readonly readiness?: { check(): Promise<boolean> };
  readonly galleryListing?: Pick<GalleryListingService, "listPasswordless"> & Partial<Pick<GalleryListingService, "listWithSession">>;
  readonly galleryImages?: Pick<GalleryImageService, "readPasswordless"> & Partial<Pick<GalleryImageService, "readWithSession">>;
  readonly galleryAccess?: Pick<GalleryAccessService, "provePassword">;
  readonly passwordOrigin?: string;
  readonly galleryCookieSecure?: boolean;
  readonly passwordAttempts?: PasswordAttemptLimiter;
  readonly guestSelections?: Pick<GuestSelectionService, "state" | "select" | "deselect" | "comment" | "submit">;
  readonly publicMutations?: PublicMutationLimiter;
}

class PasswordAttemptLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many password attempts. Try again later.");
    this.name = "PasswordAttemptLimitError";
  }
}

class PublicMutationLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many gallery changes. Try again later.");
    this.name = "PublicMutationLimitError";
  }
}

class OriginRejectedError extends Error {
  constructor() {
    super("The request origin is not allowed.");
    this.name = "OriginRejectedError";
  }
}

function hasAllowedWebOrigin(request: express.Request, allowedOrigin: string): boolean {
  const origin = request.header("origin");
  if (origin !== undefined) return origin === allowedOrigin;
  const referer = request.header("referer");
  if (referer === undefined) return false;
  try { return new URL(referer).origin === allowedOrigin; } catch { return false; }
}

class GalleryUnavailableError extends Error {
  constructor() {
    super("Gallery browsing is not configured yet.");
    this.name = "GalleryUnavailableError";
  }
}

const requestContext: RequestHandler = (request, response, next) => {
  const incomingId = request.header("x-request-id");
  const parsedId = requestIdSchema.safeParse(incomingId);
  const requestId = parsedId.success ? parsedId.data : randomUUID();

  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
};

const requestLog: RequestHandler = (request, response, next) => {
  const startedAt = performance.now();

  response.on("finish", () => {
    console.info(
      JSON.stringify({
        event: "http_request",
        requestId: response.locals.requestId,
        route: response.locals.routeKey ?? "unmatched",
        method: request.method,
        status: response.statusCode,
        ...(response.locals.errorCode === undefined ? {} : { errorCode: response.locals.errorCode }),
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
  });

  next();
};

const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  const invalidJson = error instanceof SyntaxError && "body" in error;
  const oversizedBody =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 413;
  const galleryError =
    error instanceof GalleryListingError
      ? error.code === "invalid-request"
        ? { status: 400, code: "INVALID_REQUEST", message: error.message }
        : error.code === "not-found"
          ? { status: 404, code: "GALLERY_NOT_FOUND", message: error.message }
          : error.code === "password-required"
            ? { status: 403, code: "PASSWORD_REQUIRED", message: error.message }
            : { status: 409, code: "STALE_CURSOR", message: error.message }
      : error instanceof InvalidGalleryCursorError
        ? { status: 400, code: "INVALID_CURSOR", message: error.message }
      : error instanceof GalleryUnavailableError
          ? { status: 503, code: "GALLERY_UNAVAILABLE", message: error.message }
          : error instanceof GalleryImageError
            ? error.code === "invalid-request"
              ? { status: 400, code: "INVALID_IMAGE_REQUEST", message: error.message }
              : error.code === "not-found"
                ? { status: 404, code: "IMAGE_NOT_FOUND", message: error.message }
                : { status: 503, code: "IMAGE_UNAVAILABLE", message: error.message }
          : error instanceof GalleryAccessError
            ? error.code === "invalid-request"
              ? { status: 400, code: "INVALID_PASSWORD_REQUEST", message: error.message }
              : { status: 403, code: "PASSWORD_DENIED", message: error.message }
          : error instanceof PasswordAttemptLimitError
            ? { status: 429, code: "PASSWORD_RATE_LIMITED", message: error.message }
          : error instanceof GuestSelectionError
            ? error.code === "invalid-request"
              ? { status: 400, code: "INVALID_SELECTION_REQUEST", message: error.message }
              : error.code === "not-found"
                ? { status: 404, code: "GALLERY_NOT_FOUND", message: error.message }
                : { status: 403, code: "PASSWORD_REQUIRED", message: error.message }
          : error instanceof SelectionError
            ? error.code === "photo-not-found" || error.code === "gallery-not-found" || error.code === "gallery-not-published"
              ? { status: 404, code: "SELECTION_NOT_FOUND", message: error.message }
              : error.code === "invalid-comment"
                ? { status: 400, code: "INVALID_COMMENT", message: error.message }
                : { status: 409, code: "SELECTION_CONFLICT", message: error.message }
          : error instanceof PublicMutationLimitError
            ? { status: 429, code: "MUTATION_RATE_LIMITED", message: error.message }
          : error instanceof OriginRejectedError
            ? { status: 403, code: "ORIGIN_REJECTED", message: error.message }
          : null;
  const status = galleryError?.status ?? (invalidJson ? 400 : oversizedBody ? 413 : 500);

  if (response.headersSent) {
    next(error);
    return;
  }

  const envelope = errorEnvelopeSchema.parse({
    error: {
      code: galleryError?.code ?? (invalidJson
        ? "INVALID_JSON"
        : oversizedBody
          ? "PAYLOAD_TOO_LARGE"
          : "INTERNAL_ERROR"),
      message: galleryError?.message ?? (invalidJson
        ? "The request body is not valid JSON."
        : oversizedBody
          ? "The request body is too large."
          : "An unexpected error occurred."),
      requestId: response.locals.requestId,
    },
  });

  if (error instanceof PasswordAttemptLimitError || error instanceof PublicMutationLimitError) {
    response.setHeader("Retry-After", String(error.retryAfterSeconds));
  }
  response.locals.errorCode = envelope.error.code;
  response.status(status).json(envelope);
};

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const passwordAttempts = dependencies.passwordAttempts ?? new PasswordAttemptLimiter();
  const publicMutations = dependencies.publicMutations ?? new PublicMutationLimiter();

  function requireMutationOriginAndLimit(request: express.Request, slug: string): void {
    if (dependencies.passwordOrigin === undefined || !hasAllowedWebOrigin(request, dependencies.passwordOrigin)) {
      throw new OriginRejectedError();
    }
    const retryAfter = publicMutations.check(request.socket.remoteAddress ?? "unknown", slug);
    if (retryAfter !== null) throw new PublicMutationLimitError(retryAfter);
  }

  app.disable("x-powered-by");
  app.use(requestContext, requestLog, apiSecurityHeaders, express.json({ limit: "64kb" }));
  app.use("/api/v1/auth", createAuthRouter(dependencies));
  app.use("/api/v1/drive", createDriveRouter(dependencies));
  app.use("/api/v1/workspace", createWorkspaceRouter(dependencies));

  app.get("/health/live", (_request, response) => {
    response.locals.routeKey = "/health/live";
    response.setHeader("Cache-Control", "no-store");
    response.json(
      liveHealthSchema.parse({ status: "ok", service: "photographer-platform-api" }),
    );
  });

  app.get("/health/ready", async (_request, response) => {
    response.locals.routeKey = "/health/ready";
    response.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    let ready = false;
    try { ready = await dependencies.readiness?.check() ?? false; } catch { ready = false; }
    if (!ready) response.locals.errorCode = "DEPENDENCIES_NOT_READY";
    response.status(ready ? 200 : 503).json(readinessHealthSchema.parse({
      status: ready ? "ready" : "not-ready", service: "photographer-platform-api",
    }));
  });

  app.get("/api/v1/system", (_request, response) => {
    response.locals.routeKey = "/api/v1/system";
    response.setHeader("Cache-Control", "public, max-age=300");
    response.json(
      systemInfoSchema.parse({
        service: "photographer-platform-api",
        apiVersion: "v1",
        formats: SOURCE_IMAGE_FORMATS.map((format) => ({
          id: format.id,
          label: format.label,
          kind: format.kind,
          supportLevel: format.supportLevel,
          extensions: [...format.extensions],
        })),
      }),
    );
  });

  app.get("/api/v1/galleries/:slug/photos", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/photos";
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (dependencies.galleryListing === undefined) throw new GalleryUnavailableError();

    const params = galleryParamsSchema.safeParse(request.params);
    const query = galleryQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) throw new GalleryListingError("invalid-request");
    const input = {
      slug: params.data.slug,
      ...query.data,
    };
    const session = readGallerySessionCookie(request.header("cookie"), params.data.slug);
    const page = dependencies.galleryListing.listWithSession === undefined
      ? await dependencies.galleryListing.listPasswordless(input)
      : await dependencies.galleryListing.listWithSession(input, session);
    response.json(galleryPhotoPageSchema.parse(page));
  });

  app.post("/api/v1/galleries/:slug/session", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/session";
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (dependencies.galleryAccess === undefined || dependencies.passwordOrigin === undefined ||
      dependencies.galleryCookieSecure === undefined) throw new GalleryUnavailableError();
    const params = galleryParamsSchema.safeParse(request.params);
    const body = passwordBodySchema.safeParse(request.body);
    if (!params.success || !body.success) throw new GalleryAccessError("invalid-request");
    if (!hasAllowedWebOrigin(request, dependencies.passwordOrigin)) throw new GalleryAccessError("denied");
    const permit = passwordAttempts.acquire(request.socket.remoteAddress ?? "unknown", params.data.slug);
    if (!permit.allowed) throw new PasswordAttemptLimitError(permit.retryAfterSeconds);
    try {
      const session = await dependencies.galleryAccess.provePassword({ slug: params.data.slug, password: body.data.password });
      response.cookie(gallerySessionCookieName(params.data.slug), session, {
        httpOnly: true,
        secure: dependencies.galleryCookieSecure,
        sameSite: "lax",
        path: "/",
        maxAge: GALLERY_SESSION_MAX_AGE_SECONDS * 1000,
      });
      response.status(204).end();
    } finally {
      permit.release();
    }
  });

  app.get("/api/v1/galleries/:slug/selection", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/selection";
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (dependencies.guestSelections === undefined) throw new GalleryUnavailableError();
    const params = galleryParamsSchema.safeParse(request.params);
    const query = selectionQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) throw new GuestSelectionError("invalid-request");
    const photoIds = query.data.photoId === undefined ? []
      : Array.isArray(query.data.photoId) ? query.data.photoId : [query.data.photoId];
    if (new Set(photoIds).size !== photoIds.length) throw new GuestSelectionError("invalid-request");
    const session = readGallerySessionCookie(request.header("cookie"), params.data.slug);
    const state = await dependencies.guestSelections.state({ slug: params.data.slug, photoIds }, session);
    response.json(guestSelectionStateSchema.parse(state));
  });

  app.put("/api/v1/galleries/:slug/selection/items/:photoId", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/selection/items/:photoId";
    response.setHeader("Cache-Control", "no-store");
    if (dependencies.guestSelections === undefined) throw new GalleryUnavailableError();
    const params = selectionItemParamsSchema.safeParse(request.params);
    if (!params.success) throw new GuestSelectionError("invalid-request");
    requireMutationOriginAndLimit(request, params.data.slug);
    const session = readGallerySessionCookie(request.header("cookie"), params.data.slug);
    const state = await dependencies.guestSelections.select(params.data, session);
    response.json(selectionMutationStateSchema.parse(state));
  });

  app.delete("/api/v1/galleries/:slug/selection/items/:photoId", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/selection/items/:photoId";
    response.setHeader("Cache-Control", "no-store");
    if (dependencies.guestSelections === undefined) throw new GalleryUnavailableError();
    const params = selectionItemParamsSchema.safeParse(request.params);
    if (!params.success) throw new GuestSelectionError("invalid-request");
    requireMutationOriginAndLimit(request, params.data.slug);
    const session = readGallerySessionCookie(request.header("cookie"), params.data.slug);
    const state = await dependencies.guestSelections.deselect(params.data, session);
    response.json(selectionMutationStateSchema.parse(state));
  });

  app.patch("/api/v1/galleries/:slug/selection/items/:photoId/comment", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/selection/items/:photoId/comment";
    response.setHeader("Cache-Control", "no-store");
    if (dependencies.guestSelections === undefined) throw new GalleryUnavailableError();
    const params = selectionItemParamsSchema.safeParse(request.params);
    const body = selectionCommentBodySchema.safeParse(request.body);
    if (!params.success || !body.success) throw new GuestSelectionError("invalid-request");
    requireMutationOriginAndLimit(request, params.data.slug);
    const session = readGallerySessionCookie(request.header("cookie"), params.data.slug);
    const comment = await dependencies.guestSelections.comment(params.data, body.data.comment, session);
    response.json(selectionCommentResponseSchema.parse({ comment }));
  });

  app.post("/api/v1/galleries/:slug/selection/submit", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/selection/submit";
    response.setHeader("Cache-Control", "no-store");
    if (dependencies.guestSelections === undefined) throw new GalleryUnavailableError();
    const params = galleryParamsSchema.safeParse(request.params);
    if (!params.success) throw new GuestSelectionError("invalid-request");
    requireMutationOriginAndLimit(request, params.data.slug);
    const session = readGallerySessionCookie(request.header("cookie"), params.data.slug);
    const state = await dependencies.guestSelections.submit(params.data.slug, session);
    response.json(selectionMutationStateSchema.parse(state));
  });

  app.get("/api/v1/galleries/:slug/images/:photoId/:variant/:token", async (request, response) => {
    response.locals.routeKey = "/api/v1/galleries/:slug/images/:photoId/:variant/:token";
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (dependencies.galleryImages === undefined) throw new GalleryUnavailableError();
    const params = imageParamsSchema.safeParse(request.params);
    if (!params.success) throw new GalleryImageError("invalid-request");
    const session = readGallerySessionCookie(request.header("cookie"), params.data.slug);
    const image = dependencies.galleryImages.readWithSession === undefined
      ? await dependencies.galleryImages.readPasswordless(params.data)
      : await dependencies.galleryImages.readWithSession(params.data, session);
    response.setHeader("Cache-Control", "private, no-cache");
    response.setHeader("ETag", image.etag);
    if (request.header("if-none-match") === image.etag) {
      response.status(304).end();
      return;
    }
    response.type("image/webp").send(image.bytes);
  });

  app.use((_request, response) => {
    response.locals.errorCode = "NOT_FOUND";
    response.status(404).json(
      errorEnvelopeSchema.parse({
        error: {
          code: "NOT_FOUND",
          message: "The requested endpoint does not exist.",
          requestId: response.locals.requestId,
        },
      }),
    );
  });

  app.use(errorHandler);

  return app;
}

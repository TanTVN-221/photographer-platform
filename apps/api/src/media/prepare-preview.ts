import { DriveProviderError, type OriginalImageReader } from "@photographer-platform/google-drive";
import { classifySourceImage } from "@photographer-platform/shared";
import { z } from "zod";

import { renderRasterDerivatives, supportsRasterDerivatives, type WebpDerivative } from "./raster-derivatives.js";

const providerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const candidateSchema = z.strictObject({
  photoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  driveFileId: providerIdSchema,
  folderId: providerIdSchema,
  fileName: z.string().min(1).max(1024),
  mimeType: z.string().min(1).max(255),
  sourceRevision: z.string().min(1).max(512).regex(/^(?:md5|version|fallback):/),
});

export type PreviewCandidate = z.infer<typeof candidateSchema>;

export type PreviewPreparationResult =
  | {
      readonly status: "ready";
      readonly photoId: string;
      readonly sourceRevision: string;
      readonly thumbnail: WebpDerivative;
      readonly preview: WebpDerivative;
    }
  | {
      readonly status: "unsupported-variant";
      readonly photoId: string;
      readonly code: "decoder-not-enabled" | "source-too-large" | "pixel-limit";
    }
  | {
      readonly status: "stale-source";
      readonly photoId: string;
      readonly code: "source-changed" | "source-missing" | "metadata-changed";
    }
  | {
      readonly status: "deferred";
      readonly photoId: string;
      readonly code: "authentication" | "permission" | "quota" | "rate-limit" | "transient" | "cancelled";
    }
  | {
      readonly status: "failed";
      readonly photoId: string;
      readonly code: "unrecognized-source" | "invalid-source" | "decode-failed" | "output-too-large" | "provider-response" | "unexpected-error";
    };

export class PreviewPreparationError extends Error {
  constructor() {
    super("A valid indexed preview candidate is required.");
    this.name = "PreviewPreparationError";
  }
}

function providerOutcome(photoId: string, error: DriveProviderError): PreviewPreparationResult {
  switch (error.code) {
    case "source-too-large":
      return { status: "unsupported-variant", photoId, code: "source-too-large" };
    case "stale-source":
      return { status: "stale-source", photoId, code: "source-changed" };
    case "not-found":
      return { status: "stale-source", photoId, code: "source-missing" };
    case "authentication":
    case "permission":
    case "quota":
    case "rate-limit":
    case "transient":
    case "cancelled":
      return { status: "deferred", photoId, code: error.code };
    case "invalid-request":
    case "invalid-response":
      return { status: "failed", photoId, code: "provider-response" };
  }
}

/**
 * Trusted, server-only processing boundary. The caller must authorize the
 * photo and persist both derivatives before committing a READY preview state.
 */
export async function preparePreview(
  input: PreviewCandidate,
  reader: OriginalImageReader,
  signal?: AbortSignal,
): Promise<PreviewPreparationResult> {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) throw new PreviewPreparationError();
  const candidate = parsed.data;
  if (signal?.aborted) return { status: "deferred", photoId: candidate.photoId, code: "cancelled" };
  const classification = classifySourceImage({ fileName: candidate.fileName, mimeType: candidate.mimeType });
  if (classification.status === "unrecognized") {
    return { status: "failed", photoId: candidate.photoId, code: "unrecognized-source" };
  }
  if (!supportsRasterDerivatives(classification.format.id)) {
    return { status: "unsupported-variant", photoId: candidate.photoId, code: "decoder-not-enabled" };
  }

  try {
    const original = await reader.readOriginalImage({
      driveFileId: candidate.driveFileId,
      folderId: candidate.folderId,
      expectedRevision: candidate.sourceRevision,
    }, signal);
    if (signal?.aborted) return { status: "deferred", photoId: candidate.photoId, code: "cancelled" };
    if (original.sourceRevision !== candidate.sourceRevision || original.mimeType !== candidate.mimeType) {
      return { status: "stale-source", photoId: candidate.photoId, code: "metadata-changed" };
    }

    const rendered = await renderRasterDerivatives({
      bytes: original.bytes,
      fileName: candidate.fileName,
      mimeType: original.mimeType,
    });
    if (signal?.aborted) return { status: "deferred", photoId: candidate.photoId, code: "cancelled" };
    if (rendered.status === "ready") {
      return {
        status: "ready",
        photoId: candidate.photoId,
        sourceRevision: candidate.sourceRevision,
        thumbnail: rendered.thumbnail,
        preview: rendered.preview,
      };
    }
    return { ...rendered, photoId: candidate.photoId };
  } catch (error) {
    if (error instanceof DriveProviderError) return providerOutcome(candidate.photoId, error);
    return { status: "failed", photoId: candidate.photoId, code: "unexpected-error" };
  }
}

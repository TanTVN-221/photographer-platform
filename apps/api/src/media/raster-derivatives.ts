import type { SourceImageCandidate, SourceImageFormatId } from "@photographer-platform/shared";
import sharp from "sharp";

import { inspectSourcePrefix } from "./source-preflight.js";

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 6 * 1024 * 1024;
const MAX_INPUT_PIXELS = 80_000_000;
const THUMBNAIL_EDGE = 512;
const PREVIEW_EDGE = 1600;
const PROCESS_TIMEOUT_SECONDS = 10;

const DECODABLE_FORMATS = new Set<SourceImageFormatId>(["jpeg", "png", "webp", "avif", "gif", "tiff"]);

/** Avoid downloading known unsupported originals before invoking this renderer. */
export function supportsRasterDerivatives(formatId: SourceImageFormatId): boolean {
  return DECODABLE_FORMATS.has(formatId);
}

export interface RasterSource extends SourceImageCandidate {
  readonly bytes: Uint8Array;
}

export interface WebpDerivative {
  readonly bytes: Buffer;
  readonly mimeType: "image/webp";
  readonly width: number;
  readonly height: number;
}

export type RasterDerivativeResult =
  | { readonly status: "ready"; readonly thumbnail: WebpDerivative; readonly preview: WebpDerivative }
  | { readonly status: "unsupported-variant"; readonly code: "decoder-not-enabled" | "source-too-large" | "pixel-limit" }
  | { readonly status: "failed"; readonly code: "invalid-source" | "decode-failed" | "output-too-large" };

function expectedDecoderFormat(formatId: SourceImageFormatId, decodedFormat: string, compression?: string): boolean {
  return formatId === "avif"
    ? decodedFormat === "heif" && compression === "av1"
    : decodedFormat === formatId;
}

async function renderWebp(bytes: Uint8Array, edge: number, quality: number): Promise<WebpDerivative> {
  const { data, info } = await sharp(bytes, {
    pages: 1,
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "warning",
  })
    .autoOrient()
    .toColourspace("srgb")
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .timeout({ seconds: PROCESS_TIMEOUT_SECONDS })
    .toBuffer({ resolveWithObject: true });

  if (data.byteLength > MAX_OUTPUT_BYTES) throw new OutputTooLargeError();
  return { bytes: data, mimeType: "image/webp", width: info.width, height: info.height };
}

class OutputTooLargeError extends Error {}

/** CPU/memory-bounded still derivative rendering; the caller must dispose of original bytes. */
export async function renderRasterDerivatives(source: RasterSource): Promise<RasterDerivativeResult> {
  if (source.bytes.byteLength > MAX_SOURCE_BYTES) {
    return { status: "unsupported-variant", code: "source-too-large" };
  }

  const preflight = inspectSourcePrefix(source, source.bytes);
  if (preflight.status === "rejected" || preflight.status === "insufficient-data") {
    return { status: "failed", code: "invalid-source" };
  }
  if (!supportsRasterDerivatives(preflight.formatId)) {
    return { status: "unsupported-variant", code: "decoder-not-enabled" };
  }

  try {
    const metadata = await sharp(source.bytes, {
      pages: 1,
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "warning",
    }).metadata();
    if (
      metadata.width === undefined || metadata.height === undefined ||
      metadata.width <= 0 || metadata.height <= 0
    ) return { status: "failed", code: "decode-failed" };
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      return { status: "unsupported-variant", code: "pixel-limit" };
    }
    if (!expectedDecoderFormat(preflight.formatId, metadata.format, metadata.compression)) {
      return { status: "failed", code: "invalid-source" };
    }

    // Sequential outputs avoid holding two decoded rasters concurrently.
    const thumbnail = await renderWebp(source.bytes, THUMBNAIL_EDGE, 74);
    const preview = await renderWebp(source.bytes, PREVIEW_EDGE, 80);
    return { status: "ready", thumbnail, preview };
  } catch (error) {
    if (error instanceof OutputTooLargeError) return { status: "failed", code: "output-too-large" };
    return { status: "failed", code: "decode-failed" };
  }
}

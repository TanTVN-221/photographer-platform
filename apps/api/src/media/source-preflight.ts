import { classifySourceImage, type SourceImageCandidate, type SourceImageFormatId } from "@photographer-platform/shared";

/** This checks only a bounded prefix. A decoder must still validate the complete file. */
export type SourcePreflightResult =
  | { readonly status: "container-match"; readonly formatId: SourceImageFormatId }
  | { readonly status: "decoder-probe-required"; readonly formatId: SourceImageFormatId }
  | { readonly status: "insufficient-data"; readonly minimumBytes: number }
  | { readonly status: "rejected"; readonly reason: "unrecognized-source" | "non-image-document" | "signature-conflict" | "unknown-signature" };

type Container = "jpeg" | "png" | "webp" | "gif" | "tiff" | "avif" | "heic" | "bmff" | "unknown";

const MINIMUM_BYTES = 16;
const MAX_SCAN_BYTES = 4096;
const TIFF_BACKED_RAW = new Set<SourceImageFormatId>(["dng", "cr2", "nef", "nrw", "arw", "orf", "rw2", "pef"]);
const DIRECT_CONTAINERS = new Set<SourceImageFormatId>(["jpeg", "png", "webp", "gif", "tiff", "avif", "heic", "heif"]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

function matches(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function fourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function detectBmff(bytes: Uint8Array): Container {
  if (fourCC(bytes, 4) !== "ftyp") return "unknown";
  const boxSize = bytes[0]! * 0x1000000 + bytes[1]! * 0x10000 + bytes[2]! * 0x100 + bytes[3]!;
  if (boxSize < 16 || boxSize > bytes.length || boxSize > MAX_SCAN_BYTES) return "bmff";

  const brands = [fourCC(bytes, 8)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(fourCC(bytes, offset));
  }
  if (brands.some((brand) => brand === "avif" || brand === "avis")) return "avif";
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "heic";
  return "bmff";
}

function detectContainer(bytes: Uint8Array): Container {
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (fourCC(bytes, 0) === "GIF8" && (fourCC(bytes, 2) === "F87a" || fourCC(bytes, 2) === "F89a")) return "gif";
  if (fourCC(bytes, 0) === "RIFF" && fourCC(bytes, 8) === "WEBP") return "webp";
  if (
    matches(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    matches(bytes, [0x4d, 0x4d, 0x00, 0x2a]) ||
    matches(bytes, [0x49, 0x49, 0x2b, 0x00]) ||
    matches(bytes, [0x4d, 0x4d, 0x00, 0x2b])
  ) return "tiff";
  return detectBmff(bytes);
}

function isDocumentDisguise(bytes: Uint8Array): boolean {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(start, Math.min(bytes.length, 128)))
    .trimStart();
  return /^<(?:!doctype\s+html|html\b|svg\b|\?xml\b)/i.test(text);
}

export function inspectSourcePrefix(candidate: SourceImageCandidate, prefix: Uint8Array): SourcePreflightResult {
  const classified = classifySourceImage(candidate);
  if (classified.status === "unrecognized") return { status: "rejected", reason: "unrecognized-source" };
  if (prefix.byteLength < MINIMUM_BYTES) return { status: "insufficient-data", minimumBytes: MINIMUM_BYTES };

  const bytes = prefix.subarray(0, MAX_SCAN_BYTES);
  if (isDocumentDisguise(bytes)) return { status: "rejected", reason: "non-image-document" };

  const formatId = classified.format.id;
  const container = detectContainer(bytes);
  if (container === formatId || (formatId === "heif" && container === "heic")) {
    if (classified.warnings.includes("mime-extension-conflict")) {
      return { status: "decoder-probe-required", formatId };
    }
    return { status: "container-match", formatId };
  }
  if (container === "tiff" && TIFF_BACKED_RAW.has(formatId)) {
    return { status: "decoder-probe-required", formatId };
  }
  if (container === "bmff" && (formatId === "avif" || formatId === "heic" || formatId === "heif" || formatId === "cr3")) {
    return { status: "decoder-probe-required", formatId };
  }
  if (container !== "unknown") return { status: "rejected", reason: "signature-conflict" };
  if (DIRECT_CONTAINERS.has(formatId)) return { status: "rejected", reason: "unknown-signature" };
  return { status: "decoder-probe-required", formatId };
}

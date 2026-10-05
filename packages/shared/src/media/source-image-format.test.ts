import { describe, expect, it } from "vitest";

import { SOURCE_IMAGE_FORMATS, classifySourceImage } from "./source-image-format.js";

describe("classifySourceImage", () => {
  it("recognizes a guaranteed browser-native image from matching evidence", () => {
    const result = classifySourceImage({ fileName: "delivery/IMG_1042.JPEG", mimeType: "image/jpeg" });

    expect(result).toMatchObject({
      status: "recognized",
      evidence: "both",
      extension: "jpeg",
      normalizedMimeType: "image/jpeg",
      format: { id: "jpeg", kind: "browser-native", supportLevel: "guaranteed" },
      warnings: [],
    });
  });

  it("normalizes MIME parameters and case", () => {
    const result = classifySourceImage({ fileName: "proof.AVIF", mimeType: " Image/AVIF; codecs=av01 " });

    expect(result).toMatchObject({
      status: "recognized",
      evidence: "both",
      format: { id: "avif" },
      normalizedMimeType: "image/avif",
    });
  });

  it("recognizes legacy JPEG aliases", () => {
    const result = classifySourceImage({ fileName: "scan.jfif", mimeType: "image/pjpeg" });

    expect(result).toMatchObject({
      status: "recognized",
      evidence: "both",
      format: { id: "jpeg" },
      warnings: [],
    });
  });

  it("uses a RAW extension when Drive reports a generic MIME type", () => {
    const result = classifySourceImage({ fileName: "DSC_9001.NEF", mimeType: "application/octet-stream" });

    expect(result).toMatchObject({
      status: "recognized",
      evidence: "extension",
      format: { id: "nef", kind: "camera-raw", previewStrategy: "extract-raw-preview" },
      warnings: ["generic-mime-type"],
    });
  });

  it("prefers the extension for discovery when recognized metadata conflicts", () => {
    const result = classifySourceImage({ fileName: "portrait.CR3", mimeType: "image/jpeg" });

    expect(result).toMatchObject({
      status: "recognized",
      evidence: "extension",
      format: { id: "cr3" },
      warnings: ["mime-extension-conflict"],
    });
  });

  it("keeps a recognized extension when Drive supplies an unknown MIME alias", () => {
    const result = classifySourceImage({ fileName: "portrait.RAF", mimeType: "image/vnd.fuji.raw" });

    expect(result).toMatchObject({
      status: "recognized",
      evidence: "extension",
      format: { id: "raf" },
      warnings: ["unrecognized-mime-type"],
    });
  });

  it("recognizes a file by MIME type when the filename has no known extension", () => {
    const result = classifySourceImage({ fileName: "untitled", mimeType: "image/heic" });

    expect(result).toMatchObject({
      status: "recognized",
      evidence: "mime-type",
      format: { id: "heic", kind: "converted-raster" },
    });
  });

  it("marks extended professional formats as best effort", () => {
    const result = classifySourceImage({ fileName: "retouched-final.PSD", mimeType: "image/vnd.adobe.photoshop" });

    expect(result).toMatchObject({
      status: "recognized",
      format: { id: "psd", supportLevel: "best-effort", previewStrategy: "flatten-composite" },
    });
  });

  it("does not accept an arbitrary image-like extension", () => {
    expect(classifySourceImage({ fileName: "payload.svg", mimeType: "image/svg+xml" })).toEqual({
      status: "unrecognized",
      reason: "unsupported-format",
      extension: "svg",
      normalizedMimeType: "image/svg+xml",
    });
  });

  it("distinguishes missing evidence from an unsupported format", () => {
    expect(classifySourceImage({ fileName: "README" })).toEqual({
      status: "unrecognized",
      reason: "missing-format-evidence",
      extension: null,
      normalizedMimeType: null,
    });
  });
});

describe("SOURCE_IMAGE_FORMATS", () => {
  it("does not contain duplicate extensions or MIME aliases", () => {
    const extensions = SOURCE_IMAGE_FORMATS.flatMap((format) => format.extensions);
    const mimeTypes = SOURCE_IMAGE_FORMATS.flatMap((format) => format.mimeTypes);

    expect(new Set(extensions).size).toBe(extensions.length);
    expect(new Set(mimeTypes).size).toBe(mimeTypes.length);
  });

  it("contains every guaranteed source family in the product requirement", () => {
    const guaranteedIds = SOURCE_IMAGE_FORMATS
      .filter((format) => format.supportLevel === "guaranteed")
      .map((format) => format.id);

    expect(guaranteedIds).toEqual([
      "jpeg",
      "png",
      "webp",
      "avif",
      "gif",
      "heic",
      "heif",
      "tiff",
      "dng",
      "cr2",
      "cr3",
      "nef",
      "nrw",
      "arw",
      "raf",
      "orf",
      "rw2",
      "pef",
    ]);
  });
});

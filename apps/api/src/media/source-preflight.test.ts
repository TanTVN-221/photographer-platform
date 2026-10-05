import { describe, expect, it } from "vitest";

import { inspectSourcePrefix } from "./source-preflight.js";

function header(...bytes: number[]): Uint8Array {
  const prefix = new Uint8Array(32);
  prefix.set(bytes);
  return prefix;
}

function textHeader(value: string): Uint8Array {
  const prefix = new Uint8Array(64);
  prefix.set(new TextEncoder().encode(value));
  return prefix;
}

function ftyp(major: string, compatible?: string): Uint8Array {
  const prefix = new Uint8Array(32);
  prefix[3] = compatible === undefined ? 16 : 20;
  prefix.set(new TextEncoder().encode("ftyp"), 4);
  prefix.set(new TextEncoder().encode(major), 8);
  if (compatible !== undefined) prefix.set(new TextEncoder().encode(compatible), 16);
  return prefix;
}

describe("source byte preflight (DRIVE-016, DRIVE-017, SEC-001)", () => {
  it.each([
    ["photo.jpg", header(0xff, 0xd8, 0xff), "jpeg"],
    ["photo.png", header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "png"],
    ["photo.gif", textHeader("GIF89a"), "gif"],
    ["old.gif", textHeader("GIF87a"), "gif"],
    ["photo.webp", textHeader("RIFF0000WEBP"), "webp"],
    ["photo.tiff", header(0x49, 0x49, 0x2a, 0x00), "tiff"],
    ["large.tiff", header(0x4d, 0x4d, 0x00, 0x2b), "tiff"],
    ["photo.avif", ftyp("mif1", "avif"), "avif"],
    ["photo.heic", ftyp("heic"), "heic"],
    ["photo.heif", ftyp("mif1", "heic"), "heif"],
  ] as const)("recognizes only the container prefix for %s", (fileName, prefix, formatId) => {
    expect(inspectSourcePrefix({ fileName }, prefix)).toEqual({ status: "container-match", formatId });
  });

  it("uses MIME classification when the extension is not informative", () => {
    expect(inspectSourcePrefix({ fileName: "download.bin", mimeType: "image/png" },
      header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
      .toEqual({ status: "container-match", formatId: "png" });
  });

  it("rejects a known container that conflicts with the claimed source", () => {
    expect(inspectSourcePrefix({ fileName: "photo.jpg" },
      header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
      .toEqual({ status: "rejected", reason: "signature-conflict" });
    expect(inspectSourcePrefix({ fileName: "photo.cr3" }, ftyp("avif")))
      .toEqual({ status: "rejected", reason: "signature-conflict" });
  });

  it("does not treat a conflicting MIME type as a clean container match", () => {
    expect(inspectSourcePrefix({ fileName: "photo.jpg", mimeType: "image/png" },
      header(0xff, 0xd8, 0xff)))
      .toEqual({ status: "decoder-probe-required", formatId: "jpeg" });
  });

  it("rejects obvious HTML and SVG disguises, including a UTF-8 BOM", () => {
    expect(inspectSourcePrefix({ fileName: "photo.nef" }, textHeader("  <!DOCTYPE html><html>")))
      .toEqual({ status: "rejected", reason: "non-image-document" });
    expect(inspectSourcePrefix({ fileName: "photo.png" },
      header(0xef, 0xbb, 0xbf, 0x20, 0x3c, 0x73, 0x76, 0x67, 0x20)))
      .toEqual({ status: "rejected", reason: "non-image-document" });
  });

  it("requires a decoder-specific probe for ambiguous RAW and generic BMFF containers", () => {
    expect(inspectSourcePrefix({ fileName: "photo.dng" }, header(0x49, 0x49, 0x2a, 0x00)))
      .toEqual({ status: "decoder-probe-required", formatId: "dng" });
    expect(inspectSourcePrefix({ fileName: "photo.nef" }, header(0x4d, 0x4d, 0x00, 0x2a)))
      .toEqual({ status: "decoder-probe-required", formatId: "nef" });
    expect(inspectSourcePrefix({ fileName: "photo.cr3" }, ftyp("crx ")))
      .toEqual({ status: "decoder-probe-required", formatId: "cr3" });
    expect(inspectSourcePrefix({ fileName: "photo.heif" }, ftyp("mif1")))
      .toEqual({ status: "decoder-probe-required", formatId: "heif" });
  });

  it("rejects unknown raster signatures and unrecognized source metadata", () => {
    expect(inspectSourcePrefix({ fileName: "photo.jpg" }, textHeader("not a jpeg")))
      .toEqual({ status: "rejected", reason: "unknown-signature" });
    expect(inspectSourcePrefix({ fileName: "photo.svg" },
      header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
      .toEqual({ status: "rejected", reason: "unrecognized-source" });
  });

  it("requires enough bytes before attempting a format decision", () => {
    expect(inspectSourcePrefix({ fileName: "photo.png" }, new Uint8Array(4)))
      .toEqual({ status: "insufficient-data", minimumBytes: 16 });
  });
});

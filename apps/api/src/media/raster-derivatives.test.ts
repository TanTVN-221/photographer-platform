import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { renderRasterDerivatives } from "./raster-derivatives.js";

const createImage = () => sharp({
  create: { width: 320, height: 160, channels: 3, background: { r: 188, g: 82, b: 53 } },
});

describe("bounded raster derivatives (DRIVE-016/017, IMG-001/006/007)", () => {
  it.each([
    ["jpg", "jpeg"],
    ["png", "png"],
    ["webp", "webp"],
    ["gif", "gif"],
    ["tiff", "tiff"],
    ["avif", "avif"],
  ] as const)("converts %s into static browser-safe WebP derivatives", async (extension, format) => {
    const bytes = await createImage().toFormat(format, format === "avif" ? { effort: 1 } : {}).toBuffer();
    const result = await renderRasterDerivatives({ fileName: `photo.${extension}`, bytes });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    for (const derivative of [result.thumbnail, result.preview]) {
      const metadata = await sharp(derivative.bytes).metadata();
      expect(derivative.mimeType).toBe("image/webp");
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(320);
      expect(metadata.height).toBe(160);
      expect(metadata.pages ?? 1).toBe(1);
      expect(metadata.exif).toBeUndefined();
      expect(derivative.bytes.byteLength).toBeLessThan(6 * 1024 * 1024);
    }
  }, 20_000);

  it("respects thumbnail/preview edge limits and does not upscale", async () => {
    const bytes = await sharp({
      create: { width: 1800, height: 900, channels: 3, background: "#cf8174" },
    }).jpeg().toBuffer();
    const result = await renderRasterDerivatives({ fileName: "wide.jpg", bytes });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect([result.thumbnail.width, result.thumbnail.height]).toEqual([512, 256]);
    expect([result.preview.width, result.preview.height]).toEqual([1600, 800]);
  });

  it("applies EXIF orientation then strips source metadata", async () => {
    const bytes = await sharp({
      create: { width: 240, height: 120, channels: 3, background: "#21568a" },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const sourceMetadata = await sharp(bytes).metadata();
    expect(sourceMetadata.orientation).toBe(6);

    const result = await renderRasterDerivatives({ fileName: "portrait.jpg", bytes });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const metadata = await sharp(result.preview.bytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([120, 240]);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.space).toBe("srgb");
  });

  it("uses one representative still for an animated input", async () => {
    const first = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
    const second = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer();
    const bytes = await sharp([first, second], { join: { animated: true } }).gif().toBuffer();
    expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2);

    const result = await renderRasterDerivatives({ fileName: "animated.gif", bytes });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect((await sharp(result.preview.bytes).metadata()).pages ?? 1).toBe(1);
  });

  it("rejects mismatched and corrupt raster bytes without exposing decoder errors", async () => {
    const png = await createImage().png().toBuffer();
    expect(await renderRasterDerivatives({ fileName: "wrong.jpg", bytes: png }))
      .toEqual({ status: "failed", code: "invalid-source" });
    expect(await renderRasterDerivatives({ fileName: "broken.jpg", bytes: Buffer.from([0xff, 0xd8, 0xff, ...new Array(20).fill(0)]) }))
      .toEqual({ status: "failed", code: "decode-failed" });
  });

  it("reports RAW and HEIC as unsupported by this renderer", async () => {
    const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, ...new Array(28).fill(0)]);
    expect(await renderRasterDerivatives({ fileName: "camera.dng", bytes: tiffHeader }))
      .toEqual({ status: "unsupported-variant", code: "decoder-not-enabled" });

    const heicHeader = Buffer.alloc(32);
    heicHeader[3] = 16;
    heicHeader.write("ftyp", 4);
    heicHeader.write("heic", 8);
    expect(await renderRasterDerivatives({ fileName: "phone.heic", bytes: heicHeader }))
      .toEqual({ status: "unsupported-variant", code: "decoder-not-enabled" });
  });

  it("refuses oversize source buffers before invoking the decoder", async () => {
    const bytes = Buffer.alloc(64 * 1024 * 1024 + 1);
    expect(await renderRasterDerivatives({ fileName: "huge.jpg", bytes }))
      .toEqual({ status: "unsupported-variant", code: "source-too-large" });
  });
});

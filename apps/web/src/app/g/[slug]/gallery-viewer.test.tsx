import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GalleryPhotoListItem } from "@photographer-platform/shared";

import { galleryCopy } from "../../../lib/i18n";
import { GalleryViewer, movePreviewIndex } from "./gallery-viewer";

const photos: GalleryPhotoListItem[] = [
  {
    photoId: "photo-1",
    fileName: "IMG_001.CR3",
    width: 4000,
    height: 6000,
    previewStatus: "READY",
    images: {
      thumbnail: { src: "https://api.example.test/thumbnail-1.webp", width: 4000, height: 6000 },
      preview: { src: "https://api.example.test/preview-1.webp", width: 4000, height: 6000 },
    },
  },
  {
    photoId: "photo-2",
    fileName: "IMG_002.HEIC",
    width: null,
    height: null,
    previewStatus: "PENDING",
    images: null,
  },
];
const slug = "AbCdEfGhIjKlMnOpQrStUvWx";

describe("bounded gallery viewer (GAL-004/005/006, IMG-001/002, PERF-002/003/004, UX-001)", () => {
  it("renders only current-page lazy thumbnails and readable fallback cards before opening", () => {
    const markup = renderToStaticMarkup(createElement(GalleryViewer, { photos, locale: "en", slug, selection: null }));
    expect(markup).toContain("thumbnail-1.webp");
    expect(markup).not.toContain("preview-1.webp");
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain("4000 / 6000");
    expect(markup).toContain("IMG_002.HEIC");
    expect(markup).toContain("Preview pending");
    expect(markup.match(/gallery-card-open/g)).toHaveLength(1);
  });

  it("localizes preview controls and leaves no original-resolution URL in the page", () => {
    const markup = renderToStaticMarkup(createElement(GalleryViewer, { photos, locale: "vi", slug, selection: null }));
    expect(markup).toContain("Mở ảnh xem trước IMG_001.CR3");
    expect(galleryCopy.vi.closePreview).toBe("Đóng ảnh xem trước");
    expect(markup).not.toContain("drive.google.com");
  });

  it("keeps keyboard/button navigation within the bounded current page", () => {
    expect(movePreviewIndex(0, 3, -1)).toBe(0);
    expect(movePreviewIndex(0, 3, 1)).toBe(1);
    expect(movePreviewIndex(2, 3, 1)).toBe(2);
    expect(movePreviewIndex(0, 0, 1)).toBe(0);
  });

  it("renders authoritative selected count and selected controls only while draft", () => {
    const draft = { status: "DRAFT" as const, selectedCount: 1, selectionLimit: 2,
      selectedItems: [{ photoId: "photo-1", comment: "Favorite" }] };
    const markup = renderToStaticMarkup(createElement(GalleryViewer, { photos, locale: "en", slug, selection: draft }));
    expect(markup).toContain("1 of 2 selected");
    expect(markup).toContain("Deselect photo");
    expect(markup).toContain("Submit selection");
    expect(markup).toContain("Favorite");

    const submitted = renderToStaticMarkup(createElement(GalleryViewer, {
      photos, locale: "en", slug, selection: { ...draft, status: "SUBMITTED" },
    }));
    expect(submitted).toContain("Your selection has been submitted");
    expect(submitted).not.toContain("Submit selection");
    expect(submitted).not.toContain("Deselect photo");

    const locked = renderToStaticMarkup(createElement(GalleryViewer, {
      photos, locale: "vi", slug, selection: { ...draft, status: "LOCKED" },
    }));
    expect(locked).toContain("được khóa");
  });

  it("disables new selects at the limit while leaving deselection available", () => {
    const markup = renderToStaticMarkup(createElement(GalleryViewer, {
      photos, locale: "en", slug,
      selection: { status: "DRAFT", selectedCount: 1, selectionLimit: 1,
        selectedItems: [{ photoId: "photo-1", comment: null }] },
    }));
    expect(markup).toContain("Selection limit reached");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false" disabled=""');
  });
});

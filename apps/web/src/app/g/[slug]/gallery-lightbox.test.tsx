import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { galleryCopy, type Locale } from "../../../lib/i18n";
import { GalleryLightbox, type ViewablePhoto } from "./gallery-lightbox";

const photo: ViewablePhoto = { photoId: "photo-1", fileName: "IMG_001.CR3", width: 4_000, height: 6_000,
  previewStatus: "READY", images: {
    thumbnail: { src: "https://api.example.test/thumbnail.webp", width: 512, height: 768 },
    preview: { src: "https://api.example.test/preview.webp", width: 1_067, height: 1_600 },
  } };

function render(locale: Locale, index = 0, count = 2, editable = false, disabled = false) {
  return renderToStaticMarkup(createElement(GalleryLightbox, {
    photo, index, count, copy: galleryCopy[locale], editable, selected: true, disabled,
    onDismiss: () => undefined, onNavigate: () => undefined, onToggle: () => undefined,
  }));
}

describe("generated-preview lightbox (GAL-004/005/006, UX-001, IMG-001/002)", () => {
  it.each(["en", "vi"] as const)("localizes instructions and announces page position/filename in %s", (locale) => {
    const markup = render(locale);
    expect(markup).toContain(galleryCopy[locale].previewHelp);
    expect(markup).toContain(galleryCopy[locale].previewNavigationLabel);
    expect(markup).toContain(galleryCopy[locale].photoPosition(1, 2));
    expect(markup).toContain('aria-live="polite" aria-atomic="true"');
    expect(markup).toContain('aria-describedby="gallery-lightbox-help"');
    expect(markup).toContain(galleryCopy[locale].closePreview);
  });

  it("mounts exactly one application preview with drag disabled, not thumbnails or originals", () => {
    const markup = render("en");
    expect(markup.match(/<img /g)).toHaveLength(1);
    expect(markup).toContain("preview.webp");
    expect(markup).toContain('draggable="false"');
    expect(markup).not.toContain("thumbnail.webp");
    expect(markup).not.toContain("drive.google.com");
  });

  it("keeps selection explicit and disables it for authoritative limit/busy states", () => {
    expect(render("en")).not.toContain('aria-pressed');
    expect(render("en", 0, 2, true, false)).toContain('aria-pressed="true"');
    expect(render("en", 0, 2, true, true)).toContain('aria-pressed="true" disabled=""');
    expect(render("en", 0, 2, true)).not.toContain("Submit selection");
  });

  it("disables both directions for a single-photo page", () => {
    const markup = render("en", 0, 1);
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OwnerReviewPage } from "@photographer-platform/shared";
vi.mock("./actions", () => ({ updateAlbum: vi.fn() }));
import { OwnerAlbumReview } from "./review";
import { AlbumList } from "../../album-list";

function data(): OwnerReviewPage {
  return { album: { albumId: "album", title: "Wedding", publicSlug: "a".repeat(24), status: "PUBLISHED",
    selectionStatus: "SUBMITTED", selectedCount: 2, photoCount: 100, passwordProtected: true, selectionLimit: 50,
    createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z" },
    submittedAt: "2026-10-04T00:00:00.000Z", lockedAt: null, nextCursor: "opaque",
    items: [{ photoId: "photo1", fileName: "IMG_2.jpg", active: true, comment: "<script>bad</script>",
      thumbnail: { src: "/api/v1/workspace/albums/album/images/photo1", width: 1200, height: 800 } },
    { photoId: "photo2", fileName: "IMG_10.HEIC", active: false, comment: "Retouch this", thumbnail: null }] };
}
function markup(value: OwnerReviewPage, locale: "en" | "vi" = "en") {
  return renderToStaticMarkup(createElement(OwnerAlbumReview, {
    data: value, locale, publicApi: "http://127.0.0.1:4000", webOrigin: "http://127.0.0.1:3000",
  }));
}
describe("bounded bilingual owner review (SEL-010, EXP-001, UX-001, ALB-006)", () => {
  it("renders lazy authorized thumbnails, removed-photo comments and safe download/gallery links", () => {
    const html = markup(data());
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("http://127.0.0.1:4000/api/v1/workspace/albums/album/images/photo1");
    expect(html).toContain("selection/export"); expect(html).toContain("Copy gallery link");
    expect(html).toContain("No longer in the source folder"); expect(html).toContain("Retouch this");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;"); expect(html).not.toContain("<script>bad</script>");
    expect(html).toContain("Preview unavailable"); expect(html).not.toContain("drive.google.com");
    expect(html).toMatch(/type="checkbox"[^>]*required=""[^>]*name="confirmation"/);
    expect(html).toContain("Next page");
  });
  it("localizes controls and comments without inventing thumbnails", () => {
    const html = markup(data(), "vi");
    expect(html).toContain("Lựa chọn của khách hàng"); expect(html).toContain("Tải tên tệp (.txt)");
    expect(html).toContain("Không còn trong thư mục nguồn"); expect(html).toContain("Chưa có bản xem trước");
    expect(html).toContain("Tôi xác nhận lưu trữ");
  });
  it("gates export and lifecycle controls by backend status", () => {
    const draft = data(); draft.album.selectionStatus = "DRAFT"; draft.submittedAt = null;
    const draftHtml = markup(draft);
    expect(draftHtml).not.toContain("selection/export"); expect(draftHtml).not.toContain("Lock submitted selection");
    expect(draftHtml).not.toContain("Reopen for client edits");
    const archived = data(); archived.album.status = "ARCHIVED";
    const archivedHtml = markup(archived);
    expect(archivedHtml).toContain("selection/export"); expect(archivedHtml).not.toContain("Copy gallery link");
    expect(archivedHtml).not.toContain("Archive album"); expect(archivedHtml).not.toContain("Reopen for client edits");
  });
  it("renders album summary counts/status/dates and bounded navigation in both languages", () => {
    for (const locale of ["en", "vi"] as const) {
      const html = renderToStaticMarkup(createElement(AlbumList, { locale, cursor: "prior", result: {
        status: "available", data: { albums: [data().album], nextCursor: "opaque" },
      } }));
      expect(html).toContain("100"); expect(html).toContain("Wedding");
      expect(html).toContain("/workspace/albums/album"); expect(html).toContain("cursor=opaque");
      expect(html).toContain(locale === "vi" ? "Ngày tạo" : "Created");
    }
  });
});

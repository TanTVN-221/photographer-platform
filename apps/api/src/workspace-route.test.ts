import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { SelectionError } from "./selection/selection-service.js";
import { WorkspaceError } from "./workspace/owner-cursor.js";

const token = "a".repeat(43);
const origin = "http://127.0.0.1:3000";
function fixture(secure = false) {
  const owner = { id: "owner", email: "owner@example.test", displayName: "Owner" };
  const auth = { begin: vi.fn(), complete: vi.fn(), logout: vi.fn(),
    authenticate: vi.fn(async (value: string | null) => value === token ? owner : null) };
  const workspace = { albums: vi.fn().mockResolvedValue({ albums: [], nextCursor: null }),
    review: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), archive: vi.fn().mockResolvedValue(undefined) };
  const selections = { lockForOwner: vi.fn().mockResolvedValue({ status: "LOCKED", submittedAt: new Date(), lockedAt: new Date() }),
    reopenForOwner: vi.fn().mockResolvedValue({ status: "DRAFT", submittedAt: null, lockedAt: null }),
    exportSubmittedForOwner: vi.fn().mockResolvedValue("IMG_2.jpg\nIMG_10.jpg\n") };
  const images = { read: vi.fn().mockResolvedValue(Buffer.from("thumbnail")) };
  const app = createApp({ ownerAuth: auth, ownerAuthConfig: { webOrigin: origin, secure },
    workspace, ownerSelections: selections, ownerReviewImages: images });
  return { app, auth, workspace, selections, images, cookie: `${secure ? "__Host-" : ""}pp-owner=${token}` };
}
describe("private workspace routes (AUTH-001/004, ALB-004/005/006, EXP-001/002/003)", () => {
  it("fails closed when not configured or not authenticated", async () => {
    const unconfigured = await request(createApp()).get("/api/v1/workspace/albums");
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.headers["cache-control"]).toBe("no-store");
    const { app, workspace, selections, images } = fixture();
    for (const path of ["/albums", "/albums/album/selection", "/albums/album/selection/export", "/albums/album/images/photo"]) {
      expect((await request(app).get(`/api/v1/workspace${path}`)).status).toBe(401);
    }
    expect((await request(app).post("/api/v1/workspace/albums/album/archive").send({ confirmation: "archive" })).status).toBe(401);
    expect(workspace.albums).not.toHaveBeenCalled(); expect(workspace.archive).not.toHaveBeenCalled();
    expect(selections.exportSubmittedForOwner).not.toHaveBeenCalled(); expect(images.read).not.toHaveBeenCalled();
  });
  it("passes identity only from the authenticated cookie, never from browser IDs", async () => {
    const { app, cookie, workspace, auth } = fixture(true);
    const result = await request(app).get("/api/v1/workspace/albums?cursor=opaque").set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(auth.authenticate).toHaveBeenCalledWith(token);
    expect(workspace.albums).toHaveBeenCalledWith("owner", "opaque");
    const forged = await request(app).get("/api/v1/workspace/albums?ownerId=other").set("Cookie", cookie);
    expect(forged.status).toBe(400);
    expect(workspace.albums).toHaveBeenCalledOnce();
    const review = await request(app).get("/api/v1/workspace/albums/album/selection?cursor=opaque").set("Cookie", cookie);
    expect(review.status).toBe(200);
    expect(workspace.review).toHaveBeenCalledWith("owner", "album", "opaque");
  });
  it("exports text/plain with a fixed safe download filename and no public caching", async () => {
    const { app, cookie, selections } = fixture();
    const result = await request(app).get("/api/v1/workspace/albums/album/selection/export").set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(result.headers["content-disposition"]).toBe('attachment; filename="selected-filenames.txt"');
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.text).toBe("IMG_2.jpg\nIMG_10.jpg\n");
    expect(selections.exportSubmittedForOwner).toHaveBeenCalledWith("owner", "album");
  });
  it("requires exact mutation origin, strict bodies and explicit archive confirmation", async () => {
    const { app, cookie, workspace, selections } = fixture();
    for (const badOrigin of [undefined, "https://attacker.test", "null", `${origin}/wrong`]) {
      const mutation = request(app).post("/api/v1/workspace/albums/album/lock").set("Cookie", cookie).send({});
      if (badOrigin !== undefined) mutation.set("Origin", badOrigin);
      expect((await mutation).status).toBe(403);
    }
    expect(selections.lockForOwner).not.toHaveBeenCalled();
    for (const body of [{}, { confirmation: "delete" }, { confirmation: "archive", ownerId: "other" }]) {
      expect((await request(app).post("/api/v1/workspace/albums/album/archive").set("Cookie", cookie).set("Origin", origin).send(body)).status).toBe(400);
    }
    expect(workspace.archive).not.toHaveBeenCalled();
    const success = await request(app).post("/api/v1/workspace/albums/album/archive").set("Cookie", cookie)
      .set("Referer", `${origin}/workspace`).send({ confirmation: "archive" });
    expect(success.status).toBe(204); expect(workspace.archive).toHaveBeenCalledWith("owner", "album");
  });
  it("exposes only owner-authorized lock/reopen and derivative operations", async () => {
    const { app, cookie, selections, images } = fixture();
    for (const action of ["lock", "reopen"]) {
      const result = await request(app).post(`/api/v1/workspace/albums/album/${action}`).set("Cookie", cookie).set("Origin", origin).send({});
      expect(result.status).toBe(200);
      expect(result.body.status).toBe(action === "lock" ? "LOCKED" : "DRAFT");
    }
    expect(selections.lockForOwner).toHaveBeenCalledWith("owner", "album");
    expect(selections.reopenForOwner).toHaveBeenCalledWith("owner", "album");
    const image = await request(app).get("/api/v1/workspace/albums/album/images/photo").set("Cookie", cookie);
    expect(image.status).toBe(200); expect(image.headers["content-type"]).toBe("image/webp");
    expect(image.headers["cache-control"]).toBe("no-store"); expect(images.read).toHaveBeenCalledWith("owner", "album", "photo");
  });
  it("maps owner isolation, stale cursors and lifecycle conflicts without leaking internals", async () => {
    const { app, cookie, workspace, selections } = fixture();
    workspace.review.mockRejectedValueOnce(new WorkspaceError("not-found"));
    expect((await request(app).get("/api/v1/workspace/albums/other/selection").set("Cookie", cookie)).status).toBe(404);
    workspace.albums.mockRejectedValueOnce(new WorkspaceError("invalid-cursor"));
    expect((await request(app).get("/api/v1/workspace/albums?cursor=opaque").set("Cookie", cookie)).status).toBe(400);
    workspace.review.mockRejectedValueOnce(new WorkspaceError("stale-cursor"));
    const stale = await request(app).get("/api/v1/workspace/albums/album/selection?cursor=opaque").set("Cookie", cookie);
    expect(stale.status).toBe(409); expect(stale.body.error.code).toBe("STALE_CURSOR");
    selections.exportSubmittedForOwner.mockRejectedValueOnce(new SelectionError("owner-not-found"));
    expect((await request(app).get("/api/v1/workspace/albums/other/selection/export").set("Cookie", cookie)).status).toBe(404);
    selections.lockForOwner.mockRejectedValueOnce(new SelectionError("not-submitted"));
    expect((await request(app).post("/api/v1/workspace/albums/album/lock").set("Cookie", cookie).set("Origin", origin).send({})).status).toBe(409);
    workspace.albums.mockRejectedValueOnce(new Error("database-secret-and-private-path"));
    const failure = await request(app).get("/api/v1/workspace/albums").set("Cookie", cookie);
    expect(failure.status).toBe(503); expect(failure.text).not.toContain("database-secret");
  });
  it("limits mutations without invoking services after the threshold", async () => {
    const { app, cookie, selections } = fixture();
    let limited = false;
    for (let index = 0; index < 80; index++) {
      const result = await request(app).post("/api/v1/workspace/albums/album/lock").set("Cookie", cookie).set("Origin", origin).send({});
      if (result.status === 429) { expect(result.headers["retry-after"]).toBeDefined(); limited = true; break; }
    }
    expect(limited).toBe(true);
    const before = selections.lockForOwner.mock.calls.length;
    expect((await request(app).post("/api/v1/workspace/albums/album/lock").set("Cookie", cookie).set("Origin", origin).send({})).status).toBe(429);
    expect(selections.lockForOwner).toHaveBeenCalledTimes(before);
  });
});

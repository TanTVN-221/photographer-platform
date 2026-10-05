import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GoogleDriveOriginalReader } from "./google-drive-original-reader.js";

const source = Buffer.from("a small photograph fixture");
const checksum = createHash("md5").update(source).digest("hex");
const request = { driveFileId: "image_123", folderId: "folder_123", expectedRevision: `md5:${checksum}` };

function metadata(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: request.driveFileId,
    mimeType: "image/jpeg",
    size: String(source.byteLength),
    md5Checksum: checksum,
    version: "3",
    parents: [request.folderId],
    trashed: false,
    capabilities: { canDownload: true },
    ...overrides,
  }), { headers: { "Content-Type": "application/json" } });
}

function media(bytes: Uint8Array = source): Response {
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg" } });
}

function harness(responses: Response[]) {
  const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
    const next = responses.shift();
    if (next === undefined) throw new Error("Unexpected Drive request");
    return next;
  });
  const sleep = vi.fn(async (_milliseconds: number) => undefined);
  const onEvent = vi.fn();
  return {
    reader: new GoogleDriveOriginalReader({
      getAccessToken: async () => "secret-access-token",
      fetchImpl,
      sleep,
      random: () => 0,
      onEvent,
    }),
    fetchImpl,
    sleep,
    onEvent,
  };
}

describe("GoogleDriveOriginalReader", () => {
  it("checks metadata before and after a bounded private media read", async () => {
    const { reader, fetchImpl, onEvent } = harness([metadata(), media(), metadata()]);
    const result = await reader.readOriginalImage(request);

    expect(result.bytes).toEqual(source);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.sourceRevision).toBe(request.expectedRevision);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const firstUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    const mediaUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(firstUrl.searchParams.get("fields")).toContain("capabilities(canDownload)");
    expect(firstUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(mediaUrl.searchParams.get("alt")).toBe("media");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer secret-access-token" });
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("secret-access-token");
  });

  it.each([
    ["moved", { parents: ["other_folder"] }, "not-found"],
    ["trashed", { trashed: true }, "invalid-response"],
    ["denied", { capabilities: { canDownload: false } }, "permission"],
    ["stale", { md5Checksum: "different" }, "stale-source"],
    ["large", { size: String(64 * 1024 * 1024 + 1) }, "source-too-large"],
    ["document", { mimeType: "application/vnd.google-apps.document" }, "invalid-response"],
  ])("does not download a %s file", async (_case, change, code) => {
    const { reader, fetchImpl } = harness([metadata(change)]);
    await expect(reader.readOriginalImage(request)).rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects stale postflight metadata rather than returning fetched bytes", async () => {
    const { reader, fetchImpl } = harness([metadata(), media(), metadata({ parents: ["other_folder"] })]);
    await expect(reader.readOriginalImage(request)).rejects.toMatchObject({ code: "not-found" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("detects changed content even when metadata still matches", async () => {
    const { reader, fetchImpl } = harness([metadata(), media(Buffer.from("different content"))]);
    await expect(reader.readOriginalImage(request)).rejects.toMatchObject({ code: "stale-source" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses Drive version when a file has no MD5 and rejects a version change", async () => {
    const versionRequest = { ...request, expectedRevision: "version:3" };
    const noMd5 = { md5Checksum: undefined };
    const { reader, fetchImpl } = harness([
      metadata(noMd5),
      media(),
      metadata({ ...noMd5, version: "4" }),
    ]);
    await expect(reader.readOriginalImage(versionRequest)).rejects.toMatchObject({ code: "stale-source" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized declared and streamed downloads", async () => {
    const declared = new Response(new Uint8Array(source), {
      headers: { "Content-Length": String(64 * 1024 * 1024 + 1) },
    });
    const oneMiB = new Uint8Array(1024 * 1024);
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(oneMiB);
        chunks += 1;
        if (chunks === 65) controller.close();
      },
    });
    const streamed = new Response(body);
    await expect(harness([metadata(), declared]).reader.readOriginalImage(request)).rejects.toMatchObject({ code: "source-too-large" });
    await expect(harness([metadata(), streamed]).reader.readOriginalImage(request)).rejects.toMatchObject({ code: "source-too-large" });
  });

  it("follows a Google download redirect without forwarding the OAuth token", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "https://download.googleusercontent.com/file?id=opaque" },
    });
    const { reader, fetchImpl } = harness([metadata(), redirect, media(), metadata()]);
    await expect(reader.readOriginalImage(request)).resolves.toMatchObject({ sourceRevision: request.expectedRevision });
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toEqual({ Accept: "*/*" });
    expect(new URL(String(fetchImpl.mock.calls[2]?.[0])).hostname).toBe("download.googleusercontent.com");
  });

  it.each([
    "https://evil.example/download",
    "http://download.googleusercontent.com/file",
    "https://download.googleusercontent.com.evil.example/file",
    "https://user:pass@download.googleusercontent.com/file",
  ])("rejects unsafe redirect %s", async (location) => {
    const { reader, fetchImpl } = harness([metadata(), new Response(null, { status: 302, headers: { Location: location } })]);
    await expect(reader.readOriginalImage(request)).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries transient metadata and media responses with redacted events", async () => {
    const busy = new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }], message: "private error" } }), { status: 403 });
    const transient = new Response("private error", { status: 503 });
    const { reader, fetchImpl, sleep, onEvent } = harness([busy, metadata(), transient, media(), metadata()]);
    await expect(reader.readOriginalImage(request)).resolves.toMatchObject({ sourceRevision: request.expectedRevision });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 250]);
    expect(onEvent.mock.calls.filter(([event]) => event.outcome === "retry")).toHaveLength(2);
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("private error");
  });

  it("rejects malformed requests and caller cancellation before fetch", async () => {
    const { reader, fetchImpl } = harness([]);
    await expect(reader.readOriginalImage({ ...request, driveFileId: "bad/id" })).rejects.toMatchObject({ code: "invalid-request" });
    const controller = new AbortController();
    controller.abort();
    await expect(reader.readOriginalImage(request, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not include provider response text or tokens in errors", async () => {
    const { reader, onEvent } = harness([
      new Response(JSON.stringify({ error: { message: "private Drive URL secret" } }), { status: 401 }),
    ]);
    let failure: unknown;
    try {
      await reader.readOriginalImage(request);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "authentication" });
    expect(String(failure)).not.toContain("private Drive URL secret");
    expect(String(failure)).not.toContain("secret-access-token");
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("private Drive URL secret");
  });
});

import { describe, expect, it, vi } from "vitest";

import { getDriveConnections } from "./drive-connections";

const token = "a".repeat(43);
const connection = {
  connectionId: "connection_1",
  accountEmail: "drive@example.test",
  status: "connected" as const,
  scopeMode: "drive-file" as const,
  connectedAt: "2026-10-01T12:00:00.000Z",
};

describe("server-only Drive connection bridge (AUTH-001, DRIVE-004)", () => {
  it("forwards only the validated owner cookie and accepts a strict DTO", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ connections: [connection] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(getDriveConnections(token, fetcher)).resolves.toEqual({ status: "available", connections: [connection] });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:4000/api/v1/drive/connections");
    expect(options).toMatchObject({ cache: "no-store", redirect: "manual", headers: { Cookie: `pp-owner=${token}` } });
    expect(JSON.stringify(options)).not.toContain("refresh");
  });

  it("rejects invalid sessions, malformed responses, and API failures safely", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(getDriveConnections("invalid", fetcher)).resolves.toEqual({ status: "anonymous" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ connections: [{ ...connection, refreshToken: "leak" }] }), { status: 200 }));
    await expect(getDriveConnections(token, fetcher)).resolves.toEqual({ status: "unavailable" });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(getDriveConnections(token, fetcher)).resolves.toEqual({ status: "anonymous" });
  });
});

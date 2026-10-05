import type { DatabaseClient } from "@photographer-platform/database";

export class ApiReadinessService {
  private pending: Promise<boolean> | null = null;
  private last: { time: number; ready: boolean } | null = null;
  constructor(private readonly database: DatabaseClient | null,
    private readonly volume: { checkReady(): Promise<boolean> } | undefined,
    private readonly configured: boolean, private readonly now: () => number = Date.now) {}

  async check(): Promise<boolean> {
    if (this.database === null || this.volume === undefined || !this.configured) return false;
    if (this.last !== null && this.now() - this.last.time < 5000) return this.last.ready;
    if (this.pending !== null) return this.pending;
    this.pending = this.probe().then((ready) => {
      this.last = { time: this.now(), ready };
      return ready;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async probe(): Promise<boolean> {
    try {
      const [volumeReady] = await Promise.all([
        this.volume!.checkReady(),
        this.database!.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
          // Parse current schema columns without reading any actual records,
          // credential bytes, client comments, or original images.
          await tx.$queryRaw`
            SELECT a."catalogVersion", p."sourceRevision", s."revision",
                   sess."expiresAt", d."status", d."refreshTokenKeyVersion"
            FROM "Album" a CROSS JOIN "Photo" p CROSS JOIN "Selection" s
            CROSS JOIN "PhotographerSession" sess CROSS JOIN "DriveConnection" d
            WHERE FALSE
          `;
        }, { maxWait: 1000, timeout: 3000 }),
      ]);
      return volumeReady;
    } catch { return false; }
  }
}

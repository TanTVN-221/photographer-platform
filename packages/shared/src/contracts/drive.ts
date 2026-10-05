import { z } from "zod";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const driveConnectionIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const driveConnectionSummarySchema = z.strictObject({
  connectionId: driveConnectionIdSchema,
  accountEmail: z.email().max(320),
  status: z.enum(["connected", "reauth-required", "disconnected"]),
  scopeMode: z.literal("drive-file"),
  connectedAt: z.iso.datetime({ offset: true }),
});
export const driveConnectionListSchema = z.strictObject({
  connections: z.array(driveConnectionSummarySchema).max(20),
});

export type DriveConnectionSummary = z.infer<typeof driveConnectionSummarySchema>;

export function driveFlowCookieName(secure: boolean): string {
  return secure ? "__Host-pp-drive-flow" : "pp-drive-flow";
}

import { z } from "zod";

/** Public, read-only capabilities exposed by the API. No owner or Drive data. */
export const sourceImageFormatSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum([
    "browser-native",
    "converted-raster",
    "camera-raw",
    "extended-raster",
  ]),
  supportLevel: z.enum(["guaranteed", "best-effort"]),
  extensions: z.array(z.string().min(1)).min(1),
});

export const systemInfoSchema = z.object({
  service: z.literal("photographer-platform-api"),
  apiVersion: z.literal("v1"),
  formats: z.array(sourceImageFormatSummarySchema),
});

export const liveHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("photographer-platform-api"),
});
export const readinessHealthSchema = z.strictObject({
  status: z.enum(["ready", "not-ready"]),
  service: z.literal("photographer-platform-api"),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().uuid(),
  }),
});

export type SystemInfo = z.infer<typeof systemInfoSchema>;
export type LiveHealth = z.infer<typeof liveHealthSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

import { z } from "zod";

export const OWNER_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const ownerSessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const ownerProfileSchema = z.strictObject({
  email: z.email().max(320),
  displayName: z.string().max(200).nullable(),
});
export const authenticationStatusSchema = z.strictObject({ configured: z.boolean() });
export type OwnerProfile = z.infer<typeof ownerProfileSchema>;

export function ownerSessionCookieName(secure: boolean): string {
  return secure ? "__Host-pp-owner" : "pp-owner";
}

export function loginFlowCookieName(secure: boolean): string {
  return secure ? "__Host-pp-login" : "pp-login";
}

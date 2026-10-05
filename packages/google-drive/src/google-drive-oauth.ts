import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { DRIVE_FILE_SCOPE } from "@photographer-platform/shared";
import { z } from "zod";

const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(320),
  email_verified: z.literal(true),
  nonce: z.string(),
  azp: z.string().optional(),
});
const refreshTokenSchema = z.string().min(1).max(8192);
const accessTokenSchema = z.string().min(1).max(8192);
const oauthFailureSchema = z.object({ response: z.object({ data: z.object({ error: z.string() }) }) });

export interface GoogleDriveGrant {
  readonly googleAccountId: string;
  readonly accountEmail: string;
  readonly refreshToken: string;
  readonly grantedScopes: readonly string[];
}

export interface GoogleDriveAuthorizationProvider {
  authorizationUrl(input: { state: string; nonce: string; challenge: string; loginHint?: string }): string;
  exchange(input: { code: string; verifier: string; nonce: string }): Promise<GoogleDriveGrant>;
  refreshAccessToken(refreshToken: string): Promise<string>;
  revoke(refreshToken: string): Promise<void>;
}

export class GoogleDriveAuthorizationError extends Error {
  constructor(readonly code: "authorization" | "reauth-required" | "revocation" | "transient") {
    super(code === "reauth-required" ? "Reconnect Google Drive to continue." :
      code === "revocation" ? "The local Drive connection was removed, but Google revocation could not be confirmed." :
      code === "transient" ? "Google Drive is temporarily unavailable." :
      "Google Drive authorization could not be completed.");
    this.name = "GoogleDriveAuthorizationError";
  }
}

/** OAuth grant for Drive access. Photographer sign-in remains a separate flow. */
export class GoogleDriveAuthorizationService implements GoogleDriveAuthorizationProvider {
  private readonly client: OAuth2Client;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {
    this.client = new OAuth2Client({
      clientId, clientSecret, redirectUri,
      transporterOptions: { timeout: 10_000, retry: false },
    });
  }

  authorizationUrl(input: { state: string; nonce: string; challenge: string; loginHint?: string }): string {
    const url = new URL(this.client.generateAuthUrl({
      scope: ["openid", "email", DRIVE_FILE_SCOPE],
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: true,
      state: input.state,
      code_challenge: input.challenge,
      code_challenge_method: CodeChallengeMethod.S256,
      ...(input.loginHint === undefined ? {} : { login_hint: input.loginHint }),
    }));
    url.searchParams.set("nonce", input.nonce);
    return url.toString();
  }

  async exchange(input: { code: string; verifier: string; nonce: string }): Promise<GoogleDriveGrant> {
    try {
      const { tokens } = await this.client.getToken({ code: input.code, codeVerifier: input.verifier });
      const refreshToken = refreshTokenSchema.parse(tokens.refresh_token);
      if (tokens.id_token === undefined || tokens.id_token === null || typeof tokens.scope !== "string") throw new Error();
      const grantedScopes = [...new Set(tokens.scope.split(/\s+/).filter(Boolean))].sort();
      const driveScopes = grantedScopes.filter((scope) => scope.startsWith("https://www.googleapis.com/auth/drive"));
      if (driveScopes.length !== 1 || driveScopes[0] !== DRIVE_FILE_SCOPE) throw new Error();
      const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.clientId });
      const identity = identitySchema.parse(ticket.getPayload());
      if (identity.nonce !== input.nonce || (identity.azp !== undefined && identity.azp !== this.clientId)) throw new Error();
      return {
        googleAccountId: identity.sub,
        accountEmail: identity.email,
        refreshToken,
        grantedScopes,
      };
    } catch {
      // Provider exceptions may include codes or tokens; expose only a stable message.
      throw new GoogleDriveAuthorizationError("authorization");
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      const client = new OAuth2Client({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        redirectUri: this.redirectUri,
        transporterOptions: { timeout: 10_000, retry: false },
      });
      client.setCredentials({ refresh_token: refreshTokenSchema.parse(refreshToken) });
      const result = await client.getAccessToken();
      return accessTokenSchema.parse(result.token);
    } catch (error) {
      const parsed = oauthFailureSchema.safeParse(error);
      throw new GoogleDriveAuthorizationError(
        parsed.success && ["invalid_grant", "invalid_token"].includes(parsed.data.response.data.error)
          ? "reauth-required"
          : "transient",
      );
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      await this.client.revokeToken(refreshTokenSchema.parse(refreshToken));
    } catch {
      throw new GoogleDriveAuthorizationError("revocation");
    }
  }
}

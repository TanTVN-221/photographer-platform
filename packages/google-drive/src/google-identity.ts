import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { z } from "zod";

const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(320),
  email_verified: z.literal(true),
  name: z.string().max(200).optional(),
  nonce: z.string(),
  azp: z.string().optional(),
});

export interface VerifiedGoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly displayName: string | null;
}

export interface GoogleIdentityProvider {
  authorizationUrl(input: { state: string; nonce: string; challenge: string }): string;
  exchange(input: { code: string; verifier: string; nonce: string }): Promise<VerifiedGoogleIdentity>;
}

/** Identity-only OAuth. Drive access is a separate grant and is not requested here. */
export class GoogleIdentityService implements GoogleIdentityProvider {
  private readonly client: OAuth2Client;

  constructor(private readonly clientId: string, clientSecret: string, redirectUri: string) {
    this.client = new OAuth2Client({
      clientId, clientSecret, redirectUri,
      transporterOptions: { timeout: 10_000, retry: false },
    });
  }

  authorizationUrl(input: { state: string; nonce: string; challenge: string }): string {
    const url = new URL(this.client.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      access_type: "online",
      prompt: "select_account",
      state: input.state,
      code_challenge: input.challenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }));
    url.searchParams.set("nonce", input.nonce);
    return url.toString();
  }

  async exchange(input: { code: string; verifier: string; nonce: string }): Promise<VerifiedGoogleIdentity> {
    try {
      const { tokens } = await this.client.getToken({ code: input.code, codeVerifier: input.verifier });
      if (tokens.id_token === undefined || tokens.id_token === null) throw new Error();
      const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.clientId });
      const identity = identitySchema.parse(ticket.getPayload());
      if (identity.nonce !== input.nonce || (identity.azp !== undefined && identity.azp !== this.clientId)) {
        throw new Error();
      }
      return { subject: identity.sub, email: identity.email, displayName: identity.name ?? null };
    } catch {
      // Provider exceptions can contain authorization codes and token responses.
      throw new Error("Google sign-in could not be verified.");
    }
  }
}

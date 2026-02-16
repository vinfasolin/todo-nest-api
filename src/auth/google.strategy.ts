import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

type GooglePayload = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
};

@Injectable()
export class GoogleIdTokenVerifier {
  private static readonly FALLBACK_CLIENT_ID =
    '764728744073-4h8l7638uom853plt0hdsicn9avugf3p.apps.googleusercontent.com';

  private readonly client: OAuth2Client;
  private readonly audience: string;

  constructor() {
    this.audience = process.env.GOOGLE_CLIENT_ID || GoogleIdTokenVerifier.FALLBACK_CLIENT_ID;
    this.client = new OAuth2Client(this.audience);
  }

  async verify(idToken: string): Promise<GooglePayload> {
    const token = (idToken || '').trim();
    if (!token) throw new UnauthorizedException('Missing Google ID token');

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: token,
        audience: this.audience,
      });

      const payload = ticket.getPayload() as any;

      if (!payload?.sub || !payload?.email) {
        throw new UnauthorizedException('Invalid Google token payload');
      }

      return {
        sub: String(payload.sub),
        email: String(payload.email),
        name: payload.name ? String(payload.name) : undefined,
        picture: payload.picture ? String(payload.picture) : undefined,
        email_verified: typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired Google ID token');
    }
  }
}

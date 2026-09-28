import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
const ISSUER = 'wellbuddy';
const AUDIENCE = 'wellbuddy-api';

export interface AccessTokenClaims {
  userId: string;
  companyId: string | null;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  /** 액세스 토큰(JWT, 15분). 역할·권한은 담지 않고 요청마다 DB 에서 다시 확인한다. */
  signAccessToken({ userId, companyId }: AccessTokenClaims): Promise<string> {
    return new SignJWT(companyId ? { cid: companyId } : {})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub) return null;
      return {
        userId: payload.sub,
        companyId: typeof payload.cid === 'string' ? payload.cid : null,
      };
    } catch {
      return null;
    }
  }

  /** 리프레시 토큰 원문(클라이언트에만 전달)과 DB 저장용 해시 */
  createRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

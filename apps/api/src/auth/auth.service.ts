import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { refreshTokens, users } from '@wellbuddy/db';
import type { LoginInput, SignupInput } from '@wellbuddy/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';
import type { IssuedTokens } from './auth.cookies.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { SessionService } from './session.service.js';
import { REFRESH_TOKEN_TTL_SECONDS, TokenService } from './token.service.js';

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthResult extends IssuedTokens {
  user: { id: string; email: string; name: string };
  companyId: string | null;
}

/** 동시에 두 탭이 같은 리프레시 토큰을 쓰는 경우를 탈취로 오인하지 않기 위한 유예 시간 */
const REFRESH_REUSE_GRACE_MS = 10_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async signup(input: SignupInput, meta: ClientMeta): Promise<AuthResult> {
    if (await this.findUserByEmail(input.email)) {
      throw new AppException('EMAIL_TAKEN', '이미 가입된 이메일입니다.', HttpStatus.CONFLICT);
    }
    const passwordHash = await hashPassword(input.password);
    let user: { id: string; email: string; name: string } | undefined;
    try {
      [user] = await this.db.db
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash })
        .returning({ id: users.id, email: users.email, name: users.name });
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new AppException('EMAIL_TAKEN', '이미 가입된 이메일입니다.', HttpStatus.CONFLICT);
      }
      throw e;
    }
    const tokens = await this.issueTokens(user!.id, null, meta);
    await this.audit.record({
      action: 'auth.signup',
      entity: 'user',
      entityId: user!.id,
      userId: user!.id,
    });
    return { user: user!, companyId: null, ...tokens };
  }

  async login(input: LoginInput, meta: ClientMeta): Promise<AuthResult> {
    const user = await this.findUserByEmail(input.email);
    if (!user) {
      await burnPasswordCheck(input.password);
      await this.audit.record({ action: 'auth.login_failed', after: { email: input.email } });
      throw this.invalidCredentials();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.audit.record({
        action: 'auth.login_failed',
        entity: 'user',
        entityId: user.id,
        userId: user.id,
        after: { email: input.email },
      });
      throw this.invalidCredentials();
    }

    const companyId = await this.sessions.pickCompany(user.id, user.lastCompanyId);
    await this.db.db
      .update(users)
      .set({ lastLoginAt: new Date(), lastCompanyId: companyId })
      .where(eq(users.id, user.id));
    const tokens = await this.issueTokens(user.id, companyId, meta);
    await this.audit.record({
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      userId: user.id,
      companyId,
    });
    return { user: { id: user.id, email: user.email, name: user.name }, companyId, ...tokens };
  }

  /**
   * 리프레시 토큰 로테이션. 이미 교체된 토큰이 다시 오면 탈취로 보고 같은 family 를 모두 폐기한다.
   * 교체 직후 짧은 유예 시간 안의 재사용(여러 탭 동시 갱신)은 새 토큰 없이 null 을 돌려준다.
   */
  async refresh(rawToken: string, meta: ClientMeta): Promise<AuthResult | null> {
    const hash = this.tokens.hash(rawToken);
    const [row] = await this.db.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash));
    if (!row) throw this.invalidRefresh();

    if (row.revokedAt) {
      const recentlyRotated =
        row.replacedById && Date.now() - row.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
      if (recentlyRotated) return null;
      await this.revokeFamily(row.familyId);
      await this.audit.record({
        action: 'auth.refresh_reused',
        entity: 'user',
        entityId: row.userId,
        userId: row.userId,
        companyId: null,
      });
      throw new AppException(
        'REFRESH_REUSED',
        '보안을 위해 로그아웃되었습니다. 다시 로그인해 주세요.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (row.expiresAt.getTime() <= Date.now()) throw this.invalidRefresh();

    const [user] = await this.db.db.select().from(users).where(eq(users.id, row.userId));
    if (!user) throw this.invalidRefresh();

    const companyId = await this.sessions.pickCompany(user.id, user.lastCompanyId);
    const tokens = await this.issueTokens(user.id, companyId, meta, row.familyId, row.id);
    return { user: { id: user.id, email: user.email, name: user.name }, companyId, ...tokens };
  }

  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    const [row] = await this.db.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, this.tokens.hash(rawToken)));
    if (row) await this.revokeFamily(row.familyId);
  }

  /** 회사 전환: 활성 구성원인지 확인하고 새 액세스 토큰을 발급한다. */
  async switchCompany(userId: string, companyId: string): Promise<string> {
    const target = await this.sessions.pickCompany(userId, companyId);
    if (target !== companyId) {
      throw new AppException('NOT_A_MEMBER', '소속된 회사가 아닙니다.', HttpStatus.FORBIDDEN);
    }
    await this.db.db.update(users).set({ lastCompanyId: companyId }).where(eq(users.id, userId));
    return this.tokens.signAccessToken({ userId, companyId });
  }

  async issueTokens(
    userId: string,
    companyId: string | null,
    meta: ClientMeta,
    familyId: string = randomUUID(),
    replacingId?: string,
  ): Promise<IssuedTokens> {
    const refresh = this.tokens.createRefreshToken();
    await this.db.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(refreshTokens)
        .values({
          userId,
          familyId,
          tokenHash: refresh.hash,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        })
        .returning({ id: refreshTokens.id });
      if (replacingId) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date(), replacedById: created!.id })
          .where(and(eq(refreshTokens.id, replacingId), isNull(refreshTokens.revokedAt)));
      }
    });
    return {
      accessToken: await this.tokens.signAccessToken({ userId, companyId }),
      refreshToken: refresh.token,
    };
  }

  private async findUserByEmail(email: string) {
    const [user] = await this.db.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    return user;
  }

  private async revokeFamily(familyId: string) {
    await this.db.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  private invalidCredentials() {
    return new AppException(
      'INVALID_CREDENTIALS',
      '이메일 또는 비밀번호가 올바르지 않습니다.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidRefresh() {
    return new UnauthorizedException();
  }
}

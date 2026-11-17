import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@wellbuddy/shared';
import type { Request } from 'express';
import { AppException } from '../common/errors.js';
import { currentContext } from '../common/request-context.js';
import { readAccessToken } from './auth.cookies.js';
import {
  ALLOW_NO_COMPANY,
  IS_PUBLIC,
  REQUIRED_PERMISSION,
  type RequiredPermission,
} from './decorators.js';
import { MembershipService } from './membership.service.js';
import { TokenService } from './token.service.js';

/**
 * 전역 인증 가드: 액세스 토큰(Bearer 또는 wb_at 쿠키)을 검증하고,
 * 선택한 회사의 활성 구성원인지 DB 에서 다시 확인해 요청 컨텍스트에 역할·권한을 채운다.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly memberships: MembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = readAccessToken(req);
    const claims = token ? await this.tokens.verifyAccessToken(token) : null;
    if (!claims) throw new UnauthorizedException();

    const ctx = currentContext();
    if (!ctx) throw new Error('RequestContextMiddleware 가 적용되지 않았습니다');
    ctx.userId = claims.userId;

    if (claims.companyId) {
      const membership = await this.memberships.resolve(claims.userId, claims.companyId);
      if (membership) {
        ctx.companyId = claims.companyId;
        ctx.role = membership.role;
        ctx.permissions = membership.permissions;
      }
    }

    const allowNoCompany = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_COMPANY, targets);
    if (!ctx.companyId && !allowNoCompany) {
      throw new AppException(
        'COMPANY_REQUIRED',
        '회사를 먼저 선택하거나 만들어 주세요.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

/** @RequirePermission(key, level) 이 붙은 엔드포인트의 메뉴·기능 권한을 검사한다. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;
    const ctx = currentContext();
    if (!hasPermission(ctx?.permissions, required.key, required.level)) {
      throw new AppException('FORBIDDEN', '이 작업을 할 권한이 없습니다.', HttpStatus.FORBIDDEN, {
        permission: required.key,
        level: required.level,
      });
    }
    return true;
  }
}

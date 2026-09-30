import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { PermissionMap, Role } from '@wellbuddy/shared';
import type { NextFunction, Request, Response } from 'express';

/** 요청 하나 동안 유지되는 사용자·회사 컨텍스트. 인증 가드가 userId/companyId/role 을 채운다. */
export interface RequestContext {
  userId: string | null;
  companyId: string | null;
  role: Role | null;
  /** 역할 기본값 + 회사별 재정의가 반영된 최종 권한(회사를 선택하지 않았으면 null) */
  permissions: PermissionMap | null;
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** 인증된 요청에서만 호출한다. 컨텍스트가 없으면 프로그래밍 오류다. */
export function requireContext(): RequestContext & { userId: string } {
  const ctx = storage.getStore();
  if (!ctx?.userId) throw new Error('인증 컨텍스트가 없습니다');
  return ctx as RequestContext & { userId: string };
}

/** 회사를 선택한 인증 요청에서 사용한다. */
export function requireCompanyContext(): RequestContext & {
  userId: string;
  companyId: string;
  role: Role;
  permissions: PermissionMap;
} {
  const ctx = requireContext();
  if (!ctx.companyId || !ctx.role || !ctx.permissions) throw new Error('회사 컨텍스트가 없습니다');
  return ctx as ReturnType<typeof requireCompanyContext>;
}

/**
 * 회사만 정해진 컨텍스트(예약 수집처럼 사용자 없이 워커가 실행하는 작업 포함).
 * 권한 검사는 하지 않으므로 요청 처리에서는 requireCompanyContext 를 쓴다.
 */
export function requireCompanyId(): { companyId: string; userId: string | null } {
  const ctx = storage.getStore();
  if (!ctx?.companyId) throw new Error('회사 컨텍스트가 없습니다');
  return { companyId: ctx.companyId, userId: ctx.userId };
}

/** 요청 밖(워커, 스크립트, 테스트)에서 컨텍스트를 지정해 실행한다. */
export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return storage.run(
    {
      userId: null,
      companyId: null,
      role: null,
      permissions: null,
      ip: null,
      userAgent: null,
      ...ctx,
    },
    fn,
  );
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    runWithContext({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null }, () => next());
  }
}

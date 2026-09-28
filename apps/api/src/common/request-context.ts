import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Role } from '@wellbuddy/shared';
import type { NextFunction, Request, Response } from 'express';

/** 요청 하나 동안 유지되는 사용자·회사 컨텍스트. 인증 가드가 userId/companyId/role 을 채운다. */
export interface RequestContext {
  userId: string | null;
  companyId: string | null;
  role: Role | null;
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** 요청 밖(워커, 스크립트, 테스트)에서 컨텍스트를 지정해 실행한다. */
export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return storage.run(
    { userId: null, companyId: null, role: null, ip: null, userAgent: null, ...ctx },
    fn,
  );
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    runWithContext({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null }, () => next());
  }
}

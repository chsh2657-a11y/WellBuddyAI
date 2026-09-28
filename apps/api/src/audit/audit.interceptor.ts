import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';
import { ZodError } from 'zod';
import { AuditService } from './audit.service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** 토큰 갱신은 빈번하고 보안상 의미가 적어 제외한다(로그인·로그아웃·실패는 남긴다). */
const SKIP_PATHS = new Set(['/api/auth/refresh']);

/**
 * 모든 변경 요청(POST/PUT/PATCH/DELETE)을 성공·실패와 관계없이 감사로그로 남긴다.
 * 요청 본문은 저장하지 않는다(변경 전후 값은 각 서비스가 AuditService.record 로 남긴다).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!MUTATING.has(req.method) || SKIP_PATHS.has(req.path)) return next.handle();

    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const write = (statusCode: number) =>
      void this.audit.record({
        action: `http:${req.method} ${route}`,
        entityId: typeof req.params?.id === 'string' ? req.params.id : null,
        method: req.method,
        path: req.path,
        statusCode,
      });

    return next.handle().pipe(
      tap({
        next: () => write(res.statusCode),
        error: (err: unknown) =>
          write(
            err instanceof HttpException ? err.getStatus() : err instanceof ZodError ? 400 : 500,
          ),
      }),
    );
  }
}

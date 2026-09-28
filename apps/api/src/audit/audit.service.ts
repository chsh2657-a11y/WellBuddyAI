import { Injectable, Logger } from '@nestjs/common';
import { auditLogs, type Executor, users } from '@wellbuddy/db';
import { desc, eq, lt } from 'drizzle-orm';
import { currentContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  method?: string;
  path?: string;
  statusCode?: number;
  /** 컨텍스트 대신 명시할 때(로그인처럼 컨텍스트가 채워지기 전 이벤트) */
  userId?: string | null;
  companyId?: string | null;
}

const SENSITIVE_KEY = /password|token|secret|credential|resident|rrn|apikey|api_key/i;

/** 감사로그에 비밀번호·토큰·자격증명·주민번호가 남지 않도록 값을 가린다. */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) && v !== null && v !== undefined
          ? '***'
          : maskSensitive(v, depth + 1),
      ]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly db: DbService) {}

  /**
   * 감사로그를 남긴다. tx 를 넘기면 업무 변경과 같은 트랜잭션으로 기록되어 함께 커밋·롤백된다.
   * 감사로그 기록 실패가 업무 처리를 막지 않도록, tx 없이 호출할 때는 오류를 로그로만 남긴다.
   */
  async record(entry: AuditEntry, tx?: Executor): Promise<void> {
    const ctx = currentContext();
    const values = {
      companyId: entry.companyId !== undefined ? entry.companyId : (ctx?.companyId ?? null),
      userId: entry.userId !== undefined ? entry.userId : (ctx?.userId ?? null),
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      method: entry.method ?? null,
      path: entry.path ?? null,
      statusCode: entry.statusCode ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 300) ?? null,
      before: maskSensitive(entry.before) ?? null,
      after: maskSensitive(entry.after) ?? null,
    };
    if (tx) {
      await tx.insert(auditLogs).values(values);
      return;
    }
    try {
      await this.db.as({ userId: values.userId, companyId: values.companyId }, (t) =>
        t.insert(auditLogs).values(values),
      );
    } catch (e) {
      this.logger.error(`감사로그 기록 실패: ${entry.action} ${(e as Error).message}`);
    }
  }

  /** 현재 회사의 감사로그(최신순, 커서 페이지네이션) */
  async list(limit: number, before?: string) {
    const rows = await this.db.tenant((tx) =>
      tx
        .select({
          id: auditLogs.id,
          createdAt: auditLogs.createdAt,
          action: auditLogs.action,
          entity: auditLogs.entity,
          entityId: auditLogs.entityId,
          method: auditLogs.method,
          path: auditLogs.path,
          statusCode: auditLogs.statusCode,
          ip: auditLogs.ip,
          userName: users.name,
          userEmail: users.email,
          before: auditLogs.before,
          after: auditLogs.after,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(before ? lt(auditLogs.createdAt, new Date(before)) : undefined)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit),
    );
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}

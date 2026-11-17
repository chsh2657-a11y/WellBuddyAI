import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema> & { $client: pg.Pool };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** 트랜잭션 안팎 어디서든 쓸 수 있는 쿼리 실행기. */
export type Executor = Database | Transaction;

export interface TenantContext {
  userId?: string | null;
  companyId?: string | null;
}

export function createDb(connectionString: string, options: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return drizzle(pool, { schema, casing: 'snake_case' }) as Database;
}

/**
 * RLS 컨텍스트를 설정한 트랜잭션 안에서 fn 을 실행한다.
 * set_config(..., true) 는 트랜잭션 로컬이라 커넥션 풀로 돌아가면 자동으로 사라진다.
 */
export async function withTenant<T>(
  db: Database,
  ctx: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, ctx);
    return fn(tx);
  });
}

/** 이미 열린 트랜잭션의 RLS 컨텍스트를 바꾼다(예: 회사 생성 직후 새 회사로 전환). */
export async function setTenantContext(tx: Transaction, ctx: TenantContext): Promise<void> {
  await tx.execute(
    sql`select set_config('app.user_id', ${ctx.userId ?? ''}, true),
               set_config('app.company_id', ${ctx.companyId ?? ''}, true)`,
  );
}

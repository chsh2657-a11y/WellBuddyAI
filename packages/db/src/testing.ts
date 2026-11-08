import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

/** 통합 테스트용 DB (scripts/db-setup.sh 가 만드는 wellbuddy_test). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://wellbuddy_app:wellbuddy_app@localhost:5432/wellbuddy_test';

export const TEST_DATABASE_URL_OWNER =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://wellbuddy_owner:wellbuddy_owner@localhost:5432/wellbuddy_test';

/** 소유자 롤로 public 스키마의 모든 테이블을 비운다(RLS 우회). */
export async function truncateAll(ownerConnectionString = TEST_DATABASE_URL_OWNER): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerConnectionString, max: 1 });
  try {
    const db = drizzle(pool);
    const { rows } = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (rows.length === 0) return;
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await db.execute(sql.raw(`truncate ${list} restart identity cascade`));
  } finally {
    await pool.end();
  }
}

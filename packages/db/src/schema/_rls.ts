import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';

/**
 * 앱 런타임 롤. scripts/db-setup.sh 가 만든다(NOBYPASSRLS).
 * 마이그레이션은 테이블 소유자(wellbuddy_owner)로 실행하므로 정책의 대상이 아니다.
 */
export const appRole = pgRole('wellbuddy_app').existing();

/**
 * 현재 트랜잭션의 회사(테넌트)와 일치하는 행만 읽고 쓸 수 있게 하는 기본 정책.
 * current_company_id() 는 withTenant() 가 set_config 로 넣은 app.company_id 를 읽는다.
 */
export function tenantIsolationPolicy() {
  return pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: appRole,
    using: sql`company_id = current_company_id()`,
    withCheck: sql`company_id = current_company_id()`,
  });
}

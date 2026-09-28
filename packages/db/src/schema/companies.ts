import { type MemberStatus, type Role } from '@wellbuddy/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { appRole, tenantIsolationPolicy } from './_rls.js';
import { users } from './auth.js';

const ROLE_CHECK = sql`role in ('owner', 'admin', 'accountant', 'approver', 'employee')`;

/** 회사(테넌트). */
export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text().notNull(),
    bizRegNo: text().notNull(),
    representative: text(),
    businessType: text(),
    businessItem: text(),
    address: text(),
    phone: text(),
    fiscalYearStartMonth: smallint().notNull().default(1),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('companies_fiscal_month_ck', sql`fiscal_year_start_month between 1 and 12`),
    // 현재 선택한 회사, 또는 내가 활성 구성원인 회사만 조회
    pgPolicy('companies_select', {
      for: 'select',
      to: appRole,
      using: sql`id = current_company_id() or exists (
        select 1 from company_members m
        where m.company_id = companies.id
          and m.user_id = current_app_user_id()
          and m.status = 'active')`,
    }),
    // 로그인한 사용자는 회사를 만들 수 있다. 생성 직전에 app.company_id 를 새 id 로 설정해야 한다.
    pgPolicy('companies_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`current_app_user_id() is not null and id = current_company_id()`,
    }),
    pgPolicy('companies_update', {
      for: 'update',
      to: appRole,
      using: sql`id = current_company_id()`,
      withCheck: sql`id = current_company_id()`,
    }),
  ],
);

/** 회사 구성원(사용자 ↔ 회사, 역할). */
export const companyMembers = pgTable(
  'company_members',
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().$type<Role>().notNull(),
    status: text().$type<MemberStatus>().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('company_members_company_user_uq').on(t.companyId, t.userId),
    index('company_members_user_idx').on(t.userId),
    check('company_members_role_ck', ROLE_CHECK),
    check('company_members_status_ck', sql`status in ('active', 'disabled')`),
    // 현재 회사의 구성원 전체 + (회사 선택 전) 내 소속 목록
    pgPolicy('company_members_select', {
      for: 'select',
      to: appRole,
      using: sql`company_id = current_company_id() or user_id = current_app_user_id()`,
    }),
    pgPolicy('company_members_write', {
      for: 'all',
      to: appRole,
      using: sql`company_id = current_company_id()`,
      withCheck: sql`company_id = current_company_id()`,
    }),
  ],
);

/** 사업장(본점·지점). */
export const businessPlaces = pgTable(
  'business_places',
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    bizRegNo: text().notNull(),
    representative: text(),
    businessType: text(),
    businessItem: text(),
    address: text(),
    isHeadquarters: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('business_places_company_bizno_uq').on(t.companyId, t.bizRegNo),
    tenantIsolationPolicy(),
  ],
);

/** 구성원 초대. 토큰 원문은 메일로만 보내고 DB 에는 해시만 저장한다. */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: text().$type<Role>().notNull(),
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('invitations_company_idx').on(t.companyId),
    check('invitations_role_ck', ROLE_CHECK),
    tenantIsolationPolicy(),
  ],
);

/** 회사별 역할 권한 재정의. 값이 없으면 permissions.ts 의 역할 기본값을 쓴다. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    role: text().$type<Role>().notNull(),
    permissions: jsonb().$type<Record<string, 'none' | 'read' | 'write'>>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.role] }),
    check('role_permissions_role_ck', ROLE_CHECK),
    tenantIsolationPolicy(),
  ],
);

/** 회사 단위 설정(메뉴 사용 여부 등). */
export const companySettings = pgTable(
  'company_settings',
  {
    companyId: uuid()
      .primaryKey()
      .references(() => companies.id, { onDelete: 'cascade' }),
    enabledModules: jsonb().$type<Record<string, boolean>>().notNull().default({}),
    updatedAt: updatedAt(),
  },
  () => [tenantIsolationPolicy()],
);

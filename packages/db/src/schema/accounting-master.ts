import type { NormalBalance, StatementGroup } from '@wellbuddy/accounting-core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { companies } from './companies.js';

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

/** 계정과목. 회사를 만들 때 표준 계정과목이 복사된다(isSystem). */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    group: text().$type<StatementGroup>().notNull(),
    normalBalance: text().$type<NormalBalance>().notNull(),
    requiresPartner: boolean().notNull().default(false),
    requiresDepartment: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    /** 표준 계정과목(코드·구분은 바꿀 수 없고 삭제 대신 사용중지) */
    isSystem: boolean().notNull().default(false),
    description: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('accounts_company_code_uq').on(t.companyId, t.code),
    check('accounts_code_ck', sql`code ~ '^[0-9]{3,5}$'`),
    check('accounts_normal_balance_ck', sql`normal_balance in ('debit', 'credit')`),
    tenantIsolationPolicy(),
  ],
);

/** 계정별 자주 쓰는 적요 */
export const accountMemos = pgTable(
  'account_memos',
  {
    id: id(),
    companyId: companyRef(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('account_memos_account_idx').on(t.accountId), tenantIsolationPolicy()],
);

/** 거래처(매출처·매입처). 계좌번호는 필드 암호화해 저장한다. */
export const partners = pgTable(
  'partners',
  {
    id: id(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    kind: text().$type<'customer' | 'supplier' | 'both' | 'other'>().notNull().default('both'),
    bizRegNo: text(),
    representative: text(),
    businessType: text(),
    businessItem: text(),
    address: text(),
    phone: text(),
    email: text(),
    contactName: text(),
    bankName: text(),
    bankAccountEnc: text(),
    bankAccountLast4: text(),
    bankHolder: text(),
    memo: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('partners_company_code_uq').on(t.companyId, t.code),
    uniqueIndex('partners_company_bizno_uq')
      .on(t.companyId, t.bizRegNo)
      .where(sql`biz_reg_no is not null`),
    index('partners_company_name_idx').on(t.companyId, t.name),
    check('partners_kind_ck', sql`kind in ('customer', 'supplier', 'both', 'other')`),
    tenantIsolationPolicy(),
  ],
);

/** 부서(전표 관리항목) */
export const departments = pgTable(
  'departments',
  {
    id: id(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('departments_company_code_uq').on(t.companyId, t.code),
    tenantIsolationPolicy(),
  ],
);

/** 프로젝트(전표 관리항목, 프로젝트별 손익) */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    startDate: date(),
    endDate: date(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('projects_company_code_uq').on(t.companyId, t.code), tenantIsolationPolicy()],
);

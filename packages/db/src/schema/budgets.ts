import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, smallint, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { accounts, departments } from './accounting-master.js';
import { companies } from './companies.js';
import { fiscalYears } from './journal.js';

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

/**
 * 예산: 회계연도·손익 계정·부서(없으면 전사)·월(1~12번째 기간)별 금액.
 * 수익 계정은 목표, 비용 계정은 한도로 본다.
 */
export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    companyId: companyRef(),
    fiscalYearId: uuid()
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    departmentId: uuid().references(() => departments.id, { onDelete: 'restrict' }),
    periodNo: smallint().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('budgets_line_uq')
      .on(t.companyId, t.fiscalYearId, t.accountId, t.departmentId, t.periodNo)
      .nullsNotDistinct(),
    check('budgets_period_ck', sql`period_no between 1 and 12`),
    check('budgets_amount_ck', sql`amount >= 0`),
    tenantIsolationPolicy(),
  ],
);

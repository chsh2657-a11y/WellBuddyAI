import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { partners } from './accounting-master.js';
import { companies } from './companies.js';

export type CashDirection = 'in' | 'out';

/** 자금계획: 예정 입금·출금(어음 만기는 어음 대장에서 자동으로 더한다) */
export const cashPlans = pgTable(
  'cash_plans',
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    planDate: date().notNull(),
    direction: text().$type<CashDirection>().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    description: text().notNull(),
    partnerId: uuid().references(() => partners.id, { onDelete: 'restrict' }),
    /** 처리 완료(실제 입출금이 끝나 계획에서 뺀다) */
    done: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('cash_plans_company_date_idx').on(t.companyId, t.planDate),
    check('cash_plans_amount_ck', sql`amount > 0`),
    check('cash_plans_direction_ck', sql`direction in ('in', 'out')`),
    tenantIsolationPolicy(),
  ],
);

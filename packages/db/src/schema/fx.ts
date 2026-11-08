import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { users } from './auth.js';
import { companies } from './companies.js';
import { journalEntries } from './journal.js';

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

const won = () => bigint({ mode: 'number' });

/** 일자별 환율(고시 단위 기준: 엔화는 100엔당 원) */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    companyId: companyRef(),
    currency: text().notNull(),
    rateDate: date().notNull(),
    rate: numeric({ precision: 18, scale: 4 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('exchange_rates_company_currency_date_uq').on(t.companyId, t.currency, t.rateDate),
    check('exchange_rates_currency_ck', sql`currency ~ '^[A-Z]{3}$' and currency <> 'KRW'`),
    check('exchange_rates_rate_ck', sql`rate > 0`),
    tenantIsolationPolicy(),
  ],
);

/** 외화평가 결과 한 줄(계정·거래처·통화별) */
export interface FxRevaluationDetail {
  accountId: string;
  partnerId: string | null;
  currency: string;
  foreignBalance: string;
  bookKrw: number;
  rate: string;
  targetKrw: number;
  adjustment: number;
  profit: number;
}

/** 기말 외화평가 실행(회사·평가일마다 한 번, 전표 한 장) */
export const fxRevaluations = pgTable(
  'fx_revaluations',
  {
    id: id(),
    companyId: companyRef(),
    revaluationDate: date().notNull(),
    entryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
    gain: won().notNull().default(0),
    loss: won().notNull().default(0),
    details: jsonb().$type<FxRevaluationDetail[]>().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('fx_revaluations_company_date_uq').on(t.companyId, t.revaluationDate),
    check('fx_revaluations_amount_ck', sql`gain >= 0 and loss >= 0`),
    tenantIsolationPolicy(),
  ],
);

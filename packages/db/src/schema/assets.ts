import type { DepreciationMethod } from '@wellbuddy/accounting-core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { accounts, departments } from './accounting-master.js';
import { users } from './auth.js';
import { companies } from './companies.js';
import { journalEntries } from './journal.js';

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

const won = () => bigint({ mode: 'number' });

/**
 * 고정자산 대장. 상각 이력은 월별 상각 실행(depreciation_runs)과 자산별 상각액(asset_depreciations)으로
 * 남기고, 금액은 모두 전표로 장부에 반영한다.
 */
export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: id(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    /** 자산 계정(예: 212 비품), 상각누계액 계정(213), 감가상각비 계정(818) */
    assetAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    accumulatedAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    expenseAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    departmentId: uuid().references(() => departments.id, { onDelete: 'restrict' }),
    acquisitionDate: date().notNull(),
    cost: won().notNull(),
    residualValue: won().notNull().default(0),
    usefulLifeYears: smallint().notNull(),
    method: text().$type<DepreciationMethod>().notNull(),
    /** 이 시스템을 쓰기 전에 이미 상각한 누계액(기초잔액에 포함된 금액) */
    priorAccumulated: won().notNull().default(0),
    disposedOn: date(),
    disposalProceeds: won(),
    disposalEntryId: uuid().references(() => journalEntries.id, { onDelete: 'set null' }),
    memo: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('fixed_assets_company_code_uq').on(t.companyId, t.code),
    check('fixed_assets_cost_ck', sql`cost > 0 and residual_value >= 0 and residual_value < cost`),
    check('fixed_assets_life_ck', sql`useful_life_years between 1 and 60`),
    check('fixed_assets_method_ck', sql`method in ('straight_line', 'declining_balance')`),
    check('fixed_assets_prior_ck', sql`prior_accumulated >= 0 and prior_accumulated <= cost`),
    tenantIsolationPolicy(),
  ],
);

/** 월 감가상각 실행(회사·월마다 한 번, 전표 한 장) */
export const depreciationRuns = pgTable(
  'depreciation_runs',
  {
    id: id(),
    companyId: companyRef(),
    /** YYYY-MM */
    month: text().notNull(),
    entryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
    totalAmount: won().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('depreciation_runs_company_month_uq').on(t.companyId, t.month),
    check('depreciation_runs_month_ck', sql`month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    tenantIsolationPolicy(),
  ],
);

/** 실행별 자산별 상각액 */
export const assetDepreciations = pgTable(
  'asset_depreciations',
  {
    id: id(),
    companyId: companyRef(),
    runId: uuid()
      .notNull()
      .references(() => depreciationRuns.id, { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id, { onDelete: 'restrict' }),
    month: text().notNull(),
    amount: won().notNull(),
  },
  (t) => [
    uniqueIndex('asset_depreciations_asset_month_uq').on(t.assetId, t.month),
    index('asset_depreciations_run_idx').on(t.runId),
    check('asset_depreciations_amount_ck', sql`amount > 0`),
    tenantIsolationPolicy(),
  ],
);

import type { EvidenceType, VatType } from '@wellbuddy/accounting-core';
import type { JournalStatus, JournalType } from '@wellbuddy/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { accounts, departments, partners, projects } from './accounting-master.js';
import { users } from './auth.js';
import { companies } from './companies.js';
import { fileObjects } from './system.js';

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

const won = () => bigint({ mode: 'number' });

/** 회계연도(기수). 장부·재무제표는 회계연도 단위로 집계하고, 다음 연도로는 전기이월한다. */
export const fiscalYears = pgTable(
  'fiscal_years',
  {
    id: id(),
    companyId: companyRef(),
    /** 표시용 이름(예: 2026) */
    label: text().notNull(),
    startDate: date().notNull(),
    endDate: date().notNull(),
    /** 마지막으로 다음 연도에 전기이월한 시각 */
    carriedForwardAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('fiscal_years_company_start_uq').on(t.companyId, t.startDate),
    check('fiscal_years_range_ck', sql`start_date <= end_date`),
    tenantIsolationPolicy(),
  ],
);

/** 월별 회계기간. 마감(isLocked)한 기간에는 전표를 추가·수정·삭제할 수 없다. */
export const accountingPeriods = pgTable(
  'accounting_periods',
  {
    id: id(),
    companyId: companyRef(),
    fiscalYearId: uuid()
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    periodNo: integer().notNull(),
    startDate: date().notNull(),
    endDate: date().notNull(),
    isLocked: boolean().notNull().default(false),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('accounting_periods_year_no_uq').on(t.fiscalYearId, t.periodNo),
    index('accounting_periods_company_range_idx').on(t.companyId, t.startDate, t.endDate),
    tenantIsolationPolicy(),
  ],
);

/**
 * 전표(분개 헤더). 모든 모듈(매출·매입·급여·증빙…)의 거래가 이 테이블과 journal_lines 에 기록된다.
 * 상태: draft(작성중) → pending(승인요청) → posted(전기) → reversed(역분개됨)
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    companyId: companyRef(),
    fiscalYearId: uuid()
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'restrict' }),
    entryDate: date().notNull(),
    /** 같은 날짜 안에서 1부터 매기는 전표번호(기초잔액 전표는 0) */
    entryNo: integer().notNull(),
    type: text().$type<JournalType>().notNull(),
    status: text().$type<JournalStatus>().notNull().default('draft'),
    description: text(),
    /** 생성 경로(manual, import, bank, card, hometax, payroll …)와 원천 ID */
    source: text().notNull().default('manual'),
    sourceRef: text(),
    /** 매입매출전표의 부가세 정보(부가세 신고·세금계산서 합계표 집계용) */
    vatType: text().$type<VatType>(),
    evidenceType: text().$type<EvidenceType>(),
    supplyAmount: won(),
    vatAmount: won(),
    vatDeductible: boolean(),
    vatPartnerId: uuid().references(() => partners.id, { onDelete: 'restrict' }),
    /** 차변 합계(= 대변 합계). DB 트리거가 줄 합계와 같은지 확인한다. */
    totalAmount: won().notNull().default(0),
    reversalOfId: uuid(),
    reversedById: uuid(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp({ withTimezone: true }),
    submittedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** 승인 반려 사유(다시 작성중으로 돌아간 전표) */
    rejectionReason: text(),
    postedAt: timestamp({ withTimezone: true }),
    postedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('journal_entries_company_date_no_uq').on(t.companyId, t.entryDate, t.entryNo),
    index('journal_entries_company_date_idx').on(t.companyId, t.entryDate),
    index('journal_entries_fiscal_year_idx').on(t.fiscalYearId, t.status),
    // 회계연도마다 기초잔액 전표는 하나
    uniqueIndex('journal_entries_opening_uq')
      .on(t.fiscalYearId)
      .where(sql`type = 'opening'`),
    check(
      'journal_entries_type_ck',
      sql`type in ('general','sales','purchase','receipt','payment','opening','closing')`,
    ),
    check('journal_entries_status_ck', sql`status in ('draft','pending','posted','reversed')`),
    tenantIsolationPolicy(),
  ],
);

/** 분개 줄. 줄마다 차변·대변 중 한쪽에만 금액이 있다. */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    companyId: companyRef(),
    entryId: uuid()
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    debit: won().notNull().default(0),
    credit: won().notNull().default(0),
    partnerId: uuid().references(() => partners.id, { onDelete: 'restrict' }),
    departmentId: uuid().references(() => departments.id, { onDelete: 'restrict' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),
    memo: text(),
    /**
     * 외화 줄: 통화, 외화 금액(원화 금액과 같은 쪽 기준, 소수 둘째 자리), 적용 환율(고시 단위 기준).
     * 원화 금액(debit/credit)이 장부 금액이고, 외화는 외화 잔액·기말 평가에 쓴다.
     */
    currency: text(),
    foreignAmount: numeric({ precision: 18, scale: 2 }),
    exchangeRate: numeric({ precision: 18, scale: 4 }),
  },
  (t) => [
    index('journal_lines_entry_idx').on(t.entryId),
    index('journal_lines_company_account_idx').on(t.companyId, t.accountId),
    index('journal_lines_company_partner_idx').on(t.companyId, t.partnerId),
    check(
      'journal_lines_amount_ck',
      sql`debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0))`,
    ),
    check(
      'journal_lines_foreign_ck',
      sql`(currency is null) = (foreign_amount is null) and (exchange_rate is null or currency is not null) and (currency is null or currency ~ '^[A-Z]{3}$') and (exchange_rate is null or exchange_rate > 0)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** 전표 증빙 첨부(영수증·세금계산서 이미지 등) */
export const journalAttachments = pgTable(
  'journal_attachments',
  {
    id: id(),
    companyId: companyRef(),
    entryId: uuid()
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    fileId: uuid()
      .notNull()
      .references(() => fileObjects.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('journal_attachments_entry_file_uq').on(t.entryId, t.fileId),
    tenantIsolationPolicy(),
  ],
);

/** 날짜별 전표번호 발급기(동시에 저장해도 번호가 겹치지 않게 upsert 로 증가) */
export const journalCounters = pgTable(
  'journal_counters',
  {
    companyId: companyRef(),
    entryDate: date().notNull(),
    lastNo: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.entryDate] }), tenantIsolationPolicy()],
);

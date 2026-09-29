import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  real,
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

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

/**
 * 자동분개가 다루는 거래 종류
 *  bank_in 통장 입금, bank_out 통장 출금, card 카드 승인, card_cancel 카드 취소,
 *  tax_sales·tax_purchase 세금계산서(계산서) 매출·매입, cash_sales·cash_purchase 현금영수증 매출·매입
 */
export type AutoJournalKind =
  | 'bank_in'
  | 'bank_out'
  | 'card'
  | 'card_cancel'
  | 'tax_sales'
  | 'tax_purchase'
  | 'cash_sales'
  | 'cash_purchase';

/** 추천 방법: 회사 규칙, 과거 이력, AI, 기본 추천, 사용자가 고침 */
export type SuggestionMethod = 'rule' | 'history' | 'ai' | 'default' | 'manual' | 'none';

/**
 * 회사 분개 규칙(P2-20). 우선순위가 작은 규칙부터 조건(거래 종류·키워드·거래처·금액)을 보고,
 * 처음 맞는 규칙의 계정으로 분개한다. 회사가 정한 규칙이라 신뢰도는 100% 이다.
 */
export const autoJournalRules = pgTable(
  'auto_journal_rules',
  {
    id: id(),
    companyId: companyRef(),
    name: text().notNull(),
    priority: integer().notNull().default(100),
    isActive: boolean().notNull().default(true),
    /** 비어 있으면 모든 종류 */
    kinds: text()
      .array()
      .$type<AutoJournalKind[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 쉼표로 나눈 키워드 중 하나라도 적요·거래처·가맹점·품목에 들어 있으면 맞다 */
    keywords: text(),
    partnerId: uuid().references(() => partners.id, { onDelete: 'restrict' }),
    minAmount: bigint({ mode: 'number' }),
    maxAmount: bigint({ mode: 'number' }),
    /** 분개할 계정(입금은 대변, 출금·매입은 차변, 매출은 대변 계정) */
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** 채권·채무 줄에 붙일 거래처(비우면 증빙의 거래처) */
    assignPartnerId: uuid().references(() => partners.id, { onDelete: 'restrict' }),
    /** 매입세액 공제 여부(비우면 증빙대로) */
    deductible: boolean(),
    departmentId: uuid().references(() => departments.id, { onDelete: 'restrict' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'restrict' }),
    memo: text(),
    hitCount: integer().notNull().default(0),
    lastHitAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('auto_journal_rules_company_priority_idx').on(t.companyId, t.priority),
    check(
      'auto_journal_rules_amount_ck',
      sql`min_amount is null or max_amount is null or min_amount <= max_amount`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * 과거 분개 이력(P2-21): 사용자가 승인한 분개를 거래 종류·거래처(사업자번호·이름) 별로 센다.
 * 같은 거래처의 가장 많이·최근에 쓴 계정을 추천하고, 규칙 제안(P2-25)에도 쓴다.
 */
export const autoJournalMemory = pgTable(
  'auto_journal_memory',
  {
    id: id(),
    companyId: companyRef(),
    kind: text().$type<AutoJournalKind>().notNull(),
    /** biz:사업자번호, partner:거래처 ID, name:정규화한 이름, desc:정규화한 적요 */
    key: text().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    deductible: boolean(),
    partnerId: uuid().references(() => partners.id, { onDelete: 'set null' }),
    useCount: integer().notNull().default(0),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auto_journal_memory_uq').on(t.companyId, t.kind, t.key, t.accountId),
    tenantIsolationPolicy(),
  ],
);

/** 증빙마다 하나: 추천 분개와 그 근거. 검토함은 이것을 보여 주고 사용자가 고친다 */
export const evidenceSuggestions = pgTable(
  'evidence_suggestions',
  {
    id: id(),
    companyId: companyRef(),
    evidenceKind: text().$type<'bank' | 'card' | 'tax_invoice' | 'cash_receipt'>().notNull(),
    evidenceId: uuid().notNull(),
    itemKind: text().$type<AutoJournalKind>().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    deductible: boolean(),
    partnerId: uuid().references(() => partners.id, { onDelete: 'set null' }),
    departmentId: uuid().references(() => departments.id, { onDelete: 'set null' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
    memo: text(),
    /** 0~1 */
    confidence: real().notNull().default(0),
    method: text().$type<SuggestionMethod>().notNull(),
    reason: text(),
    ruleId: uuid().references(() => autoJournalRules.id, { onDelete: 'set null' }),
    /** 사용자가 고쳤으면 다시 분류하지 않는다 */
    edited: boolean().notNull().default(false),
    /** 전기하지 못한 이유(마감 기간·거래처 없음 등) */
    error: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('evidence_suggestions_uq').on(t.companyId, t.evidenceKind, t.evidenceId),
    check(
      'evidence_suggestions_method_ck',
      sql`method in ('rule', 'history', 'ai', 'default', 'manual', 'none')`,
    ),
    check('evidence_suggestions_confidence_ck', sql`confidence between 0 and 1`),
    tenantIsolationPolicy(),
  ],
);

/** 자동 전기 설정(P2-23): 신뢰도가 기준 이상이면 검토 없이 전표를 만든다 */
export const autoJournalSettings = pgTable(
  'auto_journal_settings',
  {
    companyId: uuid()
      .primaryKey()
      .references(() => companies.id, { onDelete: 'cascade' }),
    autoPost: boolean().notNull().default(false),
    threshold: real().notNull().default(0.9),
    updatedAt: updatedAt(),
  },
  () => [
    check('auto_journal_settings_threshold_ck', sql`threshold between 0.5 and 1`),
    tenantIsolationPolicy(),
  ],
);

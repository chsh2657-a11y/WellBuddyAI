import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { accounts, partners } from './accounting-master.js';
import { users } from './auth.js';
import { companies } from './companies.js';
import { journalEntries } from './journal.js';
import { fileObjects } from './system.js';

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

const won = () => bigint({ mode: 'number' });

/**
 * 증빙(원천 기록) 처리 상태
 *  pending: 아직 분개하지 않음, review: 자동분개 검토함에 있음, posted: 전표와 연결됨,
 *  ignored: 분개하지 않기로 함(개인 사용분 등), matched: 다른 증빙과 짝지어져 중복 분개하지 않음
 */
export type EvidenceStatus = 'pending' | 'review' | 'posted' | 'ignored' | 'matched';
/** 어디서 가져왔는지 */
export type EvidenceSource = 'file' | 'mock' | 'codef' | 'popbill' | 'manual';

const statusCheck = (table: string) =>
  check(
    `${table}_status_ck`,
    sql.raw(`status in ('pending', 'review', 'posted', 'ignored', 'matched')`),
  );

/** 회사 은행 계좌. 계좌번호는 암호화하고 끝 4자리만 보여 준다 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: id(),
    companyId: companyRef(),
    /** 금융결제원 은행 코드(국민 004, 신한 088 …) */
    bankCode: text().notNull(),
    alias: text().notNull(),
    accountNoEnc: text().notNull(),
    accountNoMasked: text().notNull(),
    /** 같은 계좌 중복 등록 방지용 블라인드 인덱스 */
    accountNoIndex: text().notNull(),
    /** 장부 계정(예: 103 보통예금) */
    ledgerAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bank_accounts_company_no_uq').on(t.companyId, t.accountNoIndex),
    tenantIsolationPolicy(),
  ],
);

/** 법인카드 */
export const corporateCards = pgTable(
  'corporate_cards',
  {
    id: id(),
    companyId: companyRef(),
    /** 카드사 코드(삼성 0301, 현대 0302 …) */
    cardCompany: text().notNull(),
    alias: text().notNull(),
    cardNoEnc: text().notNull(),
    cardNoMasked: text().notNull(),
    cardNoIndex: text().notNull(),
    holderName: text(),
    /** 결제할 카드대금 계정(예: 253 미지급금) */
    ledgerAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('corporate_cards_company_no_uq').on(t.companyId, t.cardNoIndex),
    tenantIsolationPolicy(),
  ],
);

/** 공통: 처리 상태·연결 전표·중복 제거 해시 */
const evidenceColumns = () => ({
  source: text().$type<EvidenceSource>().notNull(),
  dedupeHash: text().notNull(),
  status: text().$type<EvidenceStatus>().notNull().default('pending'),
  entryId: uuid().references(() => journalEntries.id, { onDelete: 'set null' }),
  collectionRunId: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** 통장 거래 */
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: id(),
    companyId: companyRef(),
    bankAccountId: uuid()
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    txDate: date().notNull(),
    txTime: time(),
    description: text().notNull(),
    counterparty: text(),
    deposit: won().notNull().default(0),
    withdrawal: won().notNull().default(0),
    balance: won(),
    memo: text(),
    ...evidenceColumns(),
  },
  (t) => [
    uniqueIndex('bank_transactions_dedupe_uq').on(t.companyId, t.dedupeHash),
    index('bank_transactions_account_date_idx').on(t.bankAccountId, t.txDate),
    check(
      'bank_transactions_amount_ck',
      sql`deposit >= 0 and withdrawal >= 0 and ((deposit > 0) <> (withdrawal > 0))`,
    ),
    statusCheck('bank_transactions'),
    tenantIsolationPolicy(),
  ],
);

/** 카드 승인 */
export const cardTransactions = pgTable(
  'card_transactions',
  {
    id: id(),
    companyId: companyRef(),
    cardId: uuid()
      .notNull()
      .references(() => corporateCards.id, { onDelete: 'restrict' }),
    approvedDate: date().notNull(),
    approvedTime: time(),
    merchantName: text().notNull(),
    merchantBizNo: text(),
    amount: won().notNull(),
    vatAmount: won(),
    approvalNo: text().notNull(),
    installmentMonths: integer(),
    cancelled: boolean().notNull().default(false),
    category: text(),
    ...evidenceColumns(),
  },
  (t) => [
    uniqueIndex('card_transactions_dedupe_uq').on(t.companyId, t.dedupeHash),
    index('card_transactions_card_date_idx').on(t.cardId, t.approvedDate),
    check('card_transactions_amount_ck', sql`amount > 0`),
    statusCheck('card_transactions'),
    tenantIsolationPolicy(),
  ],
);

/** 전자세금계산서·계산서(매출·매입) */
export const taxInvoices = pgTable(
  'tax_invoices',
  {
    id: id(),
    companyId: companyRef(),
    direction: text().$type<'sales' | 'purchase'>().notNull(),
    kind: text().$type<'tax' | 'zero' | 'exempt'>().notNull(),
    approvalNo: text().notNull(),
    issueDate: date().notNull(),
    supplierBizNo: text().notNull(),
    supplierName: text().notNull(),
    buyerBizNo: text().notNull(),
    buyerName: text().notNull(),
    supplyAmount: won().notNull(),
    vatAmount: won().notNull(),
    totalAmount: won().notNull(),
    itemSummary: text(),
    /** 상대 거래처(사업자번호로 찾은 것) */
    partnerId: uuid().references(() => partners.id, { onDelete: 'set null' }),
    ...evidenceColumns(),
  },
  (t) => [
    uniqueIndex('tax_invoices_dedupe_uq').on(t.companyId, t.dedupeHash),
    index('tax_invoices_company_date_idx').on(t.companyId, t.issueDate),
    check('tax_invoices_direction_ck', sql`direction in ('sales', 'purchase')`),
    check('tax_invoices_kind_ck', sql`kind in ('tax', 'zero', 'exempt')`),
    check('tax_invoices_amount_ck', sql`total_amount = supply_amount + vat_amount`),
    statusCheck('tax_invoices'),
    tenantIsolationPolicy(),
  ],
);

/** 현금영수증(매출·매입) */
export const cashReceipts = pgTable(
  'cash_receipts',
  {
    id: id(),
    companyId: companyRef(),
    direction: text().$type<'sales' | 'purchase'>().notNull(),
    txDate: date().notNull(),
    approvalNo: text().notNull(),
    bizNo: text(),
    name: text().notNull(),
    supplyAmount: won().notNull(),
    vatAmount: won().notNull(),
    totalAmount: won().notNull(),
    usage: text().$type<'income_deduction' | 'expense_proof'>().notNull(),
    cancelled: boolean().notNull().default(false),
    partnerId: uuid().references(() => partners.id, { onDelete: 'set null' }),
    ...evidenceColumns(),
  },
  (t) => [
    uniqueIndex('cash_receipts_dedupe_uq').on(t.companyId, t.dedupeHash),
    index('cash_receipts_company_date_idx').on(t.companyId, t.txDate),
    check('cash_receipts_direction_ck', sql`direction in ('sales', 'purchase')`),
    statusCheck('cash_receipts'),
    tenantIsolationPolicy(),
  ],
);

/** 영수증(사진 → OCR 또는 직접 입력) */
export const receipts = pgTable(
  'receipts',
  {
    id: id(),
    companyId: companyRef(),
    fileId: uuid().references(() => fileObjects.id, { onDelete: 'set null' }),
    txDate: date(),
    merchantName: text(),
    bizNo: text(),
    totalAmount: won(),
    vatAmount: won(),
    ocrProvider: text(),
    ocrResult: jsonb().$type<Record<string, unknown>>(),
    confidence: real(),
    /** 사업자번호 확인 결과: valid(형식·검증번호 통과)·active(국세청 계속사업자)·closed·invalid·unknown */
    bizNoStatus: text(),
    /** 짝지은 카드 승인 */
    cardTransactionId: uuid().references(() => cardTransactions.id, { onDelete: 'set null' }),
    uploadedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...evidenceColumns(),
  },
  (t) => [
    uniqueIndex('receipts_dedupe_uq').on(t.companyId, t.dedupeHash),
    index('receipts_company_date_idx').on(t.companyId, t.txDate),
    statusCheck('receipts'),
    tenantIsolationPolicy(),
  ],
);

/** 수집 실행 기록(파일 업로드·모의·실연동, 수동·예약) */
export const collectionRuns = pgTable(
  'collection_runs',
  {
    id: id(),
    companyId: companyRef(),
    channel: text().notNull(),
    provider: text().notNull(),
    trigger: text().$type<'manual' | 'schedule' | 'file'>().notNull(),
    status: text().$type<'running' | 'success' | 'error'>().notNull(),
    fetched: integer().notNull().default(0),
    inserted: integer().notNull().default(0),
    duplicates: integer().notNull().default(0),
    message: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('collection_runs_company_started_idx').on(t.companyId, t.startedAt),
    tenantIsolationPolicy(),
  ],
);

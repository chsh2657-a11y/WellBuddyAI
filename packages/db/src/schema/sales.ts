import type { TradeDocKind } from '@wellbuddy/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
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

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });
const won = () => bigint({ mode: 'number' });
/** 수량: 소수 셋째 자리까지 */
export const quantity = () => numeric({ precision: 15, scale: 3, mode: 'number' });

/** 품목(상품·제품·원재료·서비스) */
export const items = pgTable(
  'items',
  {
    id: id(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    kind: text().$type<'goods' | 'product' | 'material' | 'service'>().notNull(),
    /** 규격 */
    spec: text(),
    unit: text().notNull().default('EA'),
    barcode: text(),
    vatType: text().$type<'taxable' | 'zero_rated' | 'exempt'>().notNull().default('taxable'),
    salesPrice: won(),
    purchasePrice: won(),
    /** 비우면 품목 구분별 기본 계정 */
    salesAccountId: uuid().references(() => accounts.id, { onDelete: 'restrict' }),
    purchaseAccountId: uuid().references(() => accounts.id, { onDelete: 'restrict' }),
    safetyStock: quantity(),
    trackLot: boolean().notNull().default(false),
    trackSerial: boolean().notNull().default(false),
    memo: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('items_company_code_uq').on(t.companyId, t.code),
    uniqueIndex('items_company_barcode_uq')
      .on(t.companyId, t.barcode)
      .where(sql`barcode is not null`),
    index('items_company_name_idx').on(t.companyId, t.name),
    check('items_kind_ck', sql`kind in ('goods', 'product', 'material', 'service')`),
    check('items_vat_type_ck', sql`vat_type in ('taxable', 'zero_rated', 'exempt')`),
    check(
      'items_price_ck',
      sql`coalesce(sales_price, 0) >= 0 and coalesce(purchase_price, 0) >= 0`,
    ),
    check(
      'items_service_ck',
      sql`kind <> 'service' or (not track_lot and not track_serial and safety_stock is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** 창고 */
export const warehouses = pgTable(
  'warehouses',
  {
    id: id(),
    companyId: companyRef(),
    code: text().notNull(),
    name: text().notNull(),
    address: text(),
    memo: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('warehouses_company_code_uq').on(t.companyId, t.code),
    tenantIsolationPolicy(),
  ],
);

/** 거래처별 단가(판매·구매). 품목 기본 단가보다 먼저 쓴다. */
export const partnerItemPrices = pgTable(
  'partner_item_prices',
  {
    id: id(),
    companyId: companyRef(),
    partnerId: uuid()
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    salesPrice: won(),
    purchasePrice: won(),
    memo: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('partner_item_prices_uq').on(t.companyId, t.partnerId, t.itemId),
    index('partner_item_prices_item_idx').on(t.itemId),
    check(
      'partner_item_prices_ck',
      sql`(sales_price is not null or purchase_price is not null) and coalesce(sales_price, 0) >= 0 and coalesce(purchase_price, 0) >= 0`,
    ),
    tenantIsolationPolicy(),
  ],
);

// ── 거래 문서(견적·주문·출고·판매·반품, 발주·입고·구매·반품, 창고 이동·재고 조정·기초재고) ──

/** 거래 문서 머리 */
export const tradeDocs = pgTable(
  'trade_docs',
  {
    id: id(),
    companyId: companyRef(),
    kind: text().$type<TradeDocKind>().notNull(),
    /** 종류별 접두어-일자-순번(예: PO-20261108-001) */
    docNo: text().notNull(),
    docDate: date().notNull(),
    partnerId: uuid().references(() => partners.id, { onDelete: 'restrict' }),
    /** 기본 창고(줄마다 바꿀 수 있다) */
    warehouseId: uuid().references(() => warehouses.id, { onDelete: 'restrict' }),
    /** 창고 이동의 받는 창고 */
    toWarehouseId: uuid().references(() => warehouses.id, { onDelete: 'restrict' }),
    /** 앞 단계 문서(주문 → 출고 → 판매, 발주 → 입고 → 구매, 판매 → 반품) */
    sourceDocId: uuid().references((): AnyPgColumn => tradeDocs.id, { onDelete: 'restrict' }),
    /** open·closed(견적·주문·발주), posted(전기한 문서), cancelled */
    status: text().$type<'open' | 'closed' | 'posted' | 'cancelled'>().notNull(),
    /** 증빙: 세금계산서·계산서·카드·현금영수증·없음 */
    evidenceType: text(),
    supplyTotal: won().notNull().default(0),
    vatTotal: won().notNull().default(0),
    total: won().notNull().default(0),
    dueDate: date(),
    memo: text(),
    /** 매출·매입·입고 전표 */
    entryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
    /** 매출원가·재고조정 전표 */
    costEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    cancelReason: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('trade_docs_company_no_uq').on(t.companyId, t.docNo),
    index('trade_docs_company_kind_date_idx').on(t.companyId, t.kind, t.docDate),
    index('trade_docs_source_idx').on(t.sourceDocId),
    check(
      'trade_docs_kind_ck',
      sql`kind in ('quote', 'sales_order', 'shipment', 'sale', 'sales_return', 'purchase_order', 'receipt', 'purchase', 'purchase_return', 'transfer', 'adjustment', 'opening')`,
    ),
    check('trade_docs_status_ck', sql`status in ('open', 'closed', 'posted', 'cancelled')`),
    check('trade_docs_total_ck', sql`total = supply_total + vat_total`),
    tenantIsolationPolicy(),
  ],
);

/** 거래 문서 줄(품목). 품목명·규격·단위는 문서를 만들 때 값을 남긴다. */
export const tradeDocLines = pgTable(
  'trade_doc_lines',
  {
    id: id(),
    companyId: companyRef(),
    docId: uuid()
      .notNull()
      .references(() => tradeDocs.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    itemName: text().notNull(),
    spec: text(),
    unit: text().notNull(),
    qty: quantity().notNull(),
    unitPrice: won().notNull().default(0),
    supply: won().notNull().default(0),
    vat: won().notNull().default(0),
    warehouseId: uuid().references(() => warehouses.id, { onDelete: 'restrict' }),
    /** 앞 단계 문서의 줄(남은 수량 계산) */
    sourceLineId: uuid().references((): AnyPgColumn => tradeDocLines.id, { onDelete: 'restrict' }),
    lotNo: text(),
    memo: text(),
  },
  (t) => [
    index('trade_doc_lines_doc_idx').on(t.docId),
    index('trade_doc_lines_source_idx').on(t.sourceLineId),
    index('trade_doc_lines_item_idx').on(t.companyId, t.itemId),
    check('trade_doc_lines_qty_ck', sql`qty > 0`),
    check('trade_doc_lines_amount_ck', sql`unit_price >= 0 and supply >= 0 and vat >= 0`),
    tenantIsolationPolicy(),
  ],
);

/**
 * 재고 이동(재고수불부). 들어오면 qty·amount 가 +, 나가면 -.
 * 문서를 취소하면 그 문서의 이동을 지우고 품목 원가를 다시 계산한다.
 */
export const stockMoves = pgTable(
  'stock_moves',
  {
    id: id(),
    companyId: companyRef(),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    warehouseId: uuid()
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    moveDate: date().notNull(),
    seq: bigint({ mode: 'number' }).generatedAlwaysAsIdentity(),
    qty: quantity().notNull(),
    amount: won().notNull().default(0),
    costing: text().$type<'fixed' | 'average' | 'none'>().notNull(),
    docId: uuid()
      .notNull()
      .references(() => tradeDocs.id, { onDelete: 'cascade' }),
    docLineId: uuid().references(() => tradeDocLines.id, { onDelete: 'cascade' }),
    lotNo: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_moves_item_idx').on(t.companyId, t.itemId, t.moveDate),
    index('stock_moves_doc_idx').on(t.docId),
    check('stock_moves_costing_ck', sql`costing in ('fixed', 'average', 'none')`),
    check('stock_moves_qty_ck', sql`qty <> 0`),
    tenantIsolationPolicy(),
  ],
);

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { accounts, partners } from './accounting-master.js';
import { companies } from './companies.js';

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

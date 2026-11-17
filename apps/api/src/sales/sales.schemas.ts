import { VAT_TYPES } from '@wellbuddy/accounting-core';
import {
  ITEM_KINDS,
  ITEM_PRICE_SIDES,
  JOURNAL_STATUSES,
  TRADE_DOC_KINDS,
  TRADE_DOC_STATUSES,
} from '@wellbuddy/shared';
import { z } from 'zod';

export const ItemSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(ITEM_KINDS),
  spec: z.string().nullable(),
  unit: z.string(),
  barcode: z.string().nullable(),
  vatType: z.enum(VAT_TYPES),
  salesPrice: z.number().nullable(),
  purchasePrice: z.number().nullable(),
  salesAccountId: z.uuid().nullable(),
  purchaseAccountId: z.uuid().nullable(),
  safetyStock: z.number().nullable(),
  trackLot: z.boolean(),
  trackSerial: z.boolean(),
  memo: z.string().nullable(),
  isActive: z.boolean(),
});

export const ItemListQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  kind: z.enum(ITEM_KINDS).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const ItemPriceQuerySchema = z.object({
  side: z.enum(ITEM_PRICE_SIDES).default('sales'),
  partnerId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
});

export const ItemPriceSchema = z.object({
  /** 정해진 단가가 없으면 null */
  unitPrice: z.number().nullable(),
  /** partner: 거래처별 단가, item: 품목 기본 단가 */
  source: z.enum(['partner', 'item']).nullable(),
});

export const WarehouseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  memo: z.string().nullable(),
  isActive: z.boolean(),
});

export const PartnerPriceSchema = z.object({
  id: z.uuid(),
  partnerId: z.uuid(),
  partnerName: z.string(),
  itemId: z.uuid(),
  itemCode: z.string(),
  itemName: z.string(),
  unit: z.string(),
  salesPrice: z.number().nullable(),
  purchasePrice: z.number().nullable(),
  memo: z.string().nullable(),
});

export const PartnerPriceQuerySchema = z.object({
  partnerId: z.uuid().optional(),
  itemId: z.uuid().optional(),
});

// ── 거래 문서 ────────────────────────────────────────────

const IsoDate = z.iso.date();

const TradeDocHeaderSchema = z.object({
  id: z.uuid(),
  kind: z.enum(TRADE_DOC_KINDS),
  kindLabel: z.string(),
  docNo: z.string(),
  docDate: z.string(),
  partnerId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
  toWarehouseId: z.uuid().nullable(),
  sourceDocId: z.uuid().nullable(),
  status: z.enum(TRADE_DOC_STATUSES),
  evidenceType: z.string().nullable(),
  supplyTotal: z.number(),
  vatTotal: z.number(),
  total: z.number(),
  dueDate: z.string().nullable(),
  memo: z.string().nullable(),
  createdAt: z.string(),
});

export const TradeDocListSchema = z.object({
  items: z.array(
    TradeDocHeaderSchema.extend({
      partnerName: z.string().nullable(),
      warehouseName: z.string().nullable(),
      sourceDocNo: z.string().nullable(),
    }),
  ),
  total: z.number(),
});

const EntryRefSchema = z
  .object({ id: z.uuid(), number: z.string(), status: z.enum(JOURNAL_STATUSES) })
  .nullable();

export const TradeDocSchema = TradeDocHeaderSchema.extend({
  partnerName: z.string().nullable(),
  partnerBizRegNo: z.string().nullable(),
  warehouseName: z.string().nullable(),
  toWarehouseName: z.string().nullable(),
  sourceDoc: z
    .object({ id: z.uuid(), kind: z.enum(TRADE_DOC_KINDS), docNo: z.string() })
    .nullable(),
  createdByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  entry: EntryRefSchema,
  costEntry: EntryRefSchema,
  /** 짝지은 세금계산서: 이 판매에서 발행(issueId)했거나 수집한 것을 자동으로 이은 것(collected) */
  taxInvoice: z
    .object({
      evidenceId: z.uuid().nullable(),
      issueId: z.uuid().nullable(),
      status: z.enum(['issued', 'sent', 'failed', 'collected']),
      approvalNo: z.string().nullable(),
      issueDate: z.string(),
      totalAmount: z.number(),
      /** 월합계로 함께 이은 다른 문서 수 */
      sharedWith: z.number(),
    })
    .nullable(),
  lines: z.array(
    z.object({
      id: z.uuid(),
      lineNo: z.number(),
      itemId: z.uuid(),
      itemCode: z.string(),
      itemName: z.string(),
      spec: z.string().nullable(),
      unit: z.string(),
      qty: z.number(),
      unitPrice: z.number(),
      supply: z.number(),
      vat: z.number(),
      warehouseId: z.uuid().nullable(),
      warehouseName: z.string().nullable(),
      sourceLineId: z.uuid().nullable(),
      lotNo: z.string().nullable(),
      memo: z.string().nullable(),
      processedQty: z.number(),
      remainingQty: z.number(),
    }),
  ),
  children: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(TRADE_DOC_KINDS),
      docNo: z.string(),
      docDate: z.string(),
      status: z.enum(TRADE_DOC_STATUSES),
      total: z.number(),
    }),
  ),
});

export const TradeDocListQuerySchema = z.object({
  /** 쉼표로 여러 종류(예: purchase_order,receipt) */
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((k) => k.trim()) : undefined))
    .pipe(z.array(z.enum(TRADE_DOC_KINDS)).optional()),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  partnerId: z.uuid().optional(),
  status: z.enum(TRADE_DOC_STATUSES).optional(),
  q: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── 재고 ─────────────────────────────────────────────────

export const StockQuerySchema = z.object({
  date: IsoDate.optional(),
  warehouseId: z.uuid().optional(),
  itemId: z.uuid().optional(),
});

export const StockRowSchema = z.object({
  itemId: z.uuid(),
  code: z.string(),
  name: z.string(),
  spec: z.string().nullable(),
  unit: z.string(),
  kind: z.enum(ITEM_KINDS),
  qty: z.number(),
  totalQty: z.number(),
  value: z.number(),
  unitCost: z.number().nullable(),
  safetyStock: z.number().nullable(),
  belowSafety: z.boolean(),
  warehouses: z.array(z.object({ warehouseId: z.uuid(), qty: z.number() })),
  isActive: z.boolean(),
});

export const LedgerQuerySchema = z.object({
  itemId: z.uuid(),
  warehouseId: z.uuid().optional(),
  /** LOT·시리얼 하나의 이력(추적) */
  lotNo: z.string().trim().min(1).max(50).optional(),
  from: IsoDate,
  to: IsoDate,
});

export const LedgerSchema = z.object({
  opening: z.object({ qty: z.number(), value: z.number() }),
  closing: z.object({ qty: z.number(), value: z.number() }),
  lines: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      docId: z.uuid(),
      docNo: z.string(),
      kind: z.enum(TRADE_DOC_KINDS),
      kindLabel: z.string(),
      partnerName: z.string().nullable(),
      warehouseId: z.uuid(),
      warehouseName: z.string(),
      lotNo: z.string().nullable(),
      inQty: z.number(),
      outQty: z.number(),
      amount: z.number(),
      balanceQty: z.number(),
      balanceValue: z.number(),
    }),
  ),
});

export const InventorySummaryQuerySchema = z.object({
  from: IsoDate,
  to: IsoDate,
  warehouseId: z.uuid().optional(),
});

const QtyValue = z.object({ qty: z.number(), value: z.number() });

export const InventorySummarySchema = z.object({
  rows: z.array(
    z.object({
      itemId: z.uuid(),
      code: z.string(),
      name: z.string(),
      spec: z.string().nullable(),
      unit: z.string(),
      opening: QtyValue,
      in: QtyValue,
      out: QtyValue,
      closing: QtyValue,
    }),
  ),
  totals: z.object({ opening: z.number(), in: z.number(), out: z.number(), closing: z.number() }),
});

export const InventoryReconcileQuerySchema = z.object({ date: IsoDate.optional() });

export const InventoryReconcileSchema = z.object({
  date: z.string(),
  balanced: z.boolean(),
  rows: z.array(
    z.object({
      accountId: z.uuid(),
      code: z.string(),
      name: z.string(),
      stockValue: z.number(),
      ledgerBalance: z.number(),
      difference: z.number(),
      /** 승인을 기다리는 영업 전표(장부 잔액에 아직 없음) */
      pendingTrade: z.number(),
      /** 재고 계정을 직접 움직인 일반 전표(차이의 원인 후보) */
      otherEntries: z.array(
        z.object({
          id: z.uuid(),
          number: z.string(),
          date: z.string(),
          description: z.string().nullable(),
          amount: z.number(),
        }),
      ),
    }),
  ),
});

export const LotQuerySchema = z.object({
  itemId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  date: IsoDate.optional(),
});

export const LotRowSchema = z.object({
  itemId: z.uuid(),
  itemName: z.string(),
  lotNo: z.string(),
  warehouseId: z.uuid(),
  warehouseName: z.string(),
  qty: z.number(),
  /** 처음 들어온 날 */
  firstDate: z.string(),
});

export const InventoryAlertSchema = z.object({
  itemId: z.uuid(),
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  qty: z.number(),
  safetyStock: z.number(),
  /** 적정재고까지 모자란 수량 */
  shortfall: z.number(),
});

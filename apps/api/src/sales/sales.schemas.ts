import { VAT_TYPES } from '@wellbuddy/accounting-core';
import { ITEM_KINDS, ITEM_PRICE_SIDES } from '@wellbuddy/shared';
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

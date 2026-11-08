import { VAT_TYPES } from '@wellbuddy/accounting-core';
import { z } from 'zod';
import { WonSchema } from './journal.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullish());
const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullish());
const optionalWon = z.preprocess(emptyToNull, WonSchema.nullish());

// ── 수량 ─────────────────────────────────────────────────

/** 수량은 소수 셋째 자리까지(kg·m 등). DB 는 numeric(15,3) */
export const QUANTITY_MAX = 999_999_999_999;

const hasThreeDecimals = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;

export const QuantitySchema = z
  .number({ error: '수량을 숫자로 입력해 주세요.' })
  .gt(0, { error: '수량은 0보다 커야 합니다.' })
  .max(QUANTITY_MAX)
  .refine(hasThreeDecimals, { error: '수량은 소수 셋째 자리까지 입력할 수 있습니다.' });

/** 0 이상 수량(적정재고 등) */
export const NonNegativeQuantitySchema = z
  .number({ error: '수량을 숫자로 입력해 주세요.' })
  .min(0, { error: '수량은 0 이상입니다.' })
  .max(QUANTITY_MAX)
  .refine(hasThreeDecimals, { error: '수량은 소수 셋째 자리까지 입력할 수 있습니다.' });

// ── 품목 ─────────────────────────────────────────────────

export const ITEM_KINDS = ['goods', 'product', 'material', 'service'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  goods: '상품',
  product: '제품',
  material: '원재료',
  service: '서비스',
};

/**
 * 품목 구분별 기본 계정 코드. 품목마다 매출·매입 계정을 따로 정할 수 있다.
 * - inventory: 재고자산(서비스는 재고를 두지 않는다)
 * - revenue: 판매할 때 매출 계정
 * - cogs: 출고할 때 매출원가 계정
 * - purchase: 서비스를 살 때 비용 계정(재고 품목은 재고자산으로 받는다)
 */
export const ITEM_KIND_ACCOUNTS: Record<
  ItemKind,
  { inventory: string | null; revenue: string; cogs: string | null; purchase: string }
> = {
  goods: { inventory: '146', revenue: '401', cogs: '451', purchase: '146' },
  product: { inventory: '150', revenue: '404', cogs: '455', purchase: '150' },
  material: { inventory: '153', revenue: '401', cogs: '451', purchase: '153' },
  service: { inventory: null, revenue: '411', cogs: null, purchase: '831' },
};

/** 재고를 관리하는 품목인가(서비스가 아니면 재고를 둔다) */
export const isStockItem = (kind: ItemKind) => kind !== 'service';

const ItemCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,30}$/, { error: '품목코드는 영문·숫자 30자 이내입니다.' });
const BarcodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{4,64}$/, { error: '바코드는 영문·숫자·- 4~64자입니다.' });

/** 기본값이 없는 품목 필드(수정은 보낸 필드만 바꾼다: zod 4 는 partial 안의 기본값도 채운다) */
const ItemFields = z.object({
  /** 비우면 자동 부여 */
  code: z.preprocess(emptyToNull, ItemCodeSchema.nullish()),
  name: z.string().trim().min(1, { error: '품목명을 입력해 주세요.' }).max(100),
  kind: z.enum(ITEM_KINDS, { error: '품목 구분을 선택해 주세요.' }),
  /** 규격 */
  spec: optionalText(100),
  unit: z.string().trim().min(1, { error: '단위를 입력해 주세요.' }).max(10),
  barcode: z.preprocess(emptyToNull, BarcodeSchema.nullish()),
  vatType: z.enum(VAT_TYPES),
  /** 기본 판매·구매 단가(원). 거래처별 단가가 있으면 그것을 먼저 쓴다 */
  salesPrice: optionalWon,
  purchasePrice: optionalWon,
  /** 비우면 구분별 기본 계정(ITEM_KIND_ACCOUNTS) */
  salesAccountId: optionalUuid,
  purchaseAccountId: optionalUuid,
  /** 적정재고(이 수량 아래로 내려가면 알림) */
  safetyStock: z.preprocess(emptyToNull, NonNegativeQuantitySchema.nullish()),
  trackLot: z.boolean(),
  trackSerial: z.boolean(),
  memo: optionalText(500),
  isActive: z.boolean(),
});

const serviceRule = (v: {
  kind?: ItemKind;
  trackLot?: boolean;
  trackSerial?: boolean;
  safetyStock?: number | null;
}) => v.kind !== 'service' || (!v.trackLot && !v.trackSerial && v.safetyStock == null);
const SERVICE_RULE = {
  error: '서비스 품목은 재고를 두지 않아 LOT·시리얼·적정재고를 쓸 수 없습니다.',
  path: ['kind'],
};

export const ItemInputSchema = ItemFields.extend({
  kind: ItemFields.shape.kind.default('goods'),
  unit: z.preprocess(emptyToNull, z.string().trim().max(10).nullish()).transform((v) => v ?? 'EA'),
  vatType: ItemFields.shape.vatType.default('taxable'),
  trackLot: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  isActive: z.boolean().default(true),
}).refine(serviceRule, SERVICE_RULE);
export type ItemInput = z.infer<typeof ItemInputSchema>;

export const ItemUpdateSchema = ItemFields.partial().refine(serviceRule, SERVICE_RULE);
export type ItemUpdateInput = z.infer<typeof ItemUpdateSchema>;

export const ITEM_PRICE_SIDES = ['sales', 'purchase'] as const;
export type ItemPriceSide = (typeof ITEM_PRICE_SIDES)[number];

// ── 창고 ─────────────────────────────────────────────────

const WarehouseFields = z.object({
  /** 비우면 자동 부여(W01, W02 …) */
  code: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,20}$/, { error: '창고코드는 영문·숫자 20자 이내입니다.' })
      .nullish(),
  ),
  name: z.string().trim().min(1, { error: '창고명을 입력해 주세요.' }).max(50),
  address: optionalText(200),
  memo: optionalText(500),
  isActive: z.boolean(),
});

export const WarehouseInputSchema = WarehouseFields.extend({
  isActive: z.boolean().default(true),
});
export type WarehouseInput = z.infer<typeof WarehouseInputSchema>;
export const WarehouseUpdateSchema = WarehouseFields.partial();
export type WarehouseUpdateInput = z.infer<typeof WarehouseUpdateSchema>;

// ── 거래처별 단가 ────────────────────────────────────────

export const PartnerPriceInputSchema = z
  .object({
    partnerId: z.uuid({ error: '거래처를 선택해 주세요.' }),
    itemId: z.uuid({ error: '품목을 선택해 주세요.' }),
    salesPrice: optionalWon,
    purchasePrice: optionalWon,
    memo: optionalText(200),
  })
  .refine((v) => v.salesPrice != null || v.purchasePrice != null, {
    error: '판매단가나 구매단가 중 하나는 입력해 주세요.',
    path: ['salesPrice'],
  });
export type PartnerPriceInput = z.infer<typeof PartnerPriceInputSchema>;

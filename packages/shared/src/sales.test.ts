import { describe, expect, it } from 'vitest';
import { PartnerUpdateSchema } from './accounting.js';
import {
  ItemInputSchema,
  ItemUpdateSchema,
  PartnerPriceInputSchema,
  QuantitySchema,
} from './sales.js';

describe('품목 스키마', () => {
  it('비운 값은 기본값(상품·EA·과세·사용)으로 채운다', () => {
    expect(ItemInputSchema.parse({ name: 'A4 용지', unit: '', code: '' })).toMatchObject({
      name: 'A4 용지',
      kind: 'goods',
      unit: 'EA',
      vatType: 'taxable',
      code: null,
      trackLot: false,
      trackSerial: false,
      isActive: true,
    });
  });

  it('수정은 보낸 필드만 남긴다(기본값으로 덮어쓰지 않는다)', () => {
    expect(ItemUpdateSchema.parse({ name: '새 이름' })).toEqual({ name: '새 이름' });
    expect(PartnerUpdateSchema.parse({ name: '새 거래처명' })).toEqual({ name: '새 거래처명' });
  });

  it('서비스 품목은 LOT·시리얼·적정재고를 쓸 수 없다', () => {
    expect(ItemInputSchema.safeParse({ name: '설치비', kind: 'service' }).success).toBe(true);
    for (const extra of [{ trackLot: true }, { trackSerial: true }, { safetyStock: 5 }]) {
      const r = ItemInputSchema.safeParse({ name: '설치비', kind: 'service', ...extra });
      expect(r.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('바코드·코드 형식', () => {
    expect(ItemInputSchema.safeParse({ name: 'x', barcode: '8801234567890' }).success).toBe(true);
    expect(ItemInputSchema.safeParse({ name: 'x', barcode: '12' }).success).toBe(false);
    expect(ItemInputSchema.safeParse({ name: 'x', code: '가나다' }).success).toBe(false);
  });
});

describe('수량', () => {
  it('0보다 크고 소수 셋째 자리까지', () => {
    expect(QuantitySchema.safeParse(1.5).success).toBe(true);
    expect(QuantitySchema.safeParse(0.125).success).toBe(true);
    expect(QuantitySchema.safeParse(0.1 + 0.2).success).toBe(true);
    expect(QuantitySchema.safeParse(0).success).toBe(false);
    expect(QuantitySchema.safeParse(1.2345).success).toBe(false);
  });
});

describe('거래처별 단가', () => {
  const ids = {
    partnerId: '00000000-0000-4000-8000-000000000001',
    itemId: '00000000-0000-4000-8000-000000000002',
  };
  it('판매·구매 단가 중 하나는 있어야 한다', () => {
    expect(PartnerPriceInputSchema.safeParse({ ...ids, salesPrice: 1000 }).success).toBe(true);
    expect(PartnerPriceInputSchema.safeParse({ ...ids, salesPrice: '' }).success).toBe(false);
  });
});

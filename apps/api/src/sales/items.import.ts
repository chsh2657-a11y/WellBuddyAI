import { Injectable, type OnModuleInit } from '@nestjs/common';
import { VAT_TYPE_LABELS, VAT_TYPES, type VatType } from '@wellbuddy/accounting-core';
import {
  ITEM_KIND_LABELS,
  ITEM_KINDS,
  type ItemInput,
  ItemInputSchema,
  type ItemKind,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { ImportRegistry } from '../imports/import-registry.js';
import { ItemsService } from './items.service.js';

const KIND_BY_LABEL = new Map<string, ItemKind>(ITEM_KINDS.map((k) => [ITEM_KIND_LABELS[k], k]));
const VAT_BY_LABEL = new Map<string, VatType>(VAT_TYPES.map((v) => [VAT_TYPE_LABELS[v], v]));
const NUMBER_KEYS = ['salesPrice', 'purchasePrice', 'safetyStock'] as const;

/** 엑셀의 구분·과세는 한글 라벨로, 금액·수량은 천 단위 쉼표가 있어도 받는다. */
const RowSchema = z.preprocess((raw) => {
  const row = { ...(raw as Record<string, unknown>) };
  if (typeof row.kind === 'string') row.kind = KIND_BY_LABEL.get(row.kind.trim()) ?? row.kind;
  if (typeof row.vatType === 'string') {
    row.vatType = VAT_BY_LABEL.get(row.vatType.trim()) ?? row.vatType;
  }
  for (const key of NUMBER_KEYS) {
    const v = row[key];
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v.replace(/[,\s원]/g, ''));
      row[key] = Number.isFinite(n) ? n : v;
    }
  }
  return row;
}, ItemInputSchema);

@Injectable()
export class ItemsImport implements OnModuleInit {
  constructor(
    private readonly registry: ImportRegistry,
    private readonly items: ItemsService,
  ) {}

  onModuleInit() {
    this.registry.register<ItemInput>({
      key: 'items',
      label: '품목',
      permission: 'sales',
      columns: [
        {
          key: 'code',
          header: '품목코드',
          required: false,
          example: '',
          help: '비우면 자동으로 부여합니다. 같은 코드가 있으면 그 품목을 수정합니다.',
        },
        { key: 'name', header: '품목명', required: true, example: 'A4 복사용지', width: 24 },
        {
          key: 'kind',
          header: '구분',
          required: false,
          example: '상품',
          help: `${ITEM_KINDS.map((k) => ITEM_KIND_LABELS[k]).join(' / ')} 중 하나(비우면 상품)`,
        },
        { key: 'spec', header: '규격', required: false, example: '80g 500매' },
        { key: 'unit', header: '단위', required: false, example: 'BOX', help: '비우면 EA' },
        {
          key: 'barcode',
          header: '바코드',
          required: false,
          example: '8801234567890',
          width: 18,
        },
        {
          key: 'vatType',
          header: '과세구분',
          required: false,
          example: '과세',
          help: '과세 / 영세 / 면세 중 하나(비우면 과세)',
        },
        { key: 'salesPrice', header: '판매단가', required: false, example: '25000' },
        { key: 'purchasePrice', header: '구매단가', required: false, example: '18000' },
        { key: 'safetyStock', header: '적정재고', required: false, example: '10' },
        { key: 'memo', header: '메모', required: false, example: '', width: 24 },
      ],
      rowSchema: RowSchema as z.ZodType<ItemInput>,
      uniqueBy: (row) => (row.code ? `code:${row.code}` : `name:${row.name}`),
      commit: (rows) => this.items.upsertMany(rows),
      exportRows: async () =>
        (await this.items.list({ includeInactive: true })).map((i) => ({
          ...i,
          kind: ITEM_KIND_LABELS[i.kind],
          vatType: VAT_TYPE_LABELS[i.vatType],
          spec: i.spec ?? '',
          barcode: i.barcode ?? '',
          salesPrice: i.salesPrice ?? '',
          purchasePrice: i.purchasePrice ?? '',
          safetyStock: i.safetyStock ?? '',
          memo: i.memo ?? '',
        })),
    });
  }
}

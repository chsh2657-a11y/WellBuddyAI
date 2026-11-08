import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { accounts, items, partnerItemPrices, type Transaction } from '@wellbuddy/db';
import {
  isStockItem,
  type ItemInput,
  type ItemKind,
  type ItemPriceSide,
  type ItemUpdateInput,
} from '@wellbuddy/shared';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

type Row = typeof items.$inferSelect;

export interface ItemListOptions {
  q?: string;
  kind?: ItemKind;
  includeInactive?: boolean;
}

/** 매입 계정으로 고를 수 있는 구분: 재고 품목은 재고자산, 서비스는 비용 */
const EXPENSE_GROUPS = ['cost_of_sales', 'manufacturing_cost', 'sga', 'non_operating_expense'];

/** 품목(상품·제품·원재료·서비스): 규격·단위·바코드·기본 단가·계정 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(options: ItemListOptions = {}) {
    const q = options.q ? `%${options.q}%` : undefined;
    const rows = await this.db.tenant((tx) =>
      tx
        .select()
        .from(items)
        .where(
          and(
            options.includeInactive ? undefined : eq(items.isActive, true),
            options.kind ? eq(items.kind, options.kind) : undefined,
            q
              ? or(
                  ilike(items.name, q),
                  ilike(items.code, q),
                  ilike(items.barcode, q),
                  ilike(items.spec, q),
                )
              : undefined,
          ),
        )
        .orderBy(asc(items.code)),
    );
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string) {
    const [row] = await this.db.tenant((tx) => tx.select().from(items).where(eq(items.id, id)));
    if (!row) throw new NotFoundException();
    return this.toDto(row);
  }

  /** 바코드로 품목 찾기(스캐너·카메라 입력) */
  async byBarcode(barcode: string) {
    const [row] = await this.db.tenant((tx) =>
      tx.select().from(items).where(eq(items.barcode, barcode.trim())),
    );
    if (!row) {
      throw new AppException(
        'ITEM_NOT_FOUND',
        `바코드 ${barcode} 에 해당하는 품목이 없습니다.`,
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toDto(row);
  }

  async create(input: ItemInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        await this.assertAccounts(tx, input);
        const code = input.code || (await this.nextCode(tx));
        const [row] = await tx
          .insert(items)
          .values({ ...this.toValues(input), companyId, code, name: input.name, kind: input.kind })
          .returning();
        await this.audit.record(
          { action: 'item.create', entity: 'item', entityId: row!.id, after: this.toDto(row!) },
          tx,
        );
        return this.toDto(row!);
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async update(id: string, input: ItemUpdateInput) {
    try {
      return await this.db.tenant(async (tx) => {
        const [before] = await tx.select().from(items).where(eq(items.id, id));
        if (!before) throw new NotFoundException();
        const merged = { ...before, ...input };
        if (
          merged.kind === 'service' &&
          (merged.trackLot || merged.trackSerial || merged.safetyStock != null)
        ) {
          throw new AppException(
            'ITEM_SERVICE_STOCK',
            '서비스 품목은 재고를 두지 않아 LOT·시리얼·적정재고를 쓸 수 없습니다.',
          );
        }
        await this.assertAccounts(tx, merged);
        const [after] = await tx
          .update(items)
          .set({ ...this.toValues(input), ...(input.code ? { code: input.code } : {}) })
          .where(eq(items.id, id))
          .returning();
        await this.audit.record(
          {
            action: 'item.update',
            entity: 'item',
            entityId: id,
            before: this.toDto(before),
            after: this.toDto(after!),
          },
          tx,
        );
        return this.toDto(after!);
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async remove(id: string) {
    try {
      await this.db.tenant(async (tx) => {
        const [row] = await tx.select().from(items).where(eq(items.id, id));
        if (!row) throw new NotFoundException();
        await tx.delete(items).where(eq(items.id, id));
        await this.audit.record(
          { action: 'item.delete', entity: 'item', entityId: id, before: this.toDto(row) },
          tx,
        );
      });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new AppException(
          'ITEM_IN_USE',
          '거래에 사용된 품목은 삭제할 수 없습니다. 사용중지해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /**
   * 단가 찾기: 거래처별 단가 → 품목 기본 단가 순서. 정해진 값이 없으면 null.
   */
  async price(itemId: string, side: ItemPriceSide, partnerId?: string) {
    return this.db.tenant(async (tx) => {
      const [item] = await tx.select().from(items).where(eq(items.id, itemId));
      if (!item) throw new NotFoundException();
      const prices = await this.pricesIn(tx, side, [itemId], partnerId);
      return prices.get(itemId) ?? { unitPrice: null, source: null };
    });
  }

  /** 여러 품목의 단가를 한 번에 찾는다(거래 문서 입력) */
  async pricesIn(
    tx: Transaction,
    side: ItemPriceSide,
    itemIds: string[],
    partnerId?: string | null,
  ): Promise<Map<string, { unitPrice: number; source: 'partner' | 'item' }>> {
    const result = new Map<string, { unitPrice: number; source: 'partner' | 'item' }>();
    if (itemIds.length === 0) return result;
    if (partnerId) {
      const rows = await tx
        .select()
        .from(partnerItemPrices)
        .where(
          and(
            eq(partnerItemPrices.partnerId, partnerId),
            inArray(partnerItemPrices.itemId, itemIds),
          ),
        );
      for (const r of rows) {
        const value = side === 'sales' ? r.salesPrice : r.purchasePrice;
        if (value != null) result.set(r.itemId, { unitPrice: value, source: 'partner' });
      }
    }
    const rows = await tx.select().from(items).where(inArray(items.id, itemIds));
    for (const r of rows) {
      if (result.has(r.id)) continue;
      const value = side === 'sales' ? r.salesPrice : r.purchasePrice;
      if (value != null) result.set(r.id, { unitPrice: value, source: 'item' });
    }
    return result;
  }

  /** 엑셀 일괄 등록: 코드 → 바코드 → 품목명 순으로 같은 품목을 찾아 수정하고, 없으면 추가한다. */
  async upsertMany(rows: ItemInput[]) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        const existing = await tx
          .select({ id: items.id, code: items.code, barcode: items.barcode, name: items.name })
          .from(items);
        const byCode = new Map(existing.map((e) => [e.code, e.id]));
        const byBarcode = new Map(existing.filter((e) => e.barcode).map((e) => [e.barcode!, e.id]));
        const byName = new Map(existing.map((e) => [e.name, e.id]));
        let created = 0;
        let updated = 0;
        for (const row of rows) {
          const id =
            (row.code ? byCode.get(row.code) : undefined) ??
            (row.barcode ? byBarcode.get(row.barcode) : undefined) ??
            (row.code ? undefined : byName.get(row.name));
          if (id) {
            await tx
              .update(items)
              .set({ ...this.toValues(row), name: row.name, kind: row.kind })
              .where(eq(items.id, id));
            updated++;
          } else {
            const code = row.code || (await this.nextCode(tx));
            const [inserted] = await tx
              .insert(items)
              .values({ ...this.toValues(row), companyId, code, name: row.name, kind: row.kind })
              .returning({ id: items.id });
            byCode.set(code, inserted!.id);
            byName.set(row.name, inserted!.id);
            created++;
          }
        }
        await this.audit.record(
          { action: 'item.import', entity: 'item', after: { created, updated } },
          tx,
        );
        return { created, updated };
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  /** 매출 계정은 매출액, 매입 계정은 재고 품목이면 재고자산·서비스면 비용 계정만 고를 수 있다. */
  private async assertAccounts(
    tx: Transaction,
    v: { kind?: ItemKind; salesAccountId?: string | null; purchaseAccountId?: string | null },
  ) {
    const ids = [v.salesAccountId, v.purchaseAccountId].filter((x): x is string => !!x);
    if (ids.length === 0) return;
    const rows = await tx
      .select({ id: accounts.id, name: accounts.name, group: accounts.group })
      .from(accounts)
      .where(inArray(accounts.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (v.salesAccountId) {
      const a = byId.get(v.salesAccountId);
      if (!a || a.group !== 'revenue') {
        throw new AppException(
          'ITEM_ACCOUNT_INVALID',
          '매출 계정은 매출액 구분의 계정(예: 401 상품매출)만 고를 수 있습니다.',
        );
      }
    }
    if (v.purchaseAccountId) {
      const a = byId.get(v.purchaseAccountId);
      const stock = isStockItem(v.kind ?? 'goods');
      const ok = a && (stock ? a.group === 'inventories' : EXPENSE_GROUPS.includes(a.group));
      if (!ok) {
        throw new AppException(
          'ITEM_ACCOUNT_INVALID',
          stock
            ? '재고 품목의 매입 계정은 재고자산 계정(예: 146 상품)만 고를 수 있습니다.'
            : '서비스 품목의 매입 계정은 비용 계정(예: 831 지급수수료)만 고를 수 있습니다.',
        );
      }
    }
  }

  /** 숫자 코드 중 가장 큰 값 + 1 (5자리, 예: 00001) */
  private async nextCode(tx: Transaction): Promise<string> {
    const [row] = await tx
      .select({ max: sql<string | null>`max(${items.code}::bigint)` })
      .from(items)
      .where(sql`${items.code} ~ '^[0-9]{1,15}$'`);
    return String(Number(row?.max ?? 0) + 1).padStart(5, '0');
  }

  private toValues(input: ItemUpdateInput): Partial<typeof items.$inferInsert> {
    const { code: _code, ...rest } = input;
    return rest;
  }

  toDto(row: Row) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      spec: row.spec,
      unit: row.unit,
      barcode: row.barcode,
      vatType: row.vatType,
      salesPrice: row.salesPrice,
      purchasePrice: row.purchasePrice,
      salesAccountId: row.salesAccountId,
      purchaseAccountId: row.purchaseAccountId,
      safetyStock: row.safetyStock,
      trackLot: row.trackLot,
      trackSerial: row.trackSerial,
      memo: row.memo,
      isActive: row.isActive,
    };
  }

  private mapError(e: unknown) {
    if (isUniqueViolation(e)) {
      const detail = String((e as { cause?: { constraint?: string } }).cause?.constraint ?? '');
      return new AppException(
        'DUPLICATE_ITEM',
        detail.includes('barcode')
          ? '같은 바코드의 품목이 이미 있습니다.'
          : '같은 코드의 품목이 이미 있습니다.',
        HttpStatus.CONFLICT,
      );
    }
    return e;
  }
}

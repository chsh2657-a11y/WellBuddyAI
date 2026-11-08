import { HttpStatus, Injectable } from '@nestjs/common';
import { costMoves, fromMilli, stockShortages, toMilli } from '@wellbuddy/accounting-core';
import {
  items,
  partners,
  stockMoves,
  tradeDocs,
  type Transaction,
  warehouses,
} from '@wellbuddy/db';
import { TRADE_DOC_KIND_LABELS } from '@wellbuddy/shared';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';

export interface StockQuery {
  /** 이 날짜까지의 재고(기본: 전체) */
  date?: string;
  warehouseId?: string;
  itemId?: string;
}

export interface LedgerQuery {
  itemId: string;
  warehouseId?: string;
  from: string;
  to: string;
}

const qtyText = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });

/**
 * 재고: 이동평균 재원가·재고 부족 검사, 현재고, 재고수불부.
 * 거래 문서가 재고 이동을 넣거나 지우면 그 품목의 이동 전체를 다시 계산한다(소급 입력도 맞게).
 */
@Injectable()
export class InventoryService {
  constructor(private readonly db: DbService) {}

  /**
   * 품목들의 이동을 처음부터 다시 계산한다.
   * - 품목·창고별 재고가 어느 날이든 0보다 작아지면 INSUFFICIENT_STOCK 으로 거부한다.
   * - 평균원가 이동의 금액이 바뀌면 고치고, 그 이동이 속한 문서 id 들을 돌려준다(원가 전표를 다시 맞춘다).
   */
  async recostIn(tx: Transaction, itemIds: string[]): Promise<Set<string>> {
    const changedDocs = new Set<string>();
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return changedDocs;
    // 같은 품목을 동시에 고치지 않게 품목 행을 잠근다
    await tx.select({ id: items.id }).from(items).where(inArray(items.id, ids)).for('update');
    const rows = await tx
      .select({
        id: stockMoves.id,
        itemId: stockMoves.itemId,
        warehouseId: stockMoves.warehouseId,
        date: stockMoves.moveDate,
        seq: stockMoves.seq,
        qty: stockMoves.qty,
        amount: stockMoves.amount,
        costing: stockMoves.costing,
        docId: stockMoves.docId,
        lotNo: stockMoves.lotNo,
      })
      .from(stockMoves)
      .where(inArray(stockMoves.itemId, ids));

    const shortages = stockShortages(rows);
    if (shortages.length > 0) throw await this.shortageError(tx, shortages);

    const { amounts } = costMoves(rows);
    for (const row of rows) {
      if (row.costing !== 'average') continue;
      const amount = amounts.get(row.id) ?? 0;
      if (amount === row.amount) continue;
      await tx.update(stockMoves).set({ amount }).where(eq(stockMoves.id, row.id));
      changedDocs.add(row.docId);
    }
    return changedDocs;
  }

  private async shortageError(
    tx: Transaction,
    shortages: ReturnType<typeof stockShortages>,
  ): Promise<AppException> {
    const itemRows = await tx
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(inArray(items.id, [...new Set(shortages.map((s) => s.itemId))]));
    const whRows = await tx
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(inArray(warehouses.id, [...new Set(shortages.map((s) => s.warehouseId))]));
    const item = new Map(itemRows.map((r) => [r.id, r]));
    const wh = new Map(whRows.map((r) => [r.id, r.name]));
    const details = shortages.map((s) => ({
      ...s,
      itemName: item.get(s.itemId)?.name ?? '',
      warehouseName: wh.get(s.warehouseId) ?? '',
    }));
    const first = details[0]!;
    const unit = item.get(first.itemId)?.unit ?? '';
    return new AppException(
      'INSUFFICIENT_STOCK',
      `'${first.itemName}' 재고가 ${first.warehouseName}에서 ${first.date}에 ${qtyText(first.short)}${unit} 모자랍니다.` +
        (details.length > 1 ? ` (외 ${details.length - 1}건)` : ''),
      HttpStatus.CONFLICT,
      { shortages: details },
    );
  }

  /** 현재고: 품목·창고별 수량과 품목별 재고금액(이동평균) */
  async stock(query: StockQuery) {
    return this.db.tenant(async (tx) => {
      const moveWhere = and(
        query.date ? lte(stockMoves.moveDate, query.date) : undefined,
        query.itemId ? eq(stockMoves.itemId, query.itemId) : undefined,
      );
      const byWarehouse = await tx
        .select({
          itemId: stockMoves.itemId,
          warehouseId: stockMoves.warehouseId,
          qty: sql<string>`sum(${stockMoves.qty})`,
        })
        .from(stockMoves)
        .where(moveWhere)
        .groupBy(stockMoves.itemId, stockMoves.warehouseId);
      const byItem = await tx
        .select({
          itemId: stockMoves.itemId,
          qty: sql<string>`sum(${stockMoves.qty})`,
          value: sql<string>`sum(${stockMoves.amount})`,
        })
        .from(stockMoves)
        .where(moveWhere)
        .groupBy(stockMoves.itemId);
      const itemRows = await tx
        .select()
        .from(items)
        .where(
          and(
            sql`${items.kind} <> 'service'`,
            query.itemId ? eq(items.id, query.itemId) : undefined,
          ),
        )
        .orderBy(asc(items.code));
      const totals = new Map(byItem.map((r) => [r.itemId, r]));
      return itemRows
        .map((item) => {
          const t = totals.get(item.id);
          const warehousesQty = byWarehouse
            .filter((w) => w.itemId === item.id)
            .map((w) => ({ warehouseId: w.warehouseId, qty: Number(w.qty) }))
            .filter((w) => w.qty !== 0);
          const qty = query.warehouseId
            ? (warehousesQty.find((w) => w.warehouseId === query.warehouseId)?.qty ?? 0)
            : Number(t?.qty ?? 0);
          const totalQty = Number(t?.qty ?? 0);
          const value = Number(t?.value ?? 0);
          return {
            itemId: item.id,
            code: item.code,
            name: item.name,
            spec: item.spec,
            unit: item.unit,
            kind: item.kind,
            qty,
            /** 품목 전체(모든 창고) 수량·금액·평균단가 */
            totalQty,
            value,
            unitCost: totalQty > 0 ? Math.round(value / totalQty) : null,
            safetyStock: item.safetyStock,
            belowSafety: item.safetyStock != null && totalQty < item.safetyStock,
            warehouses: warehousesQty,
            isActive: item.isActive,
          };
        })
        .filter((r) => r.isActive || r.totalQty !== 0);
    });
  }

  /** 재고수불부: 기간 앞 이월 + 기간 중 입출고와 누계(창고를 고르면 수량만 그 창고 기준) */
  async ledger(query: LedgerQuery) {
    return this.db.tenant(async (tx) => {
      const scope = and(
        eq(stockMoves.itemId, query.itemId),
        query.warehouseId ? eq(stockMoves.warehouseId, query.warehouseId) : undefined,
      );
      const [opening] = await tx
        .select({
          qty: sql<string | null>`sum(${stockMoves.qty})`,
          value: sql<string | null>`sum(${stockMoves.amount})`,
        })
        .from(stockMoves)
        .where(and(scope, lt(stockMoves.moveDate, query.from)));
      const rows = await tx
        .select({
          id: stockMoves.id,
          date: stockMoves.moveDate,
          seq: stockMoves.seq,
          qty: stockMoves.qty,
          amount: stockMoves.amount,
          warehouseId: stockMoves.warehouseId,
          warehouseName: warehouses.name,
          docId: tradeDocs.id,
          docNo: tradeDocs.docNo,
          kind: tradeDocs.kind,
          partnerName: partners.name,
          lotNo: stockMoves.lotNo,
        })
        .from(stockMoves)
        .innerJoin(tradeDocs, eq(tradeDocs.id, stockMoves.docId))
        .innerJoin(warehouses, eq(warehouses.id, stockMoves.warehouseId))
        .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
        .where(and(scope, gte(stockMoves.moveDate, query.from), lte(stockMoves.moveDate, query.to)))
        .orderBy(
          asc(stockMoves.moveDate),
          sql`case when ${stockMoves.qty} > 0 then 0 else 1 end`,
          asc(stockMoves.seq),
        );
      let qtyMilli = toMilli(Number(opening?.qty ?? 0));
      let value = Number(opening?.value ?? 0);
      const lines = rows.map((r) => {
        qtyMilli += toMilli(r.qty);
        value += r.amount;
        return {
          id: r.id,
          date: r.date,
          docId: r.docId,
          docNo: r.docNo,
          kind: r.kind,
          kindLabel: TRADE_DOC_KIND_LABELS[r.kind],
          partnerName: r.partnerName,
          warehouseId: r.warehouseId,
          warehouseName: r.warehouseName,
          lotNo: r.lotNo,
          inQty: r.qty > 0 ? r.qty : 0,
          outQty: r.qty < 0 ? -r.qty : 0,
          amount: r.amount,
          balanceQty: fromMilli(qtyMilli),
          balanceValue: value,
        };
      });
      return {
        opening: { qty: Number(opening?.qty ?? 0), value: Number(opening?.value ?? 0) },
        lines,
        closing: { qty: fromMilli(qtyMilli), value },
      };
    });
  }
}

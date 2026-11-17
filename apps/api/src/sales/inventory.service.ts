import { HttpStatus, Injectable } from '@nestjs/common';
import {
  costMoves,
  fromMilli,
  serialDuplicates,
  stockShortages,
  toMilli,
} from '@wellbuddy/accounting-core';
import {
  accounts,
  items,
  journalEntries,
  journalLines,
  partners,
  stockMoves,
  tradeDocs,
  type Transaction,
  warehouses,
} from '@wellbuddy/db';
import {
  formatJournalNo,
  ITEM_KIND_ACCOUNTS,
  LEDGER_STATUSES,
  TRADE_DOC_KIND_LABELS,
} from '@wellbuddy/shared';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { ReportsService } from '../accounting/reports.service.js';
import { todayKst } from '../common/dates.js';
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
  /** LOT·시리얼 하나만(추적) */
  lotNo?: string;
  from: string;
  to: string;
}

export interface LotQuery {
  itemId?: string;
  warehouseId?: string;
  date?: string;
}

export interface SummaryQuery {
  from: string;
  to: string;
  warehouseId?: string;
}

/** 품목 구분 기본 재고 계정 */
const DEFAULT_INVENTORY_CODES = ['146', '150', '153'];

/** 영업 문서가 만든 전표와 그 역분개(대사에서 일반 전표와 나눈다) */
const fromTrade = sql`(${journalEntries.source} = 'trade' or (${journalEntries.source} = 'reversal' and exists (
  select 1 from journal_entries o where o.id = ${journalEntries.reversalOfId} and o.source = 'trade')))`;

const qtyText = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });

/**
 * 재고: 이동평균 재원가·재고 부족 검사, 현재고, 재고수불부.
 * 거래 문서가 재고 이동을 넣거나 지우면 그 품목의 이동 전체를 다시 계산한다(소급 입력도 맞게).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly db: DbService,
    private readonly reports: ReportsService,
  ) {}

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
    const flags = await tx
      .select({
        id: items.id,
        name: items.name,
        trackLot: items.trackLot,
        trackSerial: items.trackSerial,
      })
      .from(items)
      .where(inArray(items.id, ids))
      .for('update');
    const lotItems = new Set(flags.filter((f) => f.trackLot || f.trackSerial).map((f) => f.id));
    const serialItems = new Set(flags.filter((f) => f.trackSerial).map((f) => f.id));
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

    // LOT·시리얼 품목은 LOT 별로 재고가 모자라지 않은지 본다
    const shortages = [
      ...stockShortages(rows.filter((r) => !lotItems.has(r.itemId))),
      ...stockShortages(
        rows.filter((r) => lotItems.has(r.itemId)),
        { byLot: true },
      ),
    ];
    if (shortages.length > 0) throw await this.shortageError(tx, shortages);
    const [duplicate] = serialDuplicates(rows.filter((r) => serialItems.has(r.itemId)));
    if (duplicate) {
      const name = flags.find((f) => f.id === duplicate.itemId)?.name ?? '';
      throw new AppException(
        'DUPLICATE_SERIAL',
        `'${name}' 시리얼 ${duplicate.lotNo}이(가) ${duplicate.date}에 이미 재고에 있습니다.`,
        HttpStatus.CONFLICT,
        { itemId: duplicate.itemId, lotNo: duplicate.lotNo, date: duplicate.date },
      );
    }

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
      `'${first.itemName}'${first.lotNo ? `(LOT ${first.lotNo})` : ''} 재고가 ${first.warehouseName}에서 ${first.date}에 ${qtyText(first.short)}${unit} 모자랍니다.` +
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
        query.lotNo ? eq(stockMoves.lotNo, query.lotNo) : undefined,
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

  /** 적정재고 미달(P3-14): 회사 전체 수량이 적정재고보다 적은 사용 중 품목과 모자란 수량 */
  async alerts() {
    const rows = await this.stock({});
    return rows
      .filter((r) => r.isActive && r.belowSafety && r.safetyStock != null)
      .map((r) => ({
        itemId: r.itemId,
        code: r.code,
        name: r.name,
        unit: r.unit,
        qty: r.totalQty,
        safetyStock: r.safetyStock!,
        shortfall: fromMilli(toMilli(r.safetyStock!) - toMilli(r.totalQty)),
      }));
  }

  /** LOT·시리얼별 재고(LOT·시리얼 관리 품목만, 0 이 아닌 것) */
  async lots(query: LotQuery) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          itemId: stockMoves.itemId,
          itemName: items.name,
          lotNo: stockMoves.lotNo,
          warehouseId: stockMoves.warehouseId,
          warehouseName: warehouses.name,
          qty: sql<string>`sum(${stockMoves.qty})`,
          firstDate: sql<string>`min(${stockMoves.moveDate})`,
        })
        .from(stockMoves)
        .innerJoin(items, eq(items.id, stockMoves.itemId))
        .innerJoin(warehouses, eq(warehouses.id, stockMoves.warehouseId))
        .where(
          and(
            sql`(${items.trackLot} or ${items.trackSerial})`,
            sql`${stockMoves.lotNo} is not null`,
            query.itemId ? eq(stockMoves.itemId, query.itemId) : undefined,
            query.warehouseId ? eq(stockMoves.warehouseId, query.warehouseId) : undefined,
            query.date ? lte(stockMoves.moveDate, query.date) : undefined,
          ),
        )
        .groupBy(
          stockMoves.itemId,
          items.name,
          stockMoves.lotNo,
          stockMoves.warehouseId,
          warehouses.name,
        );
      // DB 정렬 규칙(C·en_US 등)에 따라 한글 순서가 달라지므로 여기서 한국어 순으로 정렬한다
      const ko = (a: string, b: string) => a.localeCompare(b, 'ko');
      return rows
        .map((r) => ({ ...r, lotNo: r.lotNo!, qty: fromMilli(toMilli(Number(r.qty))) }))
        .filter((r) => r.qty !== 0)
        .sort(
          (a, b) =>
            ko(a.itemName, b.itemName) ||
            ko(a.lotNo, b.lotNo) ||
            ko(a.warehouseName, b.warehouseName),
        );
    });
  }

  /** 재고수불현황: 기간의 품목별 기초·입고·출고·기말(창고를 고르지 않으면 창고 간 이동은 뺀다) */
  async summary(query: SummaryQuery) {
    if (query.from > query.to) {
      throw new AppException('RANGE_INVALID', '시작일이 종료일보다 늦습니다.');
    }
    return this.db.tenant(async (tx) => {
      const before = sql`${stockMoves.moveDate} < ${query.from}`;
      const during = sql`${stockMoves.moveDate} >= ${query.from}`;
      const sum = (expr: ReturnType<typeof sql>, filter: ReturnType<typeof sql>) =>
        sql<string>`coalesce(sum(${expr}) filter (where ${filter}), 0)`;
      const rows = await tx
        .select({
          itemId: stockMoves.itemId,
          code: items.code,
          name: items.name,
          spec: items.spec,
          unit: items.unit,
          openQty: sum(sql`${stockMoves.qty}`, before),
          openValue: sum(sql`${stockMoves.amount}`, before),
          inQty: sum(sql`${stockMoves.qty}`, sql`${during} and ${stockMoves.qty} > 0`),
          inValue: sum(sql`${stockMoves.amount}`, sql`${during} and ${stockMoves.qty} > 0`),
          outQty: sum(sql`-${stockMoves.qty}`, sql`${during} and ${stockMoves.qty} < 0`),
          outValue: sum(sql`-${stockMoves.amount}`, sql`${during} and ${stockMoves.qty} < 0`),
        })
        .from(stockMoves)
        .innerJoin(items, eq(items.id, stockMoves.itemId))
        .where(
          and(
            lte(stockMoves.moveDate, query.to),
            query.warehouseId
              ? eq(stockMoves.warehouseId, query.warehouseId)
              : sql`${stockMoves.costing} <> 'none'`,
          ),
        )
        .groupBy(stockMoves.itemId, items.code, items.name, items.spec, items.unit)
        .orderBy(asc(items.code));
      const qty = (v: string) => fromMilli(toMilli(Number(v)));
      const result = rows
        .map((r) => {
          const opening = { qty: qty(r.openQty), value: Number(r.openValue) };
          const inflow = { qty: qty(r.inQty), value: Number(r.inValue) };
          const outflow = { qty: qty(r.outQty), value: Number(r.outValue) };
          return {
            itemId: r.itemId,
            code: r.code,
            name: r.name,
            spec: r.spec,
            unit: r.unit,
            opening,
            in: inflow,
            out: outflow,
            closing: {
              qty: fromMilli(toMilli(opening.qty) + toMilli(inflow.qty) - toMilli(outflow.qty)),
              value: opening.value + inflow.value - outflow.value,
            },
          };
        })
        .filter(
          (r) =>
            r.opening.qty !== 0 ||
            r.opening.value !== 0 ||
            r.in.qty !== 0 ||
            r.out.qty !== 0 ||
            r.closing.value !== 0,
        );
      const total = (pick: (r: (typeof result)[number]) => number) =>
        result.reduce((s, r) => s + pick(r), 0);
      return {
        rows: result,
        totals: {
          opening: total((r) => r.opening.value),
          in: total((r) => r.in.value),
          out: total((r) => r.out.value),
          closing: total((r) => r.closing.value),
        },
      };
    });
  }

  /**
   * 재고–장부 대사: 재고 계정(품목의 재고 계정, 비우면 구분 기본 146·150·153)마다
   * 기준일 재고금액과 장부 잔액을 견주고, 차이의 원인이 될 전표(승인 대기 영업 전표, 일반 전표)를 보인다.
   */
  async reconcile(date?: string) {
    const asOf = date ?? todayKst();
    return this.db.tenant(async (tx) => {
      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code, name: accounts.name })
        .from(accounts);
      const byCode = new Map(accountRows.map((a) => [a.code, a]));
      const byId = new Map(accountRows.map((a) => [a.id, a]));

      const values = await tx
        .select({
          kind: items.kind,
          accountId: items.purchaseAccountId,
          value: sql<string>`coalesce(sum(${stockMoves.amount}), 0)`,
        })
        .from(stockMoves)
        .innerJoin(items, eq(items.id, stockMoves.itemId))
        .where(lte(stockMoves.moveDate, asOf))
        .groupBy(items.kind, items.purchaseAccountId);
      const stockValue = new Map<string, number>();
      for (const r of values) {
        const id = r.accountId ?? byCode.get(ITEM_KIND_ACCOUNTS[r.kind].purchase)?.id;
        if (id) stockValue.set(id, (stockValue.get(id) ?? 0) + Number(r.value));
      }
      const ids = [
        ...new Set([
          ...stockValue.keys(),
          ...DEFAULT_INVENTORY_CODES.flatMap((c) => (byCode.get(c) ? [byCode.get(c)!.id] : [])),
        ]),
      ];
      const { yearStart, balances } = await this.reports.accountBalancesIn(tx, ids, asOf);

      const net = sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`;
      const pending = await tx
        .select({ accountId: journalLines.accountId, amount: net })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(
          and(
            inArray(journalLines.accountId, ids),
            inArray(journalEntries.status, ['draft', 'pending']),
            eq(journalEntries.source, 'trade'),
            lte(journalEntries.entryDate, asOf),
          ),
        )
        .groupBy(journalLines.accountId);
      const others = await tx
        .select({
          accountId: journalLines.accountId,
          id: journalEntries.id,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
          description: journalEntries.description,
          amount: net,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(
          and(
            inArray(journalLines.accountId, ids),
            inArray(journalEntries.status, [...LEDGER_STATUSES]),
            gte(journalEntries.entryDate, yearStart),
            lte(journalEntries.entryDate, asOf),
            sql`not ${fromTrade}`,
          ),
        )
        .groupBy(
          journalLines.accountId,
          journalEntries.id,
          journalEntries.entryDate,
          journalEntries.entryNo,
          journalEntries.description,
        )
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.entryNo));

      const rows = ids
        .map((id) => {
          const account = byId.get(id)!;
          const stock = stockValue.get(id) ?? 0;
          const ledger = balances.get(id) ?? 0;
          return {
            accountId: id,
            code: account.code,
            name: account.name,
            stockValue: stock,
            ledgerBalance: ledger,
            difference: ledger - stock,
            pendingTrade: Number(pending.find((p) => p.accountId === id)?.amount ?? 0),
            otherEntries: others
              .filter((o) => o.accountId === id && Number(o.amount) !== 0)
              .slice(0, 20)
              .map((o) => ({
                id: o.id,
                number: formatJournalNo(o.entryDate, o.entryNo),
                date: o.entryDate,
                description: o.description,
                amount: Number(o.amount),
              })),
          };
        })
        .filter((r) => r.stockValue !== 0 || r.ledgerBalance !== 0 || r.pendingTrade !== 0)
        .sort((a, b) => a.code.localeCompare(b.code));
      return { date: asOf, balanced: rows.every((r) => r.difference === 0), rows };
    });
  }
}

import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { lineSupply, MoneyError, vatFromSupply } from '@wellbuddy/accounting-core';
import {
  items,
  journalEntries,
  partners,
  stockMoves,
  tradeDocLines,
  tradeDocs,
  type Transaction,
  users,
  warehouses,
} from '@wellbuddy/db';
import {
  ENABLED_TRADE_DOC_KINDS,
  FULL_CONVERSIONS,
  formatJournalNo,
  isOrderKind,
  isStockItem,
  PURCHASE_DOC_KINDS,
  SALES_DOC_KINDS,
  TRADE_DOC_KIND_LABELS,
  TRADE_DOC_PREFIXES,
  TRADE_DOC_SOURCES,
  type TradeDocInput,
  type TradeDocKind,
  type TradeDocStatus,
} from '@wellbuddy/shared';
import { and, asc, count, desc, eq, gte, ilike, inArray, like, lte, ne, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { InventoryService } from './inventory.service.js';
import { ItemsService } from './items.service.js';
import { TradePostingService } from './trade-posting.service.js';
import { WarehousesService } from './warehouses.service.js';

type Doc = typeof tradeDocs.$inferSelect;
type LineRow = typeof tradeDocLines.$inferSelect;
type Item = typeof items.$inferSelect;

/** 재고 품목만 담을 수 있는 문서 */
const STOCK_ONLY_KINDS: readonly TradeDocKind[] = [
  'receipt',
  'shipment',
  'transfer',
  'adjustment',
  'opening',
];

const needsPartner = (kind: TradeDocKind) =>
  (SALES_DOC_KINDS as readonly string[]).includes(kind) ||
  (PURCHASE_DOC_KINDS as readonly string[]).includes(kind);

const qtyText = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });

export interface TradeDocListQuery {
  kinds?: TradeDocKind[];
  from?: string;
  to?: string;
  partnerId?: string;
  status?: TradeDocStatus;
  q?: string;
  limit: number;
  offset: number;
}

/**
 * 거래 문서(견적·주문·발주·입고·구매·반품 …): 작성(앞 문서에서 전환)·취소·조회.
 * 확정 문서는 재고 이동과 전표를 만들고, 고치지 않고 취소한 뒤 다시 입력한다.
 */
@Injectable()
export class TradeDocsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly itemsService: ItemsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventory: InventoryService,
    private readonly posting: TradePostingService,
  ) {}

  // ── 조회 ─────────────────────────────────────────────

  async list(query: TradeDocListQuery) {
    return this.db.tenant(async (tx) => {
      const q = query.q ? `%${query.q}%` : undefined;
      const where = and(
        query.kinds?.length ? inArray(tradeDocs.kind, query.kinds) : undefined,
        query.from ? gte(tradeDocs.docDate, query.from) : undefined,
        query.to ? lte(tradeDocs.docDate, query.to) : undefined,
        query.partnerId ? eq(tradeDocs.partnerId, query.partnerId) : undefined,
        query.status ? eq(tradeDocs.status, query.status) : undefined,
        q
          ? or(ilike(tradeDocs.docNo, q), ilike(partners.name, q), ilike(tradeDocs.memo, q))
          : undefined,
      );
      const [total] = await tx
        .select({ n: count() })
        .from(tradeDocs)
        .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
        .where(where);
      const source = alias(tradeDocs, 'source_doc');
      const rows = await tx
        .select({
          doc: tradeDocs,
          partnerName: partners.name,
          warehouseName: warehouses.name,
          sourceDocNo: source.docNo,
        })
        .from(tradeDocs)
        .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
        .leftJoin(warehouses, eq(warehouses.id, tradeDocs.warehouseId))
        .leftJoin(source, eq(source.id, tradeDocs.sourceDocId))
        .where(where)
        .orderBy(desc(tradeDocs.docDate), desc(tradeDocs.docNo))
        .limit(query.limit)
        .offset(query.offset);
      return {
        items: rows.map((r) => ({
          ...this.header(r.doc),
          partnerName: r.partnerName,
          warehouseName: r.warehouseName,
          sourceDocNo: r.sourceDocNo,
        })),
        total: total!.n,
      };
    });
  }

  get(id: string) {
    return this.db.tenant((tx) => this.getIn(tx, id));
  }

  private async getIn(tx: Transaction, id: string) {
    const source = alias(tradeDocs, 'source_doc');
    const toWarehouse = alias(warehouses, 'to_warehouse');
    const [row] = await tx
      .select({
        doc: tradeDocs,
        partnerName: partners.name,
        partnerBizRegNo: partners.bizRegNo,
        warehouseName: warehouses.name,
        toWarehouseName: toWarehouse.name,
        source: { id: source.id, kind: source.kind, docNo: source.docNo },
        createdByName: users.name,
      })
      .from(tradeDocs)
      .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
      .leftJoin(warehouses, eq(warehouses.id, tradeDocs.warehouseId))
      .leftJoin(toWarehouse, eq(toWarehouse.id, tradeDocs.toWarehouseId))
      .leftJoin(source, eq(source.id, tradeDocs.sourceDocId))
      .leftJoin(users, eq(users.id, tradeDocs.createdBy))
      .where(eq(tradeDocs.id, id));
    if (!row) throw new NotFoundException();
    const doc = row.doc;

    const lineRows = await tx
      .select({ line: tradeDocLines, itemCode: items.code, warehouseName: warehouses.name })
      .from(tradeDocLines)
      .innerJoin(items, eq(items.id, tradeDocLines.itemId))
      .leftJoin(warehouses, eq(warehouses.id, tradeDocLines.warehouseId))
      .where(eq(tradeDocLines.docId, id))
      .orderBy(asc(tradeDocLines.lineNo));
    const processed = await this.processedQtyIn(
      tx,
      lineRows.map((l) => l.line.id),
    );

    const children = await tx
      .select({
        id: tradeDocs.id,
        kind: tradeDocs.kind,
        docNo: tradeDocs.docNo,
        docDate: tradeDocs.docDate,
        status: tradeDocs.status,
        total: tradeDocs.total,
      })
      .from(tradeDocs)
      .where(eq(tradeDocs.sourceDocId, id))
      .orderBy(asc(tradeDocs.docDate), asc(tradeDocs.docNo));

    const entryIds = [doc.entryId, doc.costEntryId].filter((x): x is string => !!x);
    const entries = entryIds.length
      ? await tx
          .select({
            id: journalEntries.id,
            entryDate: journalEntries.entryDate,
            entryNo: journalEntries.entryNo,
            status: journalEntries.status,
          })
          .from(journalEntries)
          .where(inArray(journalEntries.id, entryIds))
      : [];
    const entryDto = (entryId: string | null) => {
      const e = entries.find((x) => x.id === entryId);
      return e
        ? { id: e.id, number: formatJournalNo(e.entryDate, e.entryNo), status: e.status }
        : null;
    };

    return {
      ...this.header(doc),
      partnerName: row.partnerName,
      partnerBizRegNo: row.partnerBizRegNo,
      warehouseName: row.warehouseName,
      toWarehouseName: row.toWarehouseName,
      sourceDoc: row.source?.id ? row.source : null,
      createdByName: row.createdByName,
      cancelReason: doc.cancelReason,
      cancelledAt: doc.cancelledAt?.toISOString() ?? null,
      entry: entryDto(doc.entryId),
      costEntry: entryDto(doc.costEntryId),
      lines: lineRows.map(({ line, itemCode, warehouseName }) => {
        const done = processed.get(line.id) ?? 0;
        return {
          id: line.id,
          lineNo: line.lineNo,
          itemId: line.itemId,
          itemCode,
          itemName: line.itemName,
          spec: line.spec,
          unit: line.unit,
          qty: line.qty,
          unitPrice: line.unitPrice,
          supply: line.supply,
          vat: line.vat,
          warehouseId: line.warehouseId,
          warehouseName,
          sourceLineId: line.sourceLineId,
          lotNo: line.lotNo,
          memo: line.memo,
          /** 다음 단계 문서(출고·입고·판매·구매·반품)로 넘어간 수량 */
          processedQty: done,
          remainingQty: Math.max(0, Math.round((line.qty - done) * 1000) / 1000),
        };
      }),
      children,
    };
  }

  private header(doc: Doc) {
    return {
      id: doc.id,
      kind: doc.kind,
      kindLabel: TRADE_DOC_KIND_LABELS[doc.kind],
      docNo: doc.docNo,
      docDate: doc.docDate,
      partnerId: doc.partnerId,
      warehouseId: doc.warehouseId,
      toWarehouseId: doc.toWarehouseId,
      sourceDocId: doc.sourceDocId,
      status: doc.status,
      evidenceType: doc.evidenceType,
      supplyTotal: doc.supplyTotal,
      vatTotal: doc.vatTotal,
      total: doc.total,
      dueDate: doc.dueDate,
      memo: doc.memo,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  /** 줄마다 다음 단계 문서(취소 안 된 것)로 넘어간 수량 */
  private async processedQtyIn(tx: Transaction, lineIds: string[]) {
    const map = new Map<string, number>();
    if (lineIds.length === 0) return map;
    const rows = await tx
      .select({ sourceLineId: tradeDocLines.sourceLineId, qty: tradeDocLines.qty })
      .from(tradeDocLines)
      .innerJoin(tradeDocs, eq(tradeDocs.id, tradeDocLines.docId))
      .where(and(inArray(tradeDocLines.sourceLineId, lineIds), ne(tradeDocs.status, 'cancelled')));
    for (const r of rows) {
      const key = r.sourceLineId!;
      map.set(key, Math.round(((map.get(key) ?? 0) + r.qty) * 1000) / 1000);
    }
    return map;
  }

  // ── 작성 ─────────────────────────────────────────────

  async create(input: TradeDocInput) {
    const { companyId, userId } = requireCompanyContext();
    if (!ENABLED_TRADE_DOC_KINDS.includes(input.kind)) {
      throw new AppException(
        'KIND_NOT_READY',
        `${TRADE_DOC_KIND_LABELS[input.kind]}는 아직 입력할 수 없습니다.`,
      );
    }
    try {
      const id = await this.db.tenant(async (tx) => {
        const kind = input.kind;
        if (needsPartner(kind) && !input.partnerId) {
          throw new AppException('PARTNER_REQUIRED', '거래처를 선택해 주세요.');
        }

        await this.checkReferences(tx, input);

        // 앞 단계 문서
        const source = input.sourceDocId ? await this.loadSource(tx, input) : null;
        const sourceLines = source
          ? await tx.select().from(tradeDocLines).where(eq(tradeDocLines.docId, source.id))
          : [];
        const sourceLineById = new Map(sourceLines.map((l) => [l.id, l]));

        // 품목
        const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
        const itemRows = await tx.select().from(items).where(inArray(items.id, itemIds));
        const itemById = new Map(itemRows.map((i) => [i.id, i]));
        for (const [i, line] of input.lines.entries()) {
          const item = itemById.get(line.itemId);
          if (!item) throw new AppException('ITEM_NOT_FOUND', `${i + 1}행: 없는 품목입니다.`);
          if (!item.isActive && !line.sourceLineId) {
            throw new AppException(
              'ITEM_INACTIVE',
              `${i + 1}행: '${item.name}'은(는) 사용중지된 품목입니다.`,
            );
          }
          if (STOCK_ONLY_KINDS.includes(kind) && !isStockItem(item.kind)) {
            throw new AppException(
              'SERVICE_ITEM_NOT_ALLOWED',
              `${i + 1}행: 서비스 품목('${item.name}')은 재고가 없어 ${TRADE_DOC_KIND_LABELS[kind]}에 넣을 수 없습니다.`,
            );
          }
        }
        if (needsPartner(kind) && new Set(itemRows.map((i) => i.vatType)).size > 1) {
          throw new AppException(
            'MIXED_VAT_TYPES',
            '과세·면세·영세 품목은 세금계산서·계산서가 달라 문서를 나눠 입력해 주세요.',
          );
        }

        this.checkSourceLines(kind, input, source, sourceLines, sourceLineById, itemById);
        if (source && FULL_CONVERSIONS[kind] !== source.kind && sourceLines.length > 0) {
          await this.checkRemaining(tx, kind, input, sourceLineById, itemById);
        }

        // 창고·단가·금액
        const warehouseId =
          input.warehouseId ??
          source?.warehouseId ??
          (await this.warehousesService.ensureDefaultIn(tx)).id;
        const side = (SALES_DOC_KINDS as readonly string[]).includes(kind) ? 'sales' : 'purchase';
        const prices = await this.itemsService.pricesIn(tx, side, itemIds, input.partnerId);
        const lines = input.lines.map((l, i) => {
          const item = itemById.get(l.itemId)!;
          const fromSource = l.sourceLineId ? sourceLineById.get(l.sourceLineId) : undefined;
          const unitPrice =
            l.unitPrice ?? fromSource?.unitPrice ?? prices.get(l.itemId)?.unitPrice ?? 0;
          let supply: number;
          try {
            supply = lineSupply(l.qty, unitPrice);
          } catch (e) {
            if (e instanceof MoneyError)
              throw new AppException('AMOUNT_INVALID', `${i + 1}행: ${e.message}`);
            throw e;
          }
          const vat = needsPartner(kind) ? vatFromSupply(supply, item.vatType).vat : 0;
          return {
            lineNo: i + 1,
            item,
            qty: l.qty,
            unitPrice,
            supply,
            vat,
            warehouseId: l.warehouseId ?? fromSource?.warehouseId ?? warehouseId,
            sourceLineId: l.sourceLineId ?? null,
            lotNo: l.lotNo ?? null,
            memo: l.memo ?? null,
          };
        });
        const supplyTotal = lines.reduce((s, l) => s + l.supply, 0);
        const vatTotal = lines.reduce((s, l) => s + l.vat, 0);

        const [doc] = await tx
          .insert(tradeDocs)
          .values({
            companyId,
            kind,
            docNo: await this.nextDocNo(tx, kind, input.docDate),
            docDate: input.docDate,
            partnerId: input.partnerId ?? null,
            warehouseId,
            toWarehouseId: input.toWarehouseId ?? null,
            sourceDocId: source?.id ?? null,
            status: isOrderKind(kind) ? 'open' : 'posted',
            evidenceType: needsPartner(kind) ? (input.evidenceType ?? null) : null,
            supplyTotal,
            vatTotal,
            total: supplyTotal + vatTotal,
            dueDate: input.dueDate ?? null,
            memo: input.memo ?? null,
            createdBy: userId,
          })
          .returning();
        const inserted = await tx
          .insert(tradeDocLines)
          .values(
            lines.map((l) => ({
              companyId,
              docId: doc!.id,
              lineNo: l.lineNo,
              itemId: l.item.id,
              itemName: l.item.name,
              spec: l.item.spec,
              unit: l.item.unit,
              qty: l.qty,
              unitPrice: l.unitPrice,
              supply: l.supply,
              vat: l.vat,
              warehouseId: l.warehouseId,
              sourceLineId: l.sourceLineId,
              lotNo: l.lotNo,
              memo: l.memo,
            })),
          )
          .returning();

        // 재고 이동 → 재원가 → 전표
        const touched = new Set<string>();
        await this.insertMoves(tx, doc!, inserted, itemById, source);
        for (const l of inserted) touched.add(l.itemId);
        if (source && kind === 'purchase' && source.kind === 'receipt') {
          await this.syncConvertedAmounts(tx, source.id);
          for (const l of sourceLines) touched.add(l.itemId);
        }
        await this.settle(tx, [...touched], [doc!.id, ...(source ? [source.id] : [])]);
        if (source) await this.refreshOrderStatus(tx, source.id);

        await this.audit.record(
          {
            action: 'trade_doc.create',
            entity: 'trade_doc',
            entityId: doc!.id,
            after: { kind, docNo: doc!.docNo, total: doc!.total, sourceDocId: source?.id ?? null },
          },
          tx,
        );
        return doc!.id;
      });
      return this.get(id);
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new AppException(
          'REFERENCE_NOT_FOUND',
          '연결한 거래처·창고·품목을 찾을 수 없습니다.',
        );
      }
      if (isUniqueViolation(e)) {
        throw new AppException(
          'DOC_NO_CONFLICT',
          '같은 번호의 문서를 동시에 만들었습니다. 다시 저장해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /** 거래처·창고가 이 회사 것인지(다른 회사 것은 보이지 않는다) */
  private async checkReferences(tx: Transaction, input: TradeDocInput) {
    if (input.partnerId) {
      const [p] = await tx
        .select({ id: partners.id })
        .from(partners)
        .where(eq(partners.id, input.partnerId));
      if (!p) throw new AppException('REFERENCE_NOT_FOUND', '거래처를 찾을 수 없습니다.');
    }
    const whIds = [
      input.warehouseId,
      input.toWarehouseId,
      ...input.lines.map((l) => l.warehouseId),
    ].filter((x): x is string => !!x);
    if (whIds.length) {
      const found = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(inArray(warehouses.id, [...new Set(whIds)]));
      if (found.length !== new Set(whIds).size) {
        throw new AppException('REFERENCE_NOT_FOUND', '창고를 찾을 수 없습니다.');
      }
    }
  }

  private async loadSource(tx: Transaction, input: TradeDocInput): Promise<Doc> {
    const [source] = await tx
      .select()
      .from(tradeDocs)
      .where(eq(tradeDocs.id, input.sourceDocId!))
      .for('update');
    if (!source) throw new AppException('SOURCE_NOT_FOUND', '앞 단계 문서를 찾을 수 없습니다.');
    const allowed = TRADE_DOC_SOURCES[input.kind] ?? [];
    if (!allowed.includes(source.kind)) {
      throw new AppException(
        'SOURCE_KIND_INVALID',
        `${TRADE_DOC_KIND_LABELS[source.kind]}에서 ${TRADE_DOC_KIND_LABELS[input.kind]}를 만들 수 없습니다.`,
      );
    }
    if (source.status === 'cancelled') {
      throw new AppException('SOURCE_CANCELLED', '취소된 문서에서는 만들 수 없습니다.');
    }
    if (source.partnerId && input.partnerId && source.partnerId !== input.partnerId) {
      throw new AppException('SOURCE_PARTNER_MISMATCH', '앞 단계 문서와 거래처가 다릅니다.');
    }
    if (input.docDate < source.docDate) {
      throw new AppException(
        'SOURCE_DATE_INVALID',
        `앞 단계 문서(${source.docDate})보다 이른 날짜로 만들 수 없습니다.`,
      );
    }
    const full = FULL_CONVERSIONS[input.kind] === source.kind;
    if (full) {
      const [child] = await tx
        .select({ docNo: tradeDocs.docNo })
        .from(tradeDocs)
        .where(
          and(
            eq(tradeDocs.sourceDocId, source.id),
            eq(tradeDocs.kind, input.kind),
            ne(tradeDocs.status, 'cancelled'),
          ),
        );
      if (child) {
        throw new AppException(
          'ALREADY_CONVERTED',
          `이미 ${TRADE_DOC_KIND_LABELS[input.kind]}(${child.docNo})로 넘어간 문서입니다.`,
          HttpStatus.CONFLICT,
        );
      }
    }
    return source;
  }

  /** 줄의 앞 문서 줄이 맞는지, 그대로 옮기는 전환이면 모든 줄을 같은 수량으로 옮겼는지 */
  private checkSourceLines(
    kind: TradeDocKind,
    input: TradeDocInput,
    source: Doc | null,
    sourceLines: LineRow[],
    sourceLineById: Map<string, LineRow>,
    itemById: Map<string, Item>,
  ) {
    for (const [i, line] of input.lines.entries()) {
      if (!line.sourceLineId) continue;
      const src = sourceLineById.get(line.sourceLineId);
      if (!source || !src) {
        throw new AppException('SOURCE_LINE_INVALID', `${i + 1}행: 앞 단계 문서의 줄이 아닙니다.`);
      }
      if (src.itemId !== line.itemId) {
        throw new AppException(
          'SOURCE_LINE_INVALID',
          `${i + 1}행: 앞 단계 문서와 품목이 다릅니다(${itemById.get(line.itemId)?.name}).`,
        );
      }
    }
    if (source && FULL_CONVERSIONS[kind] === source.kind) {
      const used = input.lines.map((l) => l.sourceLineId);
      const exact =
        used.length === sourceLines.length &&
        sourceLines.every((s) => {
          const l = input.lines.find((x) => x.sourceLineId === s.id);
          return l && Math.round(l.qty * 1000) === Math.round(s.qty * 1000);
        });
      if (!exact) {
        throw new AppException(
          'CONVERSION_MISMATCH',
          `${TRADE_DOC_KIND_LABELS[source.kind]}의 모든 줄을 같은 수량으로 옮겨야 합니다(단가만 고칠 수 있습니다).`,
        );
      }
    }
  }

  /** 주문·발주·구매에서 나눠 넘길 때 남은 수량을 넘지 않는지 */
  private async checkRemaining(
    tx: Transaction,
    kind: TradeDocKind,
    input: TradeDocInput,
    sourceLineById: Map<string, LineRow>,
    itemById: Map<string, Item>,
  ) {
    const processed = await this.processedQtyIn(tx, [...sourceLineById.keys()]);
    const asking = new Map<string, number>();
    for (const l of input.lines) {
      if (!l.sourceLineId) continue;
      asking.set(l.sourceLineId, (asking.get(l.sourceLineId) ?? 0) + Math.round(l.qty * 1000));
    }
    for (const [lineId, milli] of asking) {
      const src = sourceLineById.get(lineId)!;
      const remaining =
        Math.round(src.qty * 1000) - Math.round((processed.get(lineId) ?? 0) * 1000);
      if (milli > remaining) {
        const name = itemById.get(src.itemId)?.name ?? src.itemName;
        const verb = kind.endsWith('_return') ? '반품할 수 있는' : '남은';
        throw new AppException(
          'QTY_EXCEEDS_REMAINING',
          `'${name}' ${verb} 수량은 ${qtyText(Math.max(0, remaining) / 1000)}${src.unit}입니다.`,
        );
      }
    }
  }

  /** 문서 종류별 재고 이동(재고 품목만). 금액이 정해진 이동은 공급가액을 쓴다. */
  private async insertMoves(
    tx: Transaction,
    doc: Doc,
    lines: LineRow[],
    itemById: Map<string, Item>,
    source: Doc | null,
  ) {
    const { companyId } = requireCompanyContext();
    // 금액이 정해진 이동(입고·구매·구매반품)과 이동평균으로 정하는 이동(출고·판매·판매반품)
    const plan: Record<string, { sign: 1 | -1; costing: 'fixed' | 'average' } | null> = {
      receipt: { sign: 1, costing: 'fixed' },
      purchase: source?.kind === 'receipt' ? null : { sign: 1, costing: 'fixed' },
      purchase_return: { sign: -1, costing: 'fixed' },
      shipment: { sign: -1, costing: 'average' },
      sale: source?.kind === 'shipment' ? null : { sign: -1, costing: 'average' },
      sales_return: { sign: 1, costing: 'average' },
    };
    const rule = plan[doc.kind];
    if (!rule) return;
    const rows = lines
      .filter((l) => isStockItem(itemById.get(l.itemId)!.kind))
      .map((l) => ({
        companyId,
        itemId: l.itemId,
        warehouseId: l.warehouseId ?? doc.warehouseId!,
        moveDate: doc.docDate,
        qty: rule.sign * l.qty,
        amount: rule.costing === 'fixed' ? rule.sign * l.supply : 0,
        costing: rule.costing,
        docId: doc.id,
        docLineId: l.id,
        lotNo: l.lotNo,
      }));
    if (rows.length) await tx.insert(stockMoves).values(rows);
  }

  /**
   * 입고 → 구매처럼 줄을 그대로 옮긴 경우, 앞 문서의 재고 금액을 뒤 문서(취소 안 된 것)의 공급가액으로 맞춘다.
   * 뒤 문서가 없으면(취소) 앞 문서 자신의 공급가액으로 되돌린다.
   */
  private async syncConvertedAmounts(tx: Transaction, sourceId: string) {
    const sourceLines = await tx
      .select()
      .from(tradeDocLines)
      .where(eq(tradeDocLines.docId, sourceId));
    const childLines = await tx
      .select({ sourceLineId: tradeDocLines.sourceLineId, supply: tradeDocLines.supply })
      .from(tradeDocLines)
      .innerJoin(tradeDocs, eq(tradeDocs.id, tradeDocLines.docId))
      .where(
        and(
          inArray(
            tradeDocLines.sourceLineId,
            sourceLines.map((l) => l.id),
          ),
          eq(tradeDocs.kind, 'purchase'),
          ne(tradeDocs.status, 'cancelled'),
        ),
      );
    const childSupply = new Map(childLines.map((c) => [c.sourceLineId!, c.supply]));
    for (const line of sourceLines) {
      const amount = childSupply.get(line.id) ?? line.supply;
      await tx
        .update(stockMoves)
        .set({ amount })
        .where(and(eq(stockMoves.docLineId, line.id), eq(stockMoves.costing, 'fixed')));
    }
  }

  /** 재원가(재고 부족이면 거부) 뒤 관련 문서들의 전표를 맞춘다. */
  private async settle(tx: Transaction, itemIds: string[], docIds: string[]) {
    const changed = await this.inventory.recostIn(tx, itemIds);
    for (const id of new Set([...docIds, ...changed])) await this.posting.syncIn(tx, id);
  }

  /** 견적·주문·발주: 모든 줄이 다음 단계로 넘어가면 완료, 아니면 진행 중 */
  private async refreshOrderStatus(tx: Transaction, docId: string) {
    const [doc] = await tx.select().from(tradeDocs).where(eq(tradeDocs.id, docId));
    if (!doc || !isOrderKind(doc.kind) || doc.status === 'cancelled') return;
    const lines = await tx.select().from(tradeDocLines).where(eq(tradeDocLines.docId, docId));
    const processed = await this.processedQtyIn(
      tx,
      lines.map((l) => l.id),
    );
    const done = lines.every(
      (l) => Math.round((processed.get(l.id) ?? 0) * 1000) >= Math.round(l.qty * 1000),
    );
    const status = done ? 'closed' : 'open';
    if (status !== doc.status) {
      await tx
        .update(tradeDocs)
        .set({ status, updatedAt: new Date() })
        .where(eq(tradeDocs.id, docId));
    }
  }

  /** 종류별 접두어-일자-순번(예: PO-20261108-001) */
  private async nextDocNo(tx: Transaction, kind: TradeDocKind, date: string) {
    const prefix = `${TRADE_DOC_PREFIXES[kind]}-${date.replaceAll('-', '')}-`;
    const [last] = await tx
      .select({ docNo: tradeDocs.docNo })
      .from(tradeDocs)
      .where(like(tradeDocs.docNo, `${prefix}%`))
      .orderBy(desc(tradeDocs.docNo))
      .limit(1);
    const next = last ? Number(last.docNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  // ── 취소 ─────────────────────────────────────────────

  async cancel(id: string, reason: string) {
    const { userId } = requireCompanyContext();
    await this.db.tenant(async (tx) => {
      const [doc] = await tx.select().from(tradeDocs).where(eq(tradeDocs.id, id)).for('update');
      if (!doc) throw new NotFoundException();
      if (doc.status === 'cancelled') {
        throw new AppException('ALREADY_CANCELLED', '이미 취소한 문서입니다.', HttpStatus.CONFLICT);
      }
      const children = await tx
        .select({ docNo: tradeDocs.docNo, kind: tradeDocs.kind })
        .from(tradeDocs)
        .where(and(eq(tradeDocs.sourceDocId, id), ne(tradeDocs.status, 'cancelled')));
      if (children.length > 0) {
        throw new AppException(
          'HAS_CHILDREN',
          `다음 단계 문서를 먼저 취소해 주세요: ${children
            .map((c) => `${TRADE_DOC_KIND_LABELS[c.kind]} ${c.docNo}`)
            .join(', ')}`,
          HttpStatus.CONFLICT,
        );
      }
      await tx
        .update(tradeDocs)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: userId,
          cancelReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(tradeDocs.id, id));

      const moved = await tx
        .select({ itemId: stockMoves.itemId })
        .from(stockMoves)
        .where(eq(stockMoves.docId, id));
      const touched = new Set(moved.map((m) => m.itemId));
      await tx.delete(stockMoves).where(eq(stockMoves.docId, id));

      const [source] = doc.sourceDocId
        ? await tx.select().from(tradeDocs).where(eq(tradeDocs.id, doc.sourceDocId))
        : [];
      if (source && doc.kind === 'purchase' && source.kind === 'receipt') {
        await this.syncConvertedAmounts(tx, source.id);
        const sourceItems = await tx
          .select({ itemId: tradeDocLines.itemId })
          .from(tradeDocLines)
          .where(eq(tradeDocLines.docId, source.id));
        for (const l of sourceItems) touched.add(l.itemId);
      }
      try {
        await this.settle(tx, [...touched], [id, ...(source ? [source.id] : [])]);
      } catch (e) {
        if (e instanceof AppException && e.code === 'INSUFFICIENT_STOCK') {
          throw new AppException(
            'INSUFFICIENT_STOCK',
            `취소하면 재고가 모자랍니다. ${e.message}`,
            HttpStatus.CONFLICT,
            e.details,
          );
        }
        throw e;
      }
      if (source) await this.refreshOrderStatus(tx, source.id);
      await this.audit.record(
        {
          action: 'trade_doc.cancel',
          entity: 'trade_doc',
          entityId: id,
          after: { docNo: doc.docNo, reason },
        },
        tx,
      );
    });
    return this.get(id);
  }
}
